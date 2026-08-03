# PingStep agent handbook

This repository is the shared handoff for every coding assistant. Read this file before planning or editing. It applies to Codex, Claude, and any other agent working here.

## What PingStep is

PingStep lets people monitor unattended jobs through explicit lifecycle events. Customer scripts send status updates; PingStep shows whether each run is active, stale, succeeded, or failed. It must not inspect customer systems, logs, credentials, or private job output.

## Source of truth

- GitHub issue: why the work exists, its scope, success criteria, and decisions.
- Pull request: exactly what changed, how it was verified, risks, and rollout result.
- GitHub Project board: only the current status — Todo, In Progress, or Done.
- `README.md`: product setup and the safe release path.

Do not rely on a chat transcript or require Mantosh to paste a handoff prompt. If information is missing, record the decision or question in the relevant GitHub issue in plain English.

## Start every task this way

1. Read `README.md`, this file, the assigned GitHub issue, and linked pull requests.
2. Inspect `git status`, the current branch, open pull requests, GitHub Actions checks, and the PingStep project board.
3. Confirm no other active pull request owns the same issue or files. One agent owns one issue and one branch at a time.
4. Give a short update: current state, task goal, plan, risks, and verification.
5. Move the issue to **In Progress** only when work actually starts.

## Work safely

- Create a branch named `codex/<short-task-name>` or `claude/<short-task-name>`.
- Keep changes focused on one issue. Do not rebuild working features without a clear reason.
- Use plain English in issues, PRs, comments, and documentation. Explain why the work matters and what “done” means.
- Never commit, print, or paste secrets, API keys, OAuth data, Stripe data, customer data, logs, payment details, or personal information.
- Ask before destructive, paid, legal, account, or customer-impacting actions that are not clearly authorized by the issue.
- Do not deploy production as part of ordinary work.

## Release rules

- Pull requests must pass the quality gate before merge.
- A merge to `main` automatically deploys only to staging after all checks pass.
- Staging is `https://pingstep-staging.mantoshk234.workers.dev` and has its own Worker and database. It must never use production routes, production data, or production credentials.
- Production is `https://pingstep.dev`. Release only through the GitHub workflow **Release PingStep to production**: it rechecks `main`, requires `RELEASE`, and waits for the protected production approval.
- Do not bypass these controls with direct production deployments.

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

State any check that could not run and why. After a merged change that affects runtime behavior, confirm the staging deployment and perform the relevant staging check before considering it complete.

## Finish every task this way

1. Create a pull request with a human-readable title and summary.
2. Include what changed, why, verification performed, known limitations, and rollout/staging result.
3. Merge only after required checks pass and the change is safe to merge.
4. Update the GitHub issue with durable, non-sensitive evidence and close it.
5. Move its project-board card to **Done** only after the task is genuinely complete.

## Current known limits

- Use Stripe Test mode on staging for payment experiments. Never copy live Stripe credentials into staging or make real purchases merely for testing.
- Google sign-in remains deferred until its public OAuth configuration is ready.
- Email alerts and the shared operations mailbox remain planned work, not implicit requirements for unrelated changes.
