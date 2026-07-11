import { getPool } from "./postgres.js";

export interface AuditEntry {
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  detail?: unknown;
}

// Every Neo4j write from the API inserts an audit_log row, best-effort (docs/SPEC.md §3):
// a logging failure must never fail the user-facing request.
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO audit_log (actor, action, subject_type, subject_id, detail) VALUES ($1, $2, $3, $4, $5)`,
      [entry.actor, entry.action, entry.subjectType, entry.subjectId, entry.detail ? JSON.stringify(entry.detail) : null],
    );
  } catch (err) {
    console.error("audit_log write failed:", err);
  }
}
