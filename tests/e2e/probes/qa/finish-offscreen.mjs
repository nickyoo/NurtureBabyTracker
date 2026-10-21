// #6: Finish while the row is NOT on screen (Stash tab) should shrink into the Today tab icon (+ one-shot dot).
// #9 delete: deleting from the entry sheet collapses the row, then the Undo toast rises.
import { launch, freshApp, startEvent, shot } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await startEvent(page, 'sleep', { kind: 'nap' }, 30); await page.waitForTimeout(900);
await page.click('#tabBar button:has-text("Stash")'); await page.waitForTimeout(800);
const samp = (ms) => page.evaluate((ms) => new Promise((res) => { const out = []; const t0 = performance.now(); const tick = () => { const t = Math.round(performance.now() - t0); const p = document.querySelector('#livePills .lpill'); const todayTab = document.querySelector('#tabBar [data-tab="today"]'); const dot = todayTab && todayTab.querySelector('.tab-dot, .dot, [class*="dot"]'); out.push(`${t}: pill=${p ? (() => { const r = p.getBoundingClientRect(); const cs = getComputedStyle(p); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op${(+cs.opacity).toFixed(2)}`; })() : 'gone'} todayTab=${todayTab ? [...todayTab.classList].join('.') : '-'} dot=${dot ? getComputedStyle(dot).opacity : '-'}`); if (t < ms) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); }), ms);
const s = samp(900); await page.waitForTimeout(30);
await page.click('#livePills .lpill .lpill-finish');
let prev = ''; for (const f of await s) { const k = f.replace(/^\d+: /, ''); if (k !== prev) console.log(f); prev = k; }
const tab = await page.$eval('#tabBar [data-tab="today"]', (t) => t.getBoundingClientRect()).catch(() => null);
console.log('today tab rect', JSON.stringify(tab));
await context.close(); await browser.close();
