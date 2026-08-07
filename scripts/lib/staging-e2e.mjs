/**
 * staging-e2e.mjs
 *
 * Reusable Node module for talking to PingStep's internal, staging-only E2E
 * control surface (`/v1/internal/e2e/*`, see src/worker/e2e-control.ts).
 *
 * Responsibilities: validate the target is a staging URL; register a test
 * run; pre-register deterministic resources; mark resources created;
 * complete the run; request cleanup; poll cleanup to a terminal state;
 * redact secrets from any printed output; produce a safe JSON summary.
 *
 * This module makes no product-specific assertions — it only manages E2E
 * run/resource lifecycle. The calling script owns the actual test logic.
 */

const PRODUCTION_PATTERNS = [/pingstep\.dev$/i, /pingstep\.com$/i, /\/\/pingstep\./i];
const CLEANUP_POLL_INTERVAL_MS = 3_000;
const CLEANUP_POLL_TIMEOUT_MS = 60_000;
const MAX_CLEANUP_REQUEST_ATTEMPTS = 3;
const TERMINAL_CLEANUP_STATUSES = new Set(['completed', 'completed_with_absent_resources', 'requires_operator', 'operator_acknowledged']);

/**
 * Only these states mean cleanup genuinely succeeded. Everything else —
 * nonterminal states left at a poll timeout ('pending', 'in_progress',
 * 'unknown'), 'requires_operator', 'operator_acknowledged' (an operator
 * resolved a failure; automatic cleanup did not succeed), and 'error' —
 * must be reported as a cleanup failure by callers, never as success.
 */
const SUCCESSFUL_CLEANUP_STATUSES = new Set(['completed', 'completed_with_absent_resources']);

export function isCleanupSuccessful(status) {
  return SUCCESSFUL_CLEANUP_STATUSES.has(status);
}

