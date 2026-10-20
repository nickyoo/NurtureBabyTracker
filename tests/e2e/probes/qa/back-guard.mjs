// Back-button guard: from the Timeline tab, after a sheet, Back should go to Today, not leave the app.
import { launch, freshApp } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
const st = async (label) => console.log(label.padEnd(36), JSON.stringify(await page.evaluate(() => ({ url: location.href, hist: history.length, state: history.state, layers: document.querySelectorAll('.sheet-layer').length, view: [...document.querySelectorAll('#viewport > section')].filter(s => !s.hidden).map(s => s.dataset.view) }))));
await st('start');
await page.click('#tabBar :is(button,a):has-text("Timeline")'); await page.waitForTimeout(600); await st('timeline');
await page.click('.row[data-event-id]'); await page.waitForTimeout(600); await st('row sheet open');
const btns = await page.$$eval('.sheet-layer:last-child button', bs => bs.map(b => b.textContent.trim().replace(/\s+/g, ' ')));
console.log('sheet buttons', btns);
await page.click('.sheet-layer:last-child button:has-text("Delete")'); await page.waitForTimeout(700); await st('after Delete');
await page.goBack(); await page.waitForTimeout(700); await st('back 1');
await page.goBack().catch(e => console.log('goBack err', e.message)); await page.waitForTimeout(700); await st('back 2').catch(e => console.log('back 2: page gone', page.url()));
await context.close(); await browser.close();
