// A v1 tab is still open (holds NurtureDB v1 and ignores versionchange, like the old app) when the v2 app opens.
import { chromium, mod, OUT, seedV1, instrument } from './v1lib.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const old = await context.newPage(); instrument(old);
await seedV1(old);
await old.evaluate(() => new Promise((res) => { const r = indexedDB.open('NurtureDB', 1); r.onsuccess = () => { window.__v1db = r.result; res(); }; }));
const page = await context.newPage(); instrument(page);
const t0 = Date.now();
await page.goto(mod('/'));
await page.waitForTimeout(8000);
const state = await page.evaluate(() => ({ view: (document.querySelector('[data-view]') || {}).dataset?.view || null, chrome: document.body.dataset.chrome, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300) }));
console.log('after 8s with v1 tab open:', JSON.stringify(state));
await page.screenshot({ path: `${OUT}/d15-blocked.png` });
console.log('errors', page.errors.filter((e) => !/Service Worker/.test(e)));
await old.evaluate(() => window.__v1db.close());
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/d15-after-unblock.png` }); console.log('notice el:', await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /Still opening/.test(e.textContent)).map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName}#${e.id}.${e.className} hidden=${e.hidden} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op=${getComputedStyle(e).opacity} vis=${getComputedStyle(e).visibility}`; }))); console.log('after v1 tab closes its db:', JSON.stringify(await page.evaluate(() => ({ view: (document.querySelector('[data-view]') || {}).dataset?.view || null, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120) }))));
await context.close(); await browser.close();
