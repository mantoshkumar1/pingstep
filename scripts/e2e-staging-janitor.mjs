#!/usr/bin/env node

/**
 * e2e-staging-janitor.mjs
 *
 * CLI wrapper for the bounded staging orphan janitor
 * (POST /v1/internal/e2e/janitor/run, see src/worker/e2e-janitor.ts). Third
 * line of defense: cleans up expired E2E test runs that survived a killed
 * or hard-cancelled process. Staging-only; the route returns 404 anywhere
 * else, and there is no flag to override that.
 *
 * Defaults to a dry run. Destructive execution requires BOTH --execute and
 * --confirm so it can never be triggered by accident.
 *
 * Required environment variables:
 *   PINGSTEP_STAGING_BASE_URL
 *   PINGSTEP_STAGING_E2E_CONTROL_TOKEN
 *
 * Usage:
 *   npm run e2e:staging:janitor -- --dry-run
 *   npm run e2e:staging:janitor -- --execute --confirm
 */

function parseArgs(argv) {
  return { execute: argv.includes('--execute'), confirm: argv.includes('--confirm'), dryRun: argv.includes('--dry-run') || !argv.includes('--execute') };
}

async function main() {
  const { execute, confirm, dryRun } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.PINGSTEP_STAGING_BASE_URL;
  const controlToken = process.env.PINGSTEP_STAGING_E2E_CONTROL_TOKEN;
  if (!baseUrl) throw new Error('PINGSTEP_STAGING_BASE_URL is required');
  if (!controlToken) throw new Error('PINGSTEP_STAGING_E2E_CONTROL_TOKEN is required');
  if (execute && !confirm) {
    console.error('Refusing to run destructively without --confirm. Pass --execute --confirm together, or run with --dry-run.');
    process.exitCode = 1;
    return;
  }

  const wantsDryRun = dryRun || !execute;
  console.log(`Running staging E2E janitor (${wantsDryRun ? 'dry run' : 'destructive execution'})...`);

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/internal/e2e/janitor/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dry_run: wantsDryRun, confirm: !wantsDryRun }),
    signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Janitor call failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(data, null, 2));
  process.exitCode = data.runs_requiring_operator > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(`Janitor run failed: ${error.message}`);
  process.exitCode = 1;
});
