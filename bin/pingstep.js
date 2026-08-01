#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const commands = new Set(['start', 'step', 'heartbeat', 'succeeded', 'failed']);
const usage = `Usage:
  pingstep <start|step|heartbeat|succeeded|failed> --job <job-key> [options]

Required environment:
  PINGSTEP_URL       Base URL, e.g. http://localhost:3000
  PINGSTEP_TOKEN     Job-scoped bearer token

Options:
  --job <key>        Job key (or PINGSTEP_JOB_KEY)
  --run <id>         Run ID; generated for start when omitted
  --sequence <n>     Required for all commands except start (start defaults to 1)
  --name <stage>     Required for step
  --message <text>   Required for failed; optional for heartbeat/succeeded
  --current <n>      Optional step counter
  --total <n>        Optional step total
  --unit <text>      Optional counter unit
  --expected-duration <seconds>  Optional start metadata`;

function fail(message) {
  console.error(`Error: ${message}\n\n${usage}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values[flag.slice(2)] = value;
    index += 1;
  }
  return values;
}

function numberOption(value, name) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number.`);
  return number;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!commands.has(command)) throw new Error('Choose a valid event type.');
  const options = parseArgs(rest);
  const jobKey = options.job ?? process.env.PINGSTEP_JOB_KEY;
  const url = process.env.PINGSTEP_URL;
  const token = process.env.PINGSTEP_TOKEN;
  if (!jobKey) throw new Error('Provide --job or PINGSTEP_JOB_KEY.');
  if (!url) throw new Error('Set PINGSTEP_URL.');
  if (!token) throw new Error('Set PINGSTEP_TOKEN.');

  const runId = options.run ?? (command === 'start' ? randomUUID() : undefined);
  if (!runId) throw new Error('--run is required after start.');
  if (command !== 'start' && options.sequence === undefined) throw new Error('--sequence is required after start.');
  const sequence = options.sequence === undefined ? (command === 'start' ? 1 : undefined) : numberOption(options.sequence, '--sequence');
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('--sequence must be a positive integer.');
  if (command === 'start' && sequence !== 1) throw new Error('start must use sequence 1.');
  if (command === 'step' && !options.name) throw new Error('--name is required for step.');
  if (command === 'failed' && !options.message) throw new Error('--message is required for failed.');

  const data = {};
  if (options.name) data.name = options.name;
  if (options.message) data.message = options.message;
  for (const key of ['current', 'total', 'expected-duration']) {
    if (options[key] !== undefined) data[key === 'expected-duration' ? 'expected_duration_seconds' : key] = numberOption(options[key], `--${key}`);
  }
  if (options.unit) data.unit = options.unit;

  const type = command === 'start' ? 'started' : command;
  const event = { event_id: randomUUID(), job_key: jobKey, run_id: runId, sequence, type, occurred_at: new Date().toISOString(), data };
  const endpoint = new URL('/v1/events', url);
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(event) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `PingStep returned HTTP ${response.status}.`);
  console.log(JSON.stringify({ run_id: runId, sequence, type, accepted: !result.duplicate }));
}

main().catch((error) => fail(error.message));
