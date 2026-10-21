// Huge / odd-typed backups through the real import UI: time, freeze, outcome.
import { chromium, mod, OUT, instrument } from './v1lib.mjs';
const N = +(process.env.N || 100000);
const now = Date.now();
const evs = []; for (let i = 0; i < N; i++) evs.push({ id: `evt_h${i}`, type: 'diaper', startTime: now - i * 60000 - 3600000, endTime: now - i * 60000 - 3600000, note: 'n'.repeat(100), data: { kind: 'wet' }, babyId: 'baby_h', createdAt: now, updatedAt: now });
const big = JSON.stringify({ app: 'nurture', schema: 2, events: evs, inventory: [], settings: { babies: [{ id: 'baby_h', name: 'Huge', birthDate: null, photoId: null }] } });
const cases = {
  huge: big,
  wrongTypes: JSON.stringify({ app: 'nurture', schema: '2', events: { a: 1 }, inventory: 'x', photos: 5, settings: [] }),
  newer: JSON.stringify({ app: 'nurture', schema: 99, events: [] }),
  notJson: '{"app":"nurture",',
  arrayRoot: '[1,2,3]',
  deep: '{"app":"nurture","schema":2,"events":' + '['.repeat(200000) + ']'.repeat(200000) + '}',
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await context.newPage(); instrument(page);
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.evaluate(async (u) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: Date.now() - 60000, data: { kind: 'dirty' } }); }, mod('/js/core/store.js'));
await page.click('[data-action="settings"], button[aria-label*="ettings"]'); await page.waitForTimeout(700); await page.click('[data-arg="data"]'); await page.waitForTimeout(700);
for (const [name, text] of Object.entries(cases)) {
  if (process.env.ONLY && process.env.ONLY !== name) continue;
  for (const mode of ['merge', 'replace']) {
    await page.setInputFiles('[data-import]', { name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForTimeout(800);
    const t0 = Date.now();
    // measure main-thread stalls while importing
    await page.evaluate(() => { window.__maxGap = 0; let last = performance.now(); window.__gapTimer = setInterval(() => { const n = performance.now(); window.__maxGap = Math.max(window.__maxGap, n - last); last = n; }, 50); });
    await page.click(`[data-choice="${mode}"]`);
    if (mode === 'replace') { await page.waitForTimeout(900); await page.click('.sheet-layer button:has-text("Replace everything")').catch(() => {}); }
    await page.waitForFunction(() => document.querySelector('#toastRoot .toast') || [...document.querySelectorAll('.sheet-layer [data-error]')].some((e) => !e.hidden), null, { timeout: 120000 }).catch(() => {});
    const r = await page.evaluate(() => { clearInterval(window.__gapTimer); return { gap: Math.round(window.__maxGap), toast: [...document.querySelectorAll('#toastRoot .toast')].map((t) => t.innerText.split('\n')[0]), err: [...document.querySelectorAll('.sheet-layer [data-error]')].filter((e) => !e.hidden).map((e) => e.innerText) }; });
    const n = await page.evaluate(async (u) => { const { events } = await import(u); return (await events.query()).length; }, mod('/js/core/store.js'));
    console.log(name, mode, `${Date.now() - t0}ms`, 'max main-thread stall', `${r.gap}ms`, JSON.stringify(r.toast), JSON.stringify(r.err), 'events now', n);
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelectorAll('#toastRoot .toast').forEach((t) => t.remove()));
    if (name === 'huge' && mode === 'merge') break;
  }
}
console.log('errors', page.errors.filter((e) => !/Service Worker/.test(e)).map((e) => e.slice(0, 150)));
await context.close(); await browser.close();
