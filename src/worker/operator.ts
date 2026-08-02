import { HttpError } from './service.ts';
import { PingStepD1Repository } from './repository.ts';
import { policyFor } from './plans.ts';

type JobInput = {
  job_key?: unknown;
  expected_update_interval_seconds?: unknown;
  liveness_grace_seconds?: unknown;
  expected_duration_seconds?: unknown;
  late_grace_seconds?: unknown;
};

const positiveInteger = (value: unknown, field: string, fallback?: number): number | null => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined) return null;
  if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return value;
};

const nonNegativeInteger = (value: unknown, field: string, fallback?: number): number | null => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined) return null;
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0) throw new HttpError(400, `${field} must be a non-negative integer.`);
  return value;
};

async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `ps_job_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function createViewerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `ps_view_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function confirmedJobKey(rawInput: unknown, jobKey: string): void {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput) || (rawInput as { confirm_job_key?: unknown }).confirm_job_key !== jobKey) {
    throw new HttpError(400, 'Type the exact job key to confirm this action.');
  }
}

export async function rotateJobTokens(repository: PingStepD1Repository, jobKey: string, rawInput: unknown, ownerUserId: string) {
  confirmedJobKey(rawInput, jobKey);
  const token = createToken();
  const viewerToken = createViewerToken();
  if (!await repository.rotateJobTokens(jobKey, ownerUserId, await hash(token), await hash(viewerToken), new Date().toISOString())) {
    throw new HttpError(404, 'Job not found.');
  }
  return { token, viewer_token: viewerToken, warning: 'Previous job and viewer tokens stopped working. Save these replacements now.' };
}

export async function deleteJob(repository: PingStepD1Repository, jobKey: string, rawInput: unknown, ownerUserId: string) {
  confirmedJobKey(rawInput, jobKey);
  if (!await repository.deleteJobForOwner(jobKey, ownerUserId)) throw new HttpError(404, 'Job not found.');
}

export async function provisionJob(repository: PingStepD1Repository, rawInput: unknown, ownerUserId: string | null = null) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new HttpError(400, 'Job configuration must be a JSON object.');
  const input = rawInput as JobInput;
  if (typeof input.job_key !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(input.job_key)) {
    throw new HttpError(400, 'job_key must be 2–101 letters, numbers, dots, underscores, or hyphens.');
  }
  if (await repository.getJob(input.job_key)) throw new HttpError(409, 'A job with this job_key already exists.');
  const interval = positiveInteger(input.expected_update_interval_seconds, 'expected_update_interval_seconds', 60);
  const livenessGrace = nonNegativeInteger(input.liveness_grace_seconds, 'liveness_grace_seconds', 120);
  const expectedDuration = positiveInteger(input.expected_duration_seconds, 'expected_duration_seconds');
  const lateGrace = nonNegativeInteger(input.late_grace_seconds, 'late_grace_seconds');
  if (ownerUserId) {
    const policy = policyFor((await repository.getAccountPlan(ownerUserId, new Date().toISOString())).plan);
    if (await repository.countJobsForOwner(ownerUserId) >= policy.maxJobs) {
      throw new HttpError(402, `Your ${policy.label} plan allows ${policy.maxJobs} jobs. Upgrade at https://pingstep.dev/pricing.html to add more.`);
    }
    if ((interval ?? 60) < policy.minimumUpdateIntervalSeconds) {
      throw new HttpError(400, `${policy.label} requires an expected update interval of at least ${policy.minimumUpdateIntervalSeconds} seconds.`);
    }
  }
  const token = createToken();
  const viewerToken = createViewerToken();
  await repository.createJob({
    job_key: input.job_key,
    token_hash: await hash(token),
    viewer_token_hash: await hash(viewerToken),
    owner_user_id: ownerUserId,
    expected_update_interval_seconds: interval ?? 60,
    liveness_grace_seconds: livenessGrace ?? 120,
    expected_duration_seconds: expectedDuration,
    late_grace_seconds: lateGrace
  }, new Date().toISOString());
  return {
    job: {
      job_key: input.job_key,
      expected_update_interval_seconds: interval,
      liveness_grace_seconds: livenessGrace,
      expected_duration_seconds: expectedDuration,
      late_grace_seconds: lateGrace
    },
    token,
    viewer_token: viewerToken,
    warning: 'Save this job token now. PingStep stores only its hash and cannot show it again.'
  };
}
