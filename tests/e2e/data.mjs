// e2e: QA round 1 data / backup / onboarding fixes against REAL IndexedDB.
//  1. tests/e2e/fixtures/data.js suites, each in a fresh browser context
//     (settings.removeBaby, onboarding-style restore, stale timers, the
//     partner-merge summary). settings.removeBaby downloads nothing.
//  2. The real app: onboarding with a name typed, then "I have a backup
//     file" with a twins backup → Today for the file's active baby, no
//     phantom baby (DI-03).
// Zero console errors and zero requests to any other origin, throughout.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/data.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const FIXTURE = `${BASE_URL}/tests/e2e/fixtures/data.html`;
const SUITES = ['remove-baby', 'fresh-restore', 'fresh-restore-single', 'imports'];

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); } else { failures.push(name); console.log(`  FAIL ${name}${detail ? `\n       ${String(detail).split('\n').join('\n       ')}` : ''}`); }
}

const browser = await chromium.launch();
async function context(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  const foreign = [];
  const downloads = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('download', d => downloads.push(d.suggestedFilename()));
  page.on('request', r => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== ORIGIN) foreign.push(u);
  });
  return { ctx, page, errors, foreign, downloads };
}

try {
  for (const name of SUITES) {
    console.log(`\n${name}`);
    const { ctx, page, errors, foreign, downloads } = await context();
    await page.goto(`${FIXTURE}?suite=${encodeURIComponent(name)}`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
    const results = await page.evaluate(() => window.__results);
    for (const r of results) check(`${name} › ${r.name}`, r.ok, r.error);
    if (!results.length) check(`${name} › produced results`, false);
    check(`${name} › no console errors`, !errors.length, errors.join('\n'));
    check(`${name} › same-origin only`, !foreign.length, foreign.join(', '));
    check(`${name} › nothing downloaded (the copy is kept on this phone)`, !downloads.length, downloads.join(', '));
    await ctx.close();
  }

  // ------------------------------------------------ the real onboarding
  console.log('\nonboarding restore with a name typed (DI-03)');
  {
    const { ctx, page, errors, foreign } = await context({ deviceScaleFactor: 2 });
    await page.goto(`${BASE_URL}/`);
    await page.waitForSelector('[data-view="onboarding"] .ob-step', { timeout: 15000 });
    await page.fill('.ob-step:not(.is-leaving) [data-field="name"]', 'Avery');
    const t = Date.now() - 2 * 3600 * 1000;
    const twins = {
      app: 'nurture', schema: 2,
      settings: { babies: [{ id: 'baby_ava', name: 'Ava', birthDate: '2026-09-01' }, { id: 'baby_ben', name: 'Ben', birthDate: '2026-09-01' }], activeBabyId: 'baby_ava' },
      events: [
        { id: 'evt_t1', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ava', data: { kind: 'wet' }, createdAt: t, updatedAt: t },
        { id: 'evt_t2', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ben', data: { kind: 'dirty' }, createdAt: t, updatedAt: t },
        { id: 'evt_t3', type: 'sleep', startTime: Date.now() - 40 * 24 * 3600 * 1000, endTime: null, babyId: 'baby_ben', data: { kind: 'night' }, createdAt: t, updatedAt: t },
      ],
    };
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ob-step:not(.is-leaving) [data-action="restore"]')]);
    await chooser.setFiles({ name: 'twins.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(twins)) });
    await page.waitForSelector('[data-view="today"]', { timeout: 8000 });
    await page.waitForTimeout(600);
    const s = await page.evaluate(async (u) => { const { settings } = await import(u); return { babies: settings.babies().map(b => b.name), active: settings.get('activeBabyId') }; }, `${BASE_URL}/js/core/settings.js`);
    check('no phantom "Avery"/"Baby": the file\'s twins, the file\'s active baby', JSON.stringify(s) === JSON.stringify({ babies: ['Ava', 'Ben'], active: 'baby_ava' }), JSON.stringify(s));
    const today = await page.textContent('[data-view="today"]');
    check('Today shows Ava with her entry, not "A fresh page"', /Ava/.test(today) && !/A fresh page/.test(today), today.slice(0, 200));
    const toast = await page.textContent('#toastRoot');
    check('the welcome toast counts the entries and the stopped 40-day-old timer', /Welcome back · 3 entries restored · 1 old timer stopped/.test(toast), toast);
    check('no live pill for the 40-day-old sleep', await page.evaluate(async (u) => (await (await import(u)).events.running()).length === 0, `${BASE_URL}/js/core/store.js`));
    check('no console errors', !errors.filter(e => !/Service Worker/.test(e)).length, errors.join('\n'));
    check('same-origin only', !foreign.length, foreign.join(', '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\ndata e2e: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
