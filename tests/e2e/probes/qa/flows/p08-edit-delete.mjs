// Thaw & feed then change your mind; edit + delete + Undo from Today and Timeline; card numbers follow.
import * as L from './lib.mjs';
const { log, settle, shot, TOP, MIN } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
const ids = await page.evaluate(async ([u, s, now]) => {
  const { events } = await import(u); const { stash } = await import(s);
  await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: now - 20 * 86400000 });
  const a = await events.add({ type: 'feed', startTime: now - 3 * 3600000, endTime: now - 3 * 3600000 + 900000, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
  const b = await events.add({ type: 'feed', startTime: now - 60 * 60000, endTime: now - 45 * 60000, data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' } });
  const c = await events.add({ type: 'diaper', startTime: now - 20 * 60000, data: { kind: 'wet' } });
  return { a: a.id, b: b.id, c: c.id };
}, [L.mod('/js/core/store.js'), L.mod('/js/core/stash.js'), NOW]);
await settle(page, 700);
const inv = async () => (await page.evaluate(async (u) => (await import(u)).stash.list(), L.mod('/js/core/stash.js'))).map((p) => `${p.quantity}${p.unit}@${p.location}:${p.status}`).join(' ');
// --- thaw & feed, then back out
await L.tab(page, 'stash');
await L.clickView(page, 'stash', '[data-hero-act="thaw-feed"]'); await settle(page, 900);
log('thaw&feed opened; toast=', JSON.stringify(await L.toastText(page)), 'inv', await inv());
await page.keyboard.press('Escape'); await L.waitNoLayers(page); await settle(page, 700);
log('closed without feeding; toast=', JSON.stringify(await L.toastText(page)), 'inv', await inv());
log('STASH now:', JSON.stringify((await L.viewText(page, 'stash')).slice(0, 400)));
await shot(page, 'p08-after-thawfeed-cancel');
// --- Today: edit the 3 oz bottle → 5 oz
await L.tab(page, 'today');
const card = async () => (await page.innerText('[data-view="today"] .ql[data-card="feed"]')).replace(/\n/g, ' ');
log('feed card before:', await card());
await L.clickView(page, 'today', `[data-event-id="${ids.b}"]`); await L.openTop(page, '.sheet-event'); await settle(page, 600);
log('entry sheet:', JSON.stringify(await L.topText(page)));
await shot(page, 'p08-entry-sheet');
await page.click(`${TOP} [data-edit]`); await settle(page, 600);
log('edit form:', JSON.stringify(await L.topText(page)));
await shot(page, 'p08-edit-form');
for (let i = 0; i < 4; i += 1) await page.click(`${TOP} [data-inc]`);
await page.click(`${TOP} [data-save]`); await L.waitNoLayers(page, 5000); await settle(page, 700);
log('after edit stored:', JSON.stringify((await L.q(page, { type: 'feed' })).map((f) => f.data.amount)), 'card:', await card());
// --- Today: delete it + Undo
await L.clickView(page, 'today', `[data-event-id="${ids.b}"]`); await L.openTop(page, '.sheet-event'); await settle(page, 600);
await page.click(`${TOP} [data-delete]`); await L.waitNoLayers(page, 5000); await settle(page, 500);
log('after delete: toast', JSON.stringify(await L.toastText(page)), 'card:', await card(), 'rows', await page.$$eval('[data-view="today"] [data-event-id]', (r) => r.length));
await shot(page, 'p08-delete-toast');
await page.click('#toastRoot .toast-action'); await settle(page, 1000);
log('after undo: card:', await card(), 'rows', await page.$$eval('[data-view="today"] [data-event-id]', (r) => r.length), 'stored', (await L.q(page, { type: 'feed' })).length);
await L.dismissToast(page);
// --- Timeline: delete diaper + undo; stats follow
await L.tab(page, 'timeline');
const stats = async () => (await page.$$eval('[data-view="timeline"] [data-stat]', (e) => e.map((x) => x.innerText.replace(/\n/g, ' ')))).join(' | ');
log('stats before', await stats());
await L.clickView(page, 'timeline', `[data-event-id="${ids.c}"]`); await L.openTop(page, '.sheet-event'); await settle(page, 600);
await page.click(`${TOP} [data-delete]`); await L.waitNoLayers(page, 5000); await settle(page, 600);
log('stats after delete', await stats(), 'toast', JSON.stringify(await L.toastText(page)));
await page.click('#toastRoot .toast-action'); await settle(page, 1000);
log('stats after undo', await stats());
log('errors', L.errors);
await L.close();
