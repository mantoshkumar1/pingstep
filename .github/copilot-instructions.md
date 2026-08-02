# PingStep repository instructions

- PingStep monitors jobs from explicit lifecycle events. Do not add log scraping, implicit completion, or automatic failure inference.
- Preserve the lifecycle: `started`, `step`, `heartbeat`, `succeeded`, `failed`. A run is only terminal after an explicit terminal event.
- **Stale is not failed.** Stale means the service stopped receiving liveness updates; it cannot establish the job outcome.
- Never add secrets, sample production tokens, raw logs, SQL, customer data, or personal data to source, tests, docs, or fixtures.
- Job and viewer tokens are one-time values. Store only token hashes and never render values after provisioning.
- Event retries reuse the same `event_id` and identical payload; new facts use a new event ID and higher sequence number.
- Keep public copy plain, factual, and customer-neutral. Do not mention internal systems or imply unverified reliability claims.
- Run `npm test`, `npm run test:coverage`, and `npm run worker:check` after behavior changes. The Worker-core coverage gate is deliberate: do not lower it to make a change pass; add a regression test instead.
