// Fails when server or browser code references a variable that does not exist.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const bin = path.join(root, 'node_modules/.bin/eslint');
if (!fs.existsSync(bin)) { console.log('SKIP no-undefined-variables: run npm install (eslint is a devDependency)'); process.exit(0); }
const r = spawnSync(bin, ['-c', 'eslint.undef.config.mjs', '--no-warn-ignored', 'server.js', 'src', 'mcp', 'public'], { cwd: root, encoding: 'utf8' });
if (r.status !== 0) { process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); console.error('✗ undefined variables found (see above)'); process.exit(1); }
console.log('✓ no undefined variables in server.js, src/, mcp/, public/');
