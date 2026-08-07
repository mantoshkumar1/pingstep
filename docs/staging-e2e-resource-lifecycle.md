# Staging E2E resource lifecycle

Covers the staging-only registry and cleanup infrastructure for deployed
end-to-end verification (issue #174). It lets every staging E2E run create
uniquely identifiable synthetic resources, clean them up after success or
ordinary failure, recover when a process is killed or hard-cancelled, and be
rerun repeatedly without accumulating jobs, runs, events, alerts, or future
Queue/R2 resources.

## Architecture and trust boundary

- **Registry tables** — `e2e_test_runs` and `e2e_test_resources` live in the
  ordinary staging D1 database (`migrations/0009_e2e_registry.sql`). The
  tables may exist unused in production, but production never enables the
  routes or scheduled janitor that touch them.
- **Repository layer** — `src/worker/e2e-registry.ts` (`E2ERegistryRepository`)
  is a thin SQL boundary, same shape as `PingStepD1Repository`: it never
  accepts caller-supplied table names, SQL fragments, or delete predicates.
- **Business logic** — `src/worker/e2e-control.ts` implements registration,
  ownership verification, and the FK-safe cleanup adapter for the current
  resource type (`job`). `src/worker/e2e-janitor.ts` implements the bounded
  orphan janitor. Both are unit-tested against an in-memory fake
  (`test/e2e-registry.test.ts`), the same pattern the rest of this codebase
  uses for `PingStepD1Repository`.
- **Control routes** — `POST/GET /v1/internal/e2e/*` in `src/worker.ts`, gated
  by `isE2EControlEnabled(env)`. This is not a public or customer API: every
  route is a distinct namespace from `/v1/jobs`, `/v1/events`, etc., and
  ordinary product authorization (account sessions, job tokens, viewer
  tokens) plays no role here.
- **Harness** — `scripts/lib/staging-e2e.mjs` is the reusable Node module
  that talks to the control routes. `scripts/verify-late-run-staging.mjs`
  uses it; any future deployed E2E script should too.

Nothing here replaces the product APIs under test. The harness only
arranges/cleans fixtures — the actual lifecycle-event and alert behavior is
still exercised through the ordinary `/v1/events`, `/v1/runs`, `/v1/alerts`,
and `/v1/operator/jobs` endpoints.

## Fail-closed production behavior

Every E2E control operation requires **all** of:

1. `ENVIRONMENT === 'staging'` (a Worker var, set per environment in
   `wrangler.jsonc`)
2. `E2E_CONTROL_ENABLED === 'true'` (a Worker var — flag name only, see
   `wrangler.jsonc`'s `env.staging.vars`)
3. `E2E_CONTROL_TOKEN` configured (a **separate Cloudflare secret**, set with
   `wrangler secret put E2E_CONTROL_TOKEN --env staging` — never in
   `wrangler.jsonc`, never the same value as `OPERATOR_TOKEN`)
4. A timing-safe comparison of the request's bearer token against that secret
5. The request's hostname matching `PUBLIC_ORIGIN`'s hostname, when configured
6. `application/json` content-type on `POST` requests, with a bounded body

`isE2EControlEnabled(env)` in `src/worker/e2e-control.ts` checks (1)-(3). In
`src/worker.ts`, every internal E2E route is wrapped in
`if (isE2EControlEnabled(env)) { ... }` — when it's `false` (always true in
production, since `E2E_CONTROL_ENABLED` and `E2E_CONTROL_TOKEN` are only
configured for the staging environment), execution falls straight through to
the same generic `{"error":"API endpoint not found."}` 404 every other
unmatched `/v1/*` path returns. Production never reveals that this facility
exists. The production scheduled handler never runs the janitor for the same
reason (`isE2EControlEnabled(env)` gates that too).

## Local & CI usage

Environment variables the harness and CLI scripts read:

- `PINGSTEP_STAGING_BASE_URL` — staging Worker URL
- `PINGSTEP_STAGING_OPERATOR_TOKEN` — ordinary operator token (unchanged)
- `PINGSTEP_STAGING_E2E_CONTROL_TOKEN` — the separate E2E control secret
- `E2E_RUN_SUFFIX`, `E2E_SOURCE`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`,
  `GITHUB_SHA` — test-run identity metadata (see below)

Commands (added to `package.json`):

```sh
npm run verify:late-run:staging               # runs the deployed late-run test
npm run e2e:staging:cleanup -- --run-id <uuid> # targeted cleanup for one run
npm run e2e:staging:janitor -- --dry-run       # bounded orphan sweep, dry-run by default
npm run e2e:staging:legacy-inventory           # read-only inventory of pre-registry jobs
```

The janitor CLI defaults to `--dry-run`. Destructive execution requires
**both** `--execute` and `--confirm`; there is no flag that overrides the
staging-only gate, in the CLI or on the Worker side.

## Test-run identity

Every deployed staging test registers one `e2e_test_runs` row with a
cryptographically random UUID (`crypto.randomUUID()`, generated client-side
by the harness or server-side if the caller omits `id`) as its canonical,
immutable `e2e_run_id`. That UUID — never an email, branch name, actor, or
token — is the sole authority for resource ownership. A human-readable
suffix (e.g. `e2e-late-<short-suffix>`) may appear in resource names for
readability, but cleanup and the janitor always key off the UUID.

## Cleanup ordering

For each registered `job` resource, `E2ERegistryRepository.cleanupJobResource`
deletes, in FK-safe order, in one D1 batch:

1. `alerts` for the job
2. `pending_events` rows for the job's events
3. `runs` for the job
4. `events` for the job
5. the exact `jobs` row (`WHERE job_key = ? AND owner_user_id IS NULL`)

This mirrors the existing customer `deleteJobForOwner` ordering in
`src/worker/repository.ts`, but is a dedicated repository method scoped by
the E2E registry rather than a reuse of the customer route with a fabricated
owner. After the batch, `countJobOwnedRows` verifies zero rows remain across
all five tables before the resource is marked `cleaned`. If any rows remain,
or the job's ownership/creation-window can't be verified, the resource is
marked `cleanup_failed` and the run's `cleanup_status` becomes
`requires_operator` — never falsely `completed`. A resource whose target job
never existed is marked `absent`, which is a successful, idempotent outcome
(`completed_with_absent_resources` if at least one resource was absent).

Cleanup uses **bounded automatic retry** for transient failures
(`rows_remaining`, `exception`). Each resource tracks `cleanup_attempts`;
on a transient failure with attempts remaining (< `MAX_CLEANUP_ATTEMPTS`,
currently 3), the run stays `pending` so the janitor retries it on the
next pass. Only when all retryable resources are exhausted (or a permanent
`ownership_mismatch` failure is present) does the run transition to
`requires_operator`. This means most transient D1 glitches self-heal
without operator intervention.

Cleanup is idempotent: replaying it against an already-`completed` or
`requires_operator` run returns the existing terminal state without
reprocessing. `requires_operator` is terminal for automatic retry — the
janitor will not re-select it. An operator must explicitly resolve it via
one of two paths (available as CLI commands and control-surface routes):

- **Acknowledge** (`acknowledgeCleanup`, CLI: `--acknowledge --confirm`):
  marks the run as `operator_acknowledged` with `cleaned_at` set, making
  it eligible for the 30-day purge. Use **only** when manual cleanup has
  been performed externally or the resources are confirmed safe to leave —
  acknowledgement is the documented operator-resolution policy under which
  an acknowledged run becomes purgeable; it never converts unresolved
  synthetic-resource leakage into an automatic-cleanup success. Resources
  keep their `cleanup_failed` lifecycle and failure codes as evidence, and
  `operator_acknowledged` is always reported as a cleanup *failure* by the
  verification script and cleanup CLI. Requires explicit `--confirm` to
  prevent accidental acknowledgement.
- **Reset** (`resetCleanup`, CLI: `--reset`): moves the run back to
  `pending` so the janitor (or an explicit `requestCleanup` call) can
  retry. Use after fixing the underlying issue. Note: reset does not
  clear per-resource attempt counters, so an exhausted resource stays
  exhausted even after reset.

Both operations are race-safe: the underlying UPDATE is a compare-and-swap
on `cleanup_status = 'requires_operator'`, and the control layer checks the
mutation result. If a concurrent caller changed the run between the read and
the write, the API returns `409` reporting the run's actual current state —
it never claims a transition that did not occur.

A per-run lease (`acquireCleanupLease`, a compare-and-swap on
`cleanup_status`) prevents two concurrent cleanup calls for the same run
from double-processing. `finishCleanup` only sets `cleaned_at` for truly
terminal statuses (`completed`, `completed_with_absent_resources`), so
`requires_operator` runs do not keep refreshing their purge window.

## Defense in depth

1. **In-process cleanup** — `scripts/verify-late-run-staging.mjs` requests
   cleanup and polls it to a terminal state in a `finally`-equivalent path,
   regardless of whether the test passed or failed. The harness performs
   bounded re-attempts (up to 3 within its time budget) while the run
   remains retryable. Only `completed` and
   `completed_with_absent_resources` count as cleanup success: a
   nonterminal status (`pending`, `in_progress`, `unknown`) left at the
   poll timeout, `requires_operator`, `operator_acknowledged`, and `error`
   all cause a nonzero exit from both the verification script and
   `npm run e2e:staging:cleanup`, because synthetic resources may still
   exist in staging.
2. **`if: always()` workflow step** — `.github/workflows/quality.yml`'s
   `e2e-late-run` and `e2e-late-run-manual` jobs each have a "Clean up E2E
   resources" step that always runs, even if the verification step failed,
   using the run id the script wrote to a shared file as soon as it
   registered.
3. **Orphan janitor** — `runE2EJanitor` (`src/worker/e2e-janitor.ts`) is
   wired into the Worker's `scheduled()` handler and only executes when
   `isE2EControlEnabled(env)` is true. It selects a small (5 per invocation),
   indexed batch of runs whose `expires_at` has passed and whose cleanup
   hasn't completed, acquires each one's lease, and runs the same cleanup
   adapter. This is what recovers a run whose GitHub Actions job was
   hard-cancelled before step 2 could complete. It also purges registry rows
   for runs cleaned more than 30 days ago, in bounded batches.

Default expiry: 2 hours for `github_push`-sourced runs, 4 hours for
`workflow_dispatch`/`local_manual`, overridable per-run within a 5-minute to
6-hour bound via `expiry_seconds` on registration.

## Registration safety

- `resource_type` must be in the code-defined allowlist in
  `src/worker/e2e-registry.ts` (currently just `'job'` — extend only when a
  feature ships a matching cleanup adapter).
  `resource_ref` is validated per type (a `job` ref must match
  `e2e-<name>`, within the same length/charset bounds as ordinary
  `job_key` validation).
- Claiming a resource as `created` (rather than merely `planned`) requires
  the underlying `jobs` row to exist, have `owner_user_id IS NULL`, and have
  a `created_at` at or after the run's own `created_at` — an already-existing
  unrelated or customer-owned job can never be retroactively claimed.
- The composite primary key `(run_id, resource_type, resource_ref)` scopes
  every resource to exactly one run, so two concurrent runs with
  independently-generated UUIDs never collide even if they happen to plan
  resources with related names.

## Failure recovery

- If `verify-late-run-staging.mjs` is killed mid-run, its own cleanup never
  fires — the workflow's `if: always()` step (using the run id file it wrote
  immediately after registration) is the next line of defense.
- If the whole job/runner is killed before that step runs, the run stays in
  `not_started`/`pending` cleanup status until it expires, at which point the
  janitor picks it up on a later cron tick.
- Transient cleanup failures (`rows_remaining`, `exception`) are
  automatically retried up to `MAX_CLEANUP_ATTEMPTS` (3) by the janitor.
  The run stays `pending` until all retryable resources are exhausted.
- Any run whose cleanup adapter reports `requires_operator` (after
  exhausting retries, or on a permanent `ownership_mismatch`) needs
  manual attention. The janitor will NOT automatically retry it. Two
  operator CLI commands exist:
  - **Reset for retry:**
    `npm run e2e:staging:cleanup -- --run-id <uuid> --reset`
    Moves the run back to `pending`. The janitor picks it up on the
    next cron tick. Note: per-resource attempt counters are not reset.
  - **Acknowledge:**
    `npm run e2e:staging:cleanup -- --run-id <uuid> --acknowledge --confirm`
    Marks the run as `operator_acknowledged` and sets `cleaned_at`,
    making it eligible for the 30-day registry purge.
  - As a last resort, inspect the registry rows directly.

## Legacy inventory / manual cleanup procedure

Jobs named `e2e-late-*` created before this registry existed have no
registered E2E run and can't be identified by prefix alone (a prefix match is
never used for actual deletion). `npm run e2e:staging:legacy-inventory` lists
them (job key, creation timestamp, and row counts only — no event content,
tokens, stage names, or customer data) without deleting anything.

These jobs have `owner_user_id IS NULL`, so the ordinary customer
job-deletion route (which requires an authenticated owner) cannot remove
them either. Removing a confirmed-safe legacy job today requires direct
operator database access (e.g. `wrangler d1 execute pingstep-staging --remote
--env staging --command "..."`, deleting from `alerts`, `pending_events`,
`runs`, `events`, then `jobs`, for that exact `job_key`, in that order) after
manually confirming the job key is a known synthetic E2E artifact and not a
founder verification record. This is intentionally a manual, one-off
operator procedure — it is not wired into the janitor or any recurring
automation, and no bulk/prefix-based deletion command exists.

## Adding a cleanup adapter for a new resource type

A feature cannot enable recurring deployed E2E coverage for a new resource
type until it has a cleanup adapter here (or an explicit, documented
bounded-retention exception). To add one:

1. Add the type to the `E2EResourceType` union and `E2E_RESOURCE_TYPES` set
   in `src/worker/e2e-registry.ts`.
2. Add ownership-verification logic to `verifyResourceOwnership` in
   `src/worker/e2e-control.ts` — how to confirm a candidate resource belongs
   to this run's naming/ownership/creation window.
3. Add a `cleanup<Type>Resource`-style method to `E2ERegistryRepository`
   that deletes in FK-safe order and returns enough information for
   `performCleanup` to verify zero rows remain.
4. Wire the new branch into the `resource.resource_type === '<type>'` switch
   in `performCleanup` (`src/worker/e2e-control.ts`).
5. Add tests mirroring `test/e2e-registry.test.ts`'s job-resource coverage:
   full cleanup, replay, absent resource, partial failure.

Stripe, R2, Queue, accounts/sessions/OAuth, schedules, usage counters,
feedback, and export resources are explicitly out of scope for this issue —
none of them have adapters yet, and none should be added speculatively.
