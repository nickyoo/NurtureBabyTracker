// What toasts exist when "Add details" is tapped 200ms after the one-tap diaper toast?
import * as L from './lib.mjs';
const { log, settle } = L;
await L.launch();
const { page } = await L.fresh({ time: new Date('2026-10-20T10:30:00Z').getTime() });
await L.onboard(page);
await page.evaluate(() => { window.__t = []; new MutationObserver((ms) => { for (const m of ms) { for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__t.push(`+toast "${n.innerText.replace(/\n/g, ' ')}" @${Math.round(performance.now())}`); for (const n of m.removedNodes) if (n.classList && n.classList.contains('toast')) window.__t.push(`-toast "${n.innerText.replace(/\n/g, ' ')}" @${Math.round(performance.now())}`); if (m.type === 'attributes' && m.target.classList.contains('toast')) window.__t.push(`toast:${m.target.dataset.state} @${Math.round(performance.now())}`); } }).observe(document.getElementById('toastRoot'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] }); });
for (const d of [100, 300, 600, 900]) {
  await L.plus(page); await page.click('.sheet-quicklog .dbtn[data-diaper="wet"]'); await L.waitNoLayers(page);
  await page.waitForSelector('#toastRoot .toast[data-state="in"]'); await settle(page, d);
  const st = await page.$$eval('#toastRoot .toast', (ts) => ts.map((t) => `${t.dataset.state}:${t.querySelector('.toast-action-2')?.disabled}`));
  await page.evaluate(() => window.__t.push('CLICK @' + Math.round(performance.now())));
  await page.click('#toastRoot .toast-action-2');
  const opened = await L.openTop(page, '.sheet-diaper');
  log(`delay ${d}ms: toasts before click ${JSON.stringify(st)} -> sheet opened=${opened}`);
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await L.dismissToast(page); await settle(page, 400);
}
log((await page.evaluate(() => window.__t)).join('\n'));
await L.close();
