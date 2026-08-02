#!/usr/bin/env python3
"""Send a local synthetic PingStep run: Queue -> Staging -> Running -> outcome."""
import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from urllib.request import Request, urlopen


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def post_event(base_url, token, event):
    request = Request(
        base_url.rstrip("/") + "/v1/events",
        data=json.dumps(event).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        if response.status not in (200, 202):
            raise RuntimeError(f"PingStep returned HTTP {response.status}.")


def main():
    parser = argparse.ArgumentParser(description="Simulate an explicit PingStep run locally.")
    parser.add_argument("--job-key", default="laptop-sim")
    parser.add_argument("--run-seconds", type=int, default=1200, help="Total simulated duration; use 60 for a quick check.")
    parser.add_argument("--transition-seconds", type=int, default=5, help="How long Queue and Staging remain visible.")
    parser.add_argument("--progress-seconds", type=int, default=3, help="How often Running reports visible progress.")
    parser.add_argument("--outcome", choices=("complete", "error", "terminated"), default="complete")
    args = parser.parse_args()
    if args.run_seconds < args.transition_seconds * 2 + 1:
        parser.error("--run-seconds must leave at least one second after Queue and Staging.")
    base_url, token = os.environ.get("PINGSTEP_URL"), os.environ.get("PINGSTEP_TOKEN")
    if not base_url or not token:
        parser.error("PINGSTEP_URL and PINGSTEP_TOKEN must be set.")

    run_id = str(uuid.uuid4())
    if args.progress_seconds < 1:
        parser.error("--progress-seconds must be at least 1.")
    running_seconds = args.run_seconds - args.transition_seconds * 2
    sequence = 0
    for event_type, state, delay in [("started", "Queue", args.transition_seconds), ("step", "Staging", args.transition_seconds)]:
        sequence += 1
        post_event(base_url, token, {
            "event_id": str(uuid.uuid4()), "job_key": args.job_key, "run_id": run_id,
            "sequence": sequence, "type": event_type, "occurred_at": timestamp(),
            "data": {} if event_type == "started" else {"name": state.lower()},
        })
        print(f"{state} (run {run_id})", flush=True)
        time.sleep(delay)

    elapsed = 0
    while elapsed < running_seconds:
        sequence += 1
        percent = min(99, int(elapsed / running_seconds * 100))
        stage = f"Processing {percent}%"
        post_event(base_url, token, {
            "event_id": str(uuid.uuid4()), "job_key": args.job_key, "run_id": run_id,
            "sequence": sequence, "type": "step", "occurred_at": timestamp(),
            "data": {"name": stage, "current": percent, "total": 100, "unit": "percent"},
        })
        print(f"{stage} (run {run_id})", flush=True)
        delay = min(args.progress_seconds, running_seconds - elapsed)
        time.sleep(delay)
        elapsed += delay

    sequence += 1
    terminal_type = "succeeded" if args.outcome == "complete" else "failed"
    data = {"stage": args.outcome.title()}
    if terminal_type == "failed": data["message"] = f"Synthetic run entered {args.outcome.title()}."
    post_event(base_url, token, {
        "event_id": str(uuid.uuid4()), "job_key": args.job_key, "run_id": run_id,
        "sequence": sequence, "type": terminal_type, "occurred_at": timestamp(), "data": data,
    })
    print(args.outcome.title(), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Simulator error: {error}", file=sys.stderr)
        sys.exit(1)
