# PingStep agent handbook

Durable, cross-agent operating rules for every coding assistant and reviewer working in this repository
(Claude, Codex, ChatGPT, and future agents).

**Read [`PROJECT-STATE.md`](./PROJECT-STATE.md) completely before planning or editing anything.** It is the
shared current-state entry point: active work, owner, blockers, decisions, and the exact next action. This
handbook holds only stable rules — it deliberately contains no prices, plans, launch status, active PR
numbers, board columns, or other facts that drift. Those live in `PROJECT-STATE.md` and the authoritative
GitHub issue.

## What PingStep is

PingStep lets people monitor unattended jobs through explicit lifecycle events. Customer scripts send status
updates; PingStep shows whether each run is active, stale, succeeded, or failed. It must not inspect customer
systems, logs, credentials, or private job output.

## Source of truth

Follow the authority hierarchy in [`PROJECT-STATE.md`](./PROJECT-STATE.md#3-authority-hierarchy). In short:
founder decision, then the authoritative issue, then the Project board, then PR/CI/staging/provider evidence,
then `PROJECT-STATE.md`, then runbooks, then tool-specific pointers. Chat transcripts and session summaries are
never authoritative.

Do not rely on a chat transcript or require the founder to paste a handoff prompt. If information is missing,
record the decision or question in the relevant GitHub issue in plain English.

### Role boundaries

- **Founder (Mantosh)** — sole product, scope, priority, spending, and launch authority.
- **Strategy/review agent** — analyzes, defines tasks, reviews issues/PRs, records founder-approved decisions
  and review findings. Must not promote its own recommendation to a settled decision.
- **Implementation agent** — implements the assigned slice, adds tests, reports evidence, surfaces unresolved
  questions. Must not make product decisions or convert assumptions into policy.

## Start of work

1. Read `PROJECT-STATE.md` completely.
2. Read this handbook and your tool-specific pointer (e.g. [`CLAUDE.md`](./CLAUDE.md)).
3. Inspect the authoritative issue, current branch, open pull requests, CI results, `main`, `migrations/`, and
   the Project board. When the issue has amendment comments, the body **plus every amendment** is the
   authoritative scope; later amendments supersede earlier generic wording.
4. Confirm no other agent owns the same issue, branch, migration number, or high-conflict files.
5. State the exact task boundary and verification plan before editing.

## Work safely

- Create a branch named `codex/<short-task-name>` or `claude/<short-task-name>`.
- Keep changes focused on one issue. Do not rebuild working features without a clear reason.
- Use plain English in issues, PRs, comments, and documentation.
- Never commit, print, or paste secrets, API keys, OAuth data, Stripe data, customer data, logs, payment
  details, or personal information — in code, tests, PRs, or `PROJECT-STATE.md`.
- Ask before destructive, paid, legal, account, or customer-impacting actions that are not clearly authorized
  by the issue.
- Do not deploy production as part of ordinary work.
- One agent owns one issue and one branch at a time.

## Quality contract

Non-negotiable. The PR template enforces the evidence mapping.

1. Every changed behavior has automated evidence at the lowest useful level.
2. Every applicable acceptance criterion maps to a named test, CI check, staging result, provider result, or
   documented manual verification.
3. Every discovered defect receives a regression test before the fix is complete, unless automation is
   genuinely impossible and the reason is recorded.
4. Coverage is a guardrail, not proof of correctness. Do not add meaningless tests to raise coverage.
5. Critical database behavior must not be verified only through in-memory mocks.
6. A merged PR is not `Done` while staging, provider, migration, or founder evidence remains required.
7. Flaky tests are defects. Do not normalize rerunning until green.
8. Tests verify behavior and guarantees rather than private implementation details, where practical.
9. **Tests must prove the authoritative contract, not redefine it.** A suite that quietly changes the
   requirement to match the implementation is not valid evidence. For requirements using words such as
   *automatic*, *bounded*, *idempotent*, *recoverable*, *operator-controlled*, *fail-closed*, *terminal*,
   *concurrent*, or *retry*, add explicit state-transition tests proving those semantics.
10. **Promised actions must be reachable through the intended surface.** An internal function that cannot be
    invoked through the supported API, CLI, UI, workflow, or provider procedure does not satisfy an
    acceptance criterion. Test from that surface where practical.
11. **Failure propagation is part of correctness.** For finalization, cleanup, migration, provider,
    reconciliation, release, or verification flows, prove failures affect the externally observable result.
    Logging an error while returning success is not acceptable unless the issue defines that failure as
    non-fatal.
12. **Implementation summaries are not authoritative evidence.** Before accepting a change, inspect the pushed
    state: issue, PR head SHA, diff, review comments, CI checks, migrations, and required staging/provider
    evidence. Do not mark a finding resolved because an agent says it is resolved.

### Risk-based test layers

For each implementation issue, explicitly determine the applicability of: unit/domain; real D1 repository and
migration; API, authorization, tenant-isolation, and security; browser/UI/accessibility; failure, timeout,
retry, interruption, recovery, concurrency, and idempotency; feature-flag and production fail-closed; staging
end-to-end; provider test-mode; rollback and disabled-state; and regression tests for review findings and
production defects. Record `Not applicable` with a short reason when a layer does not apply.

Authentication, billing, account deletion, exports, quotas, alert delivery, migrations, retention, Queue/R2,
email delivery, and cross-account access require stronger evidence than copy-only changes. Critical D1 work
must exercise actual SQL preparation/execution, binding counts, constraints, relevant indexes, migration
application, and foreign-key-safe cleanup.

### Test efficiency

Keep deterministic fast checks on every PR. Run slower deployed staging/provider tests after staging
deployment or through controlled workflows. Do not generate high-volume records or paid-provider usage on
every PR. Reuse the staging isolation and cleanup contract in
[`docs/staging-e2e-resource-lifecycle.md`](./docs/staging-e2e-resource-lifecycle.md) for staging fixtures.
Prefer a few high-value behavioral tests over duplicated low-value assertions.

## Required verification

Run the checks relevant to the change. Before merging a normal product or Worker change, run:

```sh
npm test
npm run test:coverage
npm run test:e2e
npm run worker:check
npm run worker:deploy:dry-run
npm run worker:deploy:staging:dry-run
```

`npm test` includes the deterministic governance structure checks
(`test/governance.test.js`, also runnable alone via `npm run check:governance`). GitHub Actions remains the
authoritative routine gate; state any check that could not run and why.

## Release rules

- Pull requests must pass the required quality gate before merge.
- A merge to `main` automatically deploys only to staging after all checks pass.
- Staging has its own Worker and database and must never use production routes, data, or credentials.
- Production releases go only through the **Release PingStep to production** workflow, which rechecks `main`,
  requires the release confirmation input, and waits for the protected production approval.
- Do not bypass these controls with direct production deployments.
- After a merged change that affects runtime behavior, confirm the staging deployment and perform the relevant
  staging check before considering it complete.

## End of work

1. Commit and push authorized work, or explicitly report why it remains local and unverifiable.
2. Update the PR/issue with durable, non-sensitive evidence, including the requirement-to-evidence mapping.
3. Record incomplete criteria, blockers, manual/provider actions, and the exact next action.
4. Update `PROJECT-STATE.md` **only** when one of its material state categories changed — not for routine code
   changes or test reruns.
5. Leave the repository and branch state unambiguous for the next agent.

Work is not handed off merely because an agent wrote a chat summary. The copyable role-specific closeout
prompts are in the **AI project continuation** section of [`README.md`](./README.md).

### `PROJECT-STATE.md` write ownership

The implementation agent records factual evidence in its issue/PR first. The strategy/review agent
consolidates material project state into `PROJECT-STATE.md`, and may open a small dedicated branch/PR for that
file. It must not push into an implementation branch unless ownership is explicitly transferred. Avoid
competing simultaneous state updates for the same transition; while an implementation PR is active, prefer
recording transient facts in that PR and consolidating after review or merge.
