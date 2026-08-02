import assert from 'node:assert/strict';
import test from 'node:test';
import { requireOperator, requireReadAccess } from '../src/worker/auth.ts';
import { requireSameOrigin } from '../src/worker/accounts.ts';
import { deleteJob, provisionJob, rotateJobTokens } from '../src/worker/operator.ts';
import { type AccountPlan, type AlertRecord, type RunProjection, type StoredEvent, type StoredJob, PingStepD1Repository } from '../src/worker/repository.ts';
import { HostedPingStepService, HttpError, type LifecycleEvent } from '../src/worker/service.ts';

const now = new Date('2026-08-02T00:00:00.000Z');

async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class MemoryRepository {
  jobs = new Map<string, StoredJob>();
  events = new Map<string, StoredEvent>();
  runs = new Map<string, RunProjection>();
  pending = new Map<string, string>();
  alerts: AlertRecord[] = [];
  accountPlan: AccountPlan = { plan: 'trial', active_until: null };

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
