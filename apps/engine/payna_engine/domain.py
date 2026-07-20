"""Domain models mirroring the Neo4j graph schema (see apps/server/src/graph).

These pydantic models are the contract the validation agent enforces: an LLM
record that does not parse into ``ExtractedRequirement`` is rejected rather than
written to the graph.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

EntityKind = Literal["LLC", "CORP", "PARTNERSHIP", "SOLE_PROP"]
ObligationStatus = Literal["overdue", "due_soon", "upcoming", "no_deadline"]

_US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
    "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
    "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
    "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
}


class ExtractedRequirement(BaseModel):
    """One filing requirement pulled out of a source document by the LLM."""

    name: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    state_code: str = Field(..., alias="stateCode")
    license_type_name: str = Field(..., alias="licenseTypeName")
    interval_months: Optional[int] = Field(None, alias="intervalMonths")
    due_month_day: Optional[str] = Field(None, alias="dueMonthDay")
    form_number: Optional[str] = Field(None, alias="formNumber")
    agency: Optional[str] = None
    depends_on_names: list[str] = Field(default_factory=list, alias="dependsOnNames")
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    # Populated by the MCP enrichment step, not the LLM.
    source_url: Optional[str] = Field(None, alias="sourceUrl")

    model_config = {"populate_by_name": True}

    @field_validator("state_code")
    @classmethod
    def _known_state(cls, v: str) -> str:
        code = v.strip().upper()
        if code not in _US_STATES:
            raise ValueError(f"unknown US state code: {v!r}")
        return code

    @field_validator("interval_months")
    @classmethod
    def _sane_interval(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 1 or v > 120):
            raise ValueError(f"intervalMonths out of range: {v}")
        return v

    @field_validator("due_month_day")
    @classmethod
    def _mm_dd(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        import re

        if not re.fullmatch(r"\d{2}-\d{2}", v):
            raise ValueError(f"dueMonthDay must be MM-DD: {v!r}")
        month, day = int(v[:2]), int(v[3:])
        if not (1 <= month <= 12 and 1 <= day <= 31):
            raise ValueError(f"dueMonthDay not a valid date: {v!r}")
        return v


class RejectedRecord(BaseModel):
    record: dict
    issues: list[str]


class FilingObligation(BaseModel):
    requirement_id: str
    requirement_name: str
    license_type: str
    state_code: str
    interval_months: Optional[int] = None
    next_due_date: Optional[str] = None
    status: ObligationStatus
    depends_on: list[str] = Field(default_factory=list)
