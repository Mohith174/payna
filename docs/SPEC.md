# Payna — MVP Implementation Spec

Payna is a regulatory filing tracker. Entities, licenses, and requirements are modeled as a
Neo4j graph; an LLM extraction pipeline reads source filing documents and populates the graph;
a traversal engine answers: **"for this entity's active licenses, what must be filed, and by when?"**

This spec is authoritative. Executors implement exactly this; deviations require planner sign-off.

---

## 1. Repo layout (npm workspaces)

```
payna/
├── package.json               # workspaces: packages/shared, apps/server, apps/web
├── docker-compose.yml         # neo4j, postgres, server, web
├── .env.example
├── .gitignore
├── packages/shared/           # domain types + zod schemas, no runtime deps except zod
│   └── src/
│       ├── domain.ts          # Entity, State, LicenseType, Requirement, Cadence, FilingObligation
│       ├── extraction.ts      # ExtractedRequirement zod schema + types
│       └── index.ts
├── apps/server/
│   └── src/
│       ├── index.ts           # Express bootstrap
│       ├── config.ts          # env parsing (zod), fail fast with clear message
│       ├── db/neo4j.ts        # driver singleton, close on SIGTERM
│       ├── db/postgres.ts     # pg Pool singleton
│       ├── db/migrate.ts      # tiny SQL-file migration runner (tracks in schema_migrations)
│       ├── db/migrations/*.sql
│       ├── graph/schema.cypher    # constraints + indexes
│       ├── graph/seed.ts          # idempotent seed (MERGE only)
│       ├── traversal/engine.ts    # core traversal (see §4)
│       ├── traversal/deadlines.ts # pure date math — unit tested
│       ├── extraction/…           # executor 2 (see §5)
│       ├── routes/…               # entities.ts, requirements.ts, extractions.ts, health.ts
│       └── middleware/error.ts    # central error handler → RFC-ish {error:{code,message}}
└── apps/web/                  # executor 3 (see §6)
```

Tooling: TypeScript strict everywhere; server dev via `tsx watch`; tests via `vitest`.
Node >= 20. Express 4. neo4j-driver 5. pg 8. zod 3. NO ORM — raw Cypher and SQL by design.

Root scripts: `npm run dev` (server), `npm run dev:web`, `npm run seed`, `npm run migrate`, `npm test`, `npm run build`.

## 2. Graph schema (Neo4j)

Node labels and properties (all nodes have `id: string` (uuid or natural key), `createdAt`):

- `State {code, name}` — code is natural key, e.g. "CA".
- `LicenseType {id, name, category}` — e.g. Money Transmitter License.
- `Requirement {id, name, description, formNumber?, agency?, dueMonthDay?, graceDays?, source?}`
  — first-class node (portfolio decision: requirements have their own deadlines & dependencies).
- `Entity {id, name, kind}` — kind: "LLC" | "CORP" | ….
- `Cadence {id, intervalMonths, label}` — renewal cadence as a node so RENEWS_EVERY stays an edge.

Relationships:

- `(LicenseType)-[:AVAILABLE_IN]->(State)`
- `(LicenseType)-[:REQUIRES]->(Requirement)` — requirement applies to holders of that license
- `(Requirement)-[:IN_STATE]->(State)` — jurisdiction scoping
- `(Requirement)-[:RENEWS_EVERY]->(Cadence)`
- `(Requirement)-[:DEPENDS_ON]->(Requirement)` — prerequisite filing
- `(Entity)-[:OPERATES_IN]->(State)`
- `(Entity)-[:HOLDS {since: date, lastFiledAt?: date}]->(LicenseType)`

Constraints (in `schema.cypher`): uniqueness on State.code, LicenseType.id, Requirement.id,
Entity.id, Cadence.id. Index on Requirement.name.

Seed data (idempotent, MERGE): 3 states (CA, NY, TX), 3 license types (Money Transmitter,
Consumer Lending, Debt Collection), ~8 requirements with realistic names/cadences (annual
report, quarterly call report, surety bond renewal, background re-check…), at least one
DEPENDS_ON chain, 2 entities holding licenses across ≥2 states each.

## 3. Postgres schema

Migrations as numbered SQL files. Tables:

- `audit_log(id bigserial PK, actor text, action text, subject_type text, subject_id text, detail jsonb, created_at timestamptz default now())`
- `extraction_attempts(id bigserial PK, document_name text, document_sha256 text, model text,
  status text CHECK (status in ('pending','succeeded','failed','rejected')), raw_response jsonb,
  validated jsonb, error text, attempt_no int, created_at timestamptz default now())`

