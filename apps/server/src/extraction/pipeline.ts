import { createHash } from "node:crypto";
import { ExtractedRequirementSchema, type ExtractedRequirement } from "@payna/shared";
import { config } from "../config.js";
import { getPool } from "../db/postgres.js";
import { callLlm, isRetryableLlmError } from "./llm.js";
import { mockExtraction } from "./mock.js";
import { UnparseableResponseError, extractFirstJsonArray } from "./parse.js";
import { upsertExtractedRequirements } from "./upsert.js";

const BACKOFF_BASE_MS = 1000;
const BACKOFF_FACTOR = 2;
const MAX_ATTEMPTS = 3;

export interface RejectedRecord {
  record: unknown;
  issues: string[];
}

export interface ExtractionResult {
  attemptId: number;
  accepted: number;
  rejected: RejectedRecord[];
}

export class ExtractionUnconfiguredError extends Error {
  constructor() {
    super("No LLM_API_KEY configured and MOCK_EXTRACTION is not enabled");
    this.name = "ExtractionUnconfiguredError";
  }
}

export class ExtractionFailedError extends Error {
  attemptId: number;
  constructor(message: string, attemptId: number) {
    super(message);
    this.name = "ExtractionFailedError";
    this.attemptId = attemptId;
  }
}

type AttemptStatus = "pending" | "succeeded" | "failed" | "rejected";

async function insertAttempt(row: {
  documentName: string;
  documentSha256: string;
  model: string;
  status: AttemptStatus;
  rawResponse: unknown;
  validated: unknown;
  error: string | null;
  attemptNo: number;
}): Promise<number> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO extraction_attempts
       (document_name, document_sha256, model, status, raw_response, validated, error, attempt_no)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      row.documentName,
      row.documentSha256,
      row.model,
      row.status,
      row.rawResponse === null ? null : JSON.stringify(row.rawResponse),
      row.validated === null ? null : JSON.stringify(row.validated),
      row.error,
      row.attemptNo,
    ],
  );
  return Number(result.rows[0].id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attemptNo: number): number {
  // base 1s, factor 2, full jitter in [0.5x, 1.5x] so concurrent retries don't align.
  const base = BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attemptNo - 1);
  return Math.round(base * (0.5 + Math.random()));
}

function validateRecords(rawRecords: unknown[]): { accepted: ExtractedRequirement[]; rejected: RejectedRecord[] } {
  const accepted: ExtractedRequirement[] = [];
  const rejected: RejectedRecord[] = [];
  for (const record of rawRecords) {
    const result = ExtractedRequirementSchema.safeParse(record);
    if (result.success) {
      accepted.push(result.data);
    } else {
      // A record failing zod is rejected, never patched (docs/SPEC.md §5).
      rejected.push({ record, issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
  }
  return { accepted, rejected };
}

/**
 * Full extraction flow (docs/SPEC.md §5): LLM (or mock) -> defensive parse ->
 * per-record zod validation -> extraction_attempts row per outcome -> graph
 * upsert of accepted records. Retries (429/5xx/network/unparseable) each log a
 * new attempt row with an incremented attempt_no.
 */
export async function runExtraction(documentName: string, text: string): Promise<ExtractionResult> {
  const documentSha256 = createHash("sha256").update(text).digest("hex");

  const useMock = config.LLM_API_KEY === "" && config.MOCK_EXTRACTION;
  if (config.LLM_API_KEY === "" && !config.MOCK_EXTRACTION) {
    throw new ExtractionUnconfiguredError();
  }
  const model = useMock ? "mock" : config.LLM_MODEL;

  let rawRecords: unknown[] | null = null;
  let rawResponse: unknown = null;
  let attemptNo = 0;
  let lastAttemptId = 0;

  while (rawRecords === null) {
    attemptNo++;
    try {
      if (useMock) {
        rawRecords = mockExtraction();
        rawResponse = { mock: true, records: rawRecords };
      } else {
        const responseText = await callLlm(text);
        rawResponse = { text: responseText };
        rawRecords = extractFirstJsonArray(responseText);
      }
    } catch (err) {
      const retryable = isRetryableLlmError(err) || err instanceof UnparseableResponseError;
      const message = err instanceof Error ? err.message : String(err);
      lastAttemptId = await insertAttempt({
        documentName,
        documentSha256,
        model,
        status: "failed",
        rawResponse,
        validated: null,
        error: message,
        attemptNo,
      });
      if (!retryable || attemptNo >= MAX_ATTEMPTS) {
        throw new ExtractionFailedError(
          `extraction failed after ${attemptNo} attempt(s): ${message}`,
          lastAttemptId,
        );
      }
      await sleep(backoffDelay(attemptNo));
      rawResponse = null;
    }
  }

  const { accepted, rejected } = validateRecords(rawRecords);

  // succeeded = at least one record made it into the graph (or the document
  // legitimately contained none); rejected = the model returned records but
  // every one failed validation.
  const status: AttemptStatus = rawRecords.length > 0 && accepted.length === 0 ? "rejected" : "succeeded";

  const attemptId = await insertAttempt({
    documentName,
    documentSha256,
    model,
    status,
    rawResponse,
    validated: { accepted, rejected },
    error: null,
    attemptNo,
  });

  if (accepted.length > 0) {
    await upsertExtractedRequirements(accepted, documentName);
  }

  return { attemptId, accepted: accepted.length, rejected };
}
