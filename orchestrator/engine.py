"""
AutoWCAG-CI Phase 2, Step 1: Unified Engine Orchestrator.

Central controller that drives the full detect -> extract -> fix ->
reintegrate -> validate lifecycle from a single command:

    scan.py -> extract.js -> fix.js -> reintegrate.js -> sandbox.py

Each stage runs as a subprocess so the engine stays a thin coordinator over
the same scripts already proven out individually in Phase 1 -- it does not
reimplement their logic.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Force UTF-8 + line-buffered stdout: when stdout isn't a live TTY (piped,
# redirected, captured by CI), Python fully buffers it by default, which
# would print all of the engine's own banners only after every subprocess
# finishes instead of interleaved in real time as each stage runs.
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

ORCHESTRATOR_DIR = Path(__file__).resolve().parent
REPO_ROOT = ORCHESTRATOR_DIR.parent
SCANNER_DIR = REPO_ROOT / "scanner"
AST_PARSER_DIR = REPO_ROOT / "ast-parser"
TARGET_APP_DIR = REPO_ROOT / "target-app"

SCAN_RESULTS_PATH = SCANNER_DIR / "last_scan_results.json"
EXTRACTED_CONTEXT_PATH = AST_PARSER_DIR / "extracted_context.json"
PATCHED_COMPONENT_PATH = TARGET_APP_DIR / "src" / "CheckoutForm.patched.jsx"

TARGET_RULE_IDS = {"button-name", "image-alt", "label"}
TOTAL_STEPS = 5

# Stages where a failure implies extract/fix/reintegrate may have left a
# partial or stale intermediate artifact behind. Sandbox failures don't
# qualify: sandbox.py already guarantees its own cleanup, and the failed
# patch is worth keeping around to debug why validation rejected it.
STAGES_REQUIRING_ARTIFACT_CLEANUP = {"extract", "fix", "reintegrate"}


class PipelineError(Exception):
    def __init__(self, stage, message):
        self.stage = stage
        self.message = message
        super().__init__(f"[{stage}] {message}")


def divider(char="=", width=72):
    print(char * width)


def step_header(step_no, name, description):
    print()
    divider()
    print(f" STEP {step_no}/{TOTAL_STEPS} - {name}")
    print(f" {description}")
    divider()


def scanner_python():
    rel = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    venv_python = SCANNER_DIR / "venv" / rel
    if venv_python.exists():
        return str(venv_python)
    # No local venv -- e.g. in CI, where scan.py's dependencies are installed
    # directly into the job's interpreter via `pip install -r
    # scanner/requirements.txt` rather than a project-local venv. Fall back
    # to whatever interpreter is running this engine; it's assumed to have
    # scanner/requirements.txt already installed.
    return sys.executable


def run_cmd(cmd, cwd, stage):
    start = time.time()
    result = subprocess.run(cmd, cwd=str(cwd))
    elapsed = time.time() - start
    if result.returncode != 0:
        raise PipelineError(
            stage, f"'{' '.join(cmd)}' exited with code {result.returncode}"
        )
    return elapsed


def load_json(path, stage):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise PipelineError(stage, f"Failed to read/parse {path}: {e}")


def cleanup_artifacts():
    """
    Best-effort removal of intermediate artifacts (extracted context, the
    patched component draft) after a failure in extract/fix/reintegrate, so
    a half-produced patch can't be mistaken for a valid one on the next run.

    Note: this never touches target-app/src/CheckoutForm.jsx itself -- that
    file is only ever swapped by sandbox.py, which guarantees its own
    backup/restore via a `finally` block independent of this engine.
    """
    removed = []
    for path in (EXTRACTED_CONTEXT_PATH, PATCHED_COMPONENT_PATH):
        try:
            if path.exists():
                path.unlink()
                removed.append(str(path))
        except OSError:
            pass
    return removed


def run_pipeline():
    py = scanner_python()

    # Step 1: Scan
    step_header(1, "SCAN", "Detecting WCAG violations with axe-core")
    elapsed = run_cmd([py, "scan.py"], SCANNER_DIR, "scan")
    scan_results = load_json(SCAN_RESULTS_PATH, "scan")
    found_ids = {v["id"] for v in scan_results.get("violations", [])}
    target_found = TARGET_RULE_IDS & found_ids
    print(
        f"\n[STEP 1/{TOTAL_STEPS}] COMPLETE in {elapsed:.1f}s -- "
        f"target violations found: {', '.join(sorted(target_found)) or 'none'}"
    )

    if not target_found:
        divider()
        print(" PIPELINE RESULT: NO ACTION NEEDED - no target violations detected")
        divider()
        return

    # Step 2: Extract
    step_header(2, "EXTRACT", "Isolating component context via Babel AST")
    elapsed = run_cmd(["node", "extract.js"], AST_PARSER_DIR, "extract")
    print(f"\n[STEP 2/{TOTAL_STEPS}] COMPLETE in {elapsed:.1f}s")

    # Step 3: Fix (LLM)
    step_header(3, "FIX", "Requesting remediation patch from Groq LLM")
    elapsed = run_cmd(["node", "fix.js"], AST_PARSER_DIR, "fix")
    print(f"\n[STEP 3/{TOTAL_STEPS}] COMPLETE in {elapsed:.1f}s")

    # Step 4: Reintegrate
    step_header(4, "REINTEGRATE", "Splicing the patched AST back into the original file")
    elapsed = run_cmd(["node", "reintegrate.js"], AST_PARSER_DIR, "reintegrate")
    print(f"\n[STEP 4/{TOTAL_STEPS}] COMPLETE in {elapsed:.1f}s")

    # Step 5: Sandbox validation
    step_header(5, "VALIDATE", "Running Stage A Sandbox regression check")
    elapsed = run_cmd([py, "sandbox.py"], SCANNER_DIR, "sandbox")
    print(f"\n[STEP 5/{TOTAL_STEPS}] COMPLETE in {elapsed:.1f}s")


def main():
    pipeline_start = time.time()

    divider()
    print(" AutoWCAG-CI ENGINE -- Automated Accessibility Remediation Pipeline")
    print(" Target: target-app/src/CheckoutForm.jsx")
    divider()

    try:
        run_pipeline()
    except PipelineError as e:
        total_elapsed = time.time() - pipeline_start
        removed = (
            cleanup_artifacts() if e.stage in STAGES_REQUIRING_ARTIFACT_CLEANUP else []
        )
        print()
        divider("!")
        print(f" PIPELINE RESULT: FAILED at stage '{e.stage}'")
        print(f" Reason: {e.message}")
        print(f" Total duration: {total_elapsed:.1f}s")
        if removed:
            print(f" Cleanup: removed stray artifact(s): {', '.join(removed)}")
        print(" target-app/src/CheckoutForm.jsx was never touched at this stage.")
        divider("!")
        return 1
    except Exception as e:  # unexpected failure -- still fail safely, never silently
        total_elapsed = time.time() - pipeline_start
        removed = cleanup_artifacts()
        print()
        divider("!")
        print(" PIPELINE RESULT: FAILED with unexpected error")
        print(f" Reason: {type(e).__name__}: {e}")
        print(f" Total duration: {total_elapsed:.1f}s")
        if removed:
            print(f" Cleanup: removed stray artifact(s): {', '.join(removed)}")
        divider("!")
        return 1

    total_elapsed = time.time() - pipeline_start
    print()
    divider()
    print(" PIPELINE RESULT: SUCCESS")
    print(f" Total duration: {total_elapsed:.1f}s")
    divider()
    return 0


if __name__ == "__main__":
    sys.exit(main())
