import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraphPanel } from "../components/GraphPanel";
import { ENGINE_BASE_URL, fetchEngineHealth, fetchFullGraph } from "../lib/engineApi";

/** Live frames-per-second meter — evidence the force layout stays interactive
 *  while the whole regulatory graph is on screen. */
function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export function GraphExplorerPage() {
  const fps = useFps();
  const minFps = useRef(60);

  const graphQuery = useQuery({ queryKey: ["full-graph"], queryFn: () => fetchFullGraph(600) });
  const healthQuery = useQuery({ queryKey: ["engine-health"], queryFn: fetchEngineHealth });

  // Track the worst FPS observed once the graph is up (ignore the initial 0s).
  useEffect(() => {
    if (graphQuery.data && fps > 0 && fps < minFps.current) minFps.current = fps;
  }, [fps, graphQuery.data]);

  const nodeCount = graphQuery.data?.nodes.length ?? 0;
  const linkCount = graphQuery.data?.links.length ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Regulatory graph</h1>
          <p className="mt-1 text-sm text-slate-500">
            The whole context graph, served by the Python engine at{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{ENGINE_BASE_URL}</code>.
          </p>
        </div>
        {graphQuery.data && (
          <div className="grid grid-cols-3 gap-3 text-right">
            <Stat label="nodes" value={nodeCount} />
            <Stat label="edges" value={linkCount} />
            <Stat label="fps" value={fps || minFps.current} tone={fps && fps < 30 ? "warn" : "ok"} />
          </div>
        )}
      </div>

      {healthQuery.data && (
        <p className="mt-2 text-xs text-slate-400">
          engine model: {healthQuery.data.model}
          {healthQuery.data.mock ? " (mock extraction)" : ""}
        </p>
      )}

      <div className="mt-4">
        {graphQuery.isLoading && <p className="text-sm text-slate-500">Loading graph from engine…</p>}
        {graphQuery.isError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Couldn't reach the engine. Start it with{" "}
            <code className="rounded bg-amber-100 px-1">uv run python -m payna_engine.api</code> in{" "}
            <code>apps/engine</code>, or set <code>VITE_ENGINE_URL</code>.
          </div>
        )}
        {graphQuery.data && <GraphPanel graph={graphQuery.data} />}
      </div>

      {graphQuery.data && (
        <p className="mt-3 text-xs text-slate-500">
          Rendering {nodeCount} regulatory nodes and {linkCount} edges. Lowest FPS observed since load:{" "}
          <span className="font-medium">{minFps.current}</span>.
        </p>
      )}
    </main>
  );
}

function Stat({ label, value, tone = "ok" }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <div>
      <div className={`text-2xl font-semibold ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
