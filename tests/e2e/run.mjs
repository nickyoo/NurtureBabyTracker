// Runs every tests/e2e/*.mjs script (except this one) against a throwaway
// static server bound to 127.0.0.1 on a free port, then stops the server.
// No dependencies: the server is node:http; Playwright is loaded by each
// script from PLAYWRIGHT_PATH (or a 'playwright' package if one is installed):
//
//   PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = resolve(ROOT, `.${path}`);
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    if (path.endsWith('/')) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE_URL = `http://127.0.0.1:${server.address().port}`;
console.log(`e2e server: ${BASE_URL}`);

const scripts = (await readdir(HERE)).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').sort();
let failures = 0;
for (const script of scripts) {
  console.log(`\n▶ ${script}`);
  const code = await new Promise(res => {
    const child = spawn(process.execPath, [join(HERE, script)], { stdio: 'inherit', env: { ...process.env, BASE_URL } });
    child.on('exit', c => res(c ?? 1));
  });
  if (code !== 0) failures += 1;
}

server.close();
console.log(failures ? `\n${failures} e2e script(s) failed` : '\nall e2e scripts passed');
process.exit(failures ? 1 : 0);
