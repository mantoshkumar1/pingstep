#!/usr/bin/env python3
"""
Manual staging test — watch PingStep lifecycle on the dashboard.

Usage:
    python scripts/demo-staging.py <JOB_TOKEN>

Steps:
    1. Create a job on staging (e.g. "testing-e2e", 30s interval, 30s grace)
    2. Copy the job token from the UI
    3. Run this script with that token
    4. Watch the dashboard update live at:
       https://pingstep-staging.mantoshk234.workers.dev/app
"""

import os
import sys
import time
import json
import uuid
import ssl
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

STAGING_URL = "https://pingstep-staging.mantoshk234.workers.dev"
JOB_KEY = "testing-e2e"
RUN_ID = f"run-{int(time.time())}"

seq = 0


def send_event(token, event_type, step, message=None, data_extra=None):
    global seq
    seq += 1
    payload = {
        "event_id": str(uuid.uuid4()),
        "job_key": JOB_KEY,
        "run_id": RUN_ID,
        "type": event_type,
        "step": step,
        "sequence": seq,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }
    if message:
        payload["message"] = message
    if data_extra:
        payload["data"] = data_extra

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{STAGING_URL}/v1/events",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "PingStep-Demo/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read())
        return body
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"       ERROR {e.code}: {error_body}")
        raise


def countdown(seconds, label):
    for remaining in range(seconds, 0, -1):
        print(f"\r  {label} {remaining}s remaining...  ", end="", flush=True)
        time.sleep(1)
    print(f"\r  {label} done.{' ' * 20}")


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/demo-staging.py <JOB_TOKEN>")
        sys.exit(1)

    token = sys.argv[1]
    print(f"\n{'=' * 50}")
    print(f"  PingStep manual staging test")
    print(f"  Job: {JOB_KEY}  |  Run: {RUN_ID}")
    print(f"  Dashboard: {STAGING_URL}/app")
    print(f"{'=' * 50}\n")

    # Step 1: Start
    print("[1/6] Sending 'started' event (sequence 1)...")
    send_event(token, "started", "begin")
    print("       Dashboard should show: ACTIVE\n")
    countdown(10, "Waiting")

    # Step 2: Heartbeat
    print("[2/6] Sending 'heartbeat' event (sequence 2)...")
    send_event(token, "heartbeat", "processing")
    print("       Dashboard should still show: ACTIVE\n")
    countdown(10, "Waiting")

    # Step 3: Step event
    print("[3/6] Sending 'step' event (sequence 3)...")
    send_event(token, "step", "halfway", message="50% complete", data_extra={"name": "halfway"})
    print("       Dashboard should show step: halfway\n")

    # Step 4: Wait for stale
    print("[4/6] Waiting for run to go STALE...")
    print("       (No events for 60s = 30s interval + 30s grace, waiting 65s)")
    print("       Watch the dashboard — status will change to STALE\n")
    countdown(65, "Going stale in")

    # Step 5: Recover with heartbeat
    print("[5/6] Sending 'heartbeat' to recover from stale (sequence 4)...")
    send_event(token, "heartbeat", "recovered")
    print("       Dashboard should show: ACTIVE again\n")
    countdown(10, "Waiting")

    # Step 6: Succeed
    print("[6/6] Sending 'succeeded' event (sequence 5)...")
    send_event(token, "succeeded", "done", message="All done!")
    print("       Dashboard should show: SUCCEEDED\n")

    print(f"{'=' * 50}")
    print("  Test complete! Check the dashboard.")
    print(f"{'=' * 50}\n")


if __name__ == "__main__":
    main()
