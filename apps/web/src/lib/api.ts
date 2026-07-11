import type { Entity, EntityGraph, FilingObligation } from "@payna/shared";

// Thin fetch wrapper around the server's /api routes (docs/SPEC.md §6, §8).
// Dev proxy in vite.config.ts forwards /api -> http://localhost:4000.

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // response wasn't JSON (e.g. proxy/network error) — fall through
    }
    throw new ApiRequestError(
      res.status,
      body?.error.code ?? "unknown_error",
      body?.error.message ?? `Request to ${path} failed with status ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export interface EntitySummary extends Entity {
  states: string[];
  licenseCount: number;
}

export function fetchEntities(): Promise<EntitySummary[]> {
  return request<EntitySummary[]>("/entities");
}

export function fetchEntity(id: string): Promise<Entity> {
  return request<Entity>(`/entities/${encodeURIComponent(id)}`);
}

export function fetchEntityRequirements(id: string): Promise<FilingObligation[]> {
  return request<FilingObligation[]>(`/entities/${encodeURIComponent(id)}/requirements`);
}

export function fetchEntityGraph(id: string): Promise<EntityGraph> {
  return request<EntityGraph>(`/entities/${encodeURIComponent(id)}/graph`);
}

export interface RejectedRecord {
  record: unknown;
  issues: string[];
}

export interface ExtractionResult {
  attemptId: number;
  accepted: number;
  rejected: RejectedRecord[];
}

export function submitExtractionText(text: string): Promise<ExtractionResult> {
  return request<ExtractionResult>("/extractions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function submitExtractionFile(file: File): Promise<ExtractionResult> {
  const formData = new FormData();
  formData.append("file", file);
  return request<ExtractionResult>("/extractions", { method: "POST", body: formData });
}

export interface ExtractionAttemptSummary {
  id: number;
  documentName: string;
  status: "pending" | "succeeded" | "failed" | "rejected";
  model: string;
  attemptNo: number;
  accepted: number;
  rejected: number;
  createdAt: string;
}

export function fetchRecentExtractions(): Promise<ExtractionAttemptSummary[]> {
  return request<ExtractionAttemptSummary[]>("/extractions");
}
