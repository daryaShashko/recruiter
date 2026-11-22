#!/usr/bin/env python3
"""Fail if the n8n "Code: LLM Router" node drifts from the committed baseline.

Why this exists: the Router node's code runs inline in n8n's workflow engine.
This check verifies that structural configuration (provider fallback order,
models per provider, retry policy, request timeouts, HTTP client, and code hash)
matches the committed baseline, preventing silent production drift.

Usage:
  # Offline mode (checks local export/fixture):
  python3 scripts/check-n8n-drift.py --workflow-file scripts/fixtures/ingest-workflow.fixture.json

  # Live mode (fetches from n8n API, requires N8N_API_KEY or ~/.n8n-recruiter-key):
  python3 scripts/check-n8n-drift.py

  # Update baseline from workflow file:
  python3 scripts/check-n8n-drift.py --workflow-file <path> --update-baseline
"""

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
BASELINE_FILE = SCRIPT_DIR / "n8n-router-baseline.json"


def normalize_code_for_hash(js_code: str) -> str:
    """Strip comments and normalize whitespace for reproducible code hashing."""
    # Strip multi-line and single-line comments
    no_comments = re.sub(r"//.*?\n|/\*.*?\*/", "\n", js_code, flags=re.DOTALL)
    # Collapse multiple whitespaces and trim
    return " ".join(no_comments.split())


def extract_router_parameters(js_code: str) -> Dict[str, Any]:
    """Extract structural configuration and code hash from Code: LLM Router jsCode."""
    normalized_code = normalize_code_for_hash(js_code)
    code_hash = hashlib.sha256(normalized_code.encode("utf-8")).hexdigest()

    # 1. Providers fallback order
    providers: List[str] = []
    providers_match = re.search(
        r"(?:PROVIDER_ORDER|providers)\s*=\s*\[(.*?)\]", js_code, re.DOTALL | re.IGNORECASE
    )
    if providers_match:
        raw_items = providers_match.group(1).split(",")
        for p in raw_items:
            clean = p.strip().strip("'\"`")
            if clean and not clean.startswith("//"):
                providers.append(clean)
    else:
        # Fallback: scan for known provider keywords in code order
        found = re.findall(r"\b(gemini|openrouter|ollama|anthropic)\b", js_code, re.I)
        seen = []
        for f in found:
            f_lower = f.lower()
            if f_lower not in seen:
                seen.append(f_lower)
        providers = seen

    # 2. Models list
    models_set = set()
    for p in providers:
        if ":" in p:
            _, m = p.split(":", 1)
            models_set.add(m.strip())

    code_models = re.findall(
        r"['\"`](gemini-[0-9][\w.-]*|openrouter/[\w.-]+|deepseek/[\w.-]+|claude-[\w.-]+|llama[0-9.]+[\w.-]*)['\"`]",
        js_code,
        re.IGNORECASE,
    )
    for m in code_models:
        models_set.add(m)
    models = sorted(models_set)

    # 3. Models per provider
    models_per_provider: Dict[str, List[str]] = {}
    for p in providers:
        if ":" in p:
            prov, m = p.split(":", 1)
            prov = prov.strip().lower()
            m = m.strip()
            models_per_provider.setdefault(prov, []).append(m)

    for m in models:
        prov = None
        if m.startswith("gemini"):
            prov = "gemini"
        elif m.startswith("openrouter") or "deepseek" in m:
            prov = "openrouter"
        elif m.startswith("claude"):
            prov = "anthropic"
        elif m.startswith("llama"):
            prov = "ollama"

        if prov:
            if prov not in models_per_provider:
                models_per_provider[prov] = []
            if m not in models_per_provider[prov]:
                models_per_provider[prov].append(m)

    for prov in models_per_provider:
        models_per_provider[prov] = sorted(set(models_per_provider[prov]))

    # 4. Retries
    retries = 0
    retry_match = re.search(
        r"(?:maxRetries|retries|maxAttempts|attempts|maxTries)\s*[:=]\s*(\d+)",
        js_code,
        re.IGNORECASE,
    )
    if retry_match:
        retries = int(retry_match.group(1))
    else:
        attempt_match = re.search(r"attempts?\s*<=\s*(\d+)", js_code, re.IGNORECASE)
        if attempt_match:
            retries = int(attempt_match.group(1))

    # 5. Timeouts (in ms)
    timeout_numbers = set()
    for line in js_code.splitlines():
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        if re.search(r"timeout", line, re.IGNORECASE):
            for num in re.findall(r"\b\d{4,6}\b", line):
                timeout_numbers.add(int(num))
    timeouts_ms = sorted(timeout_numbers)

    # 6. HTTP client type
    http_client = (
        "httpRequest"
        if "helpers.httpRequest" in js_code or "this.helpers.httpRequest" in js_code
        else "fetch"
        if "fetch(" in js_code
        else "unknown"
    )

    return {
        "providers": providers,
        "models": models,
        "models_per_provider": models_per_provider,
        "retries": retries,
        "timeouts_ms": timeouts_ms,
        "http_client": http_client,
        "code_hash": code_hash,
    }


