import { randomUUID } from "node:crypto";
import type { ExtractedRequirement } from "@payna/shared";
import { getDriver } from "../db/neo4j.js";
import { writeAuditLog } from "../db/audit.js";

function cadenceLabel(intervalMonths: number): string {
  switch (intervalMonths) {
    case 1:
      return "Monthly";
    case 3:
      return "Quarterly";
    case 6:
      return "Semiannual";
    case 12:
      return "Annual";
    case 24:
      return "Biennial";
    default:
      return `Every ${intervalMonths} months`;
  }
}

/**
 * Upsert validated extraction records into the graph.
 * Requirement identity is (name, state): the MERGE pattern includes the
 * IN_STATE edge, so the same requirement name in another state is a distinct
 * node. DEPENDS_ON is wired in a second pass so intra-batch forward references
 * (a record depending on a later record) resolve.
 */
export async function upsertExtractedRequirements(records: ExtractedRequirement[], source: string): Promise<void> {
  if (records.length === 0) return;
  const now = new Date().toISOString();
  const session = getDriver().session();

  try {
    await session.executeWrite(async (tx) => {
      for (const rec of records) {
        await tx.run(
          `MERGE (s:State {code: $stateCode})
             ON CREATE SET s.id = $stateCode, s.name = $stateCode, s.createdAt = $now
           MERGE (lt:LicenseType {name: $licenseTypeName})
             ON CREATE SET lt.id = $licenseTypeId, lt.category = 'Extracted', lt.createdAt = $now
           MERGE (req:Requirement {name: $name})-[:IN_STATE]->(s)
             ON CREATE SET req.id = $requirementId, req.createdAt = $now
           SET req.description = $description,
               req.formNumber = $formNumber,
               req.agency = $agency,
               req.dueMonthDay = $dueMonthDay,
               req.source = $source
           MERGE (lt)-[:REQUIRES]->(req)
           MERGE (lt)-[:AVAILABLE_IN]->(s)`,
          {
            stateCode: rec.stateCode,
            licenseTypeName: rec.licenseTypeName,
            licenseTypeId: randomUUID(),
            name: rec.name,
            requirementId: randomUUID(),
            description: rec.description,
            formNumber: rec.formNumber ?? null,
            agency: rec.agency ?? null,
            dueMonthDay: rec.dueMonthDay,
            source,
            now,
          },
        );

        if (rec.intervalMonths !== null) {
          await tx.run(
            `MATCH (req:Requirement {name: $name})-[:IN_STATE]->(:State {code: $stateCode})
             MERGE (c:Cadence {intervalMonths: $intervalMonths})
               ON CREATE SET c.id = $cadenceId, c.label = $label, c.createdAt = $now
             MERGE (req)-[:RENEWS_EVERY]->(c)`,
            {
              name: rec.name,
              stateCode: rec.stateCode,
              intervalMonths: rec.intervalMonths,
              cadenceId: `cadence-${rec.intervalMonths}mo`,
              label: cadenceLabel(rec.intervalMonths),
              now,
            },
          );
        }
      }

      // Second pass: dependencies, only where the named requirement exists
      // (same state preferred; fall back to any state so cross-document
      // references still connect).
      for (const rec of records) {
        for (const depName of rec.dependsOnNames) {
          await tx.run(
            `MATCH (req:Requirement {name: $name})-[:IN_STATE]->(s:State {code: $stateCode})
             OPTIONAL MATCH (sameState:Requirement {name: $depName})-[:IN_STATE]->(s)
             OPTIONAL MATCH (anyState:Requirement {name: $depName})
             WITH req, coalesce(sameState, anyState) AS dep
             WHERE dep IS NOT NULL
             WITH req, dep LIMIT 1
             MERGE (req)-[:DEPENDS_ON]->(dep)`,
            { name: rec.name, stateCode: rec.stateCode, depName },
          );
        }
      }
    });
  } finally {
    await session.close();
  }

  for (const rec of records) {
    await writeAuditLog({
      actor: "extraction",
      action: "requirement.upsert",
      subjectType: "Requirement",
      subjectId: `${rec.name} (${rec.stateCode})`,
      detail: rec,
    });
  }
}
