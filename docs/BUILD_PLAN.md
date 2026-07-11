# Payna Build Plan — Learning-First Track

Reference this document at the start of each session. It defines: what gets built, which skills you're training, whether that piece belongs in the **IDE** or with the **CLI agent (Claude Code)**, what you own vs. delegate, and the checkpoint before advancing.

Pace assumption: ~10–15 hrs/week, part-time. Full-time compresses this ~40%.

---

## Tool-split rule (applies to every phase below)

- **IDE, manual, agent off or minimal** — anything you could plausibly be asked to write from scratch in a technical interview: TS types, Cypher, SQL, React state logic, git operations, API contract design. This is where syntax fluency and reasoning actually get built.
- **CLI agent (Claude Code)** — multi-file scaffolding, cross-service wiring, deployment configs, repetitive boilerplate, and reviewing/explaining code you already wrote.
- **Test:** if it's a concept an interviewer could quiz you on, do it yourself first. If it's infrastructure nobody quizzes you on, delegate it.

---

## Phase -1 — Foundations refresher (3–4 days, IDE only, no agent)

| Skill | What you do |
|---|---|
| Git | Init repo, adopt branch-per-feature, write your first 10 commits with real messages (not "fix stuff"), do one practice rebase |
| TypeScript | Hand-write interfaces for your core domain objects: `State`, `LicenseType`, `Requirement`, `Entity` — before any code touches them |
| Postgres | Sketch a normalized schema on paper: entities, applications, statuses, audit_log — before any migration tool exists |

Agent use: quiz-only. "Ask me questions about foreign keys vs. junction tables until I get 3 right in a row."

---

## Phase 0 — Graph schema design (2–3 days)

- **You (IDE/paper):** node labels, relationship types, cardinality — State, LicenseType, Requirement, Entity nodes; `REQUIRES` / `RENEWS_EVERY` / `DEPENDS_ON` edges. Mirror this schema as TS interfaces immediately — you'll reuse them in the API layer.
- **Agent:** scaffold the Neo4j driver connection, but only *after* the schema is fixed.
- **Checkpoint:** explain why requirements are modeled as nodes (not edge properties), or the reverse.

## Phase 1 — Neo4j foundations (3–4 days)

- **You (IDE):** write your first ~15 Cypher queries by hand. No generation until you've felt a bad traversal fail.
- **Agent:** driver boilerplate; after you write queries, ask it to review for anti-patterns (missing indexes, cartesian products) — but you write first.
- **Checkpoint:** explain `MERGE` vs `CREATE` and one indexing decision.

## Phase 2 — LLM extraction pipeline (4–5 days)

- **Skills:** TS generics/discriminated unions for structured LLM output types; Postgres groundwork for logging raw extraction attempts.
- **You (IDE):** the extraction schema and validation logic — this is the core of the product.
- **Agent:** PDF-parsing boilerplate, retry/backoff scaffolding — read every line, you should be able to explain the backoff curve.
- **Checkpoint:** walk through what happens when the LLM returns a field that violates your schema.

## Phase 3 — API layer / traversal engine (4–5 days)

- **Skills:** REST conventions, status-code discipline, request/response DTO typing in TS, error-handling middleware pattern.
- **You (IDE):** design the route contracts by hand first — what does `GET /entities/:id/requirements` return and why — sketch the shape before any code. Write the traversal algorithm (entity + active states → filing list + deadlines) yourself.
- **Agent:** route boilerplate, *after* contracts are defined. Reviewer only for the traversal logic.
- **Checkpoint:** explain the traversal algorithm end to end with no code open.

## Phase 4 — Postgres integration (2–3 days)

- **Skills:** migrations, transactions, indexes, reading `EXPLAIN ANALYZE`.
- **You (IDE):** first draft of schema + migration files; run `EXPLAIN ANALYZE` on at least one real query and interpret it yourself.
- **Agent:** repetitive column/migration boilerplate after your first draft exists.

## Phase 5 — React dashboard (4–5 days)

- **Skills:** hooks (`useState`/`useReducer` for filing status), controlled forms, data-fetching + loading states, component composition, basic memoization for graph-heavy views.
- **You (IDE):** the state model that feeds the graph visualization — this is the logic, not the paint.
- **Agent:** layout, CSS, component shells — delegate freely.
- **Checkpoint:** explain your state shape and why a reducer (or not) was the right call.

## Phase 6 — Docker/K8s deploy (3–4 days)

- **Skills:** minimal net-new CS learning here — this is ops literacy, not core logic.
- **Agent:** generate manifests freely.
- **You:** read every line, be able to say what each container does and why it's isolated from the others.

## Phase 7 — Integration, debugging, git hygiene (ongoing, ~1 week buffer)

- **Skills:** `git bisect` for regression hunting, self-review of feature branches before merge, hypothesis-first debugging (see `CLAUDE.md`).
- **Agent:** hypothesis generation only. You run tests and interpret results.

---

## Total: ~6.5–7.5 weeks part-time, ~4–4.5 weeks full-time.

## Standing checkpoint gate (every phase, no exceptions)

Before moving to the next phase, explain out loud: what was built, why this approach over the obvious alternative, what would break it. If you can't, redo that phase's owned logic without the agent — don't advance on borrowed understanding.
