# Payna

Payna is a regulatory filing tracker. It models entities, licenses, and filing requirements as a
Neo4j graph, extracts requirements out of source filing documents with an LLM pipeline, and
answers a single product question: **for this entity's active licenses, what must be filed, and
by when?**

Not a lender-grade compliance product — an MVP that demonstrates the graph model, the extraction
pipeline, and the traversal/deadline engine end to end.

## Architecture

### Monorepo layout (npm workspaces)

```
payna/
├── package.json               # workspaces: packages/shared, apps/server, apps/web
├── docker-compose.yml         # neo4j, postgres, server, web
├── k8s/                       # namespace, statefulsets/deployments, services, ingress
├── .env.example
├── packages/shared/           # domain types + zod schemas (no runtime deps but zod)
│   └── src/
│       ├── domain.ts          # Entity, State, LicenseType, Requirement, Cadence, FilingObligation
│       ├── extraction.ts      # ExtractedRequirement zod schema
│       └── index.ts
├── apps/server/                       # Express API (port 4000, all routes under /api)
│   └── src/
│       ├── index.ts                   # bootstrap
│       ├── config.ts                  # env parsing (zod), fails fast on missing/invalid vars
│       ├── db/{neo4j,postgres}.ts     # driver/pool singletons
│       ├── db/migrate.ts + migrations/*.sql   # forward-only SQL migration runner
│       ├── graph/schema.cypher        # constraints + indexes
│       ├── graph/seed.ts              # idempotent (MERGE-only) seed data
│       ├── traversal/engine.ts        # the Cypher query behind GET /entities/:id/requirements
│       ├── traversal/deadlines.ts     # pure date math, unit tested (vitest)
│       ├── extraction/                # LLM extraction pipeline (pipeline.ts, llm.ts, parse.ts, upsert.ts, mock.ts)
│       ├── routes/                    # entities.ts, extractions.ts, health.ts
│       └── middleware/error.ts        # central error handler -> {error:{code,message}}
└── apps/web/                          # Vite + React dashboard (built separately; see caveat below)
```

TypeScript strict everywhere; server dev via `tsx watch`; tests via `vitest`; Node >= 20;
Express 4, neo4j-driver 5, pg 8, zod 3. No ORM — raw Cypher and SQL by design.

### Graph schema (Neo4j)

Every node has `id` (uuid or natural key) and `createdAt`.

| Label | Key properties |
|---|---|
| `State` | `code` (natural key, e.g. "CA"), `name` |
| `LicenseType` | `name`, `category` |
| `Requirement` | `name`, `description`, `formNumber?`, `agency?`, `dueMonthDay?` ("MM-DD"), `graceDays?`, `source?` |
| `Entity` | `name`, `kind` ("LLC" \| "CORP" \| "PARTNERSHIP" \| "SOLE_PROP") |
| `Cadence` | `intervalMonths`, `label` |

```
(LicenseType)-[:AVAILABLE_IN]->(State)
(LicenseType)-[:REQUIRES]->(Requirement)
(Requirement)-[:IN_STATE]->(State)          -- jurisdiction scoping; absent = applies everywhere the license is held
(Requirement)-[:RENEWS_EVERY]->(Cadence)
(Requirement)-[:DEPENDS_ON]->(Requirement)  -- prerequisite filing
(Entity)-[:OPERATES_IN]->(State)
(Entity)-[:HOLDS {since, lastFiledAt?}]->(LicenseType)
```

**Why `Requirement` is a first-class node** rather than a property bag on `LicenseType`: requirements
have their own deadlines, their own dependency chains (`DEPENDS_ON`), and can be scoped to a
specific state independently of where the license itself is available. Modeling them as nodes lets
the traversal query collect cadence, jurisdiction, and prerequisite information in one Cypher
statement instead of denormalizing it onto the license.

Constraints (`apps/server/src/graph/schema.cypher`): uniqueness on `State.code`, `LicenseType.id`,
`Requirement.id`, `Entity.id`, `Cadence.id`; an index on `Requirement.name`.

Seed data (`apps/server/src/graph/seed.ts`, idempotent via `MERGE`): 3 states (CA, NY, TX), 3
license types (Money Transmitter, Consumer Lending, Debt Collection), 8 requirements spanning
quarterly/annual/biennial cadences, one `DEPENDS_ON` chain (surety bond renewal must precede
license renewal; a compliance filing depends on a license renewal), and 2 entities each holding
licenses across 2 states.

### Postgres schema

- `audit_log` — one row per graph-mutating write from the API or extraction pipeline (best-effort,
  same request).
