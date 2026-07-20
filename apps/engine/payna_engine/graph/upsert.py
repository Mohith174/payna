"""Write validated extraction records into the Neo4j graph.

Ported from apps/server/src/extraction/upsert.ts: requirement identity is
(name, state) via the IN_STATE edge, and DEPENDS_ON is wired in a second pass so
intra-batch forward references resolve.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from neo4j import Driver

from payna_engine.domain import ExtractedRequirement

_CADENCE_LABELS = {1: "Monthly", 3: "Quarterly", 6: "Semiannual", 12: "Annual", 24: "Biennial"}


def _cadence_label(months: int) -> str:
    return _CADENCE_LABELS.get(months, f"Every {months} months")


def upsert_requirements(driver: Driver, records: list[ExtractedRequirement], source: str) -> int:
    if not records:
        return 0
    now = datetime.now(timezone.utc).isoformat()

    with driver.session() as session:

        def _write(tx):
            for rec in records:
                tx.run(
                    """
                    MERGE (s:State {code: $stateCode})
                      ON CREATE SET s.id = $stateCode, s.name = $stateCode, s.createdAt = $now
                    MERGE (lt:LicenseType {name: $licenseTypeName})
                      ON CREATE SET lt.id = $licenseTypeId, lt.category = 'Extracted', lt.createdAt = $now
                    MERGE (req:Requirement {name: $name})-[:IN_STATE]->(s)
                      ON CREATE SET req.id = $requirementId, req.createdAt = $now
                    SET req.description = $description,
                        req.formNumber = $formNumber,
                        req.agency = $agency,
                        req.dueMonthDay = $dueMonthDay,
                        req.source = $source,
                        req.sourceUrl = $sourceUrl
                    MERGE (lt)-[:REQUIRES]->(req)
                    MERGE (lt)-[:AVAILABLE_IN]->(s)
                    """,
                    stateCode=rec.state_code,
                    licenseTypeName=rec.license_type_name,
                    licenseTypeId=str(uuid.uuid4()),
                    name=rec.name,
                    requirementId=str(uuid.uuid4()),
                    description=rec.description,
                    formNumber=rec.form_number,
                    agency=rec.agency,
                    dueMonthDay=rec.due_month_day,
                    source=source,
                    sourceUrl=rec.source_url,
                    now=now,
                )
                if rec.interval_months is not None:
                    tx.run(
                        """
                        MATCH (req:Requirement {name: $name})-[:IN_STATE]->(:State {code: $stateCode})
                        MERGE (c:Cadence {intervalMonths: $intervalMonths})
                          ON CREATE SET c.id = $cadenceId, c.label = $label, c.createdAt = $now
                        MERGE (req)-[:RENEWS_EVERY]->(c)
                        """,
                        name=rec.name,
                        stateCode=rec.state_code,
                        intervalMonths=rec.interval_months,
                        cadenceId=f"cadence-{rec.interval_months}mo",
                        label=_cadence_label(rec.interval_months),
                        now=now,
                    )

            for rec in records:
                for dep_name in rec.depends_on_names:
                    tx.run(
                        """
                        MATCH (req:Requirement {name: $name})-[:IN_STATE]->(s:State {code: $stateCode})
                        OPTIONAL MATCH (sameState:Requirement {name: $depName})-[:IN_STATE]->(s)
                        OPTIONAL MATCH (anyState:Requirement {name: $depName})
                        WITH req, coalesce(sameState, anyState) AS dep
                        WHERE dep IS NOT NULL
                        WITH req, dep LIMIT 1
                        MERGE (req)-[:DEPENDS_ON]->(dep)
                        """,
                        name=rec.name,
                        stateCode=rec.state_code,
                        depName=dep_name,
                    )

        session.execute_write(_write)

    return len(records)
