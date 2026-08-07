#!/usr/bin/env node

/**
 * e2e-legacy-inventory.mjs
 *
 * Safe, read-only inventory of historical `e2e-late-*` staging jobs that
 * were created before the E2E registry existed (issue #174) and therefore
 * have no registered E2E run to clean them up automatically. Prints job
 * keys, creation timestamps, and row counts only — never event contents,
 * tokens, stage names, or customer data. Does NOT delete anything.
 *
 * Required environment variables:
 *   PINGSTEP_STAGING_BASE_URL
 *   PINGSTEP_STAGING_E2E_CONTROL_TOKEN
 *
 * Usage:
 *   node scripts/e2e-legacy-inventory.mjs
 */

async function main() {
  const baseUrl = process.env.PINGSTEP_STAGING_BASE_URL;
  const controlToken = process.env.PINGSTEP_STAGING_E2E_CONTROL_TOKEN;
  if (!baseUrl) throw new Error('PINGSTEP_STAGING_BASE_URL is required');
  if (!controlToken) throw new Error('PINGSTEP_STAGING_E2E_CONTROL_TOKEN is required');

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/internal/e2e/legacy-inventory`, {
    headers: { authorization: `Bearer ${controlToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Legacy inventory call failed: HTTP ${response.status} ${JSON.stringify(data)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Legacy e2e-late-* jobs with no registry entry: ${data.jobs?.length ?? 0}`);
  for (const job of data.jobs ?? []) {
    console.log(`  ${job.job_key}  created=${job.created_at}  runs=${job.run_count}  events=${job.event_count}  alerts=${job.alert_count}`);
  }
  console.log('\nThis is a dry-run inventory only. No automated deletion is performed.');
  console.log('These jobs have no owner and predate the E2E registry, so the ordinary');
  console.log('customer job-deletion route cannot remove them. See the "Legacy inventory /');
  console.log('manual cleanup" section of docs/staging-e2e-resource-lifecycle.md for the');
  console.log('confirmed, one-time operator procedure — it is intentionally not automated.');
}

main().catch((error) => {
  console.error(`Legacy inventory failed: ${error.message}`);
  process.exitCode = 1;
});
