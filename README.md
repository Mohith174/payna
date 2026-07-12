# Payna

Payna is a regulatory filing tracker. It models entities, licenses, and filing requirements as a
Neo4j graph, extracts requirements out of source filing documents with an LLM pipeline, and
answers a single product question: **for this entity's active licenses, what must be filed, and
by when?**

Not a lender-grade compliance product — an MVP that demonstrates the graph model, the extraction
pipeline, and the traversal/deadline engine end to end.

**Live:** https://payna-azure.vercel.app

## Architecture

```
payna/
├── docker-compose.yml         # neo4j, postgres, server, web
├── api/index.mjs              # Vercel serverless entrypoint (re-exports the Express app)
├── vercel.json                # build, rewrites, daily health-check cron
├── packages/shared/           # domain types + zod schemas
├── apps/server/                       # Express API (all routes under /api)
│   └── src/
│       ├── app.ts / index.ts          # app construction split from the listener —
│       │                              #   same app serves Docker/local and Vercel's function runtime
│       ├── db/{neo4j,postgres}.ts     # driver/pool singletons
│       ├── db/migrate.ts + migrations/*.sql
│       ├── graph/schema.cypher        # constraints + indexes
│       ├── graph/seed.ts              # idempotent (MERGE-only) seed data
│       ├── traversal/engine.ts        # the Cypher query behind GET /entities/:id/requirements
│       ├── traversal/deadlines.ts     # pure date math, unit tested (vitest)
│       ├── extraction/                # LLM extraction pipeline (pipeline.ts, llm.ts, parse.ts, upsert.ts, mock.ts)
│       └── routes/                    # entities.ts, extractions.ts, health.ts
└── apps/web/                          # Vite + React dashboard
```

TypeScript strict everywhere; server dev via `tsx watch`; tests via `vitest`; Node >= 20;
Express 4, neo4j-driver 5, pg 8, zod 3. No ORM — raw Cypher and SQL by design.

### Graph schema (Neo4j)

```
(LicenseType)-[:AVAILABLE_IN]->(State)
(LicenseType)-[:REQUIRES]->(Requirement)
(Requirement)-[:IN_STATE]->(State)          -- jurisdiction scoping; absent = applies everywhere the license is held
(Requirement)-[:RENEWS_EVERY]->(Cadence)
(Requirement)-[:DEPENDS_ON]->(Requirement)  -- prerequisite filing
(Entity)-[:OPERATES_IN]->(State)
(Entity)-[:HOLDS {since, lastFiledAt?}]->(LicenseType)
```

`Requirement` is a first-class node, not a property bag on `LicenseType`: requirements have their
own deadlines, their own dependency chains (`DEPENDS_ON`), and can be scoped to a state
independently of where the license itself is available. That lets the traversal query collect
cadence, jurisdiction, and prerequisite info in one Cypher statement instead of denormalizing it
onto the license.

Seed data (`apps/server/src/graph/seed.ts`, idempotent via `MERGE`): 3 states, 3 license types, 8
requirements spanning quarterly/annual/biennial cadences, a `DEPENDS_ON` chain, and 2 entities
holding licenses across 2 states.

### Traversal engine

`GET /api/entities/:id/requirements` returns a `FilingObligation[]`. A single Cypher query walks
`(Entity)-[:HOLDS]->(LicenseType)-[:REQUIRES]->(Requirement)`, filtered to requirements whose
`IN_STATE` state (if any) is one the entity `OPERATES_IN`, and collects each requirement's cadence
and `DEPENDS_ON` list alongside it.

Deadline math is pure TypeScript (`traversal/deadlines.ts`, no I/O, unit tested): from
`HOLDS.lastFiledAt` (or `since` if never filed), add `Cadence.intervalMonths` — clamping
month-end rollover (Jan 31 + 1 month → Feb 28, not March) — then optionally snap to
`dueMonthDay`. `graceDays` extends how far past the computed date a requirement can go before
flipping from `due_soon` to `overdue`. Status buckets, sort order: `overdue` → `due_soon` (within
30 days) → `upcoming` → `no_deadline`.

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
429 / 5xx / network errors / unparseable JSON. A record that fails zod validation is rejected
outright, never silently coerced.

