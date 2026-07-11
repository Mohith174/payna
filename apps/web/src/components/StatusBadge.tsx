import type { ObligationStatus } from "@payna/shared";

const STATUS_STYLES: Record<ObligationStatus, string> = {
  overdue: "bg-red-100 text-red-800 border border-red-300",
  due_soon: "bg-amber-100 text-amber-800 border border-amber-300",
  upcoming: "bg-slate-100 text-slate-700 border border-slate-300",
  no_deadline: "bg-gray-100 text-gray-500 border border-gray-300",
};

const STATUS_LABELS: Record<ObligationStatus, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  upcoming: "Upcoming",
  no_deadline: "No deadline",
};

export function StatusBadge({ status }: { status: ObligationStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
