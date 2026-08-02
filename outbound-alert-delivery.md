# Outbound alert delivery

PingStep persists stale and late alert records first. It sends no external request unless an operator deliberately configures the following Worker secret:

```sh
npx wrangler secret put ALERT_WEBHOOK_URL
```

Optional bearer authentication for the receiving webhook is stored separately:

```sh
npx wrangler secret put ALERT_WEBHOOK_TOKEN
```

The scheduled Worker attempts each pending alert at most once per scheduled run. A successful `2xx` response marks it `delivered`; a failure stays `pending`, records the failure, and is retried on the next run. The payload contains only the alert ID, type, PingStep job/run IDs, status, stage, message, and timestamp—never raw logs, command output, payloads, or customer data.
