import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  acknowledgeCleanup, completeRun, getRunStatus, isE2EControlEnabled, legacyInventory, performCleanup,
  registerResource, registerRun, requestCleanup, requireE2EControl, resetCleanup
} from '../src/worker/e2e-control.ts';
import { runE2EJanitor } from '../src/worker/e2e-janitor.ts';
import { HttpError } from '../src/worker/service.ts';
import { E2ERegistryRepository, type E2ECleanupStatus, type E2EResourceLifecycle, type E2EResourceType, type E2ERunStatus, type E2ETestResource, type E2ETestRun } from '../src/worker/e2e-registry.ts';

const now = new Date('2026-08-06T00:00:00.000Z');

type FakeJobRow = { owner_user_id: string | null; created_at: string };

/**
 * In-memory fake that mirrors E2ERegistryRepository's method signatures
 * (same structural-typing pattern the rest of this codebase uses for
 * PingStepD1Repository, see MemoryRepository in worker-core.test.ts) plus a
 * minimal fake of the ordinary `jobs`/events/runs/alerts/pending_events
 * tables so the cleanup adapter's ownership checks and row-removal can be
 * exercised end-to-end at the business-logic layer.
 */
class MemoryE2ERegistryRepository {
  runs = new Map<string, E2ETestRun>();
  resources = new Map<string, E2ETestResource>();
  jobs = new Map<string, FakeJobRow>();
  jobRelatedRowCounts = new Map<string, number>(); // job_key -> count of events+runs+alerts+pending rows
  forceRowsRemainAfterCleanup = new Set<string>();

  key(runId: string, type: string, ref: string) { return `${runId}/${type}/${ref}`; }

  async insertRun(run: { id: string; suite: string; source: E2ETestRun['source']; github_run_id: string | null; github_run_attempt: string | null; commit_sha: string | null; created_at: string; expires_at: string }) {
    this.runs.set(run.id, {
      ...run, status: 'registered', cleanup_status: 'not_started', failure_phase: null, failure_code: null,
      created_resource_count: 0, cleaned_resource_count: 0, completed_at: null, cleanup_started_at: null, cleaned_at: null
    });
  }
  async getRun(id: string) { return this.runs.get(id) ?? null; }
  async setRunStatus(id: string, status: E2ERunStatus, now2: string, failurePhase: string | null, failureCode: string | null) {
    const run = this.runs.get(id);
    if (!run || (run.status !== 'registered' && run.status !== 'running')) return false;
    this.runs.set(id, { ...run, status, completed_at: now2, failure_phase: failurePhase, failure_code: failureCode });
    return true;
  }
  async markRunRunning(id: string) {
    const run = this.runs.get(id);
    if (run && run.status === 'registered') this.runs.set(id, { ...run, status: 'running' });
  }
  async acquireCleanupLease(id: string, now2: string, leaseExpiryIso: string) {
    const run = this.runs.get(id);
    if (!run) return false;
    const canLease =
      run.cleanup_status === 'not_started' ||
      run.cleanup_status === 'pending' ||
      (run.cleanup_status === 'in_progress' && run.cleanup_started_at !== null && run.cleanup_started_at <= leaseExpiryIso);
    if (!canLease) return false;
    this.runs.set(id, { ...run, cleanup_status: 'in_progress', cleanup_started_at: now2 });
    return true;
  }
  async finishCleanup(id: string, status: E2ECleanupStatus, now2: string, cleanedCount: number) {
    const run = this.runs.get(id);
    if (!run) return;
    const isTerminal = status === 'completed' || status === 'completed_with_absent_resources' || status === 'operator_acknowledged';
    this.runs.set(id, { ...run, cleanup_status: status, cleaned_at: isTerminal ? now2 : null, cleaned_resource_count: cleanedCount });
  }
  async acknowledgeCleanup(id: string, now2: string) {
    const run = this.runs.get(id);
    if (!run || run.cleanup_status !== 'requires_operator') return false;
    this.runs.set(id, { ...run, cleanup_status: 'operator_acknowledged', cleaned_at: now2 });
    return true;
  }
  async resetCleanup(id: string) {
    const run = this.runs.get(id);
    if (!run || run.cleanup_status !== 'requires_operator') return false;
    this.runs.set(id, { ...run, cleanup_status: 'pending', cleanup_started_at: null });
    return true;
  }
  async requestCleanup(id: string) {
    const run = this.runs.get(id);
    if (!run || run.cleanup_status !== 'not_started') return false;
    this.runs.set(id, { ...run, cleanup_status: 'pending' });
    return true;
  }
  async listExpiredRuns(now2: string, limit: number, leaseExpiryIso: string) {
    return [...this.runs.values()]
      .filter((r) => r.expires_at <= now2 && (
        r.cleanup_status === 'not_started' ||
        r.cleanup_status === 'pending' ||
        (r.cleanup_status === 'in_progress' && r.cleanup_started_at !== null && r.cleanup_started_at <= leaseExpiryIso)
      ))
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
      .slice(0, limit);
  }
  async registerResource(resource: { run_id: string; resource_type: E2EResourceType; resource_ref: string; subtype: string | null; lifecycle: E2EResourceLifecycle; now: string }) {
    const key = this.key(resource.run_id, resource.resource_type, resource.resource_ref);
    if (this.resources.has(key)) return 'already_registered' as const;
    this.resources.set(key, {
      run_id: resource.run_id, resource_type: resource.resource_type, resource_ref: resource.resource_ref,
      subtype: resource.subtype, lifecycle: resource.lifecycle, cleanup_attempts: 0, cleanup_failure_code: null,
      created_at: resource.lifecycle === 'created' ? resource.now : null, cleaned_at: null
    });
    return 'inserted' as const;
  }
  async getResource(runId: string, type: E2EResourceType, ref: string) {
    return this.resources.get(this.key(runId, type, ref)) ?? null;
  }
  async listResourcesForRun(runId: string) {
    return [...this.resources.values()].filter((r) => r.run_id === runId);
  }
  async markResourceLifecycle(runId: string, type: E2EResourceType, ref: string, lifecycle: E2EResourceLifecycle, now2: string, failureCode: string | null = null) {
    const key = this.key(runId, type, ref);
    const resource = this.resources.get(key);
    if (!resource) return;
    if (lifecycle === 'created') this.resources.set(key, { ...resource, lifecycle, created_at: now2 });
    else if (lifecycle === 'cleaned' || lifecycle === 'absent') this.resources.set(key, { ...resource, lifecycle, cleaned_at: now2, cleanup_failure_code: null });
    else if (lifecycle === 'cleanup_failed') this.resources.set(key, { ...resource, lifecycle, cleanup_attempts: resource.cleanup_attempts + 1, cleanup_failure_code: failureCode });
    else this.resources.set(key, { ...resource, lifecycle });
  }
  async incrementCreatedResourceCount(runId: string) {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, created_resource_count: run.created_resource_count + 1 });
  }
  async findCandidateJob(jobKey: string) {
    return this.jobs.get(jobKey) ?? null;
  }
  async cleanupJobResource(jobKey: string) {
    if (!this.jobs.has(jobKey)) return { jobDeleted: false };
    if (this.forceRowsRemainAfterCleanup.has(jobKey)) return { jobDeleted: true }; // simulate a delete that doesn't fully take
    this.jobs.delete(jobKey);
    this.jobRelatedRowCounts.delete(jobKey);
    return { jobDeleted: true };
  }
  async countJobOwnedRows(jobKey: string) {
    if (this.forceRowsRemainAfterCleanup.has(jobKey)) return 3;
    return (this.jobs.has(jobKey) ? 1 : 0) + (this.jobRelatedRowCounts.get(jobKey) ?? 0);
  }
  async legacyInventory(limit: number) {
    return [...this.jobs.keys()]
      .filter((key) => key.startsWith('e2e-late-') && ![...this.resources.values()].some((r) => r.resource_type === 'job' && r.resource_ref === key))
      .slice(0, limit)
      .map((job_key) => ({ job_key, created_at: this.jobs.get(job_key)!.created_at, run_count: 0, event_count: 0, alert_count: 0 }));
  }
  async purgeOldRegistryRows(before: string, limit: number) {
    let purged = 0;
    for (const [id, run] of this.runs) {
      if (purged >= limit) break;
      if (run.cleaned_at && run.cleaned_at <= before) { this.runs.delete(id); purged += 1; }
    }
    return purged;
  }
}

