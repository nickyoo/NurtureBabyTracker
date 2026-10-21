// Stash: Thaw & feed → live bottle → pill Finish; pouch discard + Undo; pouch edit; numbers.
import * as L from './lib.mjs';
const { log, settle, shot, TOP, MIN, DAY } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await page.evaluate(async ([s, now]) => {
  const { stash } = await import(s);
  await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: now - 20 * 86400000 });
  await stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: now - 10 * 86400000 });
  await stash.add({ quantity: 3, unit: 'oz', location: 'fridge', pumpedAt: now - 1 * 86400000 });
}, [L.mod('/js/core/stash.js'), NOW]);
const inv = async () => (await page.evaluate(async (u) => (await import(u)).stash.list(), L.mod('/js/core/stash.js'))).map((p) => `${p.quantity}${p.unit}@${p.location}:${p.status}`).join(' ');
await L.tab(page, 'stash');
log('STASH:', JSON.stringify(await L.viewText(page, 'stash')));
log('inv', await inv());
await shot(page, 'p07-stash');
// Hero: Thaw & feed
await L.clickView(page, 'stash', '[data-hero-act="thaw-feed"]'); await settle(page, 900);
log('after thaw&feed: layers', await page.$$eval('.sheet-layer', (l) => l.map((x) => x.className).join(' | ')), '\n  top:', JSON.stringify(await L.topText(page)));
await shot(page, 'p07-thawfeed-sheet');
log('inv', await inv());
if (await page.$(`${TOP} [data-start]`)) {
  await page.click(`${TOP} [data-start]`); await page.waitForSelector(`${TOP} [data-finish]`); await settle(page, 600);
  log('live:', JSON.stringify(await L.topText(page)));
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await settle(page, 400);
  await page.clock.fastForward(12 * MIN); await settle(page, 400);
  log('pill:', JSON.stringify(await page.innerText('#livePills')));
  await shot(page, 'p07-pill-on-stash');
  await page.click('#livePills .lpill[data-kind="bottle"] .lpill-finish'); await L.openTop(page, '.sheet-feed'); await settle(page, 700);
  log('finish sheet:', JSON.stringify(await L.topText(page)));
  await page.click(`${TOP} [data-finish]`); await L.waitNoLayers(page, 5000); await settle(page, 600);
}
log('toast', await L.toastText(page)); await L.dismissToast(page);
log('inv after feed', await inv());
log('feeds', JSON.stringify((await L.q(page, { type: 'feed' })).map((f) => f.data)));
log('STASH after:', JSON.stringify(await L.viewText(page, 'stash')));
await shot(page, 'p07-stash-after');
// Discard a pouch row + undo
const rowSel = '[data-view="stash"] .stx-row[data-pouch]';
const rows = await page.$$eval(rowSel, (r) => r.map((x) => x.innerText.replace(/\n/g, ' ')));
log('rows', JSON.stringify(rows));
await L.clickView(page, 'stash', '.stx-row[data-pouch]'); await L.openTop(page, '.sheet-stash'); await settle(page, 600);
log('pouch sheet:', JSON.stringify(await L.topText(page)));
await page.click(`${TOP} [data-act="discard"]`); await settle(page, 900);
log('after discard: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'toast', await L.toastText(page), 'inv', await inv());
await shot(page, 'p07-discard-toast');
await page.click('#toastRoot .toast-action').catch((e) => log('no undo', e.message.slice(0, 50))); await settle(page, 900);
log('after undo inv', await inv());
await L.dismissToast(page);
// Edit pouch amount
await L.clickView(page, 'stash', '.stx-row[data-pouch]'); await L.openTop(page, '.sheet-stash'); await settle(page, 600);
await page.click(`${TOP} [data-act="edit"]`); await settle(page, 600);
log('edit pouch:', JSON.stringify(await L.topText(page)));
await shot(page, 'p07-edit-pouch');
await page.click(`${TOP} [data-inc]`); await page.click(`${TOP} [data-inc]`);
await page.click(`${TOP} [data-save]`); await L.waitNoLayers(page, 5000); await settle(page, 600);
log('inv after edit', await inv(), 'toast', await L.toastText(page));
log('errors', L.errors);
await L.close();
