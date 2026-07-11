import type { Entity, EntityGraph, GraphVizLink, GraphVizNode, LicenseType, Requirement, State } from "@payna/shared";
import { getDriver } from "../db/neo4j.js";

// Builds the entity's local subgraph for visualization (docs/SPEC.md §6):
// the entity, the states it operates in, the license types it holds, and the
// requirements those licenses require — scoped to the entity's operating
// states with the same IN_STATE-or-unscoped rule the traversal engine uses
// (see traversal/engine.ts), so the graph matches what the obligations table
// shows. DEPENDS_ON edges are included between requirements already in the
// set. Separate, simpler queries (rather than one traversal-engine-style
// mega query) because this route needs raw structure, not computed deadlines.

interface RequirementRow {
  licenseTypeId: string;
  requirement: Requirement;
  reqStateCode: string | null;
  cadence: { intervalMonths: number; label: string } | null;
}

function nodeId(type: GraphVizNode["type"], id: string): string {
  return `${type}:${id}`;
}

export async function getEntityGraph(entityId: string): Promise<EntityGraph | null> {
  const session = getDriver().session();
  try {
    const entityResult = await session.run(`MATCH (e:Entity {id: $entityId}) RETURN e { .* } AS entity`, {
      entityId,
    });
    if (entityResult.records.length === 0) return null;
    const entity = entityResult.records[0].get("entity") as Entity;

    const statesResult = await session.run(
      `MATCH (:Entity {id: $entityId})-[:OPERATES_IN]->(s:State) RETURN s { .* } AS state ORDER BY s.code`,
      { entityId },
    );
    const states = statesResult.records.map((r) => r.get("state") as State);
    const stateCodes = states.map((s) => s.code);

    const licenseTypesResult = await session.run(
      `MATCH (:Entity {id: $entityId})-[:HOLDS]->(lt:LicenseType)
       RETURN lt { .* } AS licenseType ORDER BY lt.name`,
      { entityId },
    );
    const licenseTypes = licenseTypesResult.records.map((r) => r.get("licenseType") as LicenseType);
    const licenseTypeIds = licenseTypes.map((lt) => lt.id);

    const requirementsResult = await session.run(
      `UNWIND $licenseTypeIds AS ltId
       MATCH (lt:LicenseType {id: ltId})-[:REQUIRES]->(req:Requirement)
       OPTIONAL MATCH (req)-[:IN_STATE]->(reqState:State)
       WITH ltId, req, reqState
       WHERE reqState IS NULL OR reqState.code IN $stateCodes
       OPTIONAL MATCH (req)-[:RENEWS_EVERY]->(cad:Cadence)
       RETURN DISTINCT ltId AS licenseTypeId, req { .* } AS requirement,
              reqState.code AS reqStateCode, cad { .intervalMonths, .label } AS cadence`,
      { licenseTypeIds, stateCodes },
    );
    const requirementRows: RequirementRow[] = requirementsResult.records.map((r) => ({
      licenseTypeId: r.get("licenseTypeId") as string,
      requirement: r.get("requirement") as Requirement,
      reqStateCode: (r.get("reqStateCode") as string | null) ?? null,
      cadence: r.get("cadence") as { intervalMonths: number; label: string } | null,
    }));

    const requirementIds = [...new Set(requirementRows.map((r) => r.requirement.id))];
    const dependsResult = await session.run(
      `UNWIND $ids AS id
       MATCH (req:Requirement {id: id})-[:DEPENDS_ON]->(dep:Requirement)
       WHERE dep.id IN $ids
       RETURN DISTINCT req.id AS fromId, dep.id AS toId`,
      { ids: requirementIds },
    );

    // --- assemble nodes (deduped by prefixed id) --------------------------
    const nodes = new Map<string, GraphVizNode>();
    nodes.set(nodeId("entity", entity.id), {
      id: nodeId("entity", entity.id),
      label: entity.name,
      type: "entity",
      kind: entity.kind,
    });
    for (const state of states) {
      nodes.set(nodeId("state", state.code), {
        id: nodeId("state", state.code),
        label: state.name,
        type: "state",
        code: state.code,
      });
    }
    for (const lt of licenseTypes) {
      nodes.set(nodeId("licenseType", lt.id), {
        id: nodeId("licenseType", lt.id),
        label: lt.name,
        type: "licenseType",
        category: lt.category,
      });
    }
    for (const row of requirementRows) {
      const req = row.requirement;
      nodes.set(nodeId("requirement", req.id), {
        id: nodeId("requirement", req.id),
        label: req.name,
        type: "requirement",
        formNumber: req.formNumber ?? null,
        agency: req.agency ?? null,
        dueMonthDay: req.dueMonthDay ?? null,
        graceDays: req.graceDays ?? null,
        cadenceIntervalMonths: row.cadence?.intervalMonths ?? null,
        cadenceLabel: row.cadence?.label ?? null,
      });
    }

    // --- assemble links -----------------------------------------------------
    const links: GraphVizLink[] = [];
    for (const state of states) {
      links.push({ source: nodeId("entity", entity.id), target: nodeId("state", state.code), type: "OPERATES_IN" });
    }
    for (const lt of licenseTypes) {
      links.push({ source: nodeId("entity", entity.id), target: nodeId("licenseType", lt.id), type: "HOLDS" });
    }
    for (const row of requirementRows) {
      links.push({
        source: nodeId("licenseType", row.licenseTypeId),
        target: nodeId("requirement", row.requirement.id),
        type: "REQUIRES",
      });
      if (row.reqStateCode) {
        links.push({
          source: nodeId("requirement", row.requirement.id),
          target: nodeId("state", row.reqStateCode),
          type: "IN_STATE",
        });
      }
    }
    for (const dep of dependsResult.records) {
      links.push({
        source: nodeId("requirement", dep.get("fromId") as string),
        target: nodeId("requirement", dep.get("toId") as string),
        type: "DEPENDS_ON",
      });
    }

    return { nodes: [...nodes.values()], links };
  } finally {
    await session.close();
  }
}
