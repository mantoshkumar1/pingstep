/**
 * Production-boundary governance checks (issue #194).
 *
 * These assert the *authority model*, not its prose. The model has three
 * deliberately separate layers:
 *
 *   1. Production boundary  — permanent rules protecting `main`.
 *   2. Current operating mode — how things work today; factual and temporary.
 *   3. Delegated integration authority — bounded authority that #197 may later
 *      grant below the production boundary (e.g. merges into `staging`).
 *
 * The tests are written so that founder-approved evolution (#196 identity and
 * approval mechanics, #197 staging/deployment mechanics) stays possible, while
 * any weakening of the production boundary fails. Deterministic and local-only:
 * no GitHub API, so they run in the existing #158 quality gate.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const AGENTS = 'AGENTS.md';
const TEMPLATE = '.github/pull_request_template.md';
const STATE = 'PROJECT-STATE.md';

/** Body of the first heading matching `pattern`, up to the next same-or-higher heading. */
function section(markdown, pattern) {
  const lines = markdown.split('\n');
  const startIndex = lines.findIndex((line) => /^#{2,4}\s/.test(line) && pattern.test(line));
  assert.notEqual(startIndex, -1, `expected a heading matching ${pattern}`);
  const level = lines[startIndex].match(/^#+/)[0].length;
  const rest = lines.slice(startIndex + 1);
  const endIndex = rest.findIndex((line) => {
    const match = line.match(/^(#{2,4})\s/);
    return match && match[1].length <= level;
  });
  return (endIndex === -1 ? rest : rest.slice(0, endIndex)).join('\n');
}

/**
 * Collapse markdown hard-wrapping to single spaces. Governance prose wraps at
 * ~110 columns, so sentence-level assertions must not depend on where a line
 * happens to break.
 */
const flat = (text) => text.replace(/\s+/g, ' ');

/** Top-level bullets, with wrapped continuation lines folded in. */
function bullets(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (/^\s*[-*]\s+\S/.test(line)) out.push(line.trim());
    else if (out.length && line.trim()) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

const productionBoundary = () => section(read(AGENTS), /production boundary\s*[—-]?\s*permanent/i);
const currentMode = () => section(read(AGENTS), /current operating mode/i);
const delegated = () => section(read(AGENTS), /delegated integration authority/i);
const mayChange = () => section(read(AGENTS), /what each issue may change/i);

/** Does this sentence scope itself to the production boundary? */
const scopedToMain = (text) => /`main`|production/i.test(text);

// ── 14. The model itself: permanent authority vs temporary mechanism ──

test('governance separates permanent production authority from temporary mechanism', () => {
  const agents = read(AGENTS);
  assert.ok(productionBoundary().length > 0, 'a permanent production-boundary section must exist');
  assert.ok(currentMode().length > 0, 'a current-operating-mode section must exist');
  assert.ok(delegated().length > 0, 'a delegated-integration-authority section must exist');
  assert.match(agents, /trust boundary/i, 'authority must be described by trust boundary');
  assert.match(currentMode(), /\b(today|current(ly)?)\b/i,
    'the current-operating-mode section must mark itself as current, not permanent');
  assert.match(currentMode(), /not permanent|current facts, not permanent|changeable|change(s)? only through/i,
    'the current-operating-mode section must say it can change');
});

// ── 1-7. The permanent production boundary ──

test('every change into `main` goes through a pull request', () => {
  const text = productionBoundary() + read(AGENTS);
  assert.match(text, /pull request/i);
  assert.match(read(AGENTS), /reach(es)? `main` through a task branch|change targeting `main` terminates at an open|through a pull request/i,
    'reaching `main` must require a pull request');
});

test('no AI role may directly update `main`', () => {
  assert.match(productionBoundary(), /push, commit, edit, or update `main` directly/i);
  assert.match(productionBoundary(), /No AI agent — in any role — may/i,
    'the prohibition must bind every AI role, not one agent type');
});

test('no AI role may merge into `main`', () => {
  // Must be its own prohibition, distinct from the auto-merge rule — otherwise
  // deleting it silently leaves only "no auto-merge", which would permit a
  // deliberate AI merge.
  const merge = bullets(productionBoundary()).filter(
    (line) => /\bmerge\b/i.test(line) && /`main`/.test(line) && !/auto-merge/i.test(line));
  assert.ok(merge.length >= 1,
    'the production boundary must prohibit merging into `main` in its own right, separate from auto-merge');
  assert.match(read(TEMPLATE), /No AI agent may\*{0,2} merge \*{0,2}into `main`/i,
    'the PR template must carry the same prohibition');
});

test('no AI role may enable or queue auto-merge into `main`', () => {
  assert.match(productionBoundary(), /auto-merge into `main`/i,
    'auto-merge into `main` must be prohibited explicitly');
  assert.match(productionBoundary(), /without the founder\s+acting|queue/i,
    'queueing a merge must be treated as bypassing the founder');
  assert.match(read(TEMPLATE), /auto-merge into `main`/i, 'the PR template must carry it too');
});

test('no AI role may use any bypass capability against `main`', () => {
  const text = productionBoundary();
  for (const surface of ['administrator', 'branch-protection', 'ruleset', 'API', 'CLI', 'credential']) {
    assert.match(text, new RegExp(surface, 'i'), `${surface} must be named as a prohibited bypass surface`);
  }
  assert.match(flat(text), /bypass capability to update `main` or merge into `main`/i);
  assert.match(text, /never as permission to use the capability/i,
    'a permissive setting must be reported, never used');
});

test('the founder alone performs the final merge into `main`', () => {
  assert.match(productionBoundary(), /Only the founder performs the final Merge action into `main`/i);
  assert.match(read(TEMPLATE), /Only the founder performs the final Merge action into `main`/i);
});

test('AI work targeting `main` terminates at an open, review-ready pull request', () => {
  assert.match(flat(productionBoundary()),
    /Every AI-created change targeting `main` terminates at an open,\s+review-ready pull request/i);
  assert.match(productionBoundary(), /final state an AI agent may leave such a change in/i,
    'the open PR must be stated as the terminal state for `main`-targeted work');
  assert.match(read(TEMPLATE), /targeting `main` must end at an open, review-ready PR/i);
});

test('review-clean is quality evidence, not production authorization', () => {
  assert.match(flat(productionBoundary()), /review-clean is quality evidence, not\s+production\s+authorization/i);
  assert.match(read(TEMPLATE), /quality evidence, not production authorization/i);
});

// ── The scoping invariant that keeps #197 possible ──

test('permanent prohibitions are scoped to the production boundary, not to all merging', () => {
  // A blanket "AI may never merge anything" would freeze today's mechanics into
  // permanent architecture and put this file in conflict with #197, which may
  // grant bounded merge authority for `staging`. Every prohibition in the
  // permanent section must therefore name `main`/production.
  const unscoped = bullets(productionBoundary()).filter((line) => !scopedToMain(line));
  assert.deepEqual(unscoped, [],
    `these permanent prohibitions are not scoped to the production boundary:\n${unscoped.join('\n')}`);
});

/**
 * Merge-authority language, classified.
 *
 * A statement about who may merge must fall into exactly one of three
 * categories, with no ambiguous fourth:
 *
 *   1. permanent production authority — scoped to `main`/production;
 *   2. current operating mode — explicitly marked as today's temporary setup;
 *   3. deferred future mechanism — about `staging`/#197 delegation.
 *
 * The check is CLAUSE-aware on purpose. Authority distributes across
 * coordinated clauses, so "AI may not update `main` or merge a PR" scopes only
 * its first clause while leaving merge authority blanket. Sentence-level
 * matching accepts that; clause-level matching rejects it.
 */
const MERGE_VERB = /\bmerge(s|d|r)?\b|\bmerging\b|\bauto-merge\b/i;
const AUTHORITY = /\b(never|must not|may not|cannot|no AI agent|stops? before|stopping before|stays? disabled|must stay disabled|only the founder|performs the final)\b/i;
const CURRENCY = /\b(today|currently|current operating mode|current setup|temporar(y|ily)|not permanent|for now|nowhere)\b/i;
const LOWER_BOUNDARY = /staging|delegated|integration branch|#197|issues\/197/i;

/**
 * The dangerous shape: a merge prohibition whose OBJECT is generic — bare
 * "merge", or "merge a PR"/"pull requests"/"auto-merge" with no boundary. A
 * back-reference such as "merges it" or "that merge" inherits the scope its
 * sentence already established and is not blanket.
 */
const BLANKET_MERGE = /(?<!\b(?:that|this|the|a|its|such|final|founder's)\s)\bmerges?\b\s*[.;:!]*\s*$|\bmerge\s+(a\s+|any\s+|the\s+)?(PR|PRs|pull requests?)\b|\bauto-merge\b(?!\s+into)/i;

/** Split markdown into bullets and paragraphs, skipping headings. */
function governanceBlocks(markdown) {
  const out = [];
  for (const chunk of markdown.split(/\n\s*\n/)) {
    const withoutHeadings = chunk.split('\n').filter((line) => !/^\s*#{1,6}\s/.test(line)).join('\n');
    const bulleted = bullets(withoutHeadings);
    if (bulleted.length) out.push(...bulleted);
    else if (withoutHeadings.trim()) out.push(flat(withoutHeadings));
  }
  return out.map((block) => flat(block));
}

/** Merge-authority clauses that fall into no category. */
function unclassifiedMergeClauses(file, markdown = read(file)) {
  const findings = [];
  for (const block of governanceBlocks(markdown)) {
    // A block may declare itself as today's operating mode; blanket statements
    // are legitimate there because they describe a temporary stricter setup.
    const blockIsCurrentMode = /current operating mode/i.test(block.slice(0, 140));
    for (const sentence of block.split(/(?<=[.;:])\s+/)) {
      if (!MERGE_VERB.test(sentence) || !AUTHORITY.test(sentence)) continue;
      for (const clause of sentence.split(/,|\bor\b|\band\b|;|—/)) {
        if (!BLANKET_MERGE.test(clause)) continue;
        const classified = scopedToMain(clause) || LOWER_BOUNDARY.test(clause)
          || CURRENCY.test(clause) || blockIsCurrentMode;
        if (!classified) findings.push(`${file}: "${clause.trim().slice(0, 110)}"`);
      }
    }
  }
  return findings;
}

test('every merge-authority clause is classified as permanent, current-mode, or deferred', () => {
  // Note: pass an explicit arrow — flatMap would otherwise supply the array
  // index as the second argument and clobber the markdown parameter.
  const findings = [AGENTS, TEMPLATE, STATE].flatMap((file) => unclassifiedMergeClauses(file));
  assert.deepEqual(findings, [],
    `these merge-authority clauses are neither scoped to \`main\`, marked as current operating mode, nor about `
    + `delegated/staging authority:\n${findings.join('\n')}`);
});

test('the classifier rejects each real-world blanket phrasing the review identified', () => {
  // Proves the scanner has teeth against the exact forms that slipped through
  // before. Each synthetic document must produce at least one finding.
  for (const text of [
    'No AI agent may merge.',
    'AI agents must not merge PRs.',
    'AI agents stop before merge and wait for the founder.',
    'No AI agent may update `main` directly or merge a PR.',
    'Auto-merge must stay disabled.',
    'The founder performs every merge manually; no AI agent may merge.'
  ]) {
    assert.ok(unclassifiedMergeClauses('synthetic', text).length > 0,
      `the classifier must reject: "${text}"`);
  }
  // ...and accept statements that are properly classified.
  for (const text of [
    'No AI agent may merge into `main`.',
    'AI agents stop before merging into `main`.',
    'Current operating mode: the founder performs every merge manually and auto-merge stays disabled everywhere.',
    'Today AI merges nowhere at all.',
    '#197 may later grant bounded merge authority for pull requests into `staging`.',
    'Even when review-clean, no AI agent merges it into `main` — the founder performs that merge.'
  ]) {
    assert.deepEqual(unclassifiedMergeClauses('synthetic', text), [],
      `the classifier must accept: "${text}"`);
  }
});

test('the PR template distinguishes permanent `main` merge rules from today\'s stricter mode', () => {
  const guidance = section(read(TEMPLATE), /merge guidance/i);
  assert.match(flat(guidance), /\*\*Permanent:\*\*[^.]*targeting `main`/i,
    'the template must state the permanent `main` rule');
  assert.match(flat(guidance), /\*\*Current operating mode:\*\*[^.]*pull request stops for the founder/i,
    'the template must mark today\'s all-PRs rule as current operating mode');
  assert.match(flat(guidance), /#197|issues\/197/,
    'the template must name #197 as the possible future delegation');
});

test('no governance file states an unqualified "AI never merges any pull request" rule', () => {
  // Guards against regressing to prose that would forbid future staging authority.
  // Only sentences that actually govern an AI actor's merge authority are
  // examined — merge-status guidance such as "do not merge yet" has no AI
  // subject and is not an authority rule.
  const AI_SUBJECT = /\b(AI agent|AI agents|no AI|any AI|agents? (?:must|may)|ChatGPT|Claude|Codex)\b/i;
  const PROHIBITION = /\b(never|must not|may not|cannot|forbidden|prohibited)\b/i;
  for (const file of [AGENTS, TEMPLATE, STATE]) {
    for (const raw of flat(read(file)).split(/(?<=[.;])\s+/)) {
      if (!/\bmerge(s|d|r)?\b|\bmerging\b|\bauto-merge\b/i.test(raw)) continue;
      if (!AI_SUBJECT.test(raw) || !PROHIBITION.test(raw)) continue;
      // A sentence that already names the lower boundary is about delegated
      // authority, which is allowed to be discussed without `main`.
      if (/staging|integration|delegated|#197|issues\/197/i.test(raw)) continue;
      assert.ok(scopedToMain(raw),
        `${file}: AI merge prohibition is not scoped to a boundary -> "${raw.trim().slice(0, 140)}"`);
    }
  }
});

// ── 9-11. Current operating mode ──

test('the 0-approval count is recorded as conditional, and lives in the current-mode section', () => {
  const mode = currentMode();
  assert.match(mode, /required approving reviews[^.]*\b0\b/i, 'the current count must be recorded');
  assert.match(mode, /\b(while|as long as|under)\b[^.]*(founder|shared)[^.]*identity/i,
    'the count must be scoped to the shared-identity condition');
  assert.match(mode, /conditional[^.]*not permanent/i, 'the count must be marked conditional, not permanent');
  // Classification matters: if it sat in the permanent section it would read as
  // architecture and block #196.
  assert.doesNotMatch(productionBoundary(), /required approving reviews/i,
    'the approval count must not be recorded as a permanent production-boundary rule');
});

test('current operating mode prohibits AI merges everywhere until a founder-approved change', () => {
  const mode = currentMode();
  assert.match(mode, /AI merges nowhere/i, 'today AI must merge nowhere');
  assert.match(mode, /enables auto-merge nowhere/i, 'today AI must enable auto-merge nowhere');
  assert.match(mode, /no long-lived integration branch|no such branch exists/i,
    'the reason must be recorded: no delegated-authority branch exists yet');
  assert.match(flat(mode), /consequence of the current setup, not an additional permanent limitation/i,
    'this must be framed as a consequence of today, not permanent architecture');
});

test('deployment triggers are recorded as current mechanism, not eternal architecture', () => {
  const release = section(read(AGENTS), /release rules/i);
  assert.match(release, /current mechanism|As things stand \*{0,2}today\*{0,2}|today/i,
    'release rules must be marked as current');
  assert.match(release, /currently deploys \*{0,2}only\*{0,2} to staging|currently go only through/i,
    'current deployment facts must be worded as current');
  assert.match(release, /#197|issues\/197/,
    'release rules must name #197 as able to revise the trigger');
  assert.match(flat(release), /change the trigger, not who authorizes it/i,
    'changing a deployment trigger must not be confused with changing authority');
});

// ── 10, 12, 13. Evolution boundaries ──

test('#196 may change identity and approval mechanics but not production authority', () => {
  const scope = mayChange();
  assert.match(flat(scope), /#196[^.]*identity and approval mechanics/i);
  assert.match(flat(scope), /#196[\s\S]{0,300}must not change production\s+authority/i,
    '#196 must be barred from changing production authority');
});

test('#197 may grant bounded AI merge authority for `staging`', () => {
  const text = delegated();
  assert.match(text, /#197|issues\/197/, '#197 must be named as the owner');
  assert.match(flat(text), /bounded merge authority[^.]*into `staging`/i,
    '#197 must be permitted to grant bounded staging merge authority');
  assert.match(text, /deferred and not in force|deliberately\s+deferred/i,
    'the delegated authority must be marked deferred, not active');
  assert.match(text, /after\s+\[?#196|only after[\s\S]{0,80}#196/i,
    'staging authority must depend on #196 identity separation first');
});

test('delegated staging authority can never promote directly to `main`', () => {
  const text = delegated();
  assert.match(flat(text), /no delegated integration authority may ever extend to `main`/i,
    'the hard limit must be explicit');
  assert.match(flat(text), /still requires a founder-merged promotion pull request/i,
    'reaching `staging` must not imply reaching production');
  assert.match(flat(mayChange()), /#197[^.]*(integration and deployment mechanics)/i);
  assert.match(flat(mayChange()), /#197[\s\S]{0,300}must not change production\s+authority/i,
    '#197 must be barred from changing production authority');
});

test('neither #196 nor #197 may weaken the production boundary without a new founder decision', () => {
  const scope = mayChange();
  assert.match(scope, /Neither may weaken the production boundary/i);
  assert.match(scope, /adjustable mechanism/i,
    'the adjustable-vs-permanent distinction must be explicit');
  assert.match(scope, /requires a new explicit founder decision/i,
    'weakening the boundary must require a fresh founder decision');
});

// ── Durable state and role coverage ──

test('durable project state records the production boundary and its current mode', () => {
  const state = read(STATE);
  assert.match(state, /pull request/i);
  assert.match(state, /merge into `main`|merge pull requests into `main`|final merge/i,
    'PROJECT-STATE.md must record founder-only merge into `main`');
  assert.match(state, /#197|issues\/197/, 'PROJECT-STATE.md must reference the deferred #197 architecture');
});

test('the invariants bind every AI role, including strategy/review agents', () => {
  const agents = read(AGENTS);
  assert.match(agents, /ChatGPT/i, 'strategy/review agents must be named');
  assert.match(agents, /Claude and Codex|Claude\/Codex/i, 'implementation agents must be named');
  assert.match(read(TEMPLATE), /every\*{0,2} AI role/i, 'the PR template must bind every AI role');
});

test('AI agents may create the full range of repository artifacts', () => {
  // Without this, "no merging" can be misread as "do nothing".
  const text = productionBoundary();
  for (const allowed of ['issues', 'branches', 'commits', 'pull requests', 'comments', 'reviews', 'tests', 'evidence']) {
    assert.match(text, new RegExp(`may\\*{0,2}[^.]*${allowed}`, 'i'),
      `AGENTS.md must state that AI agents may create ${allowed}`);
  }
});

test('the `mantosh-ai-bot` migration is recorded as founder-approved and deferred, not optional', () => {
  // #196 is authoritative: the account exists, migration is founder-approved,
  // deferred, and does not block #194. Recording it as "optional" or as a
  // pending recommendation would misstate a settled founder decision.
  const state = flat(read(STATE));
  assert.match(state, /mantosh-ai-bot/, 'the machine identity must be named');
  assert.match(state, /founder-approved and\s*intentionally deferred|founder-approved[^.]{0,60}deferred/i,
    'the migration must be recorded as founder-approved and deferred');
  assert.match(state, /does not block #194/i, 'the state must record that #196 does not block #194');

  // It must not be demoted to optional or to an unapproved recommendation
  // anywhere in the file — check every block that discusses the identity.
  // Negated forms ("not optional", "no longer a recommendation") are the
  // correct wording, so strip them before looking for a demotion.
  const withoutNegations = (block) => block
    .replace(/\bnot\s+(an?\s+)?(optional|pending recommendation|recommendation)[^,.;]*/gi, '')
    .replace(/\bno longer a recommendation[^,.;]*/gi, '');
  const demoted = governanceBlocks(read(STATE))
    .filter((block) => /mantosh-ai-bot|machine[- ](account|identity)/i.test(block))
    .filter((block) => /\boptional\b|merely a recommendation|recommended route|awaiting founder approval/i
      .test(withoutNegations(block)));
  assert.deepEqual(demoted, [],
    `the founder-approved migration is described as optional/recommended here:\n${demoted.join('\n')}`);

  // Structural guard: it must not sit under recommendations awaiting approval.
  const awaiting = section(read(STATE), /recommendations awaiting founder approval/i);
  assert.doesNotMatch(awaiting, /mantosh-ai-bot|machine[- ](account|identity)/i,
    'the approved migration must not be listed as a recommendation awaiting founder approval');
});

test('the founder merge remains the automatic issue-closure event', () => {
  // Closing-keyword mechanics are owned by issue-closure-governance.test.js (#190);
  // only the #194-specific link is asserted here.
  assert.match(read(AGENTS), /close that issue automatically when the founder merges/i);
});
