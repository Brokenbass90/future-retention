#!/usr/bin/env node
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const url = require('url');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2), {
  string: ['dist', 'host'],
  boolean: ['livereload', 'preferPretty'],
  default: {
    dist: path.join(process.cwd(), 'dist'),
    host: '127.0.0.1',
    port: 3001,
    livereload: true,
    preferPretty: true,
  },
});

const DIST_ROOT = path.resolve(argv.dist);
const HOST = argv.host;
const PORT = Number(argv.port || 3001);

const clients = new Set(); // SSE connections

function contentType(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function injectLivereload(html) {
  if (!argv.livereload) return html;
  const snippet = `
<script>
(() => {
  try {
    const es = new EventSource('/__livereload');
    es.onmessage = (e) => {
      if (e && e.data === 'reload') location.reload();
    };
  } catch (e) {}
})();
</script>
`.trim();

  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}\n</body>`);
  }
  return `${html}\n${snippet}\n`;
}

async function safeStat(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

async function resolvePath(reqPath) {
  let p = decodeURIComponent(reqPath || '/');
  if (!p.startsWith('/')) p = `/${p}`;

  let abs = path.join(DIST_ROOT, p);
  abs = path.normalize(abs);

  if (!abs.startsWith(DIST_ROOT)) return null;

  const st = await safeStat(abs);
  if (!st) return null;

  if (st.isDirectory()) {
    const pretty = path.join(abs, 'index.pretty.html');
    const compact = path.join(abs, 'index.html');
    if (argv.preferPretty) {
      const pst = await safeStat(pretty);
      if (pst && pst.isFile()) return pretty;
    }
    const cst = await safeStat(compact);
    if (cst && cst.isFile()) return compact;
    return null;
  }

  return abs;
}

function broadcastReload() {
  for (const res of clients) {
    try { res.write(`data: reload\n\n`); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const pathname = u.pathname || '/';

  if (argv.livereload && pathname === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (argv.livereload && pathname === '/__livereload/trigger') {
    broadcastReload();
    res.writeHead(204);
    res.end();
    return;
  }

  const resolved = await resolvePath(pathname);
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ct = contentType(resolved);
  res.writeHead(200, {
    'Content-Type': ct,
    // Avoid stale content during rapid rebuilds.
    'Cache-Control': 'no-store, max-age=0',
  });

  if (ct.startsWith('text/html')) {
    const html = await fsp.readFile(resolved, 'utf8');
    res.end(injectLivereload(html));
  } else {
    const buf = await fsp.readFile(resolved);
    res.end(buf);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] dist: ${DIST_ROOT}`);
  console.log(`[serve] http://${HOST}:${PORT}/ (preferPretty=${argv.preferPretty}, livereload=${argv.livereload})`);
});
