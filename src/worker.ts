/// <reference path="../worker-configuration.d.ts" />

import { PingStepD1Repository } from './worker/repository';
import { HostedPingStepService, HttpError } from './worker/service';
import { requireOperator, requireReadAccess } from './worker/auth';
import { provisionJob } from './worker/operator';
import { deliverPendingAlerts } from './worker/alerts';
import { completeOAuth, currentAccount, requireAccount, requireSameOrigin, signOut, startOAuth } from './worker/accounts';
import { policyFor, rollingWindowStart, type PlanCode } from './worker/plans';

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store', ...headers }
});

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__scheduled') {
    return new Response('Not found', { status: 404 });
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'ok', storage: 'd1' });
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
  if (request.method === 'GET' && url.pathname === '/') {
    return env.ASSETS.fetch(new Request(new URL('/landing.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/app') {
    return env.ASSETS.fetch(new Request(new URL('/workspace.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/status') {
    return env.ASSETS.fetch(new Request(new URL('/status.html', request.url), request));
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
    return json(await provisionJob(new PingStepD1Repository(env.DB), await request.json()), 201);
  }
  const accountPlanMatch = url.pathname.match(/^\/v1\/operator\/accounts\/([^/]+)\/plan$/);
  if (request.method === 'POST' && accountPlanMatch) {
    await requireOperator(request, env);
    const body = await request.json() as { plan?: unknown; active_until?: unknown };
    if (body.plan !== 'trial' && body.plan !== 'pro' && body.plan !== 'team') throw new HttpError(400, 'plan must be trial, pro, or team.');
    if (body.active_until !== null && body.active_until !== undefined && (typeof body.active_until !== 'string' || Number.isNaN(Date.parse(body.active_until)))) {
      throw new HttpError(400, 'active_until must be an RFC 3339 timestamp or null.');
    }
    const repository = new PingStepD1Repository(env.DB);
    await repository.setAccountPlan(decodeURIComponent(accountPlanMatch[1]), body.plan as PlanCode, body.active_until ?? null, new Date().toISOString());
    return json({ ok: true });
  }
  if (request.method === 'POST' && url.pathname === '/v1/jobs') {
    requireSameOrigin(request);
    const repository = new PingStepD1Repository(env.DB);
    const account = await requireAccount(request, repository);
    return json(await provisionJob(repository, await request.json(), account.id), 201);
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
    const result = await service.ingest(await request.json(), token);
    return json(result, result.duplicate ? 200 : 202);
  }
  if (url.pathname.startsWith('/v1/')) {
    return json({ error: 'Hosted event API is being enabled in the next deployment task.' }, 503);
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
    const changed = await new HostedPingStepService(repository).reconcile();
    const delivered = await deliverPendingAlerts(repository, env);
    console.log(JSON.stringify({ event: 'scheduled_reconcile', stale_runs_marked: changed, alerts_delivered: delivered }));
  }
} satisfies ExportedHandler<Env>;
