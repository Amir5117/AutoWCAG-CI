"""
AutoWCAG-CI Phase 1, Step 5 (Part 2): Stage A Sandbox.

CI/CD validation gate: temporarily swaps the LLM-patched component into the
target app, boots the dev server, re-runs the axe-core scan, and confirms the
specific violations that triggered remediation are gone. The original
component and dev server are always restored/torn down, pass or fail.
"""

import os
import shutil
import sys
import tempfile

if sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

from scan import TARGET_APP_DIR, start_dev_server, stop_dev_server, run_axe_scan

COMPONENT_PATH = os.path.join(TARGET_APP_DIR, "src", "CheckoutForm.jsx")
PATCHED_PATH = os.path.join(TARGET_APP_DIR, "src", "CheckoutForm.patched.jsx")

TARGET_RULE_IDS = {"button-name", "image-alt", "label"}


def main():
    if not os.path.exists(PATCHED_PATH):
        raise RuntimeError(
            f"Patched component not found at {PATCHED_PATH}. Run reintegrate.js first."
        )

    backup_fd, backup_path = tempfile.mkstemp(suffix=".jsx", prefix="CheckoutForm.backup.")
    os.close(backup_fd)
    shutil.copyfile(COMPONENT_PATH, backup_path)
    print(f"Backed up original component to {backup_path}")

    proc = None
    try:
        shutil.copyfile(PATCHED_PATH, COMPONENT_PATH)
        print(f"Swapped in patched component at {COMPONENT_PATH}")

        proc = start_dev_server()
        results = run_axe_scan()

        found_ids = {v["id"] for v in results.get("violations", [])}
        remaining = TARGET_RULE_IDS & found_ids

        if not remaining:
            print("\n" + "=" * 60)
            print("  ✅ STAGE A SANDBOX: PASS - 0 Regressions Detected")
            print("=" * 60 + "\n")
            return 0
        else:
            print("\n" + "=" * 60)
            print("  ❌ STAGE A SANDBOX: FAIL")
            print(f"  Still violating: {', '.join(sorted(remaining))}")
            print("=" * 60 + "\n")
            return 1
    finally:
        if proc is not None:
            stop_dev_server(proc)
        shutil.copyfile(backup_path, COMPONENT_PATH)
        os.remove(backup_path)
        print(f"Restored original component from backup and removed {backup_path}")


if __name__ == "__main__":
    sys.exit(main())
