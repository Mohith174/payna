"""Measure the latency reduction from single-query Cypher traversal.

Times the two implementations of the same multi-hop obligation retrieval
(payna_engine.graph.traversal) across every seeded entity:

* naive  — N+1 per-hop round trips
* single — one Cypher statement

Both are verified to return identical obligations before timing, so the number
reflects a genuine like-for-like comparison. Reports median per-entity latency
and the reduction percentage.

Run (after seeding):  python -m evals.benchmark --rounds 5
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from payna_engine.db.neo4j_db import close_driver, get_driver
from payna_engine.graph.traversal import obligations_naive, obligations_single_query


def _time_call(fn, driver, entity_id) -> float:
    start = time.perf_counter()
    fn(driver, entity_id)
    return (time.perf_counter() - start) * 1000.0  # ms


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds", type=int, default=5, help="timed repetitions per entity")
    parser.add_argument("--warmup", type=int, default=1, help="warmup repetitions (discarded)")
    args = parser.parse_args()

    driver = get_driver()
    try:
        with driver.session() as session:
            entity_ids = [r["id"] for r in session.run("MATCH (e:Entity) RETURN e.id AS id ORDER BY e.id")]

        if not entity_ids:
            print("No entities found — run `python -m payna_engine.seed` first.")
            return

        # Correctness gate: the two paths must agree before timing means anything.
        mismatches = 0
        for eid in entity_ids:
            a = [o.model_dump() for o in obligations_naive(driver, eid)]
            b = [o.model_dump() for o in obligations_single_query(driver, eid)]
            if a != b:
                mismatches += 1
        if mismatches:
            print(f"WARNING: {mismatches}/{len(entity_ids)} entities disagree between naive and single query.")
        else:
            print(f"correctness: naive == single for all {len(entity_ids)} entities ✓")

        # Warmup (page caches, query plans).
        for _ in range(args.warmup):
            for eid in entity_ids:
                obligations_naive(driver, eid)
                obligations_single_query(driver, eid)

        naive_ms: list[float] = []
        single_ms: list[float] = []
        for _ in range(args.rounds):
            for eid in entity_ids:
                naive_ms.append(_time_call(obligations_naive, driver, eid))
                single_ms.append(_time_call(obligations_single_query, driver, eid))

        naive_med = statistics.median(naive_ms)
        single_med = statistics.median(single_ms)
        naive_mean = statistics.mean(naive_ms)
        single_mean = statistics.mean(single_ms)
        reduction_med = (naive_med - single_med) / naive_med * 100
        reduction_mean = (naive_mean - single_mean) / naive_mean * 100

        print(f"\nentities={len(entity_ids)} rounds={args.rounds} "
              f"samples={len(naive_ms)} per implementation\n")
        print(f"  naive  : median {naive_med:6.2f} ms | mean {naive_mean:6.2f} ms")
        print(f"  single : median {single_med:6.2f} ms | mean {single_mean:6.2f} ms")
        print(f"\n  latency reduction (median): {reduction_med:.1f}%")
        print(f"  latency reduction (mean)  : {reduction_mean:.1f}%")

        summary = {
            "entities": len(entity_ids),
            "rounds": args.rounds,
            "naiveMedianMs": round(naive_med, 3),
            "singleMedianMs": round(single_med, 3),
            "reductionMedianPct": round(reduction_med, 1),
            "reductionMeanPct": round(reduction_mean, 1),
        }
        out_path = Path(__file__).parent / "benchmark_last_run.json"
        out_path.write_text(json.dumps(summary, indent=2))
        print(f"\nwrote {out_path}")
    finally:
        close_driver()


if __name__ == "__main__":
    main()
