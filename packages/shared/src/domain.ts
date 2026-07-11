// Domain types mirroring the Neo4j graph schema (see docs/SPEC.md §2).
// All graph nodes carry `id` (uuid or natural key) and `createdAt` (ISO date string).

export interface GraphNode {
  id: string;
  createdAt: string;
}

export interface State extends GraphNode {
  code: string; // natural key, e.g. "CA"
  name: string;
}

export interface LicenseType extends GraphNode {
  name: string;
  category: string;
}

export interface Requirement extends GraphNode {
  name: string;
  description: string;
  formNumber?: string;
  agency?: string;
  dueMonthDay?: string; // "MM-DD"
  graceDays?: number;
  source?: string;
}

export type EntityKind = "LLC" | "CORP" | "PARTNERSHIP" | "SOLE_PROP";

export interface Entity extends GraphNode {
  name: string;
  kind: EntityKind;
}

export interface Cadence extends GraphNode {
  intervalMonths: number;
  label: string;
}

export type ObligationStatus = "overdue" | "due_soon" | "upcoming" | "no_deadline";

export interface FilingObligation {
  requirement: Requirement;
  licenseType: { id: string; name: string };
  state: { code: string; name: string };
  cadence: { intervalMonths: number; label: string } | null;
  dependsOn: { id: string; name: string }[];
  nextDueDate: string | null; // ISO date
  status: ObligationStatus;
}
