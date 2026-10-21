// v1 profile: pediatrician report + CSV + JSON backup — do NaN/null amounts, mL/oz, thawed pouches come through right?
import { chromium, mod, OUT, seedV1, instrument } from './v1lib.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', acceptDownloads: true });
const page = await context.newPage(); instrument(page);
await seedV1(page);
await page.goto(mod('/')); await page.waitForSelector('[data-view="today"]'); await page.waitForTimeout(1200);
await page.click('#tabBar [data-tab="timeline"]'); await page.waitForTimeout(700);
await page.click('#viewport button:has-text("Report for the pediatrician")'); await page.waitForTimeout(1200);
const rep = await page.$eval('#viewport', (v) => v.innerText.replace(/\n{2,}/g, '\n'));
console.log('REPORT:\n', rep.slice(0, 1800));
console.log('NaN/undefined in report:', /NaN|undefined|null|Infinity/.test(rep));
await page.screenshot({ path: `${OUT}/d13-report.png`, fullPage: true });
const r = await page.evaluate(async (b) => { const B = await import(b); const csv = await (await B.exportCsvFile({ unit: 'mL' })).text(); const json = JSON.parse(await (await B.exportBackupFile({ includePhotos: false, name: 'x.json' })).text()); return { csv, nanEv: json.events.filter((e) => e.migratedFrom).map((e) => `${e.migratedFrom} ${JSON.stringify(e.data)} note=${e.note}`), inv: json.inventory.length }; }, mod('/js/core/backup.js'));
console.log('CSV:\n' + r.csv.split('\n').slice(0, 14).join('\n'));
console.log('backup migrated events:\n' + r.nanEv.join('\n'), '\ninventory', r.inv);
console.log('errors', page.errors.filter((e) => !/Service Worker/.test(e)));
await context.close(); await browser.close();
