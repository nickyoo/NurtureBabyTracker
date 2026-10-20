import * as L from './lib.mjs';
const { log, settle, shot, TOP } = L;
await L.launch();
const { page } = await L.fresh({ time: new Date('2026-10-20T10:30:00Z').getTime() });
await L.onboard(page, { photo: true });
await shot(page, 'p01-today-empty');
log('TODAY:', await L.viewText(page, 'today'));
// each card
for (const k of ['feed', 'sleep', 'diaper', 'pump']) {
  await page.click(`[data-view="today"] .ql[data-card="${k}"]`).catch(e => log('nocard', k));
  await settle(page, 700);
  log(`--- card ${k} sheet:`, JSON.stringify(await L.topText(page)));
  await shot(page, `p01-card-${k}`);
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await settle(page, 300);
}
await L.plus(page);
log('--- plus:', JSON.stringify(await L.topText(page)));
await shot(page, 'p01-plus');
await page.keyboard.press('Escape'); await L.waitNoLayers(page);
for (const t of ['timeline', 'stash', 'memories']) { await L.tab(page, t); log(`--- ${t}:`, JSON.stringify(await L.viewText(page, t))); await shot(page, `p01-${t}-empty`); }
log('errors', L.errors);
await L.close();
