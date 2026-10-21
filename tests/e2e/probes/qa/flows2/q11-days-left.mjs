// Same pouch, three screens: does "days left" / "use within" agree between Stash list, pouch sheet and the bottle sheet's From stash?
import * as L from './lib.mjs';
const { log, settle, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await page.evaluate(async ([s, now]) => { const { stash } = await import(s);
  await stash.add({ quantity: 3, unit: 'oz', location: 'fridge', pumpedAt: now - 0.6 * 86400000 });     // 3.4 days left
  await stash.add({ quantity: 2, unit: 'oz', location: 'fridge', pumpedAt: now - 1.5 * 86400000 });    // 2.5 days left
}, [L.mod('/js/core/stash.js'), NOW]);
await L.tab(page, 'stash');
const rows = await page.$$eval('[data-view="stash"] .stx-row', (r) => r.map((x) => x.innerText.replace(/\n/g, ' ')));
log('Stash rows:', JSON.stringify(rows));
await L.shot2(page, 'q11-stash');
await page.click('[data-view="stash"] .stx-row:has-text("2 oz")'); await L.openTop(page); await settle(page, 600);
log('2 oz pouch sheet:', JSON.stringify((await L.topText(page)).slice(0, 220)));
await page.keyboard.press('Escape'); await L.waitNoLayers(page);
await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 400);
await page.click(`${TOP} [role="radio"]:has-text("From stash")`); await settle(page, 600);
log('Bottle › From stash:', JSON.stringify((await L.topText(page)).slice(0, 260)));
await L.shot2(page, 'q11-fromstash');
log('errors', L.errors);
await L.close();