def compare_parameters(current: Dict[str, Any], baseline: Dict[str, Any]) -> List[str]:
    """Compare extracted router parameters with baseline and return list of diff descriptions."""
    diffs: List[str] = []

    # 1. Providers
    if "providers" in baseline:
        expected = baseline["providers"]
        actual = current.get("providers", [])
        if expected != actual:
            diffs.append(
                f"providers drifted:\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}"
            )

    # 2. Models
    if "models" in baseline:
        expected = baseline["models"]
        actual = current.get("models", [])
        if expected != actual:
            diffs.append(
                f"models drifted:\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}"
            )

    # 3. Models per provider
    if "models_per_provider" in baseline:
        expected_mpp = baseline["models_per_provider"]
        actual_mpp = current.get("models_per_provider", {})
        if expected_mpp != actual_mpp:
            diffs.append(
                f"models_per_provider drifted:\n"
                f"  expected: {expected_mpp}\n"
                f"  actual:   {actual_mpp}"
            )

    # 4. Retries
    if "retries" in baseline:
        expected = baseline["retries"]
        actual = current.get("retries", 0)
        if expected != actual:
            diffs.append(
                f"retries drifted:\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}"
            )

    # 5. Timeouts
    if "timeouts_ms" in baseline:
        expected_t = baseline["timeouts_ms"]
        actual_t = current.get("timeouts_ms", [])
        match = False
        if isinstance(expected_t, list) and isinstance(actual_t, list):
            match = sorted(expected_t) == sorted(actual_t)
        elif isinstance(expected_t, int) and isinstance(actual_t, list):
            match = actual_t == [expected_t] or (len(actual_t) > 0 and expected_t in actual_t)
        elif isinstance(expected_t, int) and isinstance(actual_t, int):
            match = expected_t == actual_t
        if not match:
            diffs.append(
                f"timeouts_ms drifted:\n"
                f"  expected: {expected_t}\n"
                f"  actual:   {actual_t}"
            )

    # 6. HTTP client
    if "http_client" in baseline:
        expected = baseline["http_client"]
        actual = current.get("http_client")
        if expected != actual:
            diffs.append(
                f"http_client drifted:\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}"
            )

    # 7. Code hash
    if "code_hash" in baseline:
        expected = baseline["code_hash"]
        actual = current.get("code_hash", "")
        if expected != actual:
            diffs.append(
                f"code_hash drifted:\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}"
            )

    return diffs


