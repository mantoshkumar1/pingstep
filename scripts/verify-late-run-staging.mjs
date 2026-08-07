#!/usr/bin/env node

/**
 * verify-late-run-staging.mjs
 *
 * Automated staging end-to-end test for late-run detection.
 * Verifies the full lifecycle: start → heartbeat → late detection → alert → completion.
 *
 * Every resource this script creates is registered against a single,
 * cryptographically random E2E test run (see scripts/lib/staging-e2e.mjs and
 * src/worker/e2e-control.ts, issue #174) so it can be cleaned up afterward —
 * on success, on ordinary failure, and (via the workflow's `if: always()`
 * step plus the staging orphan janitor) even if this process is killed.
 *
 * Required environment variables:
 *   PINGSTEP_STAGING_BASE_URL          — staging Worker URL (must not be production)
 *   PINGSTEP_STAGING_OPERATOR_TOKEN    — operator bearer token for staging
 *   PINGSTEP_STAGING_E2E_CONTROL_TOKEN — separate E2E control token for staging
 *
 * Optional:
 *   E2E_RUN_SUFFIX     — unique suffix for test isolation (defaults to timestamp)
 *   E2E_SOURCE         — github_push | workflow_dispatch | local_manual (default local_manual)
 *   E2E_RUN_ID_OUT_FILE — if set, the registered E2E run id is written here as soon as
 *                         registration succeeds, so a same-job `if: always()` cleanup
 *                         step can recover it even if this process is later killed.
 *   GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_SHA — recorded on the E2E run when present
 *
 * Usage:
 *   node scripts/verify-late-run-staging.mjs
 */

import { writeFileSync } from 'node:fs';
import { E2EPhaseError, StagingE2EHarness, redact } from './lib/staging-e2e.mjs';

const JOB_CONFIG = {
  expected_update_interval_seconds: 30,
  liveness_grace_seconds: 120,
  expected_duration_seconds: 60,
  late_grace_seconds: 30,
};

const HEARTBEAT_INTERVAL_MS = 20_000;
const POLL_INTERVAL_MS = 10_000;
const LATE_DEADLINE_SECONDS = JOB_CONFIG.expected_duration_seconds + JOB_CONFIG.late_grace_seconds;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_TIMEOUT_MS = 60 * 1000;
const DUPLICATE_WAIT_MS = 75_000; // > 1 reconciliation cycle (60s) + buffer

