// e2e: the feed sheet (js/sheets/feed.js) on a FRESH profile at 390×844.
//
//  - bottle form: milk segmented control, amount stepper (spinbutton, hold
//    to repeat, presets, keypad sheet with no layout jump), time chip →
//    time picker, Log finished bottle (in-sheet "Logged", stored in the unit
//    entered, back-dated)
//  - live bottle: Start → live view (no second sheet), pill → sheet, pill
//    Finish → "How much did <name> drink?", prepared amount preselected,
//    pace, finish; expired bottle → "Time's up", Discard + Undo
//  - from the stash: thawed / fridge pouches as sources, expired ones listed
//    but not pickable (their Discard works), the pouch is consumed exactly once
//  - breastfeeding: "Which side first?" → L/R timer, switch, pause/resume,
//    finish; then "Start on left · last was R"; Log a past feed
//  - mL, night theme, two babies, hidden trackers
//  - express gesture: hold + → pad, slide, lift → logged + Undo; lift on the
//    + cancels; the hold never opens the quick-log sheet
//  - zero console errors, zero non-local requests, ≥44px targets with names
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/feed.mjs

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

async function freshPage({ dark = false, touch = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light',
    hasTouch: touch, isMobile: touch, serviceWorkers: 'block',
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
  await page.waitForTimeout(400);
  return { context, page };
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function setSetting(page, key, value) {
  await page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}
async function patchTrackers(page, patch) {
  await page.evaluate(async ([u, p]) => { const { settings } = await import(u); await settings.patch('trackers', p); }, [mod('/js/core/settings.js'), patch]);
}
const layers = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet-layer')].map((l) => l.getAttribute('data-state')));
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const topSheet = '.sheet-layer[data-state="open"]:last-of-type';
const title = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop(); return l ? l.querySelector('.sheet-title').textContent : null; });
const feeds = (page) => page.evaluate(async (u) => (await (await import(u)).events.query({ type: 'feed' })), mod('/js/core/store.js'));
const running = (page) => page.evaluate(async (u) => (await (await import(u)).events.running('feed')), mod('/js/core/store.js'));
const startEvent = (page, data, agoMin = 5) => page.evaluate(async ([u, d, ago]) => {
  const { events } = await import(u);
  return (await events.start('feed', d, { startTime: Date.now() - ago * 60000 })).id;
}, [mod('/js/core/store.js'), data, agoMin]);

// Open the feed sheet exactly as ctx.sheets.feed would (same module instance as the app).
async function openFeed(page, opts = {}) {
  await page.evaluate(async ([base, o]) => {
    const imp = (p) => import(base + p);
    const [{ openSheet, motionReduced }, { toast }, { confirmSheet }, { settings }, store, { stash }, units, time, { format }, { icons }, h, { livePill }, feed] = await Promise.all([
      imp('/js/ui/sheet.js'), imp('/js/ui/toast.js'), imp('/js/ui/confirm.js'), imp('/js/core/settings.js'), imp('/js/core/store.js'), imp('/js/core/stash.js'),
      imp('/js/core/units.js'), imp('/js/core/time.js'), imp('/js/ui/format.js'), imp('/js/ui/icons.js'), imp('/js/ui/html.js'), imp('/js/ui/livePill.js'), imp('/js/sheets/feed.js'),
    ]);
    const ctx = {
      openSheet, toast, confirmSheet, settings, events: store.events, stash, units, time, format, icons,
      html: { html: h.html, raw: h.raw, render: h.render, cls: h.cls, element: h.element, fragment: h.fragment },
      livePill, RunningActivityError: store.RunningActivityError, activeBaby: () => settings.activeBaby(), motionReduced,
      router: { go() {}, push() {} }, get fab() { return document.getElementById('fab'); },
    };
    feed.openFeedSheet(ctx, { origin: document.getElementById('fab'), ...o });
  }, [BASE_URL, opts]);
  await page.waitForSelector('.sheet-layer[data-state="open"] .sheet-feed, .sheet-layer.sheet-feed[data-state="open"]');
  await settle(page, 500);
}
async function openBottleFromPlus(page) {
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="bottle"]');
  await settle(page);
  await page.click('.sheet-layer [data-key="bottle"]');
  await page.waitForSelector('.sheet-layer.sheet-feed[data-state="open"] [data-start]');
  await settle(page, 600);
}

