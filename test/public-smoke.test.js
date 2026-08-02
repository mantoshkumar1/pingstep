import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicFile = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('dashboard has a direct GitHub sign-in route and guided first-job creation', async () => {
  const html = await publicFile('workspace.html');
  assert.match(html, /href="\/v1\/auth\/github"/);
  assert.match(html, /id="job-form"/);
  assert.match(html, /\/v1\/jobs/);
  assert.match(html, /Your first run in four steps/);
  assert.match(html, /data-copy="job-token"/);
  assert.match(html, /setInterval\(\(\)=>\{if\(!document\.hidden\)load/);
});

test('public lifecycle explains stale without calling it failed', async () => {
  const html = await publicFile('landing.html');
  assert.match(html, /Status means one clear thing/);
  assert.match(html, /Updates stopped past the time you set/);
  assert.match(html, /script explicitly sent a failed completion event/);
  assert.doesNotMatch(html, /20.?90/);
  assert.doesNotMatch(html, /beta/i);
});

test('public pages include responsive and accessibility foundations', async () => {
  const [landing, workspace] = await Promise.all([publicFile('landing.html'), publicFile('workspace.html')]);
  assert.match(landing, /@media\(max-width:800px\)/);
  assert.match(workspace, /@media\(max-width:600px\)/);
  assert.match(landing, /prefers-reduced-motion/);
  assert.match(workspace, /aria-live="polite"/);
});

test('status and launch discovery assets are present', async () => {
  const [status, robots, sitemap, locale, llms] = await Promise.all([
    publicFile('status.html'), publicFile('robots.txt'), publicFile('sitemap.xml'), publicFile('locales/i18n.js'), publicFile('llms.txt')
  ]);
  assert.match(status, /fetch\('\/health'/);
  assert.match(robots, /Sitemap:/);
  assert.match(sitemap, /https:\/\/pingstep.dev/);
  assert.match(locale, /PingStepI18n/);
  assert.match(locale, /'pt-BR'/);
  assert.match(llms, /not proof of failure/);
  const headers = await publicFile('_headers');
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /frame-ancestors 'none'/);
});

test('landing and dashboard offer persistent Spanish, Brazilian Portuguese, and German', async () => {
  const [landing, workspace, locale] = await Promise.all([publicFile('landing.html'), publicFile('workspace.html'), publicFile('locales/i18n.js')]);
  for (const page of [landing, workspace]) {
    assert.match(page, /option value="es"/);
    assert.match(page, /option value="pt-BR"/);
    assert.match(page, /option value="de"/);
    assert.match(page, /PingStepI18n\.init/);
  }
  assert.match(locale, /'See where your job is\.'\s*:\s*'Vea dónde está su tarea\.'/);
  assert.match(locale, /'See where your job is\.'\s*:\s*'Veja onde está o seu trabalho\.'/);
  assert.match(locale, /'See where your job is\.'\s*:\s*'Sehen Sie, wo Ihr Job steht\.'/);
});

test('dashboard exposes confirmed token rotation, job deletion, and translation feedback', async () => {
  const workspace = await publicFile('workspace.html');
  assert.match(workspace, /Manage jobs/);
  assert.match(workspace, /tokens\/rotate/);
  assert.match(workspace, /Delete job/);
  assert.match(workspace, /confirm_job_key/);
  assert.match(workspace, /translation%20feedback/);
  assert.match(workspace, /Intl\.DateTimeFormat\(PingStepI18n\.current\(\)/);
});

test('pricing keeps the trial small and the paid plans explicit', async () => {
  const pricing = await publicFile('pricing.html');
  assert.match(pricing, /2 jobs/);
  assert.match(pricing, /10 runs in a rolling 30 days/);
  assert.match(pricing, /US\$12/);
  assert.match(pricing, /US\$39/);
  assert.match(pricing, /Paid access is enabled after a payment request is confirmed/);
});

test('contact page is ready for customer support and uses the clean public URL', async () => {
  const [contact, worker, server] = await Promise.all([
    publicFile('contact.html'),
    readFile(new URL('../src/worker.ts', import.meta.url), 'utf8'),
    readFile(new URL('../test/e2e-server.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(contact, /https:\/\/pingstep\.dev\/contact/);
  assert.match(contact, /Support and billing/);
  assert.match(contact, /PingStep deletion request/);
  assert.match(contact, /Do not send tokens, credentials, raw logs, or personal data/);
  assert.match(worker, /url\.pathname === '\/contact'/);
  assert.match(server, /path === '\/contact'/);
});
