"""The MCP agency-registry tool logic (called in-process, no transport)."""

from __future__ import annotations

from payna_engine.mcp_tools.server import list_states, lookup_agency


def test_exact_match():
    r = lookup_agency("CA", "Money Services")
    assert r["matched"] is True
    assert r["agency"] == "California DFPI"
    assert r["url"].startswith("https://")


def test_case_insensitive_state():
    assert lookup_agency("ny", "Lending")["agency"] == "NY Department of Financial Services"


def test_category_miss_falls_back_to_state_default():
    r = lookup_agency("TX", "Unknown Category")
    assert r["matched"] is False
    assert r["agency"] == "Texas Department of Banking"


def test_unknown_state_returns_none():
    r = lookup_agency("ZZ", "Money Services")
    assert r["agency"] is None


def test_list_states_nonempty():
    assert "CA" in list_states()
