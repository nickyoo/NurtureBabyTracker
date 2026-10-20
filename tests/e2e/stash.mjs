// e2e: the Stash tab (js/views/stash.js) + the stash sheet (js/sheets/stash.js)
// on a FRESH profile at 390×844 (DESIGN §13 Frame 5).
//
//  - empty: warm "No milk stored yet" → Add pouch (amount stepper, where,
//    pumped time chip, note) → in-sheet "Added" → the row slides into its
//    section after the sheet closes; notes are escaped
//  - frame 5 data: "46 oz", "About 11 bottles of 4 oz", split bar + legend,
//    Use-next hero = oldest freezer pouch ("frozen 6 weeks", "Best by …"),
//    Fridge rows "3 days left" / "4 days left", screenshots light + night
//  - Thaw (hero keeps its place, art cross-fades, row moves to Thawed) +
//    Undo; double-tap guard; Thaw & feed → feed sheet with the pouch as the
//    source → logging the bottle uses the pouch up
//  - pouch detail: Mark used / Discard with Undo, Edit → Saved, Delete +
//    Undo; archive → Put back
//  - expired pouches ("Expired · discard"), mL, two babies (switching baby
//    updates the bottle line), hidden bottle / stash trackers, lots of data
//  - zero console errors, zero non-local requests, ≥44px named controls
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/stash.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });
const mod = (path) => `${BASE_URL}${path}`;
const DAY = 24 * 60 * 60 * 1000;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];

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
  await page.waitForTimeout(300);
  return { context, page };
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function setSetting(page, key, value) {
  await page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}
async function patchTrackers(page, patch) {
  await page.evaluate(async ([u, p]) => { const { settings } = await import(u); await settings.patch('trackers', p); }, [mod('/js/core/settings.js'), patch]);
}
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const title = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop(); return l ? l.querySelector('.sheet-title').textContent : null; });
const pouches = (page) => page.evaluate(async (u) => (await import(u)).stash.list({ filter: 'everything' }), mod('/js/core/stash.js'));
const getPouch = (page, id) => page.evaluate(async ([u, i]) => (await import(u)).stash.get(i), [mod('/js/core/stash.js'), id]);
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const texts = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const rowsIn = (page, sec) => page.evaluate((k) => [...document.querySelectorAll(`.stx-sec[data-sec="${k}"] li:not(.is-removing) .stx-row`)].map((b) => b.textContent.replace(/\s+/g, ' ').trim()), sec);

/** Add pouches straight into the store: [{ ago (ms), q, unit?, loc, notes? }]. Returns ids. */
async function seed(page, list) {
  return page.evaluate(async ([u, l]) => {
    const { stash } = await import(u);
    const ids = [];
    for (const p of l) ids.push((await stash.add({ pumpedAt: Date.now() - p.ago, quantity: p.q, unit: p.unit || 'oz', location: p.loc, notes: p.notes || '' })).id);
    return ids;
  }, [mod('/js/core/stash.js'), list]);
}

/** Frame 5: fridge 5.5 oz (yesterday 8:20 PM) + 3.5 oz (today early), freezer 8 pouches = 37 oz, oldest 6 weeks. */
function frameData() {
  const now = new Date();
  const y820 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 20, 20).getTime();
  const todayEarly = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 10).getTime();
  const early = Math.min(todayEarly, Date.now() - 60 * 1000);
  return [
    { ago: 42 * DAY, q: 4, loc: 'freezer' },
    { ago: 38 * DAY, q: 5, loc: 'freezer' },
    { ago: 33 * DAY, q: 5, loc: 'freezer' },
    { ago: 27 * DAY, q: 4.5, loc: 'freezer' },
    { ago: 21 * DAY, q: 4.5, loc: 'freezer' },
    { ago: 16 * DAY, q: 5, loc: 'freezer' },
    { ago: 11 * DAY, q: 4.5, loc: 'freezer' },
    { ago: 6 * DAY, q: 4.5, loc: 'freezer' },
    { ago: Date.now() - y820, q: 5.5, loc: 'fridge' },
    { ago: Date.now() - early, q: 3.5, loc: 'fridge' },
  ];
}

async function goStash(page) {
  await page.click('#tabBar [data-tab="stash"]');
  await page.waitForSelector('[data-view="stash"] .stx');
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-view="stash"]');
    return v && (v.querySelector('.stx-hero') || v.querySelector('.stx-empty'));
  }, null, { timeout: 4000 });
  await settle(page, 450);
}

