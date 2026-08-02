# Hosted validation record

**Scope:** Pre-launch synthetic validation only. No customer environment, customer job system, customer data, credentials, logs, or output were used.

## Passed on 2026-08-02

1. A synthetic job sent `Queue → Staging → Processing → Complete` to the deployed HTTPS endpoint.
2. D1 persisted the final projection as `succeeded`, with `Complete` as the current stage and `succeeded` as the terminal event type.
3. A separate synthetic job stopped reporting after `started`.
4. The deployed once-per-minute scheduled reconciliation changed that run to `stale` exactly once.
5. A synthetic `Error` run persisted as `failed / Error`.
6. A synthetic `Terminated` run persisted as `failed / Terminated`.

## Product boundary

This validates PingStep’s hosted service before launch. A customer-environment adapter test is deliberately deferred until a consenting customer uses the released product with a non-sensitive job.
