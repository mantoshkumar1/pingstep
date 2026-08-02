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
  const [status, robots, sitemap, locale] = await Promise.all([
    publicFile('status.html'), publicFile('robots.txt'), publicFile('sitemap.xml'), publicFile('locales/en.js')
  ]);
  assert.match(status, /fetch\('\/health'/);
  assert.match(robots, /Sitemap:/);
  assert.match(sitemap, /https:\/\/pingstep.dev/);
  assert.match(locale, /PINGSTEP_LOCALES/);
});
