import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileStore } from '../src/store.js';
import { hashToken, PingStepService } from '../src/service.js';

async function setup({ now = new Date('2026-08-01T12:00:00Z') } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pingstep-'));
  const store = new FileStore(join(directory, 'state.json'));
  await store.load();
  const clock = { now };
  const service = new PingStepService(store, {
    tokenHashesByJob: { 'nightly-export': hashToken('test-token') },
    now: () => clock.now
  });
  return { store, service, clock };
}

const event = (overrides = {}) => ({
  event_id: 'event-1', job_key: 'nightly-export', run_id: 'run-1', sequence: 1,
  type: 'started', occurred_at: '2026-08-01T12:00:00Z', data: {}, ...overrides
});

test('creates a running run and persists durable state', async () => {
  const { store, service } = await setup();
  const result = await service.ingest(event(), 'test-token');
  assert.equal(result.duplicate, false);
  assert.equal(result.run.status, 'running');
  assert.equal(result.run.liveness_deadline, '2026-08-01T12:15:00.000Z');
  const persisted = JSON.parse(await readFile(store.path, 'utf8'));
  assert.ok(persisted.events['event-1']);
});

test('handles retries idempotently and rejects event ID reuse', async () => {
  const { service } = await setup();
  await service.ingest(event(), 'test-token');
  assert.equal((await service.ingest(event(), 'test-token')).duplicate, true);
  await assert.rejects(() => service.ingest(event({ type: 'heartbeat' }), 'test-token'), { code: 'CONFLICT' });
});

test('rebuilds out-of-order events when started arrives', async () => {
  const { service } = await setup();
  await service.ingest(event({ event_id: 'event-2', sequence: 2, type: 'step', data: { name: 'exporting' } }), 'test-token');
  assert.equal(service.getRun('nightly-export', 'run-1'), null);
  await service.ingest(event(), 'test-token');
  const run = service.getRun('nightly-export', 'run-1');
  assert.equal(run.current_step, 'exporting');
  assert.equal(run.latest_sequence, 2);
});

test('does not revive a pending event after its 15-minute reconciliation window', async () => {
  const { service, clock } = await setup();
  await service.ingest(event({ event_id: 'event-2', sequence: 2, type: 'step', data: { name: 'exporting' } }), 'test-token');
  clock.now = new Date('2026-08-01T12:16:00Z');
  await service.ingest(event(), 'test-token');
  const run = service.getRun('nightly-export', 'run-1');
  assert.equal(run.current_step, null);
  assert.equal(run.latest_sequence, 1);
});

test('marks a quiet run stale after its deadline', async () => {
  const { service, clock } = await setup();
  await service.ingest(event(), 'test-token');
  clock.now = new Date('2026-08-01T12:15:00Z');
  await service.reconcile();
  assert.equal(service.getRun('nightly-export', 'run-1').status, 'stale');
});

test('keeps the first terminal outcome and records an opposing conflict', async () => {
  const { service, clock } = await setup();
  await service.ingest(event(), 'test-token');
  clock.now = new Date('2026-08-01T12:01:00Z');
  await service.ingest(event({ event_id: 'event-2', sequence: 2, type: 'failed', data: { message: 'disk full' } }), 'test-token');
  clock.now = new Date('2026-08-01T12:02:00Z');
  await service.ingest(event({ event_id: 'event-3', sequence: 3, type: 'succeeded' }), 'test-token');
  const run = service.getRun('nightly-export', 'run-1');
  assert.equal(run.status, 'failed');
  assert.equal(run.terminal_conflict.type, 'succeeded');
});
