#!/usr/bin/env python3
"""
View runs for a job using a viewer token.

Usage:
    python scripts/view-runs.py <VIEWER_TOKEN>            # print once
    python scripts/view-runs.py <VIEWER_TOKEN> --watch    # live refresh every 5s (Ctrl+C to stop)
"""

import os
import sys
import json
import ssl
import time
import urllib.request
import urllib.error

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

STAGING_URL = "https://pingstep-staging.mantoshk234.workers.dev"


def fetch_runs(token):
    req = urllib.request.Request(
        f"{STAGING_URL}/v1/runs",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "PingStep-Viewer/1.0",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read()).get("runs", [])


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/view-runs.py <VIEWER_TOKEN> [--watch]")
        sys.exit(1)

    token = sys.argv[1]
    watch = "--watch" in sys.argv

    while True:
        try:
            runs = fetch_runs(token)
        except urllib.error.HTTPError as e:
            print(f"ERROR {e.code}: {e.read().decode()}")
            sys.exit(1)

        # Clear screen for live view
        if watch:
            print("\033[2J\033[H", end="")

        print(f"  PingStep Runs — {time.strftime('%H:%M:%S')}")
        print(f"\n{'Job':<20} {'Run ID':<25} {'Status':<12} {'Step':<20} {'Last update'}")
        print("-" * 95)
        if not runs:
            print("  No runs found.")
        for r in runs:
            print(f"{r['job_key']:<20} {r['run_id']:<25} {r['status']:<12} {(r.get('current_step') or '-'):<20} {r.get('received_at') or '-'}")
        print()

        if not watch:
            break
        time.sleep(5)


if __name__ == "__main__":
    main()