- `extraction_attempts` — one row per LLM call attempt (including retries), recording the model
  used, raw response, validated output, and status (`pending` / `succeeded` / `failed` /
  `rejected`).

Migrations live as numbered SQL files in `apps/server/src/db/migrations/` and are applied
forward-only by the tiny runner in `db/migrate.ts`, which tracks what's been applied in a
`schema_migrations` table.

### Traversal engine

`GET /api/entities/:id/requirements` returns a `FilingObligation[]`. A single Cypher query
(`apps/server/src/traversal/engine.ts`) walks
`(Entity)-[:HOLDS]->(LicenseType)-[:REQUIRES]->(Requirement)`, filtered to requirements whose
`IN_STATE` state (if any) is one the entity `OPERATES_IN`, and collects each requirement's cadence
and `DEPENDS_ON` list alongside it.

Deadline math is pure TypeScript in `apps/server/src/traversal/deadlines.ts` (no I/O, unit tested):
from `HOLDS.lastFiledAt` (or `since` if the requirement has never been filed), add
`Cadence.intervalMonths` — clamping month-end rollover (e.g. Jan 31 + 1 month → Feb 28, not
March), then optionally snap to `dueMonthDay`. `graceDays` extends how far past the computed date
a requirement can go before flipping from `due_soon` to `overdue`. Status buckets, in sort order:
`overdue` → `due_soon` (within 30 days) → `upcoming` → `no_deadline` (no cadence at all).

### Extraction pipeline

`POST /api/extractions` accepts either a multipart PDF or `{ "text": "..." }` JSON.

```
PDF/text in
  -> extract text (pdf-parse, for PDFs)
  -> LLM call (OpenAI-compatible endpoint: LLM_BASE_URL / LLM_API_KEY / LLM_MODEL)
  -> defensive parse: strip any reasoning preamble, pull the first JSON array out of the response
  -> zod-validate each record against ExtractedRequirementSchema (packages/shared/src/extraction.ts)
  -> insert one extraction_attempts row per attempt (status, raw + validated payloads, model)
  -> upsert accepted records into Neo4j (MERGE by name+state; wires REQUIRES/IN_STATE/RENEWS_EVERY/DEPENDS_ON)
  -> respond { attemptId, accepted: n, rejected: [{record, issues}] }
```

Retries: exponential backoff with full jitter (base 1s, factor 2, max 3 attempts), retried only on
429 / 5xx / network errors / unparseable JSON — each retry writes its own `extraction_attempts` row
with an incremented `attempt_no`. A record that fails zod validation is rejected outright, never
silently coerced.

If `LLM_API_KEY` is unset and `MOCK_EXTRACTION=true`, a deterministic mock (`extraction/mock.ts`)
returns two plausible records so the full path is demo-able without a real LLM key. If neither is
set, the route responds `503 {"error":{"code":"extraction_unconfigured"}}`.

## Quickstart

### With Docker Compose

```bash
cp .env.example .env          # fill in LLM_API_KEY if you have one; MOCK_EXTRACTION=true works without it
docker compose up -d neo4j postgres
docker compose up -d --build server     # apps/web is not yet part of this checkout — see caveat above
docker compose exec server node apps/server/dist/db/migrate.js
docker compose exec server node apps/server/dist/graph/seed.js
curl http://localhost:4000/api/health
```

### Local (without Docker)

Requires a running Neo4j (`bolt://localhost:7687`) and Postgres reachable at `DATABASE_URL` —
easiest via `docker compose up -d neo4j postgres`.

```bash
cp .env.example .env
npm install
npm run migrate     # apps/server "migrate" script -> src/db/migrate.ts
npm run seed         # apps/server "seed" script -> src/graph/seed.ts
npm run dev           # apps/server "dev" script -> tsx watch src/index.ts, serves :4000
npm test                # builds packages/shared, then runs apps/server's vitest suite
npm run build           # builds packages/shared, then apps/server (tsc)
```

All of the above are root `package.json` scripts that delegate into the relevant workspace; see
`package.json` and `apps/server/package.json` for the exact commands.

### `.env` variables (`.env.example`)

| Variable | Purpose | Default |
|---|---|---|
| `NEO4J_URI` | Bolt connection string | — (required) |
| `NEO4J_USER` | Neo4j username | — (required) |
| `NEO4J_PASSWORD` | Neo4j password | — (required) |
| `DATABASE_URL` | Postgres connection string | — (required) |
| `LLM_BASE_URL` | OpenAI-compatible endpoint | `https://integrate.api.nvidia.com/v1` |
| `LLM_API_KEY` | LLM key; empty + `MOCK_EXTRACTION=true` runs the mock path | `""` |
| `LLM_MODEL` | Model name passed to the endpoint | `nvidia/nemotron-3-super-120b-a12b` |
| `MOCK_EXTRACTION` | `true` to use the deterministic mock when no key is set | `false` |
| `PORT` | Server port | `4000` |

