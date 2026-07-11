import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { closeDriver } from "./db/neo4j.js";
import { closePool } from "./db/postgres.js";
import { errorHandler } from "./middleware/error.js";
import { entitiesRouter } from "./routes/entities.js";
import { extractionsRouter } from "./routes/extractions.js";
import { healthRouter } from "./routes/health.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/entities", entitiesRouter);
app.use("/api/extractions", extractionsRouter);

app.use(errorHandler);

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
