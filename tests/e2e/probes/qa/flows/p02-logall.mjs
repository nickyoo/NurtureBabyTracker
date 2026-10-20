// Log every type (cards + the +), then dump Today / Timeline / Stash copy in oz and mL.
import * as L from './lib.mjs';
const { log, settle, shot, TOP, MIN } = L;
await L.launch();
const T0 = new Date('2026-10-20T10:30:00Z').getTime();
const { page } = await L.fresh({ time: T0 });
await L.onboard(page, { photo: true });
const step = async (name, fn) => { try { await fn(); log('ok', name); } catch (e) { log('FAIL', name, e.message.split('\n')[0]); await shot(page, `p02-fail-${name}`); await page.keyboard.press('Escape').catch(()=>{}); await L.waitNoLayers(page); } };

await step('bottle formula 4oz via +', async () => {
  await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 400);
  await page.click(`${TOP} [data-seg] [role="radio"]:has-text("Formula")`).catch(()=>{});
  await page.click(`${TOP} [data-preset]:has-text("4 oz")`);
  log('  bottle sheet:', JSON.stringify(await L.topText(page)));
  await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000);
});
await page.clock.fastForward(10 * MIN);
await step('bottle breast milk 3oz via card', async () => {
  await page.click('[data-view="today"] .ql[data-card="feed"]'); await L.openTop(page, '.sheet-feed'); await settle(page, 400);
  log('  card feed sheet:', JSON.stringify(await L.topText(page)).slice(0, 200));
  await page.click(`${TOP} [role="radio"]:has-text("Breast milk")`);
  await page.click(`${TOP} [data-preset]:has-text("2 oz")`);
  await page.click(`${TOP} [data-inc]`); await page.click(`${TOP} [data-inc]`);
  log('  amount now:', await page.textContent(`${TOP} [data-stepper]`).catch(()=>'?'));
  await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000);
});
await page.clock.fastForward(10 * MIN);
await step('breastfeed L, switch, pause, finish', async () => {
  await L.tile(page, 'breast'); await L.openTop(page, '.sheet-feed'); await settle(page, 400);
  log('  breast sheet:', JSON.stringify(await L.topText(page)));
  await page.click(`${TOP} [data-side="left"]`); await page.waitForSelector(`${TOP} [data-finish]`);
  await page.clock.fastForward(5 * MIN); await settle(page, 300);
  log('  live breast:', JSON.stringify(await L.topText(page)));
  await shot(page, 'p02-breast-live');
  await page.click(`${TOP} [data-side="right"]`); await settle(page, 300);
  await page.clock.fastForward(4 * MIN); await settle(page, 300);
  await page.click(`${TOP} [data-pause]`); await settle(page, 300);
  log('  paused:', JSON.stringify(await L.topText(page)));
  await page.clock.fastForward(3 * MIN); await settle(page, 300);
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await settle(page, 400);
  log('  pill:', JSON.stringify(await page.innerText('#livePills').catch(()=>'')));
  await shot(page, 'p02-breast-paused-pill');
  await page.click('#livePills .lpill .lpill-finish'); await settle(page, 700); // Resume?
  log('  after pill btn:', JSON.stringify(await page.innerText('#livePills').catch(()=>'')), 'layers', await page.$$eval('.sheet-layer', l=>l.length));
  await page.clock.fastForward(2 * MIN); await settle(page, 300);
  if (!(await page.$(`${TOP} [data-finish]`))) { await page.click('#livePills .lpill'); await L.openTop(page, '.sheet-feed'); await settle(page, 500); }
  await page.click(`${TOP} [data-finish]`); await L.waitNoLayers(page, 5000);
});
await L.dismissToast(page);
const feeds = await L.q(page, { type: 'feed' });
log('feeds:', JSON.stringify(feeds.map(f => [f.data, f.endTime - f.startTime])));
await page.clock.fastForward(10 * MIN);
await step('pump timer 15m → freezer', async () => {
  await page.click('[data-view="today"] .ql[data-card="pump"]'); await L.openTop(page, '.sheet-pump'); await settle(page, 400);
  await page.click(`${TOP} [data-start]`); await page.waitForSelector(`${TOP} [data-finish]`);
  await page.clock.fastForward(15 * MIN); await settle(page, 300);
  await page.click(`${TOP} [data-finish]`); await page.waitForSelector(`${TOP} [data-amount]`); await settle(page, 500);
  log('  how much:', JSON.stringify(await L.topText(page)));
  await page.click(`${TOP} [data-places] [data-value="freezer"]`);
  await page.click(`${TOP} [data-finish]`); await L.waitNoLayers(page, 5000);
});
await step('past pump', async () => {
  await L.tile(page, 'pump'); await L.openTop(page, '.sheet-pump'); await settle(page, 400);
  await page.click(`${TOP} [data-past]`); await settle(page, 600);
  log('  past pump:', JSON.stringify(await L.topText(page)));
  await shot(page, 'p02-past-pump');
  await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000);
});
await step('nap start/stop via card', async () => {
  await page.click('[data-view="today"] .ql[data-card="sleep"]'); await L.openTop(page, '.sheet-sleep'); await settle(page, 400);
  await page.click(`${TOP} [data-start]`); await settle(page, 700);
  await page.keyboard.press('Escape'); await L.waitNoLayers(page); await settle(page, 400);
  await page.clock.fastForward(40 * MIN); await settle(page, 400);
  log('  sleep card running:', JSON.stringify(await page.innerText('[data-view="today"] .ql[data-card="sleep"]')));
  await page.click('[data-view="today"] .ql[data-card="sleep"]'); await settle(page, 800);
  log('  after card tap: layers', await page.$$eval('.sheet-layer', l=>l.length), JSON.stringify(await L.topText(page)), 'toast', await L.toastText(page));
  if (await page.$('.sheet-layer')) { await page.click(`${TOP} [data-finish]`).catch(()=>{}); await L.waitNoLayers(page, 5000); }
});
await L.dismissToast(page);
await step('past sleep', async () => {
  await L.tile(page, 'sleep'); await L.openTop(page, '.sheet-sleep'); await settle(page, 400);
  await page.click(`${TOP} [data-past]`); await settle(page, 600);
  log('  past sleep:', JSON.stringify(await L.topText(page)));
  await shot(page, 'p02-past-sleep');
  await page.click(`${TOP} [data-log]`); await L.waitNoLayers(page, 5000);
});
await step('diaper both + details', async () => {
  await L.plus(page); await page.click('.sheet-quicklog .dbtn[data-diaper="both"]'); await L.waitNoLayers(page);
  await page.waitForSelector('#toastRoot .toast[data-state="in"]'); log('  toast:', await L.toastText(page));
  await settle(page, 200); await page.click('#toastRoot .toast-action-2'); await L.openTop(page, '.sheet-diaper'); await settle(page, 500);
  log('  details:', JSON.stringify(await L.topText(page)));
  await shot(page, 'p02-diaper-details');
  const btns = await page.$$(`${TOP} [data-details] [role="radio"], ${TOP} [data-details] button[aria-pressed]`);
  if (btns[0]) await btns[0].click();
  await page.click(`${TOP} [data-save]`); await L.waitNoLayers(page, 5000);
});
await L.dismissToast(page);
await step('memory with photo', async () => {
  await L.tile(page, 'memory'); await L.openTop(page, '.sheet-memory'); await settle(page, 400);
  await page.fill(`${TOP} [data-title]`, 'First smile');
  await page.setInputFiles(`${TOP} [data-pick]`, await L.photoPng(page, 200));
  await settle(page, 1500);
  await page.click(`${TOP} [data-save]`); await L.waitNoLayers(page, 5000);
});
await settle(page, 800);
log('\nTODAY oz:', JSON.stringify(await L.viewText(page, 'today')));
await shot(page, 'p02-today-oz');
await page.evaluate(() => document.querySelector('#viewport > [data-view="today"]').scrollTo(0, 2000)); await shot(page, 'p02-today-oz-list');
await L.tab(page, 'timeline'); log('\nTIMELINE oz:', JSON.stringify(await L.viewText(page, 'timeline'))); await shot(page, 'p02-timeline-oz');
await L.tab(page, 'stash'); log('\nSTASH oz:', JSON.stringify(await L.viewText(page, 'stash'))); await shot(page, 'p02-stash-oz');
await L.setSetting(page, 'units', 'mL'); await settle(page, 800);
log('\nSTASH mL:', JSON.stringify(await L.viewText(page, 'stash'))); await shot(page, 'p02-stash-ml');
await L.tab(page, 'timeline'); log('\nTIMELINE mL:', JSON.stringify(await L.viewText(page, 'timeline'))); await shot(page, 'p02-timeline-ml');
await L.tab(page, 'today'); log('\nTODAY mL:', JSON.stringify(await L.viewText(page, 'today'))); await shot(page, 'p02-today-ml');
await L.plus(page); log('\nPLUS mL:', JSON.stringify(await L.topText(page))); await page.keyboard.press('Escape'); await L.waitNoLayers(page);
log('errors', L.errors);
await L.close();
