# PingStep hosted MVP architecture

**Status:** chosen for the pilot. This replaces the local-only server as the product deployment path.

## Decision

PingStep will run as **one Cloudflare Worker with a Cloudflare D1 database**.

- The Worker provides the public HTTPS event API and serves the operator dashboard.
- D1 is the durable source of truth for jobs, accepted events, run projections, and alert-delivery records.
- A Worker Cron Trigger runs once a minute to find runs whose liveness deadline has passed and mark them stale. The check is idempotent because scheduled delivery can occur more than once.
- The pilot starts on a `workers.dev` URL. A custom domain can be attached after the end-to-end path is proven.

## What runs where

```text
Customer environment                  Cloudflare
Customer status command -> adapter --HTTPS--> Worker -> D1
                                          |       |
                                          |       +-- events, runs, alerts
                                          +-- dashboard in a browser
                                          +-- minute-by-minute stale check
```

The customer adapter runs where the customer's approved status command is available. It sends only a small, authenticated lifecycle event to PingStep; raw command output and customer data remain in the customer environment.

## Boundaries for this MVP

Included:

- Explicit `started`, `heartbeat`, `step`, `succeeded`, `failed`, and `cancelled` events.
- Per-job bearer tokens, stored as SHA-256 hashes, and event-id deduplication.
- A durable dashboard projection: `running`, `stale`, `succeeded`, or `failed`, plus the last reported stage.
- One operator-facing dashboard, protected by an operator authentication layer before external design partners are invited.
- Webhook alert records with retry state; outbound delivery is enabled only after a partner supplies a safe destination.

Not included yet:

- Sending raw logs, SQL, command output, customer data, or secrets to PingStep.
- Inferring job progress from logs.
- Multi-tenant organization management, SSO, mobile apps, or an agent installed by PingStep.

## Data model and reliability rules

| Record | Purpose | Key rule |
| --- | --- | --- |
| `jobs` | Job configuration and token hash | A token is scoped to exactly one job. |
| `events` | Immutable accepted lifecycle events | `event_id` is unique, so retries are safe. |
| `runs` | Read-optimized current state | Updated only after an event is accepted. |
| `alerts` | Stale/late delivery state | Delivery attempts are persisted and retryable. |

All Worker SQL uses parameter binding. Timestamps are stored as ISO-8601 UTC strings. The `runs` projection is regenerated or changed in the same D1 batch as event acceptance, so an event cannot appear accepted while its dashboard state is missing.

## Security model

- Event endpoint: `Authorization: Bearer <job token>`; the Worker SHA-256 hashes it and compares it to the stored job hash using a timing-safe byte comparison.
- Job tokens are generated once, shown once to the operator, and never retained as plaintext by PingStep.
- Operator sign-in is separate from job-token authentication; this is the next security implementation task.
- No credentials are committed. Deployment secrets are set interactively with Wrangler; local-only values live in ignored `.dev.vars`.
- The Worker blocks the development-only scheduled-test URL in hosted environments.

## Deployment sequence

1. Create the D1 database and add its ID to `wrangler.jsonc`.
2. Apply the tracked D1 migration remotely.
3. Deploy the Worker to the staging environment and use its HTTPS URL with the local simulator.
4. Before launch, provision a synthetic test job and verify the full hosted lifecycle, terminal state, and stale transition without connecting to a customer environment.
5. Enable stale alert delivery and invite the first design partner only after operator authentication is in place.
6. After launch, validate the customer-environment adapter with a consenting customer using a non-sensitive job.

## Evidence versus assumptions

**Evidence:** Customer job systems may expose states such as Queue, Staging, Running, Complete, Error, and Terminated; some real jobs can remain Running for roughly three hours with no automatic stall signal. The hosted service has been validated with synthetic lifecycle and stale-transition runs without customer data or a customer environment.

**Assumptions to test:** The office network permits outbound HTTPS to the Worker URL; a one-minute stale evaluation is sufficiently responsive for the pilot; D1’s MVP limits fit the early event volume; design partners will accept a bearer-token adapter before SSO is available.

If outbound HTTPS is blocked, the fallback is a customer-approved egress relay or forwarder—not exposing an inbound service in the customer environment.
