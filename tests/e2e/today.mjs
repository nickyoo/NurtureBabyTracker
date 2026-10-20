// e2e: Today + Quick log (DESIGN §6.2, §6.3, §6.7, §13 Frames 1–3) on a
// FRESH profile at 390×844, with the clock pinned to Wed Oct 14 2026 9:50 AM
// (then running) so the sample day matches the final frames.
//
// Drives: brand-new empty states → seeded day (frame 1) → every card opens
// its sheet from the card (focus returns), "Tap to wake" + Undo, the minute
// tick, rows → entry sheet, the + → quick log with context tiles (running
// bottle, breastfeed side, pump goal, End nap), one-tap diaper (sheet closes,
// row slides in, Undo removes it), the time chip back-dating the next log,
// hidden trackers vanishing everywhere, oz ↔ mL, two babies + the switcher,
// the weekly backup nudge (snooze + save) and the install hint. Asserts every
// control is ≥ 44×44 with an accessible name, zero console errors, zero CSP
// violations and zero requests to any other origin. Saves light + night
// screenshots to docs/design/build/today-*.png.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/today.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });
const mod = (path) => `${BASE_URL}${path}`;
const NOW = new Date('2026-10-14T09:50:00Z'); // the frames' "now" (timezone pinned to UTC below)
const MIN = 60 * 1000;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];

async function freshPage({ theme = 'light', device = true, reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  if (device) {
    // The reference iPhone's safe areas, set through the CSSOM (CSP-safe), so
    // screenshots line up with docs/design/final.
    await context.addInitScript(() => {
      const apply = () => {
        const r = document.documentElement;
        if (!r) return false;
        r.style.setProperty('--safe-top', '47px');
        r.style.setProperty('--safe-bottom', '34px');
        return true;
      };
      if (!apply()) new MutationObserver((_, o) => { if (apply()) o.disconnect(); }).observe(document, { childList: true });
    });
  }
  const page = await context.newPage();
  await page.clock.install({ time: NOW });
  await page.clock.resume();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message} ${(e.stack || '').split('\n').slice(1, 4).join(' ')}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== ORIGIN) foreign.push(u);
  });
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-view="today"] .ql-grid');
  await page.waitForTimeout(400);
  return { context, page };
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
const layers = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet-layer')].map((l) => l.getAttribute('data-state')));
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const cardKeys = (page) => page.evaluate(() => [...document.querySelectorAll('[data-view="today"] .ql')].map((c) => c.dataset.card).join());
const cardText = (page, key) => page.evaluate((k) => { const c = document.querySelector(`[data-view="today"] .ql[data-card="${k}"]`); return c ? c.textContent.replace(/\s+/g, ' ').trim() : null; }, key);
const rowTitles = (page) => page.evaluate(() => [...document.querySelectorAll('[data-view="today"] .today-list .row:not(.is-removing) .row-title')].filter((r) => !r.closest('li.is-removing')).map((r) => r.textContent));
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('.toast[data-state="in"] .toast-msg'); return t ? t.textContent : ''; });
const setSetting = (page, key, value) => page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
const patchSetting = (page, key, value) => page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.patch(k, v); }, [mod('/js/core/settings.js'), key, value]);

/** Name + birth date for the default baby (6 weeks old at NOW). */
async function nameBaby(page, name = 'Clara') {
  await page.evaluate(async ([u, n]) => {
    const { settings } = await import(u);
    const b = settings.activeBaby();
    await settings.updateBaby(b.id, { name: n, birthDate: '2026-09-02' });
  }, [mod('/js/core/settings.js'), name]);
}