function elapsed(startMs) {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

async function api(baseUrl, method, path, token, body = null, signal) {
  const url = `${baseUrl}${path}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const options = { method, headers, signal: signal ?? AbortSignal.timeout(15_000) };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest({ baseUrl, operatorToken, harness, startMs, abortController }) {
  const suffix = process.env.E2E_RUN_SUFFIX || `${Date.now()}`;
  const jobKey = `e2e-late-${suffix}`;
  const runId = `run-${suffix}`;
  const signal = abortController.signal;

  console.log(`\n🔬 Late-run e2e test`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Operator token: ${redact(operatorToken)}`);
  console.log(`   E2E run id: ${harness.runId}`);
  console.log(`   Job key: ${jobKey}`);
  console.log(`   Run ID: ${runId}`);
  console.log(`   Late deadline: ${LATE_DEADLINE_SECONDS}s after start`);
  console.log(`   Overall timeout: ${OVERALL_TIMEOUT_MS / 1000}s\n`);

  await harness.planResource('job', jobKey);

  let jobToken = null;
  let heartbeatTimer = null;
  let sequence = 1;
  let lastRunState = null;
  let heartbeatCount = 0;

  const fail = (phase, message, context = {}) => {
    throw new E2EPhaseError(phase, message, { startMs, jobKey, runId, lastRunState, ...context });
  };

  try {
    // ── Phase 1: Health check ──
    console.log(`[${elapsed(startMs)}] Phase 1: Health check`);
    const health = await api(baseUrl, 'GET', '/health', operatorToken, null, signal);
    if (health.status !== 200 || health.data.status !== 'ok') {
      fail('health', `Staging health check failed: HTTP ${health.status}`, { expected: 'HTTP 200, status=ok' });
    }
    console.log(`   ✓ Staging is healthy (env=${health.data.environment})\n`);

    // ── Phase 2: Provision test job ──
    console.log(`[${elapsed(startMs)}] Phase 2: Provision test job`);
    const provision = await api(baseUrl, 'POST', '/v1/operator/jobs', operatorToken, { job_key: jobKey, ...JOB_CONFIG }, signal);
    if (provision.status !== 201) {
      fail('provision', `Failed to create test job: HTTP ${provision.status} — ${JSON.stringify(provision.data)}`);
    }
    jobToken = provision.data.token;
    await harness.markResourceCreated('job', jobKey);
    console.log(`   ✓ Job created: ${jobKey}`);
    console.log(`   Token: ${redact(jobToken)}\n`);

    // ── Phase 3: Send started event ──
    console.log(`[${elapsed(startMs)}] Phase 3: Send started event`);
    const startedAt = new Date().toISOString();
    const startResult = await api(baseUrl, 'POST', '/v1/events', jobToken, {
      event_id: `${runId}-started`, job_key: jobKey, run_id: runId, sequence: sequence++,
      type: 'started', occurred_at: startedAt, data: { job_version: 'e2e-test' },
    }, signal);
    if (startResult.status !== 202) fail('start', `Failed to send started event: HTTP ${startResult.status}`);
    const runStartMs = Date.now();
    console.log(`   ✓ Run started at ${startedAt}\n`);

    // ── Phase 4: Send heartbeats ──
    console.log(`[${elapsed(startMs)}] Phase 4: Sending heartbeats every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
    heartbeatTimer = setInterval(async () => {
      try {
        const seq = sequence++;
        await api(baseUrl, 'POST', '/v1/events', jobToken, {
          event_id: `${runId}-hb-${seq}`, job_key: jobKey, run_id: runId, sequence: seq,
          type: 'heartbeat', occurred_at: new Date().toISOString(), data: {},
        });
        heartbeatCount++;
        console.log(`   ♥ Heartbeat #${heartbeatCount} sent (seq=${seq}) [${elapsed(startMs)}]`);
      } catch (err) {
        console.error(`   ⚠ Heartbeat failed: ${err.message}`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // ── Phase 5: Wait for late deadline + reconciliation ──
    const waitUntilLateMs = (LATE_DEADLINE_SECONDS + 65) * 1000; // +65s for reconciler (runs every 60s)
    console.log(`\n[${elapsed(startMs)}] Phase 5: Waiting ~${Math.ceil(waitUntilLateMs / 1000)}s for late deadline + reconciliation`);

    const timeSinceStart = Date.now() - runStartMs;
    const remainingWait = Math.max(0, LATE_DEADLINE_SECONDS * 1000 - timeSinceStart);
    if (remainingWait > 0) {
      console.log(`   Waiting ${Math.ceil(remainingWait / 1000)}s for late deadline...`);
      await sleep(remainingWait);
    }

    console.log(`   Late deadline passed. Polling for is_late=1...`);
    const pollDeadline = runStartMs + waitUntilLateMs;
    let isLate = false;
    while (Date.now() < pollDeadline) {
      const runsResult = await api(baseUrl, 'GET', '/v1/runs', operatorToken, null, signal);
      if (runsResult.status === 200) {
        const run = runsResult.data.runs?.find((r) => r.job_key === jobKey && r.run_id === runId);
        if (run) {
          lastRunState = run;
          if (run.is_late === 1) {
            isLate = true;
            console.log(`   ✓ Run flagged late at ${run.late_at} [${elapsed(startMs)}]`);
            break;
          }
          console.log(`   … status=${run.status}, is_late=${run.is_late} [${elapsed(startMs)}]`);
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!isLate) fail('late-detection', 'Run was never flagged late within the expected window', { expected: 'is_late=1' });
    if (lastRunState.status !== 'running') {
      fail('late-detection', `Run should still be 'running' but is '${lastRunState.status}'`, { expected: "status='running'" });
    }
    console.log(`   ✓ Run status is 'running' (not stale)\n`);

    // ── Phase 6: Verify exactly one late alert ──
    console.log(`[${elapsed(startMs)}] Phase 6: Verify exactly one late alert`);
    const alerts1 = await api(baseUrl, 'GET', '/v1/alerts', operatorToken, null, signal);
    if (alerts1.status !== 200) fail('alert-check', `Failed to fetch alerts: HTTP ${alerts1.status}`);
    const lateAlerts1 = alerts1.data.alerts?.filter((a) => a.job_key === jobKey && a.run_id === runId && a.type === 'late') ?? [];
    if (lateAlerts1.length !== 1) fail('alert-check', `Expected exactly 1 late alert, found ${lateAlerts1.length}`, { expected: '1 late alert' });
    console.log(`   ✓ Found exactly 1 late alert`);
    console.log(`   Alert ID: ${lateAlerts1[0].id}`);
    console.log(`   Alert status field: ${lateAlerts1[0].status}`);
    if (lateAlerts1[0].status !== 'running') {
      fail('alert-check', `Late alert status should be 'running', got '${lateAlerts1[0].status}'`, { expected: "alert.status='running'" });
    }
    console.log(`   ✓ Alert status is 'running' (correct — run is flagged, not stopped)\n`);

    // ── Phase 7: Wait for another reconciliation cycle, verify no duplicates ──
    console.log(`[${elapsed(startMs)}] Phase 7: Waiting ${DUPLICATE_WAIT_MS / 1000}s for duplicate check`);
    await sleep(DUPLICATE_WAIT_MS);

    const alerts2 = await api(baseUrl, 'GET', '/v1/alerts', operatorToken, null, signal);
    if (alerts2.status !== 200) fail('duplicate-check', `Failed to fetch alerts: HTTP ${alerts2.status}`);
    const lateAlerts2 = alerts2.data.alerts?.filter((a) => a.job_key === jobKey && a.run_id === runId && a.type === 'late') ?? [];
    if (lateAlerts2.length !== 1) fail('duplicate-check', `Expected still 1 late alert after reconciliation, found ${lateAlerts2.length}`, { expected: '1 late alert (no duplicates)' });
    console.log(`   ✓ Still exactly 1 late alert — no duplicates\n`);

    // ── Phase 8: Complete the run ──
    console.log(`[${elapsed(startMs)}] Phase 8: Send succeeded event`);
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;

    const seq = sequence++;
    const succeedResult = await api(baseUrl, 'POST', '/v1/events', jobToken, {
      event_id: `${runId}-succeeded`, job_key: jobKey, run_id: runId, sequence: seq,
      type: 'succeeded', occurred_at: new Date().toISOString(), data: { stage: 'e2e-complete' },
    }, signal);
    if (succeedResult.status !== 202) fail('complete', `Failed to send succeeded event: HTTP ${succeedResult.status}`);

    await sleep(2000);
    const finalRuns = await api(baseUrl, 'GET', '/v1/runs', operatorToken, null, signal);
    const finalRun = finalRuns.data.runs?.find((r) => r.job_key === jobKey && r.run_id === runId);
    lastRunState = finalRun;
    if (!finalRun || finalRun.status !== 'succeeded') {
      fail('complete', `Run should be 'succeeded' but is '${finalRun?.status ?? 'not found'}'`, { expected: "status='succeeded'" });
    }
    console.log(`   ✓ Run completed successfully after being flagged late\n`);

    console.log(`✅ All checks passed [${elapsed(startMs)}]`);
    console.log(`   Total heartbeats sent: ${heartbeatCount}`);
    console.log(`   Job key: ${jobKey}\n`);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

async function main() {
  const startMs = Date.now();
  const baseUrl = process.env.PINGSTEP_STAGING_BASE_URL?.replace(/\/+$/, '');
  const operatorToken = process.env.PINGSTEP_STAGING_OPERATOR_TOKEN;
  const controlToken = process.env.PINGSTEP_STAGING_E2E_CONTROL_TOKEN;
  const source = process.env.E2E_SOURCE || 'local_manual';

  if (!baseUrl) throw new E2EPhaseError('init', 'PINGSTEP_STAGING_BASE_URL is required');
  if (!operatorToken) throw new E2EPhaseError('init', 'PINGSTEP_STAGING_OPERATOR_TOKEN is required');
  if (!controlToken) throw new E2EPhaseError('init', 'PINGSTEP_STAGING_E2E_CONTROL_TOKEN is required');

  const abortController = new AbortController();
  const harness = new StagingE2EHarness({ baseUrl, controlToken, signal: abortController.signal });

  await harness.registerRun({
    suite: 'late-run',
    source,
    githubRunId: process.env.GITHUB_RUN_ID,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    commitSha: process.env.GITHUB_SHA
  });
  if (process.env.E2E_RUN_ID_OUT_FILE) {
    try { writeFileSync(process.env.E2E_RUN_ID_OUT_FILE, harness.runId, 'utf8'); } catch { /* best effort */ }
  }

  let testError = null;
  let timedOut = false;
  const overallTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, OVERALL_TIMEOUT_MS);

  try {
    await runTest({ baseUrl, operatorToken, harness, startMs, abortController });
  } catch (error) {
    testError = error;
  } finally {
    clearTimeout(overallTimer);
  }

  if (timedOut && !testError) {
    testError = new E2EPhaseError('timeout', `Test exceeded ${OVERALL_TIMEOUT_MS / 1000}s overall timeout`, { startMs });
  }

  // Finalization uses independent bounded signals — never the overall test
  // signal, which may already be aborted.  Cleanup runs from a finally path
  // so it executes even if completeRun() throws.
  const finalizationSignal = AbortSignal.timeout(CLEANUP_TIMEOUT_MS);
  let cleanupResult = { attempted: false, cleanup_status: 'not_started' };
  let finalizationError = null;
  try {
    await harness.completeRun(testError ? 'failed' : 'passed', testError
      ? { failurePhase: testError.phase ?? 'unknown', failureCode: 'test_failure', signal: finalizationSignal }
      : { signal: finalizationSignal });
  } catch (completeError) {
    finalizationError = completeError;
    console.error(`   ⚠ completeRun failed: ${completeError instanceof Error ? completeError.message : String(completeError)}`);
  } finally {
    console.log(`[${elapsed(startMs)}] Requesting cleanup for E2E run ${harness.runId}...`);
    cleanupResult = await harness.cleanup(CLEANUP_TIMEOUT_MS);
    console.log(`   Cleanup status: ${cleanupResult.cleanup_status}`);
    if (Array.isArray(cleanupResult.resources)) {
      for (const resource of cleanupResult.resources) {
        console.log(`   Resource ${resource.resource_type}:${resource.resource_ref} -> ${resource.lifecycle}`);
      }
    }
  }

  const cleanupFailed = cleanupResult.cleanup_status === 'requires_operator' || cleanupResult.cleanup_status === 'error';

  if (testError) {
    console.error(`\n❌ FAILED at phase: ${testError.phase}`);
    console.error(`   Message: ${testError.message}`);
    console.error(`   Elapsed: ${elapsed(startMs)}`);
    const context = testError.context ?? {};
    if (context.lastRunState) {
      const r = context.lastRunState;
      console.error(`   Last run state: status=${r.status}, is_late=${r.is_late}, late_at=${r.late_at ?? 'null'}`);
    }
    if (context.expected) console.error(`   Expected: ${context.expected}`);
    if (context.jobKey) console.error(`   Job key: ${context.jobKey}`);
    if (context.runId) console.error(`   Run ID: ${context.runId}`);
  }
  if (finalizationError && !testError) {
    console.error(`\n❌ FAILED at phase: finalization`);
    console.error(`   completeRun() failed: ${finalizationError instanceof Error ? finalizationError.message : String(finalizationError)}`);
    console.error(`   The product test passed but the registry was not updated — this is a nonzero exit.`);
  }
  if (cleanupFailed) {
    console.error(`\n⚠️  Cleanup did not complete cleanly: ${cleanupResult.cleanup_status}${cleanupResult.error ? ` (${cleanupResult.error})` : ''}`);
    console.error(`   E2E run id: ${harness.runId} — rerun 'npm run e2e:staging:cleanup -- --run-id ${harness.runId}' or check the janitor.`);
  }

  // testError: product test failure.  finalizationError: completeRun() failed
  // (registry not updated — must be nonzero even if test passed).
  // cleanupFailed: resource cleanup did not complete.
  process.exitCode = testError || finalizationError || cleanupFailed ? 1 : 0;
}

main().catch((error) => {
  console.error(`\n💥 Unexpected error: ${error.message}`);
  console.error(error.stack);
  process.exitCode = 1;
});
