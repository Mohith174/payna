import type { EntityGraph } from "@payna/shared";

// The Python multi-agent engine (apps/engine) serves the whole-graph view the
// Graph Explorer renders. Configurable so the same build can point at a local
// engine or a deployed one; defaults to the local dev port.
export const ENGINE_BASE_URL =
  (import.meta.env.VITE_ENGINE_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:4100";

export interface EngineHealth {
  status: string;
  mock: boolean;
  model: string;
}

export async function fetchEngineHealth(): Promise<EngineHealth> {
  const res = await fetch(`${ENGINE_BASE_URL}/api/health`);
  if (!res.ok) throw new Error(`engine health ${res.status}`);
  return res.json();
}

export async function fetchFullGraph(limit = 600): Promise<EntityGraph> {
  const res = await fetch(`${ENGINE_BASE_URL}/api/graph?limit=${limit}`);
  if (!res.ok) throw new Error(`engine graph ${res.status}`);
  return res.json();
}