function repo(): E2ERegistryRepository {
  return new MemoryE2ERegistryRepository() as unknown as E2ERegistryRepository;
}

test('registerRun validates fields and generates a UUID when none is supplied', async () => {
  const repository = repo();
  await assert.rejects(() => registerRun(repository, { suite: 'late-run' }, now), (error: HttpError) => error.status === 400); // missing source
  await assert.rejects(() => registerRun(repository, { suite: 'late-run', source: 'not-a-source' }, now), (error: HttpError) => error.status === 400);
  const { run } = await registerRun(repository, { suite: 'late-run', source: 'local_manual' }, now);
  assert.match(run.id, /^[0-9a-f-]{36}$/);
  assert.equal(run.status, 'running');
  assert.equal(run.cleanup_status, 'not_started');
});

test('registerRun is idempotent for a repeated id with matching suite/source, and conflicts otherwise', async () => {
  const repository = repo();
  const id = '11111111-1111-4111-8111-111111111111';
  const first = await registerRun(repository, { id, suite: 'late-run', source: 'github_push' }, now);
  const second = await registerRun(repository, { id, suite: 'late-run', source: 'github_push' }, now);
  assert.equal(first.run.id, second.run.id);
  await assert.rejects(() => registerRun(repository, { id, suite: 'other-suite', source: 'github_push' }, now), (error: HttpError) => error.status === 409);
});

test('registerRun rejects a malformed caller-supplied id', async () => {
  const repository = repo();
  await assert.rejects(() => registerRun(repository, { id: 'not-a-uuid', suite: 'late-run', source: 'local_manual' }, now), (error: HttpError) => error.status === 400);
});

test('registerResource rejects unknown resource types and malformed refs', async () => {
  const repository = repo();
  const { run } = await registerRun(repository, { suite: 'late-run', source: 'local_manual' }, now);
  await assert.rejects(() => registerResource(repository, run.id, { resource_type: 'r2_object', resource_ref: 'anything' }, now), (error: HttpError) => error.status === 400);
  await assert.rejects(() => registerResource(repository, run.id, { resource_type: 'job', resource_ref: 'not-prefixed' }, now), (error: HttpError) => error.status === 400);
});

test('registerResource cannot claim a job that does not exist, is owned, or predates the run', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);

  // Does not exist yet.
  await assert.rejects(
    () => registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-abc', lifecycle: 'created' }, now),
    (error: HttpError) => error.status === 409
  );

  // Owned by a real customer.
  repository.jobs.set('e2e-late-owned', { owner_user_id: 'user-1', created_at: now.toISOString() });
  await assert.rejects(
    () => registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-owned', lifecycle: 'created' }, now),
    (error: HttpError) => error.status === 409
  );

  // Predates the run's creation window (pre-existing unrelated resource).
  repository.jobs.set('e2e-late-old', { owner_user_id: null, created_at: new Date(now.getTime() - 60_000).toISOString() });
  await assert.rejects(
    () => registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-old', lifecycle: 'created' }, now),
    (error: HttpError) => error.status === 409
  );

  // Valid: created within the run's window, no owner.
  repository.jobs.set('e2e-late-valid', { owner_user_id: null, created_at: new Date(now.getTime() + 1000).toISOString() });
  const { resource } = await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-valid', lifecycle: 'created' }, now);
  assert.equal(resource?.lifecycle, 'created');
});

test('registerResource is idempotent and supports a planned -> created transition', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  const planned = await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-plan' }, now);
  assert.equal(planned.resource?.lifecycle, 'planned');
  const replay = await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-plan' }, now);
  assert.equal(replay.resource?.lifecycle, 'planned');

  repository.jobs.set('e2e-late-plan', { owner_user_id: null, created_at: now.toISOString() });
  const created = await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-plan', lifecycle: 'created' }, now);
  assert.equal(created.resource?.lifecycle, 'created');
});

