// SW update path: install v2.0.0, deploy a new release (new CACHE_NAME + changed file), reopen: does the new code arrive, offline too?
import { chromium, instrument } from './v1lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const DIR = process.env.SWDIR; const URL0 = process.env.SWURL;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
let page = await context.newPage(); instrument(page);
await page.goto(URL0); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
// "deploy": bump cache + change the description meta + a CSS token
writeFileSync(`${DIR}/sw.js`, readFileSync(`${DIR}/sw.js`, 'utf8').replace("nurture-v2.0.0", 'nurture-v2.0.1'));
writeFileSync(`${DIR}/index.html`, readFileSync(`${DIR}/index.html`, 'utf8').replace('<title>Nurture</title>', '<title>Nurture NEW</title>'));
await page.close();
page = await context.newPage(); instrument(page);
await page.goto(URL0); await page.waitForSelector('[data-view="today"]');
console.log('1st reopen title:', await page.title());
await page.waitForTimeout(3000);
console.log('caches after update:', await page.evaluate(async () => caches.keys()));
await context.setOffline(true);
await page.reload(); await page.waitForSelector('[data-view="today"]');
console.log('offline after update title:', await page.title(), 'errors', page.errors);
await context.close(); await browser.close();
