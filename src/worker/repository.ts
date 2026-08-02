export type StoredJob = {
  job_key: string;
  token_hash: string;
  viewer_token_hash: string | null;
  owner_user_id: string | null;
  expected_update_interval_seconds: number;
  liveness_grace_seconds: number;
  expected_duration_seconds: number | null;
  late_grace_seconds: number | null;
};

export type StoredUser = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export type StoredSession = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  email: string;
};

export type OAuthIdentityUser = {
  id: string;
  email: string;
};

export type AccountPlan = {
  plan: 'trial' | 'pro' | 'team';
  active_until: string | null;
};

export type StoredBillingSubscription = {
  stripe_subscription_id: string;
  user_id: string;
  stripe_customer_id: string;
  plan: 'pro' | 'team';
  status: string;
  current_period_end: string | null;
  updated_at: string;
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

export type AlertRecord = {
  id: string;
  type: 'stale' | 'late';
  job_key: string;
  run_id: string;
  status: string;
  current_step: string | null;
  message: string;
  created_at: string;
  delivery_status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  last_error?: string | null;
};

/**
 * D1 persistence boundary. The Worker layer never builds SQL with request values:
 * every value is passed through a prepared-statement binding.
 */
export class PingStepD1Repository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getJob(jobKey: string): Promise<StoredJob | null> {
    return this.db.prepare(`
      SELECT job_key, token_hash, owner_user_id, expected_update_interval_seconds,
             viewer_token_hash, liveness_grace_seconds, expected_duration_seconds, late_grace_seconds
      FROM jobs WHERE job_key = ?
    `).bind(jobKey).first<StoredJob>();
  }

  async getJobByViewerTokenHash(tokenHash: string): Promise<StoredJob | null> {
    return this.db.prepare(`
      SELECT job_key, token_hash, viewer_token_hash, owner_user_id, expected_update_interval_seconds,
             liveness_grace_seconds, expected_duration_seconds, late_grace_seconds
      FROM jobs WHERE viewer_token_hash = ?
    `).bind(tokenHash).first<StoredJob>();
  }

  async listJobs(): Promise<Omit<StoredJob, 'token_hash'>[]> {
    const result = await this.db.prepare(`
      SELECT job_key, owner_user_id, expected_update_interval_seconds, liveness_grace_seconds,
             expected_duration_seconds, late_grace_seconds
      FROM jobs ORDER BY job_key ASC
    `).all<Omit<StoredJob, 'token_hash'>>();
    return result.results;
  }

  async listJobsForOwner(userId: string): Promise<Omit<StoredJob, 'token_hash' | 'viewer_token_hash'>[]> {
    const result = await this.db.prepare(`
      SELECT job_key, owner_user_id, expected_update_interval_seconds, liveness_grace_seconds,
             expected_duration_seconds, late_grace_seconds
      FROM jobs WHERE owner_user_id = ? ORDER BY job_key ASC
    `).bind(userId).all<Omit<StoredJob, 'token_hash' | 'viewer_token_hash'>>();
    return result.results;
  }

  async countJobsForOwner(userId: string): Promise<number> {
    const result = await this.db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE owner_user_id = ?')
      .bind(userId).first<{ count: number }>();
    return result?.count ?? 0;
  }

  async countRunsForOwnerSince(userId: string, since: string): Promise<number> {
    const result = await this.db.prepare('SELECT COUNT(*) AS count FROM runs r INNER JOIN jobs j ON j.job_key = r.job_key WHERE j.owner_user_id = ? AND r.started_received_at >= ?')
      .bind(userId, since).first<{ count: number }>();
    return result?.count ?? 0;
  }

  async getAccountPlan(userId: string, now: string): Promise<AccountPlan> {
    const plan = await this.db.prepare('SELECT plan, active_until FROM account_plans WHERE user_id = ?')
      .bind(userId).first<AccountPlan>();
    if (!plan || (plan.active_until && plan.active_until <= now)) return { plan: 'trial', active_until: null };
    return plan;
  }

  async setAccountPlan(userId: string, plan: AccountPlan['plan'], activeUntil: string | null, now: string): Promise<void> {
    await this.db.prepare('INSERT INTO account_plans (user_id, plan, active_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, active_until = excluded.active_until, updated_at = excluded.updated_at')
      .bind(userId, plan, activeUntil, now, now).run();
  }

  async getBillingSubscription(subscriptionId: string): Promise<StoredBillingSubscription | null> {
    return this.db.prepare('SELECT stripe_subscription_id, user_id, stripe_customer_id, plan, status, current_period_end, updated_at FROM billing_subscriptions WHERE stripe_subscription_id = ?')
      .bind(subscriptionId).first<StoredBillingSubscription>();
  }

  async getBillingSubscriptionForUser(userId: string): Promise<StoredBillingSubscription | null> {
    return this.db.prepare(`SELECT stripe_subscription_id, user_id, stripe_customer_id, plan, status, current_period_end, updated_at
      FROM billing_subscriptions WHERE user_id = ?
      ORDER BY CASE WHEN status IN ('active', 'trialing') THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`)
      .bind(userId).first<StoredBillingSubscription>();
  }

  async listBillingSubscriptionsForUser(userId: string): Promise<StoredBillingSubscription[]> {
    const result = await this.db.prepare('SELECT stripe_subscription_id, user_id, stripe_customer_id, plan, status, current_period_end, updated_at FROM billing_subscriptions WHERE user_id = ?')
      .bind(userId).all<StoredBillingSubscription>();
    return result.results;
  }

  async upsertBillingSubscription(subscription: StoredBillingSubscription): Promise<void> {
    await this.db.prepare(`INSERT INTO billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, plan, status, current_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET user_id = excluded.user_id, stripe_customer_id = excluded.stripe_customer_id, plan = excluded.plan, status = excluded.status, current_period_end = excluded.current_period_end, updated_at = excluded.updated_at`)
      .bind(subscription.stripe_subscription_id, subscription.user_id, subscription.stripe_customer_id, subscription.plan, subscription.status, subscription.current_period_end, subscription.updated_at).run();
  }

  async createJob(job: StoredJob, now: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO jobs (
        job_key, token_hash, expected_update_interval_seconds, liveness_grace_seconds,
        expected_duration_seconds, late_grace_seconds, viewer_token_hash, owner_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      job.job_key, job.token_hash, job.expected_update_interval_seconds, job.liveness_grace_seconds,
      job.expected_duration_seconds, job.late_grace_seconds, job.viewer_token_hash, job.owner_user_id, now, now
    ).run();
  }

  async rotateJobTokens(jobKey: string, ownerUserId: string, tokenHash: string, viewerTokenHash: string, now: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE jobs SET token_hash = ?, viewer_token_hash = ?, updated_at = ?
      WHERE job_key = ? AND owner_user_id = ?
    `).bind(tokenHash, viewerTokenHash, now, jobKey, ownerUserId).run();
    return result.meta.changes === 1;
  }

  async deleteJobForOwner(jobKey: string, ownerUserId: string): Promise<boolean> {
    const ownsJob = await this.db.prepare('SELECT 1 FROM jobs WHERE job_key = ? AND owner_user_id = ?')
      .bind(jobKey, ownerUserId).first();
    if (!ownsJob) return false;
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM alerts WHERE job_key = ?').bind(jobKey),
      this.db.prepare('DELETE FROM pending_events WHERE event_id IN (SELECT event_id FROM events WHERE job_key = ?)').bind(jobKey),
      this.db.prepare('DELETE FROM runs WHERE job_key = ?').bind(jobKey),
      this.db.prepare('DELETE FROM events WHERE job_key = ?').bind(jobKey),
      this.db.prepare('DELETE FROM jobs WHERE job_key = ? AND owner_user_id = ?').bind(jobKey, ownerUserId)
    ]);
    return results.at(-1)?.meta.changes === 1;
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

  async listRunsForJob(jobKey: string): Promise<RunProjection[]> {
    const result = await this.db.prepare(
      'SELECT * FROM runs WHERE job_key = ? ORDER BY received_at DESC LIMIT 100'
    ).bind(jobKey).all<RunProjection>();
    return result.results;
  }

  async listRunsForOwner(userId: string): Promise<RunProjection[]> {
    const result = await this.db.prepare(`
      SELECT r.* FROM runs r
      INNER JOIN jobs j ON j.job_key = r.job_key
      WHERE j.owner_user_id = ?
      ORDER BY r.received_at DESC LIMIT 100
    `).bind(userId).all<RunProjection>();
    return result.results;
  }

  async createUser(user: StoredUser): Promise<void> {
    await this.db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, user.email, user.password_hash, user.created_at).run();
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    return this.db.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?')
      .bind(email).first<StoredUser>();
  }

  async getUserByOAuthIdentity(provider: string, subject: string): Promise<OAuthIdentityUser | null> {
    return this.db.prepare(`
      SELECT u.id, u.email
      FROM oauth_identities i INNER JOIN users u ON u.id = i.user_id
      WHERE i.provider = ? AND i.subject = ?
    `).bind(provider, subject).first<OAuthIdentityUser>();
  }

  async createOAuthIdentity(provider: string, subject: string, userId: string, createdAt: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO oauth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)
    `).bind(provider, subject, userId, createdAt).run();
  }

  async createOAuthState(state: string, provider: string, expiresAt: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO oauth_states (state, provider, expires_at, created_at) VALUES (?, ?, ?, ?)
    `).bind(state, provider, expiresAt, new Date().toISOString()).run();
  }

  async consumeOAuthState(state: string, provider: string, now: string): Promise<boolean> {
    const result = await this.db.prepare(`
      DELETE FROM oauth_states WHERE state = ? AND provider = ? AND expires_at > ?
    `).bind(state, provider, now).run();
    return result.meta.changes === 1;
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    const result = await this.db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now).run();
    return result.meta.changes;
  }

  async createSession(session: Omit<StoredSession, 'email'>): Promise<void> {
    await this.db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)
    `).bind(session.id, session.user_id, session.token_hash, session.expires_at, session.created_at).run();
  }

  async getSessionByTokenHash(tokenHash: string, now: string): Promise<StoredSession | null> {
    return this.db.prepare(`
      SELECT s.id, s.user_id, s.token_hash, s.expires_at, s.created_at, u.email
      FROM sessions s INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).bind(tokenHash, now).first<StoredSession>();
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }

  async deleteExpiredSessions(now: string): Promise<number> {
    const result = await this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
    return result.meta.changes;
  }

  async expirePendingEvents(now: string): Promise<number> {
    const result = await this.db.prepare('UPDATE pending_events SET expired_at = ? WHERE expired_at IS NULL AND expires_at <= ?')
      .bind(now, now).run();
    return result.meta.changes;
  }

  async markExpiredRunsStale(now: string): Promise<number> {
    const result = await this.db.prepare(`
      UPDATE runs
      SET status = 'stale', stale_at = ?, stale_transitions = stale_transitions + 1
      WHERE status = 'running' AND liveness_deadline IS NOT NULL AND liveness_deadline <= ?
    `).bind(now, now).run();
    return result.meta.changes;
  }

  async listExpiredRuns(now: string): Promise<RunProjection[]> {
    const result = await this.db.prepare(`
      SELECT * FROM runs
      WHERE status = 'running' AND liveness_deadline IS NOT NULL AND liveness_deadline <= ?
    `).bind(now).all<RunProjection>();
    return result.results;
  }

  async markRunStale(run: RunProjection, now: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE runs SET status = 'stale', stale_at = ?, stale_transitions = stale_transitions + 1
      WHERE job_key = ? AND run_id = ? AND status = 'running'
    `).bind(now, run.job_key, run.run_id).run();
    return result.meta.changes === 1;
  }

  async createAlert(alert: AlertRecord): Promise<void> {
    await this.db.prepare(`
      INSERT OR IGNORE INTO alerts (
        id, type, job_key, run_id, status, current_step, message, created_at, delivery_status, attempts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      alert.id, alert.type, alert.job_key, alert.run_id, alert.status, alert.current_step,
      alert.message, alert.created_at, alert.delivery_status, alert.attempts
    ).run();
  }

  async listAlerts(): Promise<AlertRecord[]> {
    const result = await this.db.prepare(`
      SELECT id, type, job_key, run_id, status, current_step, message, created_at, delivery_status, attempts,
             last_attempt_at, delivered_at, last_error
      FROM alerts ORDER BY created_at DESC LIMIT 100
    `).all<AlertRecord>();
    return result.results;
  }

  async listPendingAlerts(): Promise<AlertRecord[]> {
    const result = await this.db.prepare(`
      SELECT id, type, job_key, run_id, status, current_step, message, created_at, delivery_status, attempts,
             last_attempt_at, delivered_at, last_error
      FROM alerts WHERE delivery_status = 'pending' ORDER BY created_at ASC LIMIT 25
    `).all<AlertRecord>();
    return result.results;
  }

  async markAlertDelivered(id: string, now: string): Promise<void> {
    await this.db.prepare(`
      UPDATE alerts
      SET delivery_status = 'delivered', attempts = attempts + 1, last_attempt_at = ?, delivered_at = ?, last_error = NULL
      WHERE id = ? AND delivery_status = 'pending'
    `).bind(now, now, id).run();
  }

  async markAlertFailed(id: string, now: string, message: string): Promise<void> {
    await this.db.prepare(`
      UPDATE alerts
      SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
      WHERE id = ? AND delivery_status = 'pending'
    `).bind(now, message.slice(0, 500), id).run();
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
