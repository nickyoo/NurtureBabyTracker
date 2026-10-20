// e2e: Timeline + entry sheet + pediatrician report (DESIGN §6.4, §6.8
// DayPager / StatTile / TimelineStrip, §13 Frame 4; ARCHITECTURE §10c) on a
// FRESH profile at 390×844, clock pinned to Wed Oct 14 2026 9:50 AM (then
// running) so the sample day matches the final frames.
//
// Drives: the warm empty states (today, a quiet past day, the report) → the
// frame-4 sample day (stat tiles, 24h strip with shape-coded marks, now-line,
// legend, the day's list newest first) → the day pager (‹ ›, week row,
// arrow keys, swipe) → stat filters → strip mark → entry sheet → row → entry
// sheet (view / edit / validation / save for bottle, breastfeed, pump, sleep,
// diaper, memory; running nap → its live sheet) → delete + Undo → new rows
// sliding in → hidden trackers vanishing → oz ↔ mL → two babies → the report
// (7 / 14 days, print, Share CSV, back). Asserts every control is ≥ 44×44
// with an accessible name, no pronoun for the baby, zero console errors,
// zero CSP violations and zero requests to any other origin. Saves light +
// night screenshots to docs/design/build/timeline-*.png / report-*.png.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/timeline.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });
const mod = (path) => `${BASE_URL}${path}`;
const NOW = new Date('2026-10-14T09:50:00Z'); // the frames' "now" (timezone pinned to UTC below)

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];

async function freshPage({ theme = 'light' } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme,
    locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', acceptDownloads: true,
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
  // The reference iPhone's safe areas through the CSSOM (CSP-safe), so
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
  await page.waitForSelector('[data-view="today"]');
  await page.evaluate(async ([u, t]) => {
    const { settings } = await import(u);
    await settings.set('theme', t);
    const b = settings.activeBaby();
    await settings.updateBaby(b.id, { name: 'Clara', birthDate: '2026-09-02' });
  }, [mod('/js/core/settings.js'), theme]);
  await page.waitForTimeout(300);
  return { context, page };
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
const TL = '[data-view="timeline"]';
const RP = '[data-view="report"]';
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const openLayer = (page, cls) => page.waitForSelector(`.sheet-layer${cls || ''}[data-state="open"]`, { timeout: 4000 }).then(() => true, () => false);
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('.toast[data-state="in"] .toast-msg'); return t ? t.textContent : ''; });
const setSetting = (page, key, value) => page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
const patchSetting = (page, key, value) => page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.patch(k, v); }, [mod('/js/core/settings.js'), key, value]);
const rowIds = (page) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} .tl-list li:not(.is-removing) > .row`)].map((r) => r.dataset.eventId), TL);
const rowText = (page, id) => page.evaluate(([sel, i]) => { const r = document.querySelector(`${sel} .row[data-event-id="${i}"]`); return r ? r.textContent.replace(/\s+/g, ' ').trim() : null; }, [TL, id]);
const statText = (page) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} .stat`)].map((s) => `${s.dataset.stat}:${s.innerText.replace(/\s+/g, ' ').trim()}`), TL);
const sheetText = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer:not([data-state="closing"])')].pop(); return l ? l.textContent.replace(/\s+/g, ' ').trim() : ''; });
const sheetTitle = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer:not([data-state="closing"])')].pop(); return l ? l.querySelector('.sheet-title').textContent : ''; });
const gotoTimeline = async (page) => { await page.click('#tabBar [data-tab="timeline"]'); await page.waitForSelector(`${TL} .tl-day`); await settle(page, 600); };
const scrollTl = (page, y) => page.evaluate(([sel, top]) => document.querySelector(sel).scrollTo(0, top), [TL, y]);

