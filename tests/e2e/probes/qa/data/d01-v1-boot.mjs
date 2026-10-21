// Boot the real app on a v1 profile and walk every screen; dump visible text + screenshots.
import { chromium, mod, OUT } from './v1lib.mjs';
import { seedV1, phone, watchCsp } from './v1lib.mjs';
const browser = await chromium.launch();
const { context, page } = await phone(browser);
await watchCsp(page);
await seedV1(page);
await page.goto(mod('/'));
await page.waitForSelector('[data-view]', { timeout: 15000 });
await page.waitForTimeout(1500);
const view = await page.$eval('[data-view]', (v) => v.dataset.view);
console.log('first view:', view);
const txt = async (label) => { const t = await page.$eval('#viewport', (v) => v.innerText.replace(/\n{2,}/g, '\n')); console.log(`---- ${label}\n${t}`); };
const pills = await page.$$eval('#livePills .lpill', (ps) => ps.map((p) => p.innerText.replace(/\s+/g, ' ')));
console.log('pills:', JSON.stringify(pills));
await page.screenshot({ path: `${OUT}/d01-today.png`, fullPage: false });
await txt('today');
for (const tab of ['timeline', 'stash', 'memories']) {
  await page.click(`#tabBar [data-tab="${tab}"]`); await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/d01-${tab}.png` });
  await txt(tab);
}
// timeline: scroll to older days
await page.click('#tabBar [data-tab="timeline"]'); await page.waitForTimeout(700);
await page.evaluate(() => { const s = document.querySelector('#viewport [data-view="timeline"]') || document.scrollingElement; s.scrollTop = 99999; window.scrollTo(0, 99999); });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/d01-timeline-bottom.png` });
const dom = await page.evaluate(() => ({ imgs: document.querySelectorAll('#viewport img').length, styleAttrs: document.querySelectorAll('[style]').length, xss: window.__xss, csp: window.__csp }));
console.log('dom', JSON.stringify(dom));
console.log('errors', JSON.stringify(page.errors), 'foreign', JSON.stringify(page.foreign));
await context.close(); await browser.close();
