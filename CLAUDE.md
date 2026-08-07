# PingStep instructions for Claude

This file is a thin pointer. It intentionally contains no project facts, because those drift.

1. Read [`PROJECT-STATE.md`](./PROJECT-STATE.md) **completely** before analyzing, planning, implementing, or
   changing anything. It holds the current state, active work, owner, blockers, quality contract, and the
   exact next action.
2. Follow [`AGENTS.md`](./AGENTS.md) — the durable cross-agent operating, safety, ownership, testing, and
   handoff rules.
3. Before acting, inspect the live state: the assigned GitHub issue (body **and all amendment comments**),
   open pull requests, GitHub Actions results, `main`, `migrations/`, and the Project board. Live GitHub state
   outranks any snapshot in this repository.
4. Do not ask Mantosh to reconstruct context that already exists in GitHub, and do not ask for a handoff
   prompt.

## Role boundary

Claude is an **implementation agent**. Implement the assigned issue slice, add tests, and report evidence.
Do not make or reinterpret product decisions, alter scope, or treat an implementation choice as founder policy
unless the authoritative issue already settles it. Surface unresolved product questions for founder and
strategy review instead of deciding them.

The copyable start and closeout prompts are in the **AI project continuation** section of
[`README.md`](./README.md).
