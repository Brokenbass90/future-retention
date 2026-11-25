// The studio keeps building previews when the Node binary it started on is
// removed while it runs (nvm upgrade/uninstall) — falls back to `node` on PATH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-node-'));
const nodeCopy = path.join(tmp, 'node');
fs.copyFileSync(process.execPath, nodeCopy);
fs.chmodSync(nodeCopy, 0o755);
const port = 3900 + Math.floor(Math.random() * 90);
const child = spawn(nodeCopy, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), STUDIO_AI_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
try {
  for (let i = 0; i < 60 && !/running on/.test(log); i += 1) await new Promise((r) => setTimeout(r, 250));
  assert.match(log, /running on/, 'studio started');
  fs.rmSync(nodeCopy);
  const res = await fetch(`http://127.0.0.1:${port}/api/compose-preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mailName: 'node-fallback', blocks: [{ id: 'iq-section-card-border' }] }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `preview builds after the Node binary disappeared: ${JSON.stringify(body).slice(0, 200)}`);
  assert.equal(body.ok, true);
  assert.match(log, /no longer exists/, 'warns once in the log');
  console.log('✓ previews survive a removed Node binary (fallback to PATH node)');
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
