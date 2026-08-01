import { createHash, randomUUID } from 'node:crypto';

const EVENT_TYPES = new Set(['started', 'step', 'heartbeat', 'succeeded', 'failed']);
const TERMINAL_TYPES = new Set(['succeeded', 'failed']);
const DEFAULT_INTERVAL_SECONDS = 5 * 60;
const DEFAULT_GRACE_SECONDS = 10 * 60;
const PENDING_WINDOW_MS = 15 * 60 * 1000;

const runKey = (jobKey, runId) => `${jobKey}:${runId}`;
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const hashToken = (value) => createHash('sha256').update(value).digest('hex');

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw validationError('Event must be a JSON object.');
  for (const field of ['event_id', 'job_key', 'run_id', 'sequence', 'type', 'occurred_at']) {
    if (event[field] === undefined || event[field] === null || event[field] === '') throw validationError(`Missing required field: ${field}.`);
  }
  if (typeof event.event_id !== 'string' || typeof event.job_key !== 'string' || typeof event.run_id !== 'string') {
    throw validationError('event_id, job_key, and run_id must be strings.');
  }
  if (!Number.isInteger(event.sequence) || event.sequence < 1) throw validationError('sequence must be a positive integer.');
  if (!EVENT_TYPES.has(event.type)) throw validationError('type must be started, step, heartbeat, succeeded, or failed.');
  if (!validTimestamp(event.occurred_at)) throw validationError('occurred_at must be an RFC 3339 timestamp.');
  if (event.data !== undefined && (!event.data || typeof event.data !== 'object' || Array.isArray(event.data))) {
    throw validationError('data must be an object when supplied.');
  }
  if (event.type === 'started' && event.sequence !== 1) throw validationError('started must use sequence 1.');
  if (event.type === 'step' && typeof event.data?.name !== 'string') throw validationError('step events require data.name.');
  if (event.type === 'failed' && typeof event.data?.message !== 'string') throw validationError('failed events require data.message.');
}

function livenessSettings(jobConfig = {}) {
  const interval = Number.isFinite(jobConfig.expected_update_interval_seconds)
    ? jobConfig.expected_update_interval_seconds
    : DEFAULT_INTERVAL_SECONDS;
  if (interval <= 0) throw validationError('expected_update_interval_seconds must be positive.');
  const grace = jobConfig.expected_update_interval_seconds === undefined
    ? DEFAULT_GRACE_SECONDS
    : Math.max(DEFAULT_GRACE_SECONDS, interval * 2);
  return { interval, grace };
}

function lateSettings(jobConfig = {}) {
  if (jobConfig.expected_duration_seconds === undefined) return null;
  const duration = jobConfig.expected_duration_seconds;
  if (!Number.isFinite(duration) || duration <= 0) throw validationError('expected_duration_seconds must be positive.');
  const grace = jobConfig.late_grace_seconds === undefined
    ? Math.max(5 * 60, Math.ceil(duration * 0.2))
    : jobConfig.late_grace_seconds;
  if (!Number.isFinite(grace) || grace < 0) throw validationError('late_grace_seconds must be zero or positive.');
  return { duration, grace };
}

export class PingStepService {
  constructor(store, { tokenHashesByJob = {}, jobConfigByKey = {}, now = () => new Date() } = {}) {
    this.store = store;
    this.tokenHashesByJob = tokenHashesByJob;
    this.jobConfigByKey = jobConfigByKey;
    this.now = now;
  }

