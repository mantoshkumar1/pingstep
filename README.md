# PingStep

Progress-aware monitoring that shows the last stage a long-running job reached and makes lost visibility clear.

Use the hosted dashboard at [pingstep.dev/app](https://pingstep.dev/app). Public guides are available at [Docs](https://pingstep.dev/docs.html), [Security](https://pingstep.dev/security.html), [Privacy](https://pingstep.dev/privacy.html), and [Status](https://pingstep.dev/status).

Please do not post credentials, logs, payloads, SQL, customer data, or secrets.

## Safe release path

PingStep has three deliberately separate environments:

- **Local development** — run `npm run worker:dev`; it uses local storage and never reaches customer data.
- **Staging** — [pingstep-staging.mantoshk234.workers.dev](https://pingstep-staging.mantoshk234.workers.dev) uses a separate Worker and D1 database. Use it for manual product checks and Stripe Test-mode billing checks. Deploy with `npm run worker:deploy:staging` only after the full test suite passes.
- **Production** — [pingstep.dev](https://pingstep.dev) is for real users and live Stripe billing only.

Pull requests run the full quality gate, including dry-runs for both production and staging. After a merge to `main`, GitHub updates staging only after those checks pass. Production never deploys automatically; it uses named version tags:

1. Merge your PR to `main` and wait for staging to deploy successfully.
2. Verify the change on [staging](https://pingstep-staging.mantoshk234.workers.dev).
3. Tag the release: `git tag v0.2.0 && git push origin v0.2.0` (use [semver](https://semver.org)).
4. Start the **Release PingStep to production** workflow, enter the tag name (e.g. `v0.2.0`), and approve the protected production environment.
5. The workflow validates the tag is semver and is on `main`, reruns the full test suite at that tag, then deploys.
6. To roll back, run the workflow again with a previous tag (e.g. `v0.1.0`).

The running version is visible at `/health` and `/v1/version` (environment, tag, and short commit hash), and in the dashboard footer. The Cloudflare deployment credential is kept only as a GitHub Actions secret.

Staging must never use production credentials, production D1, or production routes. Its configuration explicitly has an empty route list, which prevents it from claiming `pingstep.dev`.

## Validation artifacts

- [Pilot validation brief](./pilot-validation-brief.md)
- [Event contract](./event-contract.md)
- [Design-partner operations](./design-partner-ops.md)
- [Output-pattern detection exploration](./output-pattern-exploration.md)
- [Pilot evidence template](./pilot-evidence.example.json)

## Event-ingestion service

PingStep accepts explicit lifecycle events and durably derives a run's current state. The hosted dashboard lives at `/app`; it detects stale runs and, when configured, late runs. A single outbound webhook is available when an alert destination is configured.

## Fast local test

Run a complete local test with no external account, customer job system, or secrets:

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

### One-command status gallery

Do not test each state manually. This command shows **Active**, **Stale**, **Succeeded**, and **Failed** runs together in about 20 seconds:

```sh
npm run demo:gallery
```

Open the printed dashboard URL while it runs. The temporary demo server closes once the final state is printed.

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

### Customer-status adapter (integration template)

`examples/customer_status_adapter.py` is a customer-environment template for polling a customer-managed status command and emitting explicit PingStep state transitions. Adapt the command invocation inside `customer_state()` to the customer's approved command. On each successful repeated poll it emits a heartbeat. This means **stale** tells you the adapter can no longer see the customer job system; it does not mean repeated `Running` proves the job is advancing. Configure an expected duration to surface a long-running `Running` job as **late**.

```sh
export PINGSTEP_URL='http://localhost:3000'
export PINGSTEP_TOKEN='your-job-token'
python3 examples/customer_status_adapter.py --customer-job-id '<job-id>' --job-key customer-integration-test --poll-seconds 60
```

For the hosted service, set `PINGSTEP_URL='https://pingstep.dev'`. Create the job and obtain its one-time job token through the protected operator dashboard at `https://pingstep.dev/app`; use that token as `PINGSTEP_TOKEN`. For a roughly three-hour customer workload, start with 60-second polls, a 120-second liveness grace, and an expected duration of 10,800 seconds plus a 1,800-second late grace. That makes loss of customer-system visibility stale after roughly three minutes, while an observed `Running` job becomes late after 3.5 hours.

Use only a non-sensitive test job. The adapter sends no raw command output, logs, payloads, or customer data to PingStep; it sends only the recognized state transition. A deliberately shortened run is useful technical-integration evidence; it does not prove customer demand or willingness to pay.

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
npm run test:coverage
```

`test:coverage` is the enforced guard for the production Worker core: lifecycle processing, access control, provisioning limits, and plan policy. It requires at least 90% line coverage, 90% function coverage, and 65% branch coverage across those paths. Run it before merging any generated or manually authored change to the Worker.
