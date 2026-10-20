// Shipping guards (ARCHITECTURE §2, §8, §9):
//  - sw.js precaches EVERY shipped file under js/, css/, fonts/, icons/
//    (and nothing that doesn't exist), so the app works offline after one visit;
//  - the v2 import graph never reaches a legacy v1 module (v1 js/db.js opens
//    IndexedDB at version 1 and would fail against the v2 database);
//  - index.html only references files that exist and are precached, and has
//    no inline scripts or style="" attributes (CSP: script-src/style-src 'self');
//  - UI code never writes innerHTML except through ui/html.js render().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// The v1 app is retired: none of its files may come back (a v1 js/db.js
// opened IndexedDB at version 1 and would fail against the v2 database).
const LEGACY_V1 = new Set([
  'js/app.v1.js', 'js/audio.js', 'js/bottles.js', 'js/dashboardView.js', 'js/db.js', 'js/export.js',
  'js/feedFlow.js', 'js/installPrompt.js', 'js/inventory.js', 'js/inventoryView.js', 'js/onboarding.js',
  'js/pumpTimerView.js', 'js/reminders.js', 'js/settingsView.js', 'js/timer.js', 'js/trends.js',
  'js/viewHelpers.js', 'css/style.css',
]);

test('v1 is retired: no legacy file is on disk (arcade.json stays for the arcade listing)', () => {
  for (const f of LEGACY_V1) assert.ok(!existsSync(join(ROOT, f)), `legacy v1 file is back: ${f}`);
  assert.ok(existsSync(join(ROOT, 'arcade.json')), 'arcade.json must stay');
  const page = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/arcade-back-pill/.test(page), 'no arcade back pill in the v2 shell');
});

function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(ROOT, dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(rel(p)));
    else out.push(rel(p));
  }
  return out;
}

const swSource = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const assetBlock = /const ASSETS = \[([\s\S]*?)\];/.exec(swSource);
const ASSETS = new Set([...(assetBlock ? assetBlock[1] : '').matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\.\//, '')));

test('sw.js lists every shipped file under js/, css/, fonts/, icons/', () => {
  assert.ok(assetBlock, 'could not find const ASSETS = [...] in sw.js');
  const shipped = ['js', 'css', 'fonts', 'icons'].flatMap(walk);
  const missing = shipped.filter((f) => !ASSETS.has(f));
  assert.deepEqual(missing, [], `add these to ASSETS in sw.js: ${missing.join(', ')}`);
});

test('every sw.js asset exists on disk and none is a legacy v1 file', () => {
  for (const a of ASSETS) {
    if (a === '') continue; // './' — the start URL
    assert.ok(existsSync(join(ROOT, a)), `sw.js lists a missing file: ${a}`);
    assert.ok(!LEGACY_V1.has(a), `sw.js precaches a legacy v1 file: ${a}`);
  }
  for (const must of ['', 'index.html', 'manifest.json']) assert.ok(ASSETS.has(must), `ASSETS must include ./${must}`);
});

test('sw.js cache name is the v2.0.0 release (bump with APP_VERSION in views/settings.js)', () => {
  assert.match(swSource, /const CACHE_NAME = 'nurture-v2\.0\.0';/);
  const settingsSrc = readFileSync(join(ROOT, 'js/views/settings.js'), 'utf8');
  const v = /APP_VERSION = '([^']+)'/.exec(settingsSrc);
  assert.ok(v, 'APP_VERSION in js/views/settings.js');
  assert.match(swSource, new RegExp(`const CACHE_NAME = 'nurture-v${v[1].replace(/\./g, '\\.')}';`), 'CACHE_NAME and APP_VERSION move together');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, v[1], 'package.json version matches APP_VERSION');
  assert.match(swSource, /cache: 'reload'/);
});

// Static + dynamic (string-literal) imports of one module.
function importsOf(file) {
  const src = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specs = [
    ...src.matchAll(/\bimport\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g),
    ...src.matchAll(/\bexport\s+[\w*{}\s,]+\s+from\s+['"]([^'"]+)['"]/g),
    ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((m) => m[1]);
  assert.ok(!/\bimport\(\s*`/.test(src), `${file}: use string-literal import() so the graph can be checked`);
  return specs.filter((s) => s.startsWith('.')).map((s) => rel(resolve(dirname(join(ROOT, file)), s)));
}

test('the v2 app never imports a legacy v1 module', () => {
  const seen = new Set();
  const queue = ['js/app.js'];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    assert.ok(!LEGACY_V1.has(f), `legacy v1 module reached from js/app.js: ${f}`);
    assert.ok(existsSync(join(ROOT, f)), `import of a missing file: ${f}`);
    assert.ok(ASSETS.has(f), `${f} is imported but not precached by sw.js`);
    queue.push(...importsOf(f));
  }
  for (const must of ['js/ui/sheet.js', 'js/ui/router.js', 'js/views/today.js', 'js/sheets/quickLog.js', 'js/core/migrate.js']) {
    assert.ok(seen.has(must), `${must} should be reachable from js/app.js`);
  }
});

test('index.html: CSP-clean shell whose references exist and are precached', () => {
  const page = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/\sstyle\s*=/.test(page), 'no style="" attributes (CSP style-src \'self\')');
  assert.ok(!/<style[\s>]/i.test(page), 'no <style> blocks');
  for (const m of page.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\ssrc=/, 'no inline <script>');
  assert.match(page, /http-equiv="Content-Security-Policy"/);
  assert.match(page, /default-src 'self'; script-src 'self'; style-src 'self'/);
  assert.match(page, /id="appleTouchIcon"/);
  for (const id of ['app', 'appHeader', 'viewport', 'livePills', 'tabBar', 'sheetRoot', 'toastRoot']) assert.match(page, new RegExp(`id="${id}"`));
  const refs = [...page.matchAll(/\b(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 10);
  for (const r of refs) {
    assert.ok(existsSync(join(ROOT, r)), `index.html references a missing file: ${r}`);
    assert.ok(ASSETS.has(r), `index.html references ${r}, which sw.js doesn't precache`);
  }
  // stylesheet order: tokens → base → components → views → sheets
  const css = [...page.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(css.slice(0, 3), ['css/tokens.css', 'css/base.css', 'css/components.css']);
  const firstSheet = css.findIndex((c) => c.startsWith('css/sheets/'));
  assert.ok(css.slice(3, firstSheet).every((c) => c.startsWith('css/views/')), 'views before sheets');
});

test('UI code writes markup only through ui/html.js render()', () => {
  const files = ['js/app.js', ...['js/ui', 'js/views', 'js/sheets'].flatMap(walk)].filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (f !== 'js/ui/html.js') {
      assert.ok(!/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(src), `${f}: use render()/fragment() from ui/html.js`);
    }
    assert.ok(!/\sstyle\s*=\s*["'`$]/.test(src.replace(/\/\/.*$/gm, '')), `${f}: no style="" attributes (CSP) — use classes or el.style.setProperty`);
    assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(src.replace(/\/\/.*$/gm, '').replace(/confirmSheet\(/g, '')), `${f}: no alert/confirm/prompt — use toast/confirmSheet`);
  }
});
