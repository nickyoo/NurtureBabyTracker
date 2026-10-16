// e2e: the component gallery (tests/e2e/fixtures/gallery.html) — the final
// mockup frames rebuilt from the PRODUCTION css/ + js/ui modules. For each
// frame, light and dark, at 390×844 with the reference iPhone's safe areas:
//  - saves docs/design/build/gallery-<frame>-<theme>.png to compare with
//    docs/design/final/frame-*.png;
//  - asserts the design-system audits from docs/design/tools/render.mjs:
//    every interactive element ≥ 44×44, no text under 12px, no horizontal
//    overflow, zero console errors / CSP violations / foreign requests.
//
// Just this:  BASE_URL=http://127.0.0.1:8123 node tests/e2e/gallery.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });

const FRAMES = ['today', 'quicklog', 'timeline', 'stash', 'memories', 'customize'];

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
    await context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    for (const frame of FRAMES) {
      console.log(`\n${frame} (${theme})`);
      const page = await context.newPage();
      const errors = [];
      const foreign = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== ORIGIN) foreign.push(u); });
      await page.goto(`${BASE_URL}/tests/e2e/fixtures/gallery.html?frame=${frame}&theme=${theme}`);
      await page.waitForFunction(() => document.documentElement.dataset.galleryReady === 'true', null, { timeout: 10000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(frame === 'quicklog' ? 900 : 500); // let enter transitions settle
      await page.screenshot({ path: `${SHOTS}gallery-${frame}-${theme}.png` });

      const audit = await page.evaluate(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[inert]') && r.bottom > 0 && r.top < innerHeight; };
        const small = [...document.querySelectorAll('button, a[href], input, [role="switch"], [role="tab"]')]
          .filter((el) => visible(el) && !el.classList.contains('sr-only-focusable') && !el.closest('[aria-hidden="true"]'))
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; })
          .map((el) => `${el.className || el.tagName} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
        const tiny = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim() || !n.parentElement || !visible(n.parentElement)) continue;
          if (n.parentElement.closest('svg, .sr-only')) continue;
          const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
          if (fs < 12) tiny.push(`${n.textContent.trim().slice(0, 20)} ${fs}px`);
        }
        const overflow = document.documentElement.scrollWidth > innerWidth
          || [...document.querySelectorAll('.view')].some((v) => v.scrollWidth > v.clientWidth + 1);
        return { small, tiny, overflow, csp: window.__csp };
      });
      check('targets ≥ 44×44', audit.small.length === 0, audit.small.join(', '));
      check('no text under 12px', audit.tiny.length === 0, audit.tiny.join(', '));
      check('no horizontal overflow', !audit.overflow);
      check('zero console errors/warnings', errors.length === 0, errors.join(' | '));
      check('zero CSP violations', audit.csp.length === 0, audit.csp.join(' | '));
      check('zero foreign requests', foreign.length === 0, foreign.join(' | '));
      await page.close();
    }
    await context.close();
  }

  // Router edge case: hiding the CURRENT tab while a pushed screen (Settings
  // → Customize) is open keeps the screen and swaps Today in underneath.
  console.log('\nrouter: hide the current tab from a pushed screen');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE_URL}/tests/e2e/fixtures/gallery.html?frame=stash`);
  await page.waitForFunction(() => document.documentElement.dataset.galleryReady === 'true');
  await page.evaluate(() => window.__gallery.router.push('customize'));
  await page.waitForTimeout(600);
  check('the covered tab is hidden once the push lands', await page.evaluate(() => getComputedStyle(document.querySelector('[data-view="stash"]')).visibility === 'hidden'));
  await page.evaluate(() => window.__gallery.setTrackers({ stash: false }));
  await page.waitForTimeout(100);
  check('the screen stays open', await page.evaluate(() => !!document.querySelector('[data-view="customize"]') && document.body.dataset.chrome === 'screen'));
  check('the hidden tab is replaced by Today underneath', await page.evaluate(() => !document.querySelector('[data-view="stash"]') && !!document.querySelector('[data-view="today"].is-covered') && !document.querySelector('#tabBar [data-tab="stash"]')));
  await page.evaluate(() => window.__gallery.router.back());
  await page.waitForTimeout(600);
  check('Back lands on Today (revealed, current)', await page.evaluate(() => !document.querySelector('[data-view="customize"]')
    && getComputedStyle(document.querySelector('[data-view="today"]')).visibility === 'visible'
    && !!document.querySelector('#tabBar [data-tab="today"][aria-current="page"]')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await context.close();
} catch (err) {
  failures.push(`crashed: ${err && err.stack}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\ngallery: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
