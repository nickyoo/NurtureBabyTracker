// Fresh-install paths: From stash with an empty stash, past breastfeed, hold-+ express, card "+" buttons, Stash card.
import * as L from './lib.mjs';
const { log, settle, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
// From stash, empty
await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 400);
await page.click(`${TOP} [role="radio"]:has-text("From stash")`); await settle(page, 500);
log('From stash (empty):', JSON.stringify(await L.topText(page)));
await L.shot2(page, 'q07-fromstash-empty');
await page.keyboard.press('Escape'); await L.waitNoLayers(page);
// Past breastfeed
await L.tile(page, 'breast'); await L.openTop(page, '.sheet-feed'); await settle(page, 400);
await page.click(`${TOP} :is(button,a):has-text("Log a past feed")`); await settle(page, 600);
log('past breastfeed:', JSON.stringify(await L.topText(page)));
await L.shot2(page, 'q07-past-breast');
const btn = await page.$(`${TOP} [data-log], ${TOP} .btn-primary`);
if (btn) { log('primary btn', JSON.stringify(await btn.innerText()), 'disabled', await btn.evaluate((b) => b.disabled || b.getAttribute('aria-disabled'))); await btn.click(); await settle(page, 900); }
log('layers after log', await page.$$eval('.sheet-layer', (l) => l.length), 'feeds', JSON.stringify((await L.q(page, { type: 'feed' })).map((f) => [f.data, (f.endTime - f.startTime) / 60000])));
await page.keyboard.press('Escape'); await L.waitNoLayers(page); await L.dismissToast(page);
// hold +
const fab = await page.$('#fab'); const b = await fab.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await settle(page, 900);
log('hold + after 900ms: layers', await page.$$eval('.sheet-layer, .express, [class*="radial"], [class*="express"]', (l) => l.map((x) => x.className).join(' | ')));
await L.shot2(page, 'q07-hold-plus');
await page.mouse.up(); await settle(page, 800);
log('after release: layers', await page.$$eval('.sheet-layer', (l) => l.map((x) => x.className).join(' | ')), 'toast', JSON.stringify(await L.toastText(page)), 'feeds', (await L.q(page, { type: 'feed' })).length);
await page.keyboard.press('Escape'); await L.waitNoLayers(page); await L.dismissToast(page);
// cards: tap body vs +
for (const c of ['feed', 'sleep', 'diaper', 'pump']) {
  await page.click(`[data-view="today"] .ql[data-card="${c}"] .ql-add, [data-view="today"] .ql[data-card="${c}"] [data-add]`).catch(async () => { await page.click(`[data-view="today"] .ql[data-card="${c}"]`); });
  await settle(page, 800);
  log(`card ${c} +: ${JSON.stringify((await L.topText(page)).slice(0, 120))}`);
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await L.dismissToast(page);
}
log('errors', L.errors);
await L.close();
