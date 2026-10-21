// Photos: huge/odd images through the real memory sheet; then a tiny storage quota (CDP) for quota errors.
import { chromium, mod, OUT, instrument, watchCsp } from './v1lib.mjs';
const IMG = process.env.IMGDIR;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await context.newPage(); instrument(page); await watchCsp(page);
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
const openMemory = async () => { await page.click('#tabBar [data-tab="memories"]'); await page.waitForTimeout(700); await page.click('#viewport button:has-text("Add a memory")'); await page.waitForSelector('[data-pick]', { state: 'attached' }); await page.waitForTimeout(600); };
const sheetErr = () => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer')].pop(); const e = l && l.querySelector('.field-error:not([hidden]), [role="alert"]'); return e ? e.innerText : ''; });
await openMemory();
for (const f of ['huge.jpg', 'pano.png', 'tiny.png', 'rot6.jpg', 'corrupt.jpg', 'fake.heic', 'evil.svg']) {
  const t0 = Date.now();
  await page.setInputFiles('[data-pick]', `${IMG}/${f}`);
  await page.waitForFunction(() => !document.querySelector('.sheet-layer [aria-busy="true"], .mem-ph.is-pending, [data-pending]'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const recs = await page.evaluate(async (p) => { const { getAll } = await import(p); return (await getAll('photos')).map((r) => `${r.width}x${r.height} ${r.type || r.blob.type} ${Math.round(r.blob.size / 1024)}KB`); }, mod('/js/core/db.js'));
  console.log(f, `${Date.now() - t0}ms`, 'err:', JSON.stringify(await sheetErr()), 'n=', recs.length);
}
await page.screenshot({ path: `${OUT}/d09-memory-photos.png` });
console.log('all photo recs', await page.evaluate(async (p) => { const { getAll } = await import(p); return (await getAll('photos')).map((r) => `${r.width}x${r.height} ${r.blob.type} ${Math.round(r.blob.size / 1024)}KB`); }, mod('/js/core/db.js')));
console.log('xss', await page.evaluate(() => window.__xss), 'csp', await page.evaluate(() => window.__csp));
// rotated photo orientation check: sample the stored rot6 blob's pixel at left-top (should be portrait 800x1200)
// ---- quota: shrink this origin's quota with CDP, then try a photo and a log
const cdp = await context.newCDPSession(page);
const origin = new URL(mod('/')).origin;
const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: usage + 20 * 1024 });
console.log('quota set to usage+20KB; estimate:', JSON.stringify(await page.evaluate(async () => navigator.storage.estimate())));
await page.setInputFiles('[data-pick]', `${IMG}/huge.jpg`); await page.waitForTimeout(4000);
console.log('photo at quota -> sheet error:', JSON.stringify(await sheetErr()));
await page.screenshot({ path: `${OUT}/d09-quota-photo.png` });
// try saving the memory with title
await page.fill('.sheet-layer input[type="text"], .sheet-layer [data-title]', 'First smile big'.repeat(1)).catch(() => {});
await page.click('[data-save]').catch((e) => console.log('save click', e.message.slice(0, 60)));
await page.waitForTimeout(2000);
console.log('after save at quota: sheet err', JSON.stringify(await sheetErr()), 'toast', await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.innerText)));
await page.screenshot({ path: `${OUT}/d09-quota-save.png` });
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
// fill the remaining quota with a big event note set, then one-tap diaper from Today
console.log('fill:', await page.evaluate(async (u) => { const { events } = await import(u); let i = 0; try { for (; i < 400; i++) await events.add({ type: 'diaper', startTime: Date.now() - i * 60000 - 7200000, note: 'x'.repeat(1900), data: { kind: 'wet' } }); } catch (e) { return `filled at ${i}: ${e.name} ${e.message}`; } return `wrote ${i}`; }, mod('/js/core/store.js')));
await page.click('#tabBar [data-tab="today"]'); await page.waitForTimeout(700);
await page.click('#tabBar .fab, #tabBar [data-action="fab"]'); await page.waitForTimeout(800);
await page.click('.sheet-layer button:has-text("Wet")').catch((e) => console.log('wet', e.message.slice(0, 80)));
await page.waitForTimeout(1500);
console.log('diaper at full quota toast:', await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.innerText)), 'errors', page.errors.slice(-4));
await page.screenshot({ path: `${OUT}/d09-quota-diaper.png` });
await context.close(); await browser.close();
