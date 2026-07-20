"""Scaled seed: grow the context graph to >=500 regulatory nodes.

Deterministic and idempotent (MERGE-only), so re-running converges instead of
duplicating. Generates States, LicenseTypes, Cadences, Requirements (with
IN_STATE / RENEWS_EVERY / DEPENDS_ON edges), and Entities (OPERATES_IN / HOLDS),
then reports the realized node count.

Run:  python -m payna_engine.seed --requirements 430 --entities 40
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone

from payna_engine.db.neo4j_db import close_driver, get_driver

_STATES = [
    ("CA", "California"), ("NY", "New York"), ("TX", "Texas"), ("FL", "Florida"),
    ("IL", "Illinois"), ("WA", "Washington"), ("MA", "Massachusetts"), ("GA", "Georgia"),
    ("PA", "Pennsylvania"), ("OH", "Ohio"), ("MI", "Michigan"), ("NC", "North Carolina"),
    ("NJ", "New Jersey"), ("VA", "Virginia"), ("AZ", "Arizona"), ("CO", "Colorado"),
    ("TN", "Tennessee"), ("IN", "Indiana"), ("MO", "Missouri"), ("MD", "Maryland"),
    ("WI", "Wisconsin"), ("MN", "Minnesota"), ("NV", "Nevada"), ("OR", "Oregon"),
    ("CT", "Connecticut"),
]

_LICENSE_TYPES = [
    ("money-transmitter", "Money Transmitter License", "Money Services"),
    ("consumer-lending", "Consumer Lending License", "Lending"),
    ("debt-collection", "Debt Collection License", "Collections"),
    ("mortgage-broker", "Mortgage Broker License", "Lending"),
    ("payday-lender", "Payday Lender License", "Lending"),
    ("check-casher", "Check Casher License", "Money Services"),
    ("currency-exchange", "Currency Exchange License", "Money Services"),
    ("sales-finance", "Sales Finance License", "Lending"),
    ("title-lender", "Title Lender License", "Lending"),
    ("collection-agency", "Collection Agency License", "Collections"),
    ("virtual-currency", "Virtual Currency License", "Money Services"),
    ("escrow-agent", "Escrow Agent License", "Money Services"),
]

_CADENCES = [(3, "Quarterly"), (6, "Semiannual"), (12, "Annual"), (24, "Biennial")]

_REQ_TEMPLATES = [
    "Annual Report", "Quarterly Call Report", "License Renewal", "Surety Bond Renewal",
    "Compliance Attestation", "Financial Statement Filing", "Background Re-check",
    "Net Worth Certification", "Transaction Volume Report", "Consumer Complaint Summary",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_scaled(requirements: int = 430, entities: int = 40) -> dict:
    driver = get_driver()
    now = _now()

    # Build requirement rows deterministically across license types and states.
    req_rows = []
    i = 0
    while len(req_rows) < requirements:
        lt = _LICENSE_TYPES[i % len(_LICENSE_TYPES)]
        state = _STATES[i % len(_STATES)]
        template = _REQ_TEMPLATES[i % len(_REQ_TEMPLATES)]
        cadence = _CADENCES[i % len(_CADENCES)]
        rid = f"req-{i:04d}"
        req_rows.append(
            {
                "id": rid,
                "name": f"{template} #{i:04d}",
                "description": f"{template} for {lt[1]} in {state[1]}.",
                "licenseTypeId": lt[0],
                "stateCode": state[0] if i % 3 != 0 else None,  # ~1/3 apply everywhere
                "intervalMonths": cadence[0],
                "cadenceLabel": cadence[1],
                "dueMonthDay": f"{(i % 12) + 1:02d}-15" if i % 4 == 0 else None,
                "graceDays": (i % 3) * 15,
                # chain every 5th requirement onto the previous one
                "dependsOnId": f"req-{i - 1:04d}" if i % 5 == 0 and i > 0 else None,
            }
        )
        i += 1

    entity_rows = []
    kinds = ["LLC", "CORP", "PARTNERSHIP", "SOLE_PROP"]
    for n in range(entities):
        lt_a = _LICENSE_TYPES[n % len(_LICENSE_TYPES)]
        lt_b = _LICENSE_TYPES[(n + 3) % len(_LICENSE_TYPES)]
        st_a = _STATES[n % len(_STATES)]
        st_b = _STATES[(n + 5) % len(_STATES)]
        entity_rows.append(
            {
                "id": f"entity-{n:03d}",
                "name": f"Regulated Entity {n:03d} {kinds[n % 4].title()}",
                "kind": kinds[n % 4],
                "operatesIn": sorted({st_a[0], st_b[0]}),
                "holds": [
                    {"licenseTypeId": lt_a[0], "since": "2022-01-10", "lastFiledAt": "2024-06-01"},
                    {"licenseTypeId": lt_b[0], "since": "2023-03-15", "lastFiledAt": None},
                ],
            }
        )

    with driver.session() as session:
        session.run(
            "CREATE CONSTRAINT state_code_unique IF NOT EXISTS FOR (s:State) REQUIRE s.code IS UNIQUE"
        )
        session.run(
            "CREATE CONSTRAINT license_type_id_unique IF NOT EXISTS FOR (l:LicenseType) REQUIRE l.id IS UNIQUE"
        )
        session.run(
            "CREATE CONSTRAINT requirement_id_unique IF NOT EXISTS FOR (r:Requirement) REQUIRE r.id IS UNIQUE"
        )
        session.run("CREATE CONSTRAINT entity_id_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE")
        session.run("CREATE CONSTRAINT cadence_id_unique IF NOT EXISTS FOR (c:Cadence) REQUIRE c.id IS UNIQUE")

        def _write(tx):
            tx.run(
                """UNWIND $rows AS row
                   MERGE (n:State {code: row.code})
                   ON CREATE SET n.id = row.code, n.name = row.name, n.createdAt = $now
                   ON MATCH SET n.name = row.name""",
                rows=[{"code": c, "name": n} for c, n in _STATES],
                now=now,
            )
            tx.run(
                """UNWIND $rows AS row
                   MERGE (n:LicenseType {id: row.id})
                   ON CREATE SET n.name = row.name, n.category = row.category, n.createdAt = $now
                   ON MATCH SET n.name = row.name, n.category = row.category""",
                rows=[{"id": i, "name": n, "category": c} for i, n, c in _LICENSE_TYPES],
                now=now,
            )
            tx.run(
                """UNWIND $rows AS row
                   MERGE (n:Cadence {intervalMonths: row.intervalMonths})
                   ON CREATE SET n.id = row.id, n.label = row.label, n.createdAt = $now""",
                rows=[{"id": f"cadence-{m}mo", "intervalMonths": m, "label": lbl} for m, lbl in _CADENCES],
                now=now,
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (lt:LicenseType {id: row.licenseTypeId}), (s:State {code: row.stateCode})
                   MERGE (lt)-[:AVAILABLE_IN]->(s)""",
                rows=[{"licenseTypeId": lt[0], "stateCode": s[0]} for lt in _LICENSE_TYPES for s in _STATES],
            )
            tx.run(
                """UNWIND $rows AS row
                   MERGE (n:Requirement {id: row.id})
                   ON CREATE SET n.name = row.name, n.description = row.description,
                                 n.dueMonthDay = row.dueMonthDay, n.graceDays = row.graceDays, n.createdAt = $now
                   ON MATCH SET n.name = row.name, n.description = row.description,
                                n.dueMonthDay = row.dueMonthDay, n.graceDays = row.graceDays""",
                rows=req_rows,
                now=now,
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (lt:LicenseType {id: row.licenseTypeId}), (req:Requirement {id: row.id})
                   MERGE (lt)-[:REQUIRES]->(req)""",
                rows=req_rows,
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (req:Requirement {id: row.id}), (s:State {code: row.stateCode})
                   MERGE (req)-[:IN_STATE]->(s)""",
                rows=[r for r in req_rows if r["stateCode"]],
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (req:Requirement {id: row.id}), (c:Cadence {intervalMonths: row.intervalMonths})
                   MERGE (req)-[:RENEWS_EVERY]->(c)""",
                rows=req_rows,
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (req:Requirement {id: row.id}), (dep:Requirement {id: row.dependsOnId})
                   MERGE (req)-[:DEPENDS_ON]->(dep)""",
                rows=[r for r in req_rows if r["dependsOnId"]],
            )
            tx.run(
                """UNWIND $rows AS row
                   MERGE (n:Entity {id: row.id})
                   ON CREATE SET n.name = row.name, n.kind = row.kind, n.createdAt = $now
                   ON MATCH SET n.name = row.name, n.kind = row.kind""",
                rows=entity_rows,
                now=now,
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (e:Entity {id: row.entityId}), (s:State {code: row.stateCode})
                   MERGE (e)-[:OPERATES_IN]->(s)""",
                rows=[{"entityId": e["id"], "stateCode": sc} for e in entity_rows for sc in e["operatesIn"]],
            )
            tx.run(
                """UNWIND $rows AS row
                   MATCH (e:Entity {id: row.entityId}), (lt:LicenseType {id: row.licenseTypeId})
                   MERGE (e)-[rel:HOLDS]->(lt)
                   ON CREATE SET rel.since = row.since, rel.lastFiledAt = row.lastFiledAt""",
                rows=[
                    {"entityId": e["id"], "licenseTypeId": h["licenseTypeId"], "since": h["since"], "lastFiledAt": h["lastFiledAt"]}
                    for e in entity_rows
                    for h in e["holds"]
                ],
            )

        session.execute_write(_write)

        counts = session.run(
            """
            OPTIONAL MATCH (s:State) WITH count(s) AS states
            OPTIONAL MATCH (l:LicenseType) WITH states, count(l) AS licenseTypes
            OPTIONAL MATCH (r:Requirement) WITH states, licenseTypes, count(r) AS requirements
            OPTIONAL MATCH (e:Entity) WITH states, licenseTypes, requirements, count(e) AS entities
            OPTIONAL MATCH (c:Cadence)
            RETURN states, licenseTypes, requirements, entities, count(c) AS cadences
            """
        ).single()

    viz_nodes = counts["states"] + counts["licenseTypes"] + counts["requirements"] + counts["entities"]
    result = {
        "states": counts["states"],
        "licenseTypes": counts["licenseTypes"],
        "requirements": counts["requirements"],
        "entities": counts["entities"],
        "cadences": counts["cadences"],
        "vizNodes": viz_nodes,
        "totalNodes": viz_nodes + counts["cadences"],
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requirements", type=int, default=430)
    parser.add_argument("--entities", type=int, default=40)
    args = parser.parse_args()
    try:
        result = seed_scaled(args.requirements, args.entities)
        print("seeded:", result)
        print(f"  -> {result['vizNodes']} dashboard-visible nodes "
              f"({result['totalNodes']} including cadences)")
    finally:
        close_driver()


if __name__ == "__main__":
    main()
