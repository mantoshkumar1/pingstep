#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const usage = 'Usage: node bin/pilot-scorecard.js <pilot-evidence.json>';

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function countEvidence(evidence) {
  const conversations = (evidence.conversations ?? []).filter((item) => item.qualified && hasText(item.date) && hasText(item.recent_real_job) && hasText(item.evidence_note));
  const integrations = (evidence.integrations ?? []).filter((item) => item.real_job && hasText(item.date) && hasText(item.observed_run_id) && hasText(item.evidence_note));
  const commitments = (evidence.commitments ?? []).filter((item) => item.explicit && hasText(item.date) && ['paid_pilot', 'switching'].includes(item.type) && hasText(item.alternative) && hasText(item.evidence_note));
  return { conversations: conversations.length, integrations: integrations.length, commitments: commitments.length };
}

export function scorePilot(evidence) {
  const counts = countEvidence(evidence);
  const thresholds = { conversations: 5, integrations: 3, commitments: 2 };
  const success = Object.keys(thresholds).every((key) => counts[key] >= thresholds[key]);
  const status = success ? 'proceed' : evidence.assessment_window_complete ? 'stop_or_reposition' : 'collecting_evidence';
  return {
    status,
    counts,
    thresholds,
    missing: Object.fromEntries(Object.keys(thresholds).map((key) => [key, Math.max(0, thresholds[key] - counts[key])])),
    message: success
      ? 'Pilot success criteria are met. Record the paid-pilot go decision and supporting evidence.'
      : evidence.assessment_window_complete
        ? 'The assessment window closed without meeting all thresholds. Apply the predefined kill criteria; do not infer validation from interest alone.'
        : 'Evidence collection is incomplete. Do not claim pilot validation yet.'
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error(usage);
  const evidence = JSON.parse(await readFile(path, 'utf8'));
  console.log(JSON.stringify(scorePilot(evidence), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
}
