// e2e: v2 data layer (db/store/stash/migrate/photos/settings/backup) against
// real IndexedDB in Chromium. Each suite gets a FRESH browser context, so
// IndexedDB and localStorage start empty.
//
// Run all e2e scripts:   npm run e2e
// Run just this one:     BASE_URL=http://127.0.0.1:8123 node tests/e2e/core.mjs
//                        (with `python3 -m http.server 8123 --bind 127.0.0.1` running at the repo root)
//
// Playwright is NOT a project dependency (the app has none). Point
// PLAYWRIGHT_PATH at an install, e.g.
//   PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const FIXTURE = `${BASE_URL}/tests/e2e/fixtures/core.html`;
const ORIGIN = new URL(BASE_URL).origin;

// [suite, follow-up suite run after a reload in the SAME context]
const SUITES = [
  ['migration', 'migration-reload'],
  ['store'],
  ['stash'],
  ['photos'],
  ['settings', 'settings-reload'],
  ['backup'],
];

const browser = await chromium.launch();
let passed = 0;
let failed = 0;

async function runSuite(page, name) {
  await page.goto(`${FIXTURE}?suite=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
  return page.evaluate(() => window.__results);
}

try {
  for (const [first, ...after] of SUITES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const consoleErrors = [];
    const foreign = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));
    // Privacy check (ARCHITECTURE §11): only same-origin requests, ever.
    page.on('request', req => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (new URL(url).origin !== ORIGIN) foreign.push(url);
    });

    for (const name of [first, ...after]) {
      const results = await runSuite(page, name);
      for (const r of results) {
        if (r.ok) { passed += 1; console.log(`  ok   ${name} › ${r.name}`); } else {
          failed += 1;
          console.log(`  FAIL ${name} › ${r.name}\n${r.error.split('\n').map(l => `       ${l}`).join('\n')}`);
        }
      }
      if (!results.length) { failed += 1; console.log(`  FAIL ${name} › produced no results`); }
    }
    // The photos suite deliberately loads a revoked blob: URL; Chromium logs
    // exactly one ERR_FILE_NOT_FOUND for it, which is the behaviour under test.
    let allowance = first === 'photos' ? 1 : 0;
    const unexpected = consoleErrors.filter(t => !(allowance > 0 && /ERR_FILE_NOT_FOUND/.test(t) && allowance-- > 0));
    if (unexpected.length) { failed += 1; console.log(`  FAIL ${first} › console errors:\n       ${unexpected.join('\n       ')}`); } else passed += 1;
    if (foreign.length) { failed += 1; console.log(`  FAIL ${first} › non-same-origin requests: ${foreign.join(', ')}`); } else passed += 1;
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\ncore e2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
