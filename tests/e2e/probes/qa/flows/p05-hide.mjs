// Customize: hide each tracker → its card, + tile, timeline row/lane/stat and tab disappear; data returns.
import * as L from './lib.mjs';
const { log, settle, shot, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await page.evaluate(async ([u, s]) => {
  const { events } = await import(u); const { stash } = await import(s);
  const at = (h, m, d = 20) => Date.UTC(2026, 9, d, h, m);
  for (const d of [19, 20]) {
    await events.add({ type: 'feed', startTime: at(8, 0, d), endTime: at(8, 15, d), data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
    await events.add({ type: 'feed', startTime: at(9, 0, d), endTime: at(9, 20, d), data: { method: 'breast', left: 600, right: 480, lastSide: 'right' } });
    await events.add({ type: 'sleep', startTime: at(10, 0, d), endTime: at(11, 0, d), data: { kind: 'nap' } });
    await events.add({ type: 'diaper', startTime: at(11, 30, d), data: { kind: 'wet' } });
    await events.add({ type: 'pump', startTime: at(12, 0, d), endTime: at(12, 15, d), data: { amount: 5, unit: 'oz', storedTo: null } });
    await events.add({ type: 'milestone', startTime: at(13, 0, d), data: { title: `Memory ${d}`, photoIds: [] } });
  }
  await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: at(12, 0, 19) });
}, [L.mod('/js/core/store.js'), L.mod('/js/core/stash.js')]);
await settle(page, 800);
const snapshot = async () => {
  await L.tab(page, 'today');
  const cards = await page.$$eval('[data-view="today"] .ql[data-card]', (els) => els.map((e) => e.dataset.card).join(','));
  const todayRows = await page.$$eval('[data-view="today"] [data-event-id] .row-title, [data-view="today"] [data-event-id]', (els) => els.length);
  const tabs = await page.$$eval('#tabBar [data-tab]', (els) => els.filter((e) => !e.hidden && e.offsetParent).map((e) => e.dataset.tab).join(','));
  await L.plus(page);
  const tiles = await page.$$eval('.sheet-quicklog [data-key], .sheet-quicklog .dbtn', (els) => els.map((e) => e.dataset.key || e.dataset.diaper).join(','));
  await page.keyboard.press('Escape'); await L.waitNoLayers(page);
  await L.tab(page, 'timeline');
  const tl = await L.viewText(page, 'timeline');
  const stats = await page.$$eval('[data-view="timeline"] [data-stat]', (els) => els.map((e) => e.dataset.stat).join(','));
  const legend = (tl.match(/12a\n6a\n12p\n6p\n12a\n([\s\S]*?)\nThe day/) || [])[1];
  const rows = (tl.match(/newest first\n([\s\S]*?)\nReport/) || [])[1];
  return { cards, tabs, tiles, todayRows, stats, legend: legend && legend.replace(/\n/g, '|'), rows: rows && rows.replace(/\n(AM|PM)\n/g, ' ').replace(/\n/g, '|') };
};
log('ALL ON:', JSON.stringify(await snapshot(), null, 1));
async function toggle(key) {
  await L.tab(page, 'today');
  await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 700);
  await L.clickView(page, 'settings', '[data-action="customize"]'); await settle(page, 700);
  await L.clickView(page, 'settings', `[data-action="tracker"][data-arg="${key}"]`); await settle(page, 400);
  const state = await page.evaluate((k) => { const l = [...document.querySelectorAll(`[data-action="tracker"][data-arg="${k}"]`)].pop(); return l && l.getAttribute('aria-checked'); }, key);
  await page.goBack(); await settle(page, 500); await page.goBack(); await settle(page, 600);
  return state;
}
for (const key of ['bottle', 'breastfeeding', 'sleep', 'diaper', 'pump', 'stash', 'memories']) {
  const st = await toggle(key);
  const snap = await snapshot();
  log(`\nHIDE ${key} (aria-checked=${st}):`, JSON.stringify(snap, null, 1));
  if (key === 'memories' || key === 'stash' || key === 'pump') await shot(page, `p05-hidden-${key}`);
  await toggle(key);
}
log('\nALL BACK ON:', JSON.stringify(await snapshot(), null, 1));
log('errors', L.errors);
await L.close();
