import { type AlertRecord, PingStepD1Repository } from './repository';

function secret(env: Env, name: string): string | undefined {
  const value = Reflect.get(env, name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function payload(alert: AlertRecord) {
  return {
    id: alert.id,
    type: alert.type,
    job_key: alert.job_key,
    run_id: alert.run_id,
    status: alert.status,
    current_step: alert.current_step,
    message: alert.message,
    created_at: alert.created_at
  };
}

/**
 * No request is made unless ALERT_WEBHOOK_URL is configured as a Worker secret.
 * Failed delivery remains pending and is retried by the next scheduled run.
 */
export async function deliverPendingAlerts(repository: PingStepD1Repository, env: Env): Promise<number> {
  const url = secret(env, 'ALERT_WEBHOOK_URL');
  if (!url) return 0;
  const token = secret(env, 'ALERT_WEBHOOK_TOKEN');
  let delivered = 0;
  for (const alert of await repository.listPendingAlerts()) {
    const now = new Date().toISOString();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload(alert))
      });
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
      await repository.markAlertDelivered(alert.id, now);
      delivered += 1;
    } catch (error) {
      await repository.markAlertFailed(alert.id, now, error instanceof Error ? error.message : 'Webhook delivery failed.');
    }
  }
  return delivered;
}
