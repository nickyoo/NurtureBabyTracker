// e2e: Settings (js/views/settings.js) on a FRESH profile at 390×844.
// Drives every sub-page: baby (name, birth date, photo → app icon), add a
// baby, Customize (toggles hide trackers everywhere, drag + keyboard + move
// button reorder → Today's card order), units oz/mL, appearance, reduce
// motion, sound, pumping goal/interval + Calendar (.ics), milk storage
// windows + reset with Undo, data (backup, CSV, import merge + replace with
// the safety backup, persistence, storage used), privacy (live proof, source
// link, feedback mailto), install guide, about (licenses), erase everything.
// Asserts zero console errors, zero CSP violations, zero requests to any other
// origin, ≥44 px targets with accessible names on every page, and saves
// light + night screenshots to docs/design/build/settings-*.png.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/settings.mjs

import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];

async function freshPage({ colorScheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme, acceptDownloads: true });
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
  await page.waitForTimeout(400);
  return { context, page };
}

const mod = (p) => `${BASE_URL}${p}`;
// Evaluated as a string through the DevTools protocol (not eval in the page,
// which the CSP rightly blocks).
const S = (page, src, arg) => page.evaluate(`(async () => {
  const { settings } = await import(${JSON.stringify(mod('/js/core/settings.js'))});
  const a = ${JSON.stringify(arg === undefined ? null : arg)};
  ${src}
})()`);
const getSetting = (page, k) => S(page, 'return settings.get(a);', k);
const settle = (page, ms = 450) => page.waitForTimeout(ms);
/** The settings screen on top (the last one that isn't sliding out). */
const TOP = '[data-view="settings"]:not(.is-leaving-right):last-of-type';
const top = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll('#viewport > [data-view="settings"]')].filter((s) => !s.classList.contains('is-leaving-right'));
  const s = v[v.length - 1];
  if (!s) return null;
  return { title: (s.querySelector('.navbar-title') || {}).textContent, back: (s.querySelector('.back') || {}).textContent.trim(), page: [...s.firstElementChild.classList].find((c) => c.startsWith('st-page-')) };
});
async function clickTop(page, selector) {
  await page.evaluate((sel) => {
    const v = [...document.querySelectorAll('#viewport > [data-view="settings"]')].filter((s) => !s.classList.contains('is-leaving-right'));
    const el = v[v.length - 1].querySelector(sel);
    if (!el) throw new Error(`no ${sel}`);
    el.scrollIntoView({ block: 'center' });
  }, selector);
  await page.locator(`#viewport > [data-view="settings"]:not(.is-leaving-right) >> nth=-1`).locator(selector).first().click();
}
async function openSettings(page) {
  await page.click('[data-view="today"] [data-action="settings"]');
  await page.waitForSelector('[data-view="settings"]');
  await settle(page, 500);
}
async function goSub(page, selector) {
  const n = await page.evaluate(() => document.querySelectorAll('#viewport > [data-view="settings"]').length);
  await clickTop(page, selector);
  await page.waitForFunction((c) => document.querySelectorAll('#viewport > [data-view="settings"]:not(.is-leaving-right)').length === c + 1, n, { timeout: 3000 });
  await settle(page, 500);
}
async function back(page) {
  const n = await page.evaluate(() => document.querySelectorAll('#viewport > [data-view="settings"]:not(.is-leaving-right)').length);
  await clickTop(page, '[data-action="back"]');
  await page.waitForFunction((c) => document.querySelectorAll('#viewport > [data-view="settings"]:not(.is-leaving-right)').length === c - 1, n, { timeout: 3000 });
  await settle(page, 450);
}
async function waitToast(page, re, timeout = 4000) {
  return page.waitForFunction((src) => {
    const t = document.querySelector('.toast .toast-msg');
    return t && new RegExp(src).test(t.textContent) ? t.textContent : false;
  }, re.source, { timeout }).then((h) => h.jsonValue()).catch(() => null);
}
async function waitSheet(page) { await page.waitForSelector('.sheet-layer[data-state="open"]', { timeout: 3000 }); await settle(page, 450); }
async function waitNoSheet(page) { await page.waitForFunction(() => !document.querySelector('.sheet-layer'), null, { timeout: 4000 }).catch(() => {}); }
async function shot(page, name) { await page.screenshot({ path: `${SHOTS}settings-${name}.png` }); }
/** Screenshot the top settings screen scrolled to its start, once no toast covers it. */
async function shotTop(page, name) {
  await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const v = [...document.querySelectorAll('#viewport > [data-view="settings"]')].filter((s) => !s.classList.contains('is-leaving-right'));
    v[v.length - 1].scrollTo(0, 0);
  });
  await page.waitForTimeout(150);
  await shot(page, name);
}