def load_workflow_file(path: Path) -> List[Dict[str, Any]]:
    """Load workflows from a local JSON file."""
    if not path.exists():
        sys.exit(f"FAIL: workflow file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else [data]


def find_router_node(
    workflows: List[Dict[str, Any]]
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Find workflow and 'Code: LLM Router' node from loaded workflows."""
    ingest = next((w for w in workflows if w.get("name") == "Ingest Jobs"), None)
    if ingest is not None:
        router = next(
            (n for n in ingest.get("nodes", []) if n.get("name") == "Code: LLM Router"), None
        )
        if router is not None:
            return ingest, router

    # Fallback: search across all workflows
    for w in workflows:
        for n in w.get("nodes", []):
            if n.get("name") == "Code: LLM Router":
                return w, n

    return ingest, None


def main(args: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Check n8n LLM Router node for configuration drift.")
    parser.add_argument(
        "--workflow-file",
        type=Path,
        help="Path to local workflow JSON export file (runs offline without n8n API)",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=BASELINE_FILE,
        help=f"Path to baseline JSON file (default: {BASELINE_FILE.name})",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="Update the baseline JSON file with current extracted parameters",
    )
    parser.add_argument(
        "--full-check",
        action="store_true",
        help="Delegate to patch-n8n-hitl-review.py --check for 100% node and scoring.js drift verification",
    )
    parsed = parser.parse_args(args)

    if parsed.full_check or (not parsed.workflow_file and not parsed.update_baseline):
        patch_script = SCRIPT_DIR / "patch-n8n-hitl-review.py"
        dist_scoring = SCRIPT_DIR.parent / "n8n" / "dist" / "evaluator" / "scoring.js"
        if patch_script.exists() and dist_scoring.exists():
            spec = importlib.util.spec_from_file_location("patch_n8n_hitl_review", patch_script)
            if spec is not None and spec.loader is not None:
                patch_mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(patch_mod)
                patch_mod.main(["--check"])
                return

    if parsed.workflow_file:
        workflows = load_workflow_file(parsed.workflow_file)
    else:
        # Live n8n API mode: dynamically import inspect-n8n
        inspect_script = SCRIPT_DIR / "inspect-n8n.py"
        if not inspect_script.exists():
            sys.exit(f"FAIL: inspect script not found at {inspect_script}")
        spec = importlib.util.spec_from_file_location("inspect_n8n", inspect_script)
        if spec is None or spec.loader is None:
            sys.exit(f"FAIL: could not load module spec for {inspect_script}")
        inspect_n8n = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(inspect_n8n)
        workflows = inspect_n8n.fetch_workflows()

    wf, router_node = find_router_node(workflows)
    if wf is None and router_node is None:
        sys.exit("FAIL: no 'Ingest Jobs' workflow found.")
    if router_node is None:
        sys.exit("FAIL: 'Code: LLM Router' node not found in workflow.")

    js_code = router_node.get("parameters", {}).get("jsCode", "")
    current_params = extract_router_parameters(js_code)

    if parsed.update_baseline:
        parsed.baseline.write_text(json.dumps(current_params, indent=2) + "\n", encoding="utf-8")
        print(f"OK: Updated baseline file at {parsed.baseline}")
        return

    if not parsed.baseline.exists():
        sys.exit(f"FAIL: baseline file not found: {parsed.baseline}")

    baseline_params = json.loads(parsed.baseline.read_text(encoding="utf-8"))
    diffs = compare_parameters(current_params, baseline_params)

    if diffs:
        print("FAIL: 'Code: LLM Router' no longer matches the committed baseline.")
        for d in diffs:
            print(f"- {d}")
        print(
            f"\nIf this is an intentional change, update {parsed.baseline.name} "
            "and context/decisions.yaml / context/ingest-workflow.yaml to match."
        )
        sys.exit(1)

    print(
        f"OK: Router node matches baseline ({len(current_params['providers'])} providers, "
        f"{len(current_params['models'])} models, {current_params['retries']} retries, "
        f"code_hash={current_params['code_hash'][:8]}...)"
    )


if __name__ == "__main__":
    main()
