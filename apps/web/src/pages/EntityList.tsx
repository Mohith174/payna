import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { FilingObligation } from "@payna/shared";
import { fetchEntities, fetchEntityRequirements } from "../lib/api";

function ObligationCounts({ obligations }: { obligations: FilingObligation[] | undefined }) {
  if (!obligations) {
    return <span className="text-xs text-slate-400">loading…</span>;
  }
  const overdue = obligations.filter((o) => o.status === "overdue").length;
  const dueSoon = obligations.filter((o) => o.status === "due_soon").length;

  if (overdue === 0 && dueSoon === 0) {
    return <span className="text-xs text-slate-500">All caught up</span>;
  }
  return (
    <span className="flex gap-2 text-xs">
      {overdue > 0 && (
        <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 font-medium text-red-800">
          {overdue} overdue
        </span>
      )}
      {dueSoon > 0 && (
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          {dueSoon} due soon
        </span>
      )}
    </span>
  );
}

export function EntityListPage() {
  const entitiesQuery = useQuery({ queryKey: ["entities"], queryFn: fetchEntities });
  const entities = entitiesQuery.data ?? [];

  const obligationQueries = useQueries({
    queries: entities.map((e) => ({
      queryKey: ["entity-requirements", e.id],
      queryFn: () => fetchEntityRequirements(e.id),
      enabled: entitiesQuery.isSuccess,
    })),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Entities</h1>
      <p className="mt-1 text-sm text-slate-500">Regulatory filing obligations at a glance.</p>

      {entitiesQuery.isLoading && <p className="mt-6 text-sm text-slate-500">Loading entities…</p>}
      {entitiesQuery.isError && (
        <p className="mt-6 text-sm text-red-600">Failed to load entities: {(entitiesQuery.error as Error).message}</p>
      )}

      {entitiesQuery.isSuccess && (
        <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {entities.map((entity, idx) => (
            <li key={entity.id}>
              <Link to={`/entities/${entity.id}`} className="flex items-center justify-between gap-4 px-4 py-4 hover:bg-slate-50">
                <div>
                  <div className="font-medium text-slate-900">{entity.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {entity.kind} · {entity.states.join(", ") || "no states"} · {entity.licenseCount} license
                    {entity.licenseCount === 1 ? "" : "s"}
                  </div>
                </div>
                <ObligationCounts obligations={obligationQueries[idx]?.data} />
              </Link>
            </li>
          ))}
          {entities.length === 0 && <li className="px-4 py-6 text-sm text-slate-500">No entities yet.</li>}
        </ul>
      )}
    </div>
  );
}
