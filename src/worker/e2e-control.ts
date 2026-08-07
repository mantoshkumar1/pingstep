import { HttpError } from './service.ts';
import {
  E2E_RESOURCE_TYPES,
  type E2ECleanupStatus,
  type E2ERegistryRepository,
  type E2EResourceLifecycle,
  type E2EResourceType,
  type E2ERunSource,
  type E2ERunStatus,
  type E2ETestRun
} from './e2e-registry.ts';

const SOURCES: ReadonlySet<E2ERunSource> = new Set(['github_push', 'workflow_dispatch', 'local_manual']);
const RUN_STATUSES: ReadonlySet<E2ERunStatus> = new Set(['passed', 'failed', 'cancelled']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TOKEN_PATTERN = /^[a-zA-Z0-9._:-]{1,100}$/;
const JOB_REF_PATTERN = /^e2e-[a-z0-9._-]{1,90}$/i;

const AUTOMATIC_EXPIRY_SECONDS = 2 * 60 * 60; // github_push
const MANUAL_EXPIRY_SECONDS = 4 * 60 * 60; // workflow_dispatch / local_manual
const MIN_EXPIRY_SECONDS = 5 * 60;
const MAX_EXPIRY_SECONDS = 6 * 60 * 60;
const MAX_CLEANUP_ATTEMPTS = 3;
const CLEANUP_LEASE_DURATION_SECONDS = 120;
const JANITOR_DEFAULT_BATCH = 5;

function setting(env: Env, name: string): string | null {
  const value = Reflect.get(env, name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Production fails closed: absent/false E2E_CONTROL_ENABLED means the facility does not exist. */
export function isE2EControlEnabled(env: Env): boolean {
  return env.ENVIRONMENT === 'staging' && setting(env, 'E2E_CONTROL_ENABLED') === 'true' && setting(env, 'E2E_CONTROL_TOKEN') !== null;
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

/**
 * Every E2E control operation requires ALL of: staging environment, the
 * feature flag, a separate control token (never OPERATOR_TOKEN), a
 * timing-safe comparison, and — when PUBLIC_ORIGIN is configured — that the
 * request targets the staging origin. Callers must check isE2EControlEnabled
 * first and return a plain 404 when it is false, so production never
 * reveals this facility exists.
 */
export async function requireE2EControl(request: Request, env: Env): Promise<void> {
  if (!isE2EControlEnabled(env)) throw new HttpError(404, 'Not found.');
  const configuredToken = setting(env, 'E2E_CONTROL_TOKEN');
  const suppliedToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!configuredToken || !suppliedToken || !(await timingSafeEqual(suppliedToken, configuredToken))) {
    throw new HttpError(401, 'E2E control authentication is required.');
  }
  const publicOrigin = setting(env, 'PUBLIC_ORIGIN');
  if (publicOrigin) {
    const expectedHost = new URL(publicOrigin).hostname;
    if (new URL(request.url).hostname !== expectedHost) throw new HttpError(403, 'E2E control requests must target the staging origin.');
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (request.method === 'POST' && !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(400, 'E2E control requests must use application/json.');
  }
}

function safeString(value: unknown, field: string, maxLength: number, required: boolean, pattern = SAFE_TOKEN_PATTERN): string | null {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    throw new HttpError(400, `${field} is invalid.`);
  }
  return value;
}

function plusSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

export type RegisterRunInput = {
  id?: unknown;
  suite?: unknown;
  source?: unknown;
  github_run_id?: unknown;
  github_run_attempt?: unknown;
  commit_sha?: unknown;
  expiry_seconds?: unknown;
};

export async function registerRun(repository: E2ERegistryRepository, rawInput: unknown, now: Date): Promise<{ run: E2ETestRun }> {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new HttpError(400, 'Request body must be a JSON object.');
  const input = rawInput as RegisterRunInput;
  const suite = safeString(input.suite, 'suite', 40, true, /^[a-z0-9][a-z0-9-]{0,39}$/) as string;
  const sourceValue = safeString(input.source, 'source', 20, true, /^[a-z_]{1,20}$/) as string;
  if (!SOURCES.has(sourceValue as E2ERunSource)) throw new HttpError(400, 'source must be github_push, workflow_dispatch, or local_manual.');
  const source = sourceValue as E2ERunSource;
  const githubRunId = safeString(input.github_run_id, 'github_run_id', 40, false, /^[0-9]{1,40}$/);
  const githubRunAttempt = safeString(input.github_run_attempt, 'github_run_attempt', 10, false, /^[0-9]{1,10}$/);
  const commitSha = safeString(input.commit_sha, 'commit_sha', 40, false, /^[0-9a-f]{7,40}$/i);

  let id: string;
  if (input.id !== undefined) {
    if (typeof input.id !== 'string' || !UUID_PATTERN.test(input.id)) throw new HttpError(400, 'id must be a UUID.');
    id = input.id.toLowerCase();
  } else {
    id = crypto.randomUUID();
  }

  const existing = await repository.getRun(id);
  if (existing) {
    if (existing.suite !== suite || existing.source !== source) throw new HttpError(409, 'This run id is already registered for a different suite or source.');
    return { run: existing }; // idempotent replay
  }

  let expirySeconds = source === 'github_push' ? AUTOMATIC_EXPIRY_SECONDS : MANUAL_EXPIRY_SECONDS;
  if (input.expiry_seconds !== undefined) {
    if (typeof input.expiry_seconds !== 'number' || !Number.isInteger(input.expiry_seconds)) throw new HttpError(400, 'expiry_seconds must be an integer.');
    if (input.expiry_seconds < MIN_EXPIRY_SECONDS || input.expiry_seconds > MAX_EXPIRY_SECONDS) throw new HttpError(400, `expiry_seconds must be between ${MIN_EXPIRY_SECONDS} and ${MAX_EXPIRY_SECONDS}.`);
    expirySeconds = input.expiry_seconds;
  }

  const createdAt = now.toISOString();
  await repository.insertRun({
    id, suite, source,
    github_run_id: githubRunId, github_run_attempt: githubRunAttempt, commit_sha: commitSha,
    created_at: createdAt, expires_at: plusSeconds(now, expirySeconds)
  });
  await repository.markRunRunning(id);
  const run = await repository.getRun(id);
  if (!run) throw new HttpError(500, 'Run registration failed unexpectedly.');
  return { run };
}

function validateResourceRef(type: E2EResourceType, ref: unknown): string {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 100) throw new HttpError(400, 'resource_ref is invalid.');
  if (type === 'job' && !JOB_REF_PATTERN.test(ref)) throw new HttpError(400, "job resource_ref must match 'e2e-<name>'.");
  return ref;
}

export type RegisterResourceInput = {
  resource_type?: unknown;
  resource_ref?: unknown;
  subtype?: unknown;
  lifecycle?: unknown;
};

async function requireRun(repository: E2ERegistryRepository, runId: string): Promise<E2ETestRun> {
  if (!UUID_PATTERN.test(runId)) throw new HttpError(400, 'run id must be a UUID.');
  const run = await repository.getRun(runId);
  if (!run) throw new HttpError(404, 'E2E test run not found.');
  return run;
}

export async function registerResource(repository: E2ERegistryRepository, runId: string, rawInput: unknown, now: Date) {
  const run = await requireRun(repository, runId);
  if (run.status !== 'registered' && run.status !== 'running') throw new HttpError(409, 'This run is already complete; resources can no longer be registered.');
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new HttpError(400, 'Request body must be a JSON object.');
  const input = rawInput as RegisterResourceInput;
  if (typeof input.resource_type !== 'string' || !E2E_RESOURCE_TYPES.has(input.resource_type as E2EResourceType)) {
    throw new HttpError(400, `resource_type must be one of: ${[...E2E_RESOURCE_TYPES].join(', ')}.`);
  }
  const resourceType = input.resource_type as E2EResourceType;
  const resourceRef = validateResourceRef(resourceType, input.resource_ref);
  const subtype = safeString(input.subtype, 'subtype', 40, false);
  const requestedLifecycle: E2EResourceLifecycle = input.lifecycle === 'created' ? 'created' : 'planned';

  if (requestedLifecycle === 'created') {
    await verifyResourceOwnership(repository, run, resourceType, resourceRef);
  }

  const existing = await repository.getResource(runId, resourceType, resourceRef);
  if (!existing) {
    const outcome = await repository.registerResource({ run_id: runId, resource_type: resourceType, resource_ref: resourceRef, subtype, lifecycle: requestedLifecycle, now: now.toISOString() });
    if (outcome === 'inserted' && requestedLifecycle === 'created') await repository.incrementCreatedResourceCount(runId);
    return { resource: await repository.getResource(runId, resourceType, resourceRef) };
  }
  // idempotent replay / planned -> created transition
  if (existing.lifecycle === 'planned' && requestedLifecycle === 'created') {
    await repository.markResourceLifecycle(runId, resourceType, resourceRef, 'created', now.toISOString());
    await repository.incrementCreatedResourceCount(runId);
  }
  return { resource: await repository.getResource(runId, resourceType, resourceRef) };
}

async function verifyResourceOwnership(repository: E2ERegistryRepository, run: E2ETestRun, type: E2EResourceType, ref: string): Promise<void> {
  if (type === 'job') {
    const candidate = await repository.findCandidateJob(ref);
    if (!candidate) throw new HttpError(409, 'No matching job exists to claim as created.');
    if (candidate.owner_user_id !== null) throw new HttpError(409, 'This job has a non-E2E owner and cannot be claimed.');
    if (candidate.created_at < run.created_at) throw new HttpError(409, 'This job predates the run and cannot be retroactively claimed.');
  }
}

export type CompleteRunInput = { status?: unknown; failure_phase?: unknown; failure_code?: unknown };

export async function completeRun(repository: E2ERegistryRepository, runId: string, rawInput: unknown, now: Date) {
  const run = await requireRun(repository, runId);
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new HttpError(400, 'Request body must be a JSON object.');
  const input = rawInput as CompleteRunInput;
  if (typeof input.status !== 'string' || !RUN_STATUSES.has(input.status as E2ERunStatus)) {
    throw new HttpError(400, 'status must be passed, failed, or cancelled.');
  }
  const status = input.status as E2ERunStatus;
  const failurePhase = safeString(input.failure_phase, 'failure_phase', 60, false);
  const failureCode = safeString(input.failure_code, 'failure_code', 60, false);
  if (run.status === status) return { run }; // idempotent replay
  if (run.status !== 'registered' && run.status !== 'running') throw new HttpError(409, `This run is already ${run.status}.`);
  await repository.setRunStatus(runId, status, now.toISOString(), failurePhase, failureCode);
  const updated = await repository.getRun(runId);
  return { run: updated };
}

export type CleanupResourceOutcome = { resource_type: E2EResourceType; resource_ref: string; lifecycle: E2EResourceLifecycle };

export async function performCleanup(repository: E2ERegistryRepository, runId: string, now: Date): Promise<{ run_id: string; cleanup_status: E2ECleanupStatus; resources: CleanupResourceOutcome[] }> {
  const run = await requireRun(repository, runId);

  if (run.cleanup_status === 'completed' || run.cleanup_status === 'completed_with_absent_resources' || run.cleanup_status === 'requires_operator' || run.cleanup_status === 'operator_acknowledged') {
    const resources = await repository.listResourcesForRun(runId);
    return { run_id: runId, cleanup_status: run.cleanup_status, resources: resources.map((r) => ({ resource_type: r.resource_type, resource_ref: r.resource_ref, lifecycle: r.lifecycle })) };
  }

  const leaseExpiryIso = new Date(now.getTime() - CLEANUP_LEASE_DURATION_SECONDS * 1000).toISOString();
  const leased = await repository.acquireCleanupLease(runId, now.toISOString(), leaseExpiryIso);
  if (!leased) {
    const current = await repository.getRun(runId);
    const resources = await repository.listResourcesForRun(runId);
    return { run_id: runId, cleanup_status: current?.cleanup_status ?? 'in_progress', resources: resources.map((r) => ({ resource_type: r.resource_type, resource_ref: r.resource_ref, lifecycle: r.lifecycle })) };
  }

  const resources = await repository.listResourcesForRun(runId);
  const outcomes: CleanupResourceOutcome[] = [];
  let anyPermanentFailure = false; // ownership_mismatch — never auto-retryable
  let anyRetryableFailure = false; // transient failure with attempts still remaining
  let anyExhaustedFailure = false; // transient failure at MAX_CLEANUP_ATTEMPTS
  let anyAbsent = false;
  let cleanedCount = 0;

  for (const resource of resources) {
    if (resource.lifecycle === 'cleaned' || resource.lifecycle === 'absent') {
      outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: resource.lifecycle });
      if (resource.lifecycle === 'cleaned') cleanedCount += 1;
      continue;
    }
    // ownership_mismatch is permanent — never retry a resource that doesn't belong to this run.
    if (resource.cleanup_failure_code === 'ownership_mismatch') {
      anyPermanentFailure = true;
      outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'cleanup_failed' });
      continue;
    }
    if (resource.cleanup_attempts >= MAX_CLEANUP_ATTEMPTS) {
      anyExhaustedFailure = true;
      outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'cleanup_failed' });
      continue;
    }
    try {
      if (resource.resource_type === 'job') {
        const nowIso = now.toISOString();
        const candidate = await repository.findCandidateJob(resource.resource_ref);
        if (!candidate) {
          await repository.markResourceLifecycle(runId, resource.resource_type, resource.resource_ref, 'absent', nowIso);
          outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'absent' });
          anyAbsent = true;
          continue;
        }
        if (candidate.owner_user_id !== null || candidate.created_at < run.created_at) {
          // Never delete a resource that doesn't verifiably belong to this run.
          await repository.markResourceLifecycle(runId, resource.resource_type, resource.resource_ref, 'cleanup_failed', nowIso, 'ownership_mismatch');
          anyPermanentFailure = true;
          outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'cleanup_failed' });
          continue;
        }
        await repository.cleanupJobResource(resource.resource_ref);
        const remaining = await repository.countJobOwnedRows(resource.resource_ref);
        if (remaining === 0) {
          await repository.markResourceLifecycle(runId, resource.resource_type, resource.resource_ref, 'cleaned', nowIso);
          outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'cleaned' });
          cleanedCount += 1;
        } else {
          await repository.markResourceLifecycle(runId, resource.resource_type, resource.resource_ref, 'cleanup_failed', nowIso, 'rows_remaining');
          if (resource.cleanup_attempts + 1 >= MAX_CLEANUP_ATTEMPTS) anyExhaustedFailure = true;
          else anyRetryableFailure = true;
          outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'cleanup_failed' });
        }
      }
    } catch {
      await repository.markResourceLifecycle(runId, resource.resource_type, resource.resource_ref, 'cleanup_failed', now.toISOString(), 'exception');
      if (resource.cleanup_attempts + 1 >= MAX_CLEANUP_ATTEMPTS) anyExhaustedFailure = true;
      else anyRetryableFailure = true;
      outcomes.push({ resource_type: resource.resource_type, resource_ref: resource.resource_ref, lifecycle: 'cleanup_failed' });
    }
  }

  // Permanent failures (ownership_mismatch) → immediately requires_operator.
  // Exhausted transient failures with nothing retryable left → requires_operator.
  // Retryable transient failures → pending (janitor retries automatically).
  const finalStatus: E2ECleanupStatus = anyPermanentFailure || (anyExhaustedFailure && !anyRetryableFailure)
    ? 'requires_operator'
    : anyRetryableFailure
      ? 'pending'
      : anyAbsent ? 'completed_with_absent_resources' : 'completed';
  await repository.finishCleanup(runId, finalStatus, now.toISOString(), cleanedCount);
  return { run_id: runId, cleanup_status: finalStatus, resources: outcomes };
}

