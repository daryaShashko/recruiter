#!/usr/bin/env python3
"""Offline unit and integration tests for check-n8n-drift.py.

Verifies structural comparison of n8n Code: LLM Router node:
- Positive match against committed baseline and offline fixture
- Detection of deliberate drifts (providers, models, retries, timeouts, code hash)
- Detection of missing router node or invalid workflow files
- Zero external network dependencies (runs fully offline)
"""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Add scripts directory to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# Dynamic import of check-n8n-drift module
import importlib.util
drift_script = SCRIPT_DIR / "check-n8n-drift.py"
spec = importlib.util.spec_from_file_location("check_n8n_drift", drift_script)
if spec is None or spec.loader is None:
    raise ImportError(f"Cannot load module from {drift_script}")
drift_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drift_module)

FIXTURE_PATH = SCRIPT_DIR / "fixtures" / "ingest-workflow.fixture.json"
BASELINE_PATH = SCRIPT_DIR / "n8n-router-baseline.json"


class TestCheckN8nDriftOffline(unittest.TestCase):
    def setUp(self):
        self.assertTrue(FIXTURE_PATH.exists(), f"Fixture file missing: {FIXTURE_PATH}")
        self.assertTrue(BASELINE_PATH.exists(), f"Baseline file missing: {BASELINE_PATH}")

        self.fixture_data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.baseline_data = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))

        # Find router node jsCode from fixture
        _, router_node = drift_module.find_router_node(
            self.fixture_data if isinstance(self.fixture_data, list) else [self.fixture_data]
        )
        self.assertIsNotNone(router_node, "Router node not found in fixture")
        self.fixture_js = router_node.get("parameters", {}).get("jsCode", "")

    def _run_cli(self, workflow_file: Path, baseline_file: Path = BASELINE_PATH) -> subprocess.CompletedProcess:
        """Run check-n8n-drift.py via subprocess with isolated offline environment."""
        env = os.environ.copy()
        # Force non-existent URL and empty key to guarantee zero network reliance
        env["N8N_BASE_URL"] = "http://127.0.0.1:9"
        env["N8N_API_KEY"] = ""

        cmd = [
            sys.executable,
            str(drift_script),
            "--workflow-file",
            str(workflow_file),
            "--baseline",
            str(baseline_file),
        ]
        return subprocess.run(cmd, capture_output=True, text=True, env=env)

    def test_fixture_matches_baseline_unit(self):
        """Unit test: extract_router_parameters on fixture matches baseline dictionary."""
        extracted = drift_module.extract_router_parameters(self.fixture_js)
        diffs = drift_module.compare_parameters(extracted, self.baseline_data)
        self.assertEqual(diffs, [], f"Expected 0 diffs, got: {diffs}")

    def test_fixture_matches_baseline_cli(self):
        """Integration test: CLI execution against fixture exits 0 and reports OK."""
        proc = self._run_cli(FIXTURE_PATH)
        self.assertEqual(proc.returncode, 0, f"CLI failed with stderr:\n{proc.stderr}\nstdout:\n{proc.stdout}")
        self.assertIn("OK: Router node matches baseline", proc.stdout)

    def test_detects_altered_provider_order(self):
        """Detect drift when provider order is reversed or changed."""
        altered_js = (
            self.fixture_js
            .replace("'gemini:gemini-2.5-flash-lite'", "__TEMP__")
            .replace("'openrouter:openrouter/free'", "'gemini:gemini-2.5-flash-lite'")
            .replace("__TEMP__", "'openrouter:openrouter/free'")
        )
        extracted = drift_module.extract_router_parameters(altered_js)
        diffs = drift_module.compare_parameters(extracted, self.baseline_data)
        self.assertTrue(any("providers drifted" in d for d in diffs), f"Expected providers diff, got: {diffs}")

        # CLI verification
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            wf = copy.deepcopy(self.fixture_data)
            for node in wf["nodes"]:
                if node.get("name") == "Code: LLM Router":
                    node["parameters"]["jsCode"] = altered_js
            json.dump(wf, tmp)
            tmp_path = Path(tmp.name)

        try:
            proc = self._run_cli(tmp_path)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("providers drifted", proc.stdout)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_detects_altered_models(self):
        """Detect drift when a model identifier is changed."""
        altered_js = self.fixture_js.replace("gemini-2.5-flash-lite", "gemini-unknown-model-v9")
        extracted = drift_module.extract_router_parameters(altered_js)
        diffs = drift_module.compare_parameters(extracted, self.baseline_data)
        self.assertTrue(any("models drifted" in d for d in diffs), f"Expected models diff, got: {diffs}")

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            wf = copy.deepcopy(self.fixture_data)
            for node in wf["nodes"]:
                if node.get("name") == "Code: LLM Router":
                    node["parameters"]["jsCode"] = altered_js
            json.dump(wf, tmp)
            tmp_path = Path(tmp.name)

        try:
            proc = self._run_cli(tmp_path)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("models drifted", proc.stdout)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_detects_altered_retries(self):
        """Detect drift when retry count is modified."""
        altered_js = self.fixture_js.replace("const maxRetries = 2;", "const maxRetries = 5;")
        extracted = drift_module.extract_router_parameters(altered_js)
        diffs = drift_module.compare_parameters(extracted, self.baseline_data)
        self.assertTrue(any("retries drifted" in d for d in diffs), f"Expected retries diff, got: {diffs}")

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            wf = copy.deepcopy(self.fixture_data)
            for node in wf["nodes"]:
                if node.get("name") == "Code: LLM Router":
                    node["parameters"]["jsCode"] = altered_js
            json.dump(wf, tmp)
            tmp_path = Path(tmp.name)

        try:
            proc = self._run_cli(tmp_path)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("retries drifted", proc.stdout)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_detects_altered_timeouts(self):
        """Detect drift when timeouts are changed."""
        altered_js = self.fixture_js.replace("const timeoutMs = 30000;", "const timeoutMs = 60000;")
        extracted = drift_module.extract_router_parameters(altered_js)
        diffs = drift_module.compare_parameters(extracted, self.baseline_data)
        self.assertTrue(any("timeouts_ms drifted" in d for d in diffs), f"Expected timeouts diff, got: {diffs}")

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            wf = copy.deepcopy(self.fixture_data)
            for node in wf["nodes"]:
                if node.get("name") == "Code: LLM Router":
                    node["parameters"]["jsCode"] = altered_js
            json.dump(wf, tmp)
            tmp_path = Path(tmp.name)

        try:
            proc = self._run_cli(tmp_path)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("timeouts_ms drifted", proc.stdout)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_detects_altered_code_hash(self):
        """Detect drift when arbitrary logic or statements change in router code."""
        altered_js = self.fixture_js + "\nconst modifiedLogicFlag = true;\n"
        extracted = drift_module.extract_router_parameters(altered_js)
        diffs = drift_module.compare_parameters(extracted, self.baseline_data)
        self.assertTrue(any("code_hash drifted" in d for d in diffs), f"Expected code_hash diff, got: {diffs}")

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            wf = copy.deepcopy(self.fixture_data)
            for node in wf["nodes"]:
                if node.get("name") == "Code: LLM Router":
                    node["parameters"]["jsCode"] = altered_js
            json.dump(wf, tmp)
            tmp_path = Path(tmp.name)

        try:
            proc = self._run_cli(tmp_path)
            self.assertEqual(proc.returncode, 1)
            self.assertIn("code_hash drifted", proc.stdout)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_missing_router_node(self):
        """Detect error when workflow fixture lacks Code: LLM Router node."""
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            wf = copy.deepcopy(self.fixture_data)
            wf["nodes"] = [n for n in wf["nodes"] if n.get("name") != "Code: LLM Router"]
            json.dump(wf, tmp)
            tmp_path = Path(tmp.name)

        try:
            proc = self._run_cli(tmp_path)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("FAIL: 'Code: LLM Router' node not found", proc.stderr)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_missing_workflow_file(self):
        """Detect error when workflow file does not exist."""
        proc = self._run_cli(SCRIPT_DIR / "non_existent_file.json")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("FAIL: workflow file not found", proc.stderr)


if __name__ == "__main__":
    unittest.main()