/** The frame-1 sample day (all relative to the pinned 9:50 AM). */
async function seedFrameDay(page) {
  return page.evaluate(async ([u, now]) => {
    const { events } = await import(u);
    const at = (h, m) => Date.UTC(2026, 9, 14, h, m);
    const ids = {};
    await events.add({ type: 'sleep', startTime: at(0, 0) - 100 * 60000, endTime: at(2, 0), data: { kind: 'night' } });
    await events.add({ type: 'pump', startTime: at(0, 50), endTime: at(1, 6), data: { amount: 4.5, unit: 'oz', storedTo: 'fridge' } });
    await events.add({ type: 'feed', startTime: at(2, 10), endTime: at(2, 28), data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' } });
    await events.add({ type: 'diaper', startTime: at(2, 25), data: { kind: 'dirty' } });
    await events.add({ type: 'sleep', startTime: at(2, 40), endTime: at(6, 30), data: { kind: 'night' } });
    await events.add({ type: 'pump', startTime: at(4, 20), endTime: at(4, 36), data: { amount: 4.5, unit: 'oz', storedTo: 'freezer' } });
    await events.add({ type: 'feed', startTime: at(5, 5), endTime: at(5, 25), data: { method: 'breast', left: 480, right: 360, lastSide: 'right' } });
    await events.add({ type: 'diaper', startTime: at(5, 20), data: { kind: 'wet' } });
    await events.add({ type: 'diaper', startTime: at(6, 50), data: { kind: 'wet' } });
    await events.add({ type: 'pump', startTime: at(7, 10), endTime: at(7, 26), data: { amount: 3.5, unit: 'oz', storedTo: 'fridge' } });
    ids.bottle = (await events.add({ type: 'feed', startTime: at(7, 40), endTime: at(7, 58), data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } })).id;
    ids.nap = (await events.start('sleep', { kind: 'nap' }, { startTime: at(8, 55) })).id;
    ids.live = (await events.start('feed', { method: 'bottle', milk: 'breastmilk', amount: 4, unit: 'oz' }, { startTime: now - (12 * 60 + 4) * 1000 })).id;
    return ids;
  }, [mod('/js/core/store.js'), NOW.getTime()]);
}

async function targetAudit(page, scope) {
  return page.evaluate((sel) => {
    const bad = [];
    for (const el of document.querySelectorAll(`${sel} button, ${sel} a[href], ${sel} input, ${sel} [role="button"]`)) {
      if (el.closest('[hidden]') || el.closest('.sr-only-focusable') || el.classList.contains('sheet-close')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || el.value || '').trim();
      if (r.width < 43.5 || r.height < 43.5) bad.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!name && el.tagName !== 'INPUT') bad.push(`${el.className || el.tagName}: no accessible name`);
    }
    return bad;
  }, scope);
}

