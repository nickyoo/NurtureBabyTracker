// Which step makes the running nap's pill disappear?
import { launch, freshApp, startEvent, shot, mod } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await startEvent(page, 'sleep', { kind: 'nap' }, 40); await page.waitForTimeout(800);
const st = async (l) => console.log(l.padEnd(34), JSON.stringify(await page.evaluate(async (u) => { const { events } = await import(u); const r = await events.query({ running: true }); return { pills: [...document.querySelectorAll('#livePills .lpill')].map(p => p.dataset.kind), running: r.map(e => e.type + ':' + (e.data.method || e.data.kind)), layers: document.querySelectorAll('.sheet-layer').length }; }, mod('/js/core/store.js'))));
await st('start');
for (const card of ['feed', 'sleep', 'diaper', 'pump']) {
  await page.click(`.ql[data-card="${card}"]`); await page.waitForTimeout(700); await st(`open ${card} card`);
  if (card === 'sleep') await shot(page, 'sleep-card-sheet');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600); await st(`esc ${card}`);
}
await page.click('#fab'); await page.waitForTimeout(800);
await page.click('.sheet-quicklog [data-when]'); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(500); await st('after time picker esc');
const keys = await page.$$eval('.sheet-quicklog [data-key]', bs => bs.map(b => b.dataset.key)); console.log('tile keys', keys);
await page.click('.sheet-quicklog [data-key="breastfeed"], .sheet-quicklog [data-key="breast"]').catch(e => console.log('no bf tile')); await page.waitForTimeout(800); await st('after breastfeed tile'); await shot(page, 'bf-after');
await page.keyboard.press('Escape'); await page.waitForTimeout(600); await st('esc');
await context.close(); await browser.close();