/** The frame-1/4 sample day (relative to the pinned 9:50 AM) + 9 earlier days for the report. */
async function seed(page) {
  return page.evaluate(async ([u, now]) => {
    const { events } = await import(u);
    const at = (h, m) => Date.UTC(2026, 9, 14, h, m);
    const ids = {};
    ids.night1 = (await events.add({ type: 'sleep', startTime: at(0, 0) - 100 * 60000, endTime: at(2, 0), data: { kind: 'night' } })).id;
    ids.pump1 = (await events.add({ type: 'pump', startTime: at(0, 50), endTime: at(1, 6), data: { amount: 4.5, unit: 'oz', storedTo: 'fridge' } })).id;
    ids.bottle1 = (await events.add({ type: 'feed', startTime: at(2, 10), endTime: at(2, 28), data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' } })).id;
    ids.dirty = (await events.add({ type: 'diaper', startTime: at(2, 25), data: { kind: 'dirty' } })).id;
    ids.night2 = (await events.add({ type: 'sleep', startTime: at(2, 40), endTime: at(6, 30), data: { kind: 'night' } })).id;
    ids.pump2 = (await events.add({ type: 'pump', startTime: at(4, 20), endTime: at(4, 36), data: { amount: 4.5, unit: 'oz', storedTo: 'freezer' } })).id;
    ids.breast = (await events.add({ type: 'feed', startTime: at(5, 5), endTime: at(5, 25), data: { method: 'breast', left: 480, right: 360, lastSide: 'right' } })).id;
    ids.wet1 = (await events.add({ type: 'diaper', startTime: at(5, 20), data: { kind: 'wet' } })).id;
    ids.wet2 = (await events.add({ type: 'diaper', startTime: at(6, 50), data: { kind: 'wet' } })).id;
    ids.pump3 = (await events.add({ type: 'pump', startTime: at(7, 10), endTime: at(7, 26), data: { amount: 3.5, unit: 'oz', storedTo: 'fridge' } })).id;
    ids.bottle = (await events.add({ type: 'feed', startTime: at(7, 40), endTime: at(7, 58), data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } })).id;
    ids.nap = (await events.start('sleep', { kind: 'nap' }, { startTime: at(8, 55) })).id;
    for (let d = 1; d <= 9; d += 1) {
      const day = (h, m) => Date.UTC(2026, 9, 14 - d, h, m);
      for (const h of [1, 4, 7, 10, 13, 16, 19, 22]) await events.add({ type: 'feed', startTime: day(h, 0), endTime: day(h, 15), data: { method: 'bottle', milk: 'formula', amount: 3 + (h % 3) * 0.5, unit: 'oz' } });
      await events.add({ type: 'feed', startTime: day(11, 30), endTime: day(11, 50), data: { method: 'breast', left: 600, right: 540, lastSide: 'left' } });
      for (const h of [2, 8, 14, 20]) await events.add({ type: 'diaper', startTime: day(h, 30), data: { kind: h === 8 ? 'both' : 'wet' } });
      await events.add({ type: 'sleep', startTime: day(9, 0), endTime: day(10, 30), data: { kind: 'nap' } });
      await events.add({ type: 'sleep', startTime: day(14, 0), endTime: day(15, 45), data: { kind: 'nap' } });
      await events.add({ type: 'pump', startTime: day(6, 0), endTime: day(6, 20), data: { amount: 5, unit: 'oz' } });
    }
    ids.memory = (await events.add({ type: 'milestone', startTime: Date.UTC(2026, 9, 9, 15, 0), data: { title: 'First real smile', photoIds: [] } })).id;
    return ids;
  }, [mod('/js/core/store.js'), NOW.getTime()]);
}

async function targetAudit(page, scope) {
  return page.evaluate((sel) => {
    const bad = [];
    for (const el of document.querySelectorAll(`${sel} button, ${sel} a[href], ${sel} input, ${sel} textarea, ${sel} [role="button"], ${sel} [role="radio"]`)) {
      if (el.closest('[hidden]') || el.closest('[inert]') || el.closest('.sr-only-focusable') || el.classList.contains('sheet-close')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const labelled = el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby').split(' ')[0]);
      const name = (el.getAttribute('aria-label') || (labelled && labelled.textContent) || (el.labels && el.labels[0] && el.labels[0].textContent) || el.textContent || '').trim();
      if (r.width < 43.5 || r.height < 43.5) {
        // Inputs inside a ≥44 tall field label count by the field; a
        // segment's hit area spans its ≥44 track (::after).
        const field = el.closest('.field, .ev-value, .segmented');
        const fr = field && field.getBoundingClientRect();
        if (!fr || fr.height < 43.5) bad.push(`${el.className || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      if (!name) bad.push(`${el.className || el.tagName}: no accessible name`);
    }
    return bad;
  }, scope);
}

const PRONOUN = /\b(she|her|hers|he|him|his)\b/i;

try {
  // ============================================================ empty
  console.log('\nfresh profile: warm empty states');
  {
    const { context, page } = await freshPage();
    await gotoTimeline(page);
    check('Timeline mounts with the pager header "Today"', (await page.textContent(`${TL} .page-title`)) === 'Today');
    check('empty day: warm EmptyState, never a blank list', await page.isVisible(`${TL} [data-empty="today"]`));
    check('…in the baby\'s name', /for Clara today/.test(await page.textContent(`${TL} [data-empty="today"]`)));
    check('› next day is disabled on today', (await page.getAttribute(`${TL} [data-action="next"]`, 'aria-disabled')) === 'true');
    check('an empty day is one warm empty state under the pager — no zeros over an empty chart', (await page.$$(`${TL} .stat`)).length === 0 && !(await page.$(`${TL} .tl-strip`))
      && await page.evaluate((sel) => document.querySelector(`${sel} [data-empty="today"] .btn`).getBoundingClientRect().bottom < 844 - 90, TL));
    await page.screenshot({ path: `${SHOTS}timeline-empty-light.png` });
    await page.click(`${TL} [data-empty="today"] [data-action="log"]`);
    check('"Log something" opens quick log from the button', await openLayer(page, '.sheet-quicklog'));
    await settle(page, 450);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    const first = await page.evaluate(async (u) => { const { events } = await import(u); return (await events.add({ type: 'diaper', startTime: Date.now() - 120000, data: { kind: 'wet' } })).id; }, mod('/js/core/store.js'));
    await page.waitForFunction(([sel, id]) => !!document.querySelector(`${sel} .row[data-event-id="${id}"]`), [TL, first]);
    check('the first entry slides in; tiles + strip appear', await page.evaluate(([sel, id]) => document.querySelector(`${sel} .row[data-event-id="${id}"]`).closest('li').classList.contains('is-inserting'), [TL, first])
      && (await page.$$(`${TL} .stat`)).length === 4 && (await page.$$(`${TL} .tl-strip .s-track`)).length === 4);
    await page.evaluate(async ([u, id]) => { const { events } = await import(u); await events.remove(id); }, [mod('/js/core/store.js'), first]);
    await page.waitForSelector(`${TL} [data-empty="today"]`);
    check('…removing it brings the empty state back', true);
    await page.click(`${TL} [data-action="prev"]`);
    await settle(page, 500);
    check('‹ pages to Yesterday', (await page.textContent(`${TL} .page-title`)) === 'Yesterday');
    check('a quiet past day: its own warm empty state', await page.isVisible(`${TL} [data-empty="day"]`));
    await page.click(`${TL} [data-empty="day"] [data-action="today"]`);
    await settle(page, 500);
    check('"Back to today" returns to today', (await page.textContent(`${TL} .page-title`)) === 'Today');
    // Report with nothing to report.
    await scrollTl(page, 99999);
    await page.click(`${TL} [data-action="report"]`);
    await page.waitForSelector(`${RP} .rp-empty`);
    check('report with no full day yet: warm empty state', /Nothing to report yet/.test(await page.textContent(`${RP} .rp-empty`)));
    check('…print is disabled, the CSV is still offered', await page.isDisabled(`${RP} [data-action="print"]`) && await page.isEnabled(`${RP} [data-action="csv"]`));
    await page.click(`${RP} .rp-empty [data-action="back"]`);
    await page.waitForFunction(() => !document.querySelector('[data-view="report"]'));
    check('…its button goes back to the timeline', await page.isVisible(`${TL} .tl-day`));
    await context.close();
  }

  // ============================================================ the day (light)
  console.log('\nthe frame-4 day');
  const { context, page } = await freshPage();
  const ids = await seed(page);
  await gotoTimeline(page);
  const stats = await statText(page);
  check('fed tile: 7 oz from 3 feeds', stats.some((s) => s === 'feed:7 oz 3 feeds'), stats.join(' | '));
  check('sleep tile: 6h 45m slept (night clipped at midnight + running nap)', stats.some((s) => s === 'sleep:6h 45m slept'), stats.join(' | '));
  check('diaper tile: 3 diapers', stats.some((s) => s === 'diaper:3 diapers'));
  check('pump tile: 12.5 oz pumped', stats.some((s) => s === 'pump:12.5 oz pumped'));
  const strip = await page.evaluate((sel) => {
    const svg = document.querySelector(`${sel} .tl-strip svg`);
    return {
      role: svg.getAttribute('role'), label: svg.getAttribute('aria-label'),
      night: svg.querySelectorAll('.s-sleep.s-mark').length, nap: svg.querySelectorAll('.s-nap.s-mark').length,
      bottle: svg.querySelectorAll('.s-feed.s-mark').length, breast: svg.querySelectorAll('.s-bf.s-mark').length,
      dirty: svg.querySelectorAll('.s-dia-dot.s-mark').length, wet: svg.querySelectorAll('.s-dia-ring.s-mark').length,
      pump: svg.querySelectorAll('.s-pump.s-mark').length, now: !!svg.querySelector('.s-now'),
      hatch: !!svg.querySelector('[fill^="url(#"]'), band: svg.querySelectorAll('.s-band').length,
      legend: [...document.querySelectorAll(`${sel} .legend span`)].map((s) => s.textContent.trim()),
      napFill: getComputedStyle(svg.querySelector('.s-nap.s-mark')).fill, nightFill: getComputedStyle(svg.querySelector('.s-sleep.s-mark')).fill,
    };
  }, TL);
  check('strip: role=img with a sentence summary', strip.role === 'img' && /night sleep .* nap since 8:55 AM/.test(strip.label), strip.label);
  check('strip: 2 solid night blocks + 1 outlined nap (shape, not colour)', strip.night === 2 && strip.nap === 1 && strip.napFill === 'none' && strip.nightFill !== 'none', JSON.stringify(strip));
  check('strip: bottle ticks filled, breastfeed tick hollow', strip.bottle === 2 && strip.breast === 1);
  check('strip: dirty dot, wet rings, pump diamonds', strip.dirty === 1 && strip.wet === 2 && strip.pump === 3);
  check('strip: now-line, hatched future, night band on every lane', strip.now && strip.hatch && strip.band === 8);
  check('strip: 8-item legend', strip.legend.join(',') === 'Night sleep,Nap,Bottle,Breast,Pump,Wet,Dirty,Both', strip.legend.join(','));
  const ordered = await rowIds(page);
  const starts = await page.evaluate(async ([u, list]) => { const { events } = await import(u); return Promise.all(list.map(async (i) => (await events.get(i)).startTime)); }, [mod('/js/core/store.js'), ordered]);
  check('the day\'s list is newest first', starts.every((t, i) => i === 0 || t <= starts[i - 1]) && ordered[0] === ids.nap, ordered.slice(0, 3).join());
  check('the night that began yesterday is listed ("Began …")', /Began/.test(await rowText(page, ids.night1) || ''));
  check('the running nap row is live: ring + "Now"', await page.evaluate(([sel, id]) => { const r = document.querySelector(`${sel} .row[data-event-id="${id}"]`); return !!r.querySelector('.ring-live') && /Now/.test(r.textContent); }, [TL, ids.nap]));
  check('section meta: "N entries · newest first"', /^\d+ entries · newest first$/.test(await page.textContent(`${TL} [data-part="meta"]`)));
  await page.screenshot({ path: `${SHOTS}timeline-light.png` });
  const audit = await targetAudit(page, TL);
  check('timeline: every control ≥ 44×44 with a name', audit.length === 0, audit.join('; '));
  check('timeline: no pronoun for the baby', !PRONOUN.test(await page.textContent(TL)));

  // ---- pager: week row, keys, swipe
  console.log('\nday pager');
  await page.click(`${TL} .day[aria-selected="false"] >> nth=5`);
  await settle(page, 600);
  check('week row: tapping Tu 13 shows Yesterday', (await page.textContent(`${TL} .page-title`)) === 'Yesterday');
  check('…the selected ring moved (aria-selected)', await page.evaluate((sel) => document.querySelector(`${sel} .day[aria-selected="true"]`).textContent.includes('13'), TL));
  check('…yesterday\'s list (11 entries incl. its night)', (await rowIds(page)).length >= 10);
  check('…no now-line on a past day', await page.evaluate((sel) => !document.querySelector(`${sel} .s-now`), TL));
  await page.focus(`${TL} .day[aria-selected="true"]`);
  await page.keyboard.press('ArrowLeft');
  await settle(page, 500);
  check('arrow keys move the day (role=tablist)', (await page.textContent(`${TL} .page-sub`)).includes('October 12'));
  await page.keyboard.press('End');
  await settle(page, 500);
  check('End jumps to today', (await page.textContent(`${TL} .page-title`)) === 'Today');
  const swipe = (dx) => page.evaluate(([sel, d]) => {
    const el = document.querySelector(`${sel} .tl-day`);
    const r = el.getBoundingClientRect();
    const mk = (type, x) => new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: r.top + 40, bubbles: true });
    el.dispatchEvent(mk('pointerdown', 200));
    el.dispatchEvent(mk('pointerup', 200 + d));
  }, [TL, dx]);
  await swipe(140);
  await settle(page, 500);
  check('swipe right pages back a day', (await page.textContent(`${TL} .page-title`)) === 'Yesterday');
  await swipe(-140);
  await settle(page, 500);
  check('swipe left pages forward', (await page.textContent(`${TL} .page-title`)) === 'Today');
  await swipe(-140);
  await settle(page, 300);
  check('…never past today', (await page.textContent(`${TL} .page-title`)) === 'Today');
  for (let i = 0; i < 8; i += 1) await page.click(`${TL} [data-action="prev"]`);
  await settle(page, 600);
  check('paging 8 days back moves the week row a whole week', await page.evaluate((sel) => !document.querySelector(`${sel} .today-dot`), TL));
  await page.click(`${TL} .day >> nth=6`);
  await page.keyboard.press('End'); // focus is on the row now
  for (let i = 0; i < 8; i += 1) { if ((await page.textContent(`${TL} .page-title`)) === 'Today') break; await page.click(`${TL} [data-action="next"]`); await settle(page, 120); }
  await settle(page, 500);
  check('› back to today', (await page.textContent(`${TL} .page-title`)) === 'Today');

  // ---- stat filter
  console.log('\nstat filters');
  await page.click(`${TL} .stat[data-stat="diaper"]`);
  await settle(page, 300);
  const filtered = await rowIds(page);
  check('diaper tile filters the list to diapers', filtered.length === 3 && filtered.every((i) => [ids.dirty, ids.wet1, ids.wet2].includes(i)), filtered.join());
  check('…tile is aria-pressed, "Show all" appears', (await page.getAttribute(`${TL} .stat[data-stat="diaper"]`, 'aria-pressed')) === 'true' && await page.isVisible(`${TL} .sec-hd [data-action="clear-filter"]`));
  await page.click(`${TL} .sec-hd [data-action="clear-filter"]`);
  await settle(page, 300);
  check('"Show all" clears it', (await rowIds(page)).length === ordered.length);

  // ---- strip mark → entry sheet
  console.log('\nstrip mark → entry sheet');
  const markBox = await page.evaluate(([sel, id]) => { const r = document.querySelector(`${sel} .s-mark[data-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [TL, ids.pump2]);
  await page.mouse.click(markBox.x, markBox.y);
  check('tapping a pump diamond opens its entry sheet', await openLayer(page, '.sheet-event') && /Pumped/.test(await sheetTitle(page)));
  check('…from its row (the row is the origin)', await page.evaluate(([sel, id]) => document.querySelector(`${sel} .row[data-event-id="${id}"]`).classList.contains('is-sheet-origin'), [TL, ids.pump2]));
  check('…shows amount, times and where it was stored', /4\.5\s*oz/.test(await sheetText(page)) && /Freezer/.test(await sheetText(page)));
  await settle(page, 400);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  check('…closing washes the row (new-row highlight)', await page.evaluate(([sel, id]) => document.querySelector(`${sel} .row[data-event-id="${id}"]`).classList.contains('is-new'), [TL, ids.pump2]));
  check('…focus returns to the row', await page.evaluate((id) => document.activeElement && document.activeElement.dataset.eventId === id, ids.pump2));

  // ---- row → entry sheet → edit bottle
  console.log('\nentry sheet: view + edit + validation');
  await page.click(`${TL} .row[data-event-id="${ids.bottle}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 450);
  const view = await sheetText(page);
  check('bottle entry: title, amount, milk, start/finish, duration', /Bottle · formula/.test(await sheetTitle(page)) && /4\s*oz/.test(view) && /Formula/.test(view) && /7:40 AM/.test(view) && /7:58 AM/.test(view) && /18 min/.test(view), view);
  check('…Edit (primary) and Delete (soft) buttons', await page.isVisible('.sheet-event [data-edit].btn-primary') && await page.isVisible('.sheet-event [data-delete].btn-danger-soft'));
  await page.screenshot({ path: `${SHOTS}timeline-entry-light.png` });
  const sheetAudit = await targetAudit(page, '.sheet-event');
  check('entry sheet: every control ≥ 44×44 with a name', sheetAudit.length === 0, sheetAudit.join('; '));
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-save]');
  await settle(page, 400);
  check('Edit steps forward to the form ("Edit bottle")', (await sheetTitle(page)) === 'Edit bottle');
  check('…amount stepper is a spinbutton in oz with valuetext', await page.evaluate(() => { const i = document.querySelector('.sheet-event [data-amount]'); return i.getAttribute('role') === 'spinbutton' && i.value === '4' && /4 ounces/.test(i.getAttribute('aria-valuetext')); }));
  const editAudit = await targetAudit(page, '.sheet-event');
  check('edit form: every control ≥ 44×44 with a name', editAudit.length === 0, editAudit.join('; '));
  await page.screenshot({ path: `${SHOTS}timeline-edit-light.png` });
  // Validation: end before start.
  await page.fill('.sheet-event [data-field="end-time"]', '07:00');
  await settle(page, 150);
  check('end before start → calm inline error, Save disabled', /end can’t be before the start/.test(await page.textContent('.sheet-event [data-error]')) && await page.isDisabled('.sheet-event [data-save]'));
  await page.fill('.sheet-event [data-field="end-time"]', '07:58');
  await page.fill('.sheet-event [data-field="start-date"]', '2026-10-15');
  await settle(page, 150);
  check('a start in the future → "still to come", Save disabled', /still to come/.test(await page.textContent('.sheet-event [data-error]')) && await page.isDisabled('.sheet-event [data-save]'));
  await page.fill('.sheet-event [data-field="start-date"]', '2026-10-14');
  await settle(page, 150);
  check('…fixing it clears the error', await page.isHidden('.sheet-event [data-error]') && await page.isEnabled('.sheet-event [data-save]'));
  await page.click('.sheet-event [data-inc]');
  await page.click('.sheet-event [data-inc]');
  check('+ steps the amount by 0.5 oz', (await page.inputValue('.sheet-event [data-amount]')) === '5');
  await page.click('.sheet-event [data-seg="milk"] [data-value="breastmilk"]');
  await page.fill('.sheet-event [data-note]', 'Took it slowly');
  await page.click('.sheet-event [data-save]');
  await page.waitForFunction(() => /Saved/.test((document.querySelector('.sheet-event [data-save]') || {}).textContent || ''), null, { timeout: 2000 }).catch(() => {});
  check('Save shows "Saved" in the button (in-sheet success)', true);
  check('…then the sheet closes', await waitNoLayers(page));
  await settle(page, 400);
  const stored = await page.evaluate(async ([u, id]) => { const { events } = await import(u); return events.get(id); }, [mod('/js/core/store.js'), ids.bottle]);
  check('the edit is stored (5 oz breast milk, note, same times)', stored.data.amount === 5 && stored.data.milk === 'breastmilk' && stored.note === 'Took it slowly' && stored.startTime === Date.UTC(2026, 9, 14, 7, 40) && stored.endTime === Date.UTC(2026, 9, 14, 7, 58), JSON.stringify(stored.data));
  check('the row and the fed tile update in place', /Bottle · breast milk.*5\s*oz/.test(await rowText(page, ids.bottle)) && (await statText(page)).includes('feed:8 oz 3 feeds'));

  // Move a diaper's time: the row moves where it belongs.
  await page.click(`${TL} .row[data-event-id="${ids.wet1}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-seg="diaper"]');
  await settle(page, 350);
  check('diaper: no colour/texture for a wet one', await page.isHidden('.sheet-event [data-more]'));
  await page.click('.sheet-event [data-seg="diaper"] [data-value="dirty"]');
  check('…choosing Dirty reveals colour + texture', await page.isVisible('.sheet-event [data-chips="color"]'));
  await page.click('.sheet-event [data-chips="color"] [data-value="yellow"]');
  await page.fill('.sheet-event [data-field="start-time"]', '08:15');
  await page.click('.sheet-event [data-save]');
  await waitNoLayers(page);
  await settle(page, 500);
  const after = await rowIds(page);
  check('…saved as "Dirty · yellow" and the row moved to 8:15', /Dirty · yellow/.test(await rowText(page, ids.wet1)) && after.indexOf(ids.wet1) < after.indexOf(ids.bottle), after.slice(0, 4).join());

  // Breastfeed: minutes per side.
  await page.click(`${TL} .row[data-event-id="${ids.breast}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  check('breastfeed entry: left + right durations', /Left\s*8 min/.test(await sheetText(page)) && /Right\s*6 min/.test(await sheetText(page)));
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-left]');
  await settle(page, 350);
  await page.fill('.sheet-event [data-left]', '10');
  await page.click('.sheet-event [data-save]');
  await waitNoLayers(page);
  await settle(page, 300);
  check('…edited to L 10 min', /L 10 min · R 6 min/.test(await rowText(page, ids.breast)), await rowText(page, ids.breast));

  // Sleep: nap ↔ night, and the strip mark changes shape.
  await page.click(`${TL} .row[data-event-id="${ids.night2}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-seg="sleep"]');
  await settle(page, 350);
  await page.click('.sheet-event [data-seg="sleep"] [data-value="nap"]');
  await page.click('.sheet-event [data-save]');
  await waitNoLayers(page);
  await settle(page, 300);
  check('night sleep → nap: the strip mark turns into an outline', await page.evaluate(([sel, id]) => document.querySelector(`${sel} .s-mark[data-id="${id}"]`).classList.contains('s-nap'), [TL, ids.night2]));

  // ---- running nap: its live sheet
  console.log('\nrunning entries');
  await scrollTl(page, 0);
  await page.click(`${TL} .row[data-event-id="${ids.nap}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  check('running nap: "Asleep" badge, "Still asleep", Back to the nap', /Still asleep/.test(await sheetText(page)) && await page.isVisible('.sheet-event [data-live]'));
  await page.click('.sheet-event [data-live]');
  check('…"Back to the nap" hands over to the sleep sheet', await openLayer(page, '.sheet-sleep'));
  await settle(page, 450);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  check('…and only one sheet was ever open at a time', true);
  await page.click(`${TL} .row[data-event-id="${ids.nap}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-save]');
  await settle(page, 350);
  check('running edit: start only, no end field', await page.isHidden('.sheet-event [data-field="end-time"]').catch(() => true) && !(await page.$('.sheet-event [data-field="end-time"]')));
  await page.fill('.sheet-event [data-field="start-time"]', '08:45');
  await page.click('.sheet-event [data-save]');
  await waitNoLayers(page);
  await settle(page, 300);
  check('…start moved to 8:45, still running', await page.evaluate(async ([u, id]) => { const { events } = await import(u); const e = await events.get(id); return e.endTime === null && e.startTime === Date.UTC(2026, 9, 14, 8, 45); }, [mod('/js/core/store.js'), ids.nap]));

  // ---- delete + Undo (finished and running)
  console.log('\ndelete + undo');
  const before = await rowIds(page);
  await page.click(`${TL} .row[data-event-id="${ids.pump3}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-delete]');
  check('Delete closes the sheet (no confirm)', await waitNoLayers(page));
  await settle(page, 80);
  check('…the row collapses', await page.evaluate(([sel, id]) => { const r = document.querySelector(`${sel} .row[data-event-id="${id}"]`); return !r || r.closest('li').classList.contains('is-removing'); }, [TL, ids.pump3]));
  await page.waitForSelector('.toast[data-state="in"]');
  check('…an Undo toast: "Pump deleted"', /^Pump deleted$/.test(await toastText(page)) && await page.isVisible('.toast .toast-action'));
  await settle(page, 500);
  check('…the pump tile drops to 9 oz', (await statText(page)).includes('pump:9 oz pumped'));
  await page.click('.toast .toast-action');
  await page.waitForFunction(([sel, id]) => !!document.querySelector(`${sel} .row[data-event-id="${id}"]`), [TL, ids.pump3]);
  await settle(page, 60);
  check('Undo restores the row where it was, sliding in', await page.evaluate(([sel, id]) => { const r = document.querySelector(`${sel} .row[data-event-id="${id}"]`); return r.classList.contains('is-new') || r.closest('li').classList.contains('is-inserting'); }, [TL, ids.pump3]));
  await settle(page, 400);
  check('…same order as before', (await rowIds(page)).join() === before.join());
  check('…"Restored"', /Restored/.test(await toastText(page)));
  await settle(page, 1400);
  // Running nap: delete removes its pill too, Undo brings both back.
  await page.click(`${TL} .row[data-event-id="${ids.nap}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-delete]');
  await waitNoLayers(page);
  await page.waitForFunction((id) => !document.querySelector(`.lpill[data-event-id="${id}"]`), ids.nap, { timeout: 3000 }).catch(() => {});
  check('deleting a running nap removes its live pill', await page.evaluate((id) => !document.querySelector(`.lpill[data-event-id="${id}"]`), ids.nap));
  await page.waitForSelector('.toast[data-state="in"] .toast-action');
  await settle(page, 450);
  await page.click('.toast .toast-action');
  await page.waitForSelector(`.lpill[data-event-id="${ids.nap}"]`, { timeout: 3000 }).catch(() => {});
  check('…Undo brings the nap and its pill back', await page.isVisible(`.lpill[data-event-id="${ids.nap}"]`) && !!(await rowText(page, ids.nap)));
  await settle(page, 1400);

  // ---- a new row lands with motion
  console.log('\nnew rows');
  const newId = await page.evaluate(async (u) => { const { events } = await import(u); return (await events.add({ type: 'diaper', startTime: Date.now() - 60000, data: { kind: 'both' } })).id; }, mod('/js/core/store.js'));
  await page.waitForFunction(([sel, id]) => !!document.querySelector(`${sel} .row[data-event-id="${id}"]`), [TL, newId]);
  check('a new entry slides in at the top with the tint wash', await page.evaluate(([sel, id]) => { const r = document.querySelector(`${sel} .row[data-event-id="${id}"]`); return r.classList.contains('is-new') && r.closest('li').classList.contains('is-inserting'); }, [TL, newId]) && (await rowIds(page))[0] === newId);
  check('…its strip mark is ring + dot ("Both")', await page.evaluate(([sel, id]) => { const g = document.querySelector(`${sel} .s-mark[data-id="${id}"]`); return !!g && !!g.querySelector('.s-dia-ring') && !!g.querySelector('.s-dia-dot'); }, [TL, newId]));

  // ---- memory entry
  for (let i = 0; i < 5; i += 1) await page.click(`${TL} [data-action="prev"]`);
  await settle(page, 600);
  check('Fri, Oct 9: the memory is listed', !!(await rowText(page, ids.memory)));
  await page.click(`${TL} .row[data-event-id="${ids.memory}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-title]');
  await settle(page, 350);
  check('memory edit: "Edit memory" with its name', (await sheetTitle(page)) === 'Edit memory' && (await page.inputValue('.sheet-event [data-title]')) === 'First real smile');
  await page.fill('.sheet-event [data-title]', ' ');
  await settle(page, 120);
  check('…a memory needs a name', await page.isDisabled('.sheet-event [data-save]'));
  await page.fill('.sheet-event [data-title]', 'First big smile');
  await page.click('.sheet-event [data-save]');
  await waitNoLayers(page);
  await settle(page, 300);
  check('…renamed', /First big smile/.test(await rowText(page, ids.memory) || ''));
  await page.click(`${TL} [data-action="next"]`);
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i += 1) { if ((await page.textContent(`${TL} .page-title`)) === 'Today') break; await page.click(`${TL} [data-action="next"]`); await settle(page, 120); }
  await settle(page, 500);

  // ---- hidden trackers
  console.log('\nhidden trackers');
  await patchSetting(page, 'trackers', { pump: false });
  await settle(page, 600);
  check('pump hidden: its tile, lane, legend item and rows disappear', !(await statText(page)).some((s) => s.startsWith('pump:')) && (await page.$$(`${TL} .tl-strip .s-track`)).length === 3
    && !(await page.textContent(`${TL} .legend`)).includes('Pump') && !(await rowIds(page)).includes(ids.pump1));
  await patchSetting(page, 'trackers', { breastfeeding: false });
  await settle(page, 500);
  check('breastfeeding hidden: its row and legend item go, the feed lane stays', !(await rowIds(page)).includes(ids.breast) && !(await page.textContent(`${TL} .legend`)).includes('Breast') && (await statText(page)).some((s) => s.startsWith('feed:')));
  await patchSetting(page, 'trackers', { pump: true, breastfeeding: true });
  await settle(page, 500);
  check('turning them back on brings everything back', (await statText(page)).length === 4 && (await rowIds(page)).includes(ids.pump1));

  // ---- units
  console.log('\noz ↔ mL');
  await setSetting(page, 'units', 'mL');
  await settle(page, 500);
  check('mL: tiles convert (pumped 370 mL)', (await statText(page)).includes('pump:370 mL pumped'), (await statText(page)).join(' | '));
  check('mL: rows convert (bottle 148 mL)', /148\s*mL/.test(await rowText(page, ids.bottle)), await rowText(page, ids.bottle));
  await page.click(`${TL} .row[data-event-id="${ids.pump1}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-amount]');
  await settle(page, 350);
  check('mL: the edit stepper is in whole mL', (await page.inputValue('.sheet-event [data-amount]')) === '133' && /mL/.test(await page.textContent('.sheet-event .ev-value-unit')));
  await page.click('.sheet-event [data-back]');
  await settle(page, 400);
  check('Back steps back to the entry view', await page.isVisible('.sheet-event [data-edit]'));
  check('…the entry says where the milk went', /Stored\s*Fridge/.test(await sheetText(page)));
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await setSetting(page, 'units', 'oz');
  await settle(page, 300);

  // ---- two babies
  console.log('\ntwo babies');
  const theo = await page.evaluate(async (u) => { const { settings } = await import(u); const b = await settings.addBaby({ name: 'Theo', birthDate: '2026-09-02' }); await settings.setActiveBaby(b.id); return b.id; }, mod('/js/core/settings.js'));
  await settle(page, 700);
  check('switching baby: the header names Theo', /Theo/.test(await page.textContent(`${TL} .eyebrow`)));
  check('…Clara\'s feeds, sleeps and diapers leave; the parent\'s pumps stay', !(await rowIds(page)).includes(ids.bottle) && (await rowIds(page)).includes(ids.pump1));
  const theoFeed = await page.evaluate(async ([u, b]) => { const { events } = await import(u); return (await events.add({ type: 'feed', babyId: b, startTime: Date.now() - 5 * 60000, data: { method: 'bottle', milk: 'formula', amount: 2, unit: 'oz' } })).id; }, [mod('/js/core/store.js'), theo]);
  await page.waitForFunction(([sel, id]) => !!document.querySelector(`${sel} .row[data-event-id="${id}"]`), [TL, theoFeed]);
  await page.click(`${TL} .row[data-event-id="${theoFeed}"]`);
  await openLayer(page, '.sheet-event');
  await settle(page, 400);
  check('two babies: the entry says who it was for', /For\s*Theo/.test(await sheetText(page)));
  await page.click('.sheet-event [data-edit]');
  await page.waitForSelector('.sheet-event [data-seg="who"]');
  await settle(page, 350);
  await page.click('.sheet-event [data-seg="who"] [role="radio"]:not([aria-checked="true"])');
  await page.click('.sheet-event [data-save]');
  await waitNoLayers(page);
  await settle(page, 400);
  check('…"this was actually the other twin": it moves to Clara', !(await rowIds(page)).includes(theoFeed));
  await page.evaluate(async (u) => { const { settings } = await import(u); await settings.setActiveBaby(settings.babies()[0].id); }, mod('/js/core/settings.js'));
  await settle(page, 600);
  check('back to Clara: the moved feed is hers now', (await rowIds(page)).includes(theoFeed));

  // ============================================================ report
  console.log('\npediatrician report');
  await scrollTl(page, 99999);
  await settle(page, 200);
  await page.click(`${TL} [data-action="report"]`);
  await page.waitForSelector(`${RP} .rp-tiles`);
  await settle(page, 600);
  check('Report opens as a pushed screen with "‹ Timeline"', /Timeline/.test(await page.textContent(`${RP} .back`)));
  check('…"Clara’s last 7 days", Oct 7 – Oct 13', /Clara’s last 7 days/.test(await page.textContent(`${RP} .rp-title`)) && /Oct 7 – Oct 13/.test(await page.textContent(`${RP} .rp-hd`)));
  const tiles = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .rp-tile`)].map((t) => t.getAttribute('aria-label')), RP);
  check('summary: feeds/day + total, bottle amount, breastfeeds, wet/dirty, sleep + longest, pump', tiles.length === 6
    && /Feeds: 9 a day, 63 in 7 days/.test(tiles[0]) && /Bottles: 28 ounces a day, 196 ounces in all/.test(tiles[1]) && /Breastfeeding: 1 session a day, 7 in all/.test(tiles[2])
    && /Diapers: 4 wet and 1 dirty a day/.test(tiles[3]) && /Longest stretch 3 hours 40 minutes/.test(tiles[4]) && /Pumped: 5 ounces a day from 1 pump; 35 ounces in all/.test(tiles[5]), tiles.join(' | '));
  check('day-by-day table: 7 rows, oldest first', await page.evaluate((sel) => { const r = [...document.querySelectorAll(`${sel} .rp-table tbody tr`)]; return r.length === 7 && /7/.test(r[0].querySelector('th').textContent) && /13/.test(r[6].querySelector('th').textContent); }, RP));
  check('the table fits the phone (no sideways scroll)', await page.evaluate((sel) => { const w = document.querySelector(`${sel} .rp-table-wrap`); return w.scrollWidth <= w.clientWidth + 1; }, RP));
  check('report: no pronoun for the baby', !PRONOUN.test(await page.textContent(RP)));
  await page.screenshot({ path: `${SHOTS}report-light.png` });
  const rpAudit = await targetAudit(page, RP);
  check('report: every control ≥ 44×44 with a name', rpAudit.length === 0, rpAudit.join('; '));
  await page.click(`${RP} [data-days="14"]`);
  await settle(page, 500);
  check('Last 14 days: title + table follow', /last 14 days/.test(await page.textContent(`${RP} .rp-title`)) && (await page.$$(`${RP} .rp-table tbody tr`)).length === 14);
  check('…days before the log began read "—" and don\'t drag the averages', await page.evaluate((sel) => document.querySelectorAll(`${sel} .rp-table tr.is-empty`).length === 5, RP) && /9 days of 14/.test(await page.textContent(`${RP} .rp-intro`)));
  await page.focus(`${RP} [data-days="14"]`);
  await page.keyboard.press('ArrowLeft');
  await settle(page, 400);
  check('range is a radiogroup with arrow keys', (await page.getAttribute(`${RP} [data-days="7"]`, 'aria-checked')) === 'true');
  await setSetting(page, 'units', 'mL');
  await settle(page, 500);
  check('mL: the report converts', /Pumped: 148 milliliters a day/.test(await page.evaluate((sel) => document.querySelectorAll(`${sel} .rp-tile`)[5].getAttribute('aria-label'), RP)));
  await setSetting(page, 'units', 'oz');
  await patchSetting(page, 'trackers', { pump: false });
  await settle(page, 500);
  check('hidden pump tracker: no pump tile, no pump column', (await page.$$(`${RP} .rp-tile.cat-pump`)).length === 0 && !/Pump/.test(await page.textContent(`${RP} .rp-table thead`)));
  await patchSetting(page, 'trackers', { pump: true });
  await settle(page, 400);
  await page.click(`${RP} [data-action="print"]`);
  check('"Save as PDF / Print" calls window.print()', (await page.evaluate(() => window.__printed)) === 1);
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate((sel) => ({
    nav: getComputedStyle(document.getElementById('tabBar')).display, actions: getComputedStyle(document.querySelector(`${sel} .rp-actions`)).display,
    meta: getComputedStyle(document.querySelector(`${sel} .rp-print-meta`)).display, pills: getComputedStyle(document.getElementById('livePills')).display,
  }), RP);
  check('print stylesheet: no nav, pills or buttons; a "Made with Nurture" line', printed.nav === 'none' && printed.actions === 'none' && printed.pills === 'none' && printed.meta === 'block', JSON.stringify(printed));
  await page.screenshot({ path: `${SHOTS}report-print.png`, fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click(`${RP} [data-action="csv"]`);
  const dl = await download;
  check('"Share CSV" hands over a .csv (download where sharing isn\'t available)', !!dl && /\.csv$/.test(dl.suggestedFilename()));
  await page.waitForFunction(() => /CSV saved/.test((document.querySelector('.toast[data-state="in"] .toast-msg') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});
  check('…with a calm toast', /CSV saved/.test(await toastText(page)));
  await page.evaluate(async (u) => { const { settings } = await import(u); await settings.setActiveBaby(settings.babies()[1].id); }, mod('/js/core/settings.js'));
  await settle(page, 600);
  check('switching baby re-renders the report for Theo', /Theo’s last 7 days/.test(await page.textContent(`${RP} .rp-title`)));
  await page.evaluate(async (u) => { const { settings } = await import(u); await settings.setActiveBaby(settings.babies()[0].id); }, mod('/js/core/settings.js'));
  await settle(page, 400);
  await page.click(`${RP} .back`);
  await page.waitForFunction(() => !document.querySelector('[data-view="report"]'));
  await settle(page, 500);
  check('‹ Timeline pops back to the timeline, focus on the report row', await page.evaluate(() => document.activeElement && document.activeElement.dataset.action === 'report'));

  // Reduced motion: still works, rows still get the wash (colour, not motion).
  await setSetting(page, 'reduceMotion', true);
  await settle(page, 200);
  await page.click(`${TL} [data-action="prev"]`);
  await settle(page, 300);
  check('reduced motion: paging still works', (await page.textContent(`${TL} .page-title`)) === 'Yesterday');
  check('no CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join('; '));
  await context.close();
  // ============================================================ night (clean sample day)
  console.log('\nnight');
  {
    const night = await freshPage({ theme: 'dark' });
    const p = night.page;
    const nid = await seed(p);
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await gotoTimeline(p);
    await settle(p, 400);
    await p.screenshot({ path: `${SHOTS}timeline-night.png` });
    check('night: nap outline / night solid survive (shape, not lightness)', await p.evaluate((sel) => getComputedStyle(document.querySelector(`${sel} .s-nap.s-mark`)).fill === 'none'
      && getComputedStyle(document.querySelector(`${sel} .s-sleep.s-mark`)).fill !== 'none', TL));
    await p.click(`${TL} .row[data-event-id="${nid.bottle}"]`);
    await openLayer(p, '.sheet-event');
    await settle(p, 500);
    await p.screenshot({ path: `${SHOTS}timeline-entry-night.png` });
    await p.click('.sheet-event [data-edit]');
    await settle(p, 500);
    await p.screenshot({ path: `${SHOTS}timeline-edit-night.png` });
    await p.keyboard.press('Escape');
    await waitNoLayers(p);
    await scrollTl(p, 99999);
    await settle(p, 200);
    await p.click(`${TL} [data-action="report"]`);
    await p.waitForSelector(`${RP} .rp-tiles`);
    await settle(p, 700);
    await p.screenshot({ path: `${SHOTS}report-night.png` });
    check('night: the report renders', (await p.$$(`${RP} .rp-tile`)).length === 6);
    check('night: no CSP violations', (await p.evaluate(() => window.__csp)).length === 0);
    await night.context.close();
  }
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.log(err);
} finally {
  await browser.close();
}

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
check('zero requests to any other origin', foreign.length === 0, foreign.slice(0, 5).join(' | '));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
