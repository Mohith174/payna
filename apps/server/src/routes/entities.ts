import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Entity, EntityKind } from "@payna/shared";
import { getDriver } from "../db/neo4j.js";
import { writeAuditLog } from "../db/audit.js";
import { getObligationsForEntity } from "../traversal/engine.js";
import { notFound } from "../middleware/error.js";

export const entitiesRouter = Router();

const CreateEntitySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["LLC", "CORP", "PARTNERSHIP", "SOLE_PROP"]),
  operatesIn: z.array(z.string().length(2)).optional().default([]),
});

entitiesRouter.get("/", async (_req, res, next) => {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (e:Entity)
       OPTIONAL MATCH (e)-[:OPERATES_IN]->(s:State)
       OPTIONAL MATCH (e)-[:HOLDS]->(lt:LicenseType)
       WITH e, collect(DISTINCT s.code) AS states, count(DISTINCT lt) AS licenseCount
       RETURN e { .* } AS entity, states, licenseCount
       ORDER BY e.name`,
    );
    const entities = result.records.map((r) => ({
      ...(r.get("entity") as Entity),
      states: r.get("states") as string[],
      licenseCount: r.get("licenseCount") as number,
    }));
    res.json(entities);
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

entitiesRouter.post("/", async (req, res, next) => {
  try {
    const body = CreateEntitySchema.parse(req.body);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const session = getDriver().session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(`CREATE (e:Entity {id: $id, name: $name, kind: $kind, createdAt: $createdAt})`, {
          id,
          name: body.name,
          kind: body.kind,
          createdAt,
        });
        if (body.operatesIn.length > 0) {
          await tx.run(
            `UNWIND $codes AS code
             MATCH (e:Entity {id: $id}), (s:State {code: code})
             MERGE (e)-[:OPERATES_IN]->(s)`,
            { id, codes: body.operatesIn },
          );
        }
      });
    } finally {
      await session.close();
    }

    await writeAuditLog({ actor: "api", action: "entity.create", subjectType: "Entity", subjectId: id, detail: body });

    const entity: Entity = { id, name: body.name, kind: body.kind as EntityKind, createdAt };
    res.status(201).json(entity);
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/:id", async (req, res, next) => {
  const session = getDriver().session();
  try {
    const result = await session.run(`MATCH (e:Entity {id: $id}) RETURN e { .* } AS entity`, { id: req.params.id });
    if (result.records.length === 0) throw notFound("Entity");
    res.json(result.records[0].get("entity"));
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

entitiesRouter.get("/:id/requirements", async (req, res, next) => {
  const session = getDriver().session();
  try {
    const exists = await session.run(`MATCH (e:Entity {id: $id}) RETURN e.id AS id`, { id: req.params.id });
    if (exists.records.length === 0) throw notFound("Entity");
    const obligations = await getObligationsForEntity(req.params.id);
    res.json(obligations);
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});
