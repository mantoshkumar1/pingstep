export type StoredJob = {
  job_key: string;
  token_hash: string;
  expected_update_interval_seconds: number;
  liveness_grace_seconds: number;
  expected_duration_seconds: number | null;
  late_grace_seconds: number | null;
};

export type StoredEvent = {
  event_id: string;
  job_key: string;
  run_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  received_at: string;
  data_json: string;
  fingerprint: string;
};

export type RunProjection = {
  job_key: string;
  run_id: string;
  status: 'running' | 'stale' | 'succeeded' | 'failed';
  started_at: string;
  started_received_at: string;
  received_at: string;
  latest_sequence: number;
  latest_event_type: string;
  last_liveness_received_at: string;
  liveness_deadline: string | null;
  late_deadline: string | null;
  is_late: number;
  late_at: string | null;
  late_transitions: number;
  stale_at: string | null;
  stale_transitions: number;
  job_version: string | null;
  current_step: string | null;
  terminal_event_id: string | null;
  terminal_conflict_json: string | null;
};

/**
 * D1 persistence boundary. The Worker layer never builds SQL with request values:
 * every value is passed through a prepared-statement binding.
 */
export class PingStepD1Repository {
  constructor(private readonly db: D1Database) {}

  async getJob(jobKey: string): Promise<StoredJob | null> {
    return this.db.prepare(`
      SELECT job_key, token_hash, expected_update_interval_seconds,
             liveness_grace_seconds, expected_duration_seconds, late_grace_seconds
      FROM jobs WHERE job_key = ?
    `).bind(jobKey).first<StoredJob>();
  }

  async listJobs(): Promise<Omit<StoredJob, 'token_hash'>[]> {
    const result = await this.db.prepare(`
      SELECT job_key, expected_update_interval_seconds, liveness_grace_seconds,
             expected_duration_seconds, late_grace_seconds
      FROM jobs ORDER BY job_key ASC
    `).all<Omit<StoredJob, 'token_hash'>>();
    return result.results;
  }

  async createJob(job: StoredJob, now: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO jobs (
        job_key, token_hash, expected_update_interval_seconds, liveness_grace_seconds,
        expected_duration_seconds, late_grace_seconds, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      job.job_key, job.token_hash, job.expected_update_interval_seconds, job.liveness_grace_seconds,
      job.expected_duration_seconds, job.late_grace_seconds, now, now
    ).run();
  }

  async getEvent(eventId: string): Promise<StoredEvent | null> {
    return this.db.prepare(`
      SELECT event_id, job_key, run_id, sequence, type, occurred_at, received_at, data_json, fingerprint
      FROM events WHERE event_id = ?
    `).bind(eventId).first<StoredEvent>();
  }

  async insertEvent(event: StoredEvent): Promise<void> {
    await this.db.prepare(`
      INSERT INTO events (
        event_id, job_key, run_id, sequence, type, occurred_at, received_at, data_json, fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event.event_id,
      event.job_key,
      event.run_id,
      event.sequence,
      event.type,
      event.occurred_at,
      event.received_at,
      event.data_json,
      event.fingerprint
    ).run();
  }

  async markPending(eventId: string, expiresAt: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO pending_events (event_id, expires_at) VALUES (?, ?)
      ON CONFLICT(event_id) DO UPDATE SET expires_at = excluded.expires_at, expired_at = NULL
    `).bind(eventId, expiresAt).run();
  }

  async clearPendingForRun(jobKey: string, runId: string): Promise<void> {
    await this.db.prepare(`
      DELETE FROM pending_events
      WHERE event_id IN (SELECT event_id FROM events WHERE job_key = ? AND run_id = ?)
    `).bind(jobKey, runId).run();
  }

  async listEventsForRun(jobKey: string, runId: string): Promise<StoredEvent[]> {
    const result = await this.db.prepare(`
      SELECT event_id, job_key, run_id, sequence, type, occurred_at, received_at, data_json, fingerprint
      FROM events
      WHERE job_key = ? AND run_id = ?
      ORDER BY sequence ASC, received_at ASC
    `).bind(jobKey, runId).all<StoredEvent>();
    return result.results;
  }

  async listProjectionEvents(jobKey: string, runId: string): Promise<StoredEvent[]> {
    const result = await this.db.prepare(`
      SELECT e.event_id, e.job_key, e.run_id, e.sequence, e.type, e.occurred_at, e.received_at, e.data_json, e.fingerprint
      FROM events e
      LEFT JOIN pending_events p ON p.event_id = e.event_id
      WHERE e.job_key = ? AND e.run_id = ? AND p.expired_at IS NULL
      ORDER BY e.sequence ASC, e.received_at ASC
    `).bind(jobKey, runId).all<StoredEvent>();
    return result.results;
  }

  async getRun(jobKey: string, runId: string): Promise<RunProjection | null> {
    return this.db.prepare('SELECT * FROM runs WHERE job_key = ? AND run_id = ?')
      .bind(jobKey, runId).first<RunProjection>();
  }

  async listRuns(): Promise<RunProjection[]> {
    const result = await this.db.prepare('SELECT * FROM runs ORDER BY received_at DESC LIMIT 100').all<RunProjection>();
    return result.results;
  }

  async markExpiredRunsStale(now: string): Promise<number> {
    const result = await this.db.prepare(`
      UPDATE runs
      SET status = 'stale', stale_at = ?, stale_transitions = stale_transitions + 1
      WHERE status = 'running' AND liveness_deadline IS NOT NULL AND liveness_deadline <= ?
    `).bind(now, now).run();
    return result.meta.changes;
  }

  async upsertRun(run: RunProjection): Promise<void> {
    await this.db.prepare(`
      INSERT INTO runs (
        job_key, run_id, status, started_at, started_received_at, received_at,
        latest_sequence, latest_event_type, last_liveness_received_at, liveness_deadline,
        late_deadline, is_late, late_at, late_transitions, stale_at, stale_transitions,
        job_version, current_step, terminal_event_id, terminal_conflict_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_key, run_id) DO UPDATE SET
        status = excluded.status, started_at = excluded.started_at,
        started_received_at = excluded.started_received_at, received_at = excluded.received_at,
        latest_sequence = excluded.latest_sequence, latest_event_type = excluded.latest_event_type,
        last_liveness_received_at = excluded.last_liveness_received_at,
        liveness_deadline = excluded.liveness_deadline, late_deadline = excluded.late_deadline,
        is_late = excluded.is_late, late_at = excluded.late_at,
        late_transitions = excluded.late_transitions, stale_at = excluded.stale_at,
        stale_transitions = excluded.stale_transitions, job_version = excluded.job_version,
        current_step = excluded.current_step, terminal_event_id = excluded.terminal_event_id,
        terminal_conflict_json = excluded.terminal_conflict_json
    `).bind(
      run.job_key, run.run_id, run.status, run.started_at, run.started_received_at, run.received_at,
      run.latest_sequence, run.latest_event_type, run.last_liveness_received_at, run.liveness_deadline,
      run.late_deadline, run.is_late, run.late_at, run.late_transitions, run.stale_at,
      run.stale_transitions, run.job_version, run.current_step, run.terminal_event_id,
      run.terminal_conflict_json
    ).run();
  }
}
