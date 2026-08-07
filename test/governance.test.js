/**
 * Structural governance checks for issue #188.
 *
 * These are deterministic, local-only assertions: they read repository files
 * and never call the GitHub API, so they can run in any sandbox and in the
 * existing #158 quality gate (`npm test`) without adding a competing pipeline.
 *
 * They verify STRUCTURE, not semantic freshness — a human-readable timestamp
 * being old is a review concern, not a CI failure.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const PROJECT_STATE = 'PROJECT-STATE.md';
const AGENTS = 'AGENTS.md';
const CLAUDE = 'CLAUDE.md';
const README = 'README.md';
const PR_TEMPLATE = '.github/pull_request_template.md';
const GOVERNANCE_FILES = [PROJECT_STATE, AGENTS, CLAUDE, README, PR_TEMPLATE];

/** GitHub-compatible heading slug, for validating in-repo anchor links. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => slugify(line.replace(/^#{1,6}\s+/, '')));
}

// ── Deliverable 1: the shared project entry point exists and is complete ──

test('PROJECT-STATE.md exists at the repository root', () => {
  assert.ok(existsSync(join(ROOT, PROJECT_STATE)), 'PROJECT-STATE.md must exist at the repository root');
});

test('PROJECT-STATE.md contains every required section from #188', () => {
  const content = read(PROJECT_STATE);
  const required = [
    'Purpose and product objective',
    'How to continue this project',
    'Authority hierarchy',
    'Current launch status',
    'Active issue, pull request, branch, and commit',
    'Current implementation owner',
    'Recently completed work',
    'Settled decisions and authoritative links',
    'Testing and merge contract',
    'Known risks and blockers',
    'Manual or provider actions required',
    'Deferred and optional work',
    'Exact next action',
    'State-update rules',
    'Last verified date, verifier, and source commit'
  ];
  for (const section of required) {
    assert.match(content, new RegExp(`^#{1,4}\\s+.*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'mi'),
      `PROJECT-STATE.md is missing the required section: ${section}`);
  }
});

test('PROJECT-STATE.md separates founder-approved decisions from findings, recommendations, and open questions', () => {
  const content = read(PROJECT_STATE);
  // Amendment (2026-08-06): these categories must never be blurred together,
  // so an AI recommendation can never read as founder policy.
  for (const label of [
    'Founder-approved settled decisions',
    'Current factual implementation state',
    'Review findings',
    'Recommendations awaiting founder approval',
    'Unresolved questions'
  ]) {
    assert.ok(content.includes(label), `PROJECT-STATE.md must distinguish "${label}"`);
  }
});

test('PROJECT-STATE.md records a verified date, verifier, and source commit', () => {
  // Markdown emphasis around the labels must not defeat the check.
  const content = read(PROJECT_STATE).replace(/\*/g, '');
  assert.match(content, /Last verified:\s*\d{4}-\d{2}-\d{2}/i, 'a verified date is required');
  assert.match(content, /Verified by:\s*\S+/i, 'a verifier is required');
  assert.match(content, /Source commit:\s*`?[0-9a-f]{7,40}`?/i, 'a source commit is required');
});

test('PROJECT-STATE.md states that live GitHub state outranks the snapshot', () => {
  assert.match(read(PROJECT_STATE), /live github state (always )?outranks|outranks this snapshot/i,
    'the snapshot must defer to live GitHub state');
});

/**
 * Secret-like value detector. Secret *names* (E2E_CONTROL_TOKEN) and
 * documentation *placeholders* (`Bearer your-secret-token`) are legitimate;
 * only concrete credential material is forbidden.
 */
