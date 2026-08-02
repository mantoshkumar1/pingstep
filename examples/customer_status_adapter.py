#!/usr/bin/env python3
"""Map a customer-managed job-status command to explicit PingStep events.

This template runs inside the customer's environment, next to the command that
can inspect their job system. It sends only recognized lifecycle states to
PingStep—never raw logs, command output, customer data, or credentials.

Repeated successful polls produce a heartbeat. That proves PingStep can still
observe the customer job system; it does not claim the job is progressing. Use
an expected duration to flag an unusually long-running job as late.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.request import Request, urlopen

STATES = ("Queue", "Staging", "Running", "Terminated", "Complete", "Error")
TERMINAL = {"Complete": "succeeded", "Terminated": "failed", "Error": "failed"}


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def customer_state(command, job_id):
    output = subprocess.check_output([command, "--job-id", job_id], text=True, stderr=subprocess.STDOUT)
    matches = re.findall(r"\b(?:" + "|".join(STATES) + r")\b", output, flags=re.IGNORECASE)
    if not matches:
        raise RuntimeError("Customer status command did not contain a recognized state.")
    return next(state for state in STATES if state.lower() == matches[-1].lower())


def send(url, token, event):
    request = Request(url.rstrip("/") + "/v1/events", data=json.dumps(event).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=10) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"PingStep returned HTTP {response.status}.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer-job-id", required=True)
    parser.add_argument("--job-key", required=True)
    parser.add_argument("--poll-seconds", type=int, default=60)
    parser.add_argument("--status-command", default="customer-job-status")
    args = parser.parse_args()
    url, token = os.environ.get("PINGSTEP_URL"), os.environ.get("PINGSTEP_TOKEN")
    if not url or not token:
        parser.error("PINGSTEP_URL and PINGSTEP_TOKEN must be set.")
    run_id, sequence, previous = str(uuid.uuid4()), 0, None
    while True:
        state = customer_state(args.status_command, args.customer_job_id)
        if state != previous:
            sequence += 1
            event_type = "started" if previous is None else TERMINAL.get(state, "step")
            data = {"name": state.lower()} if event_type == "step" else {}
            if event_type == "succeeded": data = {"stage": state}
            if event_type == "failed": data = {"stage": state, "message": f"Customer job entered {state}."}
            send(url, token, {"event_id": str(uuid.uuid4()), "job_key": args.job_key, "run_id": run_id, "sequence": sequence, "type": event_type, "occurred_at": now(), "data": data})
            print(f"{now()} {state} -> {event_type}", flush=True)
            previous = state
            if state in TERMINAL:
                return
        else:
            sequence += 1
            send(url, token, {"event_id": str(uuid.uuid4()), "job_key": args.job_key, "run_id": run_id, "sequence": sequence, "type": "heartbeat", "occurred_at": now(), "data": {}})
            print(f"{now()} {state} -> heartbeat (customer system reachable; progress unknown)", flush=True)
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Customer-status adapter error: {error}", file=sys.stderr)
        sys.exit(1)
