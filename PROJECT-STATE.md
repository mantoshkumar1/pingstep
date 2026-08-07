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

Product scope and guarantees live in [`event-contract.md`](./event-contract.md) and [`README.md`](./README.md).

## 2. How to continue this project

1. Read this file completely.
2. Read [`AGENTS.md`](./AGENTS.md) and the relevant thin tool-specific pointer such as [`CLAUDE.md`](./CLAUDE.md).
3. Revalidate the authoritative issue, open pull requests, CI/Actions results, `main`, `migrations/`, and
   [Project board #3](https://github.com/users/mantoshkumar1/projects/3).
4. Confirm no other agent owns the same issue, branch, migration number, or high-conflict files.
5. State the exact task boundary and verification plan before editing.

The copyable session prompts are at the top of [`README.md`](./README.md).

## 3. Authority hierarchy

1. **Founder decision (Mantosh)** — sole product, scope, priority, spending, and launch authority.
2. **Authoritative GitHub issue** for product and engineering scope.
3. **Project board #3** for execution metadata and dependency state.
4. **Pull request, CI, staging, provider, and production evidence.**
5. **This file** as the concise current-state index.
6. **Durable repository documentation and runbooks.**
7. **Agent-specific pointer files.**
8. **Chat transcripts, temporary summaries, and local notes** — never authoritative.

### Role boundaries

- **Founder (Mantosh)** approves product direction, scope, priority, spending, launch, and every settled decision.
- **Strategy/review agent (e.g. ChatGPT)** analyzes, defines tasks, reviews issues/PRs, and records
  founder-approved decisions and review findings. It must not promote its own recommendation to policy.
- **Implementation agent (Claude/Codex)** implements assigned scope, adds tests, reports evidence, and surfaces
  unresolved questions. It must not make product decisions.

Issue [#181](https://github.com/mantoshkumar1/pingstep/issues/181) remains authoritative for launch ordering and
board governance. Issue [#132](https://github.com/mantoshkumar1/pingstep/issues/132) remains the sole final
production GO / CONDITIONAL GO / NO-GO authority.

## 4. Current launch status

Pre-launch. Production remains behind current `main`; production releases only through the manual protected
release workflow. Launch readiness remains owned by [#132](https://github.com/mantoshkumar1/pingstep/issues/132).

## 5. Active issue, pull request, branch, and commit

No feature-level implementation issue, pull request, branch, or owner is selected after completion of #190.
State-maintenance work may briefly exist to consolidate a completed transition; live GitHub is authoritative
for such transient maintenance activity and it does not select the next product/feature slice.

Current `main` includes the merge of PR [#191](https://github.com/mantoshkumar1/pingstep/pull/191), which
implemented the automatic issue-closure rule.

## 6. Current implementation owner

No feature-level implementation owner is selected. Selection of the next implementation slice remains under
[#181](https://github.com/mantoshkumar1/pingstep/issues/181) and founder authority.

## 7. Recently completed work

- **[#190](https://github.com/mantoshkumar1/pingstep/issues/190) — automatic issue closure on completion PR merge: completed.**
  [PR #191](https://github.com/mantoshkumar1/pingstep/pull/191) included a plain `Closes #190` reference; after
  the PR merged, GitHub automatically closed #190 as completed. This verified the new merge-driven closure rule
  end to end.
- **[#188](https://github.com/mantoshkumar1/pingstep/issues/188) — shared AI project state and risk-based quality contract: completed.**
  Delivered by [PR #189](https://github.com/mantoshkumar1/pingstep/pull/189). #188 required a manual close because
  that PR predated the #190 closing-keyword rule.
- **[#174](https://github.com/mantoshkumar1/pingstep/issues/174) — staging E2E isolation and cleanup: completed.**
- **[#158](https://github.com/mantoshkumar1/pingstep/issues/158) — GitHub Actions verification gate: completed.**

## 8. Settled decisions and authoritative links

### Founder-approved settled decisions

- The repository, not a chat transcript, is the durable project memory and quality authority
  ([#188](https://github.com/mantoshkumar1/pingstep/issues/188)).
- The founder is the sole product/priority decision authority; AI roles are bounded as described above
  ([#188 authority amendment](https://github.com/mantoshkumar1/pingstep/issues/188#issuecomment-5207393077)).
- Staging E2E fixtures are registry-driven, self-cleaning, and recoverable; broad prefix deletion is not
  recurring cleanup ([#174](https://github.com/mantoshkumar1/pingstep/issues/174)).
- Production deploys only through the manual tagged release path; `main` merges deploy staging only
  ([README safe release path](./README.md#safe-release-path)).
- When one PR fully completes an issue, merging that PR should automatically close the issue via a GitHub
  closing keyword. Partial PRs must not use a closing keyword
  ([#190](https://github.com/mantoshkumar1/pingstep/issues/190)).

### Current factual implementation state

- `main` contains the #188 governance foundation and the #190 automatic issue-closure process.
- Latest migration remains `migrations/0009_e2e_registry.sql`; neither #188 nor #190 added product schema work.
- Full-completion PRs now use `Closes #<issue>`; partial PRs use a non-closing reference such as
  `Refs #<issue>` and explicitly keep the issue open.
- Current branch-protection settings are mutable configuration facts; verify live GitHub settings before
  relying on them.

### Review findings and defects

- No open review finding is recorded for the completed #190 change. Future reviews must inspect actual pushed
  diffs and exact-head evidence rather than implementation summaries.

### Recommendations awaiting founder approval

- Consider a dedicated machine account if authorship-level separation between founder, strategy/review, and
  implementation agents becomes necessary.
- Consider adding the missing governance-oriented Project board Phase option when #181's board model is revised.

### Unresolved questions

- Which issue becomes the next PingStep implementation slice.

## 9. Testing and merge contract

Full rules live in [`AGENTS.md`](./AGENTS.md#quality-contract). Non-negotiable summary:

1. Every changed behavior has automated evidence at the lowest useful level.
2. Every applicable acceptance criterion maps to concrete evidence.
3. Every discovered defect gets a regression test unless automation is genuinely impossible and the exception is recorded.
4. Coverage is a guardrail, not proof.
5. Critical database behavior is not accepted on in-memory mocks alone.
6. Merged code is not `Done` while required staging/provider/migration/founder evidence remains.
7. Flaky reruns are not accepted as routine success.
8. Tests prove the authoritative contract rather than redefining it.
9. Promised actions must be reachable through their intended surface.
10. Critical workflow failures must propagate to externally observable status.
11. Implementation summaries are evidence pointers, not authoritative proof.
12. For a completed issue, the completion PR must carry a closing keyword so merge drives issue closure; partial
    PRs use a non-closing reference.

## 10. Known risks and blockers

- No feature-level implementation is currently selected.
- Production remains behind current `main`; any production-behavior claim must be checked against the released
  production version rather than assumed from `main`.
- The next implementation slice must satisfy #181 readiness/dependency rules before work begins.

## 11. Manual or provider actions required

- None for the completed #190 governance change.
- Production release remains founder-controlled under #132 and is unrelated to selecting the next development task.

## 12. Deferred and optional work

- Machine-account identity separation remains optional pending founder decision.
- Broader Project board state/Phase redesign remains owned by #181.
- Customer-facing work proceeds only through separately selected issues.

## 13. Exact next action

Inspect live Project board #3 and the authoritative open issues under [#181](https://github.com/mantoshkumar1/pingstep/issues/181),
then present the next eligible PingStep implementation slice for founder selection. Do not begin a new feature
issue until that selection is made.

## 14. State-update rules

Update this file only for material state changes: active issue/PR/owner, exact next action, critical path,
founder-approved decisions, blockers/manual actions, required environment evidence, or release-candidate state.
Routine test reruns and implementation detail remain in the PR/issue.

Additional rules:

- Link to authoritative sources rather than copying full contracts.
- Never include secrets, credentials, customer data, payment data, tokens, private logs, or personal data.
- No AI recommendation appears under founder-approved settled decisions without explicit founder approval.
- Implementation agents record factual evidence in the issue/PR first; strategy/review consolidates material
  state and avoids competing simultaneous state updates.

## 15. Last verified date, verifier, and source commit

- **Last verified:** 2026-08-07
- **Verified by:** ChatGPT strategy/review agent after completion of #190.
- **Source commit:** `b4dc491ae9ec2c851b4bc89f0abdf9e3e28df0d0` (merge of PR #191).
- **Verification basis:** live GitHub state for #188, #190, PR #189, PR #191, and `main`; automatic closure of #190 was directly verified after merge.
