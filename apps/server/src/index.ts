import { app } from "./app.js";
import { config } from "./config.js";
import { closeDriver } from "./db/neo4j.js";
import { closePool } from "./db/postgres.js";

const server = app.listen(config.PORT, () => {
  console.log(`payna server listening on :${config.PORT}`);
});

async function shutdown(): Promise<void> {
  console.log("shutting down...");
  server.close();
  await Promise.all([closeDriver(), closePool()]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
