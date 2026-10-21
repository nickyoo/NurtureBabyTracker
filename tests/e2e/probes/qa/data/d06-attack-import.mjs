// Import a hostile backup through the REAL Settings → Backup & data → Import UI (merge, then replace).
// Checks: nothing executes (alert hook, CSP, injected nodes), no prototype pollution, every screen renders,
// milk-expiry tricks are capped, replace leaves a safety copy.
import { chromium, mod, OUT, instrument, watchCsp } from './v1lib.mjs';
import { freshApp } from '../lib.mjs';
const MODE = process.env.MODE || 'merge';
const now = Date.now(); const H = 3600000, D = 24 * H;
const X = `<img src=x onerror="window.__xss.push('img')">"'><svg onload="window.__xss.push('svg')"></svg><script>window.__xss.push('script')</script>{{7*7}}\${7*7}`;
const svgB64 = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>`).toString('base64').padEnd(124, '=');
const file = {
  app: 'nurture', schema: 2, exportedAt: new Date().toISOString(),
  ['__proto__']: { polluted: 'top' },
  events: [
    { id: 'evt_x1', type: 'feed', startTime: now - 2 * H, endTime: now - 2 * H + 600000, note: X, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz', ['__proto__']: { polluted: 'data' }, constructor: { prototype: { polluted: 'ctor' } } }, createdAt: now, updatedAt: now, babyId: 'baby_evil1' },
    { id: 'evt_x2', type: 'milestone', startTime: now - 3 * H, endTime: now - 3 * H, note: X, data: { key: 'first-smile', title: X, photoIds: ['ph_evil', '../../etc', 'x'.repeat(500)] }, createdAt: now, updatedAt: now, babyId: 'baby_evil1' },
    { id: 'evt_x3', type: 'milestone', startTime: now - 4 * H, endTime: now - 4 * H, note: '', data: { key: '<script>', title: 'javascript:alert(1)', photoIds: 'ph_evil' }, createdAt: now, updatedAt: now, babyId: 'baby_evil1' },
    { id: 'evt_x4', type: 'feed', startTime: now - 5 * H, endTime: now - 5 * H, note: '', data: { method: 'bottle', milk: X, amount: '1e400', unit: 'gallon' }, createdAt: now, updatedAt: now, babyId: 'baby_evil1' },
    { id: 'evt_x5', type: 'diaper', startTime: now - 6 * H, endTime: now - 6 * H, note: { toString: 1 }, data: { kind: X, color: X, consistency: X }, babyId: 'baby_evil1' },
    { id: 'evt_x6', type: 'sleep', startTime: now - 300 * D, endTime: null, data: { kind: 'night' }, babyId: 'baby_evil1' },
    { id: 'evt_x7', type: 'pump', startTime: now - 7 * H, endTime: now - 7 * H + 900000, data: { amount: -5, unit: 'mL', storedTo: X }, babyId: null },
    { id: 'evt_x8', type: 'feed', startTime: now + 30 * D, endTime: now + 30 * D, data: { method: 'breast', left: 1e12, right: -4, lastSide: X }, babyId: 'baby_evil1' },
    { id: '<img src=x>', type: 'diaper', startTime: now - H, data: { kind: 'wet' } },
    { id: 'evt_x9', type: '__proto__', startTime: now - H, data: {} },
    { id: 'evt_deep', type: 'diaper', startTime: now - 8 * H, endTime: now - 8 * H, data: { kind: 'wet', nest: 'DEEPNEST' }, babyId: 'baby_evil1' },
    'not an object', null, 42,
  ],
  inventory: [
    { id: 'inv_ancient', pumpedAt: now - 10 * D, quantity: 5, unit: 'oz', location: 'fridge', expiresAt: 4102444000000, status: 'active', notes: X, createdAt: now - 10 * D },
    { id: 'inv_thawtrick', pumpedAt: now - 20 * D, thawedAt: now - 60 * H, quantity: 4, unit: 'oz', location: 'thawed', expiresAt: 4102444000000, status: 'active', notes: '' },
    { id: 'inv_room', pumpedAt: now - 20 * H, quantity: 3, unit: 'oz', location: 'roomTemp', expiresAt: 4102444000000, status: 'active' },
    { id: 'inv_neg', pumpedAt: now - D, quantity: -3, unit: 'oz', location: 'fridge', expiresAt: now + D, status: 'active' },
    { id: 'inv_huge', pumpedAt: now - D, quantity: 1e9, unit: 'oz', location: 'fridge', expiresAt: now + D, status: 'active' },
  ],
  photos: [{ id: 'ph_evil', type: 'image/svg+xml', width: 10, height: 10, createdAt: now, data: svgB64 }],
  settings: {
    babies: [{ id: 'baby_evil1', name: X, birthDate: '2026-02-30', photoId: 'ph_evil', createdAt: now, ['__proto__']: { polluted: 'baby' } }, { id: 'baby_evil2', name: 'A'.repeat(5000), birthDate: '9999-01-01', photoId: null }],
    activeBabyId: 'baby_evil1', parentName: X, units: '<b>', theme: 'javascript:', sound: 'on',
    trackers: { stash: false, '__proto__': { polluted: 'trackers' } }, todayOrder: ['__proto__', 'feed', X],
    pumpGoalOz: 1e308, pumpIntervalMinutes: -1, storageWindows: { fridgeDays: 9999, freezerMonths: 'x' },
    memoryCovers: { baby_evil1: 'evt_x2', ['__proto__']: 'evt_x2' },
    iconDataUrl: 'data:image/png;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', feedbackEmail: 'attacker@evil.example', lastBackupAt: now, deviceId: 'dev_attacker000',
  },
};
// JSON.stringify drops the literal __proto__ keys we set via computed props? computed ['__proto__'] sets prototype; re-insert as text.
let text = JSON.stringify(file);
text = text.replace('"app":"nurture"', '"__proto__":{"polluted":"top"},"constructor":{"prototype":{"polluted":"ctor"}},"app":"nurture"')
  .replace('"amount":4,"unit":"oz"}', '"amount":4,"unit":"oz","__proto__":{"polluted":"data"}}')
  .replace('"memoryCovers":{', '"memoryCovers":{"__proto__":{"polluted":"covers"},').replace('"DEEPNEST"', '['.repeat(+(process.env.DEPTH || 5000)) + ']'.repeat(+(process.env.DEPTH || 5000)));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', acceptDownloads: true });
const page = await context.newPage(); instrument(page); await watchCsp(page);
const downloads = []; page.on('download', (d) => downloads.push(d.suggestedFilename()));
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.evaluate(async ([st]) => { const { events } = await import(st); await events.add({ type: 'diaper', startTime: Date.now() - 600000, data: { kind: 'wet' } }); }, [mod('/js/core/store.js')]);
await page.click('[data-action="settings"], button[aria-label*="ettings"]'); await page.waitForTimeout(700);
await page.click('[data-arg="data"]'); await page.waitForTimeout(700);
await page.setInputFiles('[data-import]', { name: `evil-${X.slice(0, 30)}.json`, mimeType: 'application/json', buffer: Buffer.from(text) });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/d06-${MODE}-sheet.png` });
await page.click(`[data-choice="${MODE}"]`);
if (MODE === 'replace') { await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/d06-replace-confirm.png` }); await page.click('.sheet-layer:last-child .btn-danger, .sheet-layer:last-child [data-action="confirm"], .sheet-layer:last-child button:has-text("Replace everything")'); }
await page.waitForTimeout(2500);
const toast = await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.innerText)).catch(() => []);
const err = await page.$eval('[data-error]', (e) => (e.hidden ? '' : e.innerText)).catch(() => '');
console.log('toast', toast, 'sheet error', err, 'downloads', downloads);
await page.screenshot({ path: `${OUT}/d06-${MODE}-after.png` });
const probe = () => page.evaluate(() => ({ xss: window.__xss, csp: window.__csp, polluted: ({}).polluted, injected: document.querySelectorAll('img[src="x"], svg[onload], script:not([src])').length, styleAttrSet: [...document.querySelectorAll('[style]')].map((e) => e.getAttribute('style').slice(0, 30)).slice(0, 3) }));
const out = {};
await page.goto(mod('/')); await page.waitForSelector('[data-view]'); await page.waitForTimeout(1200);
for (const tab of ['today', 'timeline', 'stash', 'memories']) {
  await page.click(`#tabBar [data-tab="${tab}"]`).catch(() => {}); await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/d06-${MODE}-${tab}.png` });
  out[tab] = (await page.$eval('#viewport', (v) => v.innerText.replace(/\s+/g, ' '))).slice(0, 700);
  console.log(`== ${tab}:`, out[tab]);
}
// open the hostile milestone + feed sheets
await page.click('#tabBar [data-tab="timeline"]'); await page.waitForTimeout(800);
const rows = page.locator('#viewport button[aria-label*="Bottle"], #viewport button[aria-label*="Diaper"], #viewport button[aria-label*="iaper"]');
console.log('rows', await rows.count());
if (await rows.count()) { await rows.first().click(); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/d06-${MODE}-evsheet.png` }); console.log('event sheet:', (await page.evaluate(() => ([...document.querySelectorAll('.sheet-layer')].pop() || {}).innerText || 'NO SHEET').then((s) => s).then((s) => s.replace(/\s+/g, ' '))).slice(0, 400)); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
await page.click('[data-action="settings"], button[aria-label*="ettings"]').catch(() => {}); await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/d06-${MODE}-settings.png` });
console.log('settings:', (await page.$eval('#viewport', (v) => v.innerText.replace(/\s+/g, ' '))).slice(0, 400));
const stored = await page.evaluate(async ([s, st, sh]) => { const S = await import(s); const { events } = await import(st); const { stash } = await import(sh); const all = await events.query(); const inv = await stash.list(); return { babies: S.get('babies').map((b) => [b.id, b.name.slice(0, 40), b.birthDate, b.photoId]), active: S.get('activeBabyId'), fb: S.get('feedbackEmail'), icon: S.get('iconDataUrl'), dev: S.get('deviceId'), covers: S.get('memoryCovers'), sw: S.get('storageWindows'), goal: S.get('pumpGoalOz'), units: S.get('units'), theme: S.get('theme'), trackers: S.get('trackers'), order: S.get('todayOrder'), ids: all.map((e) => `${e.id}:${e.type}:${e.endTime === null ? 'RUNNING' : ''}:${JSON.stringify(e.data).slice(0, 80)}`), inv: inv.map((i) => `${i.id} ${i.location} q=${i.quantity} exp=${((i.expiresAt - Date.now()) / 3600000).toFixed(1)}h`) }; }, [mod('/js/core/settings.js'), mod('/js/core/store.js'), mod('/js/core/stash.js')]);
console.log('stored', JSON.stringify(stored, null, 1));
console.log('probe', JSON.stringify(await probe()));
console.log('errors', page.errors);
await context.close(); await browser.close();
