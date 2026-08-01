# PingStep

Progress-aware monitoring for unattended 20–90 minute scripts running outside CI and workflow platforms.

## Validation artifacts

- [Pilot validation brief](./pilot-validation-brief.md)
- [Event contract](./event-contract.md)
- [Design-partner operations](./design-partner-ops.md)
- [Output-pattern detection exploration](./output-pattern-exploration.md)

## Event-ingestion service

This initial service accepts explicit lifecycle events and durably derives a run's current state. It includes a read-only dashboard at `/` for active runs, recent-run history, and event detail. It detects stale runs and, when configured, late runs. A single outbound webhook is the pilot alert channel. It does not include a CLI helper or ETA display.

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

### Stale, late, and alert behavior

The evaluator runs every 60 seconds by default (`PINGSTEP_EVALUATOR_INTERVAL_MS`). A run becomes stale when it has no accepted heartbeat or step before its liveness deadline. Configure `expected_duration_seconds` for a job to enable late detection; the default late grace is the larger of five minutes or 20% of the expected duration, and it can be overridden with `late_grace_seconds`.

Each stale or late transition queues one webhook delivery. PingStep posts a small JSON payload containing the alert type, job key, run ID, status, current step, and message. Failed deliveries remain queued and retry no more than once per minute. `GET /v1/alerts` exposes delivery status for pilot support.

### ETA ranges

PingStep exposes `GET /v1/runs/:job_key/:run_id/eta` only after a running job has a `job_version` and at least five comparable successful runs in the last 30 days. Comparable runs must have the same job key and version, with no stale transition or terminal conflict. The response is a remaining-time range based on the 25th–75th percentile of historical total durations: confidence is `low` for 5–9 runs and `medium` for 10 or more. Point estimates and high confidence are intentionally omitted.

### Verify

```sh
npm test
```
