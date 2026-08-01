import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { FileStore } from './store.js';
import { PingStepService } from './service.js';
import { deliverPendingAlerts, WebhookAlertChannel } from './alerts.js';

const port = Number(process.env.PORT ?? 3000);
const databasePath = resolve(process.env.PINGSTEP_DATA_FILE ?? './data/pingstep.json');
const parseJsonEnv = (name) => {
  try { return JSON.parse(process.env[name] ?? '{}'); } catch { throw new Error(`${name} must contain valid JSON.`); }
};
const store = new FileStore(databasePath);
await mkdir(dirname(databasePath), { recursive: true });
await store.load();
const service = new PingStepService(store, {
  tokenHashesByJob: parseJsonEnv('PINGSTEP_JOB_TOKEN_HASHES_JSON'),
  jobConfigByKey: parseJsonEnv('PINGSTEP_JOB_CONFIG_JSON')
});
const alertChannel = new WebhookAlertChannel({
  url: process.env.PINGSTEP_ALERT_WEBHOOK_URL,
  token: process.env.PINGSTEP_ALERT_WEBHOOK_TOKEN
});
const evaluatorIntervalMs = Math.max(1000, Number(process.env.PINGSTEP_EVALUATOR_INTERVAL_MS ?? 60 * 1000));
const dashboardHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

async function evaluateRuns() {
  await service.reconcile();
  await deliverPendingAlerts(store, alertChannel);
}

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(dashboardHtml);
    }
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { status: 'ok' });
    if (request.method === 'GET' && url.pathname === '/v1/runs') return send(response, 200, { runs: service.listRuns() });
    if (request.method === 'GET' && url.pathname === '/v1/alerts') return send(response, 200, { alerts: service.listAlerts() });
    const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)$/);
    const eventMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)\/events$/);
    const etaMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/([^/]+)\/eta$/);
    if (request.method === 'GET' && etaMatch) {
      const jobKey = decodeURIComponent(etaMatch[1]);
      const runId = decodeURIComponent(etaMatch[2]);
      if (!service.getRun(jobKey, runId)) return send(response, 404, { error: 'Run not found.' });
      return send(response, 200, { eta: service.getEta(jobKey, runId) });
    }
    if (request.method === 'GET' && eventMatch) {
      const jobKey = decodeURIComponent(eventMatch[1]);
      const runId = decodeURIComponent(eventMatch[2]);
      if (!service.getRun(jobKey, runId)) return send(response, 404, { error: 'Run not found.' });
      return send(response, 200, { events: service.listRunEvents(jobKey, runId) });
    }
    if (request.method === 'GET' && runMatch) {
      const run = service.getRun(decodeURIComponent(runMatch[1]), decodeURIComponent(runMatch[2]));
      return run ? send(response, 200, { run }) : send(response, 404, { error: 'Run not found.' });
    }
    if (request.method === 'POST' && url.pathname === '/v1/events') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      const result = await service.ingest(JSON.parse(raw), token);
      return send(response, result.duplicate ? 200 : 202, result);
    }
    return send(response, 404, { error: 'Not found.' });
  } catch (error) {
    const status = error.code === 'UNAUTHORIZED' ? 401 : error.code === 'CONFLICT' ? 409 : error.code === 'VALIDATION_ERROR' || error instanceof SyntaxError ? 400 : 500;
    return send(response, status, { error: error.message });
  }
});

const evaluator = setInterval(() => evaluateRuns().catch((error) => console.error('PingStep evaluator failed:', error.message)), evaluatorIntervalMs);
evaluator.unref();
await evaluateRuns();
server.listen(port, () => console.log(`PingStep listening on http://localhost:${port}`));