test('two concurrent E2E runs remain isolated even with similar resource names', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const runA = (await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now)).run;
  const runB = (await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now)).run;
  assert.notEqual(runA.id, runB.id);

  repository.jobs.set('e2e-late-a', { owner_user_id: null, created_at: now.toISOString() });
  repository.jobs.set('e2e-late-b', { owner_user_id: null, created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, runA.id, { resource_type: 'job', resource_ref: 'e2e-late-a', lifecycle: 'created' }, now);
  await registerResource(repository as unknown as E2ERegistryRepository, runB.id, { resource_type: 'job', resource_ref: 'e2e-late-b', lifecycle: 'created' }, now);

  await performCleanup(repository as unknown as E2ERegistryRepository, runA.id, now);
  // Cleaning up run A must not touch run B's job or registry rows.
  assert.equal(repository.jobs.has('e2e-late-a'), false);
  assert.equal(repository.jobs.has('e2e-late-b'), true);
  const runBAfter = await repository.getRun(runB.id);
  assert.equal(runBAfter?.cleanup_status, 'not_started');
});

test('completeRun transitions once, replays idempotently, and rejects a second different outcome', async () => {
  const repository = repo();
  const { run } = await registerRun(repository, { suite: 'late-run', source: 'local_manual' }, now);
  const passed = await completeRun(repository, run.id, { status: 'passed' }, now);
  assert.equal(passed.run?.status, 'passed');
  const replay = await completeRun(repository, run.id, { status: 'passed' }, now);
  assert.equal(replay.run?.status, 'passed');
  await assert.rejects(() => completeRun(repository, run.id, { status: 'failed' }, now), (error: HttpError) => error.status === 409);
});

test('performCleanup fully removes a created job resource and marks the run completed', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-full', { owner_user_id: null, created_at: now.toISOString() });
  repository.jobRelatedRowCounts.set('e2e-late-full', 4); // events + run + alert + pending row, all removed together
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-full', lifecycle: 'created' }, now);

  const result = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(result.cleanup_status, 'completed');
  assert.equal(result.resources[0].lifecycle, 'cleaned');
  assert.equal(repository.jobs.has('e2e-late-full'), false);
});

test('cleanup replay is idempotent and does not reprocess an already-terminal run', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-once', { owner_user_id: null, created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-once', lifecycle: 'created' }, now);
  const first = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  const second = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(first.cleanup_status, 'completed');
  assert.equal(second.cleanup_status, 'completed');
});

test('an absent resource (never actually created) is a successful, idempotent cleanup outcome', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-never-created' }, now);
  const result = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(result.cleanup_status, 'completed_with_absent_resources');
  assert.equal(result.resources[0].lifecycle, 'absent');
});

test('partial cleanup failure stays pending on first attempt, never falsely completed', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-stuck', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-stuck');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-stuck', lifecycle: 'created' }, now);

  // First attempt: transient failure with attempts remaining → pending (retryable).
  const result = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(result.cleanup_status, 'pending');
  assert.equal(result.resources[0].lifecycle, 'cleanup_failed');
  const runAfter = await repository.getRun(run.id);
  assert.notEqual(runAfter?.cleanup_status, 'completed');
});

test('requestCleanup acquires the lease so a concurrent second call cannot double-process', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  // Simulate an in-flight cleanup by acquiring the lease directly.
  const farPast = new Date(now.getTime() - 300_000).toISOString();
  await repository.acquireCleanupLease(run.id, now.toISOString(), farPast);
  const result = await requestCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(result.cleanup_status, 'in_progress');
});

test('getRunStatus rejects a non-UUID id and a missing run', async () => {
  const repository = repo();
  await assert.rejects(() => getRunStatus(repository, 'not-a-uuid'), (error: HttpError) => error.status === 400);
  await assert.rejects(() => getRunStatus(repository, '22222222-2222-4222-8222-222222222222'), (error: HttpError) => error.status === 404);
});

test('legacyInventory bounds its limit and excludes registered resources', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  repository.jobs.set('e2e-late-legacy-1', { owner_user_id: null, created_at: now.toISOString() });
  repository.jobs.set('e2e-late-legacy-2', { owner_user_id: null, created_at: now.toISOString() });
  const rows = await legacyInventory(repository as unknown as E2ERegistryRepository, 1);
  assert.equal(rows.length, 1);
});

test('isE2EControlEnabled is false anywhere outside staging, or when the flag or token secret is missing', () => {
  const base = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret-token' } as unknown as Env;
  assert.equal(isE2EControlEnabled(base), true);
  assert.equal(isE2EControlEnabled({ ...base, ENVIRONMENT: 'production' } as Env), false);
  assert.equal(isE2EControlEnabled({ ...base, E2E_CONTROL_ENABLED: undefined } as Env), false);
  assert.equal(isE2EControlEnabled({ ...base, E2E_CONTROL_ENABLED: 'false' } as Env), false);
  assert.equal(isE2EControlEnabled({ ...base, E2E_CONTROL_TOKEN: undefined } as Env), false);
});

test('requireE2EControl returns a plain 404 in production, revealing nothing about the facility', async () => {
  const env = { ENVIRONMENT: 'production' } as unknown as Env;
  const request = new Request('https://pingstep.dev/v1/internal/e2e/runs', { method: 'POST', headers: { authorization: 'Bearer whatever', 'content-type': 'application/json' } });
  await assert.rejects(() => requireE2EControl(request, env), (error: HttpError) => error.status === 404);
});

