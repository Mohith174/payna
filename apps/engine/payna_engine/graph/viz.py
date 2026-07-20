"""Graph-visualization DTOs for the React force-graph dashboard.

Node/link ids are prefixed with their type ("state:CA", "requirement:<id>") so
they stay unique across node types — matching the EntityGraph contract in
packages/shared/src/graph.ts.
"""

from __future__ import annotations

from neo4j import Driver

# The whole-graph view backs the "renders 500 nodes" dashboard check. Capped so
# a pathological graph can't stream unbounded payloads to the browser.
_FULL_GRAPH_QUERY = """
MATCH (n)
WHERE n:Entity OR n:State OR n:LicenseType OR n:Requirement
WITH n LIMIT $limit
OPTIONAL MATCH (n)-[r]->(m)
WHERE m:Entity OR m:State OR m:LicenseType OR m:Requirement
RETURN n, r, m
"""

_LABEL_TO_TYPE = {"Entity": "entity", "State": "state", "LicenseType": "licenseType", "Requirement": "requirement"}


def _node_type(labels) -> str:
    for label in labels:
        if label in _LABEL_TO_TYPE:
            return _LABEL_TO_TYPE[label]
    return "requirement"


def _node_id(node) -> str:
    t = _node_type(node.labels)
    natural = node.get("code") if t == "state" else node.get("id")
    return f"{t}:{natural}"


def full_graph(driver: Driver, limit: int = 600) -> dict:
    nodes: dict[str, dict] = {}
    links: list[dict] = []

    with driver.session() as session:
        for record in session.run(_FULL_GRAPH_QUERY, limit=limit):
            n = record["n"]
            nid = _node_id(n)
            if nid not in nodes:
                t = _node_type(n.labels)
                nodes[nid] = {"id": nid, "type": t, "label": n.get("name") or n.get("code") or n.get("id")}
            m = record["m"]
            r = record["r"]
            if m is not None and r is not None:
                mid = _node_id(m)
                if mid not in nodes:
                    mt = _node_type(m.labels)
                    nodes[mid] = {"id": mid, "type": mt, "label": m.get("name") or m.get("code") or m.get("id")}
                links.append({"source": nid, "target": mid, "type": r.type})

    return {"nodes": list(nodes.values()), "links": links}
