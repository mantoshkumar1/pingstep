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

1. **Founder decision (Mantosh)** — sole product, scope, priority, spending, launch, and production authority;
   the only actor who merges into `main`.
2. **Authoritative GitHub issue** for product and engineering scope.
3. **Project board #3** for execution metadata and dependency state.
4. **Pull request, CI, staging, provider, and production evidence.**
5. **This file** as the concise current-state index.
6. **Durable repository documentation and runbooks.**
7. **Agent-specific pointer files.**
8. **Chat transcripts, temporary summaries, and local notes** — never authoritative.

### Role boundaries

- **Founder (Mantosh)** approves product direction, scope, priority, spending, launch, and every settled decision,
  and is the only actor who performs the final merge to `main`.
- **Strategy/review agent (e.g. ChatGPT)** analyzes, defines tasks, reviews issues/PRs, records founder-approved
  decisions and review findings, and must stop before any merge into `main`.
- **Implementation agent (Claude/Codex)** implements assigned scope, adds tests, reports evidence, surfaces
  unresolved questions, and must not push directly to `main` or merge into `main`.

Issue [#181](https://github.com/mantoshkumar1/pingstep/issues/181) remains authoritative for launch ordering and
board governance. Issue [#132](https://github.com/mantoshkumar1/pingstep/issues/132) remains the sole final
production GO / CONDITIONAL GO / NO-GO authority.

## 4. Current launch status

Pre-launch. Production remains behind current `main`; production releases only through the manual protected
release workflow. Launch readiness remains owned by [#132](https://github.com/mantoshkumar1/pingstep/issues/132).

## 5. Active issue, pull request, branch, and commit

- **Active governance issue:** [#194 — Enforce PR-only changes to main and founder-controlled merges](https://github.com/mantoshkumar1/pingstep/issues/194).
- **Active branch:** `chatgpt/pr-only-main`, created from `main` at commit `1625ca5`.
- **Active pull request:** [#195](https://github.com/mantoshkumar1/pingstep/pull/195) — targets `main`, open for
  CI and strategy/review. No AI agent may merge it into `main`; the founder performs that merge.
- No feature-level implementation slice is selected while #194 is being completed.

## 6. Current implementation owner

ChatGPT strategy/review owns the narrow #194 governance branch under explicit founder authorization. No
feature-level implementation owner is selected. AI ownership of the branch does not include authority to merge into `main`.

## 7. Recently completed work

- **[#190](https://github.com/mantoshkumar1/pingstep/issues/190) — automatic issue closure on completion PR merge: completed.**
  [PR #191](https://github.com/mantoshkumar1/pingstep/pull/191) included `Closes #190`; GitHub automatically
  closed #190 after merge, verifying the merge-driven closure rule end to end.
- **[#188](https://github.com/mantoshkumar1/pingstep/issues/188) — shared AI project state and risk-based quality contract: completed.**
- **[#174](https://github.com/mantoshkumar1/pingstep/issues/174) — staging E2E isolation and cleanup: completed.**
- **[#158](https://github.com/mantoshkumar1/pingstep/issues/158) — GitHub Actions verification gate: completed.**

## 8. Settled decisions and authoritative links

### Founder-approved settled decisions

- The repository, not a chat transcript, is the durable project memory and quality authority
  ([#188](https://github.com/mantoshkumar1/pingstep/issues/188)).
- The founder is the sole product/priority decision authority; AI roles are bounded
  ([#188 authority amendment](https://github.com/mantoshkumar1/pingstep/issues/188#issuecomment-5207393077)).
- Staging E2E fixtures are registry-driven, self-cleaning, and recoverable; broad prefix deletion is not
  recurring cleanup ([#174](https://github.com/mantoshkumar1/pingstep/issues/174)).
- **Current deployment mechanism** (a present-day fact, revisable by
  [#197](https://github.com/mantoshkumar1/pingstep/issues/197), not permanent architecture): production deploys
  only through the manual tagged release path, and a founder merge to `main` currently deploys staging only
  ([README safe release path](./README.md#safe-release-path)).
- Completion PRs auto-close their issue with a closing keyword; partial PRs use non-closing references
  ([#190](https://github.com/mantoshkumar1/pingstep/issues/190)).
- **`main` is the production boundary.** All changes reach `main` through a pull request. No AI agent may
  update `main` directly, merge into `main`, enable or queue auto-merge into `main`, or use any bypass
  capability to do so. Every AI-created change targeting `main` ends at an open, review-ready pull request, and
  **only the founder performs the final merge into `main`**. Review-clean is quality evidence, not production
  authorization ([#194](https://github.com/mantoshkumar1/pingstep/issues/194)).
- **Authority is defined by trust boundary, not by current tooling.** The production boundary above is
  permanent. Branch topology, approval counts, and deployment triggers are adjustable mechanism:
  [#196](https://github.com/mantoshkumar1/pingstep/issues/196) may change identity/approval mechanics and
  [#197](https://github.com/mantoshkumar1/pingstep/issues/197) may change integration/deployment mechanics, but
  neither may weaken the production boundary without a new explicit founder decision
  ([#194](https://github.com/mantoshkumar1/pingstep/issues/194)).
- **Deferred, founder-approved architecture — not implemented:**
  [#197](https://github.com/mantoshkumar1/pingstep/issues/197) defines a future `staging` integration branch
  with automatic staging deployment and a guarded `staging → main` promotion pull request. Per the founder's
  [correction](https://github.com/mantoshkumar1/pingstep/issues/197#issuecomment-5226941072), the production
  candidate is **deployed and fully validated before** any merge into `main`; stale evidence is invalid if
  `main` or the candidate changes; the founder merges only once that pre-production evidence is green; the
  merge into `main` is production *authorization*, not the start of first-time validation; post-merge
  production checks are smoke/read-back only; and durable release tags remain required as audit identity. It
  also defines emergency provider rollback reconciled by a forward revert PR. It may later grant
  `mantosh-ai-bot` **bounded merge authority for pull requests into `staging`** (only after #196 proves
  identity separation) and it can never extend that authority to `main`. Nothing in #197 is in force today.
- **Approval model under the shared founder identity: required approving reviews on `main` stays 0.** GitHub
  forbids approving your own pull request, and PRs are authored under the founder's identity, so a mandatory
  approval count would make every PR unmergeable rather than safer. A strategy/review "review-clean" verdict is
  quality evidence, **not** merge authorization; **the founder's Merge action is itself the final
  authorization**. A founder approving review may be required later if AI work moves to a separate bot/machine
  identity ([#194 founder clarification](https://github.com/mantoshkumar1/pingstep/issues/194#issuecomment-5225904836)).
- **A dedicated AI machine account, `mantosh-ai-bot`, has been created, and migrating AI GitHub operations to it
  is deferred to [#196](https://github.com/mantoshkumar1/pingstep/issues/196).** This is a founder-approved
  decision, no longer a recommendation awaiting approval. #196 does **not** block completion of #194: the
  0-approval model stands while AI PRs are authored under the founder identity, and #196 may raise the required
  approval count only after identity separation is proven. No migration and no approval-count change happens in
  the #194 pull request.

### Current factual implementation state

- `main` currently points at `1625ca5`.
- **`main` branch protection as observed on 2026-08-08** — a mutable configuration fact, and a point-in-time
  reading rather than a standing guarantee. It was read from `GET /repos/{owner}/{repo}/branches/main/protection`
  by an agent whose credentials carry the required scope; **not every connected AI integration can read that
  endpoint**, so an agent that cannot must verify in repository settings rather than assume this snapshot is
  still true. Values observed: require a pull request before merging **enabled** with required approving reviews
  **0**; required status check `Lint, test, and build` with strict up-to-date branches; conversation resolution
  required; force pushes blocked; deletions blocked; linear history required; protections applied to
  administrators (`enforce_admins`). Before #194, "require a pull request before merging" was not enforced;
  that gap is closed. **No branch-protection or repository setting was changed in the current #194 pass.**
- Latest migration remains `migrations/0009_e2e_registry.sql`; #194 adds no product schema work.

### Review findings and defects

- No review finding is recorded yet for #194. Review must inspect the actual pushed diff and exact-head CI.

### Recommendations awaiting founder approval

- Consider adding the missing governance-oriented Project board Phase option when #181's board model is revised.

### Unresolved questions

- Which feature issue becomes the next PingStep implementation slice after #194 is completed.

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
12. For a completed issue, the completion PR carries a closing keyword; partial PRs use a non-closing reference.
13. Every change to `main` goes through a PR; AI agents stop before merging into `main`; only the founder
    performs the final merge into `main`. (Today, with no delegated integration branch, AI merges nowhere at
    all — that stricter rule is current operating mode, not permanent authority.)

## 10. Known risks and blockers

- #194 is governance-only and introduces no product runtime blocker.
- Branch-protection visibility depends on the acting credential: some connected integrations cannot read the
  protection endpoint. An agent that cannot read it must verify in repository settings and must not restate the
  snapshot in section 8 as if it had confirmed it.
- Because current connected AI tools act through the founder's GitHub identity, repository policy is required to
  distinguish human merge authority from AI tool capability. The separate `mantosh-ai-bot` identity is the
  stronger control and is founder-approved, but deferred to
  [#196](https://github.com/mantoshkumar1/pingstep/issues/196), so policy and tests carry the boundary today.

## 11. Manual or provider actions required

- **No manual branch-protection action is outstanding.** All seven protections #194 asks for are enabled and
  were verified against the live API (see *Current factual implementation state*). Re-verify in repository
  settings if anything appears inconsistent; do not weaken a protection to make CI or merging easier.
- Do not enable a required human approval count while AI pull requests are authored under the founder identity —
  self-approval is impossible, so the requirement would deadlock every PR. Raising it is
  [#196](https://github.com/mantoshkumar1/pingstep/issues/196)'s decision, after identity separation is proven.
- **Current operating mode (temporary, not permanent architecture):** the founder performs every merge
  manually, AI merges nowhere today, and auto-merge stays disabled everywhere. This is stricter than the
  permanent boundary because no delegated integration branch exists yet;
  [#197](https://github.com/mantoshkumar1/pingstep/issues/197) may later delegate bounded merge authority into
  `staging`. What is permanent is only the `main` boundary: no AI merge, auto-merge, or bypass into `main`.

## 12. Deferred and optional work

- **Migration of AI GitHub operations to the `mantosh-ai-bot` machine identity is founder-approved and
  intentionally deferred — not optional and not a pending recommendation.** The account has been created; the
  migration will be done later, is owned by [#196](https://github.com/mantoshkumar1/pingstep/issues/196), and
  does not block #194.
- Broader Project board state/Phase redesign remains owned by #181.
- Customer-facing work proceeds only through separately selected issues.

## 13. Exact next action

Wait for exact-head CI on [PR #195](https://github.com/mantoshkumar1/pingstep/pull/195), then perform strategy/review
against the actual diff. If review-clean, stop and present the PR to the founder. **Merge only after founder approval,
and only the founder performs that final merge into `main`.** The PR contains `Closes #194`, so the issue closes only
when the founder merges it.

## 14. State-update rules

Update this file only for material state changes: active issue/PR/owner, exact next action, critical path,
founder-approved decisions, blockers/manual actions, required environment evidence, or release-candidate state.
Routine test reruns and implementation detail remain in the PR/issue.

Additional rules:

- Link to authoritative sources rather than copying full contracts.
- Never include secrets, credentials, customer data, payment data, tokens, private logs, or personal data.
- No AI recommendation appears under founder-approved settled decisions without explicit founder approval.
- No AI agent may update `main` directly, and no AI agent may merge into `main`; all repository edits are
  proposed through task branches and pull requests. (Today AI merges nowhere at all — current operating mode.)
- Implementation agents record factual evidence in the issue/PR first; strategy/review consolidates material
  state and avoids competing simultaneous state updates.

## 15. Last verified date, verifier, and source commit

- **Last verified:** 2026-08-08
- **Verified by:** ChatGPT strategy/review agent for founder-authorized governance issue #194.
- **Source commit:** `1625ca521901fafaef767417cc2163d40b862538` (`main` at branch creation).
- **Verification basis:** live GitHub issue/PR/branch state, `main` branch metadata, and repository governance files.
