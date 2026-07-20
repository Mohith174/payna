"""Deadline math — the Python port must match the TS unit tests, especially
month-end rollover clamping."""

from __future__ import annotations

from datetime import date

from payna_engine.graph.deadlines import DeadlineInputs, add_months, compute_deadline


def test_add_months_clamps_month_end():
    # Jan 31 + 1 month -> Feb 28 (non-leap), not a rollover into March.
    assert add_months(date(2025, 1, 31), 1) == date(2025, 2, 28)
    # Leap year.
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)


def test_add_months_crosses_year():
    assert add_months(date(2025, 11, 15), 3) == date(2026, 2, 15)


def test_no_cadence_is_no_deadline():
    r = compute_deadline(
        DeadlineInputs(since="2023-01-01", last_filed_at=None, interval_months=None, due_month_day=None, grace_days=None)
    )
    assert r.next_due_date is None
    assert r.status == "no_deadline"


def test_annual_from_last_filed_snaps_to_month_day():
    r = compute_deadline(
        DeadlineInputs(
            since="2020-01-01",
            last_filed_at="2024-06-10",
            interval_months=12,
            due_month_day="03-31",
            grace_days=30,
        ),
        now=date(2025, 1, 1),
    )
    assert r.next_due_date == "2025-03-31"
    assert r.status in {"due_soon", "upcoming"}


def test_overdue_beyond_grace():
    r = compute_deadline(
        DeadlineInputs(
            since="2020-01-01",
            last_filed_at="2020-01-01",
            interval_months=12,
            due_month_day=None,
            grace_days=10,
        ),
        now=date(2025, 1, 1),
    )
    assert r.status == "overdue"