`.env` is gitignored — never commit real credentials. In Docker Compose and Kubernetes,
`LLM_API_KEY` is passed through from the host environment / a Secret, never inlined into a tracked
file (see `docker-compose.yml`'s `server.environment.LLM_API_KEY: ${LLM_API_KEY:-}` and
`k8s/30-server.yaml`'s `server-secrets` Secret).

## API reference

All routes are mounted under `/api` (`apps/server/src/index.ts`). Errors follow
`{ "error": { "code": string, "message": string } }` (`apps/server/src/middleware/error.ts`).

### Health

- `GET /api/health` — checks Neo4j (`verifyConnectivity`) and Postgres (`SELECT 1`).
  `200 {"status":"ok","checks":{"neo4j":"ok","postgres":"ok"}}` or `503` with any check `"error"`.

### Entities

- `GET /api/entities` — list entities with their operating states and license count.
- `POST /api/entities` — create an entity. Body: `{ name, kind, operatesIn?: string[] }` where
  `kind` is one of `LLC | CORP | PARTNERSHIP | SOLE_PROP` and `operatesIn` is a list of 2-letter
  state codes. `201` with the created entity; writes an `audit_log` row.
- `GET /api/entities/:id` — fetch one entity. `404` if unknown.
- `GET /api/entities/:id/requirements` — the traversal engine's output: `FilingObligation[]`
  (requirement, license type, state, cadence, `dependsOn`, `nextDueDate`, `status`). `404` if the
  entity doesn't exist.

### Extractions

- `POST /api/extractions` — multipart `file` (PDF) or JSON `{ text: string }`. Runs the extraction
  pipeline described above. `201 { attemptId, accepted, rejected }`. `503` if unconfigured, `502`
  if the LLM call ultimately fails after retries, `400` on validation errors (e.g. non-PDF upload).
- `GET /api/extractions` — the 50 most recent `extraction_attempts` rows (id, document name,
  status, model, attempt number, accepted/rejected counts, timestamp).

### Status codes

`200`/`201` success, `400` validation, `404` unknown id, `503` unconfigured, `500` via the central
error handler. All request bodies are zod-validated at the route boundary.

## Deploying

### Docker Compose

`docker-compose.yml` runs `neo4j:5-community`, `postgres:16`, `server` (`apps/server/Dockerfile`),
and `web` (`apps/web/Dockerfile`, nginx serving the Vite build and proxying `/api/*` to `server`).
`server` waits on both databases' healthchecks. `LLM_*` variables pass through from the host shell;
`MOCK_EXTRACTION` defaults to `true` in compose so the extraction path is demo-able out of the box.

Both app Dockerfiles are multi-stage: a `node:22-slim` stage runs `npm ci` + the workspace build,
then a slim runtime stage (another `node:22-slim` for the server, `nginx:alpine` for the web build)
copies over only the compiled output. Neither image bakes in a `.env` file — all server config
comes from runtime environment variables (`apps/server/src/config.ts` reads `process.env`
directly; `--env-file` is a `tsx`/dev-only convenience, not something the built image relies on).

### Kubernetes (`k8s/`)

Plain YAML, no Helm — a `kustomization.yaml` lists them in apply order:

| File | Contents |
|---|---|
| `00-namespace.yaml` | the `payna` namespace |
| `10-postgres.yaml` | Secret (placeholder creds), PVC, single-replica Deployment, Service |
| `20-neo4j.yaml` | Secret (placeholder creds), StatefulSet with a `volumeClaimTemplate`, headless Service |
| `30-server.yaml` | ConfigMap (non-secret env), Secret (`NEO4J_PASSWORD`, `DATABASE_URL`, `LLM_API_KEY` — placeholders), 2-replica Deployment with `/api/health` liveness/readiness probes, Service |
| `40-web.yaml` | 2-replica Deployment, Service, Ingress routing `/` to `web` (the image's own nginx already proxies `/api` to the `server` Service) |

```bash
kubectl apply -k k8s/
```

**Secrets are placeholders** (`CHANGE_ME`) so the manifests are safe to commit — replace them
before applying to a real cluster, e.g. via `kubectl create secret generic ... --dry-run=client -o
yaml` piped into your GitOps flow, or an External Secrets Operator. `LLM_API_KEY` ships empty;
`MOCK_EXTRACTION` defaults to `"false"` in the server ConfigMap (unlike Compose) since a real
cluster deploy is assumed to have a real key.
