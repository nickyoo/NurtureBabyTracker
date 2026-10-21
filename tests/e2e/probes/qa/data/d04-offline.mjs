// Offline: load once with the SW, go offline, reload, use the app fully. Then "lie-fi" (requests hang).
import { chromium, mod, OUT, instrument, watchCsp } from './v1lib.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
const page = await context.newPage(); instrument(page); await watchCsp(page);
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => console.log('no controller yet'));
console.log('controller:', await page.evaluate(() => !!navigator.serviceWorker.controller), 'caches:', await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return [k, (await c.keys()).length]; }));
await context.setOffline(true);
let t0 = Date.now();
await page.reload(); await page.waitForSelector('[data-view="today"]', { timeout: 30000 });
console.log('offline reload ms', Date.now() - t0);
// use it: every tab, quick log sheet, log a diaper via UI
for (const tab of ['timeline', 'stash', 'memories', 'today']) { await page.click(`#tabBar [data-tab="${tab}"]`); await page.waitForTimeout(500); }
await page.click('#tabBar .fab, #tabBar [data-action="fab"]').catch(async () => { await page.click('#tabBar button[aria-label*="og"]'); });
await page.waitForTimeout(800);
const ql = await page.$eval('.sheet-layer:last-child', (s) => s.innerText.replace(/\s+/g, ' ')).catch(() => 'no sheet');
console.log('quick log offline:', ql.slice(0, 160));
await page.screenshot({ path: `${OUT}/d04-offline-quicklog.png` });
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
// settings / privacy page
await page.click('[data-action="settings"], button[aria-label*="ettings"]').catch(() => console.log('no settings btn'));
await page.waitForTimeout(800);
console.log('settings offline:', (await page.$eval('#viewport', (v) => v.innerText.replace(/\s+/g, ' '))).slice(0, 200));
await page.screenshot({ path: `${OUT}/d04-offline-settings.png` });
console.log('csp', await page.evaluate(() => window.__csp), 'errors', page.errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e)));
// lie-fi: network hangs (never answers)
await context.setOffline(false);
await context.route('**/*', () => { /* never answer */ });
t0 = Date.now();
await page.goto(mod('/'), { timeout: 60000 }).catch((e) => console.log('goto', e.message.slice(0, 80)));
await page.waitForSelector('[data-view="today"]', { timeout: 60000 }).then(() => console.log('lie-fi boot ms', Date.now() - t0)).catch((e) => console.log('lie-fi boot FAILED after', Date.now() - t0, e.message.slice(0, 60)));
await page.screenshot({ path: `${OUT}/d04-liefi.png` });
await context.close(); await browser.close();
