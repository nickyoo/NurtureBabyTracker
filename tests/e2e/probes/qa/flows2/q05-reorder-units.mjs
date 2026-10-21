// Customize reorder (tap grip → Up/Down, and a pointer drag) → Today order; units oz↔mL on sheets.
import * as L from './lib.mjs';
const { log, settle, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
const cards = async () => page.$$eval('[data-view="today"] .ql[data-card]', (els) => els.map((e) => e.dataset.card).join(','));
log('cards before', await cards());
await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 700);
await L.clickView(page, 'settings', '[data-action="customize"]'); await settle(page, 700);
const order = async () => page.evaluate(() => { const l = [...document.querySelectorAll('[data-view="settings"] [data-trackers]')].pop(); return [...l.querySelectorAll('[data-row]')].map((r) => r.dataset.row).join(','); });
log('customize order', await order());
await L.clickView(page, 'settings', '[data-grip="pump"]'); await settle(page, 400);
await L.clickView(page, 'settings', '[data-action="move"][data-arg="-1"]'); await settle(page, 400);
await L.clickView(page, 'settings', '[data-action="move"][data-arg="-1"]'); await settle(page, 400);
await L.clickView(page, 'settings', '[data-action="move-done"]'); await settle(page, 400);
log('after Up×2 on pump', await order());
await L.shot2(page, 'q05-customize');
// pointer drag: diaper grip down to the bottom
const g = await page.evaluate(() => { const l = [...document.querySelectorAll('[data-view="settings"] [data-grip="diaper"]')].pop(); l.scrollIntoView({ block: 'center' }); const b = l.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
await page.mouse.move(g[0], g[1]); await page.mouse.down(); await settle(page, 250);
for (let i = 1; i <= 12; i++) { await page.mouse.move(g[0], g[1] + i * 20); await settle(page, 30); }
await page.mouse.up(); await settle(page, 600);
log('after mouse drag diaper +240px', await order());
await page.goBack(); await settle(page, 500); await page.goBack(); await settle(page, 700);
log('today cards', await cards());
await L.plus(page); log('+ tiles', await page.$$eval('.sheet-quicklog [data-key], .sheet-quicklog .dbtn', (els) => els.map((e) => e.dataset.key || e.dataset.diaper).join(','))); await page.keyboard.press('Escape'); await L.waitNoLayers(page);
// units: mL, bottle sheet presets + stepper text
await L.setSetting(page, 'units', 'mL'); await settle(page, 600);
await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 500);
log('bottle sheet mL:', JSON.stringify((await L.topText(page)).slice(0, 260)));
await page.click(`${TOP} [data-preset]:nth-of-type(2)`).catch(() => {});
await page.click(`${TOP} [data-inc]`).catch(() => {}); await settle(page, 200);
log('stepper after preset2 + inc:', JSON.stringify((await page.innerText(`${TOP} [data-stepper]`).catch(() => '')).replace(/\s+/g, ' ')), 'log btn', JSON.stringify(await page.innerText(`${TOP} [data-log]`).catch(() => '')));
await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000); await settle(page, 500);
const f = await L.q(page, { type: 'feed' }); log('stored', JSON.stringify(f.map((x) => x.data)));
await L.setSetting(page, 'units', 'oz'); await settle(page, 700);
log('today oz:', JSON.stringify((await L.viewText(page, 'today')).match(/Fed[\s\S]*?AM|Fed[\s\S]*?PM/)?.[0]), '| rows:', JSON.stringify((await L.viewText(page, 'today')).split('Timeline').pop().slice(0, 120)));
await L.shot2(page, 'q05-today-oz-after-ml');
log('errors', L.errors);
await L.close();
