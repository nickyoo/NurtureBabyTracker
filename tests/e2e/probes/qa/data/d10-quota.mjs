// Storage full: every IndexedDB put/add throws QuotaExceededError (what a full phone does). What does the parent see?
import { chromium, mod, OUT, instrument } from './v1lib.mjs';
const IMG = process.env.IMGDIR;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await context.addInitScript(() => {
  window.__quotaFull = false;
  for (const m of ['put', 'add']) {
    const orig = IDBObjectStore.prototype[m];
    IDBObjectStore.prototype[m] = function (...a) { if (window.__quotaFull) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return orig.apply(this, a); };
  }
});
const page = await context.newPage(); instrument(page);
await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
await page.waitForTimeout(800);
await page.evaluate(() => { window.__quotaFull = true; });
const seen = async (label) => {
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ toasts: [...document.querySelectorAll('#toastRoot .toast')].map((t) => t.innerText.replace(/\s+/g, ' ')), sheetErr: [...document.querySelectorAll('.sheet-layer .field-error:not([hidden]), .sheet-layer [role="alert"]')].map((e) => e.innerText).filter(Boolean), sheets: document.querySelectorAll('.sheet-layer').length }));
  console.log(`${label}:`, JSON.stringify(r), 'console:', JSON.stringify(page.errors.splice(0).filter((e) => !/Service Worker/.test(e)).map((e) => e.slice(0, 120))));
  await page.screenshot({ path: `${OUT}/d10-${label}.png` });
};
// 1. one-tap wet diaper from quick log
await page.click('#tabBar .fab, #tabBar [data-action="fab"]'); await page.waitForTimeout(800);
await page.click('.sheet-layer button:has-text("Wet")'); await seen('diaper-onetap');
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
const count = await page.evaluate(async (u) => { const { events } = await import(u); return (await events.query()).length; }, mod('/js/core/store.js'));
console.log('events actually stored:', count);
// 2. start sleep from Today card +
await page.click('#viewport button[aria-label*="leep"]').catch((e) => console.log('sleep btn', e.message.slice(0, 60)));
await page.waitForTimeout(900);
const sb = page.locator('.sheet-layer button:has-text("Start")'); if (await sb.count()) { await sb.first().click(); }
await seen('sleep-start');
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
// 3. memory with photo
await page.click('#tabBar [data-tab="memories"]'); await page.waitForTimeout(700); await page.click('#viewport button:has-text("Add a memory")'); await page.waitForTimeout(800);
await page.setInputFiles('[data-pick]', `${IMG}/huge.jpg`); await seen('memory-photo');
await context.close(); await browser.close();
