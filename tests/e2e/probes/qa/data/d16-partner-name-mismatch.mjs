// Partner's backup names the same (only) child slightly differently ("Clara Rose" vs "Clara"). Settings → Import → Merge.
import { chromium, mod, OUT, instrument } from './v1lib.mjs';
const now = Date.now();
const file = { app: 'nurture', schema: 2, exportedAt: new Date().toISOString(), events: [
  { id: 'evt_p1', type: 'feed', startTime: now - 2 * 3600000, endTime: now - 2 * 3600000 + 600000, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, babyId: 'baby_partner', createdAt: now, updatedAt: now },
  { id: 'evt_p2', type: 'diaper', startTime: now - 3600000, endTime: now - 3600000, data: { kind: 'dirty' }, babyId: 'baby_partner', createdAt: now, updatedAt: now }],
  inventory: [], settings: { babies: [{ id: 'baby_partner', name: 'Clara Rose', birthDate: '2026-09-08', photoId: null }], activeBabyId: 'baby_partner' } };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await context.newPage(); instrument(page);
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.evaluate(async (s) => { const S = await import(s); await S.settings.updateBaby(S.settings.activeBaby().id, { name: 'Clara', birthDate: '2026-09-08' }); }, mod('/js/core/settings.js'));
await page.click('[data-action="settings"], button[aria-label*="ettings"]'); await page.waitForTimeout(700); await page.click('[data-arg="data"]'); await page.waitForTimeout(700);
await page.setInputFiles('[data-import]', { name: 'partner.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
await page.waitForTimeout(800); await page.click('[data-choice="merge"]'); await page.waitForTimeout(2000);
console.log('toast', await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.innerText.split('\n')[0])));
await page.goto(mod('/')); await page.waitForSelector('[data-view="today"]'); await page.waitForTimeout(1200);
console.log('today:', (await page.$eval('#viewport', (v) => v.innerText.replace(/\s+/g, ' '))).slice(0, 220));
console.log('babies', JSON.stringify(await page.evaluate(async (s) => (await import(s)).settings.get('babies').map((b) => b.name), mod('/js/core/settings.js'))));
await page.screenshot({ path: `${OUT}/d16-after-merge-today.png` });
await context.close(); await browser.close();
