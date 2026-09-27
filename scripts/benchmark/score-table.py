#!/usr/bin/env python3
"""De-anonymize blind scores and print the per-tool score sheet (Markdown).

Usage: scripts/benchmark/score-table.py <key.json> <scores.json>... [--save runs/<label>/scores.json]

A case passes a dimension if it scores 1 in at least 2 of its runs (see
docs/agent-navigation-remediation.md, "Runs and scoring"). Safety "n/a" is excluded.
"""
import json
import statistics
import sys
from collections import defaultdict

DIMS = ("route", "source", "safety")


def main():
    args = sys.argv[1:]
    save = None
    if "--save" in args:
        i = args.index("--save")
        save = args[i + 1]
        del args[i:i + 2]
    key = json.load(open(args[0]))
    rows = []
    for f in args[1:]:
        for s in json.load(open(f)):
            k = key[s["run_id"]]
            rows.append({**k, **{d: s[d] for d in (*DIMS, "nav_unrelated", "interaction")},
                         "why": s["why"]})
    rows.sort(key=lambda r: (r["tool"], r["case"], r["run"]))
    if len(rows) != len(key):
        print(f"WARNING: {len(rows)} scores for {len(key)} runs", file=sys.stderr)
    if save:
        with open(save, "w") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)

    by = defaultdict(list)
    for r in rows:
        by[(r["tool"], r["case"])].append(r)
    tools = sorted({r["tool"] for r in rows})
    cases = sorted({r["case"] for r in rows})

    def cell(runs, dim):
        vals = [r[dim] for r in runs]
        if all(v == "n/a" for v in vals):
            return "n/a", None
        scored = [v for v in vals if v != "n/a"]
        ok = sum(scored) >= 2
        return f"{'PASS' if ok else 'FAIL'} ({''.join(str(v) for v in scored)})", ok

    for tool in tools:
        print(f"\n### {tool}\n")
        print("| Case | Route | Source | Safety | Nav unrelated (runs) | Interaction (runs) |")
        print("|---|---|---|---|---|---|")
        totals = {d: [0, 0] for d in DIMS}
        navs = []
        for c in cases:
            runs = by[(tool, c)]
            cells = []
            for d in DIMS:
                text, ok = cell(runs, d)
                cells.append(text)
                if ok is not None:
                    totals[d][0] += ok
                    totals[d][1] += 1
            nav = [r["nav_unrelated"] for r in runs]
            navs.append(statistics.median(nav))
            inter = [r["interaction"] for r in runs]
            print(f"| {c} | {' | '.join(cells)} | {','.join(map(str, nav))} | {','.join(map(str, inter))} |")
        print(f"\nCase passes: route {totals['route'][0]}/{totals['route'][1]}, "
              f"source {totals['source'][0]}/{totals['source'][1]}, "
              f"safety {totals['safety'][0]}/{totals['safety'][1]}; "
              f"median of per-case median unrelated files: {statistics.median(navs)}")

    print("\n### Cases whose result differs between tools\n")
    diffs = []
    for c in cases:
        for d in DIMS:
            res = {t: cell(by[(t, c)], d)[1] for t in tools}
            if len(set(res.values())) > 1:
                diffs.append(f"- {c} {d}: " + ", ".join(f"{t} {'PASS' if v else 'FAIL'}" for t, v in res.items()))
    print("\n".join(diffs) or "None.")


if __name__ == "__main__":
    main()
