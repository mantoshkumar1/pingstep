# PingStep project state

Single shared continuation entry point for humans and AI agents (founder, strategy/review, and implementation).
Read this file completely before analyzing, planning, implementing, reviewing, or changing anything.

> **Live GitHub state outranks this snapshot.** This file is a concise index, not a replacement for issues,
> pull requests, CI, or the Project board. Always revalidate against live GitHub before acting. If this file
> and GitHub disagree, GitHub is correct and this file needs updating.

---

## 1. Purpose and product objective

PingStep is progress-aware monitoring for long-running and unattended jobs. Engineers send explicit lifecycle
events; PingStep derives whether each run is active, stale, late, succeeded, or failed, and makes lost
visibility obvious.

PingStep never inspects customer systems, logs, credentials, or private job output. Product scope, guarantees,
and the event contract live in [`event-contract.md`](./event-contract.md) and [`README.md`](./README.md).

## 2. How to continue this project

1. Read this file completely.
2. Read [`AGENTS.md`](./AGENTS.md) (cross-agent operating rules) and your tool-specific pointer, e.g.
   [`CLAUDE.md`](./CLAUDE.md).
3. Revalidate live GitHub state: the authoritative issue, open pull requests, CI/Actions results, `main`,
   `migrations/`, and [Project board #3](https://github.com/users/mantoshkumar1/projects/3).
4. Confirm no other agent owns the same issue, branch, migration number, or high-conflict files.
5. State the exact task boundary and verification plan before editing.

The copyable start and closeout prompts for each role are in the **AI project continuation** section at the
top of [`README.md`](./README.md). You do not need to remember filenames or issue numbers.

## 3. Authority hierarchy

1. **Founder decision (Mantosh)** — sole product, scope, priority, spending, and launch authority.
2. **Authoritative GitHub issue** for product and engineering scope.
3. **[Project board #3](https://github.com/users/mantoshkumar1/projects/3)** for execution metadata and dependency state.
4. **Pull request, CI, staging, provider, and production evidence.**
5. **This file** as the concise current-state index.
6. **Durable repository documentation and runbooks** (e.g. [`docs/staging-e2e-resource-lifecycle.md`](./docs/staging-e2e-resource-lifecycle.md)).
7. **Agent-specific pointer files** ([`CLAUDE.md`](./CLAUDE.md)).
8. **Chat transcripts, temporary summaries, and local notes** — never authoritative.

### Role boundaries

- **Founder (Mantosh)** — approves product direction, scope, priority, spending, launch, and every settled
  decision.
- **Strategy/review agent (e.g. ChatGPT)** — analyzes options, defines tasks, reviews issues and PRs,
  identifies risks, and records founder-approved decisions and review findings in GitHub. It must not promote
  its own recommendation to a settled decision without explicit founder approval.
- **Implementation agent (Claude/Codex)** — implements the assigned issue slice, adds tests, reports evidence,
  and surfaces unresolved questions. It must not make product decisions, alter scope, or treat an
  implementation choice as founder policy unless the authoritative issue already settles it.

Issue [#181](https://github.com/mantoshkumar1/pingstep/issues/181) remains authoritative for launch order,
board metadata, WIP limits, dependencies, and issue readiness/completion.
Issue [#132](https://github.com/mantoshkumar1/pingstep/issues/132) remains the sole final production
GO / CONDITIONAL GO / NO-GO authority.

## 4. Current launch status

Pre-launch. Production ([pingstep.dev](https://pingstep.dev)) is live and serving, but no production release
has been cut from recent `main`: the only release tag is `v0.1.0-beta`, and production deploys only through the
manual **Release PingStep to production** workflow. Staging auto-deploys from `main` and currently runs
`staging-2a0e5ab`.

Launch readiness is owned by [#132](https://github.com/mantoshkumar1/pingstep/issues/132); execution order by
[#181](https://github.com/mantoshkumar1/pingstep/issues/181). Neither is complete.

## 5. Active issue, pull request, branch, and commit

- **Active issue:** [#188 — Establish shared AI project state and a risk-based quality contract](https://github.com/mantoshkumar1/pingstep/issues/188)
  (body **plus all owner amendment comments** form the authoritative scope).
- **Active branch:** `claude/188-shared-ai-project-state`, created from `main` at `2a0e5ab`.
- **Active pull request:** [#189](https://github.com/mantoshkumar1/pingstep/pull/189) — open, awaiting strategy/review.
  Check the PR itself for its current head SHA and CI result; those change and are not mirrored here.
- **`main` at last verification:** `2a0e5ab` (squash merge of PR #187).

## 6. Current implementation owner

Claude (implementation agent) owns issue #188 and branch `claude/188-shared-ai-project-state`.
One agent owns one issue and one branch at a time. No other agent may push to this branch unless ownership is
explicitly transferred by the founder.

## 7. Recently completed work

- **[#174](https://github.com/mantoshkumar1/pingstep/issues/174) — staging E2E isolation and cleanup: closed/completed.**
  Delivered by [PR #187](https://github.com/mantoshkumar1/pingstep/pull/187) (merged as `2a0e5ab` after six
  review rounds). All seven of the issue's staging-verification items were verified against live staging, and
  the one-time founder-approved legacy fixture cleanup was executed and verified empty. Evidence is recorded in
  the issue comments.
- **[#158](https://github.com/mantoshkumar1/pingstep/issues/158) — GitHub Actions as authoritative verification gate: completed.**
- **[#118](https://github.com/mantoshkumar1/pingstep/issues/118) — shared agent instructions: completed** (superseded in
  part by this issue's consolidation).

## 8. Settled decisions and authoritative links

### Founder-approved settled decisions

- The repository — not any chat transcript — is the durable project memory and quality authority (#188).
- The founder is the sole product/priority decision authority; strategy/review and implementation agents have
  the bounded roles described in section 3 (#188 amendments).
- Staging E2E fixtures must be registry-driven, self-cleaning, and recoverable; broad prefix deletion is never
  part of recurring cleanup ([#174](https://github.com/mantoshkumar1/pingstep/issues/174),
  [runbook](./docs/staging-e2e-resource-lifecycle.md)).
- Production deploys only via the manual tagged release workflow; merges to `main` deploy staging only
  ([README safe release path](./README.md)).
- Branch protection on `main`: required status check "Lint, test, and build", linear history, no force pushes,
  no branch deletions, conversation resolution required; PR approvals are **not** currently required
  (founder decision, 2026-08-07).

### Current factual implementation state

- `main` = `2a0e5ab`; only release tag = `v0.1.0-beta`; staging = `staging-2a0e5ab`.
- Latest migration = `migrations/0009_e2e_registry.sql`. Any new migration must take the next free number.
- Plan **limits** are defined in `src/worker/plans.ts` (`trial` / `pro` / `team`). Prices are **not** defined
  in that file; do not restate prices in agent files. Pricing/quota policy is owned by
  [#167](https://github.com/mantoshkumar1/pingstep/issues/167).
- Project board #3 currently exposes only `Todo` / `In Progress` / `Done`; the richer canonical states remain
  unimplemented work owned by [#181](https://github.com/mantoshkumar1/pingstep/issues/181).

### Review findings and defects

- No open review findings. The six review rounds on PR #187 are all resolved and were verified against the
  merged code, not against agent summaries.

### Recommendations awaiting founder approval

- Add a `Governance and foundation` option to the board **Phase** field (recommended by #188's metadata
  section; the option does not exist today, so #188's board item currently has no Phase set).
- Consider a dedicated machine account so implementation PRs can receive a real founder approval without the
  self-approval restriction (raised 2026-08-07; approval requirement removed for now instead).

### Unresolved questions

- Whether the next implementation wave follows #181's ordering directly or a founder-selected subset.

## 9. Testing and merge contract

Full rules live in [`AGENTS.md`](./AGENTS.md#quality-contract). Non-negotiable summary:

1. Every changed behavior has automated evidence at the lowest useful level.
2. Every applicable acceptance criterion maps to a named test, CI check, staging result, provider result, or
   documented manual verification — recorded in the PR's requirement-to-evidence matrix.
3. Every discovered defect gets a regression test before the fix is complete, unless automation is genuinely
   impossible and the reason is recorded.
4. Coverage is a guardrail, not proof of correctness. Do not add meaningless tests to raise coverage.
5. Critical database behavior is never accepted on in-memory mocks alone.
6. A merged PR is not `Done` while staging, provider, migration, or founder evidence remains required.
7. Flaky tests are defects. Rerunning until green is not success.
8. Tests verify behavior and guarantees, not private implementation details, where practical.
9. Tests must prove the authoritative requirement; a test that redefines the requirement to match the
   implementation is not valid evidence.
10. Promised operator/founder/customer/admin actions must be reachable and tested through the intended
    supported surface.
11. Failure propagation is part of correctness: verify externally observable exit codes and statuses.

## 10. Known risks and blockers

- **No blockers for #188.** PR #187 is merged and #174 is closed, so the sequencing precondition is satisfied.
  #188's remaining gate is ordinary review and merge of PR #189. Note that pushing a feature branch alone does
  not run the quality gate — it triggers on pull requests and on `main` — so treat CI evidence as existing only
  once a PR is open.
- Production runs an older build than `main`; any production-behavior claim must be verified against a
  released tag, not `main`.
- Playwright browser E2E cannot run in every sandbox (missing host browser libraries); CI is the authority for
  that layer.

## 11. Manual or provider actions required

- **Production release** (tag + approve the protected environment) — founder only, when #132 authorizes it.
- **Staging secrets** `E2E_CONTROL_TOKEN` and `OPERATOR_TOKEN` are set via `wrangler secret put`; their values
  live only in the founder's password manager and the two secret stores. Never place values in this repository.
- **Stripe** experiments use Test mode only; live credentials never reach staging.

## 12. Deferred and optional work

- Google sign-in is deferred until its public OAuth configuration is ready.
- Email alerts and the shared operations mailbox are planned work
  ([#178](https://github.com/mantoshkumar1/pingstep/issues/178) and related), not implicit requirements for
  unrelated changes.
- Future E2E resource adapters (Stripe, R2, Queue, accounts) are added by their own feature issues, per the
  [runbook's extension contract](./docs/staging-e2e-resource-lifecycle.md).

## 13. Exact next action

Review [PR #189](https://github.com/mantoshkumar1/pingstep/pull/189) (strategy/review agent) against issue
#188's body **and all five amendment comments**, then merge it before the next feature-level implementation
wave begins.

## 14. State-update rules

Update this file **only** when one of these materially changes: active issue or PR; implementation owner;
exact next action; launch scope or critical path; a settled product/architecture decision; a blocker or
manual/provider action; required staging/production evidence; release-candidate state.

Do **not** update it for routine code changes, test reruns, or ordinary PR detail — those belong in the PR and
issue. Additional rules:

- Keep it concise enough to read at the start of every session; link rather than copy issue bodies.
- Never turn it into an append-only activity log.
- Never claim a local commit exists unless it is pushed, or it is explicitly marked local-only and
  currently unverifiable.
- Never include secrets, credentials, customer data, payment data, tokens, private logs, or personal data.
- No AI recommendation appears under **Founder-approved settled decisions** until the founder explicitly
  approves it.
- **Write ownership:** the implementation agent records factual evidence in its issue/PR first; the
  strategy/review agent consolidates material state here, and may open a small dedicated branch/PR for this
  file. It must not push into an implementation branch unless ownership is transferred. Do not create
  competing simultaneous state updates for the same transition.

## 15. Last verified date, verifier, and source commit

- **Last verified:** 2026-08-07
- **Verified by:** Claude (implementation agent) for issue #188 — this file is #188's own deliverable, which is
  why an implementation agent authored it. Ongoing consolidation belongs to the strategy/review agent per
  section 14; this signature is not a precedent for implementation agents self-consolidating state.
- **Source commit:** `2a0e5ab` (`main` at branch creation)
- **Verification basis:** live GitHub issue/PR/board/CI state, live staging and production `/health`, and the
  working tree at the commit above.