test('requireE2EControl rejects a missing or incorrect control token in staging even when enabled', async () => {
  const env = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'correct-token' } as unknown as Env;
  const noAuth = new Request('https://pingstep-staging.mantoshk234.workers.dev/v1/internal/e2e/runs', { method: 'POST', headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => requireE2EControl(noAuth, env), (error: HttpError) => error.status === 401);
  const wrongAuth = new Request('https://pingstep-staging.mantoshk234.workers.dev/v1/internal/e2e/runs', { method: 'POST', headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json' } });
  await assert.rejects(() => requireE2EControl(wrongAuth, env), (error: HttpError) => error.status === 401);
  // Also rejects the ordinary OPERATOR_TOKEN — E2E control requires its own separate secret.
  const operatorAuth = new Request('https://pingstep-staging.mantoshk234.workers.dev/v1/internal/e2e/runs', { method: 'POST', headers: { authorization: 'Bearer operator-secret', 'content-type': 'application/json' } });
  await assert.rejects(() => requireE2EControl(operatorAuth, env), (error: HttpError) => error.status === 401);
});

test('requireE2EControl accepts a correct token on the staging origin and enforces JSON content-type', async () => {
  const env = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'correct-token', PUBLIC_ORIGIN: 'https://pingstep-staging.mantoshk234.workers.dev' } as unknown as Env;
  const good = new Request('https://pingstep-staging.mantoshk234.workers.dev/v1/internal/e2e/runs', { method: 'POST', headers: { authorization: 'Bearer correct-token', 'content-type': 'application/json' } });
  await assert.doesNotReject(() => requireE2EControl(good, env));
  const badContentType = new Request('https://pingstep-staging.mantoshk234.workers.dev/v1/internal/e2e/runs', { method: 'POST', headers: { authorization: 'Bearer correct-token', 'content-type': 'text/plain' } });
  await assert.rejects(() => requireE2EControl(badContentType, env), (error: HttpError) => error.status === 400);
  const wrongOrigin = new Request('https://attacker.example/v1/internal/e2e/runs', { method: 'POST', headers: { authorization: 'Bearer correct-token', 'content-type': 'application/json' } });
  await assert.rejects(() => requireE2EControl(wrongOrigin, env), (error: HttpError) => error.status === 403);
});

test('the janitor never runs outside staging or without the flag, and defaults nothing destructive on a dry run', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const prodEnv = { ENVIRONMENT: 'production' } as unknown as Env;
  const prodResult = await runE2EJanitor(repository as unknown as E2ERegistryRepository, prodEnv, now, true);
  assert.equal(prodResult.ran, false);

  const stagingEnv = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret' } as unknown as Env;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, new Date(now.getTime() - 10 * 60 * 1000));
  repository.jobs.set('e2e-late-janitor', { owner_user_id: null, created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-janitor', lifecycle: 'created' }, now);

  const dryRunResult = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, true);
  assert.equal(dryRunResult.ran, true);
  assert.equal(dryRunResult.expired_runs_seen, 1);
  assert.equal(dryRunResult.runs_cleaned, 0); // dry run performs no cleanup
  assert.equal(repository.jobs.has('e2e-late-janitor'), true);

  const liveResult = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(liveResult.runs_cleaned, 1);
  assert.equal(repository.jobs.has('e2e-late-janitor'), false);
});

test('requestCleanup accepts only the run id (no extra now parameter)', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-binding', { owner_user_id: null, created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-binding', lifecycle: 'created' }, now);
  // This would fail if requestCleanup still tried to bind a second parameter.
  const result = await requestCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(result.cleanup_status, 'completed');
});

test('a stale in_progress lease is reclaimed by performCleanup after expiry', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-stale', { owner_user_id: null, created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-stale', lifecycle: 'created' }, now);

  // Simulate a lease acquired 5 minutes ago (stale — exceeds 120s lease duration).
  const staleLease = new Date(now.getTime() - 5 * 60_000);
  const farPast = new Date(staleLease.getTime() - 300_000).toISOString();
  await repository.acquireCleanupLease(run.id, staleLease.toISOString(), farPast);
  assert.equal((await repository.getRun(run.id))?.cleanup_status, 'in_progress');

  // A new caller should reclaim the stale lease and complete cleanup.
  const result = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(result.cleanup_status, 'completed');
  assert.equal(repository.jobs.has('e2e-late-stale'), false);
});

test('a fresh in_progress lease cannot be stolen by a concurrent caller', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-concurrent', { owner_user_id: null, created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-concurrent', lifecycle: 'created' }, now);

  // Acquire a fresh lease (just now).
  const farPast = new Date(now.getTime() - 300_000).toISOString();
  await repository.acquireCleanupLease(run.id, now.toISOString(), farPast);

  // A concurrent caller within the lease window should fail to acquire.
  const concurrentNow = new Date(now.getTime() + 30_000); // 30s later, within 120s window
  const result = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, concurrentNow);
  assert.equal(result.cleanup_status, 'in_progress');
});

test('operator reset: requires_operator run can be reset and retried via resetCleanup', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-retry', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-retry');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-retry', lifecycle: 'created' }, now);

  // Exhaust attempts (3) to reach requires_operator.
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now); // attempt 1 → pending
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now); // attempt 2 → pending
  const exhausted = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now); // attempt 3 → requires_operator
  assert.equal(exhausted.cleanup_status, 'requires_operator');

  // Automatic retry should NOT re-enter (returns cached requires_operator).
  const blocked = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(blocked.cleanup_status, 'requires_operator');

  // Operator fixes the issue and explicitly resets for retry — but resource is at max attempts,
  // so we need to verify it still stays requires_operator. The reset clears the run status but
  // doesn't reset resource attempts.
  repository.forceRowsRemainAfterCleanup.delete('e2e-late-retry');
  await resetCleanup(repository as unknown as E2ERegistryRepository, run.id);
  const runAfterReset = await repository.getRun(run.id);
  assert.equal(runAfterReset?.cleanup_status, 'pending');

  // Resource is at max attempts, so even with the fix it stays requires_operator.
  // This is correct — reset is for operator re-evaluation, not infinite retry.
  const afterReset = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(afterReset.cleanup_status, 'requires_operator');
});

test('operator acknowledge: requires_operator run can be acknowledged as terminal', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-ack', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-ack');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-ack', lifecycle: 'created' }, now);

  // Exhaust all 3 attempts to reach requires_operator.
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  const result = await acknowledgeCleanup(repository as unknown as E2ERegistryRepository, run.id, now, true);
  assert.equal(result.cleanup_status, 'operator_acknowledged');

  // Acknowledged run has cleaned_at set and is purgeable.
  const runAfter = await repository.getRun(run.id);
  assert.equal(runAfter?.cleaned_at, now.toISOString());
});

