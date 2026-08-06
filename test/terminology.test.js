import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const publicFile = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const rootFile = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

// Real, standalone public pages (not partials, not asset/text files).
const PUBLIC_PAGES = [
  'landing.html', 'pricing.html', 'docs.html', 'ai-integration.html', 'security.html',
  'privacy.html', 'terms.html', 'status.html', 'contact.html', 'workspace.html', 'index.html'
];

async function allPublicHtml() {
  const names = (await readdir(new URL('../public/', import.meta.url))).filter((name) => name.endsWith('.html'));
  const files = await Promise.all(names.map((name) => publicFile(name).then((html) => [name, html])));
  return files;
}

test('stale is never described as failure anywhere in public/ HTML', async () => {
  const files = await allPublicHtml();
  for (const [name, html] of files) {
    assert.doesNotMatch(html, /stale (run|job)?\s*(has |is )?failed/i, `${name} should not equate stale with failed`);
    assert.doesNotMatch(html, /stale means (the )?(run|job) failed/i, `${name} should not equate stale with failed`);
  }
});

test('missed start is not advertised or described as available anywhere', async () => {
  const files = await allPublicHtml();
  const readme = await rootFile('README.md');
  const productLanguage = await rootFile('docs/product-language.md');
  assert.doesNotMatch(readme, /missed[\s-]?start/i);
  for (const [name, html] of files) {
    assert.doesNotMatch(html, /missed[\s-]?start/i, `${name} should not advertise missed start`);
  }
  // The glossary is allowed to name it explicitly as NOT implemented.
  assert.match(productLanguage, /missed start.*not shipped|not shipped.*missed start|missed_start[\s\S]{0,80}No/i);
});

test('late is never confused with "late start" and is never described as stale', async () => {
  const files = await allPublicHtml();
  for (const [name, html] of files) {
    assert.doesNotMatch(html, /late start/i, `${name} should not use "late start"`);
    assert.doesNotMatch(html, /late (run|job)?\s*(is|means|shown as) stale/i, `${name} should not equate late with stale`);
  }
});

test('heartbeat is never presented as a run status', async () => {
  const files = await allPublicHtml();
  for (const [name, html] of files) {
    assert.doesNotMatch(html, /heartbeat\s+status/i, `${name} should not present heartbeat as a status`);
    assert.doesNotMatch(html, /status:\s*heartbeat/i, `${name} should not present heartbeat as a status`);
  }
});

test('docs.html uses "stage" as the human label for step events, not "step"', async () => {
  const docs = await publicFile('docs.html');
  assert.match(docs, /last reported stage/i);
  assert.doesNotMatch(docs, /last reported step/i);
  assert.match(docs, /Updates the current stage shown on the dashboard/);
});

test('cancelled is never described as failed', async () => {
  const files = await allPublicHtml();
  for (const [name, html] of files) {
    assert.doesNotMatch(html, /cancelled (run|job)?\s*(is|means|shown as) failed/i, `${name} should not equate cancelled with failed`);
  }
  const docs = await publicFile('docs.html');
  assert.match(docs, /Cancelled.{0,80}explicitly sent/is);
});

test('the canonical compact product description appears on landing and README', async () => {
  const [landing, readme] = await Promise.all([publicFile('landing.html'), rootFile('README.md')]);
  assert.match(landing, /Progress-aware monitoring/);
  assert.match(readme, /Progress-aware monitoring for unattended jobs/);
});

test('no prohibited or deprecated phrases appear in public/*.html or README.md', async () => {
  const files = await allPublicHtml();
  const readme = await rootFile('README.md');
  const prohibited = [
    /heartbeat monitor/i,
    /\boverdue\b/i,
    /\bno setup\b/i,
    /team workspace/i,
    /\breal-time\b/i,
    /full observability/i,
    /monitor anything/i,
    /\bAI monitoring\b/i,
    /the only progress-aware/i,
    /knows why the job failed/i,
    /automated card checkout is not live yet/i
  ];
  for (const [name, html] of files) {
    for (const pattern of prohibited) {
      assert.doesNotMatch(html, pattern, `${name} should not contain prohibited phrase: ${pattern}`);
    }
  }
  for (const pattern of prohibited) {
    assert.doesNotMatch(readme, pattern, `README.md should not contain prohibited phrase: ${pattern}`);
  }
});

test('every real public page has a meta description tag', async () => {
  for (const name of PUBLIC_PAGES) {
    const html = await publicFile(name);
    assert.match(html, /<meta name="description" content="[^"]+"/, `${name} should have a meta description`);
  }
});

test('OG and Twitter descriptions match the meta description where present', async () => {
  const pagesWithOg = ['landing.html', 'pricing.html', 'docs.html', 'ai-integration.html', 'security.html', 'privacy.html', 'terms.html', 'contact.html'];
  for (const name of pagesWithOg) {
    const html = await publicFile(name);
    const meta = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
    const og = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
    const twitter = html.match(/<meta name="twitter:description" content="([^"]+)"/)?.[1];
    assert.ok(meta, `${name} should have a meta description`);
    if (og) assert.equal(og, meta, `${name} og:description should match meta description`);
    if (twitter) assert.equal(twitter, meta, `${name} twitter:description should match meta description`);
  }
});

test('what the customer sends is described as "lifecycle events," not "status signal" or "progress signal"', async () => {
  const files = await allPublicHtml();
  for (const [name, html] of files) {
    assert.doesNotMatch(html, /status signal/i, `${name} should say "lifecycle events," not "status signal"`);
    assert.doesNotMatch(html, /progress signals?\b/i, `${name} should say "lifecycle events," not "progress signal"`);
  }
});

test('webhook delivery is described as operator-configured, not self-service', async () => {
  const docs = await publicFile('docs.html');
  const privacy = await publicFile('privacy.html');
  assert.match(docs, /operator has configured an alert webhook/i);
  assert.match(privacy, /configured by the PingStep operator/i);
});

test('pricing and workspace meta descriptions carry a product category, not just billing/CRUD language', async () => {
  const pricing = await publicFile('pricing.html');
  const workspace = await publicFile('workspace.html');
  assert.match(pricing.match(/<meta name="description" content="([^"]+)"/)[1], /Progress-aware monitoring/);
  assert.match(workspace.match(/<meta name="description" content="([^"]+)"/)[1], /Progress-aware monitoring/);
});

test('index.html (runs page) has a meta description and OG-equivalent product framing', async () => {
  const index = await publicFile('index.html');
  assert.match(index, /<meta name="description" content="[^"]+"/);
  assert.match(index, /Progress-aware monitoring for unattended jobs/);
});

test('landing page advertises Late and Cancelled as monitoring states', async () => {
  const landing = await publicFile('landing.html');
  assert.match(landing, /<h3>Late<\/h3>/);
  assert.match(landing, /<h3>Cancelled<\/h3>/);
});

test('i18n has translation keys for late and cancelled run statuses, and no stale checkout string remains', async () => {
  const locale = await publicFile('locales/i18n.js');
  assert.match(locale, /'late':\s*'[^']+'/);
  assert.match(locale, /'cancelled':\s*'[^']+'/);
  assert.doesNotMatch(locale, /Automated card checkout is not live yet/);
});
