// QA round 1 probe helpers (FLOWS / DEAD CLICKS / COPY lens).
// BASE_URL=http://127.0.0.1:8361 node tests/e2e/probes/qa/flows/<probe>.mjs
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.mjs');
export const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8361').replace(/\/$/, '');
export const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
await mkdir(SHOTS, { recursive: true });
export const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const TOP = '.sheet-layer[data-state="open"]:last-of-type';
export const mod = (p) => `${BASE}${p}`;
export const errors = [];
let browser;
export async function launch() { browser = await chromium.launch(); return browser; }
export async function close() { await browser.close(); }
export async function fresh({ dark = false, time, ua, reduced = false, width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, hasTouch: true, colorScheme: dark ? 'dark' : 'light', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', acceptDownloads: true, userAgent: ua, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (time) { await page.clock.install({ time }); await page.clock.resume(); }
  return { context, page };
}
export const settle = (page, ms = 450) => page.waitForTimeout(ms);
export async function setSetting(page, k, v) { await page.evaluate(async ([u, k, v]) => { await (await import(u)).settings.set(k, v); }, [mod('/js/core/settings.js'), k, v]); }
export async function getSetting(page, k) { return page.evaluate(async ([u, k]) => (await import(u)).settings.get(k), [mod('/js/core/settings.js'), k]); }
export async function q(page, query = {}) { return page.evaluate(async ([u, qq]) => (await import(u)).events.query(qq), [mod('/js/core/store.js'), query]); }
export async function onboard(page, { name = 'Robin', born = '2026-09-02', photo = false } = {}) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-view="onboarding"] .ob-step', { timeout: 15000 });
  await setSetting(page, 'theme', 'light');
  await settle(page, 500);
  const inStep = (s) => `.ob-step:not(.is-leaving) ${s}`;
  const waitStep = async (key) => {
    await page.waitForFunction((k) => { const s = document.querySelector('.ob-step:not(.is-leaving)'); return s && s.dataset.step === k; }, key, { timeout: 4000 });
    await page.waitForFunction(() => !document.querySelector('.ob-step.is-leaving'), null, { timeout: 4000 });
  };
  await page.fill('[data-field="name"]', name);
  await page.fill('[data-field="born"]', born);
  await page.dispatchEvent('[data-field="born"]', 'change');
  if (photo) { await page.setInputFiles("[data-photo-input]", await photoPng(page)); await settle(page, 1200); }
  await page.click(inStep('[data-action="next"]')); await waitStep('feeding');
  await page.click(inStep('[data-action="next"]')); await waitStep('goal');
  await page.click(inStep('[data-action="next"]')); await waitStep('install');
  await page.click(inStep('[data-action="finish"]'));
  await page.waitForSelector('[data-view="today"]');
  await settle(page, 700);
}
export async function photoPng(page, hue = 20) {
  const b64 = await page.evaluate((h) => { const c = document.createElement('canvas'); c.width = 480; c.height = 600; const g = c.getContext('2d'); g.fillStyle = `hsl(${h} 45% 70%)`; g.fillRect(0, 0, 480, 600); g.fillStyle = `hsl(${h} 60% 90%)`; g.beginPath(); g.arc(240, 170, 80, 0, 7); g.fill(); return c.toDataURL('image/png').split(',')[1]; }, hue);
  return { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}
export async function waitNoLayers(page, t = 4000) { return page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: t }).then(() => true, () => false); }
export async function openTop(page, cls = '') { return page.waitForSelector(`.sheet-layer${cls}[data-state="open"]`, { timeout: 4000 }).then(() => true, () => false); }
export async function plus(page) { await page.click('#fab'); await page.waitForSelector('.sheet-layer.sheet-quicklog[data-state="open"] .tiles'); await settle(page, 450); }
export async function tile(page, key) { await plus(page); await page.click(`.sheet-quicklog [data-key="${key}"]`); }
export async function tab(page, t) { await page.click(`#tabBar [data-tab="${t}"]`); await page.waitForSelector(`[data-view="${t}"]`); await settle(page, 550); }
export const activeView = (page) => page.evaluate(() => { const v = [...document.querySelectorAll('#viewport > .view')].filter((s) => !s.classList.contains('is-fading-out') && !s.classList.contains('is-leaving-right')); return v.length ? v[v.length - 1].getAttribute('data-view') : null; });
export const viewText = (page, v) => page.evaluate((v) => { const l = [...document.querySelectorAll(`#viewport > [data-view="${v}"]`)].filter((x) => !x.classList.contains('is-fading-out') && !x.classList.contains('is-leaving-right')); return l.length ? l[l.length - 1].innerText : ''; }, v);
export const topText = (page) => page.evaluate(() => { const l = [...document.querySelectorAll('.sheet-layer:not([data-state="closing"])')].pop(); return l ? l.innerText : ''; });
export async function shot(page, name) { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await settle(page, 300); const p = `${SHOTS}${name}.png`; await page.screenshot({ path: p }); return p; }
export async function dismissToast(page) { await page.evaluate(() => { for (const t of document.querySelectorAll('#toastRoot .toast')) t.remove(); }); }
export async function toastText(page) { return page.evaluate(() => [...document.querySelectorAll('#toastRoot .toast')].map((t) => t.innerText).join(' || ')); }
/** Click inside the topmost live view. */
export async function clickView(page, view, sel) {
  const ok = await page.evaluate(([v, s]) => { const list = [...document.querySelectorAll(`#viewport > [data-view="${v}"]`)].filter((x) => !x.classList.contains('is-leaving-right') && !x.classList.contains('is-fading-out')); const el = list.length ? list[list.length - 1].querySelector(s) : null; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; }, [view, sel]);
  if (!ok) throw new Error(`no ${sel} in ${view}`);
}
export const log = (...a) => console.log(...a);
