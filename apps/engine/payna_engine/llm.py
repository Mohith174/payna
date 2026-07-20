"""LLM access for the extraction agent.

Uses LangChain's ``ChatOpenAI`` pointed at the OpenAI-compatible NVIDIA NIM
endpoint (same provider the TS server uses). Falls back to a deterministic mock
when no key is configured so the pipeline stays runnable offline.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache

from langchain_openai import ChatOpenAI

from payna_engine.config import get_settings

SYSTEM_PROMPT = """You are a regulatory filing analyst. You extract structured filing requirements from regulatory documents.

Respond with ONLY a JSON array (no prose, no markdown fences). Each element must be an object with EXACTLY these fields:
- "name": string — short requirement name, e.g. "Annual Report"
- "description": string — one-sentence description of the filing
- "stateCode": string — two-letter US state code, e.g. "TX"
- "licenseTypeName": string — the license the requirement applies to, e.g. "Money Transmitter License"
- "intervalMonths": integer or null — renewal cadence in months (12 = annual, 3 = quarterly); null if not recurring
- "dueMonthDay": string or null — fixed due date as "MM-DD" (zero-padded), null if none stated
- "formNumber": string — omit the field entirely if not stated
- "agency": string — omit the field entirely if not stated
- "dependsOnNames": array of strings — names of other requirements this one depends on (empty array if none)
- "confidence": number between 0 and 1 — your confidence in this record

Extract only requirements actually described in the document. Do not invent filings. If the document describes no filing requirements, respond with []."""


@lru_cache(maxsize=1)
def _client() -> ChatOpenAI:
    s = get_settings()
    return ChatOpenAI(
        base_url=s.llm_base_url,
        api_key=s.llm_api_key,
        model=s.llm_model,
        temperature=0,
        max_tokens=4096,
        timeout=180,
        max_retries=0,
    )


def extract_first_json_array(text: str) -> str:
    """Pull the first top-level JSON array out of a possibly-noisy response."""
    start = text.find("[")
    if start == -1:
        raise ValueError("no JSON array found in response")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise ValueError("unterminated JSON array in response")


def call_llm(document_text: str) -> str:
    """One LLM round-trip. Returns raw model text (JSON array expected)."""
    settings = get_settings()
    if settings.use_mock:
        return _mock_extract(document_text)
    resp = _client().invoke(
        [("system", SYSTEM_PROMPT), ("human", f"Extract the filing requirements from this document:\n\n{document_text}")]
    )
    return resp.content if isinstance(resp.content, str) else str(resp.content)


# --- deterministic mock ----------------------------------------------------

_CADENCE_WORDS = {
    "annual": 12, "annually": 12, "yearly": 12, "year": 12,
    "quarter": 3, "quarterly": 3,
    "biennial": 24, "biennially": 24, "every two years": 24,
    "month": 1, "monthly": 1, "semiannual": 6, "semi-annual": 6,
}

_STATE_NAMES = {
    "california": "CA", "new york": "NY", "texas": "TX", "florida": "FL",
    "illinois": "IL", "washington": "WA", "massachusetts": "MA",
}


def _mock_extract(document_text: str) -> str:
    """A crude rules-based stand-in for the LLM. Deterministic; used offline."""
    text = document_text.lower()
    state = next((code for name, code in _STATE_NAMES.items() if name in text), "CA")
    interval = next((m for w, m in _CADENCE_WORDS.items() if w in text), None)
    license_name = "Money Transmitter License" if "transmitter" in text else "Consumer Lending License"
    name_match = re.search(r"(annual report|quarterly call report|license renewal|surety bond|compliance filing)", text)
    name = name_match.group(1).title() if name_match else "Filing Requirement"
    return json.dumps(
        [
            {
                "name": name,
                "description": document_text.strip()[:140],
                "stateCode": state,
                "licenseTypeName": license_name,
                "intervalMonths": interval,
                "dueMonthDay": None,
                "dependsOnNames": [],
                "confidence": 0.6,
            }
        ]
    )
