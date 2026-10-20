// Android/browser Back across onboarding, sheets, screens and tabs.
import * as L from './lib.mjs';
const { log, settle, shot, TOP } = L;
await L.launch();
const { page } = await L.fresh({ time: new Date('2026-10-20T10:30:00Z').getTime() });
const where = async () => ({ url: page.url(), view: await L.activeView(page).catch(() => '?'), step: await page.evaluate(() => { const s = document.querySelector('.ob-step:not(.is-leaving)'); return s && s.dataset.step; }).catch(() => '?'), layers: await page.$$eval('.sheet-layer', (l) => l.map((x) => x.className.replace('sheet-layer ', '')).join(',')).catch(() => '?'), hist: await page.evaluate(() => history.length).catch(() => '?') });
const back = async (label) => { await page.goBack({ timeout: 3000 }).catch(() => {}); await settle(page, 700); log(`BACK ${label} →`, JSON.stringify(await where())); };

// --- onboarding
await page.goto('about:blank');
await page.goto(`${L.BASE}/`);
await page.waitForSelector('[data-view="onboarding"] .ob-step');
await page.fill('[data-field="name"]', 'Robin');
await page.click('.ob-step:not(.is-leaving) [data-action="next"]'); await settle(page, 700);
await page.click('.ob-step:not(.is-leaving) [data-action="next"]'); await settle(page, 700);
log('onboarding at', JSON.stringify(await where()));
await shot(page, 'p04-ob-goal');
await back('from onboarding step goal');
if (!page.url().startsWith(L.BASE)) { log('  LEFT THE APP from onboarding step 3 — re-opening'); await page.goto(`${L.BASE}/`); await settle(page, 1200); log('  reopened at', JSON.stringify(await where())); }
// finish
await page.click('[data-view="onboarding"] [data-action="start"]').catch(async () => { log('no skip'); });
await page.waitForSelector('[data-view="today"]'); await settle(page, 700);
log('today', JSON.stringify(await where()));
// sheet over today
await L.plus(page); await back('quicklog open');
// nested: bottle → keypad
await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 500);
await page.click(`${TOP} [data-stepper] [role="spinbutton"], ${TOP} [data-kp-val], ${TOP} [data-amount]`).catch((e) => log('no value tap', e.message.slice(0, 60)));
await settle(page, 600); log('nested', JSON.stringify(await where()));
await back('keypad over bottle'); await back('bottle');
// settings screen
await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 700); log('settings', JSON.stringify(await where()));
const sub = await page.$$eval('[data-view="settings"] [data-view], [data-view="settings"] [data-action]', (els) => els.slice(0, 40).map((e) => (e.dataset.view || e.dataset.action) + ':' + e.textContent.trim().slice(0, 30)));
log('settings actions', JSON.stringify(sub));
await back('settings');
// timeline tab → report → back
await L.tab(page, 'timeline');
await L.clickView(page, 'timeline', '[data-action="report"]').catch((e) => log(e.message)); await settle(page, 800); log('report', JSON.stringify(await where()));
await back('report'); await back('timeline tab');
await back('today root (should leave)');
log('errors', L.errors);
await L.close();
