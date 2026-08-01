# PingStep event contract

**Status:** draft for the Validation MVP. This defines the smallest reliable contract for explicit job progress events; it is not an API implementation.

## Scope and assumptions

**Evidence:** the board's MVP scope requires an explicit lifecycle (`started`, `step`, `heartbeat`, `succeeded`, `failed`), live and recent-run views, one stale/late alert channel, and ETA only when comparable history supports it.

**Assumptions to validate:** a job owner can emit small explicit events from a script; events may be retried, delayed, duplicated, or arrive out of order; a single service can own durable state in the pilot.

Out of scope: inferring stages from generic output, workflow orchestration, distributed/multi-region delivery guarantees, and exactly-once network delivery.

## Concepts and identifiers

| Term | Definition | Rule |
| --- | --- | --- |
| `job_key` | Stable, human-chosen identity for one logical recurring job (for example `billing-nightly-export`). | Required; must remain stable across runs. |
| `run_id` | Client-generated unique ID for one execution. | Required; generated before sending `started`; never reused. UUIDv7 is the recommended format. |
| `event_id` | Client-generated unique ID for one delivery attempt's logical event. | Required; immutable across retries of that event; never reused. |
| `sequence` | Monotonically increasing integer within one `run_id`. | Required; begins at 1 for `started`; each new logical event increments it. |
| `occurred_at` | UTC timestamp at the script when the event happened. | Required; RFC 3339 with offset/Z. |
| `received_at` | UTC timestamp assigned by PingStep at ingestion. | Server-owned; used for delivery/liveness checks. |

`run_id` identifies an execution; `event_id` makes retry handling safe; `sequence` resolves an execution's state when delivery is reordered.

## Canonical event envelope

Every event contains:

```json
{
  "event_id": "019...",
  "job_key": "billing-nightly-export",
  "run_id": "019...",
  "sequence": 2,
  "type": "step",
  "occurred_at": "2026-08-01T03:12:08Z",
  "data": {}
}
```

Required envelope fields are `event_id`, `job_key`, `run_id`, `sequence`, `type`, and `occurred_at`. Unknown fields must be retained where safe or ignored; they must not reject an otherwise valid event. Server-generated fields never come from the client.

## Lifecycle events

| Type | When to emit | Required `data` | State effect |
| --- | --- | --- | --- |
| `started` | Immediately after the job begins useful work. | Optional `expected_duration_seconds`, `metadata`. | Creates the run in `running`. Must use sequence 1. |
| `step` | At a meaningful, explicit checkpoint. | `name` (stable, human-readable stage label); optional `current`, `total`, `unit`, `message`. | Updates the current progress checkpoint; run remains `running`. |
| `heartbeat` | Periodically while work continues but no meaningful step has changed. | Optional `message`. | Refreshes liveness; run remains `running`. |
| `succeeded` | Once, only after all useful work completes. | Optional `summary`. | Terminal state `succeeded`. |
| `failed` | Once, when the script stops unsuccessfully. | `message`; optional `code`, `summary`. Never include secrets, payloads, or stack traces by default. | Terminal state `failed`. |

`started` is required. A successful run requires `succeeded`; an unsuccessful run should emit `failed` whenever the process can handle the error. A process that dies before either terminal event becomes `stale`, rather than `failed`, when its liveness deadline passes.

## Ingestion and idempotency rules

1. The server stores the first accepted event for each `event_id`. A retry with the same complete envelope is accepted as an idempotent duplicate and returns the original result.
2. Reusing an `event_id` with different content is rejected as a conflict; clients must create a new event for new information.
3. The identity of a run is `(job_key, run_id)`. A new `run_id` may reuse a `job_key`; it is a new execution.
4. Events must authenticate as an integration authorized for `job_key`; the authorization design is intentionally outside this document.
5. Invalid events are rejected without changing run state. Rejections must identify the field/rule, but must not echo sensitive content.

This gives at-least-once delivery with idempotent processing; it does not claim exactly-once delivery.

## Ordering and state resolution

- Events may arrive out of order. Store each accepted event, but derive the displayed run state from the highest accepted `sequence` that is valid for that run.
- A lower-sequence event received later must not regress the displayed step, liveness timestamp, or terminal state.
- A `step` or `heartbeat` before `started` is retained as pending for a bounded reconciliation window, but does not create a visible running run. If `started` never arrives, mark the delivery invalid/expired for the pilot.
- `succeeded` and `failed` are terminal. The first valid terminal event with the greatest `sequence` wins. Later non-terminal events are recorded but do not reopen the run.
- Conflicting terminal events are surfaced as a data-quality conflict; the run remains terminal and requires operator review rather than silent rewriting.

The dashboard should show the latest valid sequence and make delayed/out-of-order delivery observable in event history.

