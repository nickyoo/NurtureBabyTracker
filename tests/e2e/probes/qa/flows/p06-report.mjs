// Report: 7/14 days, print, CSV — numbers vs. seeded data, units, copy.
import * as L from './lib.mjs';
import { readFile } from 'node:fs/promises';
const { log, settle, shot } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
// 10 previous days, each: 2 bottles (4 oz formula + 120 mL breast milk), 1 breastfeed, nap 1h + night 6h(ends that day), 3 wet + 1 dirty, pump 5 oz
await page.evaluate(async ([u]) => {
  const { events } = await import(u);
  const at = (d, h, m = 0) => Date.UTC(2026, 9, d, h, m);
  for (let d = 10; d <= 19; d += 1) {
    await events.add({ type: 'feed', startTime: at(d, 8), endTime: at(d, 8, 15), data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
    await events.add({ type: 'feed', startTime: at(d, 12), endTime: at(d, 12, 15), data: { method: 'bottle', milk: 'breastmilk', amount: 120, unit: 'mL' } });
    await events.add({ type: 'feed', startTime: at(d, 16), endTime: at(d, 16, 20), data: { method: 'breast', left: 600, right: 600, lastSide: 'right' } });
    await events.add({ type: 'sleep', startTime: at(d, 0), endTime: at(d, 6), data: { kind: 'night' } });
    await events.add({ type: 'sleep', startTime: at(d, 13), endTime: at(d, 14), data: { kind: 'nap' } });
    for (const h of [7, 11, 15]) await events.add({ type: 'diaper', startTime: at(d, h), data: { kind: 'wet' } });
    await events.add({ type: 'diaper', startTime: at(d, 17), data: { kind: 'dirty' } });
    await events.add({ type: 'pump', startTime: at(d, 9), endTime: at(d, 9, 15), data: { amount: 5, unit: 'oz', storedTo: null } });
  }
}, [L.mod('/js/core/store.js')]);
await settle(page, 600);
await L.tab(page, 'timeline');
await L.clickView(page, 'timeline', '[data-action="report"]'); await settle(page, 900);
log('REPORT 7:', JSON.stringify(await L.viewText(page, 'report')));
await shot(page, 'p06-report-7');
await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
await L.clickView(page, 'report', '[data-days="14"]'); await settle(page, 700);
log('\nREPORT 14:', JSON.stringify(await L.viewText(page, 'report')));
await L.clickView(page, 'report', '[data-action="print"]'); await settle(page, 500);
log('print called', await page.evaluate(() => window.__printed));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), L.clickView(page, 'report', '[data-action="csv"]')]);
if (dl) { const txt = await readFile(await dl.path(), 'utf8'); log('CSV', dl.suggestedFilename(), '\n' + txt.split('\n').slice(0, 20).join('\n')); }
else log('no download; toast:', await L.toastText(page));
await L.setSetting(page, 'units', 'mL'); await settle(page, 600);
log('\nREPORT 14 mL:', JSON.stringify(await L.viewText(page, 'report')));
await shot(page, 'p06-report-14-ml');
log('errors', L.errors);
await L.close();
