## Change summary

Explain the user or system outcome in plain language. For dependency updates, name the package, old version, new version, and whether this is a security, bug-fix, or routine update.

## Why this exists

Link the issue, incident, release note, advisory, or product need. A future reviewer should be able to understand why this pull request was created without reconstructing old conversations.

## Risk and compatibility

- [ ] I reviewed the package or action release notes and breaking-change notes.
- [ ] I identified any user-visible, API, database, authentication, or deployment impact.
- [ ] This change does not add secrets, customer data, raw logs, or tokens to the repository.

## Verification

Required GitHub Actions checks must pass before merge.

### Additional manual or environment-specific verification

- [ ] None — CI covers everything.
- [ ] Performed — describe the scenario and result:

<!--
Only document manual verification here when:
- behavior cannot be verified automatically (e.g. visual review, staging walkthrough)
- staging or production validation was performed outside CI
- exceptional testing was required beyond what CI runs

CI already enforces: npm test, test:coverage, test:e2e, worker:check,
worker:deploy:dry-run, and worker:deploy:staging:dry-run.
Do not repeat these results here.
-->

## Merge guidance

State one of: **safe to merge after green CI**, **needs manual product review**, or **do not merge yet**, and explain why.
