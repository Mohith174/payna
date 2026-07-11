# Project Rules — Learning-First Engineering

This file governs how the agent operates in this repo. Priority: understanding over velocity. If a rule here conflicts with finishing faster, the rule wins.

## 1. Plan before code
No file creation or implementation until you've stated your approach and tradeoffs in plain language and I've said "go." Plans are 3-6 sentences, not essays.

## 2. Explain before you write — for core logic only
Before writing any of the items in the "Owned by me" list below, explain: what you're about to do, why this approach over the obvious alternative, and what could break it. Then wait.

## 3. One verified slice at a time
Never scaffold more than one new layer per turn (e.g., don't write the DB connection *and* the ingestion loop *and* the API route in one shot). Smallest runnable unit → run it → show me output → then extend.

## 4. No silent dependency or infra changes
Ask before adding a package, service, container, or external API. State what it replaces or why nothing already in the stack covers it.

## 5. Owned by me (do not generate wholesale — draft with me, don't draft for me)
- Neo4j schema: node labels, relationship types, cardinality decisions
- The traversal algorithm (entity + active states → required filings + deadlines)
- LLM extraction schema + output validation logic
- Retry / error-handling logic for LLM calls and DB writes
- React state model that feeds the graph visualization

## 6. Free to generate (boilerplate — still review line by line)
- FastAPI/Express route scaffolding
- Dockerfiles, k8s manifests, CI config
- CSS/layout/component shells
- Standard migration scripts, seed data, test syntax

## 7. Debugging protocol
On any failure: give me your top 2 hypotheses and how you'd test each *before* applying a fix. No silent patches. If the first hypothesis is wrong, say so explicitly before moving to the second.

## 8. Checkpoint before moving phases
At the end of each build phase, stop and ask me to explain back what was built and why, before continuing to the next phase.

## 9. Multiple approaches when it matters
For any architecturally significant decision (schema shape, sync vs async, queue vs direct call), present 2 options with tradeoffs before implementing either.
