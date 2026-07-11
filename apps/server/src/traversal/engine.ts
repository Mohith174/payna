import type { FilingObligation, ObligationStatus, Requirement } from "@payna/shared";
import { getDriver } from "../db/neo4j.js";
import { computeDeadline } from "./deadlines.js";

// Single Cypher query (docs/SPEC.md §4): collect, for the entity, every
// (Entity)-[:HOLDS]->(LicenseType)-[:REQUIRES]->(Requirement) crossed with the
// entity's OPERATES_IN states. A requirement scoped to a state via IN_STATE only
// matches that state; a requirement with no IN_STATE edge applies to every state
// the entity operates in under that license (hence the cross join, not a second filter).
const QUERY = `
  MATCH (e:Entity {id: $entityId})-[holds:HOLDS]->(lt:LicenseType)-[:REQUIRES]->(req:Requirement)
  MATCH (e)-[:OPERATES_IN]->(opState:State)
  OPTIONAL MATCH (req)-[:IN_STATE]->(reqState:State)
  WITH e, holds, lt, req, opState, reqState
  WHERE reqState IS NULL OR reqState = opState
  OPTIONAL MATCH (req)-[:RENEWS_EVERY]->(cad:Cadence)
  OPTIONAL MATCH (req)-[:DEPENDS_ON]->(dep:Requirement)
  WITH holds, lt, req, opState, cad, collect(DISTINCT dep) AS deps
  RETURN
    req { .* } AS requirement,
    lt { .id, .name } AS licenseType,
    opState { .code, .name } AS state,
    cad { .intervalMonths, .label } AS cadence,
    holds { .since, .lastFiledAt } AS holds,
    [d IN deps WHERE d IS NOT NULL | { id: d.id, name: d.name }] AS dependsOn
`;

interface RawRow {
  requirement: Requirement;
  licenseType: { id: string; name: string };
  state: { code: string; name: string };
  cadence: { intervalMonths: number; label: string } | null;
  holds: { since: string; lastFiledAt: string | null };
  dependsOn: { id: string; name: string }[];
}

const STATUS_ORDER: Record<ObligationStatus, number> = {
  overdue: 0,
  due_soon: 1,
  upcoming: 2,
  no_deadline: 3,
};

function sortObligations(a: FilingObligation, b: FilingObligation): number {
  const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (statusDiff !== 0) return statusDiff;
  if (a.nextDueDate === b.nextDueDate) return 0;
  if (a.nextDueDate === null) return 1;
  if (b.nextDueDate === null) return -1;
  return a.nextDueDate.localeCompare(b.nextDueDate);
}

export async function getObligationsForEntity(entityId: string): Promise<FilingObligation[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(QUERY, { entityId });
    const obligations = result.records.map((record) => {
      const row = record.toObject() as RawRow;
      // cad { .intervalMonths, .label } on a null OPTIONAL MATCH still returns a
      // map with null fields rather than null itself — normalize that here.
      const cadence = row.cadence && row.cadence.intervalMonths != null ? row.cadence : null;

      const { nextDueDate, status } = computeDeadline({
        since: row.holds.since,
        lastFiledAt: row.holds.lastFiledAt ?? null,
        intervalMonths: cadence?.intervalMonths ?? null,
        dueMonthDay: row.requirement.dueMonthDay ?? null,
        graceDays: row.requirement.graceDays ?? null,
      });

      const obligation: FilingObligation = {
        requirement: row.requirement,
        licenseType: row.licenseType,
        state: row.state,
        cadence,
        dependsOn: row.dependsOn,
        nextDueDate,
        status,
      };
      return obligation;
    });

    return obligations.sort(sortObligations);
  } finally {
    await session.close();
  }
}
