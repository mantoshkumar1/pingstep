import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('CLI sends an explicit start event and prints its generated run ID', async (t) => {
  try {
    await withServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const event = JSON.parse(raw);
    assert.equal(request.headers.authorization, 'Bearer local-token');
    assert.equal(event.job_key, 'nightly-export');
    assert.equal(event.type, 'started');
    assert.equal(event.sequence, 1);
    response.writeHead(202, { 'content-type': 'application/json' }); response.end('{"duplicate":false}');
    }, async (url) => {
    const { stdout } = await execFileAsync('node', ['bin/pingstep.js', 'start', '--job', 'nightly-export'], { cwd: process.cwd(), env: { ...process.env, PINGSTEP_URL: url, PINGSTEP_TOKEN: 'local-token' } });
    const result = JSON.parse(stdout);
    assert.match(result.run_id, /^[0-9a-f-]{36}$/);
    assert.equal(result.accepted, true);
    });
  } catch (error) {
    if (error.code === 'EPERM') t.skip('This sandbox does not permit loopback listeners.');
    else throw error;
  }
});

test('CLI requires a sequence and step name after start', async () => {
  await assert.rejects(() => execFileAsync('node', ['bin/pingstep.js', 'step', '--job', 'nightly-export', '--run', 'run-1'], { cwd: process.cwd(), env: { ...process.env, PINGSTEP_URL: 'http://127.0.0.1:1', PINGSTEP_TOKEN: 'local-token' } }), /--sequence is required/);
});
