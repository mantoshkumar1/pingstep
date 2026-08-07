import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

test('PR template requires automatic issue closure for full completion and non-closing refs for partial work', () => {
  const template = read('.github/pull_request_template.md');

  assert.match(template, /\*\*Issue closure:\*\*/i,
    'PR template must expose an explicit issue-closure field');
  assert.match(template, /`Closes #<issue>`/,
    'full-completion PRs must use a GitHub closing keyword');
  assert.match(template, /`Refs #<issue>[^`]*partial[^`]*issue remains open`/i,
    'partial PRs must use a non-closing issue reference and keep the issue open');
  assert.match(template, /merging to `main` must auto-close it/i,
    'template must explain that merge drives automatic issue closure');
  assert.match(template, /do \*\*not\*\* use a closing keyword for partial work/i,
    'template must forbid closing keywords on partial work');
});

test('agent handbook makes merge the normal issue-closure event', () => {
  const agents = read('AGENTS.md');

  assert.match(agents, /^## Issue closure on merge$/mi,
    'AGENTS.md must contain the issue-closure-on-merge rule');
  assert.match(agents, /`Closes #<issue>`/,
    'AGENTS.md must require a closing keyword for full-completion PRs');
  assert.match(agents, /`Refs #<issue>`/,
    'AGENTS.md must require a non-closing reference for partial PRs');
  assert.match(agents, /merge is the normal\s+closure event/i,
    'AGENTS.md must define merge as the normal closure event');
  assert.match(agents, /verify that GitHub closed the issue automatically/i,
    'agents must verify automatic closure after merge');
});

test('the template uses placeholders, not a concrete issue number that could close an unrelated issue', () => {
  const template = read('.github/pull_request_template.md');

  assert.match(template, /Closes #<issue>/,
    'the template must keep the closing reference as a non-numeric placeholder');
  assert.doesNotMatch(template, /\bCloses\s+#\d+\b/i,
    'the template itself must never contain a concrete auto-closing issue number');
});
