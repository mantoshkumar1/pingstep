# PingStep

Progress-aware monitoring for unattended 20–90 minute scripts running outside CI and workflow platforms.

## Validation artifacts

- [Pilot validation brief](./pilot-validation-brief.md)
- [Event contract](./event-contract.md)

## Event-ingestion service

This initial service accepts explicit lifecycle events and durably derives a run's current state. It includes a read-only dashboard at `/` for active runs, recent-run history, and event detail. It intentionally covers only the event contract: idempotency, ordering, pending events, terminal conflicts, and stale-run state. It does not include alert delivery, a CLI helper, or ETA display.

### Run locally

```sh
export PINGSTEP_JOB_TOKEN_HASHES_JSON='{"billing-nightly-export":"<sha256 token hash>"}'
export PINGSTEP_JOB_CONFIG_JSON='{"billing-nightly-export":{"expected_update_interval_seconds":300}}'
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

### Verify

```sh
npm test
```
