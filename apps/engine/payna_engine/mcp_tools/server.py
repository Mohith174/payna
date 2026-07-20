"""MCP server exposing an external reference-data source to the agent workflow.

Runs as its own process and speaks the Model Context Protocol over stdio. The
validation agent connects as an MCP client and calls ``lookup_agency`` to
enrich each extracted requirement with the authoritative regulator and filing
portal for its (state, license category) — data the LLM should not be trusted to
invent.

Run standalone:  python -m payna_engine.mcp_tools.server
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("payna-agency-registry")

# A small authoritative registry: (state_code, category) -> regulator + portal.
# In production this would be backed by a live regulator directory; bundling it
# keeps the MCP tool deterministic and offline-runnable for demos and CI.
_REGISTRY: dict[tuple[str, str], dict[str, str]] = {
    ("CA", "Money Services"): {"agency": "California DFPI", "url": "https://dfpi.ca.gov/money-transmitters/"},
    ("NY", "Money Services"): {"agency": "NY Department of Financial Services", "url": "https://www.dfs.ny.gov/"},
    ("TX", "Money Services"): {"agency": "Texas Department of Banking", "url": "https://www.dob.texas.gov/"},
    ("CA", "Lending"): {"agency": "California DFPI", "url": "https://dfpi.ca.gov/lenders-financiers/"},
    ("TX", "Lending"): {"agency": "Texas OCCC", "url": "https://occc.texas.gov/"},
    ("NY", "Lending"): {"agency": "NY Department of Financial Services", "url": "https://www.dfs.ny.gov/"},
    ("NY", "Collections"): {"agency": "NY Department of Financial Services", "url": "https://www.dfs.ny.gov/"},
    ("CA", "Collections"): {"agency": "California DFPI", "url": "https://dfpi.ca.gov/debt-collectors/"},
}

# Fallback per-state regulator when the exact category is unknown.
_STATE_DEFAULT: dict[str, dict[str, str]] = {
    "CA": {"agency": "California DFPI", "url": "https://dfpi.ca.gov/"},
    "NY": {"agency": "NY Department of Financial Services", "url": "https://www.dfs.ny.gov/"},
    "TX": {"agency": "Texas Department of Banking", "url": "https://www.dob.texas.gov/"},
}


@mcp.tool()
def lookup_agency(state_code: str, license_category: str) -> dict:
    """Return the regulating agency and official filing portal for a US state
    and license category (e.g. "Money Services", "Lending", "Collections").

    Returns {"agency": str|None, "url": str|None, "matched": bool}.
    """
    key = (state_code.strip().upper(), license_category.strip())
    hit = _REGISTRY.get(key)
    if hit:
        return {"agency": hit["agency"], "url": hit["url"], "matched": True}
    fallback = _STATE_DEFAULT.get(state_code.strip().upper())
    if fallback:
        return {"agency": fallback["agency"], "url": fallback["url"], "matched": False}
    return {"agency": None, "url": None, "matched": False}


@mcp.tool()
def list_states() -> list[str]:
    """List US state codes the registry has regulator data for."""
    return sorted({code for code, _ in _REGISTRY})


if __name__ == "__main__":
    mcp.run()
