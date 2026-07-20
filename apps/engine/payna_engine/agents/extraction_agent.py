"""Document-extraction agent: unstructured document text -> raw requirement records.

Owns the single LLM round trip and the tolerant JSON parse. It does not judge
validity — that is the validation agent's job — so anything the model returns is
passed downstream as raw dicts.
"""

from __future__ import annotations

import json

from payna_engine.agents.state import WorkflowState
from payna_engine.db.audit import audit_agent_action
from payna_engine.llm import call_llm, extract_first_json_array


async def extraction_agent(state: WorkflowState) -> WorkflowState:
    name = state["document_name"]
    audit_agent_action("extraction", "start", name, {"chars": len(state["document_text"])})

    raw = call_llm(state["document_text"])
    try:
        records = json.loads(extract_first_json_array(raw))
        if not isinstance(records, list):
            raise ValueError("expected a JSON array")
    except (ValueError, json.JSONDecodeError) as err:
        audit_agent_action("extraction", "failed", name, {"error": str(err)})
        return {"raw_response": raw, "raw_records": [], "error": f"unparseable extraction: {err}"}

    audit_agent_action("extraction", "extracted", name, {"records": len(records)})
    return {"raw_response": raw, "raw_records": records}
