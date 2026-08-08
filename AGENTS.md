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

- **Founder (Mantosh)** — sole product, scope, priority, spending, launch, and **production promotion**
  authority. Only the founder merges into `main`.
- **Strategy/review agent** — analyzes, defines tasks, reviews issues/PRs, records founder-approved decisions
  and review findings. Must not promote its own recommendation to a settled decision, and must never merge into
  `main`.
- **Implementation agent** — implements the assigned slice, adds tests, reports evidence, surfaces unresolved
  questions. Must not make product decisions, convert assumptions into policy, push directly to `main`, or merge
  into `main`.

Merge authority is defined by **trust boundary**, not by tooling. See *Merge authority and the production
boundary* below: `main` is the production boundary and is permanently founder-controlled; any lower-trust
integration branch is governed separately and only by an explicit founder-approved change.

## Start of work

1. Read `PROJECT-STATE.md` completely.
2. Read this handbook and your tool-specific pointer (e.g. [`CLAUDE.md`](./CLAUDE.md)).
3. Inspect the authoritative issue, current branch, open pull requests, CI results, `main`, `migrations/`, and
   the Project board. When the issue has amendment comments, the body **plus every amendment** is the
   authoritative scope; later amendments supersede earlier generic wording.
4. Confirm no other agent owns the same issue, branch, migration number, or high-conflict files.
5. State the exact task boundary and verification plan before editing.

## Work safely

- Create a branch named `codex/<short-task-name>`, `claude/<short-task-name>`, or another clearly scoped non-`main` branch.
- **Never push, commit, edit, or update files directly on `main`. Every repository change must go through a pull request first.**
- Keep changes focused on one issue. Do not rebuild working features without a clear reason.
- Use plain English in issues, PRs, comments, and documentation.
- Never commit, print, or paste secrets, API keys, OAuth data, Stripe data, customer data, logs, payment
  details, or personal information — in code, tests, PRs, or `PROJECT-STATE.md`.
- Ask before destructive, paid, legal, account, or customer-impacting actions that are not clearly authorized
  by the issue.
- Do not deploy production as part of ordinary work.
- One agent owns one issue and one branch at a time.

## Merge authority and the production boundary

Authority here is defined by **trust boundary**, not by whatever GitHub happens to permit today. Three things
are deliberately kept separate, and conflating them is a governance defect:

1. **Production boundary** — permanent rules protecting `main`. These never relax.
2. **Current operating mode** — how things work *today*. Factual, temporary, and changeable by an explicit
   founder-approved governance change.
3. **Delegated integration authority** — bounded authority that *may* later be granted below the production
   boundary. Deferred, not in force.

### 1. Production boundary — permanent

`main` is the production boundary. These invariants bind every AI agent in every role — strategy/review agents
such as ChatGPT and implementation agents such as Claude and Codex alike. They hold under the current
shared-identity model, after any migration to a separate machine identity such as `mantosh-ai-bot`, and after
any future branching/deployment change. They are non-negotiable even when a tool technically permits otherwise.

**AI agents may** create: issues, branches, commits, pull requests, comments, reviews, tests, and evidence.

**No AI agent — in any role — may:**

- push, commit, edit, or update `main` directly;
- merge, or perform any merge action, **into `main`**;
- enable or queue **auto-merge into `main`**, or arrange for a merge into `main` to happen without the founder
  acting;
- use administrator rights, branch-protection or ruleset changes, API calls, CLI commands, credentials, or any
  other bypass capability to update `main` or merge into `main`.

**Every AI-created change targeting `main` terminates at an open, review-ready pull request.** That open PR is
the final state an AI agent may leave such a change in. When it is review-clean and all required evidence is
complete, the AI agent stops and presents it to the founder.

**Only the founder performs the final Merge action into `main`.** Capability in a GitHub API, CLI, connector,
or local credential does not grant production authority, and **review-clean is quality evidence, not
production authorization**. If settings appear to allow AI direct pushes, AI merges into `main`, or auto-merge
into `main`, treat that as a governance/settings gap to report — never as permission to use the capability.

### 2. Current operating mode — factual, not architectural

These statements describe how PingStep works **today**. They are current facts, not permanent architecture, and
they change only through an explicit founder-approved governance change:

- **There is no long-lived integration branch with delegated AI merge authority today.** Every change reaches
  `main` through a task branch → pull request → founder merge.
- **Because no such branch exists yet, AI merges nowhere and enables auto-merge nowhere.** This is a
  consequence of the current setup, not an additional permanent limitation.
- **Required approving reviews on `main` is 0** *while* AI pull requests are authored under the founder's own
  GitHub identity, because GitHub does not permit approving your own pull request. This count is **conditional
  on the shared-identity model, not permanent**; do not add a mandatory approving-review count while that
  condition holds, or every PR becomes unmergeable rather than safer.
