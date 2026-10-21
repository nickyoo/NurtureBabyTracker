// Two babies: pump card per baby, live pill naming after switching, + sheet title; Back from Report opened in Settings.
import * as L from './lib.mjs';
const { log, settle, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
// log a pump (Robin active) and start a nap for Robin
await L.tile(page, 'pump'); await L.openTop(page, '.sheet-pump'); await settle(page, 400);
await page.click(`${TOP} [data-past]`); await settle(page, 500); await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000); await L.dismissToast(page);
await page.click('[data-view="today"] .ql[data-card="sleep"]'); await L.openTop(page, '.sheet-sleep'); await settle(page, 400);
await page.click(`${TOP} [data-start]`); await settle(page, 700); await page.keyboard.press('Escape'); await L.waitNoLayers(page);
// add Sam via settings
await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 700);
await L.clickView(page, 'settings', '[data-action="add-baby"]'); await settle(page, 700);
await page.fill('[data-view="settings"]:last-of-type [data-field="name"]', 'Sam');
await L.clickView(page, 'settings', '[data-action="save-baby"]'); await settle(page, 1200);
// report from settings → Back
await L.clickView(page, 'settings', '[data-action="report"]'); await settle(page, 900);
log('report opened from settings; view', await L.activeView(page));
await page.goBack(); await settle(page, 800); log('Back from report →', await L.activeView(page));
await page.goBack(); await settle(page, 800); log('Back again →', await L.activeView(page));
// switch to Sam
await L.tab(page, 'today');
await page.click('[data-view="today"] [data-action="switch-baby"]'); await settle(page, 600);
await page.click(`${TOP} button:has-text("Sam")`); await L.waitNoLayers(page); await settle(page, 900);
log('Sam today:', JSON.stringify((await L.viewText(page, 'today')).slice(0, 400)));
log('pill:', JSON.stringify(await page.innerText('#livePills').catch(() => '')));
await L.shot2(page, 'q09-sam-today');
await L.plus(page); log('plus for Sam:', JSON.stringify((await L.topText(page)).slice(0, 160))); await page.keyboard.press('Escape'); await L.waitNoLayers(page);
// tap Robin's pill while Sam is active
await page.click('#livePills .lpill'); await settle(page, 800);
log('pill tap sheet:', JSON.stringify((await L.topText(page)).slice(0, 200)));
await L.shot2(page, 'q09-pill-sheet');
log('errors', L.errors);
await L.close();