test('acknowledge/reset reject non-requires_operator runs', async () => {
  const repository = repo();
  const { run } = await registerRun(repository, { suite: 'late-run', source: 'local_manual' }, now);
  await assert.rejects(() => acknowledgeCleanup(repository, run.id, now, true), (e: HttpError) => e.status === 409);
  await assert.rejects(() => resetCleanup(repository, run.id), (e: HttpError) => e.status === 409);
});

test('exhausted cleanup attempts reach requires_operator and stay there — not auto-retried', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-exhaust', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-exhaust');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-exhaust', lifecycle: 'created' }, now);

  // Attempts 1-2: transient → pending (retryable).
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal((await repository.getRun(run.id))?.cleanup_status, 'pending');
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal((await repository.getRun(run.id))?.cleanup_status, 'pending');

  // Attempt 3: exhausted → requires_operator.
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  const resource = await repository.getResource(run.id, 'job', 'e2e-late-exhaust');
  assert.equal(resource?.cleanup_attempts, 3);
  assert.equal((await repository.getRun(run.id))?.cleanup_status, 'requires_operator');

  // Even with a reset, the resource is at max attempts — stays requires_operator.
  await resetCleanup(repository as unknown as E2ERegistryRepository, run.id);
  repository.forceRowsRemainAfterCleanup.delete('e2e-late-exhaust');
  const final = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(final.cleanup_status, 'requires_operator');
});

test('ownership_mismatch resources are permanently skipped — never silently retried', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-owned2', { owner_user_id: 'user-42', created_at: now.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-owned2' }, now);
  await repository.markResourceLifecycle(run.id, 'job', 'e2e-late-owned2', 'created', now.toISOString());

  const first = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(first.cleanup_status, 'requires_operator');
  const resource = await repository.getResource(run.id, 'job', 'e2e-late-owned2');
  assert.equal(resource?.cleanup_failure_code, 'ownership_mismatch');

  // Even after a reset, ownership_mismatch is permanent.
  await resetCleanup(repository as unknown as E2ERegistryRepository, run.id);
  repository.jobs.set('e2e-late-owned2', { owner_user_id: null, created_at: now.toISOString() });
  const retry = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(retry.cleanup_status, 'requires_operator');
  assert.equal(repository.jobs.has('e2e-late-owned2'), true);
});

test('requires_operator runs are NOT selected by the janitor', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const stagingEnv = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret' } as unknown as Env;
  const expiredStart = new Date(now.getTime() - 10 * 60 * 1000);
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, expiredStart);
  repository.jobs.set('e2e-late-janitor-op', { owner_user_id: null, created_at: expiredStart.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-janitor-op');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-janitor-op', lifecycle: 'created' }, expiredStart);

  // Janitor passes 1-2: transient failure, stays pending (deferred — retryable).
  const pass1 = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(pass1.runs_deferred, 1);
  const pass2 = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(pass2.runs_deferred, 1);

  // Janitor pass 3: exhausted → requires_operator.
  const pass3 = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(pass3.runs_requiring_operator, 1);
  assert.equal(pass3.runs_cleaned, 0);

  // Next janitor pass: should NOT see the requires_operator run again.
  const pass4 = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(pass4.expired_runs_seen, 0);
  assert.equal(pass4.runs_cleaned, 0);
});

test('requires_operator runs do not have cleaned_at set, so purge does not apply until acknowledged', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-purge', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-purge');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-purge', lifecycle: 'created' }, now);

  // Exhaust all 3 attempts to reach requires_operator.
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  const runAfterCleanup = await repository.getRun(run.id);
  assert.equal(runAfterCleanup?.cleanup_status, 'requires_operator');
  assert.equal(runAfterCleanup?.cleaned_at, null); // NOT set — prevents premature purge

  // Purge should not remove it (cleaned_at is null).
  const purgedBefore = await repository.purgeOldRegistryRows(new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(), 10);
  assert.equal(purgedBefore, 0);
  assert.ok(repository.runs.has(run.id));

  // After acknowledgement, cleaned_at is set and purge works.
  await acknowledgeCleanup(repository as unknown as E2ERegistryRepository, run.id, now, true);
  const purgedAfter = await repository.purgeOldRegistryRows(new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(), 10);
  assert.equal(purgedAfter, 1);
  assert.ok(!repository.runs.has(run.id));
});

test('janitor counts only completed statuses as cleaned, not in_progress from a lease race', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const stagingEnv = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret' } as unknown as Env;
  const expiredStart = new Date(now.getTime() - 10 * 60 * 1000);

  // Run A: will complete normally.
  const runA = (await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, expiredStart)).run;
  // Run B: will have a fresh in-progress lease (simulating concurrent caller).
  const runB = (await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, expiredStart)).run;

  // Acquire a fresh lease on run B so the janitor can't take it.
  const farPast = new Date(now.getTime() - 300_000).toISOString();
  await repository.acquireCleanupLease(runB.id, now.toISOString(), farPast);

  const result = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  // Run A: cleaned (completed). Run B: not visible (fresh in_progress lease).
  assert.equal(result.runs_cleaned, 1);
  assert.equal(result.runs_deferred, 0);
  assert.equal(result.expired_runs_seen, 1); // only A was selected
});

test('janitor picks up stale in_progress runs whose lease has expired', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const stagingEnv = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret' } as unknown as Env;
  const expiredStart = new Date(now.getTime() - 10 * 60 * 1000);
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, expiredStart);
  repository.jobs.set('e2e-late-janitor-stale', { owner_user_id: null, created_at: expiredStart.toISOString() });
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-janitor-stale', lifecycle: 'created' }, expiredStart);

  // Simulate a stale in_progress lease from 5 minutes ago.
  const staleLease = new Date(now.getTime() - 5 * 60_000).toISOString();
  const farPast = new Date(now.getTime() - 10 * 60_000).toISOString();
  await repository.acquireCleanupLease(run.id, staleLease, farPast);
  assert.equal((await repository.getRun(run.id))?.cleanup_status, 'in_progress');

  // Janitor should find and clean this stale run.
  const result = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(result.expired_runs_seen, 1);
  assert.equal(result.runs_cleaned, 1);
});