**Live vs. mock extraction** — this is the one thing worth being explicit about: the pipeline has
two modes controlled by two env vars, `LLM_API_KEY` and `MOCK_EXTRACTION`.

- **Live**: set a real `LLM_API_KEY` (the app defaults `LLM_BASE_URL`/`LLM_MODEL` to NVIDIA's
  OpenAI-compatible endpoint, `nvidia/nemotron-3-super-120b-a12b`) — every extraction call hits
  the real model.
- **Mock**: leave `LLM_API_KEY` unset and `MOCK_EXTRACTION=true` — a deterministic mock
  (`extraction/mock.ts`) returns two plausible records so the full pipeline (validation, Postgres
  logging, Neo4j upsert) is demoable with zero external calls.
- If neither is set, the route responds `503 {"error":{"code":"extraction_unconfigured"}}`.

`docker-compose.yml` sets `MOCK_EXTRACTION` to default `true` so `docker compose up` works out of
the box with no key. Pass a real `LLM_API_KEY` (and optionally `MOCK_EXTRACTION=false`) via a
`.env` file or the host shell to switch that same compose stack to live extraction — no config
files to swap, just env vars.

### Postgres

- `audit_log` — one row per graph-mutating write from the API or extraction pipeline.
- `extraction_attempts` — one row per LLM call attempt (including retries): model used, raw
  response, validated output, status (`pending` / `succeeded` / `failed` / `rejected`).

Migrations are numbered SQL files (`apps/server/src/db/migrations/`) applied forward-only by a
small runner that tracks progress in a `schema_migrations` table.

## Running it

### Docker Compose (recommended)

```bash
cp .env.example .env          # MOCK_EXTRACTION=true works without an LLM key
docker compose up -d --build
docker compose exec server node apps/server/dist/db/migrate.js
docker compose exec server node apps/server/dist/graph/seed.js
curl http://localhost:4000/api/health
```

Web dashboard: http://localhost:5173. Server API: http://localhost:4000/api.

### Local (without Docker)

Requires Neo4j (`bolt://localhost:7687`) and Postgres reachable at `DATABASE_URL` — easiest via
`docker compose up -d neo4j postgres`.

```bash
cp .env.example .env
npm install
npm run migrate      # apps/server "migrate" script
npm run seed          # apps/server "seed" script
npm run dev            # tsx watch, serves :4000
npm test                  # builds packages/shared, then runs apps/server's vitest suite
npm run build              # builds packages/shared, then apps/server (tsc)
```

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

`.env` is gitignored — never commit real credentials. `LLM_API_KEY` is always passed through from
the host environment / a platform secret, never inlined into a tracked file.

## API reference

All routes are mounted under `/api`. Errors follow `{ "error": { "code": string, "message": string } }`.

- `GET /api/health` — checks Neo4j and Postgres. `200` or `503`.
- `GET /api/entities` / `POST /api/entities` — list / create entities.
- `GET /api/entities/:id` — fetch one entity. `404` if unknown.
- `GET /api/entities/:id/requirements` — the traversal engine's output: `FilingObligation[]`.
- `POST /api/extractions` — multipart `file` (PDF) or JSON `{ text: string }`. `201` on success,
  `503` if unconfigured, `502` if the LLM call fails after retries, `400` on validation errors.
- `GET /api/extractions` — the 50 most recent `extraction_attempts` rows.

All request bodies are zod-validated at the route boundary.

## Deploying

**Production is Vercel** (https://payna-azure.vercel.app): `apps/web` builds to static output
served by Vercel's CDN; `api/index.mjs` re-exports the compiled Express app (`apps/server/dist/app.js`)
as a single serverless function, and `vercel.json` rewrites `/api/*` to it while everything else
falls back to the SPA's `index.html`. Neo4j runs on Aura Free; a daily cron hits `/api/health` to
keep that instance from idle-pausing.

Docker Compose (`docker-compose.yml`) is the local/self-hosted path: `neo4j:5-community`,
`postgres:16`, `server`, and `web` (nginx serving the Vite build, proxying `/api/*` to `server`).
Both app Dockerfiles are multi-stage — a `node:22-slim` build stage, then a slim runtime stage
(`node:22-slim` for the server, `nginx:alpine` for the web build) that copies over only the
compiled output. Neither image bakes in a `.env` file; all config comes from runtime environment
variables.