/** Every interactive element on the top settings screen: ≥44×44 and named. */
async function auditTargets(page, label) {
  const bad = await page.evaluate(() => {
    const v = [...document.querySelectorAll('#viewport > [data-view="settings"]')].filter((s) => !s.classList.contains('is-leaving-right'));
    const s = v[v.length - 1];
    const out = [];
    const name = (el) => {
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      const lb = el.getAttribute('aria-labelledby');
      if (lb) return lb.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
      return (el.textContent || '').trim();
    };
    for (const el of s.querySelectorAll('button, a[href], input:not(.sr-only), [role="spinbutton"], label.btn, label.st-photo')) {
      if (el.closest('[hidden]')) continue;
      let r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      // A segmented radio's hit area is the 44 px track (its ::after fills
      // the track's padding); a field's input is hit through its label.
      if (el.matches('.segmented > [role="radio"]')) {
        const tr = el.parentElement.getBoundingClientRect();
        const after = getComputedStyle(el, '::after');
        if (after.content !== 'none' && after.position === 'absolute') r = { width: r.width, height: tr.height };
      }
      if (el.matches('.field-input') && el.closest('label.field')) r = el.closest('label.field').getBoundingClientRect();
      const tag = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${tag} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (el.tagName !== 'INPUT' && !name(el)) out.push(`${tag} has no name`);
    }
    for (const el of s.querySelectorAll('input:not([type="file"])')) {
      if (!el.closest('label') && !el.getAttribute('aria-label')) out.push(`input ${el.name} unlabeled`);
    }
    // No horizontal overflow.
    if (s.scrollWidth > s.clientWidth + 1) out.push(`horizontal overflow ${s.scrollWidth}>${s.clientWidth}`);
    return out;
  });
  check(`${label}: every control ≥44 px, named, no sideways scroll`, bad.length === 0, bad.join('; '));
}

async function pngBuffer(page, color = '#C86B4A') {
  const b64 = await page.evaluate((c) => {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 240;
    const g = cv.getContext('2d');
    g.fillStyle = c; g.fillRect(0, 0, 320, 240);
    g.fillStyle = '#F6F1E8'; g.beginPath(); g.arc(160, 120, 70, 0, Math.PI * 2); g.fill();
    return cv.toDataURL('image/png').split(',')[1];
  }, color);
  return Buffer.from(b64, 'base64');
}