const PLACEHOLDER = /^(your|my|the|<|\{|\$|example|sample|test|dummy|placeholder|redacted|xxx|abc|token|secret|changeme)/i;

export function findSecretLike(content) {
  const findings = [];
  const rules = [
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, label: 'private key block' },
    { pattern: /\bsk_(live|test)_[A-Za-z0-9]{8,}/g, label: 'Stripe secret key' },
    { pattern: /\bghp_[A-Za-z0-9]{20,}/g, label: 'GitHub personal access token' },
    { pattern: /\b[0-9a-f]{32,}\b/gi, label: 'long hex secret-like value' }
  ];
  for (const { pattern, label } of rules) {
    for (const match of content.matchAll(pattern)) findings.push(`${label}: ${match[0].slice(0, 12)}…`);
  }
  // Bearer values are only a finding when they do not look like a placeholder.
  for (const match of content.matchAll(/\bBearer\s+([A-Za-z0-9._-]{12,})/g)) {
    if (!PLACEHOLDER.test(match[1])) findings.push(`bearer token value: ${match[1].slice(0, 12)}…`);
  }
  return findings;
}

test('the secret detector actually catches credential material (guard self-check)', () => {
  // A scanner that never fires is not evidence. Prove it fires on real shapes.
  assert.deepEqual(findSecretLike('token: ghp_abcdefghijklmnopqrstuvwxyz0123').length, 1);
  assert.deepEqual(findSecretLike('key sk_live_51H8xyzABCDEFG').length, 1);
  assert.deepEqual(findSecretLike('authorization: Bearer 9f8e7d6c5b4a39281706').length, 1);
  assert.deepEqual(findSecretLike(`-----BEGIN RSA PRIVATE KEY-----`).length, 1);
  assert.deepEqual(findSecretLike('c2f4a9e1b8d7c6a5f4e3d2c1b0a99887').length, 1, '32-char hex must be caught');
  // ...and stays quiet for legitimate names and documentation placeholders.
  assert.deepEqual(findSecretLike('Set E2E_CONTROL_TOKEN via wrangler secret put'), []);
  assert.deepEqual(findSecretLike('curl -H "authorization: Bearer your-secret-token"'), []);
  assert.deepEqual(findSecretLike('commit `2a0e5ab` on main'), []);
});

test('governance files contain no secrets or credential material', () => {
  for (const file of GOVERNANCE_FILES) {
    assert.deepEqual(findSecretLike(read(file)), [], `${file} appears to contain credential material`);
  }
});

// ── Deliverable 2: agent discovery pointers ──

test('AGENTS.md requires reading PROJECT-STATE.md before acting', () => {
  const content = read(AGENTS);
  assert.match(content, /PROJECT-STATE\.md/, 'AGENTS.md must point to PROJECT-STATE.md');
  assert.match(content, /read\s+\[?`?\.?\/?PROJECT-STATE\.md`?\]?[^\n]*completely/i,
    'AGENTS.md must require reading PROJECT-STATE.md completely');
});

test('CLAUDE.md is a thin pointer to PROJECT-STATE.md and AGENTS.md', () => {
  const content = read(CLAUDE);
  assert.match(content, /PROJECT-STATE\.md/, 'CLAUDE.md must point to PROJECT-STATE.md');
  assert.match(content, /AGENTS\.md/, 'CLAUDE.md must point to AGENTS.md');
  const lines = content.split('\n').filter((line) => line.trim()).length;
  assert.ok(lines <= 40, `CLAUDE.md must stay a thin pointer (found ${lines} non-empty lines, limit 40)`);
});

test('the first visible README block points humans and agents to PROJECT-STATE.md', () => {
  const content = read(README);
  const pointerIndex = content.indexOf('PROJECT-STATE.md');
  assert.notEqual(pointerIndex, -1, 'README must reference PROJECT-STATE.md');
  // The pointer must precede ordinary product documentation.
  for (const laterHeading of ['## Safe release path', '## Validation artifacts', '## Event-ingestion service']) {
    const headingIndex = content.indexOf(laterHeading);
    if (headingIndex !== -1) {
      assert.ok(pointerIndex < headingIndex,
        `the PROJECT-STATE.md pointer must appear before "${laterHeading}"`);
    }
  }
  assert.match(content, /^#{1,3}\s+AI project continuation/mi,
    'README must contain an "AI project continuation" section');
});

