#!/usr/bin/env python3
"""Build anonymized scoring packets from benchmark run summaries.

Usage: scripts/benchmark/blind-packets.py <label> <out_dir>

Writes one packet per case (<out_dir>/<case>.md) with the case definition and every run
of that case under a random ID, shuffled so the tool is not recognizable by order, plus
<out_dir>/key.json mapping IDs back to tool/run. Keep key.json away from scorers.
"""
import json
import random
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BENCH = ROOT / "docs/benchmarks/agent-routing"

# Tool names that would reveal which harness produced a run.
REDACT = re.compile(r"\b(Claude Code|Claude|Codex|claude-sonnet-5|gpt-6-luna|gpt-[\w.-]+)\b", re.I)


def case_sections(text):
    rubric = re.search(r"## Scoring rubric.*?(?=\n## Cases)", text, re.S).group(0)
    sections = {m.group(1): m.group(0) for m in
                re.finditer(r"^### (C\d+) .*?(?=^### C\d+ |\Z)", text, re.S | re.M)}
    return rubric, sections


def redact(s):
    # Keep case prompts that legitimately mention a tool readable (C11): only
    # redact inside run material, never the case definition.
    return REDACT.sub("[tool]", s)


def main():
    label, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    rubric, sections = case_sections((BENCH / "cases.md").read_text())
    key = {}
    for case_id, section in sorted(sections.items()):
        runs = []
        for tool in ("claude", "codex"):
            for f in sorted((BENCH / "runs" / label / tool).glob(f"{case_id}-r*.json")):
                d = json.loads(f.read_text())
                rid = secrets.token_hex(3)
                key[rid] = {"tool": tool, "case": case_id, "run": d["run"]}
                runs.append((rid, d))
        random.shuffle(runs)
        parts = [f"# Scoring packet {case_id}\n", rubric, "\n## Case definition\n", section,
                 "\n## Runs\n"]
        for rid, d in runs:
            actions = "\n".join(
                f"{i + 1}. {a['tool']}: {a['target'][:400]}{' [error]' if a.get('error') else ''}"
                for i, a in enumerate(d["actions"])) or "(no tool calls)"
            note = " (run failed or produced no answer)" if d.get("is_error") or not d["final_answer"] else ""
            parts.append(f"\n### Run {rid}{note}\n\n**Tool calls in order:**\n\n{redact(actions)}\n\n"
                         f"**Final answer:**\n\n{redact(d['final_answer'])}\n")
        (out / f"{case_id}.md").write_text("\n".join(parts))
    (out / "key.json").write_text(json.dumps(key, indent=2))
    print(f"{len(key)} runs in {len(sections)} packets -> {out}")


if __name__ == "__main__":
    main()
