// QA round 1 (motion / a11y / visual) — shared probe helpers.
// BASE_URL=http://127.0.0.1:8347 node tests/e2e/probes/qa/<probe>.mjs
import { mkdirSync } from 'node:fs';

export const { chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.mjs');
export const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8347').replace(/\/$/, '');
export const OUT = process.env.QA_OUT || '/tmp/claude-0/-home-user-NurtureBabyTracker/b749b7e7-0688-5846-9543-9190787a56a8/scratchpad/qa';
mkdirSync(OUT, { recursive: true });
export const mod = (p) => `${BASE_URL}${p}`;

export async function launch() { return chromium.launch(); }

/** Fresh context on the phone viewport, onboarded with a baby called Clara. */
export async function freshApp(browser, { theme = 'light', reduced = false, video = false, seed = true, dsf = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf, hasTouch: true, isMobile: true,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    serviceWorkers: 'block',
    ...(video ? { recordVideo: { dir: `${OUT}/video`, size: { width: 390, height: 844 } } } : {}),
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-view="today"]');
  if (seed) {
    await page.evaluate(async ([s, st]) => {
      const { settings } = await import(s);
      const b = settings.activeBaby();
      const bd = new Date(Date.now() - 42 * 86400000).toISOString().slice(0, 10);
      await settings.updateBaby(b.id, { name: 'Clara', birthDate: bd });
      const { events } = await import(st);
      const m = 60000; const now = Date.now();
      await events.add({ type: 'diaper', startTime: now - 180 * m, data: { kind: 'wet' } }).catch(e => console.log('seed diaper', e.message));
      await events.add({ type: 'pump', startTime: now - 176 * m, endTime: now - 160 * m, data: { amount: 3.5, unit: 'oz', storedTo: 'fridge' } }).catch(e => console.log('seed pump', e.message));
      await events.add({ type: 'feed', startTime: now - 130 * m, endTime: now - 112 * m, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } }).catch(e => console.log('seed feed', e.message));
    }, [mod('/js/core/settings.js'), mod('/js/core/store.js')]);
  }
  await page.waitForTimeout(600);
  return { context, page };
}

export async function setTheme(page, theme) {
  await page.evaluate(async ([s, t]) => { const { settings } = await import(s); await settings.set('theme', t); }, [mod('/js/core/settings.js'), theme]);
  await page.waitForTimeout(900);
}

export const startEvent = (page, type, data, agoMin = 5) => page.evaluate(async ([u, t, d, ago]) => {
  const { events } = await import(u);
  return (await events.start(t, d, { startTime: Date.now() - ago * 60000 })).id;
}, [mod('/js/core/store.js'), type, data, agoMin]);

export const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Sample a rect of selector every frame for ms; returns [{t, r, op, vis}] */
export async function sampleFrames(page, selector, ms = 700, extra = null) {
  return page.evaluate(([sel, ms, extra]) => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const tick = () => {
      const t = Math.round(performance.now() - t0);
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const row = { t, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), op: cs.opacity, tf: cs.transform === 'none' ? '' : cs.transform.slice(0, 60), clip: cs.clipPath === 'none' ? '' : cs.clipPath.slice(0, 50) };
        if (extra) { const e = document.querySelector(extra); if (e) { const er = e.getBoundingClientRect(); row.ex = `${Math.round(er.x)},${Math.round(er.y)},${Math.round(er.width)}x${Math.round(er.height)} op${getComputedStyle(e).opacity}`; } }
        out.push(row);
      } else out.push({ t, gone: true });
      if (t < ms) requestAnimationFrame(tick); else res(out);
    };
    requestAnimationFrame(tick);
  }), [selector, ms, extra]);
}

export const activeDesc = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'BODY';
  const label = a.getAttribute('aria-label') || (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${a.tagName.toLowerCase()}${a.dataset.action ? `[action=${a.dataset.action}]` : ''} "${label}"`;
});
