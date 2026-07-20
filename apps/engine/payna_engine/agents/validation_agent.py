"""Validation agent: enforce the schema, then enrich via the MCP registry.

Each raw record is parsed through the ``ExtractedRequirement`` pydantic model —
records that fail become structured rejections rather than graph writes. Every
accepted record is then enriched by awaiting the ``lookup_agency`` MCP tool,
which supplies the authoritative regulator and filing-portal URL for the
requirement's (state, category). This is where MCP tools enter the workflow.
"""

from __future__ import annotations

from pydantic import ValidationError

from payna_engine.agents.state import WorkflowState
from payna_engine.db.audit import audit_agent_action
from payna_engine.domain import ExtractedRequirement
from payna_engine.mcp_tools.client import lookup_agency

# License-type name -> registry category. Substring match, first hit wins, so
# the more specific Collections hints precede the broader Lending/Money ones.
_CATEGORY_HINTS = [
    ("collection", "Collections"),
    ("debt", "Collections"),
    ("mortgage", "Lending"),
    ("lend", "Lending"),        # lending, lender
    ("loan", "Lending"),
    ("finance", "Lending"),     # consumer finance / sales finance
    ("credit", "Lending"),
    ("payday", "Lending"),
    ("title", "Lending"),
    ("transmitter", "Money Services"),
    ("money service", "Money Services"),
    ("money transmission", "Money Services"),
    ("currency", "Money Services"),
    ("check cash", "Money Services"),
    ("escrow", "Money Services"),
]


def _category_for(license_type_name: str) -> str:
    lower = license_type_name.lower()
    for hint, category in _CATEGORY_HINTS:
        if hint in lower:
            return category
    return "Money Services"


async def validation_agent(state: WorkflowState) -> WorkflowState:
    name = state["document_name"]
    audit_agent_action("validation", "start", name, {"candidates": len(state.get("raw_records", []))})

    accepted: list[dict] = []
    rejected: list[dict] = []

    for record in state.get("raw_records", []):
        try:
            req = ExtractedRequirement.model_validate(record)
        except ValidationError as err:
            rejected.append({"record": record, "issues": [e["msg"] for e in err.errors()]})
            continue

        # MCP enrichment from the external registry.
        try:
            registry = await lookup_agency(req.state_code, _category_for(req.license_type_name))
        except Exception as err:  # noqa: BLE001 — enrichment must not fail validation
            audit_agent_action("validation", "mcp_error", name, {"error": str(err)})
            registry = {}

        if registry.get("agency") and not req.agency:
            req.agency = registry["agency"]
        if registry.get("url"):
            req.source_url = registry["url"]

        accepted.append(req.model_dump(by_alias=True))

    audit_agent_action("validation", "validated", name, {"accepted": len(accepted), "rejected": len(rejected)})
    return {"accepted": accepted, "rejected": rejected}
