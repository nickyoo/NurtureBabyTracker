// While an Undo toast is up, open a sheet: is the toast drawn over the sheet (covering its controls)?
import { launch, freshApp, shot } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('#tabBar button:has-text("Timeline")'); await page.waitForTimeout(800);
await page.click('[data-view="timeline"] .row[data-event-id]'); await page.waitForTimeout(700);
await page.click('.sheet-layer:last-child button:has-text("Delete")'); await page.waitForTimeout(900);
await page.click('[data-view="timeline"] .row[data-event-id]'); await page.waitForTimeout(800);
const r = await page.evaluate(() => { const t = document.querySelector('#toastRoot .toast'); if (!t) return 'no toast'; const b = t.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { toast: [Math.round(b.y), Math.round(b.bottom)], op: getComputedStyle(t).opacity, hitIsToast: !!(hit && hit.closest('#toastRoot')), hit: hit && (hit.closest('.sheet-layer') ? 'sheet' : hit.className), zToast: getComputedStyle(document.getElementById('toastRoot')).zIndex, zSheet: getComputedStyle(document.querySelector('.sheet-layer')).zIndex }; });
console.log(JSON.stringify(r));
await shot(page, 'toast-over-sheet');
await context.close(); await browser.close();
