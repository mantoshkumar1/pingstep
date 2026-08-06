# PingStep product language

This is the authoritative glossary for how PingStep describes itself and its monitoring states. It exists because the product description and state vocabulary had drifted across marketing pages, documentation, the dashboard, the API docs, and translation strings. When copy changes, check it against this file first. When this file and a specific page disagree, this file wins unless the disagreement is intentional and explained here.

## Canonical product description

**Compact** (use everywhere space is limited — meta descriptions, headers, short taglines):

> Progress-aware monitoring for unattended jobs.

**Expanded** (use where a full description is warranted):

> PingStep monitors scheduled and long-running jobs from start to finish. It detects stopped updates, excessive runtime, explicit failures, cancellations, and the last named stage reached.

**Privacy line** (use on security, privacy, and pricing pages where relevant):

> PingStep monitors the progress of your jobs, not the contents of your systems.

Pages do not need to repeat this prose word-for-word. What matters is semantic consistency: every page should describe the same product, using the same underlying concepts, without contradicting another page.

## Target audience

Engineers and operators who run scheduled or long-running unattended jobs (backups, exports, batch processing, ETL, deploy pipelines) and need to know whether a given run is progressing, stuck, or done. PingStep is **not**:

- A generic APM, logging, or tracing platform.
- A workflow orchestrator or scheduler.
- An incident-management platform.
- A log-storage or log-search product.

## Object glossary

| Term | Definition |
|---|---|
| **Job** | A configured monitored workload. Never call a job a "run." |
| **Run** | One execution of a job. Begins when PingStep accepts a valid `started` event. |
| **Event** | A lifecycle signal deliberately sent by the customer's job. This is the canonical term for what a customer sends — not "status signal," not "progress signal." API event types: `started`, `step`, `heartbeat`, `succeeded`, `failed`, `cancelled`. |
| **Step** | The API event type name. Keep as `step` in API/technical references (request bodies, field names, event-type tables). |
| **Stage** | The human-readable progress label carried by a `step` event. Use "stage" in all user-facing explanatory copy. Preferred pattern: "Send a `step` event whenever the job enters a new named stage." The canonical phrase for referring to the most recent one is **"last reported stage."** |
| **Heartbeat** | A liveness event. It resets the stale timer but is never presented as a run status on its own. |
| **Alert** | A durable operational condition recorded by PingStep (e.g., a stale or late transition). Distinct from notification/delivery. |
| **Notification / delivery** | An attempt to send an alert externally (currently: a single operator-configured webhook). Not the alert itself. |

## Monitoring states

