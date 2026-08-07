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

- **Active issue:** [#190 — Require completed PRs to auto-close their authoritative issue](https://github.com/mantoshkumar1/pingstep/issues/190).
- **Active pull request:** [#191](https://github.com/mantoshkumar1/pingstep/pull/191).
- **Active branch:** `chatgpt/issue-auto-close-on-merge`.
- **`main` at branch creation:** commit `4cc6f72` (merge of PR #189 / #188 governance).

Check PR #191 for its current head SHA and CI result rather than copying those mutable values here.

## 6. Current implementation owner

ChatGPT strategy/review owns this narrow governance branch under the state-write rules established by
[#188](https://github.com/mantoshkumar1/pingstep/issues/188) and the explicit founder authorization recorded on
[#190](https://github.com/mantoshkumar1/pingstep/issues/190).

## 7. Recently completed work

- **[#188](https://github.com/mantoshkumar1/pingstep/issues/188) — shared AI project state and risk-based quality contract: completed.**
  Delivered by [PR #189](https://github.com/mantoshkumar1/pingstep/pull/189), merged to `main` as commit
  `4cc6f72`. The issue was manually closed because PR #189 lacked a GitHub closing keyword; #190 exists to
  prevent that manual close step for future completed tasks.
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
- **When one PR fully completes an issue, merging that PR should automatically close the issue via a GitHub
  closing keyword. Partial PRs must not use a closing keyword.** This founder decision and implementation
  authorization are recorded in [#190](https://github.com/mantoshkumar1/pingstep/issues/190).

### Current factual implementation state

- `main` at branch creation = commit `4cc6f72`.
- Latest migration remains `migrations/0009_e2e_registry.sql`; #190 adds no migration.
- PR #191 changes governance/process only: PR template, cross-agent instructions, state snapshot, and
  deterministic governance tests. It does not change product runtime behavior.
- Current branch-protection settings are mutable configuration facts; verify live GitHub settings before
  relying on them.

### Review findings and defects

- No review finding is currently recorded for PR #191. Review the actual pushed diff and exact-head CI before merge.

### Recommendations awaiting founder approval

- Consider a dedicated machine account if authorship-level separation between founder, strategy/review, and
  implementation agents becomes necessary.
- Consider adding the missing governance-oriented Project board Phase option when #181's board model is revised.

### Unresolved questions

- After #190 is complete, the next feature-level implementation slice must be selected under #181/founder authority.

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

- No product blocker is introduced by #190.
- PR #191 must pass the existing complete quality gate before merge.
- The final acceptance check for #190 is post-merge: GitHub must automatically close issue #190 because PR #191
  contains `Closes #190`.

## 11. Manual or provider actions required

- None for #190 beyond normal PR review/merge and verifying automatic issue closure afterward.
- Production release remains founder-controlled under #132 and is unrelated to this governance change.

## 12. Deferred and optional work

- Machine-account identity separation remains optional pending founder decision.
- Broader Project board state/Phase redesign remains owned by #181.
- Customer-facing feature work is outside #190.

## 13. Exact next action

Wait for PR [#191](https://github.com/mantoshkumar1/pingstep/pull/191) to have green CI on its final pushed head,
then strategy/review must inspect the actual diff and evidence. If review-clean, merge only after founder approval
recorded in [#190](https://github.com/mantoshkumar1/pingstep/issues/190). After merge, verify GitHub automatically
closes #190; if it does not, treat that as a process defect.

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
- **Verified by:** ChatGPT strategy/review agent for founder-authorized governance issue #190.
- **Source commit:** `4cc6f727953a416e09b85d56688aa750a397df3d` (`main` at branch creation).
- **Verification basis:** live GitHub state for #188, #190, PR #189, PR #191, `main`, and the repository files changed by #190.
