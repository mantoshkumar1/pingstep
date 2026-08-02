import { PingStepD1Repository, type RunProjection, type StoredEvent } from './repository';

const EVENT_TYPES = new Set(['started', 'step', 'heartbeat', 'succeeded', 'failed', 'cancelled']);
const TERMINAL_TYPES = new Set(['succeeded', 'failed', 'cancelled']);
const PENDING_WINDOW_MS = 15 * 60 * 1000;

export type LifecycleEvent = {
  event_id: string;
  job_key: string;
  run_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  data?: Record<string, unknown>;
};

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateEvent(value: unknown): asserts value is LifecycleEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Event must be a JSON object.');
  const event = value as Partial<LifecycleEvent>;
  for (const field of ['event_id', 'job_key', 'run_id', 'sequence', 'type', 'occurred_at'] as const) {
    if (event[field] === undefined || event[field] === null || event[field] === '') throw new HttpError(400, `Missing required field: ${field}.`);
  }
  if (typeof event.event_id !== 'string' || typeof event.job_key !== 'string' || typeof event.run_id !== 'string') throw new HttpError(400, 'event_id, job_key, and run_id must be strings.');
  if (typeof event.sequence !== 'number' || !Number.isInteger(event.sequence) || event.sequence < 1) throw new HttpError(400, 'sequence must be a positive integer.');
  if (!EVENT_TYPES.has(event.type ?? '')) throw new HttpError(400, 'Unsupported event type.');
  if (!isValidTimestamp(event.occurred_at)) throw new HttpError(400, 'occurred_at must be an RFC 3339 timestamp.');
  if (event.data !== undefined && (!event.data || typeof event.data !== 'object' || Array.isArray(event.data))) throw new HttpError(400, 'data must be an object when supplied.');
  if (event.type === 'started' && event.sequence !== 1) throw new HttpError(400, 'started must use sequence 1.');
  if (event.type === 'step' && typeof event.data?.name !== 'string') throw new HttpError(400, 'step events require data.name.');
  if (event.type === 'failed' && typeof event.data?.message !== 'string') throw new HttpError(400, 'failed events require data.message.');
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function fingerprint(event: LifecycleEvent): Promise<string> {
  return Array.from(await sha256(JSON.stringify(event))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asData(entry: StoredEvent): Record<string, unknown> {
  return JSON.parse(entry.data_json) as Record<string, unknown>;
}

function plusSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1000).toISOString();
}

export class HostedPingStepService {
  constructor(private readonly repository: PingStepD1Repository, private readonly now = () => new Date()) {}

  async ingest(rawEvent: unknown, token: string | null) {
    validateEvent(rawEvent);
    const event = rawEvent;
    const job = await this.repository.getJob(event.job_key);
    if (!job || !token || !equalBytes(await sha256(token), new Uint8Array(job.token_hash.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []))) {
      throw new HttpError(401, 'Invalid token for job_key.');
    }
    const eventFingerprint = await fingerprint(event);
    const existing = await this.repository.getEvent(event.event_id);
    if (existing) {
      if (existing.fingerprint !== eventFingerprint) throw new HttpError(409, 'event_id was reused with different content.');
      return { duplicate: true, event, run: await this.repository.getRun(event.job_key, event.run_id) };
    }

    const receivedAt = this.now().toISOString();
    await this.repository.insertEvent({ ...event, received_at: receivedAt, data_json: JSON.stringify(event.data ?? {}), fingerprint: eventFingerprint });
    if (event.type === 'started') await this.repository.clearPendingForRun(event.job_key, event.run_id);
    else if (!await this.repository.getRun(event.job_key, event.run_id)) await this.repository.markPending(event.event_id, new Date(this.now().getTime() + PENDING_WINDOW_MS).toISOString());
    const run = await this.rebuildRun(event.job_key, event.run_id);
    return { duplicate: false, event, run };
  }

  async rebuildRun(jobKey: string, runId: string): Promise<RunProjection | null> {
    const job = await this.repository.getJob(jobKey);
    if (!job) return null;
    const events = await this.repository.listProjectionEvents(jobKey, runId);
    const started = events.find((entry) => entry.type === 'started');
    if (!started) return null;
    const terminals = events.filter((entry) => TERMINAL_TYPES.has(entry.type)).sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
    const terminal = terminals[0];
    const state = events.filter((entry) => entry.sequence >= started.sequence && (!terminal || entry.sequence <= terminal.sequence));
    const latest = state.at(-1);
    if (!latest) return null;
    const liveness = state.filter((entry) => ['started', 'step', 'heartbeat'].includes(entry.type)).at(-1) ?? started;
    const latestStep = state.filter((entry) => entry.type === 'step').at(-1);
    const previous = await this.repository.getRun(jobKey, runId);
    const terminalStatus = terminal?.type === 'succeeded' ? 'succeeded' : terminal ? 'failed' : 'running';
    const lateGrace = job.late_grace_seconds ?? (job.expected_duration_seconds ? Math.max(300, Math.ceil(job.expected_duration_seconds * 0.2)) : null);
    const run: RunProjection = {
      job_key: jobKey, run_id: runId, status: terminalStatus,
      started_at: started.occurred_at, started_received_at: started.received_at,
      received_at: latest.received_at, latest_sequence: latest.sequence, latest_event_type: latest.type,
      last_liveness_received_at: liveness.received_at,
      liveness_deadline: terminal ? null : plusSeconds(liveness.received_at, job.expected_update_interval_seconds + job.liveness_grace_seconds),
      late_deadline: terminal || !job.expected_duration_seconds || lateGrace === null ? null : plusSeconds(started.received_at, job.expected_duration_seconds + lateGrace),
      is_late: terminal ? 0 : previous?.is_late ?? 0, late_at: terminal ? null : previous?.late_at ?? null,
      late_transitions: previous?.late_transitions ?? 0, stale_at: terminal ? null : previous?.stale_at ?? null,
      stale_transitions: previous?.stale_transitions ?? 0,
      job_version: typeof asData(started).job_version === 'string' ? asData(started).job_version as string : null,
      current_step: terminal && typeof asData(terminal).stage === 'string' ? asData(terminal).stage as string : latestStep && typeof asData(latestStep).name === 'string' ? asData(latestStep).name as string : null,
      terminal_event_id: terminal?.event_id ?? null,
      terminal_conflict_json: terminals.find((entry) => entry.type !== terminal?.type) ? JSON.stringify(terminals.find((entry) => entry.type !== terminal?.type)) : null
    };
    await this.repository.upsertRun(run);
    return run;
  }
}
