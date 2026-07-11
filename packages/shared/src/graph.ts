// DTO for GET /entities/:id/graph (docs/SPEC.md §6) — the entity's local
// subgraph shaped for react-force-graph-2d. Node/link `id`s are prefixed with
// their type ("state:CA", "requirement:mt-annual-report", …) so ids stay
// unique across node types even though the underlying domain ids don't share
// a namespace.

export type GraphVizNodeType = "entity" | "state" | "licenseType" | "requirement";

export interface GraphVizNode {
  id: string;
  label: string;
  type: GraphVizNodeType;
  [key: string]: unknown;
}

export type GraphVizLinkType = "OPERATES_IN" | "HOLDS" | "REQUIRES" | "IN_STATE" | "DEPENDS_ON";

export interface GraphVizLink {
  source: string;
  target: string;
  type: GraphVizLinkType;
}

export interface EntityGraph {
  nodes: GraphVizNode[];
  links: GraphVizLink[];
}
