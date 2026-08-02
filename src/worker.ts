/// <reference path="../worker-configuration.d.ts" />

import { PingStepD1Repository } from './worker/repository';
import { HostedPingStepService, HttpError } from './worker/service';
import { requireOperator } from './worker/auth';

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store' }
});

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__scheduled') {
    return new Response('Not found', { status: 404 });
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'ok', storage: 'd1' });
  }
  if (request.method === 'GET' && url.pathname === '/v1/runs') {
    await requireOperator(request, env);
    return json({ runs: await new PingStepD1Repository(env.DB).listRuns() });
  }
  const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)$/);
  const eventsMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)\/events$/);
  if (request.method === 'GET' && eventsMatch) {
    await requireOperator(request, env);
    const repository = new PingStepD1Repository(env.DB);
    const jobKey = decodeURIComponent(eventsMatch[1]);
    const runId = decodeURIComponent(eventsMatch[2]);
    if (!await repository.getRun(jobKey, runId)) return json({ error: 'Run not found.' }, 404);
    const events = (await repository.listEventsForRun(jobKey, runId)).map((event) => ({
      ...event,
      data: JSON.parse(event.data_json) as Record<string, unknown>
    }));
    return json({ events });
  }
  if (request.method === 'GET' && runMatch) {
    await requireOperator(request, env);
    const run = await new PingStepD1Repository(env.DB).getRun(decodeURIComponent(runMatch[1]), decodeURIComponent(runMatch[2]));
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
    // The repository is deliberately instantiated per invocation: no mutable request state is global.
    // Reconciliation will be enabled with the hosted ingestion endpoint in the next task.
    void new PingStepD1Repository(env.DB);
  }
} satisfies ExportedHandler<Env>;
