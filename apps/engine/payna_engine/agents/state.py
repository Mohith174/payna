"""Shared state passed between the LangGraph agent nodes."""

from __future__ import annotations

from typing import Optional, TypedDict


class WorkflowState(TypedDict, total=False):
    document_name: str
    document_text: str

    # extraction agent output
    raw_response: str
    raw_records: list[dict]

    # validation agent output
    accepted: list[dict]  # ExtractedRequirement, model_dump(by_alias=True)
    rejected: list[dict]  # {"record": ..., "issues": [...]}

    # obligation agent output
    upserted: int
    obligations: list[dict]

    error: Optional[str]
