import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePilot } from '../bin/pilot-scorecard.js';

const conversation = (index) => ({ partner_alias: `DP-${index}`, date: '2026-08-01', qualified: true, recent_real_job: 'nightly export', evidence_note: 'Checked logs during a recent run.' });
const integration = (index) => ({ partner_alias: `DP-${index}`, date: '2026-08-01', real_job: true, observed_run_id: `run-${index}`, evidence_note: 'Observed in PingStep.' });
const commitment = (index) => ({ partner_alias: `DP-${index}`, date: '2026-08-01', type: 'paid_pilot', explicit: true, alternative: 'cron log checks', evidence_note: 'Agreed to paid pilot at stated range.' });

test('refuses to claim validation from incomplete evidence', () => {
  assert.equal(scorePilot({ conversations: [conversation(1)], integrations: [], commitments: [] }).status, 'collecting_evidence');
});

test('returns proceed only when every pilot threshold is evidenced', () => {
  const result = scorePilot({ conversations: [1, 2, 3, 4, 5].map(conversation), integrations: [1, 2, 3].map(integration), commitments: [1, 2].map(commitment) });
  assert.equal(result.status, 'proceed');
  assert.deepEqual(result.missing, { conversations: 0, integrations: 0, commitments: 0 });
});

test('returns stop or reposition only after the assessment window closes', () => {
  assert.equal(scorePilot({ assessment_window_complete: true, conversations: [], integrations: [], commitments: [] }).status, 'stop_or_reposition');
});