test('the janitor batches expired runs and never exceeds its bound per invocation', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const stagingEnv = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret' } as unknown as Env;
  const expiredStart = new Date(now.getTime() - 10 * 60 * 1000);
  for (let i = 0; i < 8; i += 1) {
    await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, expiredStart);
  }
  const result = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.ok(result.expired_runs_seen <= 5, `expected a bounded batch, got ${result.expired_runs_seen}`);
});

test('acknowledgeCleanup rejects when confirmed is false', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-ack-noconfirm', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-ack-noconfirm');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-ack-noconfirm', lifecycle: 'created' }, now);
  // Exhaust attempts to reach requires_operator.
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  await assert.rejects(() => acknowledgeCleanup(repository as unknown as E2ERegistryRepository, run.id, now, false), (e: HttpError) => e.status === 400);
});

test('transient cleanup failure stays pending for janitor retry, then succeeds on attempt 2', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const stagingEnv = { ENVIRONMENT: 'staging', E2E_CONTROL_ENABLED: 'true', E2E_CONTROL_TOKEN: 'secret' } as unknown as Env;
  const expiredStart = new Date(now.getTime() - 10 * 60 * 1000);
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual', expiry_seconds: 300 }, expiredStart);
  repository.jobs.set('e2e-late-transient', { owner_user_id: null, created_at: expiredStart.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-transient');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-transient', lifecycle: 'created' }, expiredStart);

  // First janitor pass: transient failure (rows_remaining), but only 1 attempt — stays pending.
  const first = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  const runAfter1 = await repository.getRun(run.id);
  assert.equal(runAfter1?.cleanup_status, 'pending');
  assert.equal(first.runs_deferred, 1);

  // Fix the issue.
  repository.forceRowsRemainAfterCleanup.delete('e2e-late-transient');

  // Second janitor pass: succeeds.
  const second = await runE2EJanitor(repository as unknown as E2ERegistryRepository, stagingEnv, now, false);
  assert.equal(second.runs_cleaned, 1);
  assert.equal(repository.jobs.has('e2e-late-transient'), false);
});

