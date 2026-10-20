// e2e: the whole app, end to end, the way a parent meets it. Integration
// walkthrough on a FRESH profile at 390×844 with the service worker live:
//   onboarding → Today → log every type via + and via the cards → live bottle
//   finished from the pill → Timeline (entry sheet, memory → memory sheet) →
//   Report → Stash add / thaw & feed → Memory with a photo → Settings →
//   Customize hide/show (everywhere) → night theme.
// Then a profile seeded with v1 data must migrate and render.
// Asserts zero console errors, zero CSP violations and zero requests to any
// other origin, and saves docs/design/build/app-*.png (light + night).
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/app.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TOP = '.sheet-layer[data-state="open"]:last-of-type';
const mod = (path) => `${BASE_URL}${path}`;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];

async function freshContext({ colorScheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme, locale: 'en-US', timezoneId: 'UTC' });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  context.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== ORIGIN) foreign.push(u);
  });
  return { context, page };
}

// ------------------------------------------------------------- helpers
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const activeView = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll('#viewport > .view')].filter((s) => !s.classList.contains('is-fading-out') && !s.classList.contains('is-leaving-right'));
  return v.length ? v[v.length - 1].getAttribute('data-view') : null;
});
const layerCount = (page) => page.evaluate(() => document.querySelectorAll('.sheet-layer:not([data-state="closing"])').length);
const title = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer:not([data-state="closing"])')].pop(); return l ? l.querySelector('.sheet-title').textContent.trim() : ''; });
async function waitNoLayers(page, timeout = 4000) {
  return page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout }).then(() => true, () => false);
}
async function openTop(page, cls = '') {
  return page.waitForSelector(`.sheet-layer${cls}[data-state="open"]`, { timeout: 4000 }).then(() => true, () => false);
}
async function q(page, query) {
  return page.evaluate(async ([u, qq]) => (await import(u)).events.query(qq), [mod('/js/core/store.js'), query]);
}
async function getSetting(page, key) {
  return page.evaluate(async ([u, k]) => (await import(u)).settings.get(k), [mod('/js/core/settings.js'), key]);
}
async function setSetting(page, key, value) {
  await page.evaluate(async ([u, k, v]) => { await (await import(u)).settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}
async function toastText(page) {
  return page.evaluate(() => { const t = document.querySelector('#toastRoot .toast[data-state="in"] .toast-msg'); return t ? t.textContent : ''; });
}
async function dismissToast(page) {
  await page.evaluate(() => { for (const t of document.querySelectorAll('#toastRoot .toast')) t.remove(); });
}
async function plus(page) {
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer.sheet-quicklog[data-state="open"] .tiles');
  await settle(page, 450); // past the enter-tap guard
}
async function tile(page, key) {
  await plus(page);
  await page.click(`.sheet-quicklog [data-key="${key}"]`);
}
async function card(page, key) {
  await page.click(`[data-view="today"] .ql[data-card="${key}"]`);
}
async function tab(page, t) {
  await page.click(`#tabBar [data-tab="${t}"]`);
  await page.waitForSelector(`[data-view="${t}"]`);
  await settle(page, 500);
}
/** Click inside the topmost (non-leaving) view with this data-view. */
async function clickView(page, view, sel) {
  const ok = await page.evaluate(([v, s]) => {
    const list = [...document.querySelectorAll(`#viewport > [data-view="${v}"]`)].filter((x) => !x.classList.contains('is-leaving-right') && !x.classList.contains('is-fading-out'));
    const el = list.length ? list[list.length - 1].querySelector(s) : null;
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, [view, sel]);
  if (!ok) throw new Error(`no ${sel} in ${view}`);
}
async function shot(page, name) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await settle(page, 350);
  await page.screenshot({ path: `${SHOTS}app-${name}.png` });
}
async function scrollTop(page) {
  await page.evaluate(() => { for (const v of document.querySelectorAll('#viewport > .view')) v.scrollTo(0, 0); });
}
/** Every visible control in the active view + nav is ≥ 44×44 and named. */
async function targets(page) {
  return page.evaluate(() => {
    const bad = [];
    const views = [...document.querySelectorAll('#viewport > .view')].filter((s) => !s.classList.contains('is-fading-out') && !s.classList.contains('is-leaving-right'));
    const scope = [views[views.length - 1], document.getElementById('tabBar'), document.getElementById('livePills')].filter(Boolean);
    for (const root of scope) {
      for (const el of root.querySelectorAll('button, a[href], input:not([type="file"]):not([type="hidden"]), [role="switch"]')) {
        if (el.closest('[hidden]') || el.closest('[inert]') && !document.getElementById('app').inert) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        const box = el.closest('label') ? el.closest('label').getBoundingClientRect() : r;
        const name = (el.getAttribute('aria-label') || el.textContent || el.title || '').trim() || (el.labels && el.labels[0] && el.labels[0].textContent.trim()) || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim());
        if (Math.max(box.width, r.width) < 43.5 || Math.max(box.height, r.height) < 43.5) bad.push(`${el.outerHTML.slice(0, 70)} ${Math.round(r.width)}×${Math.round(r.height)}`);
        if (!name) bad.push(`no name: ${el.outerHTML.slice(0, 70)}`);
      }
    }
    return bad;
  });
}
async function photoPng(page, hue = 20) {
  const b64 = await page.evaluate((h) => {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 600;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${h} 45% 70%)`; g.fillRect(0, 0, 480, 600);
    g.fillStyle = `hsl(${h} 40% 52%)`; g.beginPath(); g.ellipse(240, 420, 150, 130, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `hsl(${h} 60% 90%)`; g.beginPath(); g.arc(240, 170, 80, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, hue);
  return { name: 'clara.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

// =================================================================== A
try {
  const { context, page } = await freshContext();
  const T0 = new Date('2026-10-20T10:30:00Z').getTime();
  await page.clock.install({ time: T0 });
  await page.clock.resume();

  // ------------------------------------------------------- onboarding
  console.log('\nonboarding');
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] .ob-step', { timeout: 15000 });
  const inStep = (sel) => `.ob-step:not(.is-leaving) ${sel}`;
  const waitStep = async (key) => {
    await page.waitForFunction((k) => { const s = document.querySelector('.ob-step:not(.is-leaving)'); return s && s.dataset.step === k; }, key, { timeout: 4000 });
    await page.waitForFunction(() => !document.querySelector('.ob-step.is-leaving'), null, { timeout: 4000 });
  };
  await setSetting(page, 'theme', 'light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await settle(page, 700);
  await shot(page, 'onboarding-light');
  await page.fill('[data-field="name"]', 'Clara');
  await page.fill('[data-field="born"]', '2026-09-02');
  await page.dispatchEvent('[data-field="born"]', 'change');
  await page.click(inStep('[data-action="next"]'));
  await waitStep('feeding');
  await page.click(inStep('[data-action="next"]'));
  await waitStep('goal');
  await page.click(inStep('[data-action="next"]'));
  await waitStep('install');
  await page.click(inStep('[data-action="finish"]'));
  await page.waitForSelector('[data-view="today"]');
  await settle(page, 700);
  check('onboarding → Today', await activeView(page) === 'today');
  const baby = await page.evaluate(async (u) => (await import(u)).settings.activeBaby(), mod('/js/core/settings.js'));
  check('Clara with her birth date was saved', baby && baby.name === 'Clara' && baby.birthDate === '2026-09-02');
  check('Today shows the empty state for a fresh baby', /A fresh page for Clara/.test(await page.textContent('[data-view="today"]')));
  await shot(page, 'today-empty-light');

  // ------------------------------------------------- log via the +
  console.log('\nlog every type via +');
  await tile(page, 'bottle');
  check('+ › Bottle opens the bottle form', await openTop(page, '.sheet-feed') && !!(await page.$(`${TOP} [data-log]`)));
  await settle(page, 400);
  await page.click(`${TOP} [data-log]`);
  check('Log finished bottle closes the sheet', await waitNoLayers(page));
  let feeds = await q(page, { type: 'feed' });
  check('…a finished bottle for Clara is stored', feeds.length === 1 && feeds[0].endTime !== null && feeds[0].babyId === baby.id && feeds[0].data.amount > 0, JSON.stringify(feeds[0] && feeds[0].data));
  await settle(page, 600);
  check('…and its row landed on Today', !!(await page.$(`[data-view="today"] [data-event-id="${feeds[0].id}"]`)));

  await plus(page);
  await page.click('.sheet-quicklog .dbtn[data-diaper="wet"]');
  await waitNoLayers(page);
  await page.waitForSelector('#toastRoot .toast[data-state="in"]');
  check('one-tap Wet: toast offers Undo and Add details', await page.evaluate(() => {
    const b = [...document.querySelectorAll('#toastRoot .toast[data-state="in"] .toast-action')].map((x) => x.textContent.trim());
    return b.join('|') === 'Undo|Add details';
  }));
  const wet = (await q(page, { type: 'diaper' }))[0];
  check('…the diaper is stored for Clara', wet && wet.data.kind === 'wet' && wet.babyId === baby.id);
  await page.screenshot({ path: `${SHOTS}app-toast-diaper-light.png` });
  await settle(page, 200);
  await page.click('#toastRoot .toast-action-2');
  check('Add details opens the diaper details for that entry', await openTop(page, '.sheet-diaper'));
  await settle(page, 500);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await settle(page, 300);

  await tile(page, 'sleep');
  check('+ › Sleep opens the sleep sheet', await openTop(page, '.sheet-sleep'));
  await settle(page, 400);
  await page.click(`${TOP} [data-start]`);
  await settle(page, 700);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await settle(page, 400);
  check('a running nap shows the live pill', await page.isVisible('#livePills .lpill[data-kind="sleep"]'));
  check('…whose Finish says "End nap" for a nap', (await page.textContent('#livePills .lpill[data-kind="sleep"] .lpill-finish')).trim() === 'End nap');
  await page.click('#livePills .lpill[data-kind="sleep"] .lpill-finish');
  await settle(page, 700);
  const sleeps = await q(page, { type: 'sleep' });
  check('pill End nap logs the wake-up', sleeps.length === 1 && sleeps[0].endTime !== null, JSON.stringify(sleeps.map((s) => s.endTime)));
  await dismissToast(page);

  await tile(page, 'pump');
  check('+ › Pump opens the pump sheet', await openTop(page, '.sheet-pump'));
  await settle(page, 400);
  await page.click(`${TOP} [data-start]`);
  await page.waitForSelector(`${TOP} [data-finish]`);
  await page.clock.fastForward(15 * MIN);
  await settle(page, 400);
  await page.click(`${TOP} [data-finish]`);
  await page.waitForSelector(`${TOP} [data-amount]`);
  await settle(page, 500);
  check('Finish asks "How much did you pump?"', (await title(page)) === 'How much did you pump?');
  await page.click(`${TOP} [data-places] [data-value="fridge"]`);
  await page.click(`${TOP} [data-finish]`);
  check('…saved and closed', await waitNoLayers(page, 5000));
  const pumps = await q(page, { type: 'pump' });
  check('a pump with an amount, stored in the fridge', pumps.length === 1 && pumps[0].data.amount > 0 && pumps[0].data.storedTo === 'fridge' && !!pumps[0].data.inventoryId, JSON.stringify(pumps[0] && pumps[0].data));

  await tile(page, 'breast');
  check('+ › Breastfeed opens the side picker', await openTop(page, '.sheet-feed') && !!(await page.$(`${TOP} [data-side="left"]`)));
  await settle(page, 400);
  await page.click(`${TOP} [data-side="left"]`);
  await page.waitForSelector(`${TOP} [data-finish]`);
  await page.clock.fastForward(6 * MIN);
  await settle(page, 400);
  await page.click(`${TOP} [data-finish]`);
  await waitNoLayers(page, 5000);
  await settle(page, 400);
  const breast = (await q(page, { type: 'feed' })).find((e) => e.data.method === 'breast');
  check('a finished breastfeed with left-side time', breast && breast.endTime !== null && breast.data.left > 0, JSON.stringify(breast && breast.data));
  await dismissToast(page);

  await tile(page, 'memory');
  check('+ › Memory opens the memory sheet', await openTop(page, '.sheet-memory'));
  await settle(page, 400);
  await page.fill(`${TOP} [data-title]`, 'First trip to the park');
  await page.setInputFiles(`${TOP} [data-pick]`, await photoPng(page, 28));
  await page.waitForFunction(() => !!document.querySelector('.sheet-memory img[data-photo]'), null, { timeout: 6000 }).catch(() => {});
  await settle(page, 400);
  await page.click(`${TOP} [data-save]`);
  check('…saved and closed', await waitNoLayers(page, 5000));
  const mems = await q(page, { type: 'milestone' });
  check('a memory with one photo for Clara', mems.length === 1 && mems[0].data.photoIds.length === 1 && mems[0].babyId === baby.id, JSON.stringify(mems[0] && mems[0].data));

  await tile(page, 'stash');
  check('+ › Stash milk opens Add pouch', await openTop(page, '.sheet-stash'));
  await settle(page, 400);
  await page.click(`${TOP} [role="radio"][data-value="freezer"]`);
  await page.click(`${TOP} [data-save]`);
  check('…saved and closed', await waitNoLayers(page, 5000));
  const inv = await page.evaluate(async (u) => (await import(u)).stash.list(), mod('/js/core/stash.js'));
  check('two pouches now: the pumped one (fridge) and the frozen one', inv.length === 2 && inv.some((p) => p.location === 'freezer') && inv.some((p) => p.location === 'fridge'), JSON.stringify(inv.map((p) => p.location)));

  // ------------------------------------------------ log via the cards
  console.log('\nlog via the Today cards');
  await scrollTop(page);
  await card(page, 'feed');
  check('Fed card opens the feed sheet from the card', await openTop(page, '.sheet-feed'));
  await settle(page, 400);
  if (!(await page.$(`${TOP} [data-start]`))) {
    // The card opened the breastfeed picker (last feed was a breastfeed): switch to Bottle.
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await tile(page, 'bottle');
    await openTop(page, '.sheet-feed');
    await settle(page, 400);
  }
  await page.click(`${TOP} [data-start]`);
  await page.waitForSelector(`${TOP} [data-finish]`);
  check('Start bottle turns the same sheet into the live bottle', (await layerCount(page)) === 1);
  await settle(page, 600);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await settle(page, 400);
  check('the live bottle keeps running as a pill', await page.isVisible('#livePills .lpill[data-kind="bottle"]'));
  await page.clock.fastForward(9 * MIN);
  await settle(page, 300);
  await page.click('#livePills .lpill[data-kind="bottle"] .lpill-finish');
  check('pill Finish asks how much Clara drank', await openTop(page, '.sheet-feed'));
  await page.waitForSelector(`${TOP} [data-finish]`);
  await settle(page, 600);
  check('…in Clara’s name, never a pronoun', /Clara/.test(await page.textContent(TOP)) && !/\b(she|her|he|his)\b/i.test(await page.textContent(TOP)));
  await page.click(`${TOP} [data-finish]`);
  await waitNoLayers(page, 5000);
  await settle(page, 500);
  const bottles = (await q(page, { type: 'feed' })).filter((e) => e.data.method === 'bottle');
  check('the live bottle finished with an amount', bottles.length === 2 && bottles.every((b) => b.endTime !== null && b.data.amount > 0), JSON.stringify(bottles.map((b) => [b.endTime, b.data.amount])));
  check('no pill left', (await page.$$('#livePills .lpill')).length === 0);
  await dismissToast(page);

  await card(page, 'diaper');
  check('Diaper card opens the diaper sheet', await openTop(page, '.sheet-diaper'));
  await settle(page, 500);
  await page.click(`${TOP} [data-kind="dirty"]`);
  await waitNoLayers(page);
  await settle(page, 400);
  check('one tap on Dirty logs it', (await q(page, { type: 'diaper' })).some((d) => d.data.kind === 'dirty'));
  await dismissToast(page);

  await card(page, 'sleep');
  check('Sleep card opens the sleep sheet', await openTop(page, '.sheet-sleep'));
  await settle(page, 400);
  await page.click(`${TOP} [data-start]`);
  await settle(page, 600);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await settle(page, 600);
  check('the sleep card goes live: "Tap to wake"', /Tap to wake/.test(await page.textContent('[data-view="today"] .ql[data-card="sleep"]')));
  await page.clock.fastForward(40 * MIN);
  await settle(page, 300);
  await card(page, 'sleep');
  await settle(page, 600);
  check('tapping the live card wakes Clara, with Undo', (await q(page, { type: 'sleep', running: true })).length === 0 && /Wake-up logged/.test(await toastText(page)));
  await dismissToast(page);

  await card(page, 'pump');
  check('Pumped card opens the pump sheet', await openTop(page, '.sheet-pump'));
  await settle(page, 400);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);

  await settle(page, 600);
  await scrollTop(page);
  const badToday = await targets(page);
  check('Today: every control ≥ 44 and named', badToday.length === 0, badToday.slice(0, 5).join(' | '));
  await shot(page, 'today-light');
  await plus(page);
  await shot(page, 'quicklog-light');
  await page.keyboard.press('Escape');
  await waitNoLayers(page);

  // ---------------------------------------------------------- timeline
  console.log('\ntimeline + report');
  await tab(page, 'timeline');
  const rows = await page.$$eval('[data-view="timeline"] .row[data-event-id]', (els) => els.map((e) => e.dataset.eventId));
  const all = await q(page, {});
  check('Timeline lists every entry of the day', rows.length === all.length, `${rows.length} rows vs ${all.length} events`);
  await page.click(`[data-view="timeline"] .row[data-event-id="${wet.id}"]`);
  check('a row opens the entry sheet', await openTop(page, '.sheet-event'));
  await settle(page, 500);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await page.click(`[data-view="timeline"] .row[data-event-id="${mems[0].id}"]`);
  check('a memory row opens the memory sheet with its photo', await openTop(page, '.sheet-memory') && await page.waitForSelector('.sheet-memory img[data-photo]', { timeout: 3000 }).then(() => true, () => false));
  await settle(page, 500);
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await settle(page, 400);
  await scrollTop(page);
  const badTl = await targets(page);
  check('Timeline: every control ≥ 44 and named', badTl.length === 0, badTl.slice(0, 5).join(' | '));
  await shot(page, 'timeline-light');

  await clickView(page, 'timeline', '[data-action="report"]');
  await page.waitForSelector('[data-view="report"]');
  await settle(page, 700);
  check('Report for the pediatrician opens', await activeView(page) === 'report');
  await shot(page, 'report-light');
  await clickView(page, 'report', '.navbar [data-action="back"]');
  await settle(page, 700);
  check('Back returns to the Timeline', await activeView(page) === 'timeline');

  // ------------------------------------------------------------- stash
  console.log('\nstash');
  await tab(page, 'stash');
  check('Stash shows both pouches', (await page.$$('[data-view="stash"] [data-pouch]')).length >= 1);
  await clickView(page, 'stash', '[data-action="add"]');
  check('Add pouch opens from the header', await openTop(page, '.sheet-stash'));
  await settle(page, 400);
  await page.click(`${TOP} [role="radio"][data-value="freezer"]`);
  await page.click(`${TOP} [data-save]`);
  await waitNoLayers(page, 5000);
  await settle(page, 1600);
  const heroThaw = await page.$('[data-view="stash"] [data-hero-act="thaw-feed"]');
  const heroFeed = await page.$('[data-view="stash"] [data-hero-act="feed"]');
  check('the Use-next card offers a way to feed', !!(heroThaw || heroFeed));
  const heroId = await page.evaluate(() => { const b = document.querySelector('[data-view="stash"] [data-hero-act]'); return b && b.dataset.id; });
  await (heroThaw || heroFeed).click();
  check('Thaw & feed / Feed opens the feed sheet for that pouch', await openTop(page, '.sheet-feed'));
  await page.waitForFunction(() => { const b = document.querySelector('.sheet-feed [data-log]'); return b && !b.disabled; }, null, { timeout: 3000 }).catch(() => {});
  await settle(page, 500);
  await page.click(`${TOP} [data-log]`);
  await waitNoLayers(page, 5000);
  await settle(page, 600);
  const fromStash = (await q(page, { type: 'feed' })).find((e) => e.data.sourceInventoryId);
  check('the bottle was fed from exactly that pouch', fromStash && fromStash.data.sourceInventoryId === heroId, `${fromStash && fromStash.data.sourceInventoryId} vs ${heroId}`);
  await dismissToast(page);
  await scrollTop(page);
  const badSx = await targets(page);
  check('Stash: every control ≥ 44 and named', badSx.length === 0, badSx.slice(0, 5).join(' | '));
  await shot(page, 'stash-light');

  // ---------------------------------------------------------- memories
  console.log('\nmemories');
  await tab(page, 'memories');
  await page.waitForFunction(() => { const i = document.querySelector('[data-view="memories"] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  check('the book shows the photo on its cover', await page.evaluate(() => { const i = document.querySelector('[data-view="memories"] img'); return !!i && i.naturalWidth > 0; }));
  check('the book is Clara’s', /CLARA’S BOOK|Clara’s book/i.test(await page.textContent('[data-view="memories"]')));
  await shot(page, 'memories-light');

  // ---------------------------------------------------------- settings
  console.log('\nsettings + customize');
  await tab(page, 'today');
  await clickView(page, 'today', '[data-action="settings"]');
  await page.waitForSelector('[data-view="settings"]');
  await settle(page, 700);
  check('the avatar opens Settings', await activeView(page) === 'settings');
  await shot(page, 'settings-light');
  await clickView(page, 'settings', '[data-action="customize"]');
  await settle(page, 700);
  await clickView(page, 'settings', '[data-action="tracker"][data-arg="sleep"]');
  await settle(page, 400);
  check('Customize: Sleep off is saved', (await getSetting(page, 'trackers')).sleep === false);
  await shot(page, 'customize-light');
  await clickView(page, 'settings', '.navbar [data-action="back"]');
  await settle(page, 600);
  await clickView(page, 'settings', '.navbar [data-action="back"]');
  await settle(page, 700);
  check('back to Today', await activeView(page) === 'today');
  check('hidden Sleep: no Today card', !(await page.$('[data-view="today"] .ql[data-card="sleep"]')));
  check('hidden Sleep: no sleep rows on Today', !(await page.evaluate((ids) => ids.some((id) => document.querySelector(`[data-view="today"] [data-event-id="${id}"]`)), (await q(page, { type: 'sleep' })).map((s) => s.id))));
  await plus(page);
  check('hidden Sleep: no quick-log tile', !(await page.$('.sheet-quicklog [data-key="sleep"]')));
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  await tab(page, 'timeline');
  check('hidden Sleep: no sleep rows on the Timeline', !(await page.evaluate((ids) => ids.some((id) => document.querySelector(`[data-view="timeline"] .row[data-event-id="${id}"]`)), (await q(page, { type: 'sleep' })).map((s) => s.id))));
  await setSetting(page, 'trackers', { ...(await getSetting(page, 'trackers')), sleep: true, memories: false, stash: false });
  await settle(page, 600);
  check('hidden Memories + Stash: their tabs leave the nav', !(await page.isVisible('#tabBar [data-tab="memories"]')) && !(await page.isVisible('#tabBar [data-tab="stash"]')));
  await setSetting(page, 'trackers', { ...(await getSetting(page, 'trackers')), memories: true, stash: true });
  await settle(page, 600);
  check('…and come back when shown again', await page.isVisible('#tabBar [data-tab="memories"]') && await page.isVisible('#tabBar [data-tab="stash"]'));
  await tab(page, 'today');
  check('shown again: the Sleep card is back', !!(await page.$('[data-view="today"] .ql[data-card="sleep"]')));

  // ------------------------------------------------------------- night
  console.log('\nnight');
  await setSetting(page, 'theme', 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await settle(page, 900);
  check('night theme applies', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
  await scrollTop(page);
  await shot(page, 'today-night');
  await plus(page);
  await shot(page, 'quicklog-night');
  await page.keyboard.press('Escape');
  await waitNoLayers(page);
  for (const t of ['timeline', 'stash', 'memories']) {
    await tab(page, t);
    await scrollTop(page);
    await shot(page, `${t}-night`);
  }
  await tab(page, 'today');
  await clickView(page, 'today', '[data-action="settings"]');
  await page.waitForSelector('[data-view="settings"]');
  await settle(page, 700);
  await shot(page, 'settings-night');

  // ---------------------------------------------------- service worker
  const sw = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    if (!reg) return { ok: false };
    const keys = await caches.keys();
    const cache = keys.length ? await caches.open(keys[0]) : null;
    const n = cache ? (await cache.keys()).length : 0;
    return { ok: true, keys, n };
  });
  check('the service worker installed and precached the app (nurture-v2.0.0)', sw.ok && sw.keys.includes('nurture-v2.0.0') && sw.n > 60, JSON.stringify(sw));

  check('fresh profile: zero CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(', '));
  await context.close();
} catch (err) {
  check(`walkthrough ran to the end (${err.message.split('\n')[0]})`, false);
  console.error(err);
}

// =================================================================== B
console.log('\nv1 data migrates and renders');
try {
  const { context, page } = await freshContext({ colorScheme: 'dark' });
  // Any same-origin page that doesn't open the database will do.
  await page.goto(`${BASE_URL}/manifest.json`);
  await page.evaluate(async ({ MIN, HOUR, DAY }) => {
    const NOW = Date.now();
    const open = (v, up) => new Promise((res, rej) => { const r = indexedDB.open('NurtureDB', v); if (up) r.onupgradeneeded = () => up(r.result); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await open(1, (d) => {
      const s = d.createObjectStore('sessions', { keyPath: 'id' });
      s.createIndex('type', 'type'); s.createIndex('startTime', 'startTime'); s.createIndex('createdAt', 'createdAt');
      const i = d.createObjectStore('inventory', { keyPath: 'id' });
      i.createIndex('status', 'status'); i.createIndex('expiresAt', 'expiresAt'); i.createIndex('pumpedAt', 'pumpedAt'); i.createIndex('location', 'location');
      const b = d.createObjectStore('bottles', { keyPath: 'id' });
      b.createIndex('status', 'status'); b.createIndex('expiresAt', 'expiresAt');
      d.createObjectStore('settings', { keyPath: 'key' });
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['sessions', 'inventory', 'settings'], 'readwrite');
      const T = NOW - 3 * HOUR;
      tx.objectStore('sessions').put({ id: 'pump_a', type: 'pump', startTime: T, endTime: T + 20 * MIN, durationSec: 1200, outputQty: 4.5, unit: 'oz', notes: 'morning', createdAt: T });
      tx.objectStore('sessions').put({ id: 'pump_nan', type: 'pump', startTime: T - DAY, endTime: T - DAY + 15 * MIN, durationSec: 900, outputQty: NaN, unit: 'mL', notes: '', createdAt: T - DAY });
      tx.objectStore('sessions').put({ id: 'sess_b', type: 'feed', feedType: 'breastmilk', startTime: T + HOUR, endTime: T + HOUR, durationSec: 900, outputQty: 120, unit: 'mL', notes: 'Bottle feed (120 mL prepared)', createdAt: T + HOUR });
      tx.objectStore('sessions').put({ id: 'sess_c', type: 'feed', feedType: 'formula', startTime: T + 2 * HOUR, endTime: T + 2 * HOUR, durationSec: 0, outputQty: 4, unit: 'oz', notes: '<img src=x onerror=alert(1)>', createdAt: T + 2 * HOUR });
      tx.objectStore('inventory').put({ id: 'inv_f', pumpedAt: NOW - 30 * DAY, quantity: 5, unit: 'oz', location: 'freezer', expiresAt: NOW + 150 * DAY, status: 'active', notes: '', createdAt: NOW - 30 * DAY });
      tx.objectStore('inventory').put({ id: 'inv_t', pumpedAt: NOW - 40 * DAY, quantity: 4, unit: 'oz', location: 'thawed', thawedAt: NOW - 2 * HOUR, expiresAt: NOW + 22 * HOUR, status: 'active', notes: '', createdAt: NOW - 40 * DAY });
      for (const [key, value] of [['dailyGoalOz', 26], ['units', 'mL'], ['themeMode', 'dark'], ['babyName', 'Clara'], ['parentName', 'Nick'], ['onboarding_completed', true]]) {
        tx.objectStore('settings').put({ key, value, updatedAt: NOW - DAY });
      }
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
    localStorage.setItem('nurture_active_pump_timer', JSON.stringify({ active: true, type: 'pump', startedAt: NOW - 10 * MIN }));
  }, { MIN, HOUR, DAY });
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="today"]', { timeout: 15000 });
  await settle(page, 1200);
  check('v1: an onboarded v1 user lands straight on Today', await activeView(page) === 'today');
  check('v1: Clara is the baby, units mL, theme dark', /Clara/.test(await page.textContent('[data-view="today"]')) && await getSetting(page, 'units') === 'mL' && await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
  const evs = await q(page, {});
  check('v1: every session became an event (+ the running pump timer)', evs.length === 5, `${evs.length}`);
  check('v1: the NaN pump reads as no amount, not NaN', evs.some((e) => e.migratedFrom === 'pump_nan' && e.data.amount === null));
  check('v1: the running pump timer is a live pill', await page.isVisible('#livePills .lpill[data-kind="pump"]'));
  check('v1: hostile v1 notes render as text, never markup', !(await page.$('img[src="x"]')));
  check('v1: no "NaN" anywhere on Today', !/NaN/.test(await page.textContent('#app')));
  await shot(page, 'v1-today-night');
  await tab(page, 'timeline');
  check('v1: Timeline renders migrated rows', (await page.$$('[data-view="timeline"] .row[data-event-id]')).length >= 1 && !/NaN/.test(await page.textContent('[data-view="timeline"]')));
  await tab(page, 'stash');
  check('v1: Stash shows the migrated pouches', (await page.$$('[data-view="stash"] [data-pouch]')).length >= 1 || /Use next/i.test(await page.textContent('[data-view="stash"]')));
  check('v1: stash amounts in mL', /mL/.test(await page.textContent('[data-view="stash"]')));
  await shot(page, 'v1-stash-night');
  check('v1 profile: zero CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(', '));
  await context.close();
} catch (err) {
  check(`v1 migration walkthrough ran to the end (${err.message.split('\n')[0]})`, false);
  console.error(err);
}

check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
check('zero requests to other origins', foreign.length === 0, foreign.slice(0, 5).join(' | '));

await browser.close();
console.log(`\napp: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
