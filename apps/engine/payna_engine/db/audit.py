"""Audit logging.

The agent workflow calls ``audit_agent_action`` around *every* agent node, so
each step of a run leaves a durable row in Postgres. Best-effort by design: an
audit write must never fail the user-facing extraction request.
"""

from __future__ import annotations

import json
from typing import Any

from payna_engine.db.postgres_db import get_pool


def write_audit_log(
    actor: str,
    action: str,
    subject_type: str,
    subject_id: str,
    detail: Any | None = None,
) -> None:
    try:
        with get_pool().connection() as conn:
            conn.execute(
                "INSERT INTO audit_log (actor, action, subject_type, subject_id, detail) "
                "VALUES (%s, %s, %s, %s, %s)",
                (actor, action, subject_type, subject_id, json.dumps(detail) if detail is not None else None),
            )
            conn.commit()
    except Exception as err:  # noqa: BLE001 — logging must not break the request
        print(f"audit_log write failed: {err}")


def audit_agent_action(agent: str, phase: str, document_name: str, detail: Any | None = None) -> None:
    """Record one agent action. ``phase`` is 'start' or a result summary."""
    write_audit_log(
        actor=f"agent:{agent}",
        action=f"{agent}.{phase}",
        subject_type="Document",
        subject_id=document_name,
        detail=detail,
    )
