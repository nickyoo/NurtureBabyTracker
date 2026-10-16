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

import { readFile } from 'node:fs/promises';

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
  ['persist'],
];

// Files each suite must have actually downloaded (checked from disk, not
// just "a download started"): the backup share, the §10b safety backup taken
// before an import-replace, and the calendar file.
const EXPECTED_DOWNLOADS = {
  backup: [/^nurture-backup-\d{4}-\d{2}-\d{2}\.json$/, /^nurture-backup-before-import-\d{4}-\d{2}-\d{2}\.json$/],
  persist: [/^nurture-pump-schedule\.ics$/],
};

async function checkDownloads(suite, downloads, pageState) {
  const problems = [];
  const expected = EXPECTED_DOWNLOADS[suite] || [];
  const names = downloads.map(d => d.suggestedFilename());
  if (names.length !== expected.length || !expected.every((re, i) => re.test(names[i]))) {
    problems.push(`downloads ${JSON.stringify(names)} don't match ${expected.map(String).join(', ')}`);
    return problems;
  }
  for (const d of downloads) {
    const name = d.suggestedFilename();
    const text = await readFile(await d.path(), 'utf8');
    if (name.startsWith('nurture-backup-before-import-')) {
      const data = JSON.parse(text);
      if (data.app !== 'nurture' || data.schema !== 2) problems.push('safety backup is not a v2 backup');
      if (!data.events.some(e => e.id === pageState.safetyEventId)) problems.push('safety backup is missing the data it was meant to protect');
    } else if (name.endsWith('.ics')) {
      if (!text.startsWith('BEGIN:VCALENDAR\r\n') || !text.endsWith('END:VCALENDAR\r\n')) problems.push('ics envelope/CRLF');
      if (/[^\r]\n/.test(text)) problems.push('ics has bare LF line endings');
      if (!/BEGIN:VEVENT\r\n/.test(text) || !/TRIGGER:-PT0M\r\n/.test(text)) problems.push('ics has no events/alarms');
      const long = text.split('\r\n').filter(l => Buffer.byteLength(l, 'utf8') > 75);
      if (long.length) problems.push(`ics lines over 75 octets: ${long.length}`);
    }
  }
  return problems;
}

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
    const downloads = [];
    page.on('download', d => downloads.push(d));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));
    // Privacy check (ARCHITECTURE §11): only same-origin requests, ever.
    page.on('request', req => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (new URL(url).origin !== ORIGIN) foreign.push(url);
    });

    const pageState = {};
    for (const name of [first, ...after]) {
      const results = await runSuite(page, name);
      pageState.safetyEventId = pageState.safetyEventId || await page.evaluate(() => window.__safetyEventId);
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
    const dl = await checkDownloads(first, downloads, pageState);
    if (dl.length) { failed += 1; console.log(`  FAIL ${first} › downloads:\n       ${dl.join('\n       ')}`); } else {
      passed += 1;
      if (downloads.length) console.log(`  ok   ${first} › downloaded ${downloads.map(d => d.suggestedFilename()).join(', ')}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\ncore e2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
