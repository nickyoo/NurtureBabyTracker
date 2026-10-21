// Timeline edit/delete/Undo per type, memory flows, pump-to-freezer deletion vs stash.
import * as L from './lib.mjs';
const { log, settle, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
const inv = async () => (await page.evaluate(async (u) => (await import(u)).stash.list(), L.mod('/js/core/stash.js'))).map((p) => `${p.quantity}${p.unit}@${p.location}:${p.status}`).join(' ');
// Real pump via + → past pump → 4 oz to freezer
await L.tile(page, 'pump'); await L.openTop(page, '.sheet-pump'); await settle(page, 400);
await page.click(`${TOP} [data-past]`); await settle(page, 600);
await page.click(`${TOP} [data-places] [data-value="freezer"]`);
await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000); await L.dismissToast(page);
log('after pump to freezer: inv', await inv());
// memory with photo
await L.tile(page, 'memory'); await L.openTop(page, '.sheet-memory'); await settle(page, 400);
await page.fill(`${TOP} [data-title]`, 'First smile');
await page.setInputFiles(`${TOP} [data-pick]`, await L.photoPng(page, 200)); await settle(page, 1500);
await page.click(`${TOP} [data-save]`); await L.waitNoLayers(page, 5000); await L.dismissToast(page);
// diaper + sleep via store
await page.evaluate(async ([u, now]) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: now - 40 * 60000, data: { kind: 'dirty' } }); await events.add({ type: 'sleep', startTime: now - 3 * 3600000, endTime: now - 2 * 3600000, data: { kind: 'nap' } }); }, [L.mod('/js/core/store.js'), NOW]);
await L.tab(page, 'timeline');
const rows = await page.$$eval('[data-view="timeline"] [data-event-id]', (els) => els.filter((e) => e.matches('button,a')).map((e) => [e.dataset.eventId, e.innerText.replace(/\n/g, ' ')]));
log('timeline rows', JSON.stringify(rows));
for (const [id, label] of rows) {
  await L.clickView(page, 'timeline', `[data-event-id="${id}"]`); await settle(page, 800);
  const t = await L.topText(page);
  log(`\nROW ${label}\n  sheet: ${JSON.stringify(t.slice(0, 300))}`);
  const del = await page.$(`${TOP} [data-delete]`);
  if (!del) { log('  NO DELETE in sheet'); await page.keyboard.press('Escape'); await L.waitNoLayers(page); continue; }
  await del.click(); await settle(page, 700);
  const after = await L.topText(page);
  if (after) { log('  after delete tap (layer still):', JSON.stringify(after.slice(0, 200))); const c = await page.$(`${TOP} .btn-danger, ${TOP} [data-confirm]`); if (c) await c.click(); }
  await L.waitNoLayers(page, 4000); await settle(page, 500);
  const toast = await L.toastText(page);
  const still = await page.$$eval(`[data-view="timeline"] [data-event-id="${id}"]`, (e) => e.length);
  log(`  toast=${JSON.stringify(toast)} rowStill=${still} inv=${await inv()}`);
  const undo = await page.$('#toastRoot .toast-action-1');
  if (undo) { await undo.click(); await settle(page, 900); log(`  after Undo: rowBack=${await page.$$eval(`[data-view="timeline"] [data-event-id="${id}"]`, (e) => e.length)} inv=${await inv()}`); }
  await L.dismissToast(page);
}
await L.shot2(page, 'q03-timeline-after');
// Memories tab
await L.tab(page, 'memories');
log('\nMEMORIES:', JSON.stringify((await L.viewText(page, 'memories')).slice(0, 600)));
await L.shot2(page, 'q03-memories');
log('errors', L.errors);
await L.close();
