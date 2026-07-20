"""The multi-agent compliance workflow, as a LangGraph StateGraph.

    document -> [extraction] -> [validation] -> [obligation] -> obligations

Each node is an async agent; each agent writes audit rows around its own work
(see db/audit.audit_agent_action), so a run leaves a full trail in Postgres.
"""

from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, StateGraph

from payna_engine.agents.extraction_agent import extraction_agent
from payna_engine.agents.obligation_agent import obligation_agent
from payna_engine.agents.state import WorkflowState
from payna_engine.agents.validation_agent import validation_agent


def _build() -> "StateGraph":
    g = StateGraph(WorkflowState)
    g.add_node("extraction", extraction_agent)
    g.add_node("validation", validation_agent)
    g.add_node("obligation", obligation_agent)

    g.set_entry_point("extraction")
    # If extraction couldn't parse anything, skip straight to the end.
    g.add_conditional_edges(
        "extraction",
        lambda s: "validation" if s.get("raw_records") else END,
        {"validation": "validation", END: END},
    )
    g.add_edge("validation", "obligation")
    g.add_edge("obligation", END)
    return g


@lru_cache(maxsize=1)
def get_workflow():
    """Compiled workflow graph (built once)."""
    return _build().compile()


async def run_workflow(document_name: str, document_text: str) -> WorkflowState:
    result = await get_workflow().ainvoke(
        {"document_name": document_name, "document_text": document_text}
    )
    return result
