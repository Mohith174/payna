import { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { EntityGraph, GraphVizNode } from "@payna/shared";

const NODE_COLORS: Record<GraphVizNode["type"], string> = {
  entity: "#0f172a",
  state: "#0284c7",
  licenseType: "#7c3aed",
  requirement: "#059669",
};

interface Props {
  graph: EntityGraph;
}

export function GraphPanel({ graph }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 480 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: 480 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
      <ForceGraph2D
        graphData={graph}
        width={size.width}
        height={size.height}
        nodeId="id"
        nodeLabel={(node) => `${(node as GraphVizNode).type}: ${(node as GraphVizNode).label}`}
        nodeColor={(node) => NODE_COLORS[(node as GraphVizNode).type] ?? "#64748b"}
        nodeRelSize={5}
        linkLabel={(link) => (link as unknown as { type: string }).type}
        linkColor={() => "#cbd5e1"}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        cooldownTicks={100}
      />
      <div className="flex flex-wrap gap-3 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
