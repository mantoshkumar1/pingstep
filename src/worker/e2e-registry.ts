/**
 * D1 persistence for the staging-only E2E test registry (issue #174).
 *
 * This is a thin SQL boundary, same shape as PingStepD1Repository: it never
 * accepts caller-supplied table names, SQL fragments, or delete predicates.
 * All business rules (allowlists, ownership checks, cleanup ordering) live
 * in e2e-control.ts and e2e-janitor.ts, which are unit-testable against an
 * in-memory fake that matches this class's method signatures.
 */

export type E2ERunSource = 'github_push' | 'workflow_dispatch' | 'local_manual';
export type E2ERunStatus = 'registered' | 'running' | 'passed' | 'failed' | 'cancelled';
export type E2ECleanupStatus =
  | 'not_started'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'completed_with_absent_resources'
  | 'requires_operator'
  | 'operator_acknowledged';

/** Code-defined allowlist. Extend only when a feature ships a cleanup adapter for it. */
export type E2EResourceType = 'job';
export const E2E_RESOURCE_TYPES: ReadonlySet<E2EResourceType> = new Set(['job']);

export type E2EResourceLifecycle = 'planned' | 'created' | 'absent' | 'cleaned' | 'cleanup_failed';

export type E2ETestRun = {
  id: string;
  suite: string;
  source: E2ERunSource;
  github_run_id: string | null;
  github_run_attempt: string | null;
  commit_sha: string | null;
  status: E2ERunStatus;
  cleanup_status: E2ECleanupStatus;
  failure_phase: string | null;
  failure_code: string | null;
  created_resource_count: number;
  cleaned_resource_count: number;
  created_at: string;
  completed_at: string | null;
  cleanup_started_at: string | null;
  cleaned_at: string | null;
  expires_at: string;
};

export type E2ETestResource = {
  run_id: string;
  resource_type: E2EResourceType;
  resource_ref: string;
  subtype: string | null;
  lifecycle: E2EResourceLifecycle;
  cleanup_attempts: number;
  cleanup_failure_code: string | null;
  created_at: string | null;
  cleaned_at: string | null;
};

