const RETRY_DELAY_MS = 60 * 1000;

export class WebhookAlertChannel {
  constructor({ url, token, fetchImpl = globalThis.fetch }) {
    this.url = url;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  get enabled() {
    return Boolean(this.url);
  }

  async send(alert) {
    if (!this.enabled) return { skipped: true };
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({
        type: `run.${alert.type}`,
        occurred_at: alert.created_at,
        job_key: alert.job_key,
        run_id: alert.run_id,
        status: alert.status,
        current_step: alert.current_step,
        message: alert.message
      })
    });
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
    return { delivered: true };
  }
}

export async function deliverPendingAlerts(store, channel, now = new Date()) {
  if (!channel.enabled) return { delivered: 0, failed: 0, skipped: Object.keys(store.data.alerts).length };
  let delivered = 0;
  let failed = 0;
  for (const alert of Object.values(store.data.alerts)) {
    const retryReady = !alert.last_attempt_at || Date.parse(alert.last_attempt_at) + RETRY_DELAY_MS <= now.getTime();
    if (alert.delivery_status === 'sent' || !retryReady) continue;
    alert.last_attempt_at = now.toISOString();
    alert.attempts = (alert.attempts ?? 0) + 1;
    try {
      await channel.send(alert);
      alert.delivery_status = 'sent';
      alert.delivered_at = now.toISOString();
      delete alert.last_error;
      delivered += 1;
    } catch (error) {
      alert.delivery_status = 'failed';
      alert.last_error = error.message;
      failed += 1;
    }
  }
  if (delivered || failed) await store.persist();
  return { delivered, failed, skipped: 0 };
}
