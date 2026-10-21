// e2e: the pump, sleep and diaper sheets (js/sheets/pump.js, sleep.js,
// diaper.js) on a FRESH profile at 390×844.
//
//  - pump: home (today's goal), Start timer → live view in the same sheet
//    (no second sheet, double-tap safe), live pill, pill Finish → "How much
//    did you pump?" (amount asked AFTER pumping, AUDIT §2) → Freezer → the
//    pouch is in the stash and linked back (data.inventoryId); Keep pumping;
//    Discard + Undo; Log a past pump (10/15/20 + typed via the keypad, the
//    time chip back-dates the end, Don't store adds no pouch); mL stored as
//    mL; Stash hidden → no "Store it"
//  - sleep: Start a nap / night sleep (classified by the clock, override),
//    wake-window hint by age ("Usually awake 60–90m at 6 weeks"), live
//    sleep from the pill, nap ↔ night, End nap (in-sheet ✓), pill Finish →
//    "Wake-up logged" + Undo, Log a past sleep with validation (order,
//    overlaps), two babies (named titles, independent sleeps)
//  - diaper: one tap logs at once (sheet closes, toast + Undo removes it),
//    time chip back-dates, details step (Both + color/texture/note, color
//    collapses for wet), a note is stored as plain text, hidden tracker
//  - light + night screenshots to docs/design/build/logsheets-*.png
//  - zero console errors, zero CSP violations, zero non-local requests,
//    every control a real element, ≥44px and named
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/logsheets.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });
const mod = (path) => `${BASE_URL}${path}`;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];
const pages = [];

const MIN = 60 * 1000;
const isoDaysAgo = (n) => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function freshPage({ dark = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== ORIGIN) foreign.push(u);
  });
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-view="today"]');
  await setSetting(page, 'theme', dark ? 'dark' : 'light');
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, dark ? 'dark' : 'light');
  // A named baby, born exactly 6 weeks ago (wake-window hint).
  await page.evaluate(async ([u, birth]) => {
    const { settings } = await import(u);
    await settings.updateBaby(settings.get('activeBabyId'), { name: 'Clara', birthDate: birth });
  }, [mod('/js/core/settings.js'), isoDaysAgo(42)]);
  await page.waitForTimeout(400);
  pages.push(page);
  return { context, page };
}

const settle = (page, ms = 500) => page.waitForTimeout(ms);
async function setSetting(page, key, value) {
  await page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}
async function patchTrackers(page, patch) {
  await page.evaluate(async ([u, p]) => { const { settings } = await import(u); await settings.patch('trackers', p); }, [mod('/js/core/settings.js'), patch]);
}
const layerCount = (page) => page.evaluate(() => document.querySelectorAll('.sheet-layer').length);
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const TOP = '.sheet-layer[data-state="open"]:last-of-type';
const title = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop(); return l ? l.querySelector('.sheet-title').textContent : null; });
const newest = (list) => list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
const q = (page, opts) => page.evaluate(async ([u, o]) => (await import(u)).events.query(o), [mod('/js/core/store.js'), opts]);
const runningOf = (page, type) => page.evaluate(async ([u, t]) => (await import(u)).events.running(t), [mod('/js/core/store.js'), type]);
const pouch = (page, id) => page.evaluate(async ([u, i]) => (await import(u)).stash.get(i), [mod('/js/core/stash.js'), id]);
const pouches = (page) => page.evaluate(async (u) => (await import(u)).stash.list(), mod('/js/core/stash.js'));
const toastText = (page) => page.evaluate(() => { const t = [...document.querySelectorAll('#toastRoot .toast')].pop(); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; });
const shot = (page, name) => page.screenshot({ path: `${SHOTS}logsheets-${name}.png` });
async function openCard(page, card) {
  await page.click(`[data-view="today"] [data-card="${card}"]`);
  await page.waitForSelector(`${TOP}`);
  await settle(page, 600);
}
async function closeTop(page) {
  await page.keyboard.press('Escape');
  await settle(page, 450);
}

