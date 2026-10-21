// Full session tour with the SW on: every request's origin, CSP violations, Privacy page's live count.
import { chromium, mod, OUT, instrument, watchCsp, seedV1 } from './v1lib.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
const origins = new Map(); context.on('request', (r) => { const o = new URL(r.url()).origin; origins.set(o, (origins.get(o) || 0) + 1); });
const page = await context.newPage(); instrument(page); await watchCsp(page);
await seedV1(page);
await page.goto(mod('/')); await page.waitForSelector('[data-view="today"]'); await page.waitForTimeout(1500);
const tap = async (sel) => { try { await page.click(sel, { timeout: 2500 }); await page.waitForTimeout(700); return true; } catch { return false; } };
for (const tab of ['timeline', 'stash', 'memories', 'today']) await tap(`#tabBar [data-tab="${tab}"]`);
// every quick-log tile
await tap('#tabBar .fab, #tabBar [data-action="fab"]');
const tiles = await page.$$eval('.sheet-layer .tiles button, .sheet-layer .tile', (b) => b.map((x) => x.innerText.split('\n')[0]));
console.log('tiles', tiles);
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
for (const t of tiles) { if (/Diaper|Wet|Dirty|Both/.test(t)) continue; await tap('#tabBar .fab, #tabBar [data-action="fab"]'); await tap(`.sheet-layer button:has-text("${t}")`); await page.keyboard.press('Escape'); await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
await tap('#tabBar [data-tab="timeline"]'); await tap('#viewport button:has-text("Report for the pediatrician")'); await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/d11-report.png` });
await page.goBack(); await page.waitForTimeout(600);
await tap('#tabBar [data-tab="today"]'); await tap('[data-action="settings"], button[aria-label*="ettings"]');
const rows = await page.$$eval('#viewport [data-arg]', (b) => [...new Set(b.map((x) => x.dataset.arg))]);
console.log('settings rows', rows);
for (const r of rows) { if (await tap(`#viewport [data-arg="${r}"]`)) { await page.goBack(); await page.waitForTimeout(500); } }
await tap('#viewport [data-arg="privacy"]');
const proof = await page.$eval('#viewport .st-proof-line', (e) => e.innerText).catch(() => 'n/a');
await page.screenshot({ path: `${OUT}/d11-privacy.png` });
console.log('privacy proof line:', proof);
console.log('origins:', JSON.stringify([...origins]));
console.log('csp:', JSON.stringify(await page.evaluate(() => window.__csp)), 'xss', JSON.stringify(await page.evaluate(() => window.__xss)));
console.log('errors:', JSON.stringify(page.errors));
await context.close(); await browser.close();
