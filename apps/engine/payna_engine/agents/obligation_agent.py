"""Filing-obligation agent: persist accepted requirements, then traverse.

Writes the validated records into the Neo4j context graph and runs the
single-query multi-hop Cypher traversal to compute current filing obligations
for every entity — the deadline-bearing answer the product exists to give.
"""

from __future__ import annotations

from payna_engine.agents.state import WorkflowState
from payna_engine.db.audit import audit_agent_action
from payna_engine.db.neo4j_db import get_driver
from payna_engine.domain import ExtractedRequirement
from payna_engine.graph.traversal import obligations_single_query
from payna_engine.graph.upsert import upsert_requirements

_ALL_ENTITIES = "MATCH (e:Entity) RETURN e.id AS id ORDER BY e.id"


async def obligation_agent(state: WorkflowState) -> WorkflowState:
    name = state["document_name"]
    accepted = [ExtractedRequirement.model_validate(r) for r in state.get("accepted", [])]
    audit_agent_action("obligation", "start", name, {"toUpsert": len(accepted)})

    driver = get_driver()
    upserted = upsert_requirements(driver, accepted, source=name)

    with driver.session() as session:
        entity_ids = [r["id"] for r in session.run(_ALL_ENTITIES)]

    obligations: list[dict] = []
    for eid in entity_ids:
        for ob in obligations_single_query(driver, eid):
            obligations.append({"entityId": eid, **ob.model_dump()})

    audit_agent_action("obligation", "computed", name, {"upserted": upserted, "obligations": len(obligations)})
    return {"upserted": upserted, "obligations": obligations}
