#!/usr/bin/env node

/**
 * verify-late-run-staging.mjs
 *
 * Automated staging end-to-end test for late-run detection.
 * Verifies the full lifecycle: start → heartbeat → late detection → alert → completion.
 *
 * Required environment variables:
 *   PINGSTEP_STAGING_BASE_URL   — staging Worker URL (must not be production)
 *   PINGSTEP_STAGING_OPERATOR_TOKEN — operator bearer token for staging
 *
 * Optional:
 *   E2E_RUN_SUFFIX — unique suffix for test isolation (defaults to timestamp)
 *
 * Usage:
 *   node scripts/verify-late-run-staging.mjs
 *
 * Timings (configurable below):
 *   expected_duration_seconds: 60    — run is expected to finish in 60s
 *   late_grace_seconds: 30           — 30s grace after expected duration
 *   expected_update_interval_seconds: 30
 *   liveness_grace_seconds: 120      — generous to avoid accidental stale
 *   heartbeat interval: 20s          — well within liveness window
 *   late_deadline = started + 60 + 30 = 90s from start
 *   overall timeout: 5 minutes
 */

const PRODUCTION_PATTERNS = [
  /pingstep\.dev$/i,
  /pingstep\.com$/i,
  /\/\/pingstep\./i,
];

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
const DUPLICATE_WAIT_MS = 75_000; // > 1 reconciliation cycle (60s) + buffer

// ── Helpers ──────────────────────────────────────────────────────────────

function redact(token) {
  if (!token || token.length < 12) return '***';
  return token.slice(0, 8) + '…' + token.slice(-4);
}

