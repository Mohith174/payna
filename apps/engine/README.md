# Payna Engine — multi-agent compliance engine

A Python **LangGraph** multi-agent engine that ingests unstructured regulatory
documents, writes structured filing requirements into a **Neo4j** context graph,
and answers the product question: *for this entity's active licenses, what must
be filed, and by when?*

It runs alongside the TypeScript API (`apps/server`) against the **same** Neo4j
and Postgres instances defined in the repo-root `docker-compose.yml`.

## The workflow

```
document ──▶ [ extraction agent ] ──▶ [ validation agent ] ──▶ [ obligation agent ] ──▶ obligations
                    │                        │                         │
              LLM (NVIDIA NIM)      pydantic schema gate         Neo4j upsert +
              → raw records          + MCP enrichment            single-query Cypher
                                     (agency registry)           traversal
```

* **Extraction agent** (`agents/extraction_agent.py`) — one LLM round trip
  (LangChain `ChatOpenAI` → NVIDIA NIM), tolerant JSON parse to raw records.
* **Validation agent** (`agents/validation_agent.py`) — enforces the
  `ExtractedRequirement` pydantic schema (bad records become structured
  rejections, not graph writes), then **enriches each accepted record via an MCP
  tool** — `lookup_agency` on the agency-registry MCP server — to attach the
  authoritative regulator and filing-portal URL.
* **Filing-obligation agent** (`agents/obligation_agent.py`) — upserts accepted
  requirements into Neo4j and runs the **single-query multi-hop Cypher
  traversal** to compute current obligations and deadlines for every entity.

Every agent writes an `audit_log` row in Postgres around its work
(`db/audit.py`), so each run leaves a full, queryable trail.

The graph is orchestrated with LangGraph (`agents/workflow.py`):

```
StateGraph: extraction ─▶ validation ─▶ obligation ─▶ END
                    └─(nothing parsed)─▶ END
```

## MCP tools

`mcp_tools/server.py` is a standalone **Model Context Protocol** server
(`FastMCP`, stdio transport) exposing an external reference-data source:

* `lookup_agency(state_code, license_category)` → regulator + filing portal
* `list_states()`

The validation agent connects as an MCP client (`mcp_tools/client.py`, via
`langchain-mcp-adapters`) and awaits these tools inside the workflow.

## Running

```bash
# from repo root: bring up Neo4j + Postgres
docker compose up -d neo4j postgres

cd apps/engine
uv venv && uv pip install -e ".[dev]"

# grow the graph to >500 regulatory nodes
uv run python -m payna_engine.seed --requirements 430 --entities 40

# serve the API the React dashboard calls (http://localhost:4100/api)
uv run python -m payna_engine.api
```

Set `MOCK_EXTRACTION=true` to run the pipeline with a deterministic local
stand-in instead of calling the LLM.

## Measuring the claims

The numbers in the project write-up are **measured**, not asserted:

```bash
# extraction success rate over labeled fixtures (evals/fixtures/dataset.json)
uv run python -m evals.run_eval        # writes evals/last_run.json

# single-query vs naive N+1 traversal latency (seed first)
uv run python -m evals.benchmark --rounds 5   # writes evals/benchmark_last_run.json
```

* **Extraction success** — `run_eval` runs the real extraction path per document
  and checks state / category / cadence / name against the label. Timeouts from
  the reasoning model are reported separately from genuine misses.
* **Traversal latency** — `benchmark` verifies the single-query and naive
  implementations return identical obligations, then times both across every
  seeded entity and reports the reduction.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | status + configured model / mock flag |
| POST | `/api/extractions` | run the workflow on `{text}` or a PDF `file` |
| GET | `/api/entities` | list entities |
| GET | `/api/entities/{id}/obligations` | obligations via single-query traversal |
| GET | `/api/graph?limit=600` | whole-graph DTO for the force-graph dashboard |

## Tests

```bash
uv run pytest          # pure logic: deadlines, validation, MCP tool, JSON parse
```
