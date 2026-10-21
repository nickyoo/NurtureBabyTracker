// Two tabs on one profile: log in A, does B update (immediately / after it becomes visible)?
import { chromium, mod, OUT, instrument } from './v1lib.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const A = await context.newPage(); instrument(A);
await A.goto(mod('/')); await A.waitForSelector('[data-action="start"]'); await A.click('[data-action="start"]'); await A.waitForSelector('[data-view="today"]');
const B = await context.newPage(); instrument(B);
await B.goto(mod('/')); await B.waitForSelector('[data-view="today"]'); await B.waitForTimeout(800);
const card = (p, label) => p.$eval('#viewport', (v, l) => { const c = [...v.querySelectorAll('button, [role="button"], article, section')].find((x) => x.innerText.trim().startsWith(l)); return c ? c.innerText.replace(/\s+/g, ' ').slice(0, 80) : 'none'; }, label);
const pills = (p) => p.$$eval('#livePills .lpill', (ps) => ps.map((x) => x.dataset.kind));
const visible = (p) => p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
console.log('B diaper before:', await card(B, 'Diaper'));
// A: log a wet diaper via the real UI (Today diaper card +)
await A.bringToFront();
await A.evaluate(async (u) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: Date.now() - 60000, data: { kind: 'wet' } }); await events.start('sleep', { kind: 'nap' }, { startTime: Date.now() - 20 * 60000 }); }, mod('/js/core/store.js'));
await A.waitForTimeout(800);
console.log('A diaper:', await card(A, 'Diaper'), 'A pills', await pills(A));
await B.bringToFront(); await B.waitForTimeout(800);
console.log('B diaper after bringToFront (no event):', await card(B, 'Diaper'), 'B pills', await pills(B));
await visible(B); await B.waitForTimeout(1000);
console.log('B diaper after visibilitychange:', await card(B, 'Diaper'), 'B pills', await pills(B));
await B.screenshot({ path: `${OUT}/d03-B-after-visible.png` });
// stash: A adds pouch; B on stash tab, made visible
await B.click('#tabBar [data-tab="stash"]').catch(() => console.log('no stash tab in B'));
await B.waitForTimeout(600);
await A.evaluate(async (u) => { const { stash } = await import(u); await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: Date.now() - 3600000 }); }, mod('/js/core/stash.js'));
await visible(B); await B.waitForTimeout(1000);
console.log('B stash after A add + visible:', (await B.$eval('#viewport', (v) => v.innerText.replace(/\s+/g, ' '))).slice(0, 120));
// A finishes the sleep; B (stale pill?) taps Finish too
await A.evaluate(async (u) => { const { events } = await import(u); const r = await events.running('sleep'); await events.stop(r.id ?? r[0]?.id, { endTime: Date.now() - 5 * 60000 }); }, mod('/js/core/store.js'));
await visible(B); await B.waitForTimeout(800);
console.log('B pills after A stopped sleep + visible:', await pills(B));
console.log('A errors', A.errors, 'B errors', B.errors);
await context.close(); await browser.close();