try {
  // ================================================================ root
  console.log('\nroot + baby');
  const { context, page } = await freshPage();
  await S(page, 'const b = settings.activeBaby(); await settings.updateBaby(b.id, { name: "" });');
  await openSettings(page);
  let t = await top(page);
  check('avatar opens Settings; back reads “Today”', t && t.title === 'Settings' && t.back === 'Today', JSON.stringify(t));
  check('focus moved into the Settings screen', await page.evaluate(() => document.querySelector('[data-view="settings"]').contains(document.activeElement)));
  check('unnamed baby row invites details (no pronoun)', await page.evaluate(() => /Add a name, birthday and photo/.test(document.querySelector('[data-view="settings"] .st-babies').textContent)));
  await auditTargets(page, 'root');

  // ---- baby page: name, birth date, photo → app icon
  await goSub(page, '[data-action="baby"]');
  t = await top(page);
  check('baby row → baby page (back reads “Settings”)', t.page === 'st-page-baby' && t.back === 'Settings', JSON.stringify(t));
  await page.fill(`${TOP} [data-field="name"]`, 'Clara');
  await page.press(`${TOP} [data-field="name"]`, 'Enter');
  await page.waitForFunction(async () => true);
  await settle(page, 300);
  check('name saves on Enter', (await S(page, 'return settings.activeBaby().name;')) === 'Clara');
  await page.fill(`${TOP} [data-field="born"]`, '2026-09-02');
  await page.dispatchEvent(`${TOP} [data-field="born"]`, 'change');
  await settle(page, 300);
  check('birth date saves', (await S(page, 'return settings.activeBaby().birthDate;')) === '2026-09-02');
  check('age line shows (italic, words)', await page.evaluate(() => /weeks/.test(document.querySelector('.st-page-baby .st-age').textContent)));
  check('navbar title follows the name', (await top(page)).title === 'Clara');
  const iconBefore = await page.evaluate(() => document.getElementById('appleTouchIcon').getAttribute('href'));
  await page.setInputFiles(`${TOP} [data-photo]`, { name: 'clara.png', mimeType: 'image/png', buffer: await pngBuffer(page) });
  await page.waitForFunction(() => /^data:image\/png/.test(document.getElementById('appleTouchIcon').getAttribute('href')), null, { timeout: 5000 }).catch(() => {});
  const icon = await page.evaluate(() => ({ touch: document.getElementById('appleTouchIcon').getAttribute('href'), fav: document.getElementById('favicon').getAttribute('href') }));
  check('photo → apple-touch-icon updates live (180 PNG data URL)', iconBefore !== icon.touch && /^data:image\/png;base64,/.test(icon.touch));
  check('…and the favicon too', /^data:image\/png;base64,/.test(icon.fav));
  check('settings.iconDataUrl persisted', /^data:image\/png/.test(await getSetting(page, 'iconDataUrl') || ''));
  check('photo shows in the picker', await page.waitForSelector(`${TOP} .st-photo img.st-av`, { timeout: 3000 }).then(() => true).catch(() => false));
  check('iPhone note: remove and re-add to update the icon', await page.evaluate(() => /remove and re-add Nurture to your Home Screen to update the icon/.test(document.querySelector('.st-page-baby [data-key="photo-note"]').textContent)));
  await auditTargets(page, 'baby');
  await shot(page, 'baby-light');
  // remove photo → Undo restores it
  await clickTop(page, '[data-action="remove-photo"]');
  check('remove photo → Undo toast', !!(await waitToast(page, /Photo removed/)));
  check('…icon falls back to the static one', await page.evaluate(() => document.getElementById('appleTouchIcon').getAttribute('href') === 'icons/apple-touch-icon.png'));
  await page.waitForTimeout(400);
  await page.click('.toast-action');
  await page.waitForFunction(() => /^data:image\/png/.test(document.getElementById('appleTouchIcon').getAttribute('href')), null, { timeout: 5000 }).catch(() => {});
  check('Undo puts the photo (and icon) back', !!(await S(page, 'return settings.activeBaby().photoId;')) && /^data:image\/png/.test(await page.evaluate(() => document.getElementById('appleTouchIcon').getAttribute('href'))));
  await back(page);
  check('back → root shows the name, age and photo', await page.evaluate(() => {
    const row = document.querySelector('[data-view="settings"] .st-babies [data-action="baby"]');
    return /Clara/.test(row.textContent) && /born/.test(row.textContent) && !!row.querySelector('img.st-av');
  }));
  check('focus returns to the baby row', await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-view="settings"] [data-action="baby"]')));

  // ---- add a baby
  console.log('\nadd a baby');
  await goSub(page, '[data-action="add-baby"]');
  check('add page titled “Add a baby”', (await top(page)).title === 'Add a baby');
  await clickTop(page, '[data-action="save-baby"]');
  await settle(page, 200);
  check('empty name → friendly inline error, nothing added', await page.evaluate(() => /Add a name/.test(document.querySelector('.st-page-baby .field-error').textContent)) && (await S(page, 'return settings.babies().length;')) === 1);
  await page.fill(`${TOP} [data-field="name"]`, 'Theo');
  await clickTop(page, '[data-action="save-baby"]');
  await page.waitForFunction(() => document.querySelectorAll('#viewport > [data-view="settings"]:not(.is-leaving-right)').length === 1, null, { timeout: 4000 });
  check('Add baby → back to Settings with a toast offering “Show on Today”', !!(await waitToast(page, /Theo added/)));
  await settle(page, 300);
  check('Theo row appears (Babies label, “On Today” badge on Clara)', await page.evaluate(() => {
    const s = document.querySelector('[data-view="settings"]');
    return /Babies/.test(s.textContent) && s.querySelectorAll('.st-babies [data-action="baby"]').length === 2 && /On Today/.test(s.querySelector('.st-babies li').textContent);
  }));
  await page.waitForTimeout(500);
  await page.click('.toast-action');
  await page.waitForTimeout(400);
  const active = await S(page, 'return settings.activeBaby().name;');
  check('“Show on Today” switches the active baby', active === 'Theo', active);
  check('…and the badge moves to Theo', await page.evaluate(() => /Theo/.test(document.querySelector('[data-view="settings"] .st-babies .badge').closest('li').textContent)));
  // Make Clara active again from her page.
  await goSub(page, '[data-action="baby"]');
  await clickTop(page, '[data-action="make-active"]');
  await settle(page, 300);
  check('baby page: “Show Clara on Today”', (await S(page, 'return settings.activeBaby().name;')) === 'Clara');
  check('…then reads “On Today”', await page.evaluate(() => /On Today/.test(document.querySelector('.st-page-baby [data-key="switch"]').textContent)));
  await back(page);

  // ================================================================ customize
  console.log('\ncustomize');
  // A live bottle so the docked pill shows (frame 7).
  await page.evaluate(async (u) => { const { events } = await import(u); await events.start('feed', { method: 'bottle', milk: 'breastmilk', amount: 4, unit: 'oz' }, { startTime: Date.now() - (12 * 60 + 4) * 1000 }); }, mod('/js/core/store.js'));
  await goSub(page, '[data-action="customize"]');
  t = await top(page);
  check('Customize: title, back to Settings', t.title === 'Customize' && t.back === 'Settings');
  check('intro copy exact', await page.evaluate(() => document.querySelector('.st-page-customize .intro').textContent === 'Choose what shows on Today and in +. Drag to reorder. Hidden trackers keep their data.'));
  const rows = await page.evaluate(() => [...document.querySelectorAll('.st-page-customize [data-trackers] > li[data-key^="t-"] .set-text b')].map((b) => b.textContent));
  check('seven trackers in Today order (Diapers before Pumping by default)', rows.join('|') === 'Bottle feeds|Breastfeeding|Sleep|Diapers|Pumping|Milk stash|Milestones & memories', rows.join('|'));
  check('live pill docks on the pushed screen', await page.evaluate(() => !!document.querySelector('#livePills .lpill')));
  await auditTargets(page, 'customize');
  await shot(page, 'customize-light');

  // hide memories → its tab disappears; subtitle says photos kept
  await clickTop(page, '[data-action="tracker"][data-arg="memories"]');
  await settle(page, 300);
  check('memories off: toggle unchecked, “Hidden · photos kept”', await page.evaluate(() => {
    const li = document.querySelector('.st-page-customize [data-key="t-memories"]');
    return li.querySelector('.toggle').getAttribute('aria-checked') === 'false' && /Hidden · photos kept/.test(li.textContent);
  }));
  check('…and the Memories tab is gone', await page.evaluate(() => !document.querySelector('#tabBar [data-tab="memories"]')));
  // tapping the words toggles too
  await clickTop(page, 'label[data-tap-toggle="memories"] b');
  await settle(page, 300);
  check('tapping the row words toggles it back on', (await getSetting(page, 'trackers')).memories === true);
  // hide pumping
  await clickTop(page, '[data-action="tracker"][data-arg="pump"]');
  await settle(page, 300);
  check('pump hidden → setting saved', (await getSetting(page, 'trackers')).pump === false);

  // keyboard reorder: Sleep grip ↑
  await page.focus(`${TOP} [data-grip="sleep"]`);
  await page.keyboard.press('ArrowUp');
  await settle(page, 450);
  let order = await getSetting(page, 'todayOrder');
  check('ArrowUp on Sleep’s grip → Sleep first on Today', order[0] === 'sleep', order.join(','));
  check('…rows follow, focus stays on the grip', await page.evaluate(() => {
    const first = document.querySelector('.st-page-customize [data-trackers] > li .set-text b');
    return first.textContent === 'Sleep' && document.activeElement && document.activeElement.matches('[data-grip="sleep"]');
  }));
  check('…announced politely', await page.evaluate(() => /Sleep moved up, 1 of 5/.test(document.querySelector('.st-page-customize [aria-live="polite"]').textContent)));
  await page.keyboard.press('ArrowDown');
  await settle(page, 450);
  order = await getSetting(page, 'todayOrder');
  check('ArrowDown moves it back (feeds move as one unit)', order.join(',') === 'feed,sleep,diaper,pump,stash', order.join(','));

  // grip tap → move buttons
  await page.keyboard.press('Enter');
  await settle(page, 300);
  check('grip activation opens Up / Down / Done, focus on Up', await page.evaluate(() => !!document.querySelector('.st-page-customize .st-move') && document.activeElement.matches('[data-action="move"][data-arg="-1"]')));
  await page.keyboard.press('Enter'); // Up
  await settle(page, 450);
  order = await getSetting(page, 'todayOrder');
  check('“Up” moves Sleep above feeds', order[0] === 'sleep', order.join(','));
  check('…focus stays inside the move buttons', await page.evaluate(() => !!document.activeElement.closest('.st-move')));
  await clickTop(page, '[data-action="move-done"]');
  await settle(page, 300);
  check('Done closes the buttons and returns focus to the grip', await page.evaluate(() => !document.querySelector('.st-page-customize .st-move') && document.activeElement.matches('[data-grip="sleep"]')));

  // pointer drag: Diapers grip to the top
  const box = async (sel) => page.locator(`${TOP} ${sel}`).first().boundingBox();
  const from = await box('[data-grip="diaper"]');
  const to = await box('[data-trackers] > li:first-child');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 2 });
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 });
  await page.waitForTimeout(150);
  check('dragging lifts the row (is-dragging)', await page.evaluate(() => !!document.querySelector('.st-page-customize .set-row.is-dragging')));
  await shot(page, 'customize-drag-light');
  await page.mouse.up();
  await settle(page, 500);
  order = await getSetting(page, 'todayOrder');
  check('drop → Diapers first in todayOrder', order[0] === 'diaper', order.join(','));
  check('…no drag transforms left behind', await page.evaluate(() => ![...document.querySelectorAll('.st-page-customize [data-trackers] > li')].some((li) => li.classList.contains('st-rt-dragging') || li.style.getPropertyValue('--shift'))));
  await back(page);
  await back(page);
  await settle(page, 300);
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-view="today"] .ql-grid .ql')].map((c) => c.dataset.card));
  check('Today: cards follow the new order, no pump card while hidden', cards[0] === 'diaper' && !cards.includes('pump'), cards.join(','));
  await openSettings(page);
  check('root: pump hidden → row reads “Feeding”, not pumping', await page.evaluate(() => {
    const r = document.querySelector('[data-view="settings"] [data-arg="feeding"]');
    return r && /^Feeding/.test(r.querySelector('b').textContent) && !/pumping/.test(r.querySelector('b').textContent);
  }));
  check('root: Customize row counts hidden trackers', await page.evaluate(() => /6 of 7 trackers showing/.test(document.querySelector('[data-view="settings"] [data-action="customize"]').textContent)));
  await goSub(page, '[data-arg="feeding"]');
  check('feeding page: no pumping section while pump is hidden', await page.evaluate(() => !document.querySelector('.st-page-feeding [data-step]') && !!document.querySelector('.st-page-feeding [data-arg="formula"]')));
  await clickTop(page, '[data-action="tracker"][data-arg="formula"]');
  await settle(page, 300);
  check('formula toggle hides formula (tracker saved)', (await getSetting(page, 'trackers')).formula === false);
  await clickTop(page, '[data-action="tracker"][data-arg="formula"]');
  await back(page);
  await S(page, 'await settings.patch("trackers", { pump: true });');
  await settle(page, 300);

  // ================================================================ units + feeding
  console.log('\nunits, pumping goal, calendar');
  await clickTop(page, '[data-seg="units"] [data-v="mL"]');
  await settle(page, 300);
  check('units → mL saved', (await getSetting(page, 'units')) === 'mL');
  check('root row reads “Amounts in milliliters”', await page.evaluate(() => /milliliters/.test(document.querySelector('[data-view="settings"] [data-key="units"]').textContent)));
  await goSub(page, '[data-arg="feeding"]');
  const goalTxt = () => page.evaluate(() => document.querySelector('.st-page-feeding [data-spin="goal"]').textContent);
  check('goal shows in mL (24 oz → 710 mL)', (await goalTxt()) === '710 mL', await goalTxt());
  await clickTop(page, '[data-step="goal"][data-dir="1"]');
  await page.waitForTimeout(600);
  check('+ steps the goal by 10 mL and saves it in oz', (await goalTxt()) === '720 mL' && Math.abs((await getSetting(page, 'pumpGoalOz')) - 24.3) < 0.051, `${await goalTxt()} / ${await getSetting(page, 'pumpGoalOz')}`);
  await page.focus(`${TOP} [data-spin="interval"]`);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(600);
  check('interval spinbutton: ArrowDown → 2h 45m, saved', (await getSetting(page, 'pumpIntervalMinutes')) === 165 && await page.evaluate(() => document.querySelector('.st-page-feeding [data-spin="interval"]').getAttribute('aria-valuetext') === 'every 2 hours 45 minutes'));
  check('honest Calendar copy', await page.evaluate(() => /Web apps can’t alert you while they’re closed/.test(document.querySelector('.st-page-feeding [data-key="cal"]').textContent)));
  await auditTargets(page, 'feeding');
  await shot(page, 'feeding-ml-light');
  const [ics] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), clickTop(page, '[data-action="calendar"]')]);
  check('“Add pump schedule to Calendar” → .ics file', !!ics && /\.ics$/.test(ics.suggestedFilename()), ics && ics.suggestedFilename());
  if (ics) {
    const text = await readFile(await ics.path(), 'utf8');
    check('…with VALARMs every 2h 45m', /BEGIN:VALARM/.test(text) && (text.match(/BEGIN:VEVENT/g) || []).length > 50);
  }
  check('…and a calm toast', !!(await waitToast(page, /Pump schedule/)));
  await back(page);
  await clickTop(page, '[data-seg="units"] [data-v="oz"]');
  await settle(page, 300);
  // keyboard on the segmented control
  await page.focus(`${TOP} [data-seg="theme"] [aria-checked="true"]`);

  // ================================================================ comfort
  console.log('\nappearance, motion, sound');
  await clickTop(page, '[data-seg="theme"] [data-v="dark"]');
  await settle(page, 800);
  check('Appearance → Night: <html data-theme="dark">, saved', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await getSetting(page, 'theme')) === 'dark');
  await shotTop(page, 'root-night');
  await page.focus(`${TOP} [data-seg="theme"] [data-v="dark"]`);
  await page.keyboard.press('ArrowLeft');
  await settle(page, 800);
  check('arrow keys move the segmented choice (→ Light)', (await getSetting(page, 'theme')) === 'light' && (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  check('…focus follows the selection', await page.evaluate(() => document.activeElement.matches('[data-seg="theme"] [data-v="light"]')));
  await shotTop(page, 'root-light');
  await clickTop(page, '[data-action="motion"]');
  await settle(page, 300);
  check('Reduce motion on → data-motion="reduce"', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'reduce' && (await getSetting(page, 'reduceMotion')) === true);
  check('…switch reads checked', await page.evaluate(() => document.querySelector('[data-view="settings"] [data-action="motion"]').getAttribute('aria-checked') === 'true'));
  await clickTop(page, '[data-action="motion"]');
  await settle(page, 300);
  check('Reduce motion off → data-motion="full"', (await page.evaluate(() => document.documentElement.dataset.motion)) === 'full');
  await clickTop(page, '[data-seg="sound"] [data-v="off"]');
  await settle(page, 200);
  check('Sound → Off saved', (await getSetting(page, 'sound')) === 'off');
  await clickTop(page, '[data-seg="sound"] [data-v="night-off"]');
  await settle(page, 200);
  check('Sound → Quiet at night saved', (await getSetting(page, 'sound')) === 'night-off');

  // ================================================================ storage
  console.log('\nmilk storage');
  await goSub(page, '[data-arg="storage"]');
  await auditTargets(page, 'storage');
  await clickTop(page, '[data-step="win:fridgeDays"][data-dir="1"]');
  await page.waitForTimeout(600);
  check('Fridge + → 5 days saved, sub shows the CDC default', (await getSetting(page, 'storageWindows')).fridgeDays === 5 && await page.evaluate(() => /CDC: 4 days/.test(document.querySelector('.st-page-storage [data-key="fridgeDays"]').textContent)));
  check('“Back to CDC guidance” appears', await page.evaluate(() => !!document.querySelector('.st-page-storage [data-action="reset-windows"]')));
  await shot(page, 'storage-light');
  await clickTop(page, '[data-action="reset-windows"]');
  check('reset → Undo toast', !!(await waitToast(page, /Back to CDC guidance/)));
  check('…windows back to 4 days', (await getSetting(page, 'storageWindows')).fridgeDays === 4);
  await page.waitForTimeout(400);
  await page.click('.toast-action');
  await page.waitForTimeout(400);
  check('Undo restores 5 days', (await getSetting(page, 'storageWindows')).fridgeDays === 5);
  await S(page, 'await settings.patch("storageWindows", { fridgeDays: 4 });');
  await back(page);

  // ================================================================ data
  console.log('\ndata: backup, CSV, import, persistence');
  await goSub(page, '[data-arg="data"]');
  check('“Last backup” reads Never; storage used shows a size', await page.evaluate(() => {
    const s = document.querySelector('.st-page-data');
    return /Never/.test(s.querySelector('[data-key="last"]').textContent) && /(KB|MB)/.test(s.querySelector('[data-key="used"]').textContent);
  }));
  check('Include photos switch shows (1 photo)', await page.evaluate(() => /1 photo/.test((document.querySelector('.st-page-data [data-key="with-photos"]') || {}).textContent || '')));
  await auditTargets(page, 'data');
  await shot(page, 'data-light');
  const [bk] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), clickTop(page, '[data-action="backup"]')]);
  check('Save a backup → JSON file', !!bk && /^nurture-backup-.*\.json$/.test(bk.suggestedFilename()), bk && bk.suggestedFilename());
  await page.waitForTimeout(500);
  check('…“Last backup: Today” and lastBackupAt set', await page.evaluate(() => /Today/.test(document.querySelector('.st-page-data [data-key="last"]').textContent)) && Number.isFinite(await getSetting(page, 'lastBackupAt')));
  const backupPath = bk ? await bk.path() : null;
  const backupJson = backupPath ? JSON.parse(await readFile(backupPath, 'utf8')) : null;
  check('…backup carries the photo (included by default)', !!backupJson && Array.isArray(backupJson.photos) && backupJson.photos.length === 1);
  const [csv] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), clickTop(page, '[data-action="csv"]')]);
  check('Export CSV → .csv file', !!csv && /\.csv$/.test(csv.suggestedFilename()));
  // Import (merge): a partner's backup with one extra diaper.
  if (backupJson) {
    const partner = JSON.parse(JSON.stringify(backupJson));
    const babyId = partner.settings.babies[0].id;
    partner.events.push({ id: 'evt_partner_1', type: 'diaper', startTime: Date.now() - 3600000, endTime: Date.now() - 3600000, note: '', data: { kind: 'wet' }, createdAt: Date.now(), updatedAt: Date.now(), babyId, deviceId: 'dev_partner123' });
    await page.setInputFiles(`${TOP} [data-import]`, { name: 'partner-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(partner)) });
    await waitSheet(page);
    check('import → sheet “Import this backup?” with Merge / Replace', await page.evaluate(() => {
      const l = document.querySelector('.sheet-layer.sheet-st-import');
      return l && /Import this backup\?/.test(l.textContent) && !!l.querySelector('[data-choice="merge"]') && !!l.querySelector('[data-choice="replace"]');
    }));
    await shot(page, 'import-light');
    await page.click('.sheet-st-import [data-choice="merge"]');
    const merged = await waitToast(page, /Merged/);
    check('Merge → “Merged · 1 entry added”', merged && /1 entry added/.test(merged), merged);
    await waitNoSheet(page);
    check('…the diaper is in the log', await page.evaluate(async (u) => !!(await (await import(u)).events.get('evt_partner_1')), mod('/js/core/store.js')));
    check('…focus back on the import button', await page.evaluate(() => !!document.activeElement.closest('.st-page-data') && (document.activeElement.matches('[data-import]') || !!document.activeElement.closest('label.st-file'))));
    // Bad file: inline error, sheet stays.
    await page.setInputFiles(`${TOP} [data-import]`, { name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await waitSheet(page);
    await page.click('.sheet-st-import [data-choice="merge"]');
    await page.waitForTimeout(500);
    check('not-a-backup → friendly inline error, sheet stays open', await page.evaluate(() => {
      const e = document.querySelector('.sheet-st-import [data-error]');
      return e && !e.hidden && e.textContent.length > 10 && !!document.querySelector('.sheet-layer[data-state="open"]');
    }));
    await page.keyboard.press('Escape');
    await waitNoSheet(page);
    // Replace: confirm sheet mentions the safety backup; a safety download happens.
    const replaceFile = JSON.parse(JSON.stringify(backupJson));
    replaceFile.events = replaceFile.events.filter((e) => e.type !== 'feed');
    await page.setInputFiles(`${TOP} [data-import]`, { name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replaceFile)) });
    await waitSheet(page);
    await page.click('.sheet-st-import [data-choice="replace"]');
    await page.waitForSelector('.sheet-confirm[data-state="open"]', { timeout: 3000 }).catch(() => {});
    await settle(page, 400);
    check('Replace → confirm sheet mentions the safety backup', await page.evaluate(() => {
      const c = document.querySelector('.sheet-confirm');
      return c && /Replace everything on this phone\?/.test(c.textContent) && /safety backup/.test(c.textContent) && !!c.querySelector('.btn-danger');
    }));
    check('…safe choice focused first', await page.evaluate(() => document.activeElement && document.activeElement.matches('.sheet-confirm [data-cancel]')));
    const [safety] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), page.click('.sheet-confirm [data-confirm]')]);
    check('…confirm saves a safety backup first', !!safety && /before-import/.test(safety.suggestedFilename()), safety && safety.suggestedFilename());
    check('…then replaces (toast says so)', !!(await waitToast(page, /Replaced with the backup/)));
    check('…the file’s log replaced ours (running bottle gone, partner diaper gone)', await page.evaluate(async (u) => {
      const { events } = await import(u);
      return (await events.running('feed')).length === 0 && !(await events.get('evt_partner_1'));
    }, mod('/js/core/store.js')));
    check('…Clara is still here', (await S(page, 'return settings.babies().map(b => b.name).join(",");')).includes('Clara'));
  }
  await back(page);

  // ================================================================ privacy, install, about
  console.log('\nprivacy, install, about');
  await goSub(page, '[data-arg="privacy"]');
  check('privacy: live proof “0 network requests”', await page.evaluate(() => /^0 network requests$/.test(document.querySelector('.st-page-privacy .st-proof-line .badge').textContent.trim())));
  check('…plain promise “no network requests after it loads”', await page.evaluate(() => /This app makes no network requests after it loads\./.test(document.querySelector('.st-page-privacy').textContent)));
  check('…source link opens the public repo in a new tab', await page.evaluate(() => {
    const a = [...document.querySelectorAll('.st-page-privacy a')].find((x) => /source code/.test(x.textContent));
    return a && a.href === 'https://github.com/nickyoo/NurtureBabyTracker' && a.target === '_blank' && /noopener/.test(a.rel) && /noreferrer/.test(a.rel);
  }));
  check('…feedback is a mailto with no data attached', await page.evaluate(() => {
    const a = [...document.querySelectorAll('.st-page-privacy a')].find((x) => /Send feedback/.test(x.textContent));
    return a && /^mailto:/.test(a.href) && !/body=/.test(a.href);
  }));
  await auditTargets(page, 'privacy');
  await shotTop(page, 'privacy-light');
  await goSub(page, '[data-arg="data"]');
  check('privacy → “Backup, export or erase” opens Your data', (await top(page)).page === 'st-page-data' && (await top(page)).back === 'Settings');
  await back(page);
  await back(page);
  await goSub(page, '[data-arg="install"]');
  check('install: framed as protection, iPhone + Android steps', await page.evaluate(() => {
    const s = document.querySelector('.st-page-install');
    return /never clears Clara’s log/.test(s.textContent) && /Add to Home Screen/.test(s.textContent) && /Install app/.test(s.textContent);
  }));
  await auditTargets(page, 'install');
  await shotTop(page, 'install-light');
  await back(page);
  await goSub(page, '[data-arg="about"]');
  check('about: version + OFL licenses linked locally', await page.evaluate(() => {
    const s = document.querySelector('.st-page-about');
    return /Version \d/.test(s.textContent) && !!s.querySelector('a[href="fonts/OFL-Nunito.txt"]') && !!s.querySelector('a[href="fonts/OFL-Fraunces.txt"]') && /MIT License/.test(s.textContent);
  }));
  await auditTargets(page, 'about');
  await shotTop(page, 'about-light');
  await back(page);
  await clickTop(page, '[data-action="report"]');
  await page.waitForSelector('[data-view="report"]');
  await settle(page, 500);
  check('“Report for the pediatrician” opens the report (back reads Settings)', await page.evaluate(() => /Settings/.test(document.querySelector('[data-view="report"] .back').textContent)));
  await page.click('[data-view="report"] [data-action="back"]');
  await settle(page, 500);

  // ================================================================ erase
  console.log('\nerase everything');
  await goSub(page, '[data-arg="data"]');
  await clickTop(page, '[data-action="erase"]');
  await page.waitForSelector('.sheet-confirm[data-state="open"]');
  await settle(page, 400);
  check('erase → destructive confirm sheet (“Erase everything on this phone?”)', await page.evaluate(() => /Erase everything on this phone\?/.test(document.querySelector('.sheet-confirm').textContent)));
  await page.click('.sheet-confirm [data-cancel]');
  await waitNoSheet(page);
  check('“Keep it” changes nothing', (await S(page, 'return settings.babies().length;')) >= 1 && (await getSetting(page, 'onboarded')) === true);
  await clickTop(page, '[data-action="erase"]');
  await page.waitForSelector('.sheet-confirm[data-state="open"]');
  await settle(page, 400);
  await page.click('.sheet-confirm [data-confirm]');
  await page.waitForSelector('[data-view="onboarding"]', { timeout: 6000 }).catch(() => {});
  await settle(page, 500);
  check('Erase → back to onboarding, fresh unnamed baby', await page.evaluate(() => !!document.querySelector('[data-view="onboarding"]')) && (await S(page, 'return settings.babies().length === 1 && !settings.activeBaby().name;')));
  check('…app icon back to the static one', await page.evaluate(() => document.getElementById('appleTouchIcon').getAttribute('href') === 'icons/apple-touch-icon.png'));
  check('no CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join('; '));
  await context.close();

  // ================================================================ night set
  console.log('\nnight screenshots + two babies');
  {
    const { context: c2, page: p2 } = await freshPage({ colorScheme: 'dark' });
    await S(p2, 'await settings.set("theme", "dark"); const b = settings.activeBaby(); await settings.updateBaby(b.id, { name: "Clara", birthDate: "2026-09-02" }); await settings.patch("trackers", { memories: false });');
    await p2.evaluate(async (u) => { const { events } = await import(u); await events.start('feed', { method: 'bottle', milk: 'breastmilk', amount: 4, unit: 'oz' }, { startTime: Date.now() - (12 * 60 + 4) * 1000 }); }, mod('/js/core/store.js'));
    await settle(p2, 800);
    await openSettings(p2);
    await goSub(p2, '[data-action="customize"]');
    await settle(p2, 300);
    await shot(p2, 'customize-night');
    await back(p2);
    await goSub(p2, '[data-arg="data"]');
    await shot(p2, 'data-night');
    await back(p2);
    await goSub(p2, '[data-action="baby"]');
    await shot(p2, 'baby-night');
    await back(p2);
    // A second baby added from elsewhere (another tab) shows up live.
    await S(p2, 'await settings.addBaby({ name: "Theo" });');
    await settle(p2, 900);
    check('a baby added elsewhere appears live in Settings', await p2.evaluate(() => document.querySelectorAll('[data-view="settings"] .st-babies [data-action="baby"]').length === 2));
    await p2.evaluate(() => document.querySelector('[data-view="settings"]').scrollTo(0, 0));
    await shot(p2, 'root-two-babies-night');
    check('night: no CSP violations', (await p2.evaluate(() => window.__csp)).length === 0);
    await c2.close();
  }
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.log(err);
} finally {
  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero requests to other origins', foreign.length === 0, foreign.join(', '));
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
}
