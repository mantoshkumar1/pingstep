#!/usr/bin/env python3
"""Map a local PACE job-status command to explicit PingStep state events.

This adapter intentionally emits only when PACE's reported state changes. It does
not treat repeated `Running` responses as a heartbeat: that would prove the poller
is alive, not that the PACE job is making progress.
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


def pace_state(command, job_id):
    output = subprocess.check_output([command, "-jobStatus", "-job_id", job_id], text=True, stderr=subprocess.STDOUT)
    matches = re.findall(r"\b(?:" + "|".join(STATES) + r")\b", output, flags=re.IGNORECASE)
    if not matches:
        raise RuntimeError("PACE output did not contain a recognized status.")
    return next(state for state in STATES if state.lower() == matches[-1].lower())


def send(url, token, event):
    request = Request(url.rstrip("/") + "/v1/events", data=json.dumps(event).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=10) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"PingStep returned HTTP {response.status}.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pace-job-id", required=True)
    parser.add_argument("--job-key", required=True)
    parser.add_argument("--poll-seconds", type=int, default=60)
    parser.add_argument("--pace-command", default="pace")
    args = parser.parse_args()
    url, token = os.environ.get("PINGSTEP_URL"), os.environ.get("PINGSTEP_TOKEN")
    if not url or not token:
        parser.error("PINGSTEP_URL and PINGSTEP_TOKEN must be set.")
    run_id, sequence, previous = str(uuid.uuid4()), 0, None
    while True:
        state = pace_state(args.pace_command, args.pace_job_id)
        if state != previous:
            sequence += 1
            event_type = "started" if previous is None else TERMINAL.get(state, "step")
            data = {"name": state.lower()} if event_type == "step" else {}
            if event_type == "failed": data = {"message": f"PACE job entered {state}."}
            send(url, token, {"event_id": str(uuid.uuid4()), "job_key": args.job_key, "run_id": run_id, "sequence": sequence, "type": event_type, "occurred_at": now(), "data": data})
            print(f"{now()} {state} -> {event_type}", flush=True)
            previous = state
            if state in TERMINAL:
                return
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"PACE adapter error: {error}", file=sys.stderr)
        sys.exit(1)
