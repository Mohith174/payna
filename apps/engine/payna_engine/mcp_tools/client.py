"""MCP client used by the agent workflow.

Launches the agency-registry MCP server as a subprocess over stdio and exposes
its tools as LangChain tools via ``langchain-mcp-adapters``. This is the seam
where MCP tools enter the LangGraph workflow: the validation agent awaits
``lookup_agency`` to pull authoritative regulator data from the external source.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient


@lru_cache(maxsize=1)
def _client() -> MultiServerMCPClient:
    return MultiServerMCPClient(
        {
            "agency-registry": {
                # Reuse the current interpreter so the subprocess sees the same venv.
                "command": sys.executable,
                "args": ["-m", "payna_engine.mcp_tools.server"],
                "transport": "stdio",
            }
        }
    )


_tool_cache: dict[str, BaseTool] | None = None


async def get_mcp_tools() -> dict[str, BaseTool]:
    """Map of tool-name -> LangChain tool, loaded from the MCP server once."""
    global _tool_cache
    if _tool_cache is None:
        tools = await _client().get_tools()
        _tool_cache = {t.name: t for t in tools}
    return _tool_cache


async def lookup_agency(state_code: str, license_category: str) -> dict[str, Any]:
    """Call the MCP ``lookup_agency`` tool. Returns {} if the tool is unavailable."""
    tools = await get_mcp_tools()
    tool = tools.get("lookup_agency")
    if tool is None:
        return {}
    result = await tool.ainvoke({"state_code": state_code, "license_category": license_category})
    return _coerce_tool_result(result)


def _coerce_tool_result(result: Any) -> dict[str, Any]:
    """Normalize the several shapes an MCP tool result can take into a dict.

    Depending on the adapter version, ``result`` may be a dict, a JSON string,
    or a list of content blocks like ``[{"type": "text", "text": "{...}"}]``.
    """
    import json

    if isinstance(result, dict):
        return result
    if isinstance(result, list):
        for block in result:
            if isinstance(block, dict) and "text" in block:
                try:
                    return json.loads(block["text"])
                except (TypeError, ValueError):
                    continue
        return {}
    try:
        return json.loads(result)
    except (TypeError, ValueError):
        return {}
