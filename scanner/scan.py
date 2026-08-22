"""
AutoWCAG-CI Phase 1 scanner.

Starts the target-app Vite dev server, loads it in a headless browser,
injects axe-core, runs an accessibility scan, and prints each violation's
axe rule ID and the exact CSS selector(s) of the offending element(s).
"""

import json
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

SCANNER_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCANNER_DIR)
TARGET_APP_DIR = os.path.join(REPO_ROOT, "target-app")
AXE_CORE_PATH = os.path.join(TARGET_APP_DIR, "node_modules", "axe-core", "axe.min.js")

DEV_SERVER_HOST = "localhost"
DEV_SERVER_PORT = 5173
DEV_SERVER_URL = f"http://{DEV_SERVER_HOST}:{DEV_SERVER_PORT}"
STARTUP_TIMEOUT_SECONDS = 30


def wait_for_port(host, port, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def start_dev_server():
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    print(f"Starting Vite dev server in {TARGET_APP_DIR} ...")
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    proc = subprocess.Popen(
        [npm_cmd, "run", "dev", "--", "--port", str(DEV_SERVER_PORT), "--strictPort"],
        cwd=TARGET_APP_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=creationflags,
    )

    if not wait_for_port(DEV_SERVER_HOST, DEV_SERVER_PORT, STARTUP_TIMEOUT_SECONDS):
        stop_dev_server(proc)
        raise RuntimeError(
            f"Dev server did not come up on port {DEV_SERVER_PORT} within "
            f"{STARTUP_TIMEOUT_SECONDS}s. Run 'npm run dev' in target-app manually to debug."
        )

    print(f"Dev server is up at {DEV_SERVER_URL}")
    return proc


def stop_dev_server(proc):
    if proc.poll() is not None:
        return
    print("Stopping dev server...")
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def run_axe_scan():
    if not os.path.exists(AXE_CORE_PATH):
        raise RuntimeError(
            f"axe-core not found at {AXE_CORE_PATH}. "
            "Run 'npm install' in target-app first."
        )

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(DEV_SERVER_URL, wait_until="networkidle")
        page.add_script_tag(path=AXE_CORE_PATH)
        results = page.evaluate("async () => await axe.run()")
        browser.close()
        return results


def print_violations(results):
    violations = results.get("violations", [])

    if not violations:
        print("\nNo violations found.")
        return

    print(f"\nFound {len(violations)} violation type(s):\n")
    for v in violations:
        print(f"Rule ID:     {v['id']}")
        print(f"Impact:      {v['impact']}")
        print(f"Description: {v['description']}")
        print(f"Help URL:    {v['helpUrl']}")
        print("Elements:")
        for node in v["nodes"]:
            for selector in node["target"]:
                print(f"  - {selector}")
        print()


def main():
    proc = None
    try:
        proc = start_dev_server()
        results = run_axe_scan()
        print_violations(results)

        out_path = os.path.join(SCANNER_DIR, "last_scan_results.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"Full results written to {out_path}")
    finally:
        if proc is not None:
            stop_dev_server(proc)


if __name__ == "__main__":
    sys.exit(main())
