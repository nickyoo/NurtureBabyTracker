// Replace import when the safety-backup download does NOT land (browser blocks/cancels it, as iOS's
// "Download?" prompt or a blocked-downloads policy would). Does the app still wipe local data and claim a safety copy?
import { chromium, mod, OUT, instrument } from './v1lib.mjs';
const ACCEPT = process.env.ACCEPT === '1';
const now = Date.now();
const file = { app: 'nurture', schema: 2, exportedAt: new Date().toISOString(), events: [{ id: 'evt_partner1', type: 'diaper', startTime: now - 3600000, endTime: now - 3600000, data: { kind: 'dirty' }, babyId: 'baby_p1', createdAt: now, updatedAt: now }], inventory: [], settings: { babies: [{ id: 'baby_p1', name: 'Robin', birthDate: null, photoId: null }], activeBabyId: 'baby_p1' } };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', acceptDownloads: ACCEPT });
const page = await context.newPage(); instrument(page);
const dl = []; page.on('download', async (d) => { dl.push({ name: d.suggestedFilename(), failure: await d.failure() }); });
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.evaluate(async ([st, sh]) => { const { events } = await import(st); const { stash } = await import(sh);
  for (let i = 0; i < 12; i++) await events.add({ type: 'feed', startTime: Date.now() - (i + 1) * 3 * 3600000, endTime: Date.now() - (i + 1) * 3 * 3600000 + 900000, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
  await stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: Date.now() - 86400000 }); }, [mod('/js/core/store.js'), mod('/js/core/stash.js')]);
const count = () => page.evaluate(async ([st, sh]) => { const { events } = await import(st); const { stash } = await import(sh); return { events: (await events.query()).length, pouches: (await stash.list()).length }; }, [mod('/js/core/store.js'), mod('/js/core/stash.js')]);
console.log('before', await count());
await page.click('[data-action="settings"], button[aria-label*="ettings"]'); await page.waitForTimeout(700);
await page.click('[data-arg="data"]'); await page.waitForTimeout(700);
await page.setInputFiles('[data-import]', { name: 'partner.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
await page.waitForTimeout(900);
await page.click('[data-choice="replace"]'); await page.waitForTimeout(1000);
await page.click('.sheet-layer button:has-text("Replace everything")'); await page.waitForTimeout(2500);
const toast = await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.innerText));
console.log('acceptDownloads', ACCEPT, 'downloads', JSON.stringify(dl), 'toast', toast);
console.log('after', await count());
await page.screenshot({ path: `${OUT}/d07-replace-accept${ACCEPT ? 1 : 0}.png` });
await context.close(); await browser.close();