| State | Value | Type | Implemented? | Notes |
|---|---|---|---|---|
| Running | `running` | Primary, non-terminal | Yes | Default state after `started`. |
| Stale | `stale` | Primary, non-terminal | Yes | Updates stopped past the configured deadline. **Never** describe as failure — PingStep cannot confirm the job stopped, only that updates stopped. |
| Late | `late` / `is_late` | Secondary condition, non-terminal | Yes (`src/worker/repository.ts`, `is_late`/`late_at`/`late_transitions` columns; late evaluator in the reconciler) | Coexists with Running or Stale. **Never** describe as "stale" or as "late start" — Late means the run is taking longer than its configured expected duration, not that it started late. |
| Succeeded | `succeeded` | Terminal | Yes | Requires an explicit `succeeded` event. Never inferred. |
| Failed | `failed` | Terminal | Yes | Requires an explicit `failed` event. Never inferred. **Never** equate with Stale. |
| Cancelled | `cancelled` | Terminal | Yes (`src/worker/service.ts` `EVENT_TYPES`/`TERMINAL_TYPES`) | Distinct from Failed — requires an explicit `cancelled` event. **Never** describe as "failed." |
| Missed start | `missed_start` | — | **No** (issue #126, not shipped) | Do not advertise anywhere. Verified absent via `grep -r missed_start src/` returning no matches as of this writing. |

## Alert vs. delivery

An **alert** is the durable record PingStep creates when a run transitions to stale or late (`GET /v1/alerts`). A **delivery** (or **notification**) is PingStep's attempt to send that alert to an external destination. Today, delivery is a single outbound webhook configured by the **operator** as a Worker secret (`ALERT_WEBHOOK_URL` / `ALERT_WEBHOOK_TOKEN` in `src/worker/alerts.ts`). There is no self-service, per-customer, or per-job webhook configuration (that is issue #160, not shipped). Copy must not imply the customer can configure their own alert destination — phrase it as "when the PingStep operator has configured an alert webhook."

## Canonical phrases

- What the customer sends: **"lifecycle events."** Do not use "status signal," "progress signal," or similar synonyms interchangeably.
- The progress marker shown on a run: **"last reported stage."** Do not use "latest stage," "last stage," or "last known state" as alternates.
- The product category: **"progress-aware monitoring."**

## Deprecated / prohibited phrases

| Phrase | Why it's prohibited | Use instead |
|---|---|---|
| "heartbeat monitor" (as the complete product category) | Undersells the product to a liveness-only check | "progress-aware monitoring" |
| "overdue" as a state separate from Late | Introduces a fourth state that doesn't exist | "Late" |
| "job failed" when only stale | Conflates a non-terminal, unconfirmed condition with an explicit terminal failure | "stale" (with an explanation that it's not proof of failure) |
| "PingStep knows why the job failed" | Overclaims root-cause insight PingStep doesn't have | "PingStep reports the explicit failure event your job sent" |
| "real-time" (unqualified) | The system uses periodic reconciliation, not a real-time stream | omit, or say "PingStep checks runs on a short interval" |
| "monitor anything" | Overclaims scope | describe the actual capability (lifecycle events from unattended jobs) |
| "full observability" | Overclaims category | "progress-aware monitoring" |
| "no setup" | Overclaims; a job/token must be created and instrumented | "minimal setup" |
| "AI monitoring" | Not what the product does | omit |
| "logs" (implying PingStep stores raw logs) | PingStep stores lifecycle metadata only, never raw logs | "lifecycle events" / "lifecycle metadata" |
| "team workspace" | Not implemented — accounts are single-user today (verified: no team/invite/multi-user code in `src/worker/auth.ts` or elsewhere; "Team" only appears as a billing plan name) | describe the Team plan by its limits, not as a collaborative workspace |
| "webhook configured" implying self-service | Webhooks are operator-configured only | "operator-configured alert webhook" |
| "the only progress-aware job monitor" / superiority claims over named competitors | Prohibited competitive positioning | contextual, non-superlative comparison only (e.g., "Unlike a simple heartbeat check, PingStep tracks named stages...") |
| "missed start" as an available feature | Not shipped (issue #126) | omit entirely |

## Capability-availability gating (what's live vs. not, as of this branch)

Verified directly against `src/worker/` before writing any copy that claims a capability:

- **Late detection (`is_late`)** — shipped. `src/worker/repository.ts` has `late_deadline`, `is_late`, `late_at`, `late_transitions` columns and an evaluator query (`WHERE status = 'running' AND is_late = 0 ...`). Safe to advertise.
- **Cancelled** — shipped. `cancelled` is a valid terminal event type in `src/worker/service.ts` (`EVENT_TYPES`, `TERMINAL_TYPES`). Safe to advertise.
- **Missed start (`missed_start`)** — not shipped. No matches anywhere in the repository for `missed_start`. Do not advertise.
- **Self-service webhooks** — not shipped. Only a single global, operator-configured webhook exists (`src/worker/alerts.ts`, `ALERT_WEBHOOK_URL`/`ALERT_WEBHOOK_TOKEN` env vars). Do not imply customers can configure their own delivery destination.
- **Card checkout** — shipped. `src/worker/billing.ts` creates real Stripe Checkout sessions (`POST /v1/billing/checkout`) and `pricing.html` already describes "complete secure Stripe Checkout." The old i18n string claiming "Automated card checkout is not live yet" was stale and has been removed from the translation dictionaries (it no longer matched any current English source string, so it was an orphaned, unreachable key — not something the deployed UI displayed).
- **Team workspace / multi-user** — not shipped. "Team" exists only as a billing plan name/limit tier (`src/worker/plans.ts`); there is no invite, multi-user, or shared-workspace code. Do not describe PingStep as a "team workspace."

## Competitive position summary

PingStep is progress-aware monitoring for unattended jobs: it tracks named stages mid-run, not just liveness, and reports explicit success/failure/cancellation rather than inferring them. It is a narrow, focused tool — not a full observability, logging, tracing, scheduling, or incident-management platform, and it has no enterprise SSO. Comparisons to other monitoring tools (Cronitor, Healthchecks.io, Drumbeats, Better Stack, Sentry, etc.) should be contextual and specific (e.g., contrasting stage-tracking with plain heartbeat checks), never superlative ("only," "best," "cheaper than X") without evidence.

### Category essentials (expected of any tool in this space)
- Accepts liveness/heartbeat-style signals.
- Detects when updates stop (staleness).
- Some form of alerting on stopped updates.

### PingStep differentiation
- Tracks the last named **stage** a job reached, not just liveness.
- Distinguishes **Late** (running too long) from **Stale** (updates stopped) as separate, coexisting signals.
- Terminal states (Succeeded, Failed, Cancelled) require explicit customer events — never inferred from silence.
