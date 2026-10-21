// Toast replaced by another toast: does the old one exit (fade/drop) or blink out?
import { launch, freshApp } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('#tabBar button:has-text("Timeline")'); await page.waitForTimeout(800);
const del = async () => { await page.click('[data-view="timeline"] .row[data-event-id]'); await page.waitForTimeout(700); await page.click('.sheet-layer:last-child button:has-text("Delete")'); };
await del(); await page.waitForTimeout(1200);
const rec = page.evaluate(() => new Promise((res) => { const out = []; const t0 = performance.now(); const tick = () => { const t = Math.round(performance.now() - t0); const sheet = document.querySelector('.sheet-layer'); out.push(`${t}: sheet=${sheet ? sheet.dataset.state : '-'} ` + [...document.querySelectorAll('#toastRoot .toast')].map((x) => { const r = x.getBoundingClientRect(); return `"${x.textContent.trim().replace(/\s+/g, ' ').slice(0, 22)}" y${Math.round(r.y)} op${(+getComputedStyle(x).opacity).toFixed(2)}`; }).join(' | ')); if (t < 1600) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); }));
await page.waitForTimeout(30); await del();
let prev = ''; for (const f of await rec) { const k = f.replace(/^\d+: /, ''); if (k !== prev) console.log(f); prev = k; }
await context.close(); await browser.close();
