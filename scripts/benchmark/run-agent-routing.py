#!/usr/bin/env python3
"""Run the agent routing benchmark (Layer B) in a read-only, isolated checkout.

Usage:
  scripts/benchmark/run-agent-routing.py --tool claude|codex [--cases C01,C03] [--runs 3]
                                         [--rev HEAD] [--jobs 4] [--claude-model MODEL]

Each run gets a fresh session in a temporary git worktree at --rev with
docs/benchmarks/ removed, so agents never see expected answers. Raw traces go to
docs/benchmarks/agent-routing/raw/ (gitignored); compact summaries go to
docs/benchmarks/agent-routing/runs/<date>/<tool>/<case>-r<n>.json.
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BENCH = ROOT / "docs/benchmarks/agent-routing"
CASES_FILE = BENCH / "cases.md"

# Env vars that would tie a nested Claude Code run to the calling session.
SESSION_ENV = [
    "CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_PID",
    "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_EFFORT",
    "CLAUDE_CODE_EXECPATH", "CODEMIE_SESSION_ID",
]

CLAUDE_READ_ONLY_TOOLS = [
    "Read", "Grep", "Glob",
    "Bash(ls:*)", "Bash(cat:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)",
    "Bash(grep:*)", "Bash(rg:*)", "Bash(find:*)", "Bash(sed -n:*)",
    "Bash(git log:*)", "Bash(git show:*)", "Bash(git ls-files:*)", "Bash(git status:*)",
]
CLAUDE_BLOCKED_TOOLS = ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]


def load_cases():
    text = CASES_FILE.read_text()
    prefix = re.search(r"## Run wrapper.*?\n((?:> [^\n]*\n)+)", text, re.S).group(1)
    prefix = " ".join(line[2:].strip() for line in prefix.splitlines())
    cases = {}
    for m in re.finditer(r"^### (C\d+) .*?\n\n\*\*Prompt:\*\* (.*?)\n\n", text, re.S | re.M):
        cases[m.group(1)] = " ".join(m.group(2).split())
    return prefix, cases


def make_worktree(rev):
    path = Path(tempfile.mkdtemp(prefix="recruiter-bench-"))
    path.rmdir()
    subprocess.run(["git", "-C", str(ROOT), "worktree", "add", "--detach", "-q", str(path), rev],
                   check=True)
    shutil.rmtree(path / "docs/benchmarks", ignore_errors=True)
    sha = subprocess.run(["git", "-C", str(path), "rev-parse", "--short", "HEAD"],
                         capture_output=True, text=True, check=True).stdout.strip()
    return path, sha


def remove_worktree(path):
    subprocess.run(["git", "-C", str(ROOT), "worktree", "remove", "--force", str(path)], check=False)


def tool_command(tool, prompt, worktree, claude_model):
    if tool == "claude":
        return [
            os.path.expanduser("~/.local/bin/claude"), "-p", prompt,
            "--model", claude_model,
            "--output-format", "stream-json", "--verbose",
            "--setting-sources", "project",
            "--no-session-persistence",
            "--allowedTools", *CLAUDE_READ_ONLY_TOOLS,
            "--disallowedTools", *CLAUDE_BLOCKED_TOOLS,
        ]
    return ["codex", "exec", "--sandbox", "read-only", "--ephemeral", "--json",
            "--skip-git-repo-check", "-C", str(worktree), prompt]


def rel(path, worktree):
    s = str(path)
    # Resolved form first: on macOS /var is a symlink to /private/var.
    for base in (str(Path(worktree).resolve()), str(worktree)):
        s = s.replace(base + "/", "").replace(base, ".")
    return s.replace(str(Path.home()), "~")


def summarize_claude(lines, worktree):
    actions, final, meta = [], "", {}
    for line in lines:
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "system" and ev.get("subtype") == "init":
            meta["model"] = ev.get("model")
        if ev.get("type") == "assistant":
            for block in ev.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    inp = block.get("input", {})
                    target = inp.get("file_path") or inp.get("path") or inp.get("pattern") or inp.get("command") or ""
                    actions.append({"tool": block["name"], "target": rel(target, worktree),
                                    **({"pattern": inp["pattern"]} if "pattern" in inp and block["name"] == "Grep" else {})})
        if ev.get("type") == "user":
            for block in ev.get("message", {}).get("content", []) if isinstance(ev.get("message", {}).get("content"), list) else []:
                if block.get("type") == "tool_result" and block.get("is_error"):
                    if actions:
                        actions[-1]["error"] = True
        if ev.get("type") == "result":
            final = ev.get("result", "")
            meta.update(cost_usd=ev.get("total_cost_usd"), turns=ev.get("num_turns"),
                        duration_ms=ev.get("duration_ms"), is_error=ev.get("is_error"))
    return actions, final, meta


def summarize_codex(lines, worktree):
    actions, messages, meta = [], [], {}
    for line in lines:
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = ev.get("item") or {}
        if ev.get("type") == "item.completed":
            kind = item.get("type")
            if kind == "command_execution":
                actions.append({"tool": "shell", "target": rel(item.get("command", ""), worktree),
                                **({"error": True} if item.get("exit_code") not in (0, None) else {})})
            elif kind in ("agent_message", "assistant_message"):
                messages.append(item.get("text", ""))
            elif kind == "reasoning":
                continue
            elif kind == "error":
                meta.setdefault("warnings", []).append(item.get("message", "")[:200])
            elif kind:
                actions.append({"tool": kind, "target": rel(json.dumps(item)[:300], worktree)})
        if ev.get("type") == "turn.completed":
            meta["usage"] = ev.get("usage")
        if ev.get("type") in ("error", "turn.failed"):
            meta["is_error"] = True
            meta["error"] = str(ev)[:500]
    return actions, (messages[-1] if messages else ""), meta


def run_one(tool, case_id, run_no, prompt, worktree, sha, out_dir, raw_dir, claude_model):
    env = {k: v for k, v in os.environ.items() if k not in SESSION_ENV}
    cmd = tool_command(tool, prompt, worktree, claude_model)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    proc = subprocess.run(cmd, cwd=worktree, env=env, capture_output=True, text=True,
                          stdin=subprocess.DEVNULL, timeout=1200)
    lines = proc.stdout.splitlines()
    raw_file = raw_dir / f"{case_id}-r{run_no}.jsonl"
    raw_file.write_text(proc.stdout + ("\n# STDERR\n" + proc.stderr if proc.stderr else ""))
    summarize = summarize_claude if tool == "claude" else summarize_codex
    actions, final, meta = summarize(lines, worktree)
    record = {
        "case": case_id, "run": run_no, "tool": tool, "commit": sha, "started_utc": started,
        "exit_code": proc.returncode, **meta,
        "tool_calls": len(actions), "actions": actions, "final_answer": final,
    }
    if tool == "claude":
        record.setdefault("requested_model", claude_model)
    (out_dir / f"{case_id}-r{run_no}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2))
    return case_id, run_no, proc.returncode, meta.get("cost_usd"), len(actions)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tool", choices=["claude", "codex"], required=True)
    ap.add_argument("--cases", default="")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--rev", default="HEAD")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--claude-model", default="claude-sonnet-5")
    ap.add_argument("--label", default=datetime.date.today().isoformat())
    args = ap.parse_args()

    prefix, cases = load_cases()
    selected = [c for c in args.cases.split(",") if c] or sorted(cases)
    unknown = [c for c in selected if c not in cases]
    if unknown:
        sys.exit(f"unknown cases: {unknown}")

    out_dir = BENCH / "runs" / args.label / args.tool
    raw_dir = BENCH / "raw" / args.label / args.tool
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    jobs = [(c, r) for c in selected for r in range(1, args.runs + 1)]
    worktrees = []
    try:
        # One worktree per job: sessions must not see each other's state.
        prepared = []
        for c, r in jobs:
            wt, sha = make_worktree(args.rev)
            worktrees.append(wt)
            prepared.append((c, r, wt, sha))
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(run_one, args.tool, c, r, f"{prefix} {cases[c]}", wt, sha,
                                   out_dir, raw_dir, args.claude_model)
                       for c, r, wt, sha in prepared]
            for f in concurrent.futures.as_completed(futures):
                try:
                    c, r, code, cost, calls = f.result()
                    print(f"{args.tool} {c} r{r}: exit={code} calls={calls} cost={cost}", flush=True)
                except Exception as exc:  # keep other runs going; record the failure
                    print(f"{args.tool} run failed: {exc}", flush=True)
    finally:
        for wt in worktrees:
            remove_worktree(wt)


if __name__ == "__main__":
    main()
