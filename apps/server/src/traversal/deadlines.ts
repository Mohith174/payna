// Pure date math for the traversal engine. No I/O — unit tested directly.

export interface DeadlineInputs {
  since: string; // ISO date "YYYY-MM-DD", when the license was first held
  lastFiledAt: string | null; // last filing date for this requirement, if any
  intervalMonths: number | null; // null = no recurring cadence
  dueMonthDay: string | null; // "MM-DD", snaps the computed date to a fixed calendar day
  graceDays: number | null;
}

export type ObligationStatus = "overdue" | "due_soon" | "upcoming" | "no_deadline";

export interface DeadlineResult {
  nextDueDate: string | null; // ISO date "YYYY-MM-DD"
  status: ObligationStatus;
}

const DUE_SOON_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" as a local-midnight Date, avoiding UTC-parsing offset bugs. */
function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Truncate a Date to local midnight, for day-granularity comparisons. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Add months to a date, clamping to the last day of the target month when the
 * source day-of-month doesn't exist there (e.g. Jan 31 + 1 month -> Feb 28, not
 * a rollover into March). This is the "month-end rollover" behavior under test.
 */
export function addMonths(date: Date, months: number): Date {
  const targetMonthIndex = date.getMonth() + months;
  const daysInTargetMonth = new Date(date.getFullYear(), targetMonthIndex + 1, 0).getDate();
  const day = Math.min(date.getDate(), daysInTargetMonth);
  return new Date(date.getFullYear(), targetMonthIndex, day);
}

/** Snap a date's month/day to a fixed "MM-DD", keeping the date's year. */
function snapToMonthDay(date: Date, monthDay: string): Date {
  const [month, day] = monthDay.split("-").map(Number);
  const daysInMonth = new Date(date.getFullYear(), month, 0).getDate();
  return new Date(date.getFullYear(), month - 1, Math.min(day, daysInMonth));
}

function computeStatus(nextDue: Date, graceDays: number, now: Date): ObligationStatus {
  const diffDays = Math.round((nextDue.getTime() - atMidnight(now).getTime()) / MS_PER_DAY);
  if (diffDays < -graceDays) return "overdue";
  if (diffDays <= DUE_SOON_WINDOW_DAYS) return "due_soon";
  return "upcoming";
}

export function computeDeadline(inputs: DeadlineInputs, now: Date = new Date()): DeadlineResult {
  if (inputs.intervalMonths === null) {
    return { nextDueDate: null, status: "no_deadline" };
  }

  const base = parseISODate(inputs.lastFiledAt ?? inputs.since);
  let nextDue = addMonths(base, inputs.intervalMonths);
  if (inputs.dueMonthDay) {
    nextDue = snapToMonthDay(nextDue, inputs.dueMonthDay);
  }

  const graceDays = inputs.graceDays ?? 0;
  return {
    nextDueDate: formatISODate(nextDue),
    status: computeStatus(nextDue, graceDays, now),
  };
}
