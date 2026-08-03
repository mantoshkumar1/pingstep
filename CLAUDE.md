# PingStep instructions for Claude

Read and follow [AGENTS.md](./AGENTS.md) before taking any action. It is the authoritative shared handbook for Claude, Codex, and future coding assistants.

Do not ask Mantosh for a handoff prompt. Use the repository, the assigned GitHub issue, pull requests, Actions results, and the PingStep project board as the durable working context.

## Quick context for new sessions

- **What PingStep is:** Progress-aware monitoring for long-running jobs. Engineers send lifecycle events; PingStep shows whether each run is active, stale, succeeded, or failed.
- **Stack:** Cloudflare Worker (TypeScript), D1 database, static HTML public site, Stripe billing (raw fetch, no SDK).
- **Task tracking:** GitHub Issues + [GitHub Project board #3](https://github.com/users/mantoshkumar1/projects/3) (columns: Todo, In Progress, Done). Always create an issue and add it to the board before starting work.
- **Branch naming:** `claude/<short-task-name>` or `codex/<short-task-name>`.
- **Tests before merge:** `npm test`, `npm run test:coverage`, `npm run worker:check`, `npm run worker:deploy:dry-run`.
- **Environments:** Local (`npm run worker:dev`), Staging (auto-deploys on merge to `main`), Production (`pingstep.dev`, manual release via tagged workflow).
- **Plans:** trial (free), pro ($12/mo), team ($39/mo). Defined in `src/worker/plans.ts`. Enforced in `src/worker/service.ts` and `src/worker/operator.ts`.
- **Public pages:** Static HTML in `public/`. Shared styles in `public/site.css`. Landing page (`landing.html`) uses inline styles. i18n via `public/locales/i18n.js`.