  authorize(jobKey, token) {
    if (!token || this.tokenHashesByJob[jobKey] !== hashToken(token)) {
      const error = new Error('Invalid token for job_key.');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
  }

  async ingest(event, token) {
    validateEvent(event);
    this.authorize(event.job_key, token);
    const existing = this.store.data.events[event.event_id];
    const eventFingerprint = fingerprint(event);
    if (existing) {
      if (existing.fingerprint !== eventFingerprint) {
        const error = new Error('event_id was reused with different content.');
        error.code = 'CONFLICT';
        throw error;
      }
      return { duplicate: true, event: existing.event, run: this.getRun(event.job_key, event.run_id) };
    }

    const receivedAt = this.now().toISOString();
    this.store.data.events[event.event_id] = { event, fingerprint: eventFingerprint, received_at: receivedAt };
    const key = runKey(event.job_key, event.run_id);
    if (event.type !== 'started' && !this.store.data.runs[key]) {
      this.store.data.pending[event.event_id] = { expires_at: new Date(Date.parse(receivedAt) + PENDING_WINDOW_MS).toISOString() };
    }
    if (event.type === 'started') delete this.store.data.pending[event.event_id];

    this.expirePendingThrough(new Date(receivedAt));
    this.rebuildRun(event.job_key, event.run_id);
    await this.store.persist();
    return { duplicate: false, event, run: this.getRun(event.job_key, event.run_id) };
  }

  allEventsForRun(jobKey, runId) {
    return Object.values(this.store.data.events)
      .filter(({ event }) => event.job_key === jobKey && event.run_id === runId)
      .sort((a, b) => a.event.sequence - b.event.sequence || Date.parse(a.received_at) - Date.parse(b.received_at));
  }

  rebuildRun(jobKey, runId) {
    const entries = this.allEventsForRun(jobKey, runId)
      .filter(({ event }) => !this.store.data.pending[event.event_id]?.expired_at);
    const started = entries.find(({ event }) => event.type === 'started');
    const key = runKey(jobKey, runId);
    if (!started) {
      delete this.store.data.runs[key];
      return;
    }

    const settings = livenessSettings(this.jobConfigByKey[jobKey]);
    const terminalByArrival = entries
      .filter(({ event }) => TERMINAL_TYPES.has(event.type))
      .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
    const terminal = terminalByArrival[0];
    const conflictingTerminal = terminalByArrival.find(({ event }) => event.type !== terminal?.event.type);
    const stateEntries = entries.filter(({ event }) => event.sequence >= started.event.sequence && (!terminal || event.sequence <= terminal.event.sequence));
    const latest = stateEntries.at(-1);
    const liveness = stateEntries.filter(({ event }) => ['started', 'step', 'heartbeat'].includes(event.type)).at(-1);
    const latestStep = stateEntries.filter(({ event }) => event.type === 'step').at(-1);
    const terminalState = terminal ? terminal.event.type : 'running';

    const previous = this.store.data.runs[key];
    const late = lateSettings(this.jobConfigByKey[jobKey]);
    this.store.data.runs[key] = {
      job_key: jobKey,
      run_id: runId,
      status: terminalState,
      started_at: started.event.occurred_at,
      started_received_at: started.received_at,
      received_at: latest.received_at,
      latest_sequence: latest.event.sequence,
      latest_event_type: latest.event.type,
      last_liveness_received_at: liveness?.received_at ?? started.received_at,
      liveness_deadline: terminal ? null : new Date(Date.parse(liveness?.received_at ?? started.received_at) + (settings.interval + settings.grace) * 1000).toISOString(),
      late_deadline: terminal || !late ? null : new Date(Date.parse(started.received_at) + (late.duration + late.grace) * 1000).toISOString(),
      is_late: terminal ? false : (previous?.is_late ?? false),
      late_at: terminal ? null : (previous?.late_at ?? null),
      late_transitions: previous?.late_transitions ?? 0,
      stale_transitions: previous?.stale_transitions ?? 0,
      current_step: latestStep?.event.data?.name ?? null,
      terminal_event_id: terminal?.event.event_id ?? null,
      terminal_conflict: conflictingTerminal ? {
        event_id: conflictingTerminal.event.event_id,
        type: conflictingTerminal.event.type,
        received_at: conflictingTerminal.received_at
      } : null
    };

    for (const entry of entries) delete this.store.data.pending[entry.event.event_id];
  }

  expirePendingThrough(now) {
    for (const pending of Object.values(this.store.data.pending)) {
      if (!pending.expired_at && Date.parse(pending.expires_at) <= now.getTime()) {
        pending.expired_at = now.toISOString();
      }
    }
  }

  async reconcile() {
    const now = this.now();
    let changed = false;
    this.expirePendingThrough(now);
    for (const run of Object.values(this.store.data.runs)) {
      if (run.status === 'running' && Date.parse(run.liveness_deadline) <= now.getTime()) {
        run.status = 'stale';
        run.stale_at = now.toISOString();
        run.stale_transitions = (run.stale_transitions ?? 0) + 1;
        this.queueAlert(run, 'stale', now);
        changed = true;
      }
      if (run.status !== 'succeeded' && run.status !== 'failed' && !run.is_late && run.late_deadline && Date.parse(run.late_deadline) <= now.getTime()) {
        run.is_late = true;
        run.late_at = now.toISOString();
        run.late_transitions = (run.late_transitions ?? 0) + 1;
        this.queueAlert(run, 'late', now);
        changed = true;
      }
    }
    if (changed) await this.store.persist();
    return changed;
  }

  queueAlert(run, type, now) {
    const transition = type === 'stale' ? run.stale_transitions : run.late_transitions;
    const id = `${runKey(run.job_key, run.run_id)}:${type}:${transition}`;
    if (this.store.data.alerts[id]) return;
    this.store.data.alerts[id] = {
      id,
      type,
      job_key: run.job_key,
      run_id: run.run_id,
      status: run.status,
      current_step: run.current_step,
      message: type === 'stale' ? 'No heartbeat or step arrived before the liveness deadline.' : 'The run exceeded its configured expected duration.',
      created_at: now.toISOString(),
      delivery_status: 'pending',
      attempts: 0
    };
  }

  getRun(jobKey, runId) {
    return this.store.data.runs[runKey(jobKey, runId)] ?? null;
  }

  listRuns() {
    return Object.values(this.store.data.runs).sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
  }

  listRunEvents(jobKey, runId) {
    return this.allEventsForRun(jobKey, runId).map(({ event, received_at }) => ({ ...event, received_at }));
  }

  listAlerts() {
    return Object.values(this.store.data.alerts).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
}

export const createEventId = () => randomUUID();
