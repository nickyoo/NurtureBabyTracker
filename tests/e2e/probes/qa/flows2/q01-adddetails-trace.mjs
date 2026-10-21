// Trace what happens to sheet layers when "Add details" is tapped right after the toast lands.
import * as L from './lib.mjs';
const { log, settle } = L;
await L.launch();
const { page } = await L.fresh({ time: new Date('2026-10-20T10:30:00Z').getTime() });
await L.onboard(page);
await page.evaluate(() => { window.__trace = []; new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) if (n.classList && n.classList.contains('sheet-layer')) window.__trace.push(`+${n.className}@${Math.round(performance.now())}`); for (const n of m.removedNodes) if (n.classList && n.classList.contains('sheet-layer')) window.__trace.push(`-${n.className}@${Math.round(performance.now())}`); if (m.type === 'attributes' && m.target.classList.contains('sheet-layer')) window.__trace.push(`${m.target.className}:${m.target.dataset.state}@${Math.round(performance.now())}`); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] }); });
await L.plus(page); await page.click('.sheet-quicklog .dbtn[data-diaper="wet"]'); await L.waitNoLayers(page);
await page.waitForSelector('#toastRoot .toast[data-state="in"]'); await settle(page, 200);
await page.evaluate(() => window.__trace.push('CLICK@' + Math.round(performance.now())));
await page.click('#toastRoot .toast-action-2');
await settle(page, 1500);
log(JSON.stringify(await page.evaluate(() => window.__trace), null, 0));
log('layers now', await page.$$eval('.sheet-layer', (l) => l.length), 'errors', L.errors);
await L.close();