export class E2ERegistryRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async insertRun(run: {
    id: string;
    suite: string;
    source: E2ERunSource;
    github_run_id: string | null;
    github_run_attempt: string | null;
    commit_sha: string | null;
    created_at: string;
    expires_at: string;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO e2e_test_runs (
        id, suite, source, github_run_id, github_run_attempt, commit_sha,
        status, cleanup_status, created_resource_count, cleaned_resource_count,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'registered', 'not_started', 0, 0, ?, ?)
    `).bind(
      run.id, run.suite, run.source, run.github_run_id, run.github_run_attempt, run.commit_sha,
      run.created_at, run.expires_at
    ).run();
  }

  async getRun(id: string): Promise<E2ETestRun | null> {
    return this.db.prepare('SELECT * FROM e2e_test_runs WHERE id = ?').bind(id).first<E2ETestRun>();
  }

  async setRunStatus(id: string, status: E2ERunStatus, now: string, failurePhase: string | null, failureCode: string | null): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE e2e_test_runs
      SET status = ?, completed_at = ?, failure_phase = ?, failure_code = ?
      WHERE id = ? AND status IN ('registered', 'running')
    `).bind(status, now, failurePhase, failureCode, id).run();
    return result.meta.changes === 1;
  }

  async markRunRunning(id: string): Promise<void> {
    await this.db.prepare(`UPDATE e2e_test_runs SET status = 'running' WHERE id = ? AND status = 'registered'`).bind(id).run();
  }

  /**
   * Compare-and-swap lease: only one caller can move a run's cleanup into
   * 'in_progress' at a time.  Accepts 'not_started', 'pending', and stale
   * 'in_progress' leases whose cleanup_started_at is older than leaseExpiryIso
   * (for recovery after Worker interruption).
   *
   * Does NOT accept 'requires_operator' — that status is terminal for
   * automatic retry and can only be resolved via acknowledgeCleanup() or
   * resetCleanup().
   */
  async acquireCleanupLease(id: string, now: string, leaseExpiryIso: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE e2e_test_runs
      SET cleanup_status = 'in_progress', cleanup_started_at = ?
      WHERE id = ? AND (
        cleanup_status IN ('not_started', 'pending')
        OR (cleanup_status = 'in_progress' AND cleanup_started_at <= ?)
      )
    `).bind(now, id, leaseExpiryIso).run();
    return result.meta.changes === 1;
  }

  /**
   * Record the cleanup outcome.  Only truly terminal statuses (completed,
   * completed_with_absent_resources) set cleaned_at — requires_operator
   * leaves it NULL so the 30-day purge window doesn't keep resetting.
   */
  async finishCleanup(id: string, status: E2ECleanupStatus, now: string, cleanedCount: number): Promise<void> {
    const isTerminal = status === 'completed' || status === 'completed_with_absent_resources' || status === 'operator_acknowledged';
    await this.db.prepare(`
      UPDATE e2e_test_runs
      SET cleanup_status = ?, cleaned_at = ?, cleaned_resource_count = ?
      WHERE id = ?
    `).bind(status, isTerminal ? now : null, cleanedCount, id).run();
  }

  /**
   * Operator acknowledges a requires_operator run.  Uses
   * 'operator_acknowledged' — not 'completed_with_absent_resources' — so
   * the registry honestly reflects that an operator resolved the failure
   * rather than automatic cleanup succeeding.  Resources keep their
   * cleanup_failed lifecycle and failure codes as evidence.
   */
  async acknowledgeCleanup(id: string, now: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE e2e_test_runs
      SET cleanup_status = 'operator_acknowledged', cleaned_at = ?
      WHERE id = ? AND cleanup_status = 'requires_operator'
    `).bind(now, id).run();
    return result.meta.changes === 1;
  }

  /**
   * Atomic operator reset: in a single D1 batch (one transaction), re-arms
   * this run's safely retryable failed resources — cleanup_attempts back to
   * 0 only for transient failure codes ('rows_remaining', 'exception'),
   * NEVER 'ownership_mismatch', which is permanent — and CASes the run from
   * 'requires_operator' to 'pending' (clearing cleanup_started_at so it can
   * be re-leased).
   *
   * Both statements are guarded by the run still being 'requires_operator'
   * (the resource UPDATE via an EXISTS subquery, the run UPDATE via its
   * WHERE clause) and execute in one transaction, so a reset that loses a
   * concurrent race (e.g. acknowledge-vs-reset) changes NOTHING — neither
   * the run row nor any resource attempt counter or failure evidence.
   */
  async resetCleanupAndRearm(id: string): Promise<{ applied: boolean; rearmedResources: number }> {
    const results = await this.db.batch([
      this.db.prepare(`
        UPDATE e2e_test_resources
        SET cleanup_attempts = 0
        WHERE run_id = ? AND lifecycle = 'cleanup_failed'
          AND cleanup_failure_code IN ('rows_remaining', 'exception')
          AND EXISTS (SELECT 1 FROM e2e_test_runs WHERE id = ? AND cleanup_status = 'requires_operator')
      `).bind(id, id),
      this.db.prepare(`
        UPDATE e2e_test_runs
        SET cleanup_status = 'pending', cleanup_started_at = NULL
        WHERE id = ? AND cleanup_status = 'requires_operator'
      `).bind(id)
    ]);
    return { applied: results[1]?.meta.changes === 1, rearmedResources: results[0]?.meta.changes ?? 0 };
  }

  async requestCleanup(id: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE e2e_test_runs SET cleanup_status = 'pending'
      WHERE id = ? AND cleanup_status = 'not_started'
    `).bind(id).run();
    return result.meta.changes === 1;
  }

  /**
   * Returns expired runs that need cleanup attention: 'not_started', 'pending',
   * and stale 'in_progress' runs whose lease has expired.
   *
   * Does NOT select 'requires_operator' — those are terminal for automatic
   * retry and need explicit operator intervention via acknowledgeCleanup() or
   * resetCleanup().
   */
  async listExpiredRuns(now: string, limit: number, leaseExpiryIso: string): Promise<E2ETestRun[]> {
    const result = await this.db.prepare(`
      SELECT * FROM e2e_test_runs
      WHERE expires_at <= ? AND (
        cleanup_status IN ('not_started', 'pending')
        OR (cleanup_status = 'in_progress' AND cleanup_started_at <= ?)
      )
      ORDER BY expires_at ASC
      LIMIT ?
    `).bind(now, leaseExpiryIso, limit).all<E2ETestRun>();
    return result.results;
  }

  async registerResource(resource: {
    run_id: string;
    resource_type: E2EResourceType;
    resource_ref: string;
    subtype: string | null;
    lifecycle: E2EResourceLifecycle;
    now: string;
  }): Promise<'inserted' | 'already_registered'> {
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO e2e_test_resources (run_id, resource_type, resource_ref, subtype, lifecycle, cleanup_attempts, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).bind(resource.run_id, resource.resource_type, resource.resource_ref, resource.subtype, resource.lifecycle, resource.lifecycle === 'created' ? resource.now : null).run();
    return result.meta.changes === 1 ? 'inserted' : 'already_registered';
  }

  async getResource(runId: string, type: E2EResourceType, ref: string): Promise<E2ETestResource | null> {
    return this.db.prepare('SELECT * FROM e2e_test_resources WHERE run_id = ? AND resource_type = ? AND resource_ref = ?')
      .bind(runId, type, ref).first<E2ETestResource>();
  }

  async listResourcesForRun(runId: string): Promise<E2ETestResource[]> {
    const result = await this.db.prepare('SELECT * FROM e2e_test_resources WHERE run_id = ?').bind(runId).all<E2ETestResource>();
    return result.results;
  }

  async markResourceLifecycle(runId: string, type: E2EResourceType, ref: string, lifecycle: E2EResourceLifecycle, now: string, failureCode: string | null = null): Promise<void> {
    if (lifecycle === 'created') {
      await this.db.prepare(`
        UPDATE e2e_test_resources SET lifecycle = ?, created_at = ? WHERE run_id = ? AND resource_type = ? AND resource_ref = ?
      `).bind(lifecycle, now, runId, type, ref).run();
    } else if (lifecycle === 'cleaned' || lifecycle === 'absent') {
      await this.db.prepare(`
        UPDATE e2e_test_resources SET lifecycle = ?, cleaned_at = ?, cleanup_failure_code = NULL WHERE run_id = ? AND resource_type = ? AND resource_ref = ?
      `).bind(lifecycle, now, runId, type, ref).run();
    } else if (lifecycle === 'cleanup_failed') {
      await this.db.prepare(`
        UPDATE e2e_test_resources SET lifecycle = ?, cleanup_attempts = cleanup_attempts + 1, cleanup_failure_code = ? WHERE run_id = ? AND resource_type = ? AND resource_ref = ?
      `).bind(lifecycle, failureCode, runId, type, ref).run();
    } else {
      await this.db.prepare(`
        UPDATE e2e_test_resources SET lifecycle = ? WHERE run_id = ? AND resource_type = ? AND resource_ref = ?
      `).bind(lifecycle, runId, type, ref).run();
    }
  }

  async incrementCreatedResourceCount(runId: string): Promise<void> {
    await this.db.prepare('UPDATE e2e_test_runs SET created_resource_count = created_resource_count + 1 WHERE id = ?').bind(runId).run();
  }

  /**
   * Verify a job in the ordinary `jobs` table matches this run's expected
   * E2E ownership/creation window before it can be claimed as a registered
   * resource. Returns the job's owner (always null for E2E jobs) and
   * created_at, or null if no such job exists yet.
   */
  async findCandidateJob(jobKey: string): Promise<{ owner_user_id: string | null; created_at: string } | null> {
    return this.db.prepare('SELECT owner_user_id, created_at FROM jobs WHERE job_key = ?').bind(jobKey).first();
  }

  /**
   * FK-safe, retry-safe cleanup for one E2E job: alerts, then pending-event
   * rows for the job's events, then runs, then events, then the job row
   * itself — and only the exact job row registered to this run, never a
   * LIKE-prefix match. Returns the number of job rows actually deleted (0 or 1).
   */
  async cleanupJobResource(jobKey: string): Promise<{ jobDeleted: boolean }> {
    const batchResult = await this.db.batch([
      this.db.prepare('DELETE FROM alerts WHERE job_key = ?').bind(jobKey),
      this.db.prepare('DELETE FROM pending_events WHERE event_id IN (SELECT event_id FROM events WHERE job_key = ?)').bind(jobKey),
      this.db.prepare('DELETE FROM runs WHERE job_key = ?').bind(jobKey),
      this.db.prepare('DELETE FROM events WHERE job_key = ?').bind(jobKey),
      this.db.prepare('DELETE FROM jobs WHERE job_key = ? AND owner_user_id IS NULL').bind(jobKey)
    ]);
    return { jobDeleted: batchResult.at(-1)?.meta.changes === 1 };
  }

  /** Post-cleanup verification: zero job-owned rows remain in any related table. */
  async countJobOwnedRows(jobKey: string): Promise<number> {
    const row = await this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM jobs WHERE job_key = ?) +
        (SELECT COUNT(*) FROM events WHERE job_key = ?) +
        (SELECT COUNT(*) FROM runs WHERE job_key = ?) +
        (SELECT COUNT(*) FROM alerts WHERE job_key = ?) +
        (SELECT COUNT(*) FROM pending_events WHERE event_id IN (SELECT event_id FROM events WHERE job_key = ?)) AS total
    `).bind(jobKey, jobKey, jobKey, jobKey, jobKey).first<{ total: number }>();
    return row?.total ?? 0;
  }

  /** Legacy dry-run inventory: pre-registry e2e-late-* jobs with no owner. Row counts only, no content. */
  async legacyInventory(limit: number): Promise<Array<{ job_key: string; created_at: string; run_count: number; event_count: number; alert_count: number }>> {
    const result = await this.db.prepare(`
      SELECT j.job_key AS job_key, j.created_at AS created_at,
        (SELECT COUNT(*) FROM runs r WHERE r.job_key = j.job_key) AS run_count,
        (SELECT COUNT(*) FROM events e WHERE e.job_key = j.job_key) AS event_count,
        (SELECT COUNT(*) FROM alerts a WHERE a.job_key = j.job_key) AS alert_count
      FROM jobs j
      WHERE j.owner_user_id IS NULL AND j.job_key LIKE 'e2e-late-%'
        AND j.job_key NOT IN (SELECT resource_ref FROM e2e_test_resources WHERE resource_type = 'job')
      ORDER BY j.created_at ASC
      LIMIT ?
    `).bind(limit).all<{ job_key: string; created_at: string; run_count: number; event_count: number; alert_count: number }>();
    return result.results;
  }

  async purgeOldRegistryRows(before: string, limit: number): Promise<number> {
    const result = await this.db.prepare(`
      DELETE FROM e2e_test_runs
      WHERE id IN (
        SELECT id FROM e2e_test_runs
        WHERE cleaned_at IS NOT NULL AND cleaned_at <= ?
        LIMIT ?
      )
    `).bind(before, limit).run();
    return result.meta.changes;
  }
}
