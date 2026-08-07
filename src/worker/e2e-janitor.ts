import { isE2EControlEnabled, performCleanup } from './e2e-control.ts';
import { type E2ERegistryRepository } from './e2e-registry.ts';

const JANITOR_BATCH_SIZE = 5;
const CLEANUP_LEASE_DURATION_SECONDS = 120;
const REGISTRY_RETENTION_DAYS = 30;
const REGISTRY_PURGE_BATCH = 50;

export type JanitorSummary = {
  ran: boolean;
  dry_run: boolean;
  expired_runs_seen: number;
  runs_cleaned: number;
  runs_requiring_operator: number;
  runs_deferred: number;
  registry_rows_purged: number;
};

/**
 * Bounded orphan janitor for expired staging E2E runs (issue #174 design
 * principle 6: an if:always() workflow step is the second line of defense,
 * this janitor is the third — for cases where the workflow was hard-cancelled).
 * Never enabled in production: gated by the same isE2EControlEnabled() check
 * as every other E2E control operation, so it never scans or deletes
 * unregistered product rows and never runs when the flag is off.
 */
export async function runE2EJanitor(repository: E2ERegistryRepository, env: Env, now: Date, dryRun = false): Promise<JanitorSummary> {
  if (!isE2EControlEnabled(env)) {
    return { ran: false, dry_run: dryRun, expired_runs_seen: 0, runs_cleaned: 0, runs_requiring_operator: 0, runs_deferred: 0, registry_rows_purged: 0 };
  }

  const nowIso = now.toISOString();
  const leaseExpiryIso = new Date(now.getTime() - CLEANUP_LEASE_DURATION_SECONDS * 1000).toISOString();
  const expiredRuns = await repository.listExpiredRuns(nowIso, JANITOR_BATCH_SIZE, leaseExpiryIso);

  let cleaned = 0;
  let requiresOperator = 0;
  let deferred = 0;
  if (!dryRun) {
    for (const run of expiredRuns) {
      const result = await performCleanup(repository, run.id, now);
      if (result.cleanup_status === 'completed' || result.cleanup_status === 'completed_with_absent_resources' || result.cleanup_status === 'operator_acknowledged') {
        cleaned += 1;
      } else if (result.cleanup_status === 'requires_operator') {
        requiresOperator += 1;
      } else {
        deferred += 1; // pending (retryable, will be picked up next pass), in_progress (concurrent), or other nonterminal
      }
    }
  }

  let purged = 0;
  if (!dryRun) {
    const retentionCutoff = new Date(now.getTime() - REGISTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    purged = await repository.purgeOldRegistryRows(retentionCutoff, REGISTRY_PURGE_BATCH);
  }

  return {
    ran: true,
    dry_run: dryRun,
    expired_runs_seen: expiredRuns.length,
    runs_cleaned: cleaned,
    runs_requiring_operator: requiresOperator,
    runs_deferred: deferred,
    registry_rows_purged: purged
  };
}
