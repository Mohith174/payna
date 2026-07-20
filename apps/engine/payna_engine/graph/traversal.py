"""Filing-obligation traversal over the Neo4j context graph.

Two implementations of the *same* multi-hop retrieval:

* ``obligations_single_query`` — one Cypher statement that walks
  Entity -> HOLDS -> LicenseType -> REQUIRES -> Requirement and collects
  cadence / jurisdiction / dependency context in a single round trip.
* ``obligations_naive`` — the same result assembled with per-hop queries
  (one for the entity's licenses+states, then one per license/state to fetch
  requirements, then one per requirement for cadence and dependencies). This is
  the N+1 pattern the single query replaces.

``benchmark.py`` times the two to measure the latency reduction.
"""

from __future__ import annotations

from neo4j import Driver

from payna_engine.domain import FilingObligation
from payna_engine.graph.deadlines import DeadlineInputs, compute_deadline

_SINGLE_QUERY = """
MATCH (e:Entity {id: $entityId})-[holds:HOLDS]->(lt:LicenseType)-[:REQUIRES]->(req:Requirement)
MATCH (e)-[:OPERATES_IN]->(opState:State)
OPTIONAL MATCH (req)-[:IN_STATE]->(reqState:State)
WITH e, holds, lt, req, opState, reqState
WHERE reqState IS NULL OR reqState = opState
OPTIONAL MATCH (req)-[:RENEWS_EVERY]->(cad:Cadence)
OPTIONAL MATCH (req)-[:DEPENDS_ON]->(dep:Requirement)
WITH holds, lt, req, opState, cad, collect(DISTINCT dep.name) AS deps
RETURN
  req.id AS reqId, req.name AS reqName, req.dueMonthDay AS dueMonthDay, req.graceDays AS graceDays,
  lt.name AS licenseType, opState.code AS stateCode,
  cad.intervalMonths AS intervalMonths,
  holds.since AS since, holds.lastFiledAt AS lastFiledAt,
  deps AS dependsOn
"""


def _as_int(v) -> int | None:
    # Neo4j numeric properties can surface as float; deadline math needs ints.
    return int(v) if v is not None else None


def _to_obligation(row: dict) -> FilingObligation:
    interval_months = _as_int(row.get("intervalMonths"))
    d = compute_deadline(
        DeadlineInputs(
            since=row["since"],
            last_filed_at=row.get("lastFiledAt"),
            interval_months=interval_months,
            due_month_day=row.get("dueMonthDay"),
            grace_days=_as_int(row.get("graceDays")),
        )
    )
    return FilingObligation(
        requirement_id=row["reqId"],
        requirement_name=row["reqName"],
        license_type=row["licenseType"],
        state_code=row["stateCode"],
        interval_months=interval_months,
        next_due_date=d.next_due_date,
        status=d.status,
        depends_on=[x for x in (row.get("dependsOn") or []) if x],
    )


_STATUS_ORDER = {"overdue": 0, "due_soon": 1, "upcoming": 2, "no_deadline": 3}


def _sorted(obligations: list[FilingObligation]) -> list[FilingObligation]:
    return sorted(
        obligations,
        key=lambda o: (_STATUS_ORDER[o.status], o.next_due_date or "9999-99-99", o.requirement_name),
    )


def obligations_single_query(driver: Driver, entity_id: str) -> list[FilingObligation]:
    with driver.session() as session:
        rows = [r.data() for r in session.run(_SINGLE_QUERY, entityId=entity_id)]
    return _sorted([_to_obligation(r) for r in rows])


def obligations_naive(driver: Driver, entity_id: str) -> list[FilingObligation]:
    """Same result, assembled hop-by-hop with separate round trips."""
    with driver.session() as session:
        base = session.run(
            """
            MATCH (e:Entity {id: $entityId})-[holds:HOLDS]->(lt:LicenseType)
            MATCH (e)-[:OPERATES_IN]->(s:State)
            RETURN lt.name AS licenseType, s.code AS stateCode,
                   holds.since AS since, holds.lastFiledAt AS lastFiledAt
            """,
            entityId=entity_id,
        )
        license_state_pairs = [r.data() for r in base]

        results: list[FilingObligation] = []
        for pair in license_state_pairs:
            reqs = session.run(
                """
                MATCH (lt:LicenseType {name: $licenseType})-[:REQUIRES]->(req:Requirement)
                OPTIONAL MATCH (req)-[:IN_STATE]->(reqState:State)
                WITH req, reqState
                WHERE reqState IS NULL OR reqState.code = $stateCode
                RETURN req.id AS reqId, req.name AS reqName,
                       req.dueMonthDay AS dueMonthDay, req.graceDays AS graceDays
                """,
                licenseType=pair["licenseType"],
                stateCode=pair["stateCode"],
            )
            for req in [r.data() for r in reqs]:
                cad = session.run(
                    "MATCH (req:Requirement {id: $reqId})-[:RENEWS_EVERY]->(c:Cadence) "
                    "RETURN c.intervalMonths AS intervalMonths",
                    reqId=req["reqId"],
                ).single()
                deps = session.run(
                    "MATCH (req:Requirement {id: $reqId})-[:DEPENDS_ON]->(d:Requirement) "
                    "RETURN collect(d.name) AS deps",
                    reqId=req["reqId"],
                ).single()
                results.append(
                    _to_obligation(
                        {
                            **req,
                            "licenseType": pair["licenseType"],
                            "stateCode": pair["stateCode"],
                            "since": pair["since"],
                            "lastFiledAt": pair["lastFiledAt"],
                            "intervalMonths": cad["intervalMonths"] if cad else None,
                            "dependsOn": deps["deps"] if deps else [],
                        }
                    )
                )
    return _sorted(results)
