// Vercel serverless entrypoint: the whole Express API runs as one function.
// vercel.json rewrites /api/:path* here; Vercel preserves the original URL,
// and the app mounts its routers under /api, so paths line up unchanged.
// Imports the compiled output (built by vercel.json's buildCommand) — the
// driver/pool singletons in db/ are module-scoped, so warm invocations
// reuse connections instead of redialing Neo4j/Postgres per request.
export { default } from "../apps/server/dist/app.js";
