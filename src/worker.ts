/// <reference path="../worker-configuration.d.ts" />

// Vars injected at deploy time via --var; not in wrangler.jsonc.
declare global { interface Env { RELEASE_VERSION?: string; RELEASE_SHA?: string; } }

import { PingStepD1Repository } from './worker/repository.ts';
import { HostedPingStepService, HttpError } from './worker/service.ts';
import { requireOperator, requireReadAccess } from './worker/auth.ts';
import { deleteJob, provisionJob, rotateJobTokens } from './worker/operator.ts';
import { deliverPendingAlerts } from './worker/alerts.ts';
import { completeOAuth, currentAccount, requireAccount, requireSameOrigin, signOut, startOAuth } from './worker/accounts.ts';
import { policyFor, rollingWindowStart, type PlanCode } from './worker/plans.ts';
import { createCheckout, createPortal, handleStripeWebhook } from './worker/billing.ts';
import { submitFeedback } from './worker/feedback.ts';

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...headers
  }
});
const MAX_EVENT_BODY_BYTES = 64 * 1024;
const MAX_CONTROL_BODY_BYTES = 16 * 1024;

async function readJsonBody(request: Request, limit: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)) {
    throw new HttpError(413, 'Request body is too large.');
  }
  if (!request.body) throw new HttpError(400, 'Request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__scheduled') {
    return new Response('Not found', { status: 404 });
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({
      status: 'ok',
      storage: 'd1',
      environment: env.ENVIRONMENT ?? 'unknown',
      version: env.RELEASE_VERSION ?? null,
      commit: env.RELEASE_SHA ? env.RELEASE_SHA.slice(0, 7) : null
    });
  }
  if (request.method === 'GET' && url.pathname === '/v1/version') {
    return json({
      environment: env.ENVIRONMENT ?? 'unknown',
      version: env.RELEASE_VERSION ?? null,
      commit: env.RELEASE_SHA ? env.RELEASE_SHA.slice(0, 7) : null
    });
  }
  if (request.method === 'GET' && url.pathname === '/v1/auth/me') {
    return json({ user: await currentAccount(request, new PingStepD1Repository(env.DB)) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/account/usage') {
    const repository = new PingStepD1Repository(env.DB);
    const account = await requireAccount(request, repository);
    const policy = policyFor((await repository.getAccountPlan(account.id, new Date().toISOString())).plan);
    return json({
      plan: policy.code,
      plan_label: policy.label,
      jobs_used: await repository.countJobsForOwner(account.id),
      jobs_limit: policy.maxJobs,
      runs_used: await repository.countRunsForOwnerSince(account.id, rollingWindowStart()),
      runs_limit: policy.maxRunsPer30Days
    });
  }
  const oauthStartMatch = url.pathname.match(/^\/v1\/auth\/(github|google)$/);
  if (request.method === 'GET' && oauthStartMatch) return startOAuth(request, env, new PingStepD1Repository(env.DB), oauthStartMatch[1]);
  const oauthCallbackMatch = url.pathname.match(/^\/v1\/auth\/(github|google)\/callback$/);
  if (request.method === 'GET' && oauthCallbackMatch) return completeOAuth(request, env, new PingStepD1Repository(env.DB), oauthCallbackMatch[1]);
  if (request.method === 'POST' && url.pathname === '/v1/auth/signout') {
    requireSameOrigin(request);
    return json({ ok: true }, 200, { 'set-cookie': await signOut(request, new PingStepD1Repository(env.DB)) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/billing/stripe/webhook') {
    return handleStripeWebhook(request, env, new PingStepD1Repository(env.DB)).then(() => new Response(null, { status: 200 }));
  }
  if (request.method === 'POST' && url.pathname === '/v1/billing/checkout') {
    requireSameOrigin(request);
    const repository = new PingStepD1Repository(env.DB);
    return json(await createCheckout(env, repository, await requireAccount(request, repository), (await readJsonBody(request, MAX_CONTROL_BODY_BYTES) as { plan?: unknown }).plan));
  }
  if (request.method === 'POST' && url.pathname === '/v1/billing/portal') {
    requireSameOrigin(request);
    const repository = new PingStepD1Repository(env.DB);
    return json(await createPortal(env, repository, await requireAccount(request, repository)));
  }
  if (request.method === 'GET' && url.pathname === '/') {
    return env.ASSETS.fetch(new Request(new URL('/landing.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/app') {
    return env.ASSETS.fetch(new Request(new URL('/workspace.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/status') {
    return env.ASSETS.fetch(new Request(new URL('/status.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/contact') {
    return env.ASSETS.fetch(new Request(new URL('/contact.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/index.html') {
    return Response.redirect(new URL('/app', request.url).toString(), 302);
  }
  if (request.method === 'GET' && url.pathname === '/v1/runs') {
    const repository = new PingStepD1Repository(env.DB);
    const account = await currentAccount(request, repository);
    if (account) return json({ runs: await repository.listRunsForOwner(account.id), role: 'user', user: { email: account.email } });
    const access = await requireReadAccess(request, env, repository);
    return json({
      runs: access.role === 'operator' ? await repository.listRuns() : await repository.listRunsForJob(access.jobKey),
      role: access.role
    });
  }
  if (request.method === 'GET' && url.pathname === '/v1/alerts') {
    await requireOperator(request, env);
    return json({ alerts: await new PingStepD1Repository(env.DB).listAlerts() });
  }
  if (request.method === 'GET' && url.pathname === '/v1/operator/jobs') {
    await requireOperator(request, env);
    return json({ jobs: await new PingStepD1Repository(env.DB).listJobs() });
  }
  if (request.method === 'POST' && url.pathname === '/v1/operator/jobs') {
    await requireOperator(request, env);
    return json(await provisionJob(new PingStepD1Repository(env.DB), await readJsonBody(request, MAX_CONTROL_BODY_BYTES)), 201);
  }
  const accountPlanMatch = url.pathname.match(/^\/v1\/operator\/accounts\/([^/]+)\/plan$/);
  if (request.method === 'POST' && accountPlanMatch) {
    await requireOperator(request, env);
    const body = await readJsonBody(request, MAX_CONTROL_BODY_BYTES) as { plan?: unknown; active_until?: unknown };
    if (body.plan !== 'trial' && body.plan !== 'pro' && body.plan !== 'team') throw new HttpError(400, 'plan must be trial, pro, or team.');
    if (body.active_until !== null && body.active_until !== undefined && (typeof body.active_until !== 'string' || Number.isNaN(Date.parse(body.active_until)))) {
      throw new HttpError(400, 'active_until must be an RFC 3339 timestamp or null.');
    }
    const repository = new PingStepD1Repository(env.DB);
    await repository.setAccountPlan(decodeURIComponent(accountPlanMatch[1]), body.plan as PlanCode, body.active_until ?? null, new Date().toISOString());
    return json({ ok: true });
  }
  if (request.method === 'POST' && url.pathname === '/v1/operator/accounts/plan') {
    await requireOperator(request, env);
    const body = await readJsonBody(request, MAX_CONTROL_BODY_BYTES) as { email?: unknown; plan?: unknown; active_until?: unknown };
    if (typeof body.email !== 'string' || !body.email.trim()) throw new HttpError(400, 'email is required.');
    if (body.plan !== 'trial' && body.plan !== 'pro' && body.plan !== 'team') throw new HttpError(400, 'plan must be trial, pro, or team.');
    if (body.active_until !== null && body.active_until !== undefined && (typeof body.active_until !== 'string' || Number.isNaN(Date.parse(body.active_until)))) {
      throw new HttpError(400, 'active_until must be an RFC 3339 timestamp or null.');
    }
    const repository = new PingStepD1Repository(env.DB);
    const user = await repository.getUserByEmail(body.email.trim().toLowerCase());
    if (!user) throw new HttpError(404, 'Account not found.');
    await repository.setAccountPlan(user.id, body.plan as PlanCode, body.active_until ?? null, new Date().toISOString());
    return json({ ok: true });
  }
  if (request.method === 'POST' && url.pathname === '/v1/jobs') {
    requireSameOrigin(request);
    const repository = new PingStepD1Repository(env.DB);
    const account = await requireAccount(request, repository);
    return json(await provisionJob(repository, await readJsonBody(request, MAX_CONTROL_BODY_BYTES), account.id), 201);
  }
  if (request.method === 'GET' && url.pathname === '/v1/jobs') {
    const repository = new PingStepD1Repository(env.DB);
    const account = await requireAccount(request, repository);
    return json({ jobs: await repository.listJobsForOwner(account.id) });
  }
  const jobActionMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/(tokens\/rotate|delete)$/);
  if (request.method === 'POST' && jobActionMatch) {
    requireSameOrigin(request);
    const repository = new PingStepD1Repository(env.DB);
    const account = await requireAccount(request, repository);
    const jobKey = decodeURIComponent(jobActionMatch[1]);
    const body = await readJsonBody(request, MAX_CONTROL_BODY_BYTES);
    if (jobActionMatch[2] === 'tokens/rotate') return json(await rotateJobTokens(repository, jobKey, body, account.id));
    await deleteJob(repository, jobKey, body, account.id);
    return json({ ok: true });
  }
  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)$/);
  const eventsMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)\/events$/);
  if (request.method === 'GET' && eventsMatch) {
    const repository = new PingStepD1Repository(env.DB);
    const jobKey = decodeURIComponent(eventsMatch[1]);
    const runId = decodeURIComponent(eventsMatch[2]);
    const account = await currentAccount(request, repository);
    if (account) {
      const job = await repository.getJob(jobKey);
      if (!job || job.owner_user_id !== account.id) throw new HttpError(403, 'This account cannot access that job.');
    } else {
      const access = await requireReadAccess(request, env, repository);
      if (access.role === 'viewer' && access.jobKey !== jobKey) throw new HttpError(403, 'This viewer token cannot access that job.');
    }
    if (!await repository.getRun(jobKey, runId)) return json({ error: 'Run not found.' }, 404);
    const events = (await repository.listEventsForRun(jobKey, runId)).map((event) => ({
      ...event,
      data: JSON.parse(event.data_json) as Record<string, unknown>
    }));
    return json({ events });
  }
  if (request.method === 'GET' && runMatch) {
    const repository = new PingStepD1Repository(env.DB);
    const jobKey = decodeURIComponent(runMatch[1]);
    const account = await currentAccount(request, repository);
    if (account) {
      const job = await repository.getJob(jobKey);
      if (!job || job.owner_user_id !== account.id) throw new HttpError(403, 'This account cannot access that job.');
    } else {
      const access = await requireReadAccess(request, env, repository);
      if (access.role === 'viewer' && access.jobKey !== jobKey) throw new HttpError(403, 'This viewer token cannot access that job.');
    }
    const run = await repository.getRun(jobKey, decodeURIComponent(runMatch[2]));
    return run ? json({ run }) : json({ error: 'Run not found.' }, 404);
  }
  if (request.method === 'POST' && url.pathname === '/v1/events') {
    const service = new HostedPingStepService(new PingStepD1Repository(env.DB));
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    const result = await service.ingest(await readJsonBody(request, MAX_EVENT_BODY_BYTES), token);
    return json(result, result.duplicate ? 200 : 202);
  }
  if (request.method === 'POST' && url.pathname === '/v1/feedback') {
    const clientIp = request.headers.get('cf-connecting-ip');
    return json(await submitFeedback(env.DB, env, await readJsonBody(request, MAX_CONTROL_BODY_BYTES), clientIp));
  }
  if (url.pathname.startsWith('/v1/')) {
    return json({ error: 'API endpoint not found.' }, 404);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'request_failed', message: error instanceof Error ? error.message : 'Unknown error' }));
      return json({ error: 'Internal server error.' }, 500);
    }
  },

  async scheduled(_controller, env): Promise<void> {
    // Instantiated per invocation: no mutable request state is global.
    const repository = new PingStepD1Repository(env.DB);
    const now = new Date().toISOString();
    const expiredPendingEvents = await repository.expirePendingEvents(now);
    const expiredOAuthStates = await repository.deleteExpiredOAuthStates(now);
    const expiredSessions = await repository.deleteExpiredSessions(now);
    const reconciled = await new HostedPingStepService(repository).reconcile();
    const delivered = await deliverPendingAlerts(repository, env);
    console.log(JSON.stringify({ event: 'scheduled_reconcile', stale_runs_marked: reconciled.stale, late_runs_marked: reconciled.late, alerts_delivered: delivered, expired_pending_events: expiredPendingEvents, expired_oauth_states: expiredOAuthStates, expired_sessions: expiredSessions }));
  }
} satisfies ExportedHandler<Env>;
