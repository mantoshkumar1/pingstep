## Scope

- **Authoritative issue:** #
- **Implementation slice:** what this PR actually delivers, in plain language.
- **Amendments covered:** confirm this PR maps evidence against the issue body **and every amendment comment**
  on that issue, not the original body alone. List the amendments considered, or `None — issue has no amendments`.
- **Explicitly out of scope:** what a reviewer should *not* expect here, and which issue owns it.

## Why this exists

Link the issue, incident, release note, advisory, or product need. A future reviewer should understand why
this pull request was created without reconstructing old conversations. For dependency updates, name the
package, old version, new version, and whether this is a security, bug-fix, or routine update.

## Requirement-to-evidence matrix

Map every applicable acceptance criterion to concrete evidence. A raw test count is not a substitute for
mapping important behavior. One row may cover several tightly related criteria only when the evidence
genuinely covers them. `Not applicable` requires a short reason.

| Requirement or acceptance criterion | Automated test / CI evidence | Manual, staging, or provider evidence | Status |
|---|---|---|---|
|  |  |  |  |

### Risk-based test layers considered

Mark each layer as covered, or `Not applicable` with a short reason: unit/domain; real D1 repository and
migration; API/authorization/tenant-isolation/security; browser/UI/accessibility; failure, timeout, retry,
interruption, recovery, concurrency, idempotency; feature-flag and production fail-closed; staging end-to-end;
provider test-mode; rollback and disabled-state; regression tests for review findings and defects.

- [ ] Critical database behavior is not accepted on in-memory mocks alone.
- [ ] Every defect found during review received a regression test (or a recorded exception).
- [ ] Tests prove the authoritative requirement rather than redefining it to match the implementation.
- [ ] Promised operator/founder/customer/admin actions are reachable and tested through the intended surface.
- [ ] Failure paths propagate to the externally observable exit code or status.

## Risk and compatibility

- **Schema/migrations:** new migration number, or `none`.
- **Feature flags and defaults:** including whether the feature is disabled by default.
- **Environment variables/secrets:** by **name only** — never values.
- **Cross-account, security, or privacy impact:**
- **Rollback or containment plan:**
- **Compatibility with existing clients and data:**
- [ ] This change adds no secrets, customer data, raw logs, or tokens to the repository.

## Verification

Required GitHub Actions checks must pass before merge. CI already enforces `npm test` (including the
governance structure checks), `test:coverage`, `test:e2e`, `worker:check`, `worker:deploy:dry-run`, and
`worker:deploy:staging:dry-run` — do not paste those routine logs here.

### Additional manual, staging, or provider verification

- [ ] None — CI covers everything.
- [ ] Performed — describe the scenario and result (non-sensitive evidence only):

## State handoff

- **Did this PR materially change [`PROJECT-STATE.md`](../PROJECT-STATE.md)?** `Yes` / `No`
- If `No`, state why no project-state update was required (routine PR detail belongs in the issue/PR).
- **Remaining manual or provider actions:**
- **Exact next action:**

## Merge guidance

State one of: **safe to merge after green CI**, **needs manual product review**, or **do not merge yet**, and
explain why. A merged PR is not `Done` while required staging, provider, migration, or founder evidence is
still outstanding.
