import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDriver, closeDriver } from "../db/neo4j.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const now = new Date().toISOString();

// --- seed data -------------------------------------------------------------

const states = [
  { code: "CA", name: "California" },
  { code: "NY", name: "New York" },
  { code: "TX", name: "Texas" },
];

const licenseTypes = [
  { id: "money-transmitter", name: "Money Transmitter License", category: "Money Services" },
  { id: "consumer-lending", name: "Consumer Lending License", category: "Lending" },
  { id: "debt-collection", name: "Debt Collection License", category: "Collections" },
];

// LicenseType AVAILABLE_IN every seeded state (kept flat for the MVP dataset).
const availableIn = licenseTypes.flatMap((lt) => states.map((s) => ({ licenseTypeId: lt.id, stateCode: s.code })));

const cadences = [
  { id: "cadence-quarterly", intervalMonths: 3, label: "Quarterly" },
  { id: "cadence-annual", intervalMonths: 12, label: "Annual" },
  { id: "cadence-biennial", intervalMonths: 24, label: "Biennial" },
];

interface RequirementSeed {
  id: string;
  name: string;
  description: string;
  licenseTypeId: string;
  stateCode: string | null; // null = applies everywhere the license is held
  cadenceId: string | null; // null = no recurring cadence
  dueMonthDay: string | null;
  graceDays: number | null;
  formNumber: string | null;
  agency: string | null;
  dependsOnId: string | null;
}

const requirements: RequirementSeed[] = [
  {
    id: "mt-annual-report",
    name: "Annual Report",
    description: "Annual financial and operational report for money transmitter licensees.",
    licenseTypeId: "money-transmitter",
    stateCode: "CA",
    cadenceId: "cadence-annual",
    dueMonthDay: "03-31",
    graceDays: 30,
    formNumber: "MT-AR-1",
    agency: "California DFPI",
    dependsOnId: null,
  },
  {
    id: "mt-quarterly-call-report",
    name: "Quarterly Call Report",
    description: "Quarterly transaction volume and financial condition report.",
    licenseTypeId: "money-transmitter",
    stateCode: "NY",
    cadenceId: "cadence-quarterly",
    dueMonthDay: null,
    graceDays: 15,
    formNumber: "MT-QCR",
    agency: "NY Department of Financial Services",
    dependsOnId: null,
  },
  {
    id: "mt-surety-bond-renewal",
    name: "Surety Bond Renewal",
    description: "Renewal of the surety bond required to maintain licensure.",
    licenseTypeId: "money-transmitter",
    stateCode: null,
    cadenceId: "cadence-annual",
    dueMonthDay: null,
    graceDays: 0,
    formNumber: "SB-1",
    agency: null,
    dependsOnId: null,
  },
  {
    id: "mt-license-renewal",
    name: "License Renewal Application",
    description: "Annual renewal application for the money transmitter license.",
    licenseTypeId: "money-transmitter",
    stateCode: null,
    cadenceId: "cadence-annual",
    dueMonthDay: "12-31",
    graceDays: 10,
    formNumber: "MT-REN",
    agency: null,
    dependsOnId: "mt-surety-bond-renewal", // must renew the bond before the license
  },
  {
    id: "cl-annual-report",
    name: "Consumer Lending Annual Report",
    description: "Annual report of lending volume and compliance activity.",
    licenseTypeId: "consumer-lending",
    stateCode: "TX",
    cadenceId: "cadence-annual",
    dueMonthDay: "01-31",
    graceDays: 30,
    formNumber: "CL-AR",
    agency: "Texas OCCC",
    dependsOnId: null,
  },
  {
    id: "cl-background-recheck",
    name: "Background Re-check",
    description: "Biennial re-verification of officer and control-person backgrounds.",
    licenseTypeId: "consumer-lending",
    stateCode: null,
    cadenceId: "cadence-biennial",
    dueMonthDay: null,
    graceDays: 45,
    formNumber: "BGC-2",
    agency: null,
    dependsOnId: null,
  },
  {
    id: "dc-license-renewal",
    name: "Debt Collection License Renewal",
    description: "Biennial renewal of the debt collection license.",
    licenseTypeId: "debt-collection",
    stateCode: "NY",
    cadenceId: "cadence-biennial",
    dueMonthDay: "06-30",
    graceDays: 30,
    formNumber: "DC-REN",
    agency: "NY Department of Financial Services",
    dependsOnId: null,
  },
  {
    id: "dc-compliance-filing",
    name: "Debt Collection Compliance Filing",
    description: "One-off compliance attestation filed after a license renewal; no recurring cadence.",
    licenseTypeId: "debt-collection",
    stateCode: null,
    cadenceId: null,
    dueMonthDay: null,
    graceDays: null,
    formNumber: "DC-COMP",
    agency: null,
    dependsOnId: "dc-license-renewal",
  },
];

interface EntitySeed {
  id: string;
  name: string;
  kind: string;
  operatesIn: string[];
  holds: { licenseTypeId: string; since: string; lastFiledAt: string | null }[];
}

/**
 * A date `months` before today, as YYYY-MM-DD. Filing dates are seeded relative to seed time
 * rather than hardcoded, so the demo keeps showing a realistic mix of overdue and upcoming
 * obligations however long after the seed it is viewed — hardcoded dates silently turn every
 * obligation overdue once the calendar passes them.
 */
function monthsAgo(months: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  // Clamp the day so month-end dates stay valid in shorter months (31 Mar -> 28 Feb).
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return d.toISOString().slice(0, 10);
}

