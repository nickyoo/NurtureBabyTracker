// New phone: onboarding "I have a backup file" with a twins backup (2 babies). What does Today show?
import { chromium, mod, OUT, instrument } from './v1lib.mjs';
const now = Date.now();
const file = { app: 'nurture', schema: 2, exportedAt: new Date().toISOString(),
  events: [
    { id: 'evt_t1', type: 'feed', startTime: now - 2 * 3600000, endTime: now - 2 * 3600000 + 600000, data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' }, babyId: 'baby_ava', createdAt: now, updatedAt: now },
    { id: 'evt_t2', type: 'diaper', startTime: now - 3600000, endTime: now - 3600000, data: { kind: 'wet' }, babyId: 'baby_ben', createdAt: now, updatedAt: now },
  ], inventory: [],
  settings: { babies: [{ id: 'baby_ava', name: 'Ava', birthDate: '2026-09-01', photoId: null }, { id: 'baby_ben', name: 'Ben', birthDate: '2026-09-01', photoId: null }], activeBabyId: 'baby_ava', units: 'mL' } };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await context.newPage(); instrument(page);
await page.goto(mod('/')); await page.waitForSelector('[data-view="onboarding"]');
await page.screenshot({ path: `${OUT}/d14-onb-start.png` });
const hasRestore = await page.$('[data-action="restore"]');
console.log('restore button on first step:', !!hasRestore);
if (!hasRestore) { await page.click('[data-action="start"]').catch(() => {}); await page.waitForTimeout(800); }
const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), page.click('[data-action="restore"]').catch((e) => console.log('restore click', e.message.slice(0, 80)))]);
if (chooser) await chooser.setFiles({ name: 'twins.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
else await page.setInputFiles('[data-restore-input]', { name: 'twins.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
await page.waitForSelector('[data-view="today"]', { timeout: 10000 }).catch(() => console.log('no today'));
await page.waitForTimeout(1500);
console.log('toast', await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.innerText.split('\n')[0])));
console.log('today:', (await page.$eval('#viewport', (v) => v.innerText.replace(/\s+/g, ' '))).slice(0, 300));
const st = await page.evaluate(async (s) => { const S = await import(s); return { babies: S.get('babies').map((b) => `${b.id}:${b.name || '(unnamed)'}`), active: S.get('activeBabyId'), units: S.get('units') }; }, mod('/js/core/settings.js'));
console.log('settings', JSON.stringify(st));
await page.screenshot({ path: `${OUT}/d14-after-restore.png` });
await context.close(); await browser.close();
