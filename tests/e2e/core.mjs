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
  ['data-invariants'],
  ['import-guards'],
  ['migration-v1-edits'],
  ['data-invariants-r2'],
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

// ------------------------------------------------------------- two tabs
// Two pages in ONE context = two tabs of the app sharing IndexedDB (e.g. the
// installed PWA window and a browser tab on Android). Each scenario gets a
// fresh context. Pages load the fixture with ?suite=tabs, which only exposes
// window.TABS helpers; the steps are driven from here.

function check(cond, msg) { if (!cond) throw new Error(msg); }
function same(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

async function tabScenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const problems = [];
  const open = async () => {
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
    page.on('pageerror', err => problems.push(`pageerror: ${err}`));
    page.on('request', req => {
      const url = req.url();
      if (!url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== ORIGIN) problems.push(`foreign request: ${url}`);
    });
    await page.goto(`${FIXTURE}?suite=tabs`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
    return page;
  };
  try {
    await fn(open);
    if (problems.length) throw new Error(problems.join('\n'));
    passed += 1;
    console.log(`  ok   tabs › ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL tabs › ${name}\n${String((err && err.stack) || err).split('\n').map(l => `       ${l}`).join('\n')}`);
  } finally {
    await context.close();
  }
}

const V1_PROFILE = [['babyName', 'Clara'], ['themeMode', 'dark'], ['dailyGoalOz', 30], ['onboarding_completed', true], ['parentName', 'Nick']];
const MIGRATED_VIEW = { names: ['Clara'], theme: 'dark', onboarded: true, goal: 30, parent: 'Nick', migratedV2: true };
const view = page => page.evaluate(() => {
  const s = TABS.settings;
  return { names: s.get('babies').map(b => b.name), theme: s.get('theme'), onboarded: s.get('onboarded'), goal: s.get('pumpGoalOz'), parent: s.get('parentName'), migratedV2: s.get('migratedV2') };
});
const storedBabies = page => page.evaluate(() => TABS.rawSetting('babies').then(l => l.map(b => [b.name, b.birthDate])));

async function runTabScenarios() {
  // Tab B has no BroadcastChannel here (Safari < 15.4), so only the
  // migration re-read + transactional writes can keep it correct.
  await tabScenario('v1 database, two tabs: the tab that loses the migration race re-reads settings and never drops Clara', async (open) => {
    const A = await open();
    const B = await open();
    await A.evaluate(p => TABS.seedV1Settings(p), V1_PROFILE);
    await A.evaluate(() => TABS.mods());
    await B.evaluate(() => TABS.mods({ broadcast: false }));
    await B.evaluate(() => TABS.settings.load()); // B loads pre-migration settings…
    const a = await A.evaluate(() => TABS.migrate.runMigration().then(r => r.skipped)); // …A migrates…
    const b = await B.evaluate(() => TABS.migrate.runMigration().then(r => r.skipped)); // …B finds it done.
    same([a, b], [false, true], 'A migrated, B skipped');
    same(await view(B), MIGRATED_VIEW, 'tab B sees the migrated settings (no second onboarding)');
    await B.evaluate(() => TABS.settings.addBaby({ name: 'Theo' }));
    same(await storedBabies(A), [['Clara', null], ['Theo', null]], 'stored babies after tab B adds a twin');
  });

  for (let run = 1; run <= 3; run += 1) {
    await tabScenario(`v1 database, two tabs boot at the same moment: both end up with the migrated settings (run ${run}/3)`, async (open) => {
      const A = await open();
      const B = await open();
      await A.evaluate(p => TABS.seedV1Settings(p), V1_PROFILE);
      await Promise.all([A.evaluate(() => TABS.mods({ broadcast: false })), B.evaluate(() => TABS.mods({ broadcast: false }))]);
      await Promise.all([A, B].map(p => p.evaluate(() => { window.__boot = TABS.migrate.runMigration(); })));
      const reports = await Promise.all([A, B].map(p => p.evaluate(() => window.__boot.then(r => r.skipped))));
      same(reports.sort(), [false, true], 'exactly one tab migrated');
      same([await view(A), await view(B)], [MIGRATED_VIEW, MIGRATED_VIEW], 'both tabs');
    });
  }

  await tabScenario('two open tabs: a baby edit in one survives a later baby/settings write from the other (stale cache)', async (open) => {
    const A = await open();
    const B = await open();
    await A.evaluate(() => TABS.mods());
    await B.evaluate(() => TABS.mods({ broadcast: false }));
    await A.evaluate(() => TABS.migrate.runMigration());
    await B.evaluate(() => TABS.migrate.runMigration());
    await A.evaluate(() => TABS.settings.updateBaby(TABS.settings.get('activeBabyId'), { name: 'Clara Rose', birthDate: '2026-08-01' }));
    await A.evaluate(() => TABS.settings.patch('trackers', { pump: false }));
    await B.evaluate(() => TABS.settings.addBaby({ name: 'Theo' }));
    await B.evaluate(() => TABS.settings.patch('trackers', { sleep: false }));
    same(await storedBabies(A), [['Clara Rose', '2026-08-01'], ['Theo', null]], 'tab A\'s edit kept');
    same(await A.evaluate(() => TABS.rawSetting('trackers').then(t => [t.pump, t.sleep])), [false, false], 'both trackers patches kept');
    same(await B.evaluate(() => TABS.settings.get('babies').map(b => b.name)), ['Clara Rose', 'Theo'], 'tab B\'s cache caught up on its own write');
  });

  await tabScenario('two open tabs: a settings write in one refreshes the other tab\'s cache and notifies its subscribers', async (open) => {
    const A = await open();
    const B = await open();
    await A.evaluate(() => TABS.mods());
    await B.evaluate(() => TABS.mods());
    await A.evaluate(() => TABS.settings.load());
    await B.evaluate(() => TABS.settings.load().then(() => { window.__seen = []; TABS.settings.subscribe(c => window.__seen.push(c.key)); }));
    await A.evaluate(() => TABS.settings.set('theme', 'dark'));
    await B.waitForFunction(() => TABS.settings.get('theme') === 'dark', null, { timeout: 5000 });
    await A.evaluate(() => TABS.settings.updateBaby(TABS.settings.get('activeBabyId'), { name: 'Clara' }));
    await B.waitForFunction(() => TABS.settings.get('babies')[0].name === 'Clara', null, { timeout: 5000 });
    check(await B.evaluate(() => window.__seen.includes('*')), 'tab B subscribers were told to re-read');
  });
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
  await runTabScenarios();
} finally {
  await browser.close();
}

console.log(`\ncore e2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