export function redact(value) {
  if (!value || typeof value !== 'string' || value.length < 12) return '***';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function assertStagingUrl(rawUrl) {
  const baseUrl = String(rawUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) throw new TypeError('A staging base URL is required.');
  const parsed = new URL(baseUrl);
  for (const pattern of PRODUCTION_PATTERNS) {
    if (pattern.test(parsed.hostname) || pattern.test(baseUrl)) {
      throw new Error(`Refusing to run E2E control operations against a production-looking URL: ${parsed.hostname}`);
    }
  }
  return baseUrl;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StagingE2EHarness {
  /**
   * @param {object} options
   * @param {string} options.baseUrl - staging Worker base URL (validated non-production)
   * @param {string} options.controlToken - E2E_CONTROL_TOKEN
   * @param {AbortSignal} [options.signal] - propagated to every control request so an
   *   overall timeout can abort in-flight requests and still proceed to cleanup.
   */
  constructor({ baseUrl, controlToken, signal }) {
    this.baseUrl = assertStagingUrl(baseUrl);
    if (!controlToken) throw new TypeError('An E2E control token is required.');
    this.controlToken = controlToken;
    this.signal = signal;
    this.runId = null;
    this.registeredResources = [];
  }

  async call(method, path, body, { signal: signalOverride } = {}) {
    const headers = { authorization: `Bearer ${this.controlToken}`, 'content-type': 'application/json' };
    const options = { method, headers, signal: signalOverride ?? this.signal ?? AbortSignal.timeout(15_000) };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, options);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: '[unparseable response body omitted]' }; }
    if (!response.ok) {
      const error = new Error(`E2E control call failed: ${method} ${path} -> HTTP ${response.status} ${JSON.stringify(data)}`);
      error.status = response.status;
      error.phase = 'e2e-control';
      throw error;
    }
    return data;
  }

  /** Registers one E2E run and stores its id for subsequent calls. */
  async registerRun({ suite, source, githubRunId, githubRunAttempt, commitSha, id }) {
    const result = await this.call('POST', '/v1/internal/e2e/runs', {
      id,
      suite,
      source,
      github_run_id: githubRunId ?? undefined,
      github_run_attempt: githubRunAttempt ?? undefined,
      commit_sha: commitSha ?? undefined
    });
    this.runId = result.run.id;
    return result.run;
  }

  /** Pre-registers a resource as 'planned' before it's actually created. */
  async planResource(resourceType, resourceRef, subtype) {
    if (!this.runId) throw new Error('Call registerRun() before planResource().');
    const result = await this.call('POST', `/v1/internal/e2e/runs/${this.runId}/resources`, {
      resource_type: resourceType, resource_ref: resourceRef, subtype, lifecycle: 'planned'
    });
    this.registeredResources.push({ resourceType, resourceRef });
    return result.resource;
  }

  /** Marks a previously-planned (or new) resource as created and verifies ownership server-side. */
  async markResourceCreated(resourceType, resourceRef, subtype) {
    if (!this.runId) throw new Error('Call registerRun() before markResourceCreated().');
    const result = await this.call('POST', `/v1/internal/e2e/runs/${this.runId}/resources`, {
      resource_type: resourceType, resource_ref: resourceRef, subtype, lifecycle: 'created'
    });
    if (!this.registeredResources.some((r) => r.resourceType === resourceType && r.resourceRef === resourceRef)) {
      this.registeredResources.push({ resourceType, resourceRef });
    }
    return result.resource;
  }

  /** Marks the run's outcome. failurePhase/failureCode must be non-sensitive short codes only. */
  async completeRun(status, { failurePhase, failureCode, signal } = {}) {
    if (!this.runId) throw new Error('Call registerRun() before completeRun().');
    return this.call('POST', `/v1/internal/e2e/runs/${this.runId}/complete`, {
      status, failure_phase: failurePhase, failure_code: failureCode
    }, { signal });
  }

  /** Requests cleanup and returns the immediate (first) result — does not poll. */
  async requestCleanup({ signal } = {}) {
    if (!this.runId) throw new Error('Call registerRun() before requestCleanup().');
    return this.call('POST', `/v1/internal/e2e/runs/${this.runId}/cleanup`, {}, { signal });
  }

  /** Polls run status until cleanup reaches a terminal state or the timeout elapses. */
  async pollCleanupToTerminal(timeoutMs = CLEANUP_POLL_TIMEOUT_MS, { signal, pollIntervalMs = CLEANUP_POLL_INTERVAL_MS } = {}) {
    if (!this.runId) throw new Error('Call registerRun() before pollCleanupToTerminal().');
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.call('GET', `/v1/internal/e2e/runs/${this.runId}`, undefined, { signal });
      if (TERMINAL_CLEANUP_STATUSES.has(last.run.cleanup_status)) return last;
      await sleep(pollIntervalMs);
    }
    return last;
  }

  /**
   * First line of defense: request cleanup and poll it to a terminal state,
   * bounded by its own overall timeout so it can never hang indefinitely.
   * While the run remains retryable (a nonterminal status such as 'pending'
   * or 'in_progress'), performs bounded re-attempts (re-requesting cleanup,
   * which re-leases a 'pending' run) within the same time budget.
   *
   * Returns a safe summary with an explicit `successful` boolean; only
   * 'completed' and 'completed_with_absent_resources' are ever reported as
   * successful — a nonterminal status left at the timeout is a failure.
   * Never throws — cleanup failures are reported, not thrown, so they
   * don't mask the original test failure.
   */
  async cleanup(timeoutMs = CLEANUP_POLL_TIMEOUT_MS, { pollIntervalMs = CLEANUP_POLL_INTERVAL_MS } = {}) {
    if (!this.runId) return { attempted: false, successful: false, cleanup_status: 'not_started', run_id: null };
    const deadline = Date.now() + timeoutMs;
    // Use a fresh signal for cleanup calls so that an aborted overall signal
    // (from a test timeout) does not prevent cleanup from completing.
    const cleanupSignal = AbortSignal.timeout(timeoutMs + 10_000);
    // Each re-attempt gets its own slice of the overall budget so a
    // nonterminal poll cannot consume the whole timeout and starve the
    // remaining bounded re-attempts.
    const perAttemptMs = Math.max(1, Math.floor(timeoutMs / MAX_CLEANUP_REQUEST_ATTEMPTS));
    let status = 'unknown';
    let resources = [];
    try {
      for (let attempt = 1; attempt <= MAX_CLEANUP_REQUEST_ATTEMPTS; attempt += 1) {
        const requested = await this.requestCleanup({ signal: cleanupSignal });
        if (typeof requested?.cleanup_status === 'string') status = requested.cleanup_status;
        if (Array.isArray(requested?.resources)) resources = requested.resources;
        if (!TERMINAL_CLEANUP_STATUSES.has(status)) {
          const budget = Math.min(perAttemptMs, deadline - Date.now());
          if (budget > 0) {
            const polled = await this.pollCleanupToTerminal(budget, { signal: cleanupSignal, pollIntervalMs });
            if (typeof polled?.run?.cleanup_status === 'string') status = polled.run.cleanup_status;
            if (Array.isArray(polled?.resources)) resources = polled.resources;
          }
        }
        if (SUCCESSFUL_CLEANUP_STATUSES.has(status)) {
          return { attempted: true, successful: true, cleanup_status: status, run_id: this.runId, resources };
        }
        // requires_operator / operator_acknowledged are terminal for automatic
        // cleanup — re-requesting cannot change them, so stop re-attempting.
        if (TERMINAL_CLEANUP_STATUSES.has(status) || Date.now() >= deadline) break;
      }
      return { attempted: true, successful: false, cleanup_status: status, run_id: this.runId, resources };
    } catch (error) {
      return { attempted: true, successful: false, cleanup_status: 'error', run_id: this.runId, error: error instanceof Error ? error.message : String(error) };
    }
  }

  summary() {
    return {
      run_id: this.runId,
      base_url: this.baseUrl,
      registered_resources: this.registeredResources.map((r) => `${r.resourceType}:${r.resourceRef}`)
    };
  }
}

/** Typed error used by test scripts instead of calling process.exit() directly. */
export class E2EPhaseError extends Error {
  constructor(phase, message, context = {}) {
    super(message);
    this.name = 'E2EPhaseError';
    this.phase = phase;
    this.context = context;
  }
}