Every write to Neo4j from API or extraction inserts an `audit_log` row (same request, best-effort).

## 4. Traversal engine (the product core)

`GET /entities/:id/requirements` returns `FilingObligation[]`:

```ts
interface FilingObligation {
  requirement: Requirement;
  licenseType: { id: string; name: string };
  state: { code: string; name: string };
  cadence: { intervalMonths: number; label: string } | null;
  dependsOn: { id: string; name: string }[];
  nextDueDate: string | null;   // ISO date
  status: "overdue" | "due_soon" | "upcoming" | "no_deadline"; // due_soon = within 30 days
}
```

Algorithm: single Cypher query collects, for the entity, every
`(Entity)-[:HOLDS]->(LicenseType)-[:REQUIRES]->(Requirement)` where the requirement's
`IN_STATE` state is also one the entity `OPERATES_IN` (requirements with no IN_STATE edge apply
everywhere the license is held), plus each requirement's cadence and DEPENDS_ON list.
Deadline math is pure TS in `deadlines.ts`: from `HOLDS.lastFiledAt` (or `since` when never filed)
plus `intervalMonths`, optionally snapped to `dueMonthDay` ("MM-DD"), compute `nextDueDate`;
`graceDays` extends the overdue boundary. Sort: overdue → due_soon → upcoming, then by date.
`deadlines.ts` gets vitest coverage including month-end rollover and null cadence.

## 5. Extraction pipeline (executor 2)

`ExtractedRequirement` zod schema in shared: name, description, stateCode, licenseTypeName,
intervalMonths (nullable), dueMonthDay (nullable, regex `^\d{2}-\d{2}$`), formNumber, agency,
dependsOnNames (string[]), confidence (0–1).

Flow: `POST /extractions` (multipart PDF or `{text}` JSON) → extract text (pdf-parse) →
Claude call (`@anthropic-ai/sdk`, model `claude-sonnet-5`, tool-use forced to a
`record_requirements` tool whose input schema mirrors the zod schema array) → zod-validate each
record → insert `extraction_attempts` row (status per outcome, raw + validated payloads) →
upsert valid records into Neo4j (MERGE by name+state, wire REQUIRES/IN_STATE/RENEWS_EVERY/
DEPENDS_ON) → respond `{attemptId, accepted: n, rejected: [{record, issues}]}`.

Resilience: retry with exponential backoff + jitter (base 1s, factor 2, max 3 attempts, retry
only on 429/5xx/network); each retry logs a new `attempt_no`. A record failing zod is
**rejected, never patched**. If `ANTHROPIC_API_KEY` is unset and `MOCK_EXTRACTION=true`,
a deterministic mock returns two plausible records so the full path is demo-able; without either,
respond 503 `{error:{code:"extraction_unconfigured"}}`.

## 6. Web dashboard (executor 3)

Vite + React 18 + TS + react-router. Styling: Tailwind. Data fetching: plain `fetch` +
`@tanstack/react-query`. Pages:

- `/` Entities list (name, kind, states, license count) → links to detail.
- `/entities/:id` — obligations table (requirement, license, state, next due, status chips
  colored overdue/red, due_soon/amber, upcoming/neutral) + a graph panel rendering the entity's
  license→requirement→dependency subgraph via `react-force-graph-2d`
  (`GET /entities/:id/graph` returns `{nodes, links}` — executor 3 adds this read-only route).
- `/extract` — textarea + file drop → POST /extractions → show accepted/rejected results.

State model: react-query owns server state; UI state is local `useState`. No Redux.
Vite dev proxy `/api` → server :4000; web calls `/api/*`.

## 7. Runtime & deploy

- Server on :4000, all routes under `/api`. Web dev on :5173.
- `docker-compose.yml`: `neo4j:5-community` (auth `neo4j/payna-dev-password`, ports 7474/7687),
  `postgres:16` (payna/payna/payna, port 5432), `server` (build apps/server Dockerfile),
  `web` (nginx serving Vite build, proxying /api to server). DB volumes named.
- `.env.example`: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, DATABASE_URL, ANTHROPIC_API_KEY,
  MOCK_EXTRACTION, PORT.
- `k8s/` basic manifests: deployments + services for server/web, statefulsets for dbs — generated
  freely, minimal.

## 8. Conventions

- Status codes: 200/201, 400 (validation), 404 (unknown id), 503 (unconfigured), 500 via error middleware.
- All request bodies zod-validated at the route boundary; DTO types exported from shared where reused by web.
- Commits: conventional-ish, one logical unit each ("feat(server): traversal engine", not "fix stuff").
- Secrets never committed; `.env` gitignored.