## Liveness and late-run rules

Each `started` event establishes a `liveness_deadline` using the job's configured expected update interval plus a grace period. Each valid `step` or `heartbeat` advances that deadline. The server evaluates deadlines using `received_at`, so a client clock error cannot suppress a stale alert.

### Pilot defaults (decided)

- Scripts should emit a `heartbeat` at least every **5 minutes** while active, unless a meaningful `step` is emitted sooner.
- The default expected update interval is **5 minutes** and the default grace period is **10 minutes**. With no job-specific override, a run becomes stale **15 minutes** after its last accepted `started`, `step`, or `heartbeat` event.
- A job may configure a longer expected update interval only when its owner can name the expected quiet-work period. The grace period remains twice the configured interval, with a 10-minute minimum.

These defaults are an operational assumption for the pilot, not a proven universal threshold. Record false-positive and late-detection feedback from every design partner before changing them.

**Late-run decision:** a job becomes late only when it explicitly configures `expected_duration_seconds`. Its late deadline is the start receipt time plus that duration and a grace period; the default grace is the larger of five minutes or 20% of expected duration. Late is an additional condition (`is_late`), not a replacement for `running` or `stale`. This avoids presenting a late run as failed and permits separate, deduplicated late and stale alerts.

- **Running:** received a valid `started` and no terminal event; liveness deadline has not passed.
- **Stale:** running with no valid liveness event before the deadline. Send the pilot's one alert channel once per stale transition.
- **Late:** running beyond an expected-duration threshold supported by configured expectations or comparable completed history. Late is an advisory state and must not be presented as a failure.
- **Terminal:** `succeeded` or `failed`; liveness checks stop.

For the pilot, every job uses the default expected update interval unless its owner configures an override. Do not infer liveness solely from a job's historical duration. ETA ranges remain disabled until the comparable-history rules below are satisfied.

## Minimal acceptance examples

**Normal:** `started(1)` → `step(2)` → `heartbeat(3)` → `succeeded(4)` results in one succeeded run with the final step retained in history.

**Retry:** sending `heartbeat` twice with the same `event_id` produces one stored event and one liveness update.

**Reordering:** `step(2)` received before `started(1)` does not show a run until `started` arrives; then the run displays step 2.

**Crash:** `started(1)` then no further event before the configured deadline transitions once to stale and sends one alert.

**Conflict:** `failed(5)` followed by `succeeded(6)` is flagged for operator review; the service does not silently reinterpret a terminal outcome.

## Decisions for implementation

### Transport and authentication

The first pilot transport is a single HTTPS `POST` endpoint accepting one JSON event per request. Each integration receives a job-scoped bearer token. The token may emit events only for its assigned `job_key`; it must not be accepted for another job. Use TLS, store only a token hash, and expose a token-rotation path. Batch ingestion, agents, and SDKs are deferred.

### Pending events and retention

An event received before `started` remains pending for **15 minutes**. If a valid `started` does not arrive in that window, mark it expired and expose it in delivery diagnostics; it must not create a visible run. Retain raw accepted events and derived run history for **30 days** in the pilot. This supports the recent-run view and early support investigations without creating an indefinite data-retention promise.

### Terminal conflicts

The first accepted terminal event sets the run outcome. A later, opposite terminal event is stored as a `terminal_conflict`; it never changes the visible outcome automatically. The run history and active/recent-run view show a clear conflict flag and both event timestamps. Pilot operators resolve it outside the product by correcting the emitting script and, if necessary, annotating the run; no manual state-edit UI is in scope.

### Comparable-history ETA rules

ETA remains disabled unless all of these conditions hold:

1. The same `job_key` has at least **5 succeeded runs** in the previous **30 days**.
2. Only runs with the same explicitly supplied `job_version` are comparable. Without `job_version`, do not show ETA.
3. Exclude failed, stale, conflicted, and manually excluded runs from the estimate.
4. Show an ETA **range**, calculated from the 25th–75th percentile of comparable total durations, not a point estimate.
5. Label confidence **low** for 5–9 comparable runs and **medium** for 10 or more. The pilot does not display “high” confidence.

`job_version` is therefore optional for ordinary lifecycle events but required in `started.data` before a job can become ETA-eligible. This protects the pilot from presenting a misleading forecast after a material script change. The pilot computes a remaining-time range from the 25th–75th percentile of comparable total durations; confidence is low for 5–9 runs and medium for 10 or more.

## Implementation handoff

The next task may implement only the contract above: durable event storage keyed by `event_id`, derived run state keyed by `(job_key, run_id)`, ordering by `sequence`, a pending-event expiry worker, and liveness checks using `received_at`. It must not add generic log parsing, multiple alert channels, manual conflict editing, or ETA UI beyond the specified eligibility rules.
