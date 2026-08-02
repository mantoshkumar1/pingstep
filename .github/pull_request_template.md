## Change summary

Explain the user or system outcome in plain language. For dependency updates, name the package, old version, new version, and whether this is a security, bug-fix, or routine update.

## Why this exists

Link the issue, incident, release note, advisory, or product need. A future reviewer should be able to understand why this pull request was created without reconstructing old conversations.

## Risk and compatibility

- [ ] I reviewed the package or action release notes and breaking-change notes.
- [ ] I identified any user-visible, API, database, authentication, or deployment impact.
- [ ] This change does not add secrets, customer data, raw logs, or tokens to the repository.

## Verification

List the commands actually run and their result. For PingStep runtime changes, include the relevant subset of:

```sh
npm test
npm run test:e2e
npm run test:coverage
npm run worker:check
npm run worker:deploy:dry-run
```

## Merge guidance

State one of: **safe to merge after green CI**, **needs manual product review**, or **do not merge yet**, and explain why.
