#!/usr/bin/env node

/**
 * e2e-staging-cleanup.mjs
 *
 * Targeted cleanup for one staging E2E test run, addressable by its
 * cryptographically random run id. Used by CI's `if: always()` cleanup
 * step (second line of defense) and can be run manually to recover a run
 * that a killed/cancelled process didn't clean up itself.
 *
 * Modes:
 *   (default)       Request automatic cleanup and poll to terminal.
 *   --acknowledge   Mark a requires_operator run as operator-resolved.
 *                   Requires --confirm.
 *   --reset         Move a requires_operator run back to pending for retry.
 *
 * Required environment variables:
 *   PINGSTEP_STAGING_BASE_URL
 *   PINGSTEP_STAGING_E2E_CONTROL_TOKEN
 *
 * Usage:
 *   npm run e2e:staging:cleanup -- --run-id <uuid>
 *   npm run e2e:staging:cleanup -- --run-id <uuid> --acknowledge --confirm
 *   npm run e2e:staging:cleanup -- --run-id <uuid> --reset
 */

import { assertStagingUrl } from './lib/staging-e2e.mjs';

function parseArgs(argv) {
  const args = { acknowledge: false, reset: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--run-id') args.runId = argv[i + 1];
    if (argv[i] === '--acknowledge') args.acknowledge = true;
    if (argv[i] === '--reset') args.reset = true;
    if (argv[i] === '--confirm') args.confirm = true;
    if (argv[i] === '--timeout-ms') args.timeoutMs = Number(argv[i + 1]);
    if (argv[i] === '--poll-interval-ms') args.pollIntervalMs = Number(argv[i + 1]);
  }
  return args;
}

async function callControl(baseUrl, controlToken, method, path, body) {
  const headers = { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' };
  const options = { method, headers, signal: AbortSignal.timeout(15_000) };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runId) {
    console.error('Usage: npm run e2e:staging:cleanup -- --run-id <uuid> [--acknowledge --confirm | --reset]');
    process.exitCode = 1;
    return;
  }
  if (args.acknowledge && args.reset) {
    console.error('Cannot use --acknowledge and --reset together.');
    process.exitCode = 1;
    return;
  }

  const baseUrl = assertStagingUrl(process.env.PINGSTEP_STAGING_BASE_URL);
  const controlToken = process.env.PINGSTEP_STAGING_E2E_CONTROL_TOKEN;
  if (!controlToken) throw new Error('PINGSTEP_STAGING_E2E_CONTROL_TOKEN is required');

  if (args.acknowledge) {
    if (!args.confirm) {
      console.error('--acknowledge requires --confirm to prevent accidental acknowledgement.');
      process.exitCode = 1;
      return;
    }
    console.log(`Acknowledging E2E run ${args.runId} as operator-resolved...`);
    const result = await callControl(baseUrl, controlToken, 'POST', `/v1/internal/e2e/runs/${args.runId}/acknowledge`, { confirm: true });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.reset) {
    console.log(`Resetting E2E run ${args.runId} back to pending for retry...`);
    const result = await callControl(baseUrl, controlToken, 'POST', `/v1/internal/e2e/runs/${args.runId}/reset`, {});
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Default mode: request cleanup and poll.
  const { StagingE2EHarness } = await import('./lib/staging-e2e.mjs');
  const harness = new StagingE2EHarness({ baseUrl, controlToken });
  harness.runId = args.runId;

  console.log(`Requesting cleanup for E2E run ${args.runId}...`);
  const options = Number.isFinite(args.pollIntervalMs) && args.pollIntervalMs > 0 ? { pollIntervalMs: args.pollIntervalMs } : {};
  const result = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
    ? await harness.cleanup(args.timeoutMs, options)
    : await harness.cleanup(undefined, options);
  console.log(JSON.stringify(result, null, 2));

  // Only a genuinely successful terminal cleanup state ('completed' or
  // 'completed_with_absent_resources') exits 0. A nonterminal status at the
  // poll timeout ('pending', 'in_progress', 'unknown'), 'requires_operator',
  // 'operator_acknowledged', and 'error' all mean synthetic resources may
  // remain in staging — report failure, never success.
  if (result.successful !== true) {
    console.error(`Cleanup did not reach a successful terminal state (status: ${result.cleanup_status}).`);
  }
  process.exitCode = result.successful === true ? 0 : 1;
}

main().catch((error) => {
  console.error(`Cleanup failed: ${error.message}`);
  process.exitCode = 1;
});