export async function requestCleanup(repository: E2ERegistryRepository, runId: string, now: Date) {
  await requireRun(repository, runId);
  await repository.requestCleanup(runId);
  return performCleanup(repository, runId, now);
}

/**
 * Operator acknowledges a requires_operator run as resolved.  Uses
 * 'operator_acknowledged' (not 'completed_with_absent_resources') so
 * the registry honestly preserves evidence: resources retain their
 * cleanup_failed lifecycle and failure codes; the run status records
 * that an operator intervened.  cleaned_at is set so the 30-day purge
 * can eventually remove the registry row.  Requires explicit
 * confirmation to prevent accidental invocation.
 */
export async function acknowledgeCleanup(repository: E2ERegistryRepository, runId: string, now: Date, confirmed: boolean): Promise<{ run_id: string; cleanup_status: E2ECleanupStatus }> {
  if (!confirmed) throw new HttpError(400, 'Acknowledgement requires explicit confirmation (confirm: true).');
  const run = await requireRun(repository, runId);
  if (run.cleanup_status !== 'requires_operator') {
    throw new HttpError(409, `Run cleanup_status is '${run.cleanup_status}', not 'requires_operator'.`);
  }
  await repository.acknowledgeCleanup(runId, now.toISOString());
  return { run_id: runId, cleanup_status: 'operator_acknowledged' };
}

/**
 * Operator resets a requires_operator run back to 'pending' for another
 * automatic retry pass (janitor or explicit requestCleanup).
 */
export async function resetCleanup(repository: E2ERegistryRepository, runId: string): Promise<{ run_id: string; cleanup_status: E2ECleanupStatus }> {
  const run = await requireRun(repository, runId);
  if (run.cleanup_status !== 'requires_operator') {
    throw new HttpError(409, `Run cleanup_status is '${run.cleanup_status}', not 'requires_operator'.`);
  }
  await repository.resetCleanup(runId);
  return { run_id: runId, cleanup_status: 'pending' };
}

export async function getRunStatus(repository: E2ERegistryRepository, runId: string) {
  const run = await requireRun(repository, runId);
  const resources = await repository.listResourcesForRun(runId);
  return { run, resources };
}

export async function legacyInventory(repository: E2ERegistryRepository, limit = 100) {
  const bounded = Math.min(Math.max(limit, 1), 500);
  return repository.legacyInventory(bounded);
}

export { JANITOR_DEFAULT_BATCH };