try {
  // ============================================================ empty
  console.log('\nbrand-new baby: warm empty states');
  {
    const { context, page } = await freshPage();
    check('default cards: feed, sleep, diaper, pump (stash waits until milk is stored, AUDIT F12)', await cardKeys(page) === 'feed,sleep,diaper,pump', await cardKeys(page));
    check('stale cards read "—" + "No feeds yet" + "Tap to log"', /—\s*No feeds yet\s*Tap to log/.test(await cardText(page, 'feed')), await cardText(page, 'feed'));
    check('empty list is a warm EmptyState with one action', await page.isVisible('[data-view="today"] [data-empty="new"] [data-action="first-log"]'));
    check('…naming the baby, never a pronoun', /A fresh page for Baby/.test(await page.textContent('[data-view="today"] [data-empty="new"]')));
    check('masthead: eyebrow date + name', /Wednesday · October 14/i.test(await page.textContent('[data-view="today"] .eyebrow')) && (await page.textContent('.masthead-name')) === 'Baby');
    await page.click('[data-action="first-log"]');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog');
    check('"Log the first one" opens the quick log', true);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    check('…and focus returns to it', await page.evaluate(() => document.activeElement && document.activeElement.dataset.action === 'first-log'));
    const bad = await targetAudit(page, '[data-view="today"]');
    check('every Today control ≥ 44×44 with a name (empty)', bad.length === 0, bad.join(', '));
    await nameBaby(page);
    await page.waitForFunction(() => document.querySelector('.masthead-name').textContent === 'Clara');
    check('naming the baby updates the masthead (+ age "6 weeks")', (await page.textContent('.masthead-age')) === '6 weeks');
    check('avatar label uses the name', (await page.getAttribute('[data-action="settings"]', 'aria-label')) === 'Clara’s profile and settings');
    await page.screenshot({ path: `${SHOTS}today-empty-light.png` });
    await context.close();
  }

  // ============================================================ frame 1
  console.log('\nseeded day (frame 1)');
  {
    const { context, page } = await freshPage();
    await nameBaby(page);
    const ids = await seedFrameDay(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-view="today"] .today-list .row').length >= 10, null, { timeout: 5000 });
    await settle(page, 600);
    const fed = await cardText(page, 'feed');
    check('Fed: 2h 10m · ago · 4 oz formula · at 7:40 AM', /Fed.*2h\s*10m.*ago · 4 oz formula.*at 7:40 AM/.test(fed), fed);
    const sl = await cardText(page, 'sleep');
    check('Asleep (live): 55m · Nap chip · since 8:55 AM · Tap to wake', /Asleep\s*Nap\s*55m\s*since 8:55 AM\s*Tap to wake/.test(sl), sl);
    check('…and the card is the live one', await page.evaluate(() => document.querySelector('.ql[data-card="sleep"]').classList.contains('is-live')));
    const di = await cardText(page, 'diaper');
    check('Diaper: 3h 00m · ago · wet · at 6:50 AM · 3 today', /Diaper.*3h\s*00m.*ago · wet.*at 6:50 AM · 3 today/.test(di), di);
    const pu = await cardText(page, 'pump');
    check('Pumped: 2h 40m · ago · 3.5 oz · 7:10 · 12.5 / 24 oz', /Pumped.*2h\s*40m.*ago · 3.5 oz · 7:10.*12.5\s*\/ 24 oz/.test(pu), pu);
    check('pump goal bar ≈ 52%', await page.evaluate(() => document.querySelector('.ql[data-card="pump"] .goal-bar > i').style.getPropertyValue('--fill')) === '52%');
    check('card accessible name is one sentence', /^Fed 2 hours 10 minutes ago, 4 ounces formula, at 7:40 AM\. Log a feed\.$/.test(await page.getAttribute('.ql[data-card="feed"]', 'aria-label')), await page.getAttribute('.ql[data-card="feed"]', 'aria-label'));
    const titles = await rowTitles(page);
    check('list newest first: Bottle (live), Nap (live), Bottle · formula, Pumped, Diaper…', titles.slice(0, 5).join('|') === 'Bottle · breast milk|Nap|Bottle · formula|Pumped|Diaper', titles.join('|'));
    check('running rows carry "● Now" and a live chip ring', await page.evaluate((id) => { const r = document.querySelector(`.row[data-event-id="${id}"]`); return !!r.querySelector('.badge') && r.querySelector('.chip-ic').classList.contains('ring-live'); }, ids.nap));
    check('night sleep that began yesterday is on today\'s list', titles.includes('Night sleep'));
    const bad = await targetAudit(page, '[data-view="today"]');
    check('every Today control ≥ 44×44 with a name (full day)', bad.length === 0, bad.join(', '));
    await page.evaluate(() => { document.querySelector('[data-view="today"]').scrollTop = 0; });
    await settle(page, 1400); // let the new-row washes finish
    await page.screenshot({ path: `${SHOTS}today-light.png` });

    // ---- minute tick
    const before = await cardText(page, 'sleep');
    await page.clock.fastForward(61 * 1000);
    await page.waitForFunction(() => /56m/.test(document.querySelector('.ql[data-card="sleep"]').textContent), null, { timeout: 3000 }).catch(() => {});
    check('live numbers tick with the minute (55m → 56m)', /56m/.test(await cardText(page, 'sleep')), `${before} → ${await cardText(page, 'sleep')}`);

    // ---- the stash card arrives with the first pouch
    await page.evaluate(async (u) => {
      const { stash } = await import(u);
      await stash.add({ quantity: 5.5, unit: 'oz', location: 'fridge', pumpedAt: Date.now() - 14 * 3600 * 1000 });
      await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: Date.now() - 40 * 24 * 3600 * 1000 });
    }, mod('/js/core/stash.js'));
    await page.waitForSelector('.ql[data-card="stash"]', { timeout: 3000 }).catch(() => {});
    check('first pouch → Stash card (full width): 9.5 oz · 5.5 fridge · 4 frozen · 2 pouches', /Stash\s*9\.5\s*oz\s*5\.5 fridge · 4 frozen\s*2 pouches/.test(await cardText(page, 'stash') || ''), await cardText(page, 'stash'));

    // ---- cards open their sheets from the card
    console.log('\ncards → sheets');
    for (const [key, title] of [['feed', null], ['diaper', null], ['pump', null], ['stash', null]]) {
      await page.click(`.ql[data-card="${key}"]`);
      await page.waitForSelector('.sheet-layer[data-state="open"]');
      const info = await page.evaluate((k) => ({
        n: document.querySelectorAll('.sheet-layer:not([data-state="closing"])').length,
        origin: document.querySelector(`.ql[data-card="${k}"]`).classList.contains('is-sheet-origin'),
        title: document.querySelector('.sheet-layer .sheet-title').textContent,
      }), key);
      check(`${key} card opens one sheet with the card as origin (${info.title})`, info.n === 1 && info.origin && !/^Log for/.test(info.title), JSON.stringify(info));
      void title;
      await settle(page, 400);
      await page.keyboard.press('Escape');
      await waitNoLayers(page);
      check(`…focus returns to the ${key} card`, await page.evaluate((k) => document.activeElement === document.querySelector(`.ql[data-card="${k}"]`), key));
    }

    // ---- rows open the entry sheet
    await page.click(`.row[data-event-id="${ids.bottle}"]`);
    await page.waitForSelector('.sheet-layer[data-state="open"]');
    check('tap a row → the entry sheet, row as origin', await page.evaluate((id) => document.querySelector(`.row[data-event-id="${id}"]`).classList.contains('is-sheet-origin'), ids.bottle));
    await settle(page, 400);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    check('…focus returns to the row', await page.evaluate((id) => document.activeElement && document.activeElement.dataset.eventId === id, ids.bottle));

    // ---- Timeline › link
    await page.click('[data-view="today"] [data-action="timeline"]');
    await page.waitForSelector('#tabBar [data-tab="timeline"][aria-current="page"]');
    check('"Timeline ›" goes to the Timeline tab', true);
    await page.click('#tabBar [data-tab="today"]');
    await page.waitForSelector('[data-view="today"] .ql-grid');
    await settle(page, 500);

    // ---- quick log (frame 3)
    console.log('\nquick log (frame 3)');
    await page.evaluate(() => { document.querySelector('[data-view="today"]').scrollTop = 0; });
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog .tiles');
    await settle(page, 700);
    check('title "Log for Clara" + time chip "Now 9:51"', (await page.textContent('.sheet-quicklog .sheet-title')) === 'Log for Clara' && /Now\s*9:5\d/.test(await page.textContent('.sheet-quicklog .time-chip')));
    const tile = (k) => page.evaluate((key) => { const t = document.querySelector(`.sheet-quicklog [data-key="${key}"]`); return t ? { text: t.textContent.replace(/\s+/g, ' ').trim(), live: t.classList.contains('is-live') } : null; }, k);
    const tb = await tile('bottle');
    check('Bottle tile: "● Running 13:0x", live', tb && tb.live && /Running 13:\d\d/.test(tb.text), JSON.stringify(tb));
    const tbf = await tile('breast');
    check('Breastfeed tile: "Start on left · last was R"', tbf && /Start on left · last was R/.test(tbf.text), JSON.stringify(tbf));
    const tp = await tile('pump');
    check('Pump tile: "12.5 of 24 oz today"', tp && /12\.5 of 24 oz today/.test(tp.text), JSON.stringify(tp));
    const ts = await tile('sleep');
    check('End nap tile: "Asleep 56m", live', ts && ts.live && /End nap\s*Asleep 5\dm/.test(ts.text), JSON.stringify(ts));
    check('diaper row + Memory + Stash milk tiles', await page.evaluate(() => document.querySelectorAll('.sheet-quicklog .dbtn').length === 3 && !!document.querySelector('.sheet-quicklog [data-key="memory"]') && !!document.querySelector('.sheet-quicklog [data-key="stash"]')));
    const t1 = (await tile('bottle')).text;
    await page.waitForTimeout(1200);
    check('running tile clock ticks every second', (await tile('bottle')).text !== t1);
    const qbad = await targetAudit(page, '.sheet-quicklog');
    check('every quick-log control ≥ 44×44 with a name', qbad.length === 0, qbad.join(', '));
    await page.screenshot({ path: `${SHOTS}today-quicklog-light.png` });

    // Running bottle tile → resumes the running bottle (no second feed).
    await page.click('.sheet-quicklog [data-key="bottle"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer:not([data-state="closing"])').length === 1 && !document.querySelector('.sheet-layer:not([data-state="closing"]).sheet-quicklog'), null, { timeout: 3000 }).catch(() => {});
    check('running Bottle tile closes quick log and opens the feed sheet', await page.evaluate(() => !!document.querySelector('.sheet-layer:not([data-state="closing"])') && !document.querySelector('.sheet-layer:not([data-state="closing"]).sheet-quicklog')));
    await settle(page, 500);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    check('…focus back on the +', await page.evaluate(() => document.activeElement && document.activeElement.id === 'fab'));
    check('…and still exactly one running bottle', await page.evaluate(async (u) => { const { events } = await import(u); return (await events.running('feed')).length === 1; }, mod('/js/core/store.js')));

    // ---- one-tap diaper
    console.log('\none-tap diaper');
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog .dbtn');
    await settle(page, 500);
    const rowsBefore = (await rowTitles(page)).length;
    await page.click('.sheet-quicklog [data-diaper="wet"]');
    check('the tapped button flashes its tint', await page.evaluate(() => { const b = document.querySelector('.sheet-quicklog [data-diaper="wet"]'); return !b || b.classList.contains('is-done'); }));
    await waitNoLayers(page);
    await page.waitForSelector('.toast[data-state="in"]');
    check('sheet closes and the toast offers Undo', /Wet diaper logged/.test(await toastText(page)) && /Undo/.test(await page.textContent('.toast-action')));
    await page.waitForFunction((n) => document.querySelectorAll('[data-view="today"] .today-list li:not(.is-removing) .row').length === n + 1, rowsBefore, { timeout: 3000 }).catch(() => {});
    check('the new row lands at the top and slides in (is-new)', await page.evaluate(() => { const li = document.querySelector('[data-view="today"] .today-list li'); return /Diaper/.test(li.textContent) && li.firstElementChild.classList.contains('is-new'); }));
    check('the Diaper card cross-fades to "Just now"', /Just now/.test(await cardText(page, 'diaper')), await cardText(page, 'diaper'));
    await settle(page, 450);
    await page.click('.toast[data-state="in"] .toast-action');
    await page.waitForFunction((n) => document.querySelectorAll('[data-view="today"] .today-list li:not(.is-removing) .row').length === n, rowsBefore, { timeout: 3000 }).catch(() => {});
    check('Undo removes the row (it collapses)', (await rowTitles(page)).length === rowsBefore);
    check('…and the card goes back to 3h', /3h\s*0\dm/.test(await cardText(page, 'diaper')), await cardText(page, 'diaper'));

    // ---- time chip back-dates the next log
    console.log('\ntime chip');
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog .time-chip');
    await settle(page, 500);
    await page.click('.sheet-quicklog .time-chip');
    await page.waitForSelector('.sheet-quicklog [data-min="30"]');
    await settle(page, 400);
    check('the chip opens "When did it happen?"', /When did it happen/.test(await page.textContent('.sheet-quicklog .sheet-step:not(.is-leaving)')));
    await page.click('.sheet-quicklog [data-min="30"]');
    await page.waitForSelector('.sheet-quicklog .sheet-step:not(.is-leaving) .dbtn');
    await settle(page, 400);
    check('…back to the tiles, chip reads "30m ago"', /30m ago/.test(await page.textContent('.sheet-quicklog .time-chip')), await page.textContent('.sheet-quicklog .time-chip'));
    await page.click('.sheet-quicklog .sheet-step:not(.is-leaving) [data-diaper="dirty"]');
    await waitNoLayers(page);
    const back = await page.evaluate(async (u) => { const { events } = await import(u); const d = await events.last('diaper'); return { kind: d.data.kind, ago: Date.now() - d.startTime }; }, mod('/js/core/store.js'));
    check('one-tap Dirty is logged 30 minutes ago', back.kind === 'dirty' && Math.abs(back.ago - 30 * MIN) < 2 * MIN, JSON.stringify(back));
    await settle(page, 450);
    await page.click('.toast[data-state="in"] .toast-action').catch(() => {});
    await settle(page, 300);

    // ---- End nap from the quick log
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog [data-key="sleep"].is-live');
    await settle(page, 500);
    await page.click('.sheet-quicklog [data-key="sleep"]');
    await waitNoLayers(page);
    await page.waitForFunction(() => /Wake-up logged/.test((document.querySelector('.toast[data-state="in"] .toast-msg') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});
    check('End nap logs the wake-up (toast with Undo)', /Wake-up logged/.test(await toastText(page)), await toastText(page));
    await page.waitForFunction(() => /Awake/.test(document.querySelector('.ql[data-card="sleep"]').textContent), null, { timeout: 3000 }).catch(() => {});
    check('the sleep card turns to Awake · Just now', /Awake\s*Just now/.test(await cardText(page, 'sleep')), await cardText(page, 'sleep'));
    await settle(page, 400);
    await page.click('.toast[data-state="in"] .toast-action');
    await page.waitForFunction(() => /Tap to wake/.test(document.querySelector('.ql[data-card="sleep"]').textContent), null, { timeout: 3000 }).catch(() => {});
    check('Undo resumes the nap', /Tap to wake/.test(await cardText(page, 'sleep')));

    // ---- "Tap to wake" on the card
    await settle(page, 1300);
    await page.click('.ql[data-card="sleep"]');
    await page.waitForFunction(() => /Wake-up logged/.test((document.querySelector('.toast[data-state="in"] .toast-msg') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});
    check('"Tap to wake" ends the nap in one tap (Undo toast)', /Wake-up logged/.test(await toastText(page)) && await page.evaluate(async ([u, id]) => { const { events } = await import(u); return (await events.get(id)).endTime !== null; }, [mod('/js/core/store.js'), ids.nap]));
    await settle(page, 400);
    await page.click('.toast[data-state="in"] .toast-action');
    await page.waitForFunction(() => /Tap to wake/.test(document.querySelector('.ql[data-card="sleep"]').textContent), null, { timeout: 3000 }).catch(() => {});

    // ---- oz ↔ mL
    console.log('\nunits');
    await setSetting(page, 'units', 'mL');
    await page.waitForFunction(() => /mL/.test(document.querySelector('.ql[data-card="feed"]').textContent), null, { timeout: 3000 }).catch(() => {});
    check('mL: Fed card "118 mL formula"', /118 mL formula/.test(await cardText(page, 'feed')), await cardText(page, 'feed'));
    check('mL: pump goal "370 / 710 mL"', /370\s*\/ 710 mL/.test(await cardText(page, 'pump')), await cardText(page, 'pump'));
    check('mL: rows show mL amounts', await page.evaluate((id) => /118\s*mL/.test(document.querySelector(`.row[data-event-id="${id}"]`).textContent), ids.bottle));
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog');
    check('mL: Pump tile "370 of 710 mL today"', /370 of 710 mL today/.test(await page.textContent('.sheet-quicklog [data-key="pump"]')));
    await settle(page, 400);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await setSetting(page, 'units', 'oz');

    // ---- hidden trackers disappear everywhere
    console.log('\nhidden trackers');
    await patchSetting(page, 'trackers', { sleep: false, pump: false });
    await page.waitForFunction(() => !document.querySelector('.ql[data-card="sleep"]'), null, { timeout: 3000 }).catch(() => {});
    check('sleep + pump hidden: their cards are gone', await cardKeys(page) === 'feed,diaper,stash', await cardKeys(page));
    check('…and their rows', !(await rowTitles(page)).some((t) => /Nap|Night sleep|Pumped/.test(t)), (await rowTitles(page)).join('|'));
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog');
    check('…and their quick-log tiles', await page.evaluate(() => !document.querySelector('.sheet-quicklog [data-key="sleep"]') && !document.querySelector('.sheet-quicklog [data-key="pump"]')));
    await settle(page, 400);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await patchSetting(page, 'trackers', { sleep: true, pump: true, bottle: false, breastfeeding: false, diaper: false, stash: false });
    await page.waitForFunction(() => !document.querySelector('.ql[data-card="feed"]'), null, { timeout: 3000 }).catch(() => {});
    check('order follows settings.todayOrder, visible only', await cardKeys(page) === 'sleep,pump', await cardKeys(page));
    await setSetting(page, 'todayOrder', ['pump', 'sleep', 'feed', 'diaper', 'stash']);
    await page.waitForFunction(() => document.querySelector('.ql').dataset.card === 'pump', null, { timeout: 3000 }).catch(() => {});
    check('reordering in Customize reorders the cards', await cardKeys(page) === 'pump,sleep', await cardKeys(page));
    await patchSetting(page, 'trackers', { sleep: false, pump: false, memories: false });
    await page.waitForSelector('[data-view="today"] [data-empty="trackers"]');
    check('all hidden: a warm empty state with Customize', await page.isVisible('[data-view="today"] [data-empty="trackers"] [data-action="customize"]'));
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog [data-customize]');
    check('…and the quick log says so too', true);
    await settle(page, 400);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await setSetting(page, 'trackers', { bottle: true, formula: true, breastfeeding: true, pump: true, stash: true, sleep: true, diaper: true, memories: true });
    await setSetting(page, 'todayOrder', ['feed', 'sleep', 'diaper', 'pump', 'stash']);
    await page.waitForFunction(() => document.querySelectorAll('.ql').length === 5, null, { timeout: 3000 }).catch(() => {});

    // ---- two babies
    console.log('\ntwo babies');
    await page.evaluate(async (u) => { const { settings } = await import(u); await settings.addBaby({ name: 'Leo', birthDate: '2026-09-02' }); }, mod('/js/core/settings.js'));
    await page.waitForSelector('[data-view="today"] [data-action="switch-baby"]');
    check('a second baby turns the eyebrow into a switcher; date moves to the age line', /Clara/.test(await page.textContent('[data-action="switch-baby"]')) && /6 weeks · Wed, Oct 14/.test(await page.textContent('.masthead-age')));
    check('switcher is ≥ 44 tall', await page.evaluate(() => document.querySelector('[data-action="switch-baby"]').getBoundingClientRect().height >= 44));
    await page.click('[data-action="switch-baby"]');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-babies [data-baby]');
    await settle(page, 450);
    await page.click('.sheet-babies [data-baby]:not([aria-pressed="true"])');
    await waitNoLayers(page);
    await page.waitForFunction(() => document.querySelector('.masthead-name').textContent === 'Leo', null, { timeout: 3000 }).catch(() => {});
    check('switching sets the active baby; Today follows', (await page.textContent('.masthead-name')) === 'Leo');
    const leoRows = await rowTitles(page);
    check('Leo\'s list holds only the parent-level pumps', leoRows.every((t) => t === 'Pumped'), leoRows.join('|'));
    check('Leo\'s cards: no feeds yet, pumps shared', /No feeds yet/.test(await cardText(page, 'feed')) && /Pumped.*2h/.test(await cardText(page, 'pump')));
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog');
    check('quick log is "Log for Leo"', (await page.textContent('.sheet-quicklog .sheet-title')) === 'Log for Leo');
    await settle(page, 400);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await page.evaluate(async (u) => { const { settings } = await import(u); await settings.setActiveBaby(settings.babies()[0].id); }, mod('/js/core/settings.js'));
    await page.waitForFunction(() => document.querySelector('.masthead-name').textContent === 'Clara');

    // ---- night
    console.log('\nnight');
    await page.evaluate(async (u) => {
      const { settings } = await import(u);
      await settings.set('babies', settings.babies().slice(0, 1));
    }, mod('/js/core/settings.js'));
    await page.waitForFunction(() => !document.querySelector('[data-action="switch-baby"]'));
    await setSetting(page, 'theme', 'dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await settle(page, 900);
    await page.evaluate(() => { document.querySelector('[data-view="today"]').scrollTop = 0; });
    await page.screenshot({ path: `${SHOTS}today-dark.png` });
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog');
    await settle(page, 800);
    await page.screenshot({ path: `${SHOTS}today-quicklog-dark.png` });
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    const csp = await page.evaluate(() => window.__csp);
    check('zero CSP violations', csp.length === 0, csp.join(' | '));
    await context.close();
  }

  // ============================================================ backup nudge + install hint
  console.log('\nbackup nudge + install hint');
  {
    const { context, page } = await freshPage({ device: false });
    await page.evaluate(async (u) => {
      const { events } = await import(u);
      await events.add({ type: 'diaper', startTime: Date.now() - 4 * 24 * 3600 * 1000, data: { kind: 'wet' } });
    }, mod('/js/core/store.js'));
    await page.reload();
    await page.waitForSelector('[data-view="today"] [data-note="backup"]', { timeout: 5000 }).catch(() => {});
    check('a week without a backup (and a day of data) shows the nudge card', await page.isVisible('[data-note="backup"] [data-action="backup"]'));
    check('…never a modal', await page.evaluate(() => document.querySelectorAll('.sheet-layer').length === 0));
    check('…copy names the baby', /Baby’s log lives only on this phone/.test(await page.textContent('[data-note="backup"]')));
    await page.click('[data-action="snooze-backup"]');
    await page.waitForFunction(() => !document.querySelector('[data-note="backup"]'), null, { timeout: 3000 }).catch(() => {});
    check('"Not now" dismisses it', !(await page.$('[data-note="backup"]')));
    await page.reload();
    await page.waitForSelector('[data-view="today"] .ql-grid');
    await page.waitForSelector('[data-note="install"]', { timeout: 4000 }).catch(() => {});
    check('install-as-protection hint shows when not installed (day 3+)', await page.isVisible('[data-note="install"]'));
    await page.click('[data-action="dismiss-install"]');
    await page.waitForFunction(() => !document.querySelector('[data-note="install"]'), null, { timeout: 3000 }).catch(() => {});
    check('"Got it" dismisses it for good', !(await page.$('[data-note="install"]')));
    // Save a backup to Files → backup.share() → lastBackupAt.
    await page.evaluate(() => localStorage.removeItem('nurture.today.backupSnoozedAt'));
    await page.reload();
    await page.waitForSelector('[data-note="backup"] [data-action="backup"]', { timeout: 5000 });
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('[data-action="backup"]');
    const download = await dl;
    check('"Save a backup to Files" saves a backup file', !!download && /\.json$/.test(download.suggestedFilename()), download && download.suggestedFilename());
    await page.waitForFunction(() => !document.querySelector('[data-note="backup"]'), null, { timeout: 4000 }).catch(() => {});
    check('…the nudge goes away and lastBackupAt is stamped', !(await page.$('[data-note="backup"]')) && await page.evaluate(async (u) => (await import(u)).settings.get('lastBackupAt') !== null, mod('/js/core/settings.js')));
    await context.close();
  }

  // ============================================================ reduced motion
  console.log('\nreduced motion');
  {
    const { context, page } = await freshPage({ device: false, reduced: true });
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog .dbtn');
    check('quick log fades in place (no grow) and keeps the ×', await page.evaluate(() => { const l = document.querySelector('.sheet-layer'); return l.classList.contains('is-reduced') && !l.classList.contains('is-grow') && !!l.querySelector('.fab-x'); }));
    await settle(page, 450);
    await page.click('.sheet-quicklog [data-diaper="wet"]');
    await waitNoLayers(page);
    await page.waitForSelector('[data-view="today"] .today-list .row', { timeout: 3000 }).catch(() => {});
    check('one-tap diaper still lands its row (tint wash kept, no slide)', await page.evaluate(() => {
      const li = document.querySelector('[data-view="today"] .today-list li');
      return !!li && getComputedStyle(li).animationName === 'none' && /row-wash/.test(getComputedStyle(li.firstElementChild).animationName);
    }));
    await context.close();
  }

  // ============================================================ lots of data
  console.log('\nlots of data');
  {
    const { context, page } = await freshPage({ device: false });
    await nameBaby(page);
    const n = await page.evaluate(async (u) => {
      const { events } = await import(u);
      const now = Date.now();
      let count = 0;
      for (let d = 90; d >= 0; d -= 1) {
        for (let k = 0; k < 24; k += 1) {
          const t = now - d * 86400000 - k * 3600000 - 60000;
          if (t > now) continue;
          const type = ['feed', 'diaper', 'pump', 'diaper'][k % 4];
          const data = type === 'feed' ? { method: 'bottle', milk: 'formula', amount: 3 + (k % 3), unit: 'oz' }
            : type === 'pump' ? { amount: 2.5, unit: 'mL', storedTo: null } : { kind: k % 3 ? 'wet' : 'dirty' };
          await events.add({ type, startTime: t, endTime: t + (type === 'diaper' ? 0 : 15 * 60000), data });
          count += 1;
        }
      }
      return count;
    }, mod('/js/core/store.js'));
    await page.reload();
    await page.waitForSelector('[data-view="today"] .today-list .row', { timeout: 8000 });
    await settle(page, 600);
    const rows = await page.evaluate(() => document.querySelectorAll('[data-view="today"] .today-list .row').length);
    const t0 = Date.now();
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"].sheet-quicklog .dbtn');
    await settle(page, 450);
    await page.click('.sheet-quicklog [data-diaper="both"]');
    await page.waitForFunction((r) => document.querySelectorAll('[data-view="today"] .today-list li:not(.is-removing) .row').length === r + 1, rows, { timeout: 6000 }).catch(() => {});
    const took = Date.now() - t0;
    check(`${n} events: today's list shows only today (${rows} rows) and a new log lands in ${took} ms`, rows > 0 && rows <= 24 && took < 3000, `rows=${rows} took=${took}`);
    const bad = await targetAudit(page, '[data-view="today"]');
    check('every Today control ≥ 44×44 with a name (lots of data)', bad.length === 0, bad.join(', '));
    await context.close();
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero requests to any other origin', foreign.length === 0, foreign.join(' | '));
} catch (err) {
  failures.push(`crashed: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\ntoday: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
