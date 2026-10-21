// Toast "Add details" after a one-tap diaper: does it open the details sheet?
import * as L from './lib.mjs';
const { log, settle, shot, TOP } = L;
await L.launch();
const { page } = await L.fresh({ time: new Date('2026-10-20T10:30:00Z').getTime() });
await L.onboard(page);
for (const [i, kind, delay] of [[1, 'wet', 200], [2, 'both', 200], [3, 'dirty', 1200]]) {
  await L.plus(page); await page.click(`.sheet-quicklog .dbtn[data-diaper="${kind}"]`); await L.waitNoLayers(page);
  await page.waitForSelector('#toastRoot .toast[data-state="in"]'); await settle(page, delay);
  const box = await page.$eval('#toastRoot .toast-action-2', (b) => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { r: [r.x, r.y, r.width, r.height], hit: top && (top.closest('.toast-action-2') ? 'self' : top.outerHTML.slice(0, 80)) }; });
  log(`#${i} ${kind}: add-details box`, JSON.stringify(box));
  await page.click('#toastRoot .toast-action-2');
  const opened = await L.openTop(page, '.sheet-diaper');
  await settle(page, 600);
  log(`  opened=${opened} layers=${await page.$$eval('.sheet-layer', (l) => l.map((x) => x.className + ':' + x.dataset.state).join(','))} text=${JSON.stringify((await L.topText(page)).slice(0, 160))}`);
  await shot(page, `p03-details-${i}`);
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await L.dismissToast(page); await settle(page, 400);
}
log('errors', L.errors);
await L.close();
