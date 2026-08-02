import assert from 'node:assert/strict';
import test from 'node:test';
import { requireOperator, requireReadAccess } from '../src/worker/auth.ts';
import { requireSameOrigin } from '../src/worker/accounts.ts';
import { deleteJob, provisionJob, rotateJobTokens } from '../src/worker/operator.ts';
import { type AccountPlan, type AlertRecord, type RunProjection, type StoredBillingSubscription, type StoredEvent, type StoredJob, PingStepD1Repository } from '../src/worker/repository.ts';
import { HostedPingStepService, HttpError, type LifecycleEvent } from '../src/worker/service.ts';
import { createCheckout, createPortal, handleStripeWebhook, resolveBillingEntitlement } from '../src/worker/billing.ts';

const now = new Date('2026-08-02T00:00:00.000Z');

async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function stripeSignature(payload: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return `t=${timestamp},v1=${Array.from(signature).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const billingEnv = () => ({
  PUBLIC_ORIGIN: 'https://pingstep.dev', STRIPE_SECRET_KEY: 'sk_test_secret', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_PRO_PRICE_ID: 'price_pro', STRIPE_TEAM_PRICE_ID: 'price_team'
}) as Env;

class MemoryRepository {
  jobs = new Map<string, StoredJob>();
  events = new Map<string, StoredEvent>();
  runs = new Map<string, RunProjection>();
  pending = new Map<string, string>();
  alerts: AlertRecord[] = [];
  accountPlan: AccountPlan = { plan: 'trial', active_until: null };
  billingSubscriptions: StoredBillingSubscription[] = [];

  key(jobKey: string, runId: string) { return `${jobKey}/${runId}`; }
  async getJob(jobKey: string) { return this.jobs.get(jobKey) ?? null; }
  async getJobByViewerTokenHash(tokenHash: string) { return [...this.jobs.values()].find((job) => job.viewer_token_hash === tokenHash) ?? null; }
  async getEvent(eventId: string) { return this.events.get(eventId) ?? null; }
  async insertEvent(event: StoredEvent) { this.events.set(event.event_id, event); }
  async getRun(jobKey: string, runId: string) { return this.runs.get(this.key(jobKey, runId)) ?? null; }
  async upsertRun(run: RunProjection) { this.runs.set(this.key(run.job_key, run.run_id), run); }
  async clearPendingForRun(jobKey: string, runId: string) {
    for (const [id, event] of this.events) if (event.job_key === jobKey && event.run_id === runId) this.pending.delete(id);
  }
  async markPending(eventId: string, expiresAt: string) { this.pending.set(eventId, expiresAt); }
  async listProjectionEvents(jobKey: string, runId: string) {
    return [...this.events.values()]
      .filter((event) => event.job_key === jobKey && event.run_id === runId && !this.pending.has(event.event_id))
      .sort((left, right) => left.sequence - right.sequence || left.received_at.localeCompare(right.received_at));
  }
  async listExpiredRuns(at: string) { return [...this.runs.values()].filter((run) => run.status === 'running' && !!run.liveness_deadline && run.liveness_deadline <= at); }
  async markRunStale(run: RunProjection, at: string) {
    const stored = this.runs.get(this.key(run.job_key, run.run_id));
    if (!stored || stored.status !== 'running') return false;
    this.runs.set(this.key(run.job_key, run.run_id), { ...stored, status: 'stale', stale_at: at, stale_transitions: stored.stale_transitions + 1 });
    return true;
  }
  async createAlert(alert: AlertRecord) { if (!this.alerts.some((item) => item.id === alert.id)) this.alerts.push(alert); }
  async getAccountPlan() { return this.accountPlan; }
  async setAccountPlan(_userId: string, plan: AccountPlan['plan'], activeUntil: string | null) { this.accountPlan = { plan, active_until: activeUntil }; }
  async listBillingSubscriptionsForUser(userId: string) { return this.billingSubscriptions.filter((subscription) => subscription.user_id === userId); }
  async getBillingSubscription(subscriptionId: string) { return this.billingSubscriptions.find((subscription) => subscription.stripe_subscription_id === subscriptionId) ?? null; }
  async getBillingSubscriptionForUser(userId: string) {
    return this.billingSubscriptions.filter((subscription) => subscription.user_id === userId)
      .sort((left, right) => (left.status === 'active' ? -1 : 0) - (right.status === 'active' ? -1 : 0) || right.updated_at.localeCompare(left.updated_at))[0] ?? null;
  }
  async upsertBillingSubscription(subscription: StoredBillingSubscription) {
    const index = this.billingSubscriptions.findIndex((item) => item.stripe_subscription_id === subscription.stripe_subscription_id);
    if (index === -1) this.billingSubscriptions.push(subscription); else this.billingSubscriptions[index] = subscription;
  }
  async countRunsForOwnerSince() { return 0; }
  async countJobsForOwner() { return [...this.jobs.values()].filter((job) => job.owner_user_id === 'user-1').length; }
  async createJob(job: StoredJob) { this.jobs.set(job.job_key, job); }
  async rotateJobTokens(jobKey: string, ownerUserId: string, tokenHash: string, viewerTokenHash: string) {
    const job = this.jobs.get(jobKey);
    if (!job || job.owner_user_id !== ownerUserId) return false;
    this.jobs.set(jobKey, { ...job, token_hash: tokenHash, viewer_token_hash: viewerTokenHash });
    return true;
  }
  async deleteJobForOwner(jobKey: string, ownerUserId: string) {
    const job = this.jobs.get(jobKey);
    if (!job || job.owner_user_id !== ownerUserId) return false;
    this.jobs.delete(jobKey);
    for (const [id, event] of this.events) if (event.job_key === jobKey) this.events.delete(id);
    for (const [id, run] of this.runs) if (run.job_key === jobKey) this.runs.delete(id);
    return true;
  }
}

const repositoryForService = async () => {
  const repository = new MemoryRepository();
  repository.jobs.set('nightly', {
    job_key: 'nightly', token_hash: await hash('job-secret'), viewer_token_hash: await hash('viewer-secret'), owner_user_id: 'user-1',
    expected_update_interval_seconds: 60, liveness_grace_seconds: 30, expected_duration_seconds: null, late_grace_seconds: null
  });
  return repository;
};

const event = (overrides: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
  event_id: 'event-1', job_key: 'nightly', run_id: 'run-1', sequence: 1, type: 'started', occurred_at: now.toISOString(), data: {}, ...overrides
});

test('hosted lifecycle validates input and does not persist an invalid or unauthenticated event', async () => {
  const repository = await repositoryForService();
  const service = new HostedPingStepService(repository as unknown as PingStepD1Repository, () => now);
  await assert.rejects(() => service.ingest({ ...event(), sequence: 0 }, 'job-secret'), (error: HttpError) => error.status === 400);
  await assert.rejects(() => service.ingest(event(), 'wrong-secret'), (error: HttpError) => error.status === 401);
  assert.equal(repository.events.size, 0);
});

test('hosted lifecycle accepts a start, extends liveness on heartbeat, and makes terminal status final', async () => {
  const repository = await repositoryForService();
  let clock = now;
  const service = new HostedPingStepService(repository as unknown as PingStepD1Repository, () => clock);
  await service.ingest(event(), 'job-secret');
  clock = new Date('2026-08-02T00:00:45.000Z');
  await service.ingest(event({ event_id: 'event-2', sequence: 2, type: 'heartbeat', occurred_at: clock.toISOString() }), 'job-secret');
  assert.equal((await repository.getRun('nightly', 'run-1'))?.liveness_deadline, '2026-08-02T00:02:15.000Z');
  await service.ingest(event({ event_id: 'event-3', sequence: 3, type: 'succeeded', occurred_at: clock.toISOString(), data: { stage: 'Complete' } }), 'job-secret');
  const run = await repository.getRun('nightly', 'run-1');
  assert.equal(run?.status, 'succeeded');
  assert.equal(run?.liveness_deadline, null);
  assert.equal(run?.current_step, 'Complete');
});

test('hosted lifecycle preserves idempotency and enforces the free-plan run allowance', async () => {
  const repository = await repositoryForService();
  const service = new HostedPingStepService(repository as unknown as PingStepD1Repository, () => now);
  await service.ingest(event(), 'job-secret');
  assert.equal((await service.ingest(event(), 'job-secret')).duplicate, true);
  repository.countRunsForOwnerSince = async () => 10;
  await assert.rejects(() => service.ingest(event({ event_id: 'another', run_id: 'run-2' }), 'job-secret'), (error: HttpError) => error.status === 402);
});

test('stale reconciliation creates one alert and never repeats it', async () => {
  const repository = await repositoryForService();
  let clock = now;
  const service = new HostedPingStepService(repository as unknown as PingStepD1Repository, () => clock);
  await service.ingest(event(), 'job-secret');
  clock = new Date('2026-08-02T00:01:30.000Z');
  assert.equal(await service.reconcile(), 1);
  assert.equal(await service.reconcile(), 0);
  assert.equal((await repository.getRun('nightly', 'run-1'))?.status, 'stale');
  assert.equal(repository.alerts.length, 1);
});

test('job provisioning applies plan constraints and only persists token hashes', async () => {
  const repository = new MemoryRepository();
  await assert.rejects(() => provisionJob(repository as unknown as PingStepD1Repository, { job_key: 'fast-job', expected_update_interval_seconds: 29 }, 'user-1'), (error: HttpError) => error.status === 400);
  const result = await provisionJob(repository as unknown as PingStepD1Repository, { job_key: 'valid-job', expected_update_interval_seconds: 30 }, 'user-1');
  const stored = await repository.getJob('valid-job');
  assert.match(result.token, /^ps_job_[a-f0-9]{64}$/);
  assert.notEqual(stored?.token_hash, result.token);
  assert.equal(stored?.token_hash, await hash(result.token));
  await provisionJob(repository as unknown as PingStepD1Repository, { job_key: 'second-job' }, 'user-1');
  await assert.rejects(() => provisionJob(repository as unknown as PingStepD1Repository, { job_key: 'third-job' }, 'user-1'), (error: HttpError) => error.status === 402);
});

test('job token rotation and deletion require the exact job key and respect ownership', async () => {
  const repository = await repositoryForService();
  const priorHash = (await repository.getJob('nightly'))?.token_hash;
  await assert.rejects(() => rotateJobTokens(repository as unknown as PingStepD1Repository, 'nightly', { confirm_job_key: 'wrong' }, 'user-1'), (error: HttpError) => error.status === 400);
  const tokens = await rotateJobTokens(repository as unknown as PingStepD1Repository, 'nightly', { confirm_job_key: 'nightly' }, 'user-1');
  assert.match(tokens.token, /^ps_job_[a-f0-9]{64}$/);
  assert.notEqual((await repository.getJob('nightly'))?.token_hash, priorHash);
  await assert.rejects(() => deleteJob(repository as unknown as PingStepD1Repository, 'nightly', { confirm_job_key: 'nightly' }, 'someone-else'), (error: HttpError) => error.status === 404);
  await deleteJob(repository as unknown as PingStepD1Repository, 'nightly', { confirm_job_key: 'nightly' }, 'user-1');
  assert.equal(await repository.getJob('nightly'), null);
});

test('operator and viewer credentials enforce the intended read boundary', async () => {
  const repository = await repositoryForService();
  const env = { OPERATOR_TOKEN: 'operator-secret' } as Env;
  await requireOperator(new Request('https://pingstep.dev/v1/alerts', { headers: { authorization: 'Bearer operator-secret' } }), env);
  await assert.rejects(() => requireOperator(new Request('https://pingstep.dev/v1/alerts', { headers: { authorization: 'Bearer wrong' } }), env), (error: HttpError) => error.status === 401);
  assert.deepEqual(await requireReadAccess(new Request('https://pingstep.dev/v1/runs', { headers: { authorization: 'Bearer viewer-secret' } }), env, repository as unknown as PingStepD1Repository), { role: 'viewer', jobKey: 'nightly' });
  assert.deepEqual(await requireReadAccess(new Request('https://pingstep.dev/v1/runs', { headers: { authorization: 'Bearer operator-secret' } }), env, repository as unknown as PingStepD1Repository), { role: 'operator' });
});

test('write endpoints reject cross-site browser requests', () => {
  assert.throws(() => requireSameOrigin(new Request('https://pingstep.dev/v1/jobs', { headers: { origin: 'https://attacker.example' } })), (error: HttpError) => error.status === 403);
  assert.doesNotThrow(() => requireSameOrigin(new Request('https://pingstep.dev/v1/jobs', { headers: { origin: 'https://pingstep.dev' } })));
});

test('Stripe Checkout is server-created for the signed-in account and never trusts a browser price', async () => {
  const originalFetch = globalThis.fetch;
  const repository = new MemoryRepository();
  let request: Request | null = null;
  globalThis.fetch = async (input, init) => {
    request = typeof input === 'string' ? new Request(input, init) : input as Request;
    return Response.json({ url: 'https://checkout.stripe.com/c/pay_test' });
  };
  try {
    const checkout = await createCheckout(billingEnv(), repository as unknown as PingStepD1Repository, { id: 'user-1', email: 'engineer@example.test' }, 'pro');
    assert.equal(checkout.url, 'https://checkout.stripe.com/c/pay_test');
    assert.equal(request?.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(request?.headers.get('authorization'), 'Bearer sk_test_secret');
    const params = new URLSearchParams(await request?.text());
    assert.equal(params.get('mode'), 'subscription');
    assert.equal(params.get('line_items[0][price]'), 'price_pro');
    assert.equal(params.get('metadata[user_id]'), 'user-1');
    assert.equal(params.get('success_url'), 'https://pingstep.dev/app?checkout=success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed second checkout cannot revoke an existing paid entitlement', () => {
  const entitlement = resolveBillingEntitlement([
    { plan: 'pro', status: 'active', current_period_end: '2026-09-02T00:00:00.000Z' },
    { plan: 'team', status: 'incomplete', current_period_end: null }
  ], '2026-08-02T00:00:00.000Z');
  assert.deepEqual(entitlement, { plan: 'pro', active_until: '2026-09-02T00:00:00.000Z' });
});

test('billing entitlement ignores expired access and consistently chooses the higher paid plan on equal renewal dates', () => {
  assert.deepEqual(resolveBillingEntitlement([
    { plan: 'pro', status: 'active', current_period_end: '2026-08-01T23:59:59.000Z' },
    { plan: 'team', status: 'trialing', current_period_end: '2026-09-02T00:00:00.000Z' },
    { plan: 'pro', status: 'active', current_period_end: '2026-09-02T00:00:00.000Z' }
  ], '2026-08-02T00:00:00.000Z'), { plan: 'team', active_until: '2026-09-02T00:00:00.000Z' });
});

test('billing rejects unavailable configuration and Stripe checkout failures without creating a link', async () => {
  const repository = new MemoryRepository();
  await assert.rejects(() => createCheckout({ PUBLIC_ORIGIN: 'https://pingstep.dev' } as Env, repository as unknown as PingStepD1Repository, { id: 'user-1', email: 'engineer@example.test' }, 'pro'), (error: HttpError) => error.status === 503);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'declined' } }), { status: 402, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => createCheckout(billingEnv(), repository as unknown as PingStepD1Repository, { id: 'user-1', email: 'engineer@example.test' }, 'pro'), (error: HttpError) => error.status === 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an account with paid access cannot start a second checkout', async () => {
  const repository = new MemoryRepository();
  repository.billingSubscriptions.push({ stripe_subscription_id: 'sub_active', user_id: 'user-1', stripe_customer_id: 'cus_active', plan: 'pro', status: 'active', current_period_end: '2026-09-02T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z' });
  await assert.rejects(() => createCheckout(billingEnv(), repository as unknown as PingStepD1Repository, { id: 'user-1', email: 'engineer@example.test' }, 'team'), (error: HttpError) => error.status === 409);
});

test('a signed failed checkout preserves an earlier active paid plan', async () => {
  const repository = new MemoryRepository();
  repository.billingSubscriptions.push({ stripe_subscription_id: 'sub_pro', user_id: 'user-1', stripe_customer_id: 'cus_pro', plan: 'pro', status: 'active', current_period_end: '2026-09-02T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z' });
  repository.accountPlan = { plan: 'pro', active_until: '2026-09-02T00:00:00.000Z' };
  const payload = JSON.stringify({ type: 'customer.subscription.created', data: { object: { id: 'sub_team_failed' } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'sub_team_failed', customer: 'cus_team', status: 'incomplete', current_period_end: 1788307200, metadata: { user_id: 'user-1' }, items: { data: [{ price: { id: 'price_team' } }] } });
  try {
    await handleStripeWebhook(new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': await stripeSignature(payload, 'whsec_test_secret') }, body: payload }), billingEnv(), repository as unknown as PingStepD1Repository);
    assert.deepEqual(repository.accountPlan, { plan: 'pro', active_until: '2026-09-02T00:00:00.000Z' });
    assert.equal(repository.billingSubscriptions.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed prorated plan update preserves access already paid on the same subscription', async () => {
  const repository = new MemoryRepository();
  repository.billingSubscriptions.push({ stripe_subscription_id: 'sub_pro', user_id: 'user-1', stripe_customer_id: 'cus_pro', plan: 'pro', status: 'active', current_period_end: '2026-09-02T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z' });
  repository.accountPlan = { plan: 'pro', active_until: '2026-09-02T00:00:00.000Z' };
  const payload = JSON.stringify({ type: 'invoice.payment_failed', data: { object: { subscription: 'sub_pro' } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'sub_pro', customer: 'cus_pro', status: 'past_due', current_period_end: 1788307200, metadata: { user_id: 'user-1' }, items: { data: [{ price: { id: 'price_team' } }] } });
  try {
    await handleStripeWebhook(new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': await stripeSignature(payload, 'whsec_test_secret') }, body: payload }), billingEnv(), repository as unknown as PingStepD1Repository);
    assert.deepEqual(repository.accountPlan, { plan: 'pro', active_until: '2026-09-02T00:00:00.000Z' });
    assert.deepEqual(repository.billingSubscriptions[0], {
      stripe_subscription_id: 'sub_pro', user_id: 'user-1', stripe_customer_id: 'cus_pro', plan: 'team', status: 'past_due',
      current_period_end: '2026-09-02T00:00:00.000Z', updated_at: repository.billingSubscriptions[0].updated_at
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a signed terminal subscription event removes access when no paid subscription remains', async () => {
  const repository = new MemoryRepository();
  const payload = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_cancelled' } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'sub_cancelled', customer: 'cus_cancelled', status: 'canceled', current_period_end: 1788307200, metadata: { user_id: 'user-1' }, items: { data: [{ price: { id: 'price_pro' } }] } });
  try {
    await handleStripeWebhook(new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': await stripeSignature(payload, 'whsec_test_secret') }, body: payload }), billingEnv(), repository as unknown as PingStepD1Repository);
    assert.deepEqual(repository.accountPlan, { plan: 'trial', active_until: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook rejects unsigned, malformed, and oversized payloads before changing billing state', async () => {
  const repository = new MemoryRepository();
  const unsigned = new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', body: '{}' });
  await assert.rejects(() => handleStripeWebhook(unsigned, billingEnv(), repository as unknown as PingStepD1Repository), (error: HttpError) => error.status === 400);
  const malformed = '{';
  const malformedSignature = await stripeSignature(malformed, 'whsec_test_secret');
  await assert.rejects(() => handleStripeWebhook(new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': malformedSignature }, body: malformed }), billingEnv(), repository as unknown as PingStepD1Repository), (error: HttpError) => error.status === 400);
  const oversized = new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', headers: { 'content-length': '65537' }, body: '{}' });
  await assert.rejects(() => handleStripeWebhook(oversized, billingEnv(), repository as unknown as PingStepD1Repository), (error: HttpError) => error.status === 413);
  assert.equal(repository.billingSubscriptions.length, 0);
});

test('a completed Stripe checkout uses the checkout owner when its subscription is retrieved', async () => {
  const repository = new MemoryRepository();
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { subscription: 'sub_checkout', client_reference_id: 'user-1' } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'sub_checkout', customer: 'cus_checkout', status: 'active', current_period_end: 1788307200, metadata: {}, items: { data: [{ price: { id: 'price_pro' } }] } });
  try {
    await handleStripeWebhook(new Request('https://pingstep.dev/v1/billing/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': await stripeSignature(payload, 'whsec_test_secret') }, body: payload }), billingEnv(), repository as unknown as PingStepD1Repository);
    assert.deepEqual(repository.accountPlan, { plan: 'pro', active_until: '2026-09-02T00:00:00.000Z' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the billing portal selects the active subscription over a newer incomplete one', async () => {
  const repository = new MemoryRepository();
  repository.billingSubscriptions.push(
    { stripe_subscription_id: 'sub_active', user_id: 'user-1', stripe_customer_id: 'cus_active', plan: 'pro', status: 'active', current_period_end: '2026-09-02T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z' },
    { stripe_subscription_id: 'sub_failed', user_id: 'user-1', stripe_customer_id: 'cus_failed', plan: 'team', status: 'incomplete', current_period_end: null, updated_at: '2026-08-02T00:05:00.000Z' }
  );
  const originalFetch = globalThis.fetch;
  let request: Request | null = null;
  globalThis.fetch = async (input, init) => { request = typeof input === 'string' ? new Request(input, init) : input as Request; return Response.json({ url: 'https://billing.stripe.com/p/session/test_portal' }); };
  try {
    const portal = await createPortal(billingEnv(), repository as unknown as PingStepD1Repository, { id: 'user-1', email: 'engineer@example.test' });
    assert.equal(portal.url, 'https://billing.stripe.com/p/session/test_portal');
    assert.equal(new URLSearchParams(await request?.text()).get('customer'), 'cus_active');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