- Because AI tools currently act through the founder's credentials, GitHub cannot mechanically distinguish a
  human merge click from an AI merge API call. The production boundary is therefore enforced today by policy
  and by these governance tests, not by GitHub permissions.
- **The founder's Merge action is itself the final authorization** under the current identity model; there is
  no separate approving review to wait for.

### 3. Delegated integration authority — deferred

[#197](https://github.com/mantoshkumar1/pingstep/issues/197) is founder-approved architecture but **deliberately
deferred and not in force**. It may later introduce a long-lived `staging` integration branch and, only after
[#196](https://github.com/mantoshkumar1/pingstep/issues/196) proves identity separation, grant
`mantosh-ai-bot` **bounded merge authority for pull requests into `staging`** — either an explicit AI merge or
a carefully bounded auto-merge. The exact mechanism is unsettled and belongs to #197's implementation.

Hard limit: **no delegated integration authority may ever extend to `main`.** Bounded authority over a lower
trust boundary never implies authority over the production boundary, and a change that reaches `staging` still
requires a founder-merged promotion pull request to reach production. Until #197 is implemented and
founder-approved, assume no AI merge authority anywhere.

### What each issue may change

- **#194** (this issue) establishes the production boundary above.
- **#196** may change **identity and approval mechanics** — for example raising the required approving-review
  count from 0 to 1 once AI pull requests come from a separate identity. It must not change production
  authority.
- **#197** may change **integration and deployment mechanics** — a `staging` branch, automatic staging
  deployment, bounded AI merge authority into `staging`, the promotion path, and what happens automatically
  after a founder merge to `main`. It must not change production authority.
- **Neither may weaken the production boundary.** Approval counts, branch topology, and deployment triggers are
  adjustable mechanism; founder-only merge into `main`, no AI updates to `main`, no AI merge or auto-merge into
  `main`, and no bypass use are not. Changing those requires a new explicit founder decision, not an
  implementation choice inside #196 or #197.

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

Run the checks relevant to the change. Before a normal product or Worker PR is handed to the founder for merge, run:

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

Deployment triggers are **current mechanism**, owned by [#158](https://github.com/mantoshkumar1/pingstep/issues/158)
and revisable by [#197](https://github.com/mantoshkumar1/pingstep/issues/197). The founder-only production
boundary above does not depend on them. As things stand **today**:

- Pull requests must pass the required quality gate before the founder may merge them.
- A founder merge to `main` currently deploys **only** to staging after all checks pass. #197 may later make a
  founder merge to `main` deploy production automatically; that would change the trigger, not who authorizes it.
- Staging has its own Worker and database and must never use production routes, data, or credentials.
- Production releases currently go only through the **Release PingStep to production** workflow, which rechecks
  `main`, requires the release confirmation input, and waits for the protected production approval. #197 may
  replace this routine ceremony once an automatic path is proven end to end.
- Do not bypass these controls with direct production deployments, and do not assume a future trigger is in
  place before it is implemented and founder-approved.
- After a merged change that affects runtime behavior, confirm the staging deployment and perform the relevant
  staging check before considering it complete.

## Issue closure on merge

- When one PR fully completes its authoritative issue, the PR body must contain `Closes #<issue>` (with the
  real issue number). GitHub should close that issue automatically when the founder merges the PR to `main`.
- When a PR is only a partial slice, use `Refs #<issue>` or another non-closing reference and state that the
  issue remains open. Never use a closing keyword for partial work.
- Do not close a completion issue early merely because implementation or review finished. The founder's PR merge is the normal
  closure event. After merge, verify that GitHub closed the issue automatically; if it did not, treat the
  missing/incorrect closing reference as a process defect rather than normalizing a manual close step.

## End of work

1. Commit and push authorized work to the task branch, or explicitly report why it remains local and unverifiable.
2. Update the PR/issue with durable, non-sensitive evidence, including the requirement-to-evidence mapping.
3. Record incomplete criteria, blockers, manual/provider actions, and the exact next action.
4. Update `PROJECT-STATE.md` **only** when one of its material state categories changed — not for routine code
   changes or test reruns.
5. If the PR is review-clean, stop and hand it to the founder — always for a PR into `main`, and today for
   every PR, since no delegated integration authority is in force.
6. Leave the repository and branch state unambiguous for the next agent.

Work is not handed off merely because an agent wrote a chat summary. The copyable role-specific closeout
prompts are in the **AI project continuation** section of [`README.md`](./README.md).

### `PROJECT-STATE.md` write ownership

The implementation agent records factual evidence in its issue/PR first. The strategy/review agent
consolidates material project state into `PROJECT-STATE.md`, and may open a small dedicated branch/PR for that
file. It must not push into an implementation branch unless ownership is explicitly transferred. Avoid
competing simultaneous state updates for the same transition; while an implementation PR is active, prefer
recording transient facts in that PR and consolidating after review or merge.
