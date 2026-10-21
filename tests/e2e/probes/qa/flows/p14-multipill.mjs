// 2–3 running activities: do the stacked pills cover content / the + / toasts?
import * as L from './lib.mjs';
const { log, settle, shot } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await page.evaluate(async ([u, now]) => {
  const { events } = await import(u);
  for (let i = 0; i < 10; i += 1) await events.add({ type: 'diaper', startTime: now - (i + 1) * 30 * 60000, data: { kind: 'wet' } });
  await events.start('sleep', { kind: 'nap' }, { startTime: now - 30 * 60000 });
  await events.start('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, { startTime: now - 5 * 60000 });
  await events.start('pump', {}, { startTime: now - 8 * 60000 });
}, [L.mod('/js/core/store.js'), NOW]);
await page.reload(); await page.waitForSelector('[data-view="today"]'); await settle(page, 1200);
const info = await page.evaluate(() => {
  const pills = [...document.querySelectorAll('#livePills .lpill')].map((p) => { const b = p.getBoundingClientRect(); return [p.dataset.kind, Math.round(b.top), Math.round(b.bottom)]; });
  const v = document.querySelector('#viewport > [data-view="today"]'); v.scrollTo(0, v.scrollHeight);
  return { pills, chip: !!document.querySelector('#livePills [class*="more"], #livePills [class*="plus"]') };
});
await settle(page, 500);
const cover = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-view="today"] [data-event-id]')];
  const last = rows[rows.length - 1]; const b = last.getBoundingClientRect();
  const pills = [...document.querySelectorAll('#livePills .lpill')].map((p) => p.getBoundingClientRect());
  const topPill = Math.min(...pills.map((p) => p.top));
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { lastRow: [Math.round(b.top), Math.round(b.bottom)], topPill: Math.round(topPill), lastRowVisibleAboveAllPills: b.bottom <= topPill, hitAtLastRowCenter: hit && (hit.closest('#livePills') ? 'PILL' : hit.closest('[data-event-id]') ? 'row' : hit.className) };
});
log('pills', JSON.stringify(info), '\nscrolled to bottom', JSON.stringify(cover));
await shot(page, 'p14-three-pills-bottom');
await L.tab(page, 'stash'); await shot(page, 'p14-three-pills-stash');
log('errors', L.errors);
await L.close();