// Every interactive thing in the open sheet: real element, ≥44px, has a name.
async function auditTargets(page, label) {
  const bad = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop();
    const out = [];
    for (const el of l.querySelectorAll('button, input, a[href], [role="radio"], [role="spinbutton"]')) {
      if (el.closest('[hidden]') || el.classList.contains('sheet-close') || el.getClientRects().length === 0) continue;
      const r = el.getBoundingClientRect();
      // A segment's hit area spans its 44px track (::after), an input's its label.
      const target = el.matches('input') ? el.closest('label') || el : el.closest('.segmented') || el;
      const tr = target.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim()
        || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim())
        || (el.closest('label') && el.closest('label').textContent.trim());
      if (Math.max(r.height, tr.height) < 44 || Math.max(r.width, tr.width) < 44) out.push(`${el.tagName}.${el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!name) out.push(`${el.tagName}.${el.className} has no name`);
      if (!['BUTTON', 'INPUT', 'A'].includes(el.tagName)) out.push(`${el.tagName} is not a real control`);
    }
    return out;
  });
  check(`${label}: every control is real, ≥44px and named`, bad.length === 0, bad.join(' | '));
}

try {
  // ==================================================== bottle form + log
  console.log('\nbottle form → log a finished bottle');
  {
    const { context, page } = await freshPage();
    await openBottleFromPlus(page);
    check('quick-log Bottle tile → one feed sheet titled "Bottle"', (await layers(page)).join() === 'open' && await title(page) === 'Bottle');
    check('header time chip reads "Now"', /^Now/.test((await page.textContent('.sheet-feed [data-when]')).trim()));
    check('milk is a radiogroup of Formula / Breast milk / From stash', await page.evaluate(() => {
      const g = document.querySelector('.sheet-feed [data-seg="milk"]');
      return g.getAttribute('role') === 'radiogroup' && [...g.querySelectorAll('[role="radio"]')].map((b) => b.textContent.trim()).join('|') === 'Formula|Breast milk|From stash';
    }));
    const sp = () => page.evaluate(() => { const i = document.querySelector('.sheet-feed [role="spinbutton"]'); return { now: i.getAttribute('aria-valuenow'), text: i.getAttribute('aria-valuetext'), min: i.getAttribute('aria-valuemin'), max: i.getAttribute('aria-valuemax') }; });
    let s = await sp();
    check('amount is a spinbutton at 4 oz with min/max/valuetext', s.now === '4' && s.text === '4 ounces' && s.min === '0.5' && s.max === '16', JSON.stringify(s));
    check('presets 2 / 4 / 6 / 8 oz, 4 pressed', await page.evaluate(() => [...document.querySelectorAll('.sheet-feed [data-preset]')].map((c) => `${c.textContent.trim()}${c.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join(',')) === '2 oz,4 oz*,6 oz,8 oz');
    await auditTargets(page, 'bottle form');
    await page.screenshot({ path: `${SHOTS}feed-bottle-light.png` });

    await page.click('.sheet-feed [data-inc]');
    check('+ steps 0.5 oz', (await sp()).now === '4.5');
    await page.click('.sheet-feed [data-preset="6"]');
    check('preset 6 oz sets 6', (await sp()).now === '6');
    await page.focus('.sheet-feed [role="spinbutton"]');
    await page.keyboard.press('ArrowDown');
    check('ArrowDown on the spinbutton steps down', (await sp()).now === '5.5');
    // Hold − to repeat (8/s after 400 ms).
    const dec = await (await page.$('.sheet-feed [data-dec]')).boundingBox();
    await page.mouse.move(dec.x + dec.width / 2, dec.y + dec.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    const held = Number((await sp()).now);
    check('holding − repeats', held <= 3.5 && held >= 1, `now ${held}`);
    // Keypad: same-size value, no layout jump.
    const before = await page.evaluate(() => { const r = document.querySelector('.sheet-feed .fd-stepper').getBoundingClientRect(); return { h: r.height, y: r.top }; });
    await page.click('.sheet-feed [role="spinbutton"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer[data-state="open"]').length === 2);
    await settle(page);
    check('tapping the value opens the keypad sheet', /How much/.test(await title(page)));
    await page.screenshot({ path: `${SHOTS}feed-keypad-light.png` });
    for (const k of ['3', '.', '5']) await page.click(`.sheet-keypad [data-key="${k}"]`);
    check('keypad readout shows 3.5', (await page.textContent('.sheet-keypad [data-kp-val]')) === '3.5');
    await page.click('.sheet-keypad [data-kp-done]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 1);
    const after = await page.evaluate(() => { const r = document.querySelector('.sheet-feed .fd-stepper').getBoundingClientRect(); return { h: r.height, y: r.top }; });
    check('keypad value lands in the stepper (3.5)', (await sp()).now === '3.5');
    check('…with no layout jump', Math.abs(before.h - after.h) < 1 && Math.abs(before.y - after.y) < 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    check('focus returned to the spinbutton', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role') === 'spinbutton'));

    // Formula + back-date 30 min.
    await page.click('.sheet-feed [data-seg="milk"] [data-value="formula"]');
    check('formula safety note says 1 hour', /Formula is good for 1 hour/.test(await page.textContent('.sheet-feed [data-safety-note]')));
    await page.click('.sheet-feed [data-when]');
    await page.waitForSelector('.sheet-when[data-state="open"] [data-ago="30"]');
    await settle(page);
    check('time chip opens the time picker', await title(page) === 'When?');
    await page.screenshot({ path: `${SHOTS}feed-when-light.png` });
    await page.click('.sheet-when [data-ago="30"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 1);
    check('chip now reads "Today …"', /^Today/.test((await page.textContent('.sheet-feed [data-when]')).trim()));
    await page.click('.sheet-feed [data-log]');
    await page.waitForSelector('.sheet-feed [data-log].is-success');
    check('in-sheet success: the button says Logged', /Logged/.test(await page.textContent('.sheet-feed [data-log]')));
    check('…and the sheet closes on its own', await waitNoLayers(page));
    const f = (await feeds(page))[0];
    const ago = Date.now() - (f && f.startTime);
    check('stored: bottle, formula, 3.5 oz, finished, back-dated 30 min', f && f.data.method === 'bottle' && f.data.milk === 'formula' && f.data.amount === 3.5 && f.data.unit === 'oz' && f.endTime === f.startTime && ago > 29 * 60000 && ago < 32 * 60000, JSON.stringify(f && f.data));
    check('focus back on the +', await page.evaluate(() => document.activeElement && document.activeElement.id === 'fab'));
    check('no toast for a foreground success', await page.evaluate(() => !document.querySelector('.toast')));
    await context.close();
  }

  // ============================================================ live bottle
  console.log('\nlive bottle: start → pill → finish');
  {
    const { context, page } = await freshPage();
    await openBottleFromPlus(page);
    await page.click('.sheet-feed [data-seg="milk"] [data-value="breastmilk"]');
    await page.click('.sheet-feed [data-preset="4"]');
    await page.click('.sheet-feed [data-start]');
    await page.waitForSelector('.sheet-feed [data-finish]');
    await settle(page, 600);
    check('Start morphs the same sheet into the live bottle (no second sheet)', (await layers(page)).join() === 'open');
    const r = await running(page);
    check('a running bottle exists with prepared 4 oz', r.length === 1 && r[0].data.prepared === 4 && r[0].data.milk === 'breastmilk', JSON.stringify(r[0] && r[0].data));
    check('live view: safety countdown "Good for 2h…"', /Good for 2h/.test(await page.textContent('.sheet-feed [data-safety]')));
    check('chip reads "Started …"', /^Started/.test((await page.textContent('.sheet-feed [data-when]')).trim()));
    check('Finish label carries the amount', /Finish · 4 oz/.test(await page.textContent('.sheet-feed [data-finish]')));
    await auditTargets(page, 'live bottle');
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await page.waitForSelector('.lpill[data-kind="bottle"]');
    check('closing the sheet leaves the bottle running as a pill', true);
    // Back-date the running bottle so pace has something to show.
    await page.evaluate(async ([u, id]) => { const { events } = await import(u); await events.update(id, { startTime: Date.now() - 12 * 60000 }); }, [mod('/js/core/store.js'), r[0].id]);
    await settle(page, 300);
    await page.click('.lpill-finish');
    await page.waitForSelector('.sheet-feed [data-finish]');
    await settle(page, 600);
    check('pill Finish → "How much did Baby drink?"', await title(page) === 'How much did Baby drink?');
    check('…with the prepared amount preselected and focused', await page.evaluate(() => { const i = document.querySelector('.sheet-feed [role="spinbutton"]'); return i.getAttribute('aria-valuenow') === '4' && document.activeElement === i; }));
    await page.click('.sheet-feed [data-dec]');
    await page.waitForTimeout(150);
    await page.click('.sheet-feed [data-dec]');
    check('pace is shown (amount / minutes)', /Pace\s+0\.\d oz a minute · 12 min/.test(await page.textContent('.sheet-feed [data-pace]')), await page.textContent('.sheet-feed [data-pace]'));
    await page.screenshot({ path: `${SHOTS}feed-finish-light.png` });
    await page.click('.sheet-feed [data-finish]');
    check('finish closes the sheet', await waitNoLayers(page));
    const done = (await feeds(page)).find((e) => e.id === r[0].id);
    check('stored 3 oz drank, prepared 4 oz, finished', done && done.endTime !== null && done.data.amount === 3 && done.data.prepared === 4, JSON.stringify(done && done.data));
    await page.waitForFunction(() => !document.querySelector('.lpill:not([inert])'), null, { timeout: 3000 }).catch(() => {});
    check('the pill is gone', await page.evaluate(() => !document.querySelector('.lpill:not([inert])')));

    // Opening the Bottle tile while a bottle runs opens the live bottle.
    const id2 = await startEvent(page, { method: 'bottle', milk: 'formula', amount: 4, prepared: 4, unit: 'oz' }, 2);
    await page.waitForSelector('.lpill');
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="bottle"]');
    await settle(page);
    await page.click('.sheet-layer [data-key="bottle"]');
    await page.waitForSelector('.sheet-layer.sheet-feed[data-state="open"] [data-finish]');
    check('Bottle tile while a bottle runs → its live view, not a second bottle', (await running(page)).length === 1);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);

    // Discard (secondary in the live view) → Undo.
    await page.click('.lpill-open');
    await page.waitForSelector('.sheet-feed [data-discard]');
    await settle(page);
    await page.click('.sheet-feed [data-discard]');
    await waitNoLayers(page);
    await page.waitForSelector('.toast[data-state="in"] .toast-action');
    check('Discard → "Bottle discarded" toast with Undo', /Bottle discarded/.test(await page.textContent('.toast-msg')) && (await running(page)).length === 0);
    await settle(page);
    await page.click('.toast-action');
    await page.waitForFunction(async () => document.querySelector('.lpill'), null, { timeout: 3000 }).catch(() => {});
    check('Undo brings the running bottle back', (await running(page)).some((e) => e.id === id2));
    await context.close();
  }

  // ======================================================= expired bottle
  console.log('\nexpired bottle');
  {
    const { context, page } = await freshPage();
    const id = await startEvent(page, { method: 'bottle', milk: 'formula', amount: 4, prepared: 4, unit: 'oz' }, 70);
    await page.waitForSelector('.lpill[data-level="expired"]');
    await settle(page);
    check('pill offers Discard', (await page.textContent('.lpill-finish')).trim() === 'Discard');
    await page.click('.lpill-open');
    await page.waitForSelector('.sheet-feed [data-expired]:not([hidden])');
    await settle(page, 600);
    check('live view: "Time’s up — use a fresh bottle."', /Time’s up — use a fresh bottle/.test(await page.textContent('.sheet-feed [data-expired]')));
    check('…Discard is now the primary, logging stays possible', await page.evaluate(() => {
      const f = document.querySelector('.sheet-feed .sheet-footer');
      return f.firstElementChild.matches('[data-discard].btn-primary') && f.querySelector('[data-finish]').classList.contains('btn-secondary');
    }));
    await page.screenshot({ path: `${SHOTS}feed-expired-light.png` });
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await page.click('.lpill-finish');
    await page.waitForSelector('.toast[data-state="in"] .toast-action');
    check('pill Discard removes it with an Undo toast', (await running(page)).length === 0 && /Bottle discarded/.test(await page.textContent('.toast-msg')));
    void id;
    await context.close();
  }

  // ============================================================== stash
  console.log('\nfrom the stash');
  {
    const { context, page } = await freshPage();
    const ids = await page.evaluate(async (u) => {
      const { stash } = await import(u);
      const frozen = await stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: Date.now() - 20 * 86400000 });
      const thawed = await stash.thaw(frozen.id);
      const old = await stash.add({ quantity: 3, unit: 'oz', location: 'fridge', pumpedAt: Date.now() - 4 * 86400000 - 3600000 });
      return { thawed: thawed.id, old: old.id };
    }, mod('/js/core/stash.js'));
    await settle(page, 300);
    await openBottleFromPlus(page);
    await page.click('.sheet-feed [data-seg="milk"] [data-value="stash"]');
    await settle(page, 300);
    const src = await page.evaluate(() => ({
      radios: [...document.querySelectorAll('.sheet-feed [data-sources] [role="radio"]')].map((b) => `${b.dataset.src}:${b.getAttribute('aria-checked')}`),
      expired: [...document.querySelectorAll('.sheet-feed .fd-src.is-expired')].length,
      expiredIsRadio: !!document.querySelector('.sheet-feed .fd-src.is-expired[role="radio"]'),
      amount: document.querySelector('.sheet-feed [role="spinbutton"]').getAttribute('aria-valuenow'),
    }));
    check('the thawed pouch is the (selected) source', src.radios.join() === `${ids.thawed}:true`, JSON.stringify(src));
    check('the expired pouch is shown but not pickable', src.expired === 1 && !src.expiredIsRadio);
    check('picking the pouch sets its amount (5 oz)', src.amount === '5');
    await auditTargets(page, 'stash sources');
    await page.screenshot({ path: `${SHOTS}feed-stash-light.png` });
    await page.click('.sheet-feed [data-discard-src]');
    await page.waitForSelector('.toast[data-state="in"]');
    check('expired pouch Discard → toast with Undo', /Pouch discarded/.test(await page.textContent('.toast-msg')));
    await page.waitForFunction(() => !document.querySelector('.sheet-feed .fd-src.is-expired'), null, { timeout: 2000 }).catch(() => {});
    check('…and it leaves the list', await page.evaluate(() => !document.querySelector('.sheet-feed .fd-src.is-expired')));
    await page.click('.sheet-feed [data-preset="4"]');
    await page.click('.sheet-feed [data-start]');
    await page.waitForSelector('.sheet-feed [data-finish]');
    await settle(page, 500);
    const r = (await running(page))[0];
    check('running bottle remembers its source + prepared 4 oz', r && r.data.sourceInventoryId === ids.thawed && r.data.prepared === 4);
    await page.click('.sheet-feed [data-dec]');
    await page.click('.sheet-feed [data-finish]');
    await waitNoLayers(page);
    const pouch = () => page.evaluate(async ([u, id]) => (await (await import(u)).stash.get(id)), [mod('/js/core/stash.js'), ids.thawed]);
    let p = await pouch();
    check('the pouch lost exactly the prepared 4 oz', p.quantity === 1 && p.status === 'active' && (p.consumedBy || []).length === 1, JSON.stringify({ q: p.quantity, s: p.status, c: p.consumedBy }));
    // A retry can't take milk twice.
    await page.evaluate(async ([u1, u2, id]) => { const { events } = await import(u1); const { stash } = await import(u2); const e = await events.get(id); await stash.consumeForFeed(e); }, [mod('/js/core/store.js'), mod('/js/core/stash.js'), r.id]);
    p = await pouch();
    check('…exactly once (consumeForFeed again is a no-op)', p.quantity === 1);
    await context.close();
  }

  // ======================================================== breastfeeding
  console.log('\nbreastfeeding');
  {
    const { context, page } = await freshPage();
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="breast"]');
    await settle(page);
    await page.click('.sheet-layer [data-key="breast"]');
    await page.waitForSelector('.sheet-feed [data-side="left"]');
    await settle(page, 600);
    check('"Breastfeed" with "Which side first?" on a fresh profile', await title(page) === 'Breastfeed' && /Which side first/.test(await page.textContent('.sheet-feed .fd-hint')));
    await auditTargets(page, 'breast picker');
    await page.screenshot({ path: `${SHOTS}feed-breast-light.png` });
    await page.click('.sheet-feed [data-side="left"]');
    await page.waitForSelector('.sheet-feed [data-pause]');
    await settle(page, 1300);
    let r = (await running(page))[0];
    check('Left starts a running breastfeed on the left', r && r.data.method === 'breast' && r.data.activeSide === 'left');
    check('left tile is live (aria-pressed)', await page.evaluate(() => document.querySelector('.sheet-feed [data-side="left"]').getAttribute('aria-pressed') === 'true'));
    await auditTargets(page, 'live breastfeed');
    await page.click('.sheet-feed [data-side="right"]');
    await page.waitForFunction(() => document.querySelector('.sheet-feed [data-side="right"]').getAttribute('aria-pressed') === 'true');
    r = (await running(page))[0];
    check('switch sides banks the left seconds', r.data.activeSide === 'right' && r.data.left >= 1, JSON.stringify(r.data));
    await page.screenshot({ path: `${SHOTS}feed-breast-live-light.png` });
    await page.click('.sheet-feed [data-pause]');
    await page.waitForFunction(() => /Resume/.test(document.querySelector('.sheet-feed [data-pause]').textContent));
    check('Pause → paused (no active side)', (await running(page))[0].data.activeSide === null);
    await page.click('.sheet-feed [data-pause]');
    await page.waitForFunction(() => /Pause/.test(document.querySelector('.sheet-feed [data-pause]').textContent));
    check('Resume picks the last side (right)', (await running(page))[0].data.activeSide === 'right');
    await page.click('.sheet-feed [data-finish]');
    check('Finish closes the sheet', await waitNoLayers(page));
    const fin = (await feeds(page))[0];
    check('stored a finished breastfeed with both sides', fin.endTime !== null && fin.data.left >= 1 && fin.data.lastSide === 'right' && fin.data.activeSide === null, JSON.stringify(fin.data));

    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="breast"]');
    await settle(page);
    await page.click('.sheet-layer [data-key="breast"]');
    await page.waitForSelector('.sheet-feed .fd-hint');
    await settle(page, 500);
    check('next time: "Start on left · last was R"', /Start on left · last was R/.test(await page.textContent('.sheet-feed .fd-hint')));
    check('…and the left tile is suggested', await page.evaluate(() => document.querySelector('.sheet-feed [data-side="left"]').classList.contains('is-suggested')));
    await page.click('.sheet-feed [data-past]');
    await page.waitForSelector('.sheet-feed [data-stepper="l"]');
    await settle(page, 500);
    await page.click('.sheet-feed [data-stepper="l"] [data-preset="15"]');
    await page.click('.sheet-feed [data-stepper="r"] [data-preset="5"]');
    await page.click('.sheet-feed [data-log]');
    await waitNoLayers(page);
    const past = (await feeds(page)).find((e) => e.data.left === 900);
    check('Log a past feed: L 15 min, R 5 min, 20 min long', past.data.left === 900 && past.data.right === 300 && past.endTime - past.startTime === 20 * 60000, JSON.stringify(past.data));

    // Pill: Finish logs in one tap (+ Undo); Resume when paused.
    const bid = await startEvent(page, { method: 'breast', activeSide: 'left', lastSide: 'left' }, 6);
    await page.waitForSelector('.lpill[data-kind="breast"]');
    await settle(page);
    await page.click('.lpill-finish');
    await page.waitForSelector('.toast[data-state="in"] .toast-action');
    check('breast pill Finish logs it in one tap with Undo', /Breastfeed logged/.test(await page.textContent('.toast-msg')) && (await running(page)).length === 0);
    await settle(page);
    await page.click('.toast-action');
    await page.waitForFunction(() => document.querySelector('.lpill[data-kind="breast"]:not([inert])'), null, { timeout: 3000 }).catch(() => {});
    check('Undo resumes it on the same side', (await running(page)).some((e) => e.id === bid && e.data.activeSide === 'left'));
    await context.close();
  }

  // ============================================================ mL + night
  console.log('\nmL + night');
  {
    const { context, page } = await freshPage({ dark: true });
    await setSetting(page, 'units', 'mL');
    await openBottleFromPlus(page);
    const s = await page.evaluate(() => { const i = document.querySelector('.sheet-feed [role="spinbutton"]'); return { now: i.getAttribute('aria-valuenow'), text: i.getAttribute('aria-valuetext'), unit: document.querySelector('.sheet-feed [data-unit]').textContent }; });
    check('mL: default 120 mL, spoken in milliliters', s.now === '120' && s.text === '120 milliliters' && s.unit === 'mL', JSON.stringify(s));
    check('mL presets 60 / 120 / 180 / 240', await page.evaluate(() => [...document.querySelectorAll('.sheet-feed [data-preset]')].map((c) => c.dataset.preset).join()) === '60,120,180,240');
    await page.click('.sheet-feed [data-inc]');
    check('+ steps 10 mL', await page.evaluate(() => document.querySelector('.sheet-feed [role="spinbutton"]').getAttribute('aria-valuenow')) === '130');
    await page.screenshot({ path: `${SHOTS}feed-bottle-night.png` });
    await page.click('.sheet-feed [data-log]');
    await waitNoLayers(page);
    const f = (await feeds(page))[0];
    check('stored in the unit entered (130 mL)', f.data.amount === 130 && f.data.unit === 'mL');
    // Night screenshots of the other views.
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="bottle"]');
    await settle(page);
    await page.click('.sheet-layer [data-key="bottle"]');
    await page.waitForSelector('.sheet-feed [data-start]');
    await settle(page, 500);
    await page.click('.sheet-feed [data-start]');
    await page.waitForSelector('.sheet-feed [data-finish]');
    await settle(page, 700);
    await page.screenshot({ path: `${SHOTS}feed-live-night.png` });
    // Units switched to oz while the sheet is open: the value converts.
    await setSetting(page, 'units', 'oz');
    await page.waitForFunction(() => document.querySelector('.sheet-feed [data-unit]').textContent === 'oz');
    check('switching units while open converts the value (130 mL → 4.4 oz)', await page.evaluate(() => document.querySelector('.sheet-feed [role="spinbutton"]').getAttribute('aria-valuenow')) === '4.4');
    await page.click('.sheet-feed [data-finish]');
    await waitNoLayers(page);
    const f2 = (await feeds(page)).find((e) => e.endTime !== null && e.data.unit === 'oz');
    check('finish in oz converts prepared too (stays consistent)', f2 && f2.data.amount === 4.4 && Math.abs(f2.data.prepared - 4.4) < 0.05, JSON.stringify(f2 && f2.data));
    await openFeed(page, { preset: { method: 'breast' } });
    await page.click('.sheet-feed [data-side="right"]');
    await page.waitForSelector('.sheet-feed [data-pause]');
    await settle(page, 700);
    await page.screenshot({ path: `${SHOTS}feed-breast-live-night.png` });
    await page.click('.sheet-feed [data-finish]');
    await waitNoLayers(page);
    await page.evaluate(async (u) => {
      const { stash } = await import(u);
      const a = await stash.add({ quantity: 120, unit: 'mL', location: 'fridge', pumpedAt: Date.now() - 86400000 });
      void a;
      const z = await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: Date.now() - 9 * 86400000 });
      await stash.thaw(z.id);
    }, mod('/js/core/stash.js'));
    await settle(page, 200);
    await openFeed(page, { preset: { method: 'bottle', milk: 'stash' } });
    await page.screenshot({ path: `${SHOTS}feed-stash-night.png` });
    check('thawed milk is listed before fridge milk', await page.evaluate(() => [...document.querySelectorAll('.sheet-feed [data-src] .chip-ic .ic')].map((i) => i.classList[1]).join()) === 'ic-thaw,ic-fridge');
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await context.close();
  }

  // =================================================== multi-baby + trackers
  console.log('\ntwo babies + hidden trackers');
  {
    const { context, page } = await freshPage();
    const [a, b] = await page.evaluate(async (u) => {
      const { settings } = await import(u);
      const first = settings.activeBaby();
      await settings.updateBaby(first.id, { name: 'Ada' });
      const second = await settings.addBaby({ name: 'Bo' });
      return [first.id, second.id];
    }, mod('/js/core/settings.js'));
    await settle(page, 300);
    const bottleA = await startEvent(page, { method: 'bottle', milk: 'formula', amount: 4, prepared: 4, unit: 'oz' }, 3);
    await setSetting(page, 'activeBabyId', b);
    await settle(page, 300);
    await openBottleFromPlus(page);
    check('second baby: the title names the baby, a form (Ada’s bottle is not Bo’s)', await title(page) === 'Bo · Bottle');
    await page.click('.sheet-feed [data-log]');
    await waitNoLayers(page);
    const bo = (await feeds(page)).find((e) => e.babyId === b);
    check('logged for the active baby (Bo)', !!bo);
    await page.click(`.lpill[data-event-id="${bottleA}"] .lpill-finish`);
    await page.waitForSelector('.sheet-feed [data-finish]');
    await settle(page, 500);
    check('finishing Ada’s pill asks "How much did Ada drink?"', await title(page) === 'How much did Ada drink?');
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    void a;

    await patchTrackers(page, { formula: false, stash: false });
    await openFeed(page, { preset: { method: 'bottle' } });
    check('formula + stash hidden → no milk choice (breast milk only)', await page.evaluate(() => !document.querySelector('.sheet-feed [data-seg="milk"]')));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await openFeed(page, {});
    check('no preset + both methods on → Bottle | Breastfeed switch', await page.evaluate(() => !!document.querySelector('.sheet-feed [data-seg="method"]')));
    await page.click('.sheet-feed [data-seg="method"] [data-value="breast"]');
    await page.waitForSelector('.sheet-feed .sheet-step:not(.is-leaving) [data-side="left"]');
    check('…switching method steps to the breast picker', true);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await patchTrackers(page, { breastfeeding: false });
    await openFeed(page, {});
    check('breastfeeding hidden → straight to the bottle form, no switch', await page.evaluate(() => !document.querySelector('.sheet-feed [data-seg="method"]') && !!document.querySelector('.sheet-feed [data-start]')));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await patchTrackers(page, { bottle: false, breastfeeding: false });
    await openFeed(page, {});
    check('both hidden → a warm empty state, never a blank sheet', /Feeding is hidden/.test(await page.textContent('.sheet-feed')));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    // bottle hidden → the + hold is just a tap (quick log), no pad.
    const fab = await (await page.$('#fab')).boundingBox();
    await page.mouse.move(fab.x + fab.width / 2, fab.y + fab.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    check('bottle hidden: holding + shows no express pad', await page.evaluate(() => !document.querySelector('.xp-layer')));
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await context.close();
  }

  // ===================================================== express gesture
  console.log('\nexpress gesture');
  {
    const { context, page } = await freshPage();
    const fab = await (await page.$('#fab')).boundingBox();
    const cx = fab.x + fab.width / 2;
    const cy = fab.y + fab.height / 2;
    const hold = async () => {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.waitForSelector('.xp-layer[data-state="open"]', { timeout: 2000 });
    };
    await hold();
    await page.waitForTimeout(450);
    check('holding + grows the express pad out of the +', await page.evaluate(() => {
      const p = document.querySelector('.xp-pad');
      return !!p && parseFloat(p.style.getPropertyValue('--gr')) > 20;
    }));
    // lower zone (default milk), +2 steps to the right.
    await page.mouse.move(cx + 8, cy - 40, { steps: 4 });
    await page.mouse.move(cx + 34, cy - 90, { steps: 6 });
    await page.waitForTimeout(100);
    const readout = await page.evaluate(() => ({ amt: document.querySelector('[data-xp-amt]').textContent, foot: document.querySelector('[data-xp-foot]').textContent, on: document.querySelector('.xp-zone.is-on b')?.textContent }));
    check('slide up a little picks the lower milk, sideways sets 5 oz', readout.amt === '5' && readout.on === 'Breast milk', JSON.stringify(readout));
    await page.screenshot({ path: `${SHOTS}feed-express-light.png` });
    await page.mouse.up();
    await page.waitForSelector('.toast[data-state="in"] .toast-action');
    await page.waitForFunction(() => !document.querySelector('.xp-layer'), null, { timeout: 2000 }).catch(() => {});
    let f = await feeds(page);
    check('lift logs a finished bottle (5 oz breast milk) with Undo', f.length === 1 && f[0].data.amount === 5 && f[0].data.milk === 'breastmilk' && f[0].endTime !== null && /Logged 5 oz breast milk/.test(await page.textContent('.toast-msg')));
    check('the hold never opened the quick-log sheet; the pad is gone', (await layers(page)).length === 0 && await page.evaluate(() => !document.querySelector('.xp-layer')));
    check('express use is counted for the quick-log tip', await page.evaluate(() => localStorage.getItem('nurture.expressUses') === '1'));
    await settle(page);
    await page.click('.toast-action');
    await page.waitForFunction(() => /Removed/.test(document.querySelector('.toast-msg')?.textContent || ''), null, { timeout: 2000 }).catch(() => {});
    check('Undo removes it', (await feeds(page)).length === 0);

    // Upper zone = the other milk (sticky until clearly back down).
    await page.waitForTimeout(1600);
    await hold();
    await page.mouse.move(cx, cy - 60, { steps: 4 });
    await page.mouse.move(cx - 18, cy - 260, { steps: 10 });
    const up = await page.evaluate(() => document.querySelector('.xp-zone.is-on b')?.textContent);
    await page.mouse.move(cx - 18, cy - 200, { steps: 3 });
    const sticky = await page.evaluate(() => document.querySelector('.xp-zone.is-on b')?.textContent);
    await page.mouse.up();
    await page.waitForSelector('.toast[data-state="in"]');
    f = await feeds(page);
    check('slide far up → Formula, and it sticks near the boundary', up === 'Formula' && sticky === 'Formula' && f[0] && f[0].data.milk === 'formula' && f[0].data.amount === 3.5, JSON.stringify({ up, sticky, d: f[0] && f[0].data }));

    // Lift on the + cancels.
    await page.waitForTimeout(600);
    const n = (await feeds(page)).length;
    await hold();
    await page.mouse.move(cx, cy - 80, { steps: 4 });
    await page.mouse.move(cx + 4, cy - 6, { steps: 4 });
    check('back on the + → "Lift on + to cancel"', /cancel/.test(await page.textContent('[data-xp-foot]')));
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.xp-layer'), null, { timeout: 2000 }).catch(() => {});
    await settle(page, 300);
    check('…and nothing is logged, no sheet opens', (await feeds(page)).length === n && (await layers(page)).length === 0);
    // Esc cancels too.
    await hold();
    await page.mouse.move(cx, cy - 90, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page, 400);
    check('Esc cancels the pad', (await feeds(page)).length === n && await page.evaluate(() => !document.querySelector('.xp-layer')));
    // A quick tap still opens quick log.
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="bottle"]');
    check('a plain tap on + still opens the quick-log sheet', true);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    // Hold while a bottle runs → its live sheet.
    await startEvent(page, { method: 'bottle', milk: 'formula', amount: 4, prepared: 4, unit: 'oz' }, 1);
    await page.waitForSelector('.lpill');
    await settle(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForSelector('.sheet-layer.sheet-feed[data-state="open"] [data-finish]', { timeout: 2000 });
    await page.mouse.up();
    await settle(page, 500);
    check('hold while a bottle runs → the live bottle sheet (one sheet)', (await layers(page)).join() === 'open' && await page.evaluate(() => !document.querySelector('.xp-layer')));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await context.close();
  }

  // ====================================================== reduced motion
  console.log('\nreduced motion');
  {
    const { context, page } = await freshPage();
    await setSetting(page, 'reduceMotion', true);
    const fab = await (await page.$('#fab')).boundingBox();
    await page.mouse.move(fab.x + fab.width / 2, fab.y + fab.height / 2);
    await page.mouse.down();
    await page.waitForSelector('.xp-layer[data-state="open"]');
    check('reduced motion: the pad fades in place (no clip-path growth)', await page.evaluate(() => {
      const l = document.querySelector('.xp-layer');
      return l.classList.contains('is-reduced') && getComputedStyle(l.querySelector('.xp-pad')).clipPath === 'none';
    }));
    await page.mouse.up();
    await settle(page, 400);
    await context.close();
  }

  const csp = [];
  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero requests to any other origin', foreign.length === 0, foreign.join(' | '));
  void csp;
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nfeed: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
