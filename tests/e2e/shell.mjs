// e2e: the v2 shell (index.html + js/app.js + js/ui/*) on a FRESH profile at
// 390×844. Asserts the privacy promise (zero console errors, zero CSP
// violations, zero requests to any other origin) and the foundation
// contracts the screen teams build on: onboarding root, tabs with
// aria-current, the + → quick-log sheet (Esc closes, focus returns), back
// gesture order, live pills on every tab with a registered finisher, Undo
// toast, confirmSheet, tracker-hidden tabs, reduce-motion. Saves light/dark
// screenshots to docs/design/build/shell-*.png for comparison with
// docs/design/final/*.png.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/shell.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
// Record CSP violations from the very first script.
await context.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await context.newPage();
const consoleErrors = [];
const foreign = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith('data:') || u.startsWith('blob:')) return;
  if (new URL(u).origin !== ORIGIN) foreign.push(u);
});

const mod = (path) => `${BASE_URL}${path}`;
const settle = (ms = 450) => page.waitForTimeout(ms);
const activeView = () => page.evaluate(() => {
  const v = [...document.querySelectorAll('#viewport > .view')].filter((s) => !s.classList.contains('is-fading-out') && !s.classList.contains('is-leaving-right'));
  return v.length ? v[v.length - 1].getAttribute('data-view') : null;
});
const openLayers = () => page.evaluate(() => document.querySelectorAll('.sheet-layer:not([data-state="closing"])').length);
const allLayers = () => page.evaluate(() => document.querySelectorAll('.sheet-layer').length);
const focusedId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
const currentTab = () => page.evaluate(() => {
  const cur = document.querySelectorAll('#tabBar [aria-current="page"]');
  return [...cur].map((b) => b.getAttribute('data-tab')).join(',');
});
async function waitClosed() {
  await page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 3000 }).catch(() => {});
}
async function setSetting(key, value) {
  await page.evaluate(async ([url, k, v]) => { const { settings } = await import(url); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}

try {
  // ---------------------------------------------------------------- boot
  console.log('\nboot + onboarding');
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
  check('fresh profile lands on onboarding', await activeView() === 'onboarding');
  check('onboarding hides the nav (chrome = bare)', await page.evaluate(() => document.body.dataset.chrome === 'bare' && document.getElementById('tabBar').hidden));
  check('<html> has a data-theme before paint gate lifts', await page.evaluate(() => ['light', 'dark'].includes(document.documentElement.dataset.theme)));
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-view="today"]');
  await settle();
  check('Get started → Today', await activeView() === 'today');
  check('Today tab has aria-current="page"', await currentTab() === 'today');
  check('onboarded persisted', await page.evaluate(async (u) => (await import(u)).settings.get('onboarded') === true, mod('/js/core/settings.js')));
  await setSetting('theme', 'light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');

  // ---------------------------------------------------------------- tabs
  console.log('\ntabs');
  for (const t of ['timeline', 'stash', 'memories', 'today']) {
    await page.click(`#tabBar [data-tab="${t}"]`);
    await page.waitForSelector(`[data-view="${t}"]`);
    await settle(350);
    check(`tab ${t}: view shown and the only aria-current`, await activeView() === t && await currentTab() === t, `view=${await activeView()} current=${await currentTab()}`);
  }
  check('tab buttons are ≥ 44×44', await page.evaluate(() => [...document.querySelectorAll('#tabBar .tab, #fab')].every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })));

  // ------------------------------------------------------ + → quick log
  console.log('\nquick log from the +');
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"] .sheet-title');
  check('+ opens the quick-log sheet', (await page.textContent('.sheet-layer .sheet-title')).startsWith('Log for'));
  check('sheet grows from the + (is-grow) and the × twin is shown', await page.evaluate(() => !!document.querySelector('.sheet-layer.is-grow .fab-x')));
  check('dialog semantics', await page.evaluate(() => { const s = document.querySelector('.sheet'); return s.getAttribute('role') === 'dialog' && s.getAttribute('aria-modal') === 'true' && !!document.getElementById(s.getAttribute('aria-labelledby')); }));
  check('focus moved into the sheet', await page.evaluate(() => document.querySelector('.sheet-layer').contains(document.activeElement)));
  check('app root is inert under the sheet', await page.evaluate(() => document.getElementById('app').inert === true));
  await settle(500);
  await page.screenshot({ path: `${SHOTS}shell-quicklog-light.png` });
  // Tab stays trapped inside the sheet.
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  check('Tab is trapped in the sheet', await page.evaluate(() => document.querySelector('.sheet-layer').contains(document.activeElement)));
  await page.keyboard.press('Escape');
  await waitClosed();
  check('Esc closes it and removes the node after the exit transition', await allLayers() === 0);
  check('focus returns to the +', await focusedId() === 'fab', `focused #${await focusedId()}`);
  check('app root is interactive again', await page.evaluate(() => !document.getElementById('app').inert && !document.documentElement.classList.contains('has-sheet')));

  // Tile → its (stub) sheet through ctx.sheets.
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"] [data-key="pump"]');
  await page.click('[data-key="pump"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.sheet-layer:not([data-state="closing"]) .sheet-title')].some((t) => t.textContent === 'Pump'));
  await settle(500);
  check('quick-log tile opens its sheet (one sheet open)', await openLayers() === 1);
  await page.click('.sheet-layer[data-state="open"] [data-close]');
  await waitClosed();
  check('stub sheet "Done" closes; focus back on +', await allLayers() === 0 && await focusedId() === 'fab');
  // Scrim tap dismisses.
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"]');
  await settle(450);
  await page.mouse.click(195, 30);
  await waitClosed();
  check('scrim tap dismisses', await allLayers() === 0);

  // --------------------------------------------------------- back order
  console.log('\nback gesture');
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"]');
  await settle(300);
  await page.goBack();
  await waitClosed();
  check('Back closes the top sheet first (stays on Today)', await allLayers() === 0 && await activeView() === 'today');
  await page.click('[data-view="today"] [data-action="settings"]');
  await page.waitForSelector('[data-view="settings"]');
  await settle();
  check('avatar pushes Settings (nav hidden, chrome = screen)', await page.evaluate(() => document.body.dataset.chrome === 'screen' && document.getElementById('tabBar').inert));
  check('the covered tab and the nav are hidden under the screen (its bottom fade can\'t show them)', await page.evaluate(() => {
    const today = document.querySelector('[data-view="today"]');
    return getComputedStyle(today).visibility === 'hidden' && getComputedStyle(document.getElementById('tabBar')).visibility === 'hidden';
  }));
  await page.click('[data-view="settings"] [data-action="customize"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-view="settings"]').length === 2);
  await settle();
  check('Settings under its sub-page is hidden too', await page.evaluate(() => getComputedStyle(document.querySelectorAll('[data-view="settings"]')[0]).visibility === 'hidden'));
  await page.goBack();
  await page.waitForFunction(() => document.querySelectorAll('[data-view="settings"]').length === 1);
  check('Back pops the sub-page (and reveals Settings)', await page.evaluate(() => getComputedStyle(document.querySelector('[data-view="settings"]')).visibility === 'visible'));
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('[data-view="settings"]'));
  await settle();
  check('Back pops Settings to Today', await activeView() === 'today' && await page.evaluate(() => document.body.dataset.chrome === 'tabs'));
  // In-app Back (router.back(), e.g. "‹ Today") must not ALSO trigger a
  // browser back that leaves the app.
  await page.click('[data-view="today"] [data-action="settings"]');
  await page.waitForSelector('[data-view="settings"]');
  await settle();
  await page.click('[data-view="settings"] [data-action="back"]');
  await page.waitForFunction(() => !document.querySelector('[data-view="settings"]'));
  await settle(600);
  check('in-app Back pops Settings and stays in the app', page.url().startsWith(BASE_URL) && await activeView() === 'today');
  await page.click('#tabBar [data-tab="timeline"]');
  await page.waitForSelector('[data-view="timeline"]');
  await settle();
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#tabBar [data-tab="today"][aria-current="page"]'));
  await settle();
  check('Back from another tab returns to Today', await activeView() === 'today');

  // ------------------------------------------------------------ live pill
  console.log('\nlive pill');
  const eventId = await page.evaluate(async (u) => {
    const { events } = await import(u);
    const e = await events.start('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, { startTime: Date.now() - (12 * 60 + 4) * 1000 });
    return e.id;
  }, mod('/js/core/store.js'));
  await page.waitForSelector(`.lpill[data-event-id="${eventId}"]`);
  await settle(500);
  check('running bottle → pill appears', await page.isVisible('.lpill'));
  check('pill shows title + safety countdown', /Bottle/.test(await page.textContent('.lpill-title')) && /good for/.test(await page.textContent('.lpill-sub')));
  const t1 = await page.textContent('.lpill-time');
  await page.waitForTimeout(2100);
  const t2 = await page.textContent('.lpill-time');
  check('timer ticks at 1 Hz', t1 !== t2, `${t1} → ${t2}`);
  check('Finish button is ≥ 44 tall', await page.evaluate(() => document.querySelector('.lpill-finish').getBoundingClientRect().height >= 44));
  await page.screenshot({ path: `${SHOTS}shell-today-light.png` });
  for (const t of ['timeline', 'stash', 'memories', 'today']) {
    await page.click(`#tabBar [data-tab="${t}"]`);
    await page.waitForSelector(`[data-view="${t}"]`);
    await settle(300);
    check(`pill visible on ${t}`, await page.isVisible(`.lpill[data-event-id="${eventId}"]`));
  }
  await page.click('[data-view="today"] [data-action="settings"]');
  await page.waitForSelector('[data-view="settings"]');
  await settle();
  check('pill docks on pushed screens', await page.evaluate(() => {
    const r = document.querySelector('.lpill').getBoundingClientRect();
    return r.bottom > window.innerHeight - 30 && r.bottom <= window.innerHeight;
  }));
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('[data-view="settings"]'));
  // A sheet opened from the pill uses the pill as origin; the stub registered 'feed'.
  await page.click('.lpill-open');
  await page.waitForSelector('.sheet-layer[data-state="open"] [data-finish]');
  check('tapping the pill opens its registered sheet', true);
  await page.keyboard.press('Escape');
  await waitClosed();
  check('…and focus returns to the pill', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('lpill-open')));
  // Register a spy finisher (same module instance as the app).
  await page.evaluate(async (u) => {
    const { livePill } = await import(u);
    livePill.register('feed', { open() {}, finish(e) { window.__finished = e.id; } });
  }, mod('/js/ui/livePill.js'));
  await page.click('.lpill-finish');
  check('Finish invokes the registered finisher', await page.evaluate(() => window.__finished) === eventId);
  await page.evaluate(async ([u, id]) => { const { events } = await import(u); await events.stop(id, { data: { amount: 4 } }); }, [mod('/js/core/store.js'), eventId]);
  await page.waitForFunction(() => document.querySelectorAll('.lpill').length === 0, null, { timeout: 3000 });
  check('stopping the event removes the pill', true);
  check('body pill count back to 0', await page.evaluate(() => document.body.dataset.pills === '0'));

  // ---------------------------------------------------------------- toast
  console.log('\ntoast');
  await page.evaluate(async (u) => {
    const { toast } = await import(u);
    toast({ message: 'Diaper logged', action: { label: 'Undo', run() { window.__undone = true; } } });
  }, mod('/js/ui/toast.js'));
  await page.waitForSelector('.toast[data-state="in"] .toast-action');
  await settle(300);
  check('toast lives in the polite status region', await page.evaluate(() => { const r = document.getElementById('toastRoot'); return r.getAttribute('role') === 'status' && r.getAttribute('aria-live') === 'polite' && !!r.querySelector('.toast'); }));
  check('toast rises above the nav (not from the top)', await page.evaluate(() => document.querySelector('.toast').getBoundingClientRect().bottom < document.getElementById('tabBar').getBoundingClientRect().top));
  await page.click('.toast-action');
  await page.waitForFunction(() => window.__undone === true);
  check('Undo runs its action', true);
  check('…then says "Restored"', /Restored/.test(await page.textContent('.toast-msg')));
  await page.evaluate(async (u) => { const { toast } = await import(u); toast({ message: 'One' }); toast({ message: 'Two' }); }, mod('/js/ui/toast.js'));
  await settle(250);
  check('one toast at a time (new replaces old)', await page.evaluate(() => [...document.querySelectorAll('.toast:not([data-state="leaving"])')].length === 1 && document.querySelector('.toast-msg').textContent === 'Two'));

  // --------------------------------------------------------- confirmSheet
  console.log('\nconfirmSheet');
  const confirmRun = async (how) => {
    await page.evaluate(async (u) => {
      const { confirmSheet } = await import(u);
      window.__res = 'pending';
      confirmSheet({ title: 'Erase everything on this phone?', body: 'This can’t be undone.', confirmLabel: 'Erase', destructive: true }).then((v) => { window.__res = v; });
    }, mod('/js/ui/confirm.js'));
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-confirm]');
    await settle(300);
    if (how === 'confirm') await page.click('[data-confirm]');
    else if (how === 'cancel') await page.click('[data-cancel]');
    else await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__res !== 'pending', null, { timeout: 3000 });
    return page.evaluate(() => window.__res);
  };
  check('confirm → true', await confirmRun('confirm') === true);
  await waitClosed();
  check('Keep it → false (and is focused first)', await confirmRun('cancel') === false);
  await waitClosed();
  check('Esc → false', await confirmRun('esc') === false);
  await waitClosed();

  // -------------------------------------------------- trackers + motion
  console.log('\ntracker visibility + motion');
  await page.click('#tabBar [data-tab="stash"]');
  await page.waitForSelector('[data-view="stash"]');
  await page.evaluate(async (u) => { const { settings } = await import(u); await settings.patch('trackers', { stash: false }); }, mod('/js/core/settings.js'));
  await page.waitForFunction(() => !document.querySelector('#tabBar [data-tab="stash"]'));
  await settle();
  check('hiding Stash removes its tab and redirects to Today', await activeView() === 'today' && await currentTab() === 'today');
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"] .tiles');
  check('…and its quick-log tile', await page.evaluate(() => !document.querySelector('[data-key="stash"]')));
  await page.keyboard.press('Escape');
  await waitClosed();
  await page.evaluate(async (u) => { const { settings } = await import(u); await settings.patch('trackers', { stash: true }); }, mod('/js/core/settings.js'));
  await page.waitForSelector('#tabBar [data-tab="stash"]');
  check('turning it back on restores the tab', true);
  await setSetting('reduceMotion', true);
  check('Reduce motion setting → <html data-motion="reduce">', await page.evaluate(() => document.documentElement.dataset.motion === 'reduce'));
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"]');
  check('reduced motion: sheet fades (no grow / no slide)', await page.evaluate(() => { const l = document.querySelector('.sheet-layer'); return l.classList.contains('is-reduced') && !l.classList.contains('is-grow'); }));
  await page.keyboard.press('Escape');
  await waitClosed();
  check('reduced-motion sheet still closes and restores focus', await allLayers() === 0 && await focusedId() === 'fab');
  await setSetting('reduceMotion', false);
  check('turning it off → data-motion="full"', await page.evaluate(() => document.documentElement.dataset.motion === 'full'));

  // ------------------------------------------------------- dark screenshots
  console.log('\nscreenshots');
  const pillId = await page.evaluate(async (u) => {
    const { events } = await import(u);
    return (await events.start('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, { startTime: Date.now() - (12 * 60 + 4) * 1000 })).id;
  }, mod('/js/core/store.js'));
  await page.waitForSelector('.lpill');
  await page.evaluate(async (u) => { (await import(u)).clearToast(); }, mod('/js/ui/toast.js'));
  await setSetting('theme', 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await settle(900);
  await page.screenshot({ path: `${SHOTS}shell-today-dark.png` });
  check('theme-color meta follows the theme', await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].every((m) => m.content === '#191512')));
  await page.click('#fab');
  await page.waitForSelector('.sheet-layer[data-state="open"]');
  await settle(600);
  await page.screenshot({ path: `${SHOTS}shell-quicklog-dark.png` });
  // Theme never flips while a sheet is open.
  await setSetting('theme', 'light');
  await settle(200);
  check('theme change is deferred while a sheet is open', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
  await page.keyboard.press('Escape');
  await waitClosed();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 3000 }).catch(() => {});
  check('…and applied once it closes', await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
  await page.evaluate(async ([u, id]) => { const { events } = await import(u); await events.remove(id); }, [mod('/js/core/store.js'), pillId]);

  // ---------------------------------------------------------------- privacy
  console.log('\nprivacy');
  await page.reload();
  await page.waitForSelector('[data-view="today"]');
  await settle(800);
  check('reload keeps the onboarded user on Today', await activeView() === 'today');
  const csp = await page.evaluate(() => window.__csp);
  check('zero securitypolicyviolation events', csp.length === 0, csp.join(' | '));
  check('zero requests to any other origin', foreign.length === 0, foreign.join(' | '));
  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  failures.push(`crashed: ${err && err.stack ? err.stack : err}`);
  console.error(err);
  await page.screenshot({ path: `${SHOTS}shell-failure.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\nshell: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
