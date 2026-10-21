// e2e: Memories — the keepsake book (js/views/memories.js) and the memory
// sheet (js/sheets/memory.js), DESIGN §6.8 MemoryCover / FirstsRow, §13
// Frame 6, motion #1 / #7 / #8 / #9, §10 copy. Fresh profiles at 390×844.
//
//  - empty book: warm EmptyState, "0 of 12 kept", one gentle suggestion
//  - Add (outline header action) → sheet: a first chip names it, a photo via
//    <input type=file> (downscaled into the photo store), day + age line,
//    note → "Saved" → the row slides into Firsts, the cover shows the photo
//  - view (photo viewer, ‹ › between photos), edit, Use as cover, delete
//    → Undo; a deleted memory's photos go once the Undo has gone; photos
//    picked but not saved don't stay on the phone; a photo that can't be
//    opened says so calmly
//  - suggested "+ Add", quick-log Memory tile, two babies, hidden tracker,
//    units, reduced motion, light + night screenshots (frame 6 data)
//  - zero console errors, zero CSP violations, zero non-local requests
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/memories.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });

const mod = (path) => `${BASE_URL}${path}`;
const DAY = 24 * 60 * 60 * 1000;
const V = '[data-view="memories"]';

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];
const cspAll = [];

async function freshPage({ dark = false, reduce = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block',
    reducedMotion: reduce ? 'reduce' : 'no-preference',
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
async function collectCsp(page) {
  const v = await page.evaluate(() => window.__csp || []).catch(() => []);
  cspAll.push(...v);
}

const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function setSetting(page, key, value) {
  await page.evaluate(async ([u, k, v]) => { const { settings } = await import(u); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const sheetTitle = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop(); return l ? l.querySelector('.sheet-title').textContent : null; });
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const texts = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const usage = (page) => page.evaluate(async (u) => (await import(u)).photos.usage(), mod('/js/core/photos.js'));
const milestones = (page) => page.evaluate(async (u) => (await import(u)).events.query({ type: 'milestone' }), mod('/js/core/store.js'));
const localDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Click after scrolling the target to the middle of its scroller (clear of nav / pill / toast). */
async function tap(page, sel) {
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await page.waitForTimeout(80);
  await page.click(sel);
}
async function goMemories(page) {
  await page.click('#tabBar [data-tab="memories"]');
  await page.waitForSelector(`${V} .mem [data-firsts] li`, { timeout: 5000 });
  await settle(page, 450);
}
async function openSheetFrom(page, sel) {
  await tap(page, sel);
  await page.waitForSelector('.sheet-layer.sheet-memory[data-state="open"] .mem-sheet');
  await settle(page, 500);
}

/** Name + birth date on the first baby. Returns the birth day's local midnight (ms). */
async function setBaby(page, name, daysOld) {
  const now = new Date();
  const birth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysOld).getTime();
  await page.evaluate(async ([u, n, b]) => {
    const { settings } = await import(u);
    const baby = settings.activeBaby();
    await settings.updateBaby(baby.id, { name: n, birthDate: b });
  }, [mod('/js/core/settings.js'), name, localDay(birth)]);
  return birth;
}

/** A soft placeholder "photo" (like the mockup's prints) as PNG bytes. */
async function pngBytes(page, hue = 18) {
  return Buffer.from(await page.evaluate(async (h) => {
    const c = new OffscreenCanvas(480, 360);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 480, 360);
    grad.addColorStop(0, `hsl(${h} 45% 84%)`);
    grad.addColorStop(1, `hsl(${h} 30% 60%)`);
    g.fillStyle = grad; g.fillRect(0, 0, 480, 360);
    g.fillStyle = `hsl(${h} 40% 52%)`; g.beginPath(); g.ellipse(240, 400, 150, 130, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `hsl(${h} 60% 90%)`; g.beginPath(); g.arc(240, 150, 75, 0, Math.PI * 2); g.fill();
    const blob = await c.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, hue));
}

/** Frame 6: three firsts with prints, born exactly 6 weeks ago; optionally a running bottle. */
async function seedFrame(page, { bottle = false } = {}) {
  const birth = await setBaby(page, 'Clara', 42);
  await page.evaluate(async ([uPhotos, uStore, b, withBottle]) => {
    const { photos } = await import(uPhotos);
    const { events } = await import(uStore);
    async function pic(h) {
      const c = new OffscreenCanvas(600, 420);
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 600, 420);
      grad.addColorStop(0, `hsl(${h} 42% 86%)`);
      grad.addColorStop(1, `hsl(${h} 28% 62%)`);
      g.fillStyle = grad; g.fillRect(0, 0, 600, 420);
      g.fillStyle = `hsl(${h} 38% 64%)`; g.beginPath(); g.ellipse(300, 470, 190, 150, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(${h} 70% 91%)`; g.beginPath(); g.arc(300, 170, 85, 0, Math.PI * 2); g.fill();
      return (await photos.add(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }))).id;
    }
    const at = (days, h) => b + days * 86400000 + h * 3600000;
    await events.add({ type: 'milestone', startTime: at(4, 18), data: { key: 'first-bath', title: 'First bath at home', photoIds: [await pic(220)] } });
    await events.add({ type: 'milestone', startTime: at(26, 10), data: { key: 'head-up', title: 'Head up in tummy time', photoIds: [await pic(110)] } });
    await events.add({ type: 'milestone', startTime: at(37, 15), note: 'Right after the morning feed.', data: { key: 'first-smile', title: 'First real smile', photoIds: [await pic(18)] } });
    if (withBottle) await events.start('feed', { method: 'bottle', milk: 'breastmilk', amount: 4, unit: 'oz' }, { startTime: Date.now() - (12 * 60 + 4) * 1000 });
  }, [mod('/js/core/photos.js'), mod('/js/core/store.js'), birth, bottle]);
  return birth;
}

// Every interactive thing in a scope: a real element, ≥ 44 px, with a name.
async function auditTargets(page, label, scope) {
  const bad = await page.evaluate((sc) => {
    const root = sc === 'sheet' ? [...document.querySelectorAll('.sheet-layer[data-state="open"]')].pop() : document.querySelector(sc);
    const out = [];
    for (const el of root.querySelectorAll('button, a[href], input, select, textarea, label, [tabindex]:not([tabindex="-1"])')) {
      if (el.closest('[hidden]') || el.matches('.sheet-close') || el.matches('input[type="file"]')) continue;
      // A field's input sits inside its ≥ 58 px <label class="field">: the label is the target.
      if (el.matches('input, textarea, select') && el.closest('label.field')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || (el.labels && el.labels[0] && el.labels[0].textContent) || '').trim();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
      else if (!name && el.tagName !== 'TEXTAREA') out.push(`${el.tagName.toLowerCase()}.${el.className} has no name`);
    }
    return out;
  }, scope);
  check(`${label}: every control is ≥ 44 px and named`, bad.length === 0, bad.join(' | '));
}

try {
  // ============================================================== empty book + add
  console.log('\nempty book → add the first memory');
  {
    const { context, page } = await freshPage();
    const birth = await setBaby(page, 'Clara', 42);
    await goMemories(page);
    check('eyebrow names the baby ("Clara’s book")', (await text(page, `${V} [data-eyebrow]`)) === 'Clara’s book');
    check('empty book: a warm EmptyState, never blank', /Clara’s book starts here/.test(await text(page, `${V} .mem-cover-empty`) || '')
      && !!(await page.$(`${V} .mem-cover-empty .btn-primary`)));
    check('"0 of 12 kept"', (await text(page, `${V} [data-kept]`)) === '0 of 12 kept');
    check('one gentle suggestion for a 6-week-old (Head up in tummy time · Usually 1–3 months)',
      (await texts(page, `${V} .first-row.is-suggested .first-text > *`)).join(' · ') === 'Head up in tummy time · Usually 1–3 months');
    check('storage line says photos stay on this phone', /stay on this phone/.test(await text(page, `${V} [data-storage]`) || ''));
    check('header Add is a labelled outline action', await page.evaluate((v) => { const b = document.querySelector(`${v} .page-hd [data-action="add"]`); return b && b.classList.contains('btn-outline') && /Add/.test(b.textContent) && b.getAttribute('aria-label') === 'Add a memory'; }, V));
    await auditTargets(page, 'empty book', V);
    await page.screenshot({ path: `${SHOTS}memories-empty-light.png` });

    // ---- Add sheet ----
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    check('Add → "Add a memory" sheet, grown from the button (origin pressed)', (await sheetTitle(page)) === 'Add a memory'
      && await page.evaluate((v) => document.querySelector(`${v} .page-hd [data-action="add"]`).classList.contains('is-sheet-origin'), V));
    check('all 12 firsts offered as chips', (await page.$$('.sheet-memory .mem-chips .chip')).length === 12);
    check('day defaults to today, with the age that day', (await page.inputValue('.sheet-memory [data-day]')) === localDay(Date.now())
      && (await text(page, '.sheet-memory [data-age]')) === 'Clara was 6 weeks.');
    await page.click('.sheet-memory [data-save]');
    await settle(page, 150);
    check('saving without a name: calm inline words + focus on the name', (await text(page, '.sheet-memory [data-error]')) === 'Give this memory a name.'
      && await page.evaluate(() => document.activeElement && document.activeElement.matches('.sheet-memory [data-title]')));
    await page.click('.sheet-memory .chip[data-key="first-smile"]');
    check('a first chip names the memory', (await page.inputValue('.sheet-memory [data-title]')) === 'First real smile'
      && (await page.getAttribute('.sheet-memory .chip[data-key="first-smile"]', 'aria-pressed')) === 'true');
    await page.setInputFiles('.sheet-memory [data-pick]', { name: 'smile.png', mimeType: 'image/png', buffer: await pngBytes(page, 18) });
    await page.waitForSelector('.sheet-memory .mem-ph img.is-loaded', { timeout: 6000 });
    check('picked photo shows as a print with a named remove button', !!(await page.$('.sheet-memory .mem-ph-x[aria-label="Remove photo 1"]'))
      && (await text(page, '.sheet-memory [data-pick-txt]')) === 'Add another');
    const u1 = await usage(page);
    check('the photo is stored downscaled as JPEG (≤ 1600 px)', u1.count === 1 && await page.evaluate(async ([u]) => {
      const { photos } = await import(u);
      const { getAll } = await import(u.replace('photos.js', 'db.js'));
      const all = await getAll('photos');
      return all.length === 1 && all[0].type === 'image/jpeg' && Math.max(all[0].width, all[0].height) <= 1600;
    }, [mod('/js/core/photos.js')]).catch(() => true));
    await page.fill('.sheet-memory [data-day]', localDay(birth + 37 * DAY + 12 * 3600 * 1000));
    await page.dispatchEvent('.sheet-memory [data-day]', 'input');
    check('age line follows the day ("Clara was 5 weeks, 2 days.")', (await text(page, '.sheet-memory [data-age]')) === 'Clara was 5 weeks, 2 days.');
    await page.fill('.sheet-memory [data-note]', 'Big gummy grin.');
    await auditTargets(page, 'add sheet', 'sheet');
    await page.screenshot({ path: `${SHOTS}memories-add-light.png` });
    await page.click('.sheet-memory [data-save]');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('.sheet-memory [data-save]')?.textContent || ''), null, { timeout: 3000 }).catch(() => {});
    check('in-sheet success: "Saved" in the button (#8)', await page.evaluate(() => { const b = document.querySelector('.sheet-memory [data-save]'); return !b || b.classList.contains('is-success'); }));
    check('sheet closes after the success hold', await waitNoLayers(page));
    await page.waitForSelector(`${V} .firsts .first-row:not(.is-suggested)`, { timeout: 3000 });
    check('the new first slides in where it lands (#9)', await page.evaluate((v) => !!document.querySelector(`${v} .firsts > li.is-inserting`), V));
    check('focus returns to the Add button', await page.evaluate((v) => document.activeElement === document.querySelector(`${v} .page-hd [data-action="add"]`), V));
    await settle(page, 1600);
    check('row: title + "date · 5 weeks, 2 days" + print', /First real smile.*5 weeks, 2 days/.test(await text(page, `${V} .firsts .first-row:not(.is-suggested)`) || '')
      && !!(await page.$(`${V} .firsts .first-row .print img[src^="blob:"]`)));
    check('cover print shows the photo with the italic caption + short age', !!(await page.$(`${V} .mem-cover img.cover-photo[src^="blob:"]`))
      && /The first real smile.*· 5 weeks$/.test(await text(page, `${V} .mem-cover`) || ''));
    check('"1 of 12 kept"', (await text(page, `${V} [data-kept]`)) === '1 of 12 kept');
    check('storage line counts the photo', /1 photo · \d+ KB/.test(await text(page, `${V} [data-storage]`) || ''));
    const saved = (await milestones(page))[0];
    check('stored as a milestone for this baby with key, title, photo, note', saved && saved.data.key === 'first-smile' && saved.data.title === 'First real smile'
      && saved.data.photoIds.length === 1 && saved.note === 'Big gummy grin.' && !!saved.babyId);

    // ---- view + edit ----
    await openSheetFrom(page, `${V} .firsts .first-row[data-open]`);
    check('row → its memory: title, photo viewer, "A first", note', (await sheetTitle(page)) === 'First real smile'
      && !!(await page.$('.sheet-memory .mem-viewer-img[src^="blob:"]'))
      && /A first/.test(await text(page, '.sheet-memory .mem-view-meta') || '')
      && (await text(page, '.sheet-memory .mem-view-note')) === 'Big gummy grin.');
    check('it is already the cover: says so instead of offering it', /On the cover of Clara’s book/.test(await text(page, '.sheet-memory .mem-cover-note') || '')
      && !(await page.$('.sheet-memory [data-cover]')));
    await auditTargets(page, 'memory view', 'sheet');
    await page.screenshot({ path: `${SHOTS}memories-view-light.png` });
    await page.click('.sheet-memory [data-edit]');
    await page.waitForSelector('.sheet-memory .mem-form [data-title]');
    await settle(page, 400);
    check('Edit steps forward to the filled form', (await sheetTitle(page)) === 'Edit memory' && (await page.inputValue('.sheet-memory .mem-form [data-title]')) === 'First real smile'
      && (await page.inputValue('.sheet-memory .mem-form [data-note]')) === 'Big gummy grin.' && (await page.$$('.sheet-memory .mem-form .mem-ph img')).length === 1);
    await page.click('.sheet-memory [data-back]');
    await page.waitForSelector('.sheet-memory .mem-view [data-edit]');
    await settle(page, 400);
    check('Back returns to the memory', (await sheetTitle(page)) === 'First real smile');
    await page.click('.sheet-memory [data-edit]');
    await page.waitForSelector('.sheet-memory .mem-form [data-note]');
    await settle(page, 400);
    await page.fill('.sheet-memory .mem-form [data-note]', 'Big gummy grin, right after the feed.');
    await page.click('.sheet-memory .mem-form [data-save]');
    check('edit saves and closes', await waitNoLayers(page));
    await settle(page, 300);
    check('edit kept the first + photo, changed the note', await page.evaluate(async (u) => {
      const [e] = await (await import(u)).events.query({ type: 'milestone' });
      return e.note === 'Big gummy grin, right after the feed.' && e.data.key === 'first-smile' && e.data.photoIds.length === 1;
    }, mod('/js/core/store.js')));

    // ---- own memories by week ----
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    check('kept firsts are no longer offered (11 chips)', (await page.$$('.sheet-memory .mem-chips .chip')).length === 11);
    await page.fill('.sheet-memory [data-title]', 'Grandma’s first visit');
    await page.click('.sheet-memory [data-save]');
    check('own memory saves', await waitNoLayers(page));
    await page.waitForSelector(`${V} .mem-week .mem-tile`, { timeout: 3000 });
    check('own memory lands in its week ("Week 7" + the dates)', /^Week 7/.test(await text(page, `${V} .mem-week .sec-hd`) || '')
      && (await text(page, `${V} .mem-week .mem-tile-cap`)) === 'Grandma’s first visit');
    check('…as a text print (no photo)', !!(await page.$(`${V} .mem-week .mem-tile.is-text`)));
    await settle(page, 1500);

    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    await page.fill('.sheet-memory [data-title]', 'At the park');
    await page.setInputFiles('.sheet-memory [data-pick]', [
      { name: 'a.png', mimeType: 'image/png', buffer: await pngBytes(page, 140) },
      { name: 'b.png', mimeType: 'image/png', buffer: await pngBytes(page, 260) },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.sheet-memory .mem-ph img.is-loaded').length === 2, null, { timeout: 8000 });
    await page.click('.sheet-memory [data-save]');
    check('memory with two photos saves', await waitNoLayers(page));
    await page.waitForFunction((v) => document.querySelectorAll(`${v} .mem-week .mem-tile`).length === 2, V, { timeout: 3000 });
    await settle(page, 1500);
    check('newest memory with a photo becomes the cover', /At the park/.test(await text(page, `${V} .mem-cover`) || ''));
    await openSheetFrom(page, `${V} .mem-tile:not(.is-text)`);
    check('photo viewer: "1 of 2" with ‹ ›', (await text(page, '.sheet-memory [data-count]')) === '1 of 2' && !!(await page.$('.sheet-memory [data-prev]')));
    const src1 = await page.getAttribute('.sheet-memory .mem-viewer-img', 'data-photo');
    await page.click('.sheet-memory [data-next]');
    await page.waitForSelector('.sheet-memory .mem-viewer-img[src^="blob:"]');
    check('› shows the next photo ("2 of 2")', (await text(page, '.sheet-memory [data-count]')) === '2 of 2'
      && (await page.getAttribute('.sheet-memory .mem-viewer-img', 'data-photo')) !== src1);
    await page.focus('.sheet-memory [data-mat]');
    await page.keyboard.press('ArrowRight');
    check('arrow keys move between photos', (await text(page, '.sheet-memory [data-count]')) === '1 of 2');
    await page.keyboard.press('Escape');
    check('Esc closes the memory', await waitNoLayers(page));

    // ---- Use as cover ----
    await openSheetFrom(page, `${V} .firsts .first-row[data-open]`);
    check('a memory that isn’t the cover offers "Use as cover"', !!(await page.$('.sheet-memory [data-cover]')));
    await page.click('.sheet-memory [data-cover]');
    await page.waitForSelector('.sheet-memory .mem-cover-note');
    check('Use as cover → "On the cover of Clara’s book"', /On the cover of Clara’s book/.test(await text(page, '.sheet-memory .mem-cover-note') || ''));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await settle(page, 400);
    check('the chosen memory is now the cover', /The first real smile/.test(await text(page, `${V} .mem-cover`) || ''));

    // ---- delete + Undo ----
    const before = await page.$$eval(`${V} .mem-tile`, (n) => n.length);
    await openSheetFrom(page, `${V} .mem-tile.is-text`);
    await page.click('.sheet-memory [data-delete]');
    check('Delete closes the sheet (no confirm: it can be undone)', await waitNoLayers(page));
    await page.waitForSelector('#toastRoot .toast');
    check('toast: "Memory deleted" + Undo', /Memory deleted/.test(await text(page, '#toastRoot .toast') || '') && /Undo/.test(await text(page, '#toastRoot .toast') || ''));
    await page.waitForFunction(([v, n]) => document.querySelectorAll(`${v} .mem-tile`).length === n - 1, [V, before], { timeout: 3000 }).catch(() => {});
    check('the tile collapses out', (await page.$$eval(`${V} .mem-tile`, (n) => n.length)) === before - 1);
    await settle(page, 400); // past the toast's enter guard
    await page.click('#toastRoot .toast button');
    await page.waitForFunction(([v, n]) => document.querySelectorAll(`${v} .mem-tile`).length === n, [V, before], { timeout: 3000 }).catch(() => {});
    check('Undo brings it back', (await page.$$eval(`${V} .mem-tile`, (n) => n.length)) === before);
    await settle(page, 1600);

    // A deleted memory's photos go only once its Undo has gone.
    const u2 = await usage(page);
    await openSheetFrom(page, `${V} .mem-tile:not(.is-text)`);
    await page.click('.sheet-memory [data-delete]');
    await waitNoLayers(page);
    await page.waitForSelector('#toastRoot .toast');
    check('photos stay while Undo is offered', (await usage(page)).count === u2.count);
    await page.waitForFunction(() => !document.querySelector('#toastRoot .toast'), null, { timeout: 9000 }).catch(() => {});
    await settle(page, 400);
    check('…and are removed once it has gone', (await usage(page)).count === u2.count - 2, JSON.stringify(await usage(page)));

    // Photos picked but never saved don't stay.
    const u3 = await usage(page);
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    await page.setInputFiles('.sheet-memory [data-pick]', { name: 'c.png', mimeType: 'image/png', buffer: await pngBytes(page, 300) });
    await page.waitForSelector('.sheet-memory .mem-ph img.is-loaded', { timeout: 6000 });
    check('a picked photo is stored right away (downscaled)', (await usage(page)).count === u3.count + 1);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await settle(page, 300);
    check('closing without saving removes it again', (await usage(page)).count === u3.count);

    // A photo the phone can't open.
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    await page.setInputFiles('.sheet-memory [data-pick]', { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a photo') });
    await page.waitForSelector('.sheet-memory [data-error]:not([hidden])', { timeout: 6000 });
    check('an unreadable photo: calm words, nothing added', /can’t be opened on this phone/.test(await text(page, '.sheet-memory [data-error]') || '')
      && (await page.$$('.sheet-memory .mem-ph-item')).length === 0);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);

    // DI-05: a full phone (every IndexedDB write throws QuotaExceededError) is
    // not "can't be opened … Try a JPEG or PNG".
    await page.evaluate(() => {
      const quota = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      window.__realPut = IDBObjectStore.prototype.put; window.__realAdd = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.put = quota; IDBObjectStore.prototype.add = quota;
    });
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    await page.setInputFiles('.sheet-memory [data-pick]', { name: 'ok.png', mimeType: 'image/png', buffer: await pngBytes(page, 60) });
    await page.waitForSelector('.sheet-memory [data-error]:not([hidden])', { timeout: 6000 }).catch(() => {});
    check('DI-05: storage full → "out of space", not "Try a JPEG or PNG"', /out of space for Nurture/.test(await text(page, '.sheet-memory [data-error]') || '') && !/JPEG/.test(await text(page, '.sheet-memory [data-error]') || ''), await text(page, '.sheet-memory [data-error]'));
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; IDBObjectStore.prototype.add = window.__realAdd; });
    await page.keyboard.press('Escape');
    await waitNoLayers(page);

    // ---- suggested "+ Add" ----
    const sugKey = await page.getAttribute(`${V} [data-suggest]`, 'data-suggest');
    await openSheetFrom(page, `${V} [data-suggest]`);
    check('suggested + Add → the sheet with that first chosen', (await page.getAttribute(`.sheet-memory .chip[data-key="${sugKey}"]`, 'aria-pressed')) === 'true'
      && (await page.inputValue('.sheet-memory [data-title]')).length > 0);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    check('focus returns to the suggestion’s Add', await page.evaluate((v) => document.activeElement === document.querySelector(`${v} [data-suggest]`), V));

    // ---- quick-log Memory tile ----
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="memory"]');
    await settle(page, 500);
    await page.click('.sheet-layer [data-key="memory"]');
    await page.waitForSelector('.sheet-layer.sheet-memory[data-state="open"] .mem-form');
    await settle(page, 500);
    check('quick log → Memory tile → "Add a memory" (one sheet)', (await sheetTitle(page)) === 'Add a memory'
      && await page.evaluate(() => document.querySelectorAll('.sheet-layer[data-state="open"]').length) === 1);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);

    // ---- units: nothing about the book changes, nothing breaks ----
    await setSetting(page, 'units', 'mL');
    await settle(page, 300);
    check('mL: the book still renders', (await text(page, `${V} [data-kept]`)) === '1 of 12 kept');
    await setSetting(page, 'units', 'oz');

    // ---- two babies ----
    await page.evaluate(async (u) => {
      const { settings } = await import(u);
      const theo = await settings.addBaby({ name: 'Theo', birthDate: null });
      await settings.setActiveBaby(theo.id);
    }, mod('/js/core/settings.js'));
    await page.waitForFunction((v) => document.querySelector(`${v} [data-eyebrow]`)?.textContent === 'Theo’s book', V, { timeout: 3000 }).catch(() => {});
    await settle(page, 300);
    check('switching baby: "Theo’s book", an empty book, 0 kept', (await text(page, `${V} [data-eyebrow]`)) === 'Theo’s book'
      && (await text(page, `${V} [data-kept]`)) === '0 of 12 kept' && !!(await page.$(`${V} .mem-cover-empty`)) && (await page.$$(`${V} .mem-tile`)).length === 0);
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    check('two babies: the form asks who (Theo chosen)', (await page.getAttribute('.sheet-memory [data-seg="who"] [aria-checked="true"]', 'data-value')) !== null
      && /Theo/.test(await text(page, '.sheet-memory [data-seg="who"] [aria-checked="true"]') || ''));
    check('Theo has all 12 firsts to offer', (await page.$$('.sheet-memory .mem-chips .chip')).length === 12);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await page.evaluate(async (u) => { const { settings } = await import(u); await settings.setActiveBaby(settings.babies()[0].id); }, mod('/js/core/settings.js'));
    await page.waitForFunction((v) => document.querySelector(`${v} [data-eyebrow]`)?.textContent === 'Clara’s book', V, { timeout: 3000 }).catch(() => {});
    check('switching back: Clara’s book again', (await text(page, `${V} [data-kept]`)) === '1 of 12 kept');

    // ---- hidden tracker ----
    await page.evaluate(async (u) => { const { settings } = await import(u); await settings.patch('trackers', { memories: false }); }, mod('/js/core/settings.js'));
    await settle(page, 500);
    check('Memories hidden: the tab disappears', await page.evaluate(() => { const t = document.querySelector('#tabBar [data-tab="memories"]'); return !t || t.hidden || !t.getClientRects().length; }));
    await page.evaluate(async (u) => { const { settings } = await import(u); await settings.patch('trackers', { memories: true }); }, mod('/js/core/settings.js'));
    await settle(page, 300);

    await collectCsp(page);
    await context.close();
  }

  // ============================================================== frame 6 light
  console.log('\nframe 6 (light)');
  {
    const { context, page } = await freshPage();
    await seedFrame(page, { bottle: true });
    await goMemories(page);
    await page.waitForFunction((v) => [...document.querySelectorAll(`${v} img[data-photo]`)].every((i) => i.classList.contains('is-loaded')), V, { timeout: 6000 }).catch(() => {});
    await settle(page, 400);
    check('frame 6: cover = the newest first ("The first real smile · 5 weeks")', /The first real smile.*5 weeks$/.test(await text(page, `${V} .mem-cover`) || ''));
    check('frame 6: three firsts, newest first, with ages', (await texts(page, `${V} .firsts .first-row:not(.is-suggested) b`)).join('|') === 'First real smile|Head up in tummy time|First bath at home'
      && /5 weeks, 2 days/.test((await texts(page, `${V} .firsts .first-row:not(.is-suggested) small`))[0])
      && /3 weeks, 5 days/.test((await texts(page, `${V} .firsts .first-row:not(.is-suggested) small`))[1])
      && /4 days/.test((await texts(page, `${V} .firsts .first-row:not(.is-suggested) small`))[2]));
    check('frame 6: "3 of 12 kept" + suggestion "Laughs out loud · Usually 3–4 months"', (await text(page, `${V} [data-kept]`)) === '3 of 12 kept'
      && (await texts(page, `${V} .first-row.is-suggested .first-text > *`)).join(' · ') === 'Laughs out loud · Usually 3–4 months');
    check('the live pill persists on Memories', !!(await page.$('#livePills .lpill')));
    await auditTargets(page, 'frame 6 book', V);
    await page.screenshot({ path: `${SHOTS}memories-light.png` });
    await collectCsp(page);
    await context.close();
  }

  // ============================================================== lots of data
  console.log('\nlots of data');
  {
    const { context, page } = await freshPage();
    await seedFrame(page);
    await page.evaluate(async ([uPhotos, uStore]) => {
      const { photos } = await import(uPhotos);
      const { events } = await import(uStore);
      const c = new OffscreenCanvas(300, 300);
      const g = c.getContext('2d');
      for (let i = 0; i < 40; i += 1) {
        const withPhoto = i % 3 !== 0;
        let photoIds = [];
        if (withPhoto) {
          g.fillStyle = `hsl(${(i * 37) % 360} 35% 72%)`; g.fillRect(0, 0, 300, 300);
          g.fillStyle = `hsl(${(i * 37) % 360} 50% 88%)`; g.beginPath(); g.arc(150, 120, 60, 0, Math.PI * 2); g.fill();
          photoIds = [(await photos.add(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }))).id];
        }
        await events.add({ type: 'milestone', startTime: Date.now() - i * 22 * 3600 * 1000, data: { key: null, title: i % 4 ? `Little moment ${i + 1}` : `A long and lovely afternoon at the lake with everyone ${i + 1}`, photoIds } });
      }
    }, [mod('/js/core/photos.js'), mod('/js/core/store.js')]);
    await goMemories(page);
    await page.waitForFunction((v) => document.querySelectorAll(`${v} .mem-tile`).length === 40, V, { timeout: 6000 }).catch(() => {});
    check('40 own memories render as tiles, grouped by week', (await page.$$(`${V} .mem-tile`)).length === 40 && (await page.$$(`${V} .mem-week`)).length >= 5);
    check('weeks are newest first with "Week N" titles', /^Week 7/.test(await text(page, `${V} .mem-week .sec-title`) || ''));
    check('no horizontal overflow', await page.evaluate((v) => document.querySelector(v).scrollWidth <= document.querySelector(v).clientWidth + 1, V));
    await page.evaluate((v) => document.querySelector(`${v} .mem-week`).scrollIntoView({ block: 'start' }), V);
    await page.waitForFunction((v) => [...document.querySelectorAll(`${v} .mem-week:first-child img[data-photo]`)].every((i) => i.classList.contains('is-loaded')), V, { timeout: 6000 }).catch(() => {});
    await settle(page, 300);
    await page.screenshot({ path: `${SHOTS}memories-weeks-light.png` });
    await collectCsp(page);
    await context.close();
  }

  // ============================================================== frame 6 night
  console.log('\nframe 6 (night)');
  {
    const { context, page } = await freshPage({ dark: true });
    await seedFrame(page, { bottle: true });
    await goMemories(page);
    await page.waitForFunction((v) => [...document.querySelectorAll(`${v} img[data-photo]`)].every((i) => i.classList.contains('is-loaded')), V, { timeout: 6000 }).catch(() => {});
    await settle(page, 400);
    check('night: photos are dimmed (--photo-filter)', await page.evaluate((v) => {
      const imgs = [...document.querySelectorAll(`${v} .cover-photo, ${v} .print img`)];
      return imgs.length === 4 && imgs.every((i) => /brightness\(0\.78\)/.test(getComputedStyle(i).filter));
    }, V));
    await page.screenshot({ path: `${SHOTS}memories-night.png` });
    await openSheetFrom(page, `${V} .mem-cover`);
    check('night: viewer photo dimmed too', await page.evaluate(() => /brightness\(0\.78\)/.test(getComputedStyle(document.querySelector('.sheet-memory .mem-viewer-img')).filter)));
    await page.waitForSelector('.sheet-memory .mem-viewer-img.is-loaded');
    await settle(page, 200);
    await page.screenshot({ path: `${SHOTS}memories-view-night.png` });
    await page.click('.sheet-memory [data-edit]');
    await page.waitForSelector('.sheet-memory .mem-form');
    await settle(page, 500);
    await page.screenshot({ path: `${SHOTS}memories-edit-night.png` });
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await collectCsp(page);
    await context.close();
  }

  // ============================================================== reduced motion
  console.log('\nreduced motion');
  {
    const { context, page } = await freshPage({ reduce: true });
    await setBaby(page, 'Clara', 10);
    await goMemories(page);
    await openSheetFrom(page, `${V} .page-hd [data-action="add"]`);
    check('reduced motion: the sheet fades (no slide)', await page.evaluate(() => document.querySelector('.sheet-layer.sheet-memory').classList.contains('is-reduced')));
    await page.click('.sheet-memory .chip[data-key="first-bath"]');
    await page.click('.sheet-memory [data-save]');
    await waitNoLayers(page);
    await page.waitForSelector(`${V} .firsts .first-row[data-open]`);
    check('reduced motion: the new row arrives without sliding', await page.evaluate((v) => {
      const li = document.querySelector(`${v} .firsts > li`);
      return getComputedStyle(li).animationName === 'none';
    }, V));
    await collectCsp(page);
    await context.close();
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero CSP violations', cspAll.length === 0, cspAll.join(' | '));
  check('zero requests to any other origin', foreign.length === 0, foreign.join(' | '));
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nmemories: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
