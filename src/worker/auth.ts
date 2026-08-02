import { HttpError } from './service';
import { PingStepD1Repository } from './repository';

function bearerToken(request: Request): string | null {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
}

async function hash(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function hashHex(value: string): Promise<string> {
  return Array.from(await hash(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/** The operator token is a Cloudflare secret, never a Wrangler variable or source value. */
export async function requireOperator(request: Request, env: Env): Promise<void> {
  const configuredToken = Reflect.get(env, 'OPERATOR_TOKEN');
  const suppliedToken = bearerToken(request);
  if (typeof configuredToken !== 'string' || !suppliedToken || !timingSafeEqual(await hash(suppliedToken), await hash(configuredToken))) {
    throw new HttpError(401, 'Operator authentication is required.');
  }
}

export type ReadAccess = { role: 'operator' } | { role: 'viewer'; jobKey: string };

/** A viewer token is scoped to one job and can read neither alerts nor other jobs. */
export async function requireReadAccess(request: Request, env: Env, repository: PingStepD1Repository): Promise<ReadAccess> {
  const suppliedToken = bearerToken(request);
  const configuredToken = Reflect.get(env, 'OPERATOR_TOKEN');
  if (typeof configuredToken === 'string' && suppliedToken && timingSafeEqual(await hash(suppliedToken), await hash(configuredToken))) {
    return { role: 'operator' };
  }
  if (suppliedToken) {
    const job = await repository.getJobByViewerTokenHash(await hashHex(suppliedToken));
    if (job) return { role: 'viewer', jobKey: job.job_key };
  }
  throw new HttpError(401, 'A valid operator or job viewer token is required.');
}