/** Click after scrolling the target to the middle of its scroller (clear of the nav / pill / toast). */
async function tap(page, sel) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await page.waitForTimeout(80);
  await page.click(sel);
}

async function openRow(page, sec, i = 0) {
  await tap(page, `.stx-sec[data-sec="${sec}"] li:nth-child(${i + 1}) .stx-row`);
  await page.waitForSelector('.sheet-layer.sheet-stash[data-state="open"] .sx-detail');
  await settle(page, 450);
}

// Every interactive thing in a container: real element, ≥44px, has a name.
async function auditTargets(page, label, scope = 'sheet') {
  const bad = await page.evaluate((sc) => {
    const root = sc === 'sheet' ? [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop() : document.querySelector('[data-view="stash"]');
    const out = [];
    for (const el of root.querySelectorAll('button, input, textarea, a[href], [role="radio"], [role="spinbutton"]')) {
      if (el.closest('[hidden]') || el.classList.contains('sheet-close') || el.getClientRects().length === 0) continue;
      const r = el.getBoundingClientRect();
      const target = el.matches('input, textarea') ? el.closest('label') || el : el;
      const tr = target.getBoundingClientRect();
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim()
        || (el.closest('label') && el.closest('label').textContent.trim());
      if (Math.max(r.height, tr.height) < 44 || Math.max(r.width, tr.width) < 44) out.push(`${el.tagName}.${el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!name) out.push(`${el.tagName}.${el.className} has no name`);
      if (!['BUTTON', 'INPUT', 'TEXTAREA', 'A'].includes(el.tagName)) out.push(`${el.tagName} is not a real control`);
    }
    return out;
  }, scope);
  check(`${label}: every control is real, ≥44px and named`, bad.length === 0, bad.join(' | '));
}

try {
  // ============================================================== empty + add
  console.log('\nempty stash → add a pouch');
  {
    const { context, page } = await freshPage();
    await goStash(page);
    check('empty state: "No milk stored yet" + one primary Add pouch', await text(page, '.stx-empty .empty-title') === 'No milk stored yet'
      && /Pumped milk you save will line up here, oldest first\./.test(await text(page, '.stx-empty .empty-text'))
      && await page.isHidden('[data-hd-actions]'));
    await page.screenshot({ path: `${SHOTS}stash-empty-light.png` });
    await auditTargets(page, 'empty stash', 'view');

    await page.click('.stx-empty [data-action="add"]');
    await page.waitForSelector('.sheet-layer.sheet-stash[data-state="open"] .sx-form');
    await settle(page, 500);
    check('Add pouch sheet opens from the button', await title(page) === 'Add pouch');
    check('the empty-state button is the sheet origin (pressed)', await page.evaluate(() => document.querySelector('.stx-empty [data-action="add"]').classList.contains('is-sheet-origin')));
    const sp = () => page.evaluate(() => { const i = document.querySelector('.sheet-stash [role="spinbutton"]'); return { now: i.getAttribute('aria-valuenow'), text: i.getAttribute('aria-valuetext') }; });
    check('amount spinbutton starts at 4 oz', (await sp()).now === '4' && (await sp()).text === '4 ounces');
    check('header time chip reads "Now"', /^Now/.test(await text(page, '.sheet-stash .time-chip')));
    check('where: Fridge / Freezer / Deep freezer / Room temp radios, Fridge checked', (await page.evaluate(() => [...document.querySelectorAll('.sheet-stash [data-places] [role="radio"]')].map((b) => `${b.querySelector('b').textContent}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`).join(','))) === 'Fridge*,Freezer,Deep freezer,Room temp');
    check('keeps line: "Keeps until … · 4 days left"', /Keeps until .* · 4 days left/.test(await text(page, '.sheet-stash [data-keeps]')));
    await auditTargets(page, 'add pouch');
    await page.screenshot({ path: `${SHOTS}stash-add-light.png` });

    await page.click('.sheet-stash [data-inc]');
    check('+ steps 0.5 oz', (await sp()).now === '4.5');
    await page.click('.sheet-stash [role="radio"][data-value="freezer"]');
    check('Freezer → "Best by … · N months left"', /Best by .* months left/.test(await text(page, '.sheet-stash [data-keeps]')));
    // Keypad: tap the value.
    await page.click('.sheet-stash [role="spinbutton"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer[data-state="open"]').length === 2);
    await settle(page, 400);
    check('tapping the value opens the keypad sheet', await title(page) === 'How much?');
    await page.click('.sheet-sx-keypad [data-key="5"]');
    await page.click('.sheet-sx-keypad [data-kp-done]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer[data-state="open"]').length === 1);
    await settle(page, 350);
    check('keypad → 5 oz', (await sp()).now === '5');
    // Pumped time: 3 hours ago.
    await page.click('.sheet-stash .time-chip');
    await page.waitForSelector('.sheet-sx-when[data-state="open"]');
    await settle(page, 400);
    check('time chip → "When was it pumped?" with a date field', await title(page) === 'When was it pumped?' && await page.isVisible('.sheet-sx-when input[type="date"]'));
    await auditTargets(page, 'when picker');
    await page.click('.sheet-sx-when [data-ago="180"]');
    await page.waitForFunction(() => document.querySelectorAll('.sheet-layer[data-state="open"]').length === 1);
    await settle(page, 350);
    check('time chip now shows a set time', await page.evaluate(() => document.querySelector('.sheet-stash .time-chip').classList.contains('is-set')));
    await page.fill('.sheet-stash [data-note]', '<b>bag</b> 2');
    check('primary reads "Add pouch · 5 oz"', (await text(page, '.sheet-stash [data-save]')) === 'Add pouch · 5 oz');
    await page.click('.sheet-stash [data-save]');
    await page.waitForFunction(() => { const b = document.querySelector('.sheet-stash [data-save]'); return b && /Added/.test(b.textContent); }, null, { timeout: 3000 });
    check('in-sheet success "Added"', true);
    check('sheet closes after the success hold', await waitNoLayers(page));
    const all = await pouches(page);
    const p = all[0];
    check('stored: 5 oz, oz, freezer, ~3h ago, note kept as text', all.length === 1 && p.quantity === 5 && p.unit === 'oz' && p.location === 'freezer'
      && Math.abs(Date.now() - p.pumpedAt - 3 * 3600e3) < 120e3 && p.notes === '<b>bag</b> 2', JSON.stringify(p));
    await page.waitForSelector('.stx-sec[data-sec="freezer"] .stx-row');
    check('the new row slides into Freezer (is-inserting + is-new)', await page.evaluate(() => {
      const li = document.querySelector('.stx-sec[data-sec="freezer"] li');
      return li.classList.contains('is-inserting') && li.firstElementChild.classList.contains('is-new');
    }));
    check('note renders as text, never markup', await page.evaluate(() => {
      const meta = document.querySelector('.stx-sec[data-sec="freezer"] .row-meta');
      return meta.textContent.includes('<b>bag</b> 2') && !meta.querySelector('b');
    }));
    check('focus went back to the view (origin is gone)', await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
    check('header now shows 5 oz + Add pouch', /^5\s*oz$/.test(await text(page, '.stx-total')) && await page.isVisible('[data-hd-actions] [data-action="add"]'));
    check('hero: Use next · oldest in freezer · Thaw / Thaw & feed', await text(page, '.stx-hero [data-hero-tag]') === 'Use next'
      && await text(page, '.stx-hero [data-hero-loc]') === 'Oldest in freezer'
      && (await texts(page, '.stx-hero [data-hero-act]')).join('|') === 'Thaw|Thaw & feed');
    await context.close();
  }

  // ============================================================== frame 5
  console.log('\nframe 5: header, split, hero, fridge rows');
  for (const dark of [false, true]) {
    const { context, page } = await freshPage({ dark });
    await seed(page, frameData());
    await goStash(page);
    if (!dark) {
      check('total "46 oz"', /^46\s*oz$/.test(await text(page, '.stx-total')));
      check('sub-line "About 11 bottles of 4 oz"', await text(page, '.stx-sub') === 'About 11 bottles of 4 oz');
      check('split bar: role=img + summary label', await page.evaluate(() => { const s = document.querySelector('.stx-split'); return s.getAttribute('role') === 'img' && s.getAttribute('aria-label') === 'Fridge 9 ounces, freezer 37 ounces'; }));
      check('split parts sized by amount (--part)', await page.evaluate(() => {
        const fr = document.querySelector('.stx-split .fr').getBoundingClientRect().width;
        const fz = document.querySelector('.stx-split .fz').getBoundingClientRect().width;
        return fz > fr * 3 && fz < fr * 5;
      }));
      check('legend "Fridge 9 oz · 2" / "Freezer 37 oz · 8"', (await texts(page, '.stx-legend span')).join('|') === 'Fridge 9 oz · 2|Freezer 37 oz · 8');
      check('hero amount 4 oz + "frozen 6 weeks" + "Best by … · N months left"', /^4\s*oz$/.test(await text(page, '.stx-hero [data-hero-amt]'))
        && /Pumped .* · frozen 6 weeks ?Best by .* · 4½ months left/.test(await text(page, '.stx-hero [data-hero-meta]')), await text(page, '.stx-hero [data-hero-meta]'));
      check('eyebrow "MILK STASH" is the 12 px caps eyebrow (not display type)', await page.evaluate(() => {
        const e = document.querySelector('.stx-hd h1.eyebrow');
        const cs = getComputedStyle(e);
        return parseFloat(cs.fontSize) <= 13 && cs.textTransform === 'uppercase' && !/fraunces/i.test(cs.fontFamily);
      }));
      check('"Best by" six months out has no year and fits on two lines', await page.evaluate(() => {
        const m = document.querySelector('.stx-hero [data-hero-meta]');
        const lh = parseFloat(getComputedStyle(m).lineHeight) || 20;
        return !/\b20\d\d\b/.test(m.textContent) && m.getBoundingClientRect().height < lh * 2.6;
      }), await text(page, '.stx-hero [data-hero-meta]'));
      check('Fridge section: "9 oz", "Keeps 4 days"', await text(page, '.stx-sec[data-sec="fridge"] .stx-sec-amt') === '9 oz' && await text(page, '.stx-sec[data-sec="fridge"] .sec-meta') === 'Keeps 4 days');
      const fr = await rowsIn(page, 'fridge');
      // Days left round to the nearest day (frame 5 at 9:50 AM: 3 and 4).
      const left = await page.evaluate(async (u) => (await (await import(u)).stash.list({ filter: 'fridge' })).map((p) => Math.round((p.expiresAt - Date.now()) / 864e5)), mod('/js/core/stash.js'));
      check('Fridge rows oldest first: 5.5 oz yesterday, 3.5 oz today, "N days left"', fr.length === 2
        && new RegExp(`^5\\.5 oz ?Yesterday, .* ${left[0]} days left$`).test(fr[0]) && new RegExp(`^3\\.5 oz ?Today, .* ${left[1]} days left$`).test(fr[1]), fr.join(' | '));
      check('Freezer section: 37 oz, 8 rows, oldest first', await text(page, '.stx-sec[data-sec="freezer"] .stx-sec-amt') === '37 oz' && (await rowsIn(page, 'freezer')).length === 8);
      check('no anxious copy, no pronouns', await page.evaluate(() => !/\b(she|her|he|his)\b|warning|overdue|!/i.test(document.querySelector('[data-view="stash"]').textContent)));
      await auditTargets(page, 'stash view', 'view');
    }
    await page.screenshot({ path: `${SHOTS}stash-${dark ? 'night' : 'light'}.png` });
    await page.evaluate(() => document.querySelector('[data-view="stash"]').scrollTo(0, 600));
    await settle(page, 200);
    await page.screenshot({ path: `${SHOTS}stash-sections-${dark ? 'night' : 'light'}.png` });
    await page.evaluate(() => document.querySelector('[data-view="stash"]').scrollTo(0, 0));
    if (dark) {
      check('night: Thaw is soft ember (not a lit fill)', await page.evaluate(() => getComputedStyle(document.querySelector('.stx-hero .btn-primary')).backgroundColor === 'rgb(58, 42, 32)'));
    }
    await context.close();
  }

  // ============================================================== thaw + undo, thaw & feed
  console.log('\nthaw · undo · double-tap · thaw & feed');
  {
    const { context, page } = await freshPage();
    const ids = await seed(page, frameData());
    await goStash(page);
    // Double-tap Thaw: one thaw, one toast, no error.
    await page.dblclick('.stx-hero [data-hero-act="thaw"]');
    await page.waitForSelector('#toastRoot .toast');
    await settle(page, 500);
    check('Thaw → toast "Thawed · use within 24h" with Undo', /Thawed · use within 24h/.test(await text(page, '#toastRoot .toast-msg')) && await page.isVisible('#toastRoot .toast-action'));
    const thawed = await getPouch(page, ids[0]);
    check('the oldest frozen pouch is thawed in the store', thawed.location === 'thawed' && Number.isFinite(thawed.thawedAt));
    check('hero keeps its place: same pouch, thawed state, art cross-faded', await page.evaluate((id) => {
      const h = document.querySelector('.stx-hero');
      return h.dataset.pouch === id && h.dataset.state === 'thawed' && h.querySelector('[data-art]').classList.contains('is-thawed');
    }, ids[0]));
    check('hero (thawed): Feed / Discard + "use within 23h"', (await texts(page, '.stx-hero [data-hero-act]')).join('|') === 'Feed|Discard' && /use within 2[34]h/.test(await text(page, '.stx-hero [data-hero-meta]')));
    check('the row moved: Thawed has 1, Freezer 7', (await rowsIn(page, 'thawed')).length === 1 && (await rowsIn(page, 'freezer')).length === 7);
    check('double-tap made exactly one toast', await page.evaluate(() => document.querySelectorAll('#toastRoot .toast').length === 1));
    check('thawed row meta reads "Thawed just now"', /^4 oz ?Thawed just now/.test((await rowsIn(page, 'thawed'))[0] || ''), (await rowsIn(page, 'thawed'))[0]);
    await page.evaluate(() => window.getSelection().removeAllRanges()); // dblclick word-selection (desktop only)
    await page.screenshot({ path: `${SHOTS}stash-thawed-light.png` });
    await page.click('#toastRoot .toast-action');
    await page.waitForFunction(() => { const h = document.querySelector('.stx-hero'); return h && h.dataset.state === 'frozen'; }, null, { timeout: 3000 });
    await settle(page, 400);
    check('Undo → frozen again, back in the freezer (8 rows)', (await getPouch(page, ids[0])).location === 'freezer' && (await rowsIn(page, 'freezer')).length === 8 && !(await page.$('.stx-sec[data-sec="thawed"]:not(.is-leaving)')));

    // Thaw & feed.
    await page.click('.stx-hero [data-hero-act="thaw-feed"]');
    await page.waitForSelector('.sheet-layer.sheet-feed[data-state="open"]');
    await settle(page, 600);
    check('Thaw & feed → the feed sheet (Bottle) from the button', await title(page) === 'Bottle');
    check('…with the pouch thawed and picked as the source', (await getPouch(page, ids[0])).location === 'thawed'
      && await page.evaluate((id) => { const b = document.querySelector(`.sheet-feed [data-src="${id}"]`); return !!b && b.getAttribute('aria-checked') === 'true'; }, ids[0]));
    check('the stash view waits under the sheet (no repaint yet)', await page.evaluate(() => document.querySelector('.stx-hero').dataset.state === 'frozen'));
    await page.click('.sheet-feed [data-log]');
    check('logging the bottle closes the feed sheet', await waitNoLayers(page));
    await settle(page, 600);
    const used = await getPouch(page, ids[0]);
    check('the pouch was used by the feed (4 oz bottle from a 4 oz pouch)', used.status === 'used', JSON.stringify(used));
    check('after the sheet: hero moves on to the next frozen pouch', await page.evaluate((id) => document.querySelector('.stx-hero').dataset.pouch !== id, ids[0]) && (await rowsIn(page, 'freezer')).length === 7);
    check('"Used & discarded · 1 pouch" link appears', /Used & discarded ?1 pouch/.test(await text(page, '.stx-archive-row')));
    check('the sub-line follows the new bottle (4 oz)', /bottles of 4 oz$/.test(await text(page, '.stx-sub')));
    await context.close();
  }

  // ============================================================== detail actions
  console.log('\npouch detail: used · discard · edit · delete · archive');
  {
    const { context, page } = await freshPage();
    await seed(page, frameData());
    await goStash(page);
    await openRow(page, 'fridge', 0);
    check('fridge row → "Fridge pouch" detail', await title(page) === 'Fridge pouch');
    check('detail: Feed from this pouch / Mark used / Edit / Discard', (await texts(page, '.sheet-stash [data-act]')).join('|') === 'Feed from this pouch|Mark used|Edit|Discard');
    check('detail facts: Pumped / Use by', (await texts(page, '.sheet-stash .sx-fact dt')).join('|') === 'Pumped|Use by');
    check('the row is the sheet origin (pressed)', await page.evaluate(() => document.querySelector('.stx-sec[data-sec="fridge"] li .stx-row').classList.contains('is-sheet-origin')));
    await auditTargets(page, 'pouch detail');
    await page.screenshot({ path: `${SHOTS}stash-detail-light.png` });
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    check('Esc → focus back on the row', await page.evaluate(() => document.activeElement && document.activeElement.matches('.stx-sec[data-sec="fridge"] li:first-child .stx-row')));

    // Mark used + Undo.
    await openRow(page, 'fridge', 0);
    await page.click('.sheet-stash [data-act="used"]');
    check('Mark used closes the sheet', await waitNoLayers(page));
    await page.waitForSelector('#toastRoot .toast');
    check('toast "Marked used" + Undo', await text(page, '#toastRoot .toast-msg') === 'Marked used');
    await settle(page, 450);
    check('the row collapsed out of Fridge', (await rowsIn(page, 'fridge')).length === 1);
    await page.click('#toastRoot .toast-action');
    await page.waitForFunction(() => document.querySelectorAll('.stx-sec[data-sec="fridge"] li:not(.is-removing)').length === 2, null, { timeout: 3000 });
    check('Undo → the row is back', true);

    // Discard + Undo.
    await openRow(page, 'fridge', 1);
    await page.click('.sheet-stash [data-act="discard"]');
    await waitNoLayers(page);
    await page.waitForSelector('#toastRoot .toast');
    check('Discard → toast "Pouch discarded"', await text(page, '#toastRoot .toast-msg') === 'Pouch discarded');
    await settle(page, 450);
    check('archive link counts it', /1 pouch/.test(await text(page, '.stx-archive-row')));

    // Edit → Saved.
    await openRow(page, 'freezer', 0);
    await page.click('.sheet-stash [data-act="edit"]');
    await page.waitForSelector('.sheet-stash .sx-form [data-save]');
    await settle(page, 450);
    check('Edit steps forward to "Edit pouch" prefilled', await title(page) === 'Edit pouch' && await page.evaluate(() => document.querySelector('.sheet-stash [role="spinbutton"]').getAttribute('aria-valuenow')) === '4');
    await auditTargets(page, 'edit pouch');
    await page.click('.sheet-stash [data-inc]');
    await page.click('.sheet-stash [data-save]');
    await page.waitForSelector('.sheet-stash .sx-detail');
    await settle(page, 450);
    check('Saved → back to the detail with 4.5 oz', /^4\.5\s*oz$/.test(await text(page, '.sheet-stash .sx-sum-amt')));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await settle(page, 300);
    check('hero shows the edited amount', /^4\.5\s*oz$/.test(await text(page, '.stx-hero [data-hero-amt]')));

    // Delete + Undo.
    const before = (await pouches(page)).length;
    await openRow(page, 'freezer', 7);
    await page.click('.sheet-stash [data-act="edit"]');
    await page.waitForSelector('.sheet-stash [data-delete]');
    await settle(page, 400);
    await page.click('.sheet-stash [data-delete]');
    await waitNoLayers(page);
    await page.waitForSelector('#toastRoot .toast');
    await settle(page, 400);
    check('Delete pouch → gone + "Pouch deleted" toast', (await pouches(page)).length === before - 1 && await text(page, '#toastRoot .toast-msg') === 'Pouch deleted');
    await page.click('#toastRoot .toast-action');
    await page.waitForFunction((n) => document.querySelectorAll('.stx-sec[data-sec="freezer"] li:not(.is-removing)').length === n, 8, { timeout: 3000 }).catch(() => {});
    check('Undo → it is back', (await pouches(page)).length === before && (await rowsIn(page, 'freezer')).length === 8);

    // Archive → Put back.
    await settle(page, 1300);
    await tap(page, '.stx-archive-row');
    await page.waitForSelector('.sheet-stash .sx-archive');
    await settle(page, 450);
    check('archive sheet "Used & discarded" lists the discarded pouch', await title(page) === 'Used & discarded' && (await texts(page, '.sheet-stash .sx-archive .row')).length === 1);
    check('archive row: badge "Discarded today", meta "Pumped …"', /Discarded today/.test(await text(page, '.sheet-stash .sx-archive .row .badge')) && /^Pumped /.test(await text(page, '.sheet-stash .sx-archive .row .row-meta')), await text(page, '.sheet-stash .sx-archive .row'));
    await auditTargets(page, 'archive');
    await page.screenshot({ path: `${SHOTS}stash-archive-light.png` });
    await page.click('.sheet-stash .sx-archive .row');
    await page.waitForSelector('.sheet-stash .sx-detail [data-act="restore"]');
    await settle(page, 450);
    check('archived detail: "Put back in the stash" / Delete + a Back link', (await texts(page, '.sheet-stash [data-act]')).join('|') === 'Put back in the stash|Delete' && await page.isVisible('.sheet-stash [data-back]'));
    await page.click('.sheet-stash [data-back]');
    await page.waitForSelector('.sheet-stash .sx-archive');
    await settle(page, 400);
    check('Back → the archive list again', await title(page) === 'Used & discarded');
    await page.click('.sheet-stash .sx-archive .row');
    await page.waitForSelector('.sheet-stash [data-act="restore"]');
    await settle(page, 400);
    await page.click('.sheet-stash [data-act="restore"]');
    await waitNoLayers(page);
    await settle(page, 500);
    check('Put back → active again, Fridge has 2 rows, archive link gone', (await rowsIn(page, 'fridge')).length === 2 && !(await page.$('.stx-archive-row')));
    await context.close();
  }

  // ============================================================== expired, mL, babies, trackers
  console.log('\nexpired · mL · two babies · hidden trackers · lots of data');
  {
    const { context, page } = await freshPage();
    await seed(page, [{ ago: 5 * DAY, q: 3, loc: 'fridge' }, { ago: 20 * DAY, q: 120, unit: 'mL', loc: 'freezer' }]);
    await goStash(page);
    check('expired fridge milk → "Expired" section, "Expired · discard"', (await rowsIn(page, 'expired')).length === 1 && /Expired · discard$/.test((await rowsIn(page, 'expired'))[0]));
    check('hero never offers expired milk', await page.evaluate(() => document.querySelector('.stx-hero').dataset.state === 'frozen'));
    check('a 120 mL pouch shows as 4.1 oz in oz mode', /^4\.1\s*oz$/.test(await text(page, '.stx-hero [data-hero-amt]')));
    await openRow(page, 'expired', 0);
    check('expired detail: Discard (primary) + Edit only', (await texts(page, '.sheet-stash [data-act]')).join('|') === 'Discard|Edit' && await title(page) === 'Expired pouch');
    await page.keyboard.press('Escape');
    await waitNoLayers(page);

    await setSetting(page, 'units', 'mL');
    await settle(page, 400);
    check('mL: total "120 mL" (expired milk never counts) and pouches in mL', /^120\s*mL$/.test(await text(page, '.stx-total')) && /^120\s*mL$/.test(await text(page, '.stx-hero [data-hero-amt]')), await text(page, '.stx-total'));
    check('mL: "About 1 bottle of 120 mL"', await text(page, '.stx-sub') === 'About 1 bottle of 120 mL', await text(page, '.stx-sub'));
    await page.click('[data-hd-actions] [data-action="add"]');
    await page.waitForSelector('.sheet-stash .sx-form');
    await settle(page, 450);
    check('mL add form: 120 mL default, presets in mL', await page.evaluate(() => document.querySelector('.sheet-stash [role="spinbutton"]').getAttribute('aria-valuetext')) === '120 milliliters'
      && (await texts(page, '.sheet-stash [data-preset]')).join(',') === '60 mL,120 mL,180 mL,240 mL');
    await page.screenshot({ path: `${SHOTS}stash-add-ml-light.png` });
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await setSetting(page, 'units', 'oz');

    // Two babies: the bottle line follows the active baby.
    const seedFrame = await seed(page, frameData());
    void seedFrame;
    await page.evaluate(async ([s, st]) => {
      const { settings } = await import(s);
      const { events } = await import(st);
      const a = settings.activeBaby();
      await settings.updateBaby(a.id, { name: 'Clara' });
      const b = await settings.addBaby({ name: 'Ben' });
      for (let i = 1; i <= 3; i += 1) {
        await events.add({ type: 'feed', startTime: Date.now() - i * 3 * 3600e3, endTime: Date.now() - i * 3 * 3600e3 + 900e3, babyId: b.id, data: { method: 'bottle', milk: 'breastmilk', amount: 6, unit: 'oz' } });
      }
    }, [mod('/js/core/settings.js'), mod('/js/core/store.js')]);
    await settle(page, 400);
    const clara = await text(page, '.stx-sub');
    check('two babies: the line names the active baby', /Clara’s 4 oz bottles/.test(clara), clara);
    await page.evaluate(async (s) => { const { settings } = await import(s); const b = settings.babies().find((x) => x.name === 'Ben'); await settings.setActiveBaby(b.id); }, mod('/js/core/settings.js'));
    await settle(page, 400);
    const ben = await text(page, '.stx-sub');
    check('switching baby updates it (Ben’s 6 oz bottles)', /Ben’s 6 oz bottles/.test(ben), ben);

    // Hidden bottle tracker: no feed buttons anywhere.
    await patchTrackers(page, { bottle: false });
    await settle(page, 400);
    check('bottle hidden: hero is Thaw only, sub-line counts pouches', (await texts(page, '.stx-hero [data-hero-act]')).join('|') === 'Thaw' && /pouches$/.test(await text(page, '.stx-sub')));
    await openRow(page, 'fridge', 0);
    check('bottle hidden: detail offers Mark used, no Feed', !(await texts(page, '.sheet-stash [data-act]')).some((t) => /Feed/.test(t)));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await patchTrackers(page, { bottle: true });

    // Hidden stash tracker: the tab disappears.
    await patchTrackers(page, { stash: false });
    await settle(page, 600);
    check('stash hidden: no Stash tab, back on Today', !(await page.$('#tabBar [data-tab="stash"]')) && !!(await page.$('[data-view="today"]')));
    await patchTrackers(page, { stash: true });
    await settle(page, 400);

    // Lots of data.
    await seed(page, Array.from({ length: 60 }, (_, i) => ({ ago: (i + 1) * 2 * DAY, q: 3 + (i % 4) * 0.5, loc: i % 3 ? 'freezer' : 'deepFreezer' })));
    await goStash(page);
    const counts = await page.evaluate(() => ['freezer', 'deepFreezer'].map((k) => document.querySelectorAll(`.stx-sec[data-sec="${k}"] .stx-row`).length));
    check('lots of data: 60 more frozen pouches render in Freezer + Deep freezer', counts[0] + counts[1] >= 60, counts.join('+'));
    check('no horizontal overflow at 390', await page.evaluate(() => document.querySelector('[data-view="stash"]').scrollWidth <= 390));
    await context.close();
  }

  // ============================================================== quick-log + Today entry points
  console.log('\nentry points: + → Stash milk, Today');
  {
    const { context, page } = await freshPage();
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="stash"]');
    await settle(page);
    await page.click('.sheet-layer [data-key="stash"]');
    await page.waitForSelector('.sheet-layer.sheet-stash[data-state="open"] .sx-form');
    await settle(page, 600);
    check('quick-log "Stash milk" → Add pouch (one sheet)', await title(page) === 'Add pouch' && await page.evaluate(() => document.querySelectorAll('.sheet-layer[data-state="open"]').length) === 1);
    await page.click('.sheet-stash [data-save]');
    check('add from + closes', await waitNoLayers(page));
    await settle(page, 400);
    check('the pouch is stored', (await pouches(page)).length === 1);
    await context.close();
  }

  // ============================================================== reduced motion
  console.log('\nreduced motion');
  {
    const { context, page } = await freshPage();
    await setSetting(page, 'reduceMotion', true);
    await seed(page, frameData());
    await goStash(page);
    await page.click('.stx-hero [data-hero-act="thaw"]');
    await page.waitForSelector('#toastRoot .toast');
    await settle(page, 300);
    check('reduced motion: thaw still works, no transforms on rows', await page.evaluate(() => document.querySelector('.stx-hero').dataset.state === 'thawed'
      && [...document.querySelectorAll('.stx-row, .stx-sec')].every((r) => { const t = getComputedStyle(r.matches('.stx-row') ? r.parentElement : r).transform; return t === 'none' || (new DOMMatrix(t).e === 0 && new DOMMatrix(t).f === 0); })));
    await context.close();
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero requests to any other origin', foreign.length === 0, foreign.join(' | '));
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nstash: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
