# PingStep

Progress-aware monitoring for unattended 20–90 minute scripts running outside CI and workflow platforms.

## Design partners

We are recruiting engineers who personally own unattended 20–90 minute production scripts—such as backups, migrations, batch jobs, or report generators—running outside CI/workflow tools. See [the design-partner pilot issue](https://github.com/mantoshkumar1/pingstep/issues/9) to self-qualify. Please do not post credentials, logs, payloads, SQL, customer data, or secrets.

## Validation artifacts

- [Pilot validation brief](./pilot-validation-brief.md)
- [Event contract](./event-contract.md)
- [Design-partner operations](./design-partner-ops.md)
- [Output-pattern detection exploration](./output-pattern-exploration.md)
- [Pilot evidence template](./pilot-evidence.example.json)

## Event-ingestion service

This initial service accepts explicit lifecycle events and durably derives a run's current state. It includes a read-only dashboard at `/` for active runs, recent-run history, and event detail. It detects stale runs and, when configured, late runs. A single outbound webhook is the pilot alert channel. It does not include a CLI helper or ETA display.

## Fast local test

Run a complete local test with no external account, PACE job, or secrets:

```sh
npm run demo
```

It starts PingStep with temporary storage and a generated local token, opens a 60-second synthetic run (`Queue → Staging → Running → Complete`), then prints the final stored run state. While it runs, open the printed dashboard URL—normally `http://localhost:3000/`—to watch the state transitions.

The dashboard updates automatically every three seconds; no browser refresh is required. The demo server stops after the synthetic run finishes, so use `npm start` instead if you want the dashboard to remain available afterward.

On the dashboard, **Run status** is PingStep's lifecycle assessment (`running`, `stale`, `succeeded`, or `failed`). **Last reported stage** is the most recent named progress marker the job sent (for example, `Staging` or `Processing`). A job may be `running` before it has reported a named stage.

Useful variations:

```sh
PINGSTEP_DEMO_RUN_SECONDS=20 npm run demo  # quicker smoke test
PINGSTEP_DEMO_RUN_SECONDS=1200 npm run demo  # 20-minute test
PINGSTEP_DEMO_PORT=3010 npm run demo
PINGSTEP_DEMO_JOBS=2 npm run demo  # two independent jobs in parallel
PINGSTEP_DEMO_OUTCOME=active npm run demo
PINGSTEP_DEMO_OUTCOME=stale PINGSTEP_DEMO_RUN_SECONDS=12 npm run demo
PINGSTEP_DEMO_OUTCOME=error npm run demo
```

This is a functional test only. It does not count as a real-job pilot integration.

### Run locally

```sh
export PINGSTEP_JOB_TOKEN_HASHES_JSON='{"billing-nightly-export":"<sha256 token hash>"}'
export PINGSTEP_JOB_CONFIG_JSON='{"billing-nightly-export":{"expected_update_interval_seconds":300}}'
export PINGSTEP_ALERT_WEBHOOK_URL='https://alerts.example.com/pingstep'
export PINGSTEP_ALERT_WEBHOOK_TOKEN='optional-webhook-token'
npm run hash-token -- your-secret-token
npm start
```

The service uses `./data/pingstep.json` by default. Override it with `PINGSTEP_DATA_FILE`.

### Send an event

```sh
curl -X POST http://localhost:3000/v1/events \
  -H 'Authorization: Bearer your-secret-token' \
  -H 'Content-Type: application/json' \
  --data '{
    "event_id":"fd6f7a25-d59a-4f48-baa7-0ef97f25d774",
    "job_key":"billing-nightly-export",
    "run_id":"f0300e00-e34c-4d24-82b8-145956dd47f5",
    "sequence":1,
    "type":"started",
    "occurred_at":"2026-08-01T12:00:00Z",
    "data":{}
  }'
```

Open `http://localhost:3000/` for the dashboard. Use `GET /v1/runs` for the current recent-run projection, `GET /v1/runs/:job_key/:run_id` for a single run, or `GET /v1/runs/:job_key/:run_id/events` for its event history.

### CLI helper

Use the included helper to emit explicit events from a script. It does not infer stages or parse output.

```sh
export PINGSTEP_URL='http://localhost:3000'
export PINGSTEP_TOKEN='your-job-token'
RUN_ID=$(node bin/pingstep.js start --job billing-nightly-export | node -e 'process.stdin.on("data", d => console.log(JSON.parse(d).run_id))')
node bin/pingstep.js step --job billing-nightly-export --run "$RUN_ID" --sequence 2 --name "exporting rows"
node bin/pingstep.js succeeded --job billing-nightly-export --run "$RUN_ID" --sequence 3
```

Install the package globally or invoke `node bin/pingstep.js` directly. The helper prints the generated run ID from `start`; later events require that ID and an explicit increasing sequence.

### PACE status adapter (local integration test)

For a consenting internal PACE job, `examples/pace_adapter.py` can poll the local `pace -jobStatus -job_id` command and emit explicit PingStep state transitions. It intentionally does **not** emit heartbeats for repeated `Running` responses: that would only prove the poller works, not that the PACE job advances.

```sh
export PINGSTEP_URL='http://localhost:3000'
export PINGSTEP_TOKEN='your-job-token'
python3 examples/pace_adapter.py --pace-job-id '<job-id>' --job-key pace-integration-test --poll-seconds 60
```

Use only a non-sensitive test job. The adapter sends no Jenkins logs or PACE output to PingStep; it sends only the recognized state transition. A deliberately shortened 20-minute PACE run is valid technical-integration evidence, but does not change the pilot’s normal 20–90 minute target-user screen if the real workload normally runs longer.

### Local status simulator

Use this when no real job is available. It automatically emits `Queue → Staging → Running → Complete` from this laptop. This is a functional test only, not pilot-integration evidence.

```sh
export PINGSTEP_URL='http://localhost:3000'
export PINGSTEP_TOKEN='your-job-token'
python3 examples/simulate_statuses.py --job-key laptop-sim --run-seconds 60
```

Use `--run-seconds 1200` for a 20-minute simulation, or `--outcome error` / `--outcome terminated` to exercise failure handling.

Queue and Staging each remain visible for five seconds by default. Make them slower with `--transition-seconds 10`.

While running, the simulator emits `Processing 0%`, `Processing 10%`, and so on every three seconds. Change that cadence with `--progress-seconds 1` for a faster demo.

### Stale, late, and alert behavior

The evaluator runs every 60 seconds by default (`PINGSTEP_EVALUATOR_INTERVAL_MS`). A run becomes stale when it has no accepted heartbeat or step before its liveness deadline. Configure `expected_duration_seconds` for a job to enable late detection; the default late grace is the larger of five minutes or 20% of the expected duration, and it can be overridden with `late_grace_seconds`.

Each stale or late transition queues one webhook delivery. PingStep posts a small JSON payload containing the alert type, job key, run ID, status, current step, and message. Failed deliveries remain queued and retry no more than once per minute. `GET /v1/alerts` exposes delivery status for pilot support.

### ETA ranges

PingStep exposes `GET /v1/runs/:job_key/:run_id/eta` only after a running job has a `job_version` and at least five comparable successful runs in the last 30 days. Comparable runs must have the same job key and version, with no stale transition or terminal conflict. The response is a remaining-time range based on the 25th–75th percentile of historical total durations: confidence is `low` for 5–9 runs and `medium` for 10 or more. Point estimates and high confidence are intentionally omitted.

### Pilot decision scorecard

Copy `pilot-evidence.example.json` outside version control, record evidence using partner aliases only, then run:

```sh
npm run pilot-scorecard -- /path/to/pilot-evidence.json
```

The scorecard returns `proceed` only for five qualified conversations, three real-job integrations, and two explicit paid-pilot or switching commitments. Before the assessment window closes, it returns `collecting_evidence`; after it closes without all thresholds, it returns `stop_or_reposition`.

### Verify

```sh
npm test
```