const entities: EntitySeed[] = [
  {
    id: "acme-money-transmitter-llc",
    name: "Acme Money Transmitter LLC",
    kind: "LLC",
    operatesIn: ["CA", "NY"],
    // Filed recently: mostly upcoming obligations, a few overdue.
    holds: [
      { licenseTypeId: "money-transmitter", since: monthsAgo(44), lastFiledAt: monthsAgo(2) },
    ],
  },
  {
    id: "lonestar-lending-corp",
    name: "Lonestar Lending Corp",
    kind: "CORP",
    operatesIn: ["TX", "NY"],
    holds: [
      // Lapsed on one licence and never filed on the other — the delinquent counterpart to Acme.
      { licenseTypeId: "consumer-lending", since: monthsAgo(50), lastFiledAt: monthsAgo(18) },
      { licenseTypeId: "debt-collection", since: monthsAgo(50), lastFiledAt: null },
    ],
  },
];

// --- runner ------------------------------------------------------------

function applySchema(): string[] {
  const raw = readFileSync(join(__dirname, "schema.cypher"), "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

export async function seed(): Promise<void> {
  const driver = getDriver();
  const session = driver.session();
  try {
    for (const stmt of applySchema()) {
      await session.run(stmt);
    }

    await session.executeWrite(async (tx) => {
      await tx.run(
        `UNWIND $rows AS row
         MERGE (n:State {code: row.code})
         ON CREATE SET n.id = row.code, n.name = row.name, n.createdAt = $now
         ON MATCH SET n.name = row.name`,
        { rows: states, now },
      );

      await tx.run(
        `UNWIND $rows AS row
         MERGE (n:LicenseType {id: row.id})
         ON CREATE SET n.name = row.name, n.category = row.category, n.createdAt = $now
         ON MATCH SET n.name = row.name, n.category = row.category`,
        { rows: licenseTypes, now },
      );

      await tx.run(
        `UNWIND $rows AS row
         MERGE (n:Cadence {id: row.id})
         ON CREATE SET n.intervalMonths = row.intervalMonths, n.label = row.label, n.createdAt = $now
         ON MATCH SET n.intervalMonths = row.intervalMonths, n.label = row.label`,
        { rows: cadences, now },
      );

      await tx.run(
        `UNWIND $rows AS row
         MERGE (n:Requirement {id: row.id})
         ON CREATE SET n.name = row.name, n.description = row.description, n.formNumber = row.formNumber,
                        n.agency = row.agency, n.dueMonthDay = row.dueMonthDay, n.graceDays = row.graceDays,
                        n.source = row.source, n.createdAt = $now
         ON MATCH SET n.name = row.name, n.description = row.description, n.formNumber = row.formNumber,
                       n.agency = row.agency, n.dueMonthDay = row.dueMonthDay, n.graceDays = row.graceDays,
                       n.source = row.source`,
        { rows: requirements.map((r) => ({ ...r, source: null })), now },
      );

      await tx.run(
        `UNWIND $rows AS row
         MERGE (n:Entity {id: row.id})
         ON CREATE SET n.name = row.name, n.kind = row.kind, n.createdAt = $now
         ON MATCH SET n.name = row.name, n.kind = row.kind`,
        { rows: entities, now },
      );

      await tx.run(
        `UNWIND $rows AS row
         MATCH (lt:LicenseType {id: row.licenseTypeId}), (s:State {code: row.stateCode})
         MERGE (lt)-[:AVAILABLE_IN]->(s)`,
        { rows: availableIn },
      );

      await tx.run(
        `UNWIND $rows AS row
         MATCH (lt:LicenseType {id: row.licenseTypeId}), (req:Requirement {id: row.id})
         MERGE (lt)-[:REQUIRES]->(req)`,
        { rows: requirements },
      );

      await tx.run(
        `UNWIND $rows AS row
         MATCH (req:Requirement {id: row.id}), (s:State {code: row.stateCode})
         MERGE (req)-[:IN_STATE]->(s)`,
        { rows: requirements.filter((r) => r.stateCode !== null) },
      );

      await tx.run(
        `UNWIND $rows AS row
         MATCH (req:Requirement {id: row.id}), (c:Cadence {id: row.cadenceId})
         MERGE (req)-[:RENEWS_EVERY]->(c)`,
        { rows: requirements.filter((r) => r.cadenceId !== null) },
      );

      await tx.run(
        `UNWIND $rows AS row
         MATCH (req:Requirement {id: row.id}), (dep:Requirement {id: row.dependsOnId})
         MERGE (req)-[:DEPENDS_ON]->(dep)`,
        { rows: requirements.filter((r) => r.dependsOnId !== null) },
      );

      const operatesIn = entities.flatMap((e) => e.operatesIn.map((stateCode) => ({ entityId: e.id, stateCode })));
      await tx.run(
        `UNWIND $rows AS row
         MATCH (e:Entity {id: row.entityId}), (s:State {code: row.stateCode})
         MERGE (e)-[:OPERATES_IN]->(s)`,
        { rows: operatesIn },
      );

      const holds = entities.flatMap((e) =>
        e.holds.map((h) => ({ entityId: e.id, licenseTypeId: h.licenseTypeId, since: h.since, lastFiledAt: h.lastFiledAt })),
      );
      await tx.run(
        `UNWIND $rows AS row
         MATCH (e:Entity {id: row.entityId}), (lt:LicenseType {id: row.licenseTypeId})
         MERGE (e)-[rel:HOLDS]->(lt)
         ON CREATE SET rel.since = row.since, rel.lastFiledAt = row.lastFiledAt
         ON MATCH SET rel.since = row.since, rel.lastFiledAt = row.lastFiledAt`,
        { rows: holds },
      );
    });

    console.log(
      `seeded ${states.length} states, ${licenseTypes.length} license types, ${requirements.length} requirements, ${entities.length} entities`,
    );
  } finally {
    await session.close();
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seed()
    .then(() => closeDriver())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("seed failed:", err);
      process.exit(1);
    });
}
