import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { GraphPanel } from "../components/GraphPanel";
import { StatusBadge } from "../components/StatusBadge";
import { fetchEntity, fetchEntityGraph, fetchEntityRequirements } from "../lib/api";

export function EntityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const entityId = id ?? "";

  const entityQuery = useQuery({ queryKey: ["entity", entityId], queryFn: () => fetchEntity(entityId), enabled: !!entityId });
  const obligationsQuery = useQuery({
    queryKey: ["entity-requirements", entityId],
    queryFn: () => fetchEntityRequirements(entityId),
    enabled: !!entityId,
  });
  const graphQuery = useQuery({
    queryKey: ["entity-graph", entityId],
    queryFn: () => fetchEntityGraph(entityId),
    enabled: !!entityId,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/" className="text-sm text-sky-600 hover:underline">
        ← All entities
      </Link>

      {entityQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {entityQuery.isError && (
        <p className="mt-4 text-sm text-red-600">Failed to load entity: {(entityQuery.error as Error).message}</p>
      )}
      {entityQuery.data && (
        <div className="mt-2">
          <h1 className="text-2xl font-semibold text-slate-900">{entityQuery.data.name}</h1>
          <p className="text-sm text-slate-500">{entityQuery.data.kind}</p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-medium text-slate-900">Obligations</h2>
        {obligationsQuery.isLoading && <p className="mt-2 text-sm text-slate-500">Loading obligations…</p>}
        {obligationsQuery.isError && (
          <p className="mt-2 text-sm text-red-600">Failed to load obligations: {(obligationsQuery.error as Error).message}</p>
        )}
        {obligationsQuery.data && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Requirement</th>
                  <th className="px-4 py-2">License</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2">Cadence</th>
                  <th className="px-4 py-2">Next due</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {obligationsQuery.data.map((o) => (
                  <tr key={o.requirement.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{o.requirement.name}</div>
                      {o.dependsOn.length > 0 && (
                        <div className="text-xs text-slate-400">depends on {o.dependsOn.map((d) => d.name).join(", ")}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{o.licenseType.name}</td>
                    <td className="px-4 py-2 text-slate-600">{o.state.code}</td>
                    <td className="px-4 py-2 text-slate-600">{o.cadence?.label ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{o.nextDueDate ?? "—"}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
                {obligationsQuery.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      No obligations for this entity.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-slate-900">Graph</h2>
        {graphQuery.isLoading && <p className="mt-2 text-sm text-slate-500">Loading graph…</p>}
        {graphQuery.isError && (
          <p className="mt-2 text-sm text-red-600">Failed to load graph: {(graphQuery.error as Error).message}</p>
        )}
        {graphQuery.data && (
          <div className="mt-3">
            <GraphPanel graph={graphQuery.data} />
          </div>
        )}
      </section>
    </div>
  );
}