test('README exposes the copyable start prompt and BOTH role-specific closeout prompts', () => {
  const content = read(README);
  // Amendment (2026-08-06/07): role-specific closeout prompts supersede the
  // earlier single generic closeout instruction.
  assert.match(content, /Continue PingStep from https:\/\/github\.com\/mantoshkumar1\/pingstep\./,
    'README must contain the copyable session start prompt');
  assert.match(content, /Close out this PingStep strategy and review session\./,
    'README must contain the strategy/review closeout prompt');
  assert.match(content, /Close out this PingStep implementation session\./,
    'README must contain the Claude/Codex implementation closeout prompt');
  assert.match(content, /Do not make or reinterpret product decisions\./,
    'the implementation closeout prompt must withhold product-decision authority');
  // Each prompt must be inside a fenced code block so it can be copied verbatim.
  const fenced = [...content.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const prompt of ['Continue PingStep from', 'Close out this PingStep strategy and review session', 'Close out this PingStep implementation session']) {
    assert.ok(fenced.some((block) => block.includes(prompt)),
      `the prompt starting "${prompt}" must be in a copyable fenced code block`);
  }
});

test('README states the founder / strategy / implementation authority split', () => {
  const content = read(README);
  const section = content.slice(0, content.indexOf('## Safe release path'));
  assert.match(section, /sole product and priority decision authority/i, 'founder authority must be stated');
  assert.match(section, /strategy\/review agents?/i, 'the strategy/review role must be stated');
  assert.match(section, /implementation agents?/i, 'the implementation role must be stated');
});

// ── Drift guard: agent files must not re-acquire mutable project facts ──

test('agent-specific files do not reintroduce mutable prices, plan tables, or an active-task ledger', () => {
  for (const file of [AGENTS, CLAUDE]) {
    const content = read(file);
    assert.doesNotMatch(content, /\$\s?\d+\s*(\/|\bper\b)\s*(mo|month)/i,
      `${file} must not contain plan prices (they drift; pricing is owned by its own issue)`);
    assert.doesNotMatch(content, /\|\s*(trial|pro|team)\s*\|/i,
      `${file} must not contain a plan/price table`);
    assert.doesNotMatch(content, /Todo\s*,\s*In Progress\s*,?\s*(or|and)?\s*Done/i,
      `${file} must not enumerate Project board columns (owned by #181 and the board itself)`);
    assert.doesNotMatch(content, /^#{1,6}\s*(active (issue|pull request|branch)|current task|exact next action)/mi,
      `${file} must not maintain an active-task ledger (that belongs in PROJECT-STATE.md)`);
    assert.doesNotMatch(content, /\b(PR|pull request)\s*#\d+/i,
      `${file} must not reference specific active pull requests`);
  }
});

// ── Deliverable 4: requirement-to-evidence PR contract ──

test('the PR template contains scope, requirement-to-evidence, risk, and state-handoff sections', () => {
  const content = read(PR_TEMPLATE);
  for (const section of ['Scope', 'Requirement-to-evidence matrix', 'Risk and compatibility', 'State handoff']) {
    assert.match(content, new RegExp(`^#{1,4}\\s+.*${section}`, 'mi'),
      `the PR template is missing the "${section}" section`);
  }
  // The matrix must be a real table with the required columns.
  assert.match(content, /\|\s*Requirement or acceptance criterion\s*\|/i, 'the evidence matrix table header is required');
  assert.match(content, /\|\s*Automated test \/ CI evidence\s*\|/i, 'the automated-evidence column is required');
  assert.match(content, /\|\s*Manual, staging, or provider evidence\s*\|/i, 'the manual/staging/provider column is required');
  assert.match(content, /PROJECT-STATE\.md/, 'the state-handoff section must reference PROJECT-STATE.md');
  assert.match(content, /Not applicable/i, 'the template must require a reason for Not applicable');
});

