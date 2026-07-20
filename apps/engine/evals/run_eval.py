"""Measure extraction success rate over the labeled fixture set.

For each document we run the real extraction path (LLM -> JSON -> schema
validation) and check whether the pipeline produced a *valid* record whose key
fields match the label:

    state_code  ==  expected.stateCode
    category    ==  expected.category      (via the license-type -> category map)
    interval    ==  expected.intervalMonths
    name        contains expected.nameContains

Document success requires all four. We also report per-field accuracy so a miss
is diagnosable. Runs against whatever LLM is configured (NVIDIA NIM by default);
set MOCK_EXTRACTION=true to dry-run the plumbing without a key.

Run:  python -m evals.run_eval
"""

from __future__ import annotations

import json
from pathlib import Path

from payna_engine.agents.validation_agent import _category_for
from payna_engine.config import get_settings
from payna_engine.domain import ExtractedRequirement
from payna_engine.llm import call_llm, extract_first_json_array

_FIXTURES = Path(__file__).parent / "fixtures" / "dataset.json"


_MAX_TRIES = 3


def _validated_records(text: str) -> tuple[list[ExtractedRequirement], bool]:
    """Returns (records, timed_out). Retries transient LLM errors a few times;
    a persistent timeout is reported separately from a genuine extraction miss."""
    raw = None
    for attempt in range(_MAX_TRIES):
        try:
            raw = call_llm(text)
            break
        except Exception as err:  # noqa: BLE001 — NIM reasoning model can time out
            if attempt == _MAX_TRIES - 1:
                print(f"    (llm error after {_MAX_TRIES} tries: {type(err).__name__})")
                return [], True
    try:
        records = json.loads(extract_first_json_array(raw or ""))
    except (ValueError, json.JSONDecodeError):
        return [], False
    out: list[ExtractedRequirement] = []
    for rec in records if isinstance(records, list) else []:
        try:
            out.append(ExtractedRequirement.model_validate(rec))
        except Exception:  # noqa: BLE001 — invalid record simply doesn't count
            continue
    return out, False


def _matches(rec: ExtractedRequirement, exp: dict) -> dict:
    return {
        "state": rec.state_code == exp["stateCode"],
        "category": _category_for(rec.license_type_name) == exp["category"],
        "interval": rec.interval_months == exp["intervalMonths"],
        "name": exp["nameContains"].lower() in rec.name.lower(),
    }


def main() -> None:
    settings = get_settings()
    data = json.loads(_FIXTURES.read_text())
    docs = data["documents"]

    doc_success = 0
    timeouts = 0
    field_totals = {"state": 0, "category": 0, "interval": 0, "name": 0}

    print(f"Running extraction eval on {len(docs)} documents "
          f"(model={settings.llm_model}, mock={settings.use_mock})\n")

    for d in docs:
        records, timed_out = _validated_records(d["text"])
        if timed_out:
            timeouts += 1
        # Best record = the one satisfying the most expected fields.
        best_m = {"state": False, "category": False, "interval": False, "name": False}
        best_hits = -1
        for rec in records:
            m = _matches(rec, d["expected"])
            hits = sum(m.values())
            if hits > best_hits:
                best_hits, best_m = hits, m

        ok = all(best_m.values())
        doc_success += int(ok)
        for k in field_totals:
            field_totals[k] += int(best_m[k])
        tag = "TIME" if timed_out else ("PASS" if ok else "FAIL")
        print(f"  [{tag}] {d['id']:<24} "
              f"fields={''.join(k[0].upper() if best_m[k] else '-' for k in ('state','category','interval','name'))} "
              f"records={len(records)}")

    n = len(docs)
    n_answered = n - timeouts  # docs where the model actually responded
    print("\n--- results ---")
    print(f"document success rate (all {n})            : {doc_success}/{n} = {doc_success / n * 100:.1f}%")
    if timeouts:
        print(f"document success rate (excl. {timeouts} timeouts) : "
              f"{doc_success}/{n_answered} = {doc_success / n_answered * 100:.1f}%")
    for k, v in field_totals.items():
        print(f"  {k:<9} accuracy   : {v}/{n} = {v / n * 100:.1f}%")

    summary = {
        "model": settings.llm_model,
        "mock": settings.use_mock,
        "documents": n,
        "timeouts": timeouts,
        "documentSuccessRate": round(doc_success / n, 4),
        "documentSuccessRateExclTimeouts": round(doc_success / n_answered, 4) if n_answered else None,
        "fieldAccuracy": {k: round(v / n, 4) for k, v in field_totals.items()},
    }
    out_path = Path(__file__).parent / "last_run.json"
    out_path.write_text(json.dumps(summary, indent=2))
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
