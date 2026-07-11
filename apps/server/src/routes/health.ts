import { Router } from "express";
import { getDriver } from "../db/neo4j.js";
import { getPool } from "../db/postgres.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks: Record<string, "ok" | "error"> = { neo4j: "ok", postgres: "ok" };

  try {
    await getDriver().verifyConnectivity();
  } catch {
    checks.neo4j = "error";
  }

  try {
    await getPool().query("SELECT 1");
  } catch {
    checks.postgres = "error";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});