// Every interactive thing in the open sheet: real element, ≥44px, has a name.
async function auditTargets(page, label) {
  const bad = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop();
    const out = [];
    for (const el of l.querySelectorAll('button, input, textarea, a[href], [role="radio"], [role="spinbutton"]')) {
      if (el.closest('[hidden]') || el.closest('[inert]') || el.classList.contains('sheet-close') || el.getClientRects().length === 0) continue;
      const r = el.getBoundingClientRect();
      const target = el.matches('input, textarea') ? el.closest('label') || el : el.closest('.segmented') || el;
      const tr = target.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim()
        || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim())
        || (el.closest('label') && el.closest('label').textContent.trim());
      if (Math.max(r.height, tr.height) < 44 || Math.max(r.width, tr.width) < 44) out.push(`${el.tagName}.${el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!name) out.push(`${el.tagName}.${el.className} has no name`);
      if (!['BUTTON', 'INPUT', 'TEXTAREA', 'A'].includes(el.tagName)) out.push(`${el.tagName} is not a real control`);
    }
    return out;
  });
  check(`${label}: every control is real, ≥44px and named`, bad.length === 0, bad.join(' | '));
}

// No pronoun for the baby anywhere in the open sheet.
async function noPronouns(page, label) {
  const text = await page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop(); return l ? l.innerText : ''; });
  check(`${label}: copy never uses a pronoun for the baby`, !/\b(she|her|hers|he|him|his)\b/i.test(text), text.slice(0, 200));
}

try {
  // ================================================================ PUMP
  console.log('\npump: home → start → pill → Finish → How much? → freezer');
  {
    const { context, page } = await freshPage();
    await openCard(page, 'pump');
    check('pump card opens the pump sheet', (await title(page)) === 'Pump');
    const goal = await page.textContent(`${TOP} [data-goal]`);
    check('home shows today’s goal progress', /0\s*of 24 oz/.test(goal) && /No pumps yet today/.test(goal), goal);
    check('home offers Start timer and Log a past pump', await page.isVisible(`${TOP} [data-start]`) && await page.isVisible(`${TOP} [data-past]`));
    check('header has the time chip', /Now/.test(await page.textContent(`${TOP} .sheet-hd [data-when]`)));
    await auditTargets(page, 'pump home');
    await shot(page, 'pump-home-light');

    // Double-tap Start: one pump, live view in the SAME sheet.
    await page.dblclick(`${TOP} [data-start]`);
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 600);
    const run = await runningOf(page, 'pump');
    check('Start (double-tapped) starts exactly one pump', run.length === 1, JSON.stringify(run.length));
    check('a pump is the parent’s (babyId null)', run[0] && run[0].babyId === null);
    check('live view replaces home in the same sheet (no second sheet)', (await layerCount(page)) === 1 && (await title(page)) === 'Pumping');
    check('the amount is not asked while pumping', !(await page.$(`${TOP} [data-amount]`)));
    await shot(page, 'pump-live-light');

    await closeTop(page);
    check('closing keeps it running: the Pump pill shows', await page.isVisible('#livePills .lpill[data-kind="pump"]'));
    await page.click('#livePills .lpill[data-kind="pump"] .lpill-open');
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 600);
    check('the pill reopens the live pump', (await title(page)) === 'Pumping');
    // Finish in the sheet → How much? → Keep pumping → back to live.
    await page.click(`${TOP} [data-finish]`);
    await page.waitForSelector(`${TOP} [data-amount]`);
    await settle(page, 500);
    check('Finish asks "How much did you pump?"', (await title(page)) === 'How much did you pump?');
    await page.click(`${TOP} [data-keep]`);
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 500);
    check('Keep pumping goes back; still running', (await runningOf(page, 'pump')).length === 1 && (await title(page)) === 'Pumping');
    await closeTop(page);

    // Pill Finish → How much? (amount asked AFTER pumping).
    await page.click('#livePills .lpill[data-kind="pump"] .lpill-finish');
    await page.waitForSelector(`${TOP} [data-amount]`);
    await settle(page, 600);
    check('pill Finish opens "How much did you pump?"', (await title(page)) === 'How much did you pump?');
    check('it starts at a real number (never NaN)', (await page.inputValue(`${TOP} [data-amount]`)) === '4');
    await page.click(`${TOP} [data-inc]`);
    await page.click(`${TOP} [data-inc]`);
    check('+ steps by 0.5 oz', (await page.inputValue(`${TOP} [data-amount]`)) === '5');
    check('Store it offers Fridge / Freezer / Deep freezer / Don’t store',
      (await page.$$eval(`${TOP} [data-places] [role="radio"] b`, (els) => els.map((e) => e.textContent).join('|'))) === 'Fridge|Freezer|Deep freezer|Don’t store');
    await page.click(`${TOP} [data-places] [data-value="freezer"]`);
    check('the save button names the amount', /Save · 5 oz/.test(await page.textContent(`${TOP} [data-finish]`)));
    await auditTargets(page, 'pump how much');
    await shot(page, 'pump-amount-light');
    await page.click(`${TOP} [data-finish]`);
    await page.waitForFunction(() => /Logged/.test(document.querySelector('.sheet-layer [data-finish]')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
    check('in-sheet success says Logged (no toast)', /Logged/.test(await page.evaluate(() => document.querySelector('.sheet-layer [data-finish]')?.textContent || '')) && !(await toastText(page)));
    check('the sheet closes after the success', await waitNoLayers(page));
    const [pumped] = await q(page, { type: 'pump' });
    check('pump finished with 5 oz', pumped && pumped.endTime !== null && pumped.data.amount === 5 && pumped.data.unit === 'oz', JSON.stringify(pumped && pumped.data));
    check('pump recorded storedTo + inventoryId', pumped.data.storedTo === 'freezer' && !!pumped.data.inventoryId);
    const p = await pouch(page, pumped.data.inventoryId);
    check('the pouch is in the freezer with 5 oz', p && p.location === 'freezer' && p.quantity === 5, JSON.stringify(p));
    await settle(page, 600);
    check('the pill is gone', (await page.$$('#livePills .lpill[data-kind="pump"]')).length === 0);

    // Discard + Undo.
    await openCard(page, 'pump');
    check('home now shows 5 of 24 oz', /5\s*of 24 oz/.test(await page.textContent(`${TOP} [data-goal]`)));
    await page.click(`${TOP} [data-start]`);
    await page.waitForSelector(`${TOP} [data-discard]`);
    await settle(page, 500);
    await page.click(`${TOP} [data-discard]`);
    await waitNoLayers(page);
    await settle(page, 400);
    check('Discard removes the running pump with an Undo toast', (await runningOf(page, 'pump')).length === 0 && /Pump discarded/.test(await toastText(page)));
    await page.click('#toastRoot .toast-action');
    await settle(page, 500);
    check('Undo brings it back running', (await runningOf(page, 'pump')).length === 1);
    await page.click('#livePills .lpill[data-kind="pump"] .lpill-open');
    await page.waitForSelector(`${TOP} [data-discard]`);
    await settle(page, 600);
    await page.click(`${TOP} [data-discard]`);
    await waitNoLayers(page);
    await settle(page, 5800); // let the toast leave

    // Log a past pump: 10 min, typed amount, back-dated, Don't store.
    console.log('\npump: log a past pump');
    await openCard(page, 'pump');
    await page.click(`${TOP} [data-past]`);
    await page.waitForSelector(`${TOP} [data-durs]`);
    await settle(page, 500);
    check('Log a past pump steps forward', (await title(page)) === 'Past pump' && (await layerCount(page)) === 1);
    await page.click(`${TOP} [data-durs] [data-min="10"]`);
    await page.click(`${TOP} [data-amount]`);
    await page.waitForSelector('.sheet-layer.sheet-nb-keypad[data-state="open"]');
    await settle(page, 450);
    check('tapping the value opens the keypad sheet', (await title(page)) === 'How much?');
    await page.click('.sheet-nb-keypad [data-key="3"]');
    await page.click('.sheet-nb-keypad [data-key="."]');
    await page.click('.sheet-nb-keypad [data-key="5"]');
    await page.click('.sheet-nb-keypad [data-kp-done]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 1, null, { timeout: 3000 });
    check('the typed amount lands in the stepper', (await page.inputValue(`${TOP} [data-amount]`)) === '3.5');
    // Other… → typed minutes.
    await page.click(`${TOP} [data-durs] [data-other]`);
    await page.waitForSelector('.sheet-layer.sheet-nb-keypad[data-state="open"]');
    await settle(page, 450);
    await page.click('.sheet-nb-keypad [data-key="2"]');
    await page.click('.sheet-nb-keypad [data-key="5"]');
    await page.click('.sheet-nb-keypad [data-kp-done]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 1, null, { timeout: 3000 });
    check('Other… takes typed minutes', /25 min/.test(await page.textContent(`${TOP} [data-other]`)) && (await page.getAttribute(`${TOP} [data-other]`, 'aria-checked')) === 'true');
    await page.click(`${TOP} [data-places] [data-value="none"]`);
    await page.click(`${TOP} .sheet-hd [data-when]`);
    await page.waitForSelector('.sheet-layer.sheet-nb-when[data-state="open"]');
    await settle(page, 450);
    check('the time chip opens the time picker', (await title(page)) === 'When did it end?');
    await page.click('.sheet-nb-when [data-ago="30"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 1, null, { timeout: 3000 });
    await settle(page, 300);
    check('the chip shows the back-dated time', /Today/.test(await page.textContent(`${TOP} .sheet-hd [data-when]`)));
    await auditTargets(page, 'past pump');
    await noPronouns(page, 'past pump');
    await shot(page, 'pump-past-light');
    const before = (await pouches(page)).length;
    const t0 = Date.now();
    await page.click(`${TOP} [data-log]`);
    await waitNoLayers(page);
    const past = newest(await q(page, { type: 'pump' }));
    check('past pump: 3.5 oz, 25 min, ended ~30 min ago, not stored',
      past.data.amount === 3.5 && past.endTime - past.startTime === 25 * MIN && Math.abs(t0 - 30 * MIN - past.endTime) < 90 * 1000 && past.data.storedTo === null,
      JSON.stringify({ d: past.data, len: (past.endTime - past.startTime) / MIN }));
    check('Don’t store adds no pouch', (await pouches(page)).length === before);

    // mL: stored as mL, never NaN.
    console.log('\npump: mL');
    await setSetting(page, 'units', 'mL');
    await settle(page, 300);
    await openCard(page, 'pump');
    check('goal reads in mL', /of 710 mL/.test(await page.textContent(`${TOP} [data-goal]`)), await page.textContent(`${TOP} [data-goal]`));
    await page.click(`${TOP} [data-past]`);
    await page.waitForSelector(`${TOP} [data-amount]`);
    await settle(page, 500);
    const mlVal = await page.inputValue(`${TOP} [data-amount]`);
    check('the usual amount converts to whole mL', /^\d+$/.test(mlVal) && Number(mlVal) > 0, mlVal);
    await page.click(`${TOP} [data-inc]`);
    const mlAfter = Number(await page.inputValue(`${TOP} [data-amount]`));
    await page.click(`${TOP} [data-places] [data-value="fridge"]`);
    await page.click(`${TOP} [data-log]`);
    await waitNoLayers(page);
    const ml = newest(await q(page, { type: 'pump' }));
    check('an mL pump is stored in mL', ml.data.unit === 'mL' && ml.data.amount === mlAfter, JSON.stringify(ml.data));
    const mlPouch = await pouch(page, ml.data.inventoryId);
    check('its fridge pouch is in mL too', mlPouch && mlPouch.unit === 'mL' && mlPouch.quantity === mlAfter && mlPouch.location === 'fridge', JSON.stringify(mlPouch));
    await setSetting(page, 'units', 'oz');

    // Stash hidden → no "Store it".
    await patchTrackers(page, { stash: false });
    await settle(page, 300);
    await openCard(page, 'pump');
    await page.click(`${TOP} [data-past]`);
    await page.waitForSelector(`${TOP} [data-amount]`);
    await settle(page, 400);
    check('Stash hidden → no Store it choice', !(await page.$(`${TOP} [data-places]`)));
    await closeTop(page);
    await patchTrackers(page, { stash: true, pump: false });
    await settle(page, 400);
    check('Pump hidden → no pump card on Today', !(await page.$('[data-view="today"] [data-card="pump"]')));
    await context.close();
  }

  // =============================================================== SLEEP
  console.log('\nsleep: start a nap → pill → nap/night → End nap');
  {
    const { context, page } = await freshPage();
    await openCard(page, 'sleep');
    check('sleep card opens the sleep sheet', (await title(page)) === 'Sleep');
    const hint = await page.textContent(`${TOP} [data-hint]`);
    check('wake-window hint by age, calm', /^Usually awake 60–90m at 6 weeks\./.test(hint), hint);
    const auto = await page.getAttribute(`${TOP} [data-seg="kind"] [aria-checked="true"]`, 'data-value');
    const h = new Date().getHours();
    check('nap / night is classified by the clock', auto === (h >= 19 || h < 6 ? 'night' : 'nap'), auto);
    await auditTargets(page, 'sleep home');
    await noPronouns(page, 'sleep home');
    await shot(page, 'sleep-home-light');
    await page.click(`${TOP} [data-seg="kind"] [data-value="nap"]`);
    check('override → "Start nap"', /Start nap/.test(await page.textContent(`${TOP} [data-start]`)));
    await page.dblclick(`${TOP} [data-start]`);
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 600);
    const sl = await runningOf(page, 'sleep');
    check('one nap running, for the active baby', sl.length === 1 && sl[0].data.kind === 'nap' && !!sl[0].babyId);
    check('live view in the same sheet: "Nap" + End nap', (await title(page)) === 'Nap' && /End nap/.test(await page.textContent(`${TOP} [data-finish]`)) && (await layerCount(page)) === 1);
    await shot(page, 'sleep-live-light');
    await page.click(`${TOP} [data-seg="kind"] [data-value="night"]`);
    await settle(page, 300);
    check('switching to night updates the sleep + title', (await runningOf(page, 'sleep'))[0].data.kind === 'night' && (await title(page)) === 'Night sleep');
    await page.click(`${TOP} [data-seg="kind"] [data-value="nap"]`);
    await settle(page, 300);
    await closeTop(page);
    check('the Nap pill shows', /Nap/.test(await page.textContent('#livePills .lpill[data-kind="sleep"] .lpill-title')));
    await page.click('#livePills .lpill[data-kind="sleep"] .lpill-open');
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 600);
    check('the pill reopens the live nap', (await title(page)) === 'Nap');
    await page.click(`${TOP} [data-finish]`);
    await page.waitForFunction(() => /Logged/.test(document.querySelector('.sheet-layer [data-finish]')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
    check('End nap → in-sheet Logged', /Logged/.test(await page.evaluate(() => document.querySelector('.sheet-layer [data-finish]')?.textContent || '')));
    await waitNoLayers(page);
    const [ended] = await q(page, { type: 'sleep' });
    check('the nap ended', ended.endTime !== null && (await runningOf(page, 'sleep')).length === 0);

    // Pill Finish → Wake-up logged + Undo.
    console.log('\nsleep: pill Finish + Undo; Woke up earlier');
    await page.evaluate(async ([u]) => { const { events } = await import(u); await events.start('sleep', { kind: 'nap' }, { startTime: Date.now() - 20 * 60000 }); }, [mod('/js/core/store.js')]);
    await page.waitForSelector('#livePills .lpill[data-kind="sleep"]');
    await settle(page, 500);
    await page.click('#livePills .lpill[data-kind="sleep"] .lpill-finish');
    await settle(page, 600);
    check('pill Finish logs the wake-up with Undo', (await runningOf(page, 'sleep')).length === 0 && /Wake-up logged/.test(await toastText(page)));
    await page.click('#toastRoot .toast-action');
    await settle(page, 500);
    check('Undo puts the nap back to running', (await runningOf(page, 'sleep')).length === 1);
    // Woke up earlier… → 15 min ago.
    await page.click('#livePills .lpill[data-kind="sleep"] .lpill-open');
    await page.waitForSelector(`${TOP} [data-earlier]`);
    await settle(page, 600);
    await page.click(`${TOP} [data-earlier]`);
    await page.waitForSelector('.sheet-layer.sheet-nb-when[data-state="open"]');
    await settle(page, 450);
    check('"Woke up earlier…" asks by name', (await title(page)) === 'When did Clara wake up?');
    const quick = await page.$$eval('.sheet-nb-when [data-ago]', (els) => els.map((e) => e.dataset.ago));
    check('the picker never offers a time before falling asleep', !quick.includes('30') && quick.includes('15'), quick.join(','));
    const t1 = Date.now();
    await page.click('.sheet-nb-when [data-ago="15"]');
    await waitNoLayers(page);
    const early = newest(await q(page, { type: 'sleep' }));
    check('the wake-up is logged 15 min ago', early.endTime !== null && Math.abs(t1 - 15 * MIN - early.endTime) < 90 * 1000);
    await settle(page, 5800);

    // Log a past sleep with validation.
    console.log('\nsleep: log a past sleep');
    await openCard(page, 'sleep');
    check('home shows awake time since the last sleep', /Awake/.test(await page.textContent(`${TOP} [data-awake]`)));
    await page.click(`${TOP} [data-past]`);
    await page.waitForSelector(`${TOP} [data-start]`);
    await settle(page, 600);
    check('Log a past sleep steps forward', (await title(page)) === 'Past sleep');
    check('FLOW-10: a fresh open never starts on an error (defaults dodge the naps just logged)',
      !(await page.isDisabled(`${TOP} [data-log]`)) && !/overlaps/.test(await page.textContent(`${TOP} [data-error]`) || '') && /slept/.test(await page.textContent(`${TOP} [data-sum]`)),
      `${await page.textContent(`${TOP} [data-error]`)} ${await page.inputValue(`${TOP} input[data-start]`)}–${await page.inputValue(`${TOP} input[data-end]`)}`);
    // Wrong order.
    await page.click(`${TOP} [data-seg="startDay"] [data-value="-1"]`);
    await page.fill(`${TOP} input[data-start]`, '03:00');
    await page.click(`${TOP} [data-seg="endDay"] [data-value="-1"]`);
    await page.fill(`${TOP} input[data-end]`, '02:00');
    await settle(page, 150);
    check('end before start → calm error, Log disabled',
      /comes after falling asleep/.test(await page.textContent(`${TOP} [data-error]`)) && await page.isDisabled(`${TOP} [data-log]`));
    // Overlap with the nap logged a moment ago (≈ 20 → 15 min ago).
    const overlapEnd = new Date(Date.now() - 17 * MIN);
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const overlapStart = new Date(overlapEnd.getTime() - 60 * MIN);
    const sameDay = (a) => a.toDateString() === new Date().toDateString();
    await page.click(`${TOP} [data-seg="startDay"] [data-value="${sameDay(overlapStart) ? 0 : -1}"]`);
    await page.fill(`${TOP} input[data-start]`, hhmm(overlapStart));
    await page.click(`${TOP} [data-seg="endDay"] [data-value="${sameDay(overlapEnd) ? 0 : -1}"]`);
    await page.fill(`${TOP} input[data-end]`, hhmm(overlapEnd));
    await settle(page, 150);
    check('overlapping a logged sleep → says which one', /overlaps a nap logged/.test(await page.textContent(`${TOP} [data-error]`)),
      `${await page.textContent(`${TOP} [data-error]`)} ${await page.evaluate(() => [...document.querySelectorAll('.sheet-layer input, .sheet-layer [data-seg] [aria-checked="true"]')].map((e) => e.value || e.dataset.value).join(','))}`);
    // Valid: yesterday 13:00–14:30.
    await page.click(`${TOP} [data-seg="startDay"] [data-value="-1"]`);
    await page.fill(`${TOP} input[data-start]`, '13:00');
    await page.click(`${TOP} [data-seg="endDay"] [data-value="-1"]`);
    await page.fill(`${TOP} input[data-end]`, '14:30');
    await settle(page, 150);
    check('valid times → summary "Nap · slept 1h 30m"', /Nap · slept 1h 30m/.test(await page.textContent(`${TOP} [data-sum]`)) && !(await page.isDisabled(`${TOP} [data-log]`)));
    await auditTargets(page, 'past sleep');
    await shot(page, 'sleep-past-light');
    await page.click(`${TOP} [data-log]`);
    await waitNoLayers(page);
    const all = await q(page, { type: 'sleep' });
    const y = all.find((e) => new Date(e.startTime).getHours() === 13);
    check('the past nap is logged yesterday 1:00–2:30 PM', y && y.endTime - y.startTime === 90 * MIN && y.data.kind === 'nap' && !!y.babyId);

    // Two babies: independent sleeps, named titles.
    console.log('\nsleep: two babies');
    const ids = await page.evaluate(async (u) => {
      const { settings } = await import(u);
      const first = settings.get('activeBabyId');
      const theo = await settings.addBaby({ name: 'Theo' });
      return { first, theo: theo.id || theo };
    }, mod('/js/core/settings.js'));
    await page.evaluate(async ([u, id]) => { const { events } = await import(u); await events.start('sleep', { kind: 'nap' }, { startTime: Date.now() - 10 * 60000, babyId: id }); }, [mod('/js/core/store.js'), ids.first]);
    await setSetting(page, 'activeBabyId', ids.theo);
    await settle(page, 600);
    await openCard(page, 'sleep');
    check('Theo’s sleep sheet opens on home (Clara’s nap doesn’t block it)', (await title(page)) === 'Theo · Sleep');
    check('no wake-window hint without Theo’s birth date', !(await page.$(`${TOP} [data-hint]`)) && /Add Theo’s birth date/.test(await page.textContent(`${TOP} [data-birth]`)));
    await page.click(`${TOP} [data-start]`);
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 500);
    const both = await runningOf(page, 'sleep');
    check('twins can nap at once', both.length === 2 && both.some((e) => e.babyId === ids.theo) && both.some((e) => e.babyId === ids.first));
    check('Theo’s live title is named', /^Theo · /.test(await title(page)));
    await closeTop(page);
    check('two sleep pills, named', (await page.$$eval('#livePills .lpill[data-kind="sleep"] .lpill-title', (els) => els.map((e) => e.textContent).sort().join('|'))).includes('Theo'));
    await patchTrackers(page, { sleep: false });
    await settle(page, 400);
    check('Sleep hidden → no sleep card on Today', !(await page.$('[data-view="today"] [data-card="sleep"]')));
    check('…but running sleeps keep their pills (data kept)', (await page.$$('#livePills .lpill[data-kind="sleep"]')).length === 2);
    await context.close();
  }

  // ============================================================== DIAPER
  console.log('\ndiaper: one tap, Undo, back-date, details');
  {
    const { context, page } = await freshPage();
    await openCard(page, 'diaper');
    check('diaper card opens the diaper sheet', (await title(page)) === 'Diaper');
    check('Wet / Dirty / Both / Dry one-tap tiles', (await page.$$eval(`${TOP} [data-kind] .tile-label`, (els) => els.map((e) => e.textContent).join('|'))) === 'Wet|Dirty|Both|Dry');
    await auditTargets(page, 'diaper');
    await noPronouns(page, 'diaper');
    await shot(page, 'diaper-light');
    await page.dblclick(`${TOP} [data-kind="wet"]`);
    check('one tap closes the sheet', await waitNoLayers(page));
    await settle(page, 300);
    let list = await q(page, { type: 'diaper' });
    check('…and logs exactly one wet diaper for the baby', list.length === 1 && list[0].data.kind === 'wet' && !!list[0].babyId, JSON.stringify(list.map((e) => e.data)));
    check('toast: "Wet diaper logged" + Undo', /Wet diaper logged/.test(await toastText(page)) && /Undo/.test(await toastText(page)));
    await settle(page, 400); // past the toast's enter guard
    await page.click('#toastRoot .toast-action');
    await settle(page, 500);
    check('Undo removes it', (await q(page, { type: 'diaper' })).length === 0);

    // Back-date with the time chip.
    await openCard(page, 'diaper');
    await page.click(`${TOP} .sheet-hd [data-when]`);
    await page.waitForSelector('.sheet-layer.sheet-nb-when[data-state="open"]');
    await settle(page, 450);
    const t2 = Date.now();
    await page.click('.sheet-nb-when [data-ago="15"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 1, null, { timeout: 3000 });
    await settle(page, 300);
    await page.click(`${TOP} [data-kind="dirty"]`);
    await waitNoLayers(page);
    list = await q(page, { type: 'diaper' });
    check('a back-dated dirty diaper lands 15 min ago', list.length === 1 && list[0].data.kind === 'dirty' && Math.abs(t2 - 15 * MIN - list[0].startTime) < 90 * 1000);
    check('the toast says when', /Dirty diaper logged · \d/.test(await toastText(page)), await toastText(page));
    await settle(page, 600);

    // Details step.
    await openCard(page, 'diaper');
    check('the sheet counts today’s changes', /1/.test(await page.textContent(`${TOP} [data-intro]`)) && /1 today/.test(await page.textContent(`${TOP} [data-ctx="dirty"]`)));
    await page.click(`${TOP} [data-details]`);
    await page.waitForSelector(`${TOP} [data-seg="kind"]`);
    await settle(page, 500);
    check('details step: color + texture collapsed for wet', (await page.evaluate(() => { const m = document.querySelector('.sheet-layer [data-more]'); return m.inert && m.classList.contains('is-collapsed'); })));
    await page.click(`${TOP} [data-seg="kind"] [data-value="both"]`);
    await settle(page, 350);
    check('choosing Both opens color + texture', await page.evaluate(() => { const m = document.querySelector('.sheet-layer [data-more]'); return !m.inert && !m.classList.contains('is-collapsed'); }));
    await page.click(`${TOP} [data-toggles="color"] [data-value="yellow"]`);
    await page.click(`${TOP} [data-toggles="texture"] [data-value="seedy"]`);
    await page.fill(`${TOP} [data-note]`, '<b>after bath</b>');
    await auditTargets(page, 'diaper details');
    await shot(page, 'diaper-details-light');
    await page.click(`${TOP} [data-save]`);
    await waitNoLayers(page);
    list = await q(page, { type: 'diaper' });
    const both = list.find((e) => e.data.kind === 'both');
    check('details saved: both · yellow · seedy · note as plain text', both && both.data.color === 'yellow' && both.data.consistency === 'seedy' && both.note === '<b>after bath</b>', JSON.stringify(both));
    check('no markup was injected', !(await page.$('[data-view="today"] b:text("after bath")')));
    await patchTrackers(page, { diaper: false });
    await settle(page, 400);
    check('Diaper hidden → no diaper card on Today', !(await page.$('[data-view="today"] [data-card="diaper"]')));
    await context.close();
  }

  // ====================================================== FROM THE +
  console.log('\nquick log (+) → pump / sleep tiles open these sheets from the +');
  {
    const { context, page } = await freshPage();
    for (const [key, want] of [['pump', 'Pump'], ['sleep', 'Sleep']]) {
      await page.click('#fab');
      await page.waitForSelector(`.sheet-layer[data-state="open"] [data-key="${key}"]`);
      await settle(page, 500);
      await page.click(`.sheet-layer [data-key="${key}"]`);
      await page.waitForFunction((w) => { const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop(); return l && l.querySelector('.sheet-title').textContent === w; }, want, { timeout: 4000 }).catch(() => {});
      await settle(page, 600);
      check(`+ → ${key} tile opens the ${key} sheet (grown from the +, × twin)`, (await title(page)) === want && (await layerCount(page)) === 1 && !!(await page.$(`${TOP} .fab-x`)));
      await page.click(`${TOP} .fab-x`);
      check(`the × closes the ${key} sheet back into the +`, await waitNoLayers(page));
      await settle(page, 300);
    }
    await context.close();
  }

  // ======================================================= NIGHT + REDUCED
  console.log('\nnight theme screenshots');
  {
    const { context, page } = await freshPage({ dark: true });
    await openCard(page, 'pump');
    await shot(page, 'pump-home-night');
    await page.click(`${TOP} [data-start]`);
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 500);
    await closeTop(page);
    await page.click('#livePills .lpill[data-kind="pump"] .lpill-finish');
    await page.waitForSelector(`${TOP} [data-amount]`);
    await settle(page, 600);
    await shot(page, 'pump-amount-night');
    await page.click(`${TOP} [data-finish]`);
    await waitNoLayers(page);
    await openCard(page, 'sleep');
    await shot(page, 'sleep-home-night');
    await page.click(`${TOP} [data-start]`);
    await page.waitForSelector(`${TOP} [data-timer]`);
    await settle(page, 600);
    await shot(page, 'sleep-live-night');
    await closeTop(page);
    await openCard(page, 'diaper');
    await shot(page, 'diaper-night');
    await page.click(`${TOP} [data-details]`);
    await settle(page, 500);
    await page.click(`${TOP} [data-seg="kind"] [data-value="dirty"]`);
    await settle(page, 350);
    await shot(page, 'diaper-details-night');
    await closeTop(page);
    // Reduced motion: still one tap, still closes.
    await setSetting(page, 'reduceMotion', true);
    await settle(page, 200);
    await openCard(page, 'diaper');
    await page.click(`${TOP} [data-kind="both"]`);
    check('reduced motion: one tap still logs + closes', await waitNoLayers(page) && (await q(page, { type: 'diaper' })).length === 1);
    await context.close();
  }

  for (const page of pages) {
    if (page.isClosed()) continue;
    const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
    if (csp.length) consoleErrors.push(...csp.map((c) => `CSP: ${c}`));
  }
  check('zero console errors / CSP violations', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero non-local requests', foreign.length === 0, foreign.join(' | '));
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nlogsheets: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