function elapsed(startMs) {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

function fail(phase, message, context = {}) {
  console.error(`\n❌ FAILED at phase: ${phase}`);
  console.error(`   Message: ${message}`);
  console.error(`   Elapsed: ${elapsed(context.startMs ?? Date.now())}`);
  if (context.lastRunState) {
    const r = context.lastRunState;
    console.error(`   Last run state: status=${r.status}, is_late=${r.is_late}, late_at=${r.late_at ?? 'null'}`);
  }
  if (context.expected) console.error(`   Expected: ${context.expected}`);
  if (context.jobKey) console.error(`   Job key: ${context.jobKey}`);
  if (context.runId) console.error(`   Run ID: ${context.runId}`);
  if (context.cleanupStatus) console.error(`   Cleanup: ${context.cleanupStatus}`);
  process.exit(1);
}

async function api(baseUrl, method, path, token, body = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' };
  const options = { method, headers, signal: AbortSignal.timeout(15_000) };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const baseUrl = process.env.PINGSTEP_STAGING_BASE_URL?.replace(/\/+$/, '');
  const operatorToken = process.env.PINGSTEP_STAGING_OPERATOR_TOKEN;
  const suffix = process.env.E2E_RUN_SUFFIX || `${Date.now()}`;

  // ── Validate inputs ──
  if (!baseUrl) fail('init', 'PINGSTEP_STAGING_BASE_URL is required', { startMs });
  if (!operatorToken) fail('init', 'PINGSTEP_STAGING_OPERATOR_TOKEN is required', { startMs });

  const parsedUrl = new URL(baseUrl);
  for (const pattern of PRODUCTION_PATTERNS) {
    if (pattern.test(parsedUrl.hostname) || pattern.test(baseUrl)) {
      fail('init', `Refusing to run against production URL: ${parsedUrl.hostname}`, { startMs });
    }
  }

  const jobKey = `e2e-late-${suffix}`;
  const runId = `run-${suffix}`;

  console.log(`\n🔬 Late-run e2e test`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Operator token: ${redact(operatorToken)}`);
  console.log(`   Job key: ${jobKey}`);
  console.log(`   Run ID: ${runId}`);
  console.log(`   Late deadline: ${LATE_DEADLINE_SECONDS}s after start`);
  console.log(`   Overall timeout: ${OVERALL_TIMEOUT_MS / 1000}s\n`);

  let jobToken = null;
  let heartbeatTimer = null;
  let sequence = 1;
  let lastRunState = null;

  const ctx = () => ({ startMs, jobKey, runId, lastRunState, cleanupStatus: 'not attempted' });

  const overallTimer = setTimeout(() => {
    fail('timeout', `Test exceeded ${OVERALL_TIMEOUT_MS / 1000}s overall timeout`, ctx());
  }, OVERALL_TIMEOUT_MS);

  try {
    // ── Phase 1: Health check ──
    console.log(`[${elapsed(startMs)}] Phase 1: Health check`);
    const health = await api(baseUrl, 'GET', '/health', operatorToken);
    if (health.status !== 200 || health.data.status !== 'ok') {
      fail('health', `Staging health check failed: HTTP ${health.status}`, { ...ctx(), expected: 'HTTP 200, status=ok' });
    }
    console.log(`   ✓ Staging is healthy (env=${health.data.environment})\n`);

    // ── Phase 2: Provision test job ──
    console.log(`[${elapsed(startMs)}] Phase 2: Provision test job`);
    const provision = await api(baseUrl, 'POST', '/v1/operator/jobs', operatorToken, {
      job_key: jobKey,
      ...JOB_CONFIG,
    });
    if (provision.status !== 201) {
      fail('provision', `Failed to create test job: HTTP ${provision.status} — ${JSON.stringify(provision.data)}`, ctx());
    }
    jobToken = provision.data.token;
    console.log(`   ✓ Job created: ${jobKey}`);
    console.log(`   Token: ${redact(jobToken)}\n`);

    // ── Phase 3: Send started event ──
    console.log(`[${elapsed(startMs)}] Phase 3: Send started event`);
    const startedAt = new Date().toISOString();
    const startResult = await api(baseUrl, 'POST', '/v1/events', jobToken, {
      event_id: `${runId}-started`,
      job_key: jobKey,
      run_id: runId,
      sequence: sequence++,
      type: 'started',
      occurred_at: startedAt,
      data: { job_version: 'e2e-test' },
    });
    if (startResult.status !== 202) {
      fail('start', `Failed to send started event: HTTP ${startResult.status}`, ctx());
    }
    const runStartMs = Date.now();
    console.log(`   ✓ Run started at ${startedAt}\n`);

    // ── Phase 4: Send heartbeats ──
    console.log(`[${elapsed(startMs)}] Phase 4: Sending heartbeats every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
    let heartbeatCount = 0;
    heartbeatTimer = setInterval(async () => {
      try {
        const seq = sequence++;
        await api(baseUrl, 'POST', '/v1/events', jobToken, {
          event_id: `${runId}-hb-${seq}`,
          job_key: jobKey,
          run_id: runId,
          sequence: seq,
          type: 'heartbeat',
          occurred_at: new Date().toISOString(),
          data: {},
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

    // Wait until at least late deadline has passed
    const timeSinceStart = Date.now() - runStartMs;
    const remainingWait = Math.max(0, LATE_DEADLINE_SECONDS * 1000 - timeSinceStart);
    if (remainingWait > 0) {
      console.log(`   Waiting ${Math.ceil(remainingWait / 1000)}s for late deadline...`);
      await sleep(remainingWait);
    }

    // Poll for late status
    console.log(`   Late deadline passed. Polling for is_late=1...`);
    const pollDeadline = runStartMs + waitUntilLateMs;
    let isLate = false;
    while (Date.now() < pollDeadline) {
      const runsResult = await api(baseUrl, 'GET', '/v1/runs', operatorToken);
      if (runsResult.status === 200) {
        const run = runsResult.data.runs?.find(r => r.job_key === jobKey && r.run_id === runId);
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
    if (!isLate) {
      fail('late-detection', 'Run was never flagged late within the expected window', {
        ...ctx(), expected: 'is_late=1'
      });
    }

    // Verify run is still running (not stale)
    if (lastRunState.status !== 'running') {
      fail('late-detection', `Run should still be 'running' but is '${lastRunState.status}'`, {
        ...ctx(), expected: "status='running'"
      });
    }
    console.log(`   ✓ Run status is 'running' (not stale)\n`);

    // ── Phase 6: Verify exactly one late alert ──
    console.log(`[${elapsed(startMs)}] Phase 6: Verify exactly one late alert`);
    const alerts1 = await api(baseUrl, 'GET', '/v1/alerts', operatorToken);
    if (alerts1.status !== 200) {
      fail('alert-check', `Failed to fetch alerts: HTTP ${alerts1.status}`, ctx());
    }
    const lateAlerts1 = alerts1.data.alerts?.filter(a => a.job_key === jobKey && a.run_id === runId && a.type === 'late') ?? [];
    if (lateAlerts1.length !== 1) {
      fail('alert-check', `Expected exactly 1 late alert, found ${lateAlerts1.length}`, {
        ...ctx(), expected: '1 late alert'
      });
    }
    console.log(`   ✓ Found exactly 1 late alert`);
    console.log(`   Alert ID: ${lateAlerts1[0].id}`);
    console.log(`   Alert status field: ${lateAlerts1[0].status}`);
    if (lateAlerts1[0].status !== 'running') {
      fail('alert-check', `Late alert status should be 'running', got '${lateAlerts1[0].status}'`, {
        ...ctx(), expected: "alert.status='running'"
      });
    }
    console.log(`   ✓ Alert status is 'running' (correct — run is flagged, not stopped)\n`);

    // ── Phase 7: Wait for another reconciliation cycle, verify no duplicates ──
    console.log(`[${elapsed(startMs)}] Phase 7: Waiting ${DUPLICATE_WAIT_MS / 1000}s for duplicate check`);
    await sleep(DUPLICATE_WAIT_MS);

    const alerts2 = await api(baseUrl, 'GET', '/v1/alerts', operatorToken);
    if (alerts2.status !== 200) {
      fail('duplicate-check', `Failed to fetch alerts: HTTP ${alerts2.status}`, ctx());
    }
    const lateAlerts2 = alerts2.data.alerts?.filter(a => a.job_key === jobKey && a.run_id === runId && a.type === 'late') ?? [];
    if (lateAlerts2.length !== 1) {
      fail('duplicate-check', `Expected still 1 late alert after reconciliation, found ${lateAlerts2.length}`, {
        ...ctx(), expected: '1 late alert (no duplicates)'
      });
    }
    console.log(`   ✓ Still exactly 1 late alert — no duplicates\n`);

    // ── Phase 8: Complete the run ──
    console.log(`[${elapsed(startMs)}] Phase 8: Send succeeded event`);
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;

    const seq = sequence++;
    const succeedResult = await api(baseUrl, 'POST', '/v1/events', jobToken, {
      event_id: `${runId}-succeeded`,
      job_key: jobKey,
      run_id: runId,
      sequence: seq,
      type: 'succeeded',
      occurred_at: new Date().toISOString(),
      data: { stage: 'e2e-complete' },
    });
    if (succeedResult.status !== 202) {
      fail('complete', `Failed to send succeeded event: HTTP ${succeedResult.status}`, ctx());
    }

    // Verify final state
    await sleep(2000);
    const finalRuns = await api(baseUrl, 'GET', '/v1/runs', operatorToken);
    const finalRun = finalRuns.data.runs?.find(r => r.job_key === jobKey && r.run_id === runId);
    lastRunState = finalRun;
    if (!finalRun || finalRun.status !== 'succeeded') {
      fail('complete', `Run should be 'succeeded' but is '${finalRun?.status ?? 'not found'}'`, {
        ...ctx(), expected: "status='succeeded'"
      });
    }
    console.log(`   ✓ Run completed successfully after being flagged late\n`);

    // ── Done ──
    console.log(`✅ All checks passed [${elapsed(startMs)}]`);
    console.log(`   Total heartbeats sent: ${heartbeatCount}`);
    console.log(`   Job key: ${jobKey}`);
    console.log(`   Cleanup: test job remains in staging DB (operator-created, no owner)\n`);

  } finally {
    clearTimeout(overallTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

main().catch(err => {
  console.error(`\n💥 Unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