test('transient failure transitions to requires_operator only after MAX_CLEANUP_ATTEMPTS exhausted', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const { run } = await registerRun(repository as unknown as E2ERegistryRepository, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set('e2e-late-exhaust3', { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add('e2e-late-exhaust3');
  await registerResource(repository as unknown as E2ERegistryRepository, run.id, { resource_type: 'job', resource_ref: 'e2e-late-exhaust3', lifecycle: 'created' }, now);

  // Attempt 1: stays pending (retryable).
  const r1 = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(r1.cleanup_status, 'pending');

  // Attempt 2: still retryable.
  const r2 = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(r2.cleanup_status, 'pending');

  // Attempt 3: exhausted → requires_operator.
  const r3 = await performCleanup(repository as unknown as E2ERegistryRepository, run.id, now);
  assert.equal(r3.cleanup_status, 'requires_operator');
  const resource = await repository.getResource(run.id, 'job', 'e2e-late-exhaust3');
  assert.equal(resource?.cleanup_attempts, 3);
});

// ── Finding 1: strict D1 binding arity test ──

/**
 * Strict D1 statement fake that counts ? placeholders in each SQL statement
 * and throws if .bind() receives a mismatched number of arguments.
 * Exercises the real E2ERegistryRepository class, not MemoryE2ERegistryRepository.
 */
class StrictD1Statement {
  private placeholderCount: number;
  private bound = false;
  constructor(sql: string) {
    this.placeholderCount = (sql.match(/\?/g) || []).length;
  }
  bind(...args: unknown[]) {
    if (args.length !== this.placeholderCount) {
      throw new Error(`SQL has ${this.placeholderCount} placeholder(s) but bind() received ${args.length} argument(s)`);
    }
    this.bound = true;
    return this;
  }
  async run() { return { meta: { changes: 1 } }; }
  async first() { return null; }
  async all() { return { results: [] }; }
}

class StrictD1Database {
  prepare(sql: string) { return new StrictD1Statement(sql); }
  async batch(stmts: StrictD1Statement[]) { return stmts.map((s) => ({ meta: { changes: 1 } })); }
}

test('E2ERegistryRepository.requestCleanup has correct placeholder/bind arity (D1 binding regression)', async () => {
  const db = new StrictD1Database() as unknown as D1Database;
  const repository = new E2ERegistryRepository(db);
  // requestCleanup(id) — 1 placeholder, 1 bind arg. Would throw if the
  // original bug (2 placeholders, 1 arg or 1 placeholder, 2 args) returned.
  await assert.doesNotReject(() => repository.requestCleanup('test-id'));
});

test('E2ERegistryRepository.acquireCleanupLease has correct placeholder/bind arity', async () => {
  const db = new StrictD1Database() as unknown as D1Database;
  const repository = new E2ERegistryRepository(db);
  await assert.doesNotReject(() => repository.acquireCleanupLease('id', 'now', 'expiry'));
});

test('E2ERegistryRepository.listExpiredRuns has correct placeholder/bind arity', async () => {
  const db = new StrictD1Database() as unknown as D1Database;
  const repository = new E2ERegistryRepository(db);
  await assert.doesNotReject(() => repository.listExpiredRuns('now', 5, 'expiry'));
});

test('E2ERegistryRepository.finishCleanup has correct placeholder/bind arity', async () => {
  const db = new StrictD1Database() as unknown as D1Database;
  const repository = new E2ERegistryRepository(db);
  await assert.doesNotReject(() => repository.finishCleanup('id', 'completed', 'now', 3));
});

test('E2ERegistryRepository.acknowledgeCleanup has correct placeholder/bind arity', async () => {
  const db = new StrictD1Database() as unknown as D1Database;
  const repository = new E2ERegistryRepository(db);
  await assert.doesNotReject(() => repository.acknowledgeCleanup('id', 'now'));
});

test('E2ERegistryRepository.resetCleanup has correct placeholder/bind arity', async () => {
  const db = new StrictD1Database() as unknown as D1Database;
  const repository = new E2ERegistryRepository(db);
  await assert.doesNotReject(() => repository.resetCleanup('id'));
});

// ── Finding 2: harness signal isolation test ──

test('StagingE2EHarness.cleanup uses a fresh signal even when the overall signal is aborted', async () => {
  // Mock fetch to track signal usage.
  const originalFetch = globalThis.fetch;
  const callSignals: Array<{ aborted: boolean; path: string }> = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    callSignals.push({ aborted: init?.signal?.aborted ?? false, path: new URL(url).pathname });
    return new Response(JSON.stringify({ run: { id: 'test-id', cleanup_status: 'completed' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { StagingE2EHarness } = await import('../scripts/lib/staging-e2e.mjs');
    const ac = new AbortController();
    const harness = new StagingE2EHarness({ baseUrl: 'https://staging.example.com', controlToken: 'tok', signal: ac.signal });
    harness.runId = 'test-run-id';

    // Abort the overall signal (simulating test timeout).
    ac.abort();

    // completeRun with a fresh signal should NOT be aborted.
    const freshSignal = AbortSignal.timeout(5_000);
    await harness.completeRun('failed', { failurePhase: 'test', failureCode: 'timeout', signal: freshSignal });
    const completeCall = callSignals.find((c) => c.path.includes('/complete'));
    assert.ok(completeCall, 'completeRun should have been called');
    assert.equal(completeCall.aborted, false, 'completeRun signal must not be aborted');

    // cleanup() creates its own fresh signal.
    callSignals.length = 0;
    const result = await harness.cleanup(5_000);
    assert.equal(result.attempted, true);
    const cleanupCalls = callSignals.filter((c) => c.path.includes('/cleanup') || c.path.includes('/runs/'));
    assert.ok(cleanupCalls.length > 0, 'cleanup should have made at least one call');
    for (const call of cleanupCalls) {
      assert.equal(call.aborted, false, `cleanup call to ${call.path} must not use the aborted signal`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Fourth review, finding 1: nonterminal cleanup must never be reported as success ──

type MockFetchPlan = {
  /** cleanup_status returned by the Nth POST .../cleanup call (1-based); last entry repeats. */
  postStatuses: string[];
  /** cleanup_status returned by every GET .../runs/:id poll. */
  getStatus: string;
};

function mockCleanupFetch(plan: MockFetchPlan) {
  let postCount = 0;
  const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    if (init?.method === 'POST' && path.endsWith('/cleanup')) {
      postCount += 1;
      const status = plan.postStatuses[Math.min(postCount, plan.postStatuses.length) - 1];
      return new Response(JSON.stringify({ run_id: 'test-run-id', cleanup_status: status, resources: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ run: { id: 'test-run-id', cleanup_status: plan.getStatus }, resources: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchMock, postCalls: () => postCount };
}

async function harnessCleanupWithMock(plan: MockFetchPlan, timeoutMs: number) {
  const originalFetch = globalThis.fetch;
  const { fetchMock, postCalls } = mockCleanupFetch(plan);
  globalThis.fetch = fetchMock as typeof globalThis.fetch;
  try {
    const { StagingE2EHarness } = await import('../scripts/lib/staging-e2e.mjs');
    const harness = new StagingE2EHarness({ baseUrl: 'https://staging.example.com', controlToken: 'tok' });
    harness.runId = 'test-run-id';
    const result = await harness.cleanup(timeoutMs, { pollIntervalMs: 10 });
    return { result, postCalls: postCalls() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('harness cleanup reports failure when status stays pending until the poll timeout', async () => {
  const { result } = await harnessCleanupWithMock({ postStatuses: ['pending'], getStatus: 'pending' }, 120);
  assert.equal(result.attempted, true);
  assert.equal(result.successful, false, "a nonterminal 'pending' at the timeout must never be success");
  assert.equal(result.cleanup_status, 'pending');
});

test('harness cleanup reports failure when status stays in_progress until the poll timeout', async () => {
  const { result } = await harnessCleanupWithMock({ postStatuses: ['in_progress'], getStatus: 'in_progress' }, 120);
  assert.equal(result.successful, false, "a nonterminal 'in_progress' at the timeout must never be success");
  assert.equal(result.cleanup_status, 'in_progress');
});

test('harness cleanup performs bounded re-attempts while retryable and succeeds when a re-attempt completes', async () => {
  const { result, postCalls } = await harnessCleanupWithMock({ postStatuses: ['pending', 'completed'], getStatus: 'pending' }, 400);
  assert.equal(postCalls >= 2, true, 'the harness must re-request cleanup while the run remains retryable');
  assert.equal(result.successful, true);
  assert.equal(result.cleanup_status, 'completed');
});

test('harness cleanup does not re-attempt past a terminal requires_operator and reports failure', async () => {
  const { result, postCalls } = await harnessCleanupWithMock({ postStatuses: ['requires_operator'], getStatus: 'requires_operator' }, 400);
  assert.equal(postCalls, 1, 'requires_operator is terminal for automatic cleanup — no further re-attempts');
  assert.equal(result.successful, false);
  assert.equal(result.cleanup_status, 'requires_operator');
});

test('harness cleanup never reports operator_acknowledged as automatic-cleanup success', async () => {
  const { result } = await harnessCleanupWithMock({ postStatuses: ['operator_acknowledged'], getStatus: 'operator_acknowledged' }, 200);
  assert.equal(result.successful, false, 'operator acknowledgement resolves a failure under the documented policy; it is not automatic-cleanup success');
});

test('verification script exit code fails for every nonterminal or unsuccessful cleanup result', async () => {
  const { computeExitCode, isCleanupFailure } = await import('../scripts/verify-late-run-staging.mjs');
  const base = { testError: null, finalizationError: null };
  for (const status of ['pending', 'in_progress', 'unknown', 'requires_operator', 'operator_acknowledged', 'error']) {
    const cleanupResult = { attempted: true, successful: false, cleanup_status: status };
    assert.equal(isCleanupFailure(cleanupResult), true, `'${status}' must be a cleanup failure`);
    assert.equal(computeExitCode({ ...base, cleanupResult }), 1, `'${status}' must produce a nonzero exit`);
  }
  for (const status of ['completed', 'completed_with_absent_resources']) {
    const cleanupResult = { attempted: true, successful: true, cleanup_status: status };
    assert.equal(isCleanupFailure(cleanupResult), false);
    assert.equal(computeExitCode({ ...base, cleanupResult }), 0, `'${status}' with no test/finalization error exits 0`);
  }
  const ok = { attempted: true, successful: true, cleanup_status: 'completed' };
  assert.equal(computeExitCode({ testError: new Error('x'), finalizationError: null, cleanupResult: ok }), 1);
  assert.equal(computeExitCode({ testError: null, finalizationError: new Error('x'), cleanupResult: ok }), 1);
});

/** Starts a stub staging control server whose cleanup endpoint always reports the given statuses. */
function startStubControlServer(postStatus: string, getStatus: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const body = request.method === 'POST' && request.url?.endsWith('/cleanup')
        ? { run_id: 'stub', cleanup_status: postStatus, resources: [] }
        : { run: { id: 'stub', cleanup_status: getStatus }, resources: [] };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        close: () => new Promise((done) => server.close(() => done(undefined)))
      });
    });
  });
}

function runCleanupCli(port: number, extraArgs: string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const script = fileURLToPath(new URL('../scripts/e2e-staging-cleanup.mjs', import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--run-id', '4c1f28c1-2f3a-4b5c-8d6e-9f0a1b2c3d4e', ...extraArgs], {
      env: {
        ...process.env,
        PINGSTEP_STAGING_BASE_URL: `http://127.0.0.1:${port}`,
        PINGSTEP_STAGING_E2E_CONTROL_TOKEN: 'stub-token'
      }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('cleanup CLI exits nonzero when cleanup remains pending at the poll timeout', async () => {
  const server = await startStubControlServer('pending', 'pending');
  try {
    const { code, stderr } = await runCleanupCli(server.port, ['--timeout-ms', '200', '--poll-interval-ms', '20']);
    assert.equal(code, 1, `a 'pending' status at timeout must exit nonzero (stderr: ${stderr})`);
    assert.match(stderr, /did not reach a successful terminal state/);
  } finally {
    await server.close();
  }
});

test('cleanup CLI exits zero only for a genuinely successful terminal cleanup', async () => {
  const server = await startStubControlServer('completed', 'completed');
  try {
    const { code, stdout } = await runCleanupCli(server.port, ['--timeout-ms', '2000']);
    assert.equal(code, 0, `stdout: ${stdout}`);
    assert.match(stdout, /"successful": true/);
  } finally {
    await server.close();
  }
});

// ── Fourth review, finding 2: acknowledge/reset must not claim a transition lost to a race ──

async function runAtRequiresOperator(repository: MemoryE2ERegistryRepository, jobKey: string) {
  const repoAs = repository as unknown as E2ERegistryRepository;
  const { run } = await registerRun(repoAs, { suite: 'late-run', source: 'local_manual' }, now);
  repository.jobs.set(jobKey, { owner_user_id: null, created_at: now.toISOString() });
  repository.forceRowsRemainAfterCleanup.add(jobKey);
  await registerResource(repoAs, run.id, { resource_type: 'job', resource_ref: jobKey, lifecycle: 'created' }, now);
  await performCleanup(repoAs, run.id, now);
  await performCleanup(repoAs, run.id, now);
  await performCleanup(repoAs, run.id, now);
  const current = await repository.getRun(run.id);
  assert.equal(current?.cleanup_status, 'requires_operator');
  return run;
}

test('acknowledgeCleanup returns 409 with the actual state when the CAS loses a race', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const repoAs = repository as unknown as E2ERegistryRepository;
  const run = await runAtRequiresOperator(repository, 'e2e-late-ack-race');
  // Simulate a concurrent caller acknowledging between our requireRun() read
  // and our UPDATE: the first CAS invocation is preceded by the racer's own
  // successful acknowledge, so our UPDATE affects zero rows.
  const original = repository.acknowledgeCleanup.bind(repository);
  let raced = false;
  repository.acknowledgeCleanup = async (id: string, nowIso: string) => {
    if (!raced) {
      raced = true;
      await original(id, nowIso); // the concurrent operator wins the race
      return original(id, nowIso); // our own CAS now matches zero rows → false
    }
    return original(id, nowIso);
  };
  await assert.rejects(
    () => acknowledgeCleanup(repoAs, run.id, now, true),
    (error: HttpError) => error.status === 409 && error.message.includes('operator_acknowledged'),
    'a lost race must surface as 409 reporting the actual state, never a claimed transition'
  );
  // The state is the concurrent caller's, untouched by our failed CAS.
  const after = await repository.getRun(run.id);
  assert.equal(after?.cleanup_status, 'operator_acknowledged');
});

test('resetCleanup returns 409 with the actual state when the CAS loses a race', async () => {
  const repository = repo() as unknown as MemoryE2ERegistryRepository;
  const repoAs = repository as unknown as E2ERegistryRepository;
  const run = await runAtRequiresOperator(repository, 'e2e-late-reset-race');
  // Simulate a concurrent acknowledge landing between our requireRun() read
  // and our reset UPDATE.
  const originalReset = repository.resetCleanup.bind(repository);
  const originalAck = repository.acknowledgeCleanup.bind(repository);
  let raced = false;
  repository.resetCleanup = async (id: string) => {
    if (!raced) {
      raced = true;
      await originalAck(id, now.toISOString()); // concurrent operator acknowledges first
    }
    return originalReset(id); // our CAS now matches zero rows → false
  };
  await assert.rejects(
    () => resetCleanup(repoAs, run.id),
    (error: HttpError) => error.status === 409 && error.message.includes('operator_acknowledged'),
    "a lost race must surface as 409 reporting the actual state, never a claimed 'pending'"
  );
  const after = await repository.getRun(run.id);
  assert.equal(after?.cleanup_status, 'operator_acknowledged');
});
