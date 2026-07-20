"""Pure date math for filing deadlines — a direct port of
apps/server/src/traversal/deadlines.ts, including month-end rollover clamping.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Literal, Optional

ObligationStatus = Literal["overdue", "due_soon", "upcoming", "no_deadline"]

DUE_SOON_WINDOW_DAYS = 30


@dataclass
class DeadlineInputs:
    since: str
    last_filed_at: Optional[str]
    interval_months: Optional[int]
    due_month_day: Optional[str]
    grace_days: Optional[int]


@dataclass
class DeadlineResult:
    next_due_date: Optional[str]
    status: ObligationStatus


def _parse_iso(iso: str) -> date:
    y, m, d = (int(p) for p in iso.split("-"))
    return date(y, m, d)


def add_months(d: date, months: int) -> date:
    """Add months, clamping to the last valid day of the target month."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    days_in_month = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, days_in_month))


def _snap_to_month_day(d: date, month_day: str) -> date:
    month, day = (int(p) for p in month_day.split("-"))
    days_in_month = calendar.monthrange(d.year, month)[1]
    return date(d.year, month, min(day, days_in_month))


def _status(next_due: date, grace_days: int, now: date) -> ObligationStatus:
    diff_days = (next_due - now).days
    if diff_days < -grace_days:
        return "overdue"
    if diff_days <= DUE_SOON_WINDOW_DAYS:
        return "due_soon"
    return "upcoming"


def compute_deadline(inputs: DeadlineInputs, now: Optional[date] = None) -> DeadlineResult:
    now = now or date.today()
    if inputs.interval_months is None:
        return DeadlineResult(next_due_date=None, status="no_deadline")

    base = _parse_iso(inputs.last_filed_at or inputs.since)
    next_due = add_months(base, inputs.interval_months)
    if inputs.due_month_day:
        next_due = _snap_to_month_day(next_due, inputs.due_month_day)

    grace = inputs.grace_days or 0
    return DeadlineResult(next_due_date=next_due.isoformat(), status=_status(next_due, grace, now))