test('the PR template requires mapping evidence against issue amendments, not just the body', () => {
  // Amendment (2026-08-07): the issue body plus every amendment comment forms
  // the authoritative scope, so the PR must carry an explicit field naming the
  // amendments covered — a passing mention of the word is not enough.
  const content = read(PR_TEMPLATE);
  assert.match(content, /^\s*[-*]\s*\*\*Amendments covered:\*\*/mi,
    'the PR template must contain an explicit "Amendments covered:" field');
  assert.match(content, /body\s*\*\*and every amendment comment\*\*|body and every amendment comment/i,
    'the template must state that the body plus every amendment forms the authoritative scope');
});

test('the PR template reflects the quality contract rules that reviews of #187 exposed', () => {
  const content = read(PR_TEMPLATE);
  assert.match(content, /in-memory mocks/i, 'critical D1 behavior must not be accepted on mocks alone');
  assert.match(content, /regression test/i, 'defects must receive regression tests');
  assert.match(content, /redefining it|rather than redefining/i, 'tests must not redefine the requirement');
  assert.match(content, /reachable/i, 'promised actions must be reachable through the intended surface');
  assert.match(content, /exit code|externally observable/i, 'failure propagation must be verified');
});

// ── Deliverable 5: local link integrity ──

test('local Markdown links in the governance files resolve to real files and headings', () => {
  const broken = [];
  for (const file of GOVERNANCE_FILES) {
    const content = read(file);
    const fileDir = dirname(join(ROOT, file));
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
      const [path, anchor] = target.split('#');
      if (!path) {
        // Same-file anchor.
        if (anchor && !headingSlugs(content).includes(anchor)) broken.push(`${file} -> #${anchor} (no such heading)`);
        continue;
      }
      const resolved = resolve(fileDir, path);
      if (!existsSync(resolved)) {
        broken.push(`${file} -> ${target} (missing file)`);
        continue;
      }
      if (anchor && resolved.endsWith('.md')) {
        const slugs = headingSlugs(readFileSync(resolved, 'utf8'));
        if (!slugs.includes(anchor)) broken.push(`${file} -> ${target} (no such heading)`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken local governance links:\n${broken.join('\n')}`);
});

// ── Deliverable 6: start/end handoff protocol is recorded ──

test('AGENTS.md records the start-of-work and end-of-work protocol', () => {
  const content = read(AGENTS);
  assert.match(content, /^#{1,4}\s+start of work/mi, 'a start-of-work protocol is required');
  assert.match(content, /^#{1,4}\s+end of work/mi, 'an end-of-work protocol is required');
  assert.match(content, /not handed off merely because an agent wrote a chat summary|chat summar/i,
    'chat summaries must be explicitly non-authoritative');
});

test('AGENTS.md records the quality contract and the review lessons from #187', () => {
  const content = read(AGENTS);
  assert.match(content, /^#{1,4}\s+quality contract/mi, 'the quality contract must be recorded');
  assert.match(content, /not redefine it|redefine the requirement/i, 'tests must prove the authoritative contract');
  assert.match(content, /reachable through the intended surface/i, 'promised actions must be reachable');
  assert.match(content, /failure propagation/i, 'failure propagation must be part of correctness');
  assert.match(content, /not authoritative evidence|summaries are not authoritative/i,
    'implementation summaries must be classified as non-authoritative');
  assert.match(content, /in-memory mocks/i, 'critical database behavior must not rely on mocks alone');
});

test('AGENTS.md documents PROJECT-STATE.md write ownership between agent roles', () => {
  const content = read(AGENTS);
  assert.match(content, /write ownership/i, 'state-file write ownership must be documented');
  assert.match(content, /must not push into an implementation branch|ownership is explicitly transferred/i,
    'the strategy/review agent must not push into an implementation branch');
});
