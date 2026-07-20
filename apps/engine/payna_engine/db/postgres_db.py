"""Postgres connection pool + schema bootstrap.

Reuses the same database (and the same audit_log / extraction_attempts tables)
as the TypeScript server, so the two backends share one audit trail.
"""

from __future__ import annotations

from psycopg_pool import ConnectionPool

from payna_engine.config import get_settings

_pool: ConnectionPool | None = None

# Idempotent — safe whether or not the TS migrations already created the tables.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor text,
  action text,
  subject_type text,
  subject_id text,
  detail jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extraction_attempts (
  id bigserial PRIMARY KEY,
  document_name text,
  document_sha256 text,
  model text,
  status text CHECK (status IN ('pending', 'succeeded', 'failed', 'rejected')),
  raw_response jsonb,
  validated jsonb,
  error text,
  attempt_no int,
  created_at timestamptz DEFAULT now()
);
"""


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        s = get_settings()
        _pool = ConnectionPool(conninfo=s.database_url, min_size=1, max_size=8, open=True)
    return _pool


def ensure_schema() -> None:
    with get_pool().connection() as conn:
        conn.execute(_SCHEMA)
        conn.commit()


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
