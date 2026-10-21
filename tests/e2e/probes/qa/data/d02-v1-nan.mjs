// v1 NaN/null-amount pumps: are they shown as "—" and flagged for edit? Do report/backups/today totals cope?
import { chromium, mod, OUT, seedV1, phone } from './v1lib.mjs';
const browser = await chromium.launch();
const { context, page } = await phone(browser);
await seedV1(page, { liveTimers: false });
await page.goto(mod('/')); await page.waitForSelector('[data-view="today"]'); await page.waitForTimeout(1200);
await page.click('#tabBar [data-tab="timeline"]'); await page.waitForTimeout(800);
const days = await page.$$eval('#viewport button', (bs) => bs.map((b) => (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g, ' ')).slice(0, 20));
console.log('buttons', JSON.stringify(days));
// tap the date 2 days ago in the strip
const d = new Date(Date.now() - 1 * 86400000).getDate();
const strip = page.locator('#viewport [data-day], #viewport .tl-day, #viewport button').filter({ hasText: new RegExp(`^\\s*\\w\\w\\s*${d}\\s*$`) });
console.log('strip matches', await strip.count());
await strip.first().click(); await page.waitForTimeout(900);
const t = await page.$eval('#viewport', (v) => v.innerText.replace(/\n{2,}/g, '\n'));
console.log(t.slice(t.indexOf('The day')));
await page.screenshot({ path: `${OUT}/d02-tl-2daysago.png` });
// open the NaN row
const row = page.locator('#viewport button:has-text("Pumped")');
console.log('nan row count', await row.count()); for (const n of await row.all()) console.log('ROW', await n.getAttribute('aria-label'));
if (await row.count()) { await row.nth(+(process.env.ROW||1)).click(); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/d02-nan-sheet.png` }); console.log('SHEET:', await page.$eval('.sheet-layer:last-child', (s) => s.innerText.replace(/\n{2,}/g, '\n'))); }
console.log('errors', page.errors);
await context.close(); await browser.close();
