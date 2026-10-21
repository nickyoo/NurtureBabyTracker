// Page-behind scale (DESIGN §6.6 / #1) and tap-target audit of the live pill + toast.
import { launch, freshApp, startEvent } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('.ql[data-card="diaper"]'); await page.waitForTimeout(700);
console.log('behind while card sheet open:', JSON.stringify(await page.evaluate(() => { const a = document.getElementById('app'); const v = document.querySelector('#viewport > section:not([hidden])'); return { app: getComputedStyle(a).transform, appScale: getComputedStyle(a).scale, view: getComputedStyle(v).transform, viewScale: getComputedStyle(v).scale, cls: a.className }; })));
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 3); await page.waitForTimeout(900);
console.log('pill targets:', JSON.stringify(await page.$$eval('#livePills button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return `${b.className} ${Math.round(r.width)}x${Math.round(r.height)}`; }))));
console.log('pill group:', JSON.stringify(await page.$$eval('#livePills .lpill', (ps) => ps.map((p) => ({ role: p.getAttribute('role'), label: p.getAttribute('aria-label') })))));
await context.close(); await browser.close();
