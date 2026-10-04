// Browser test harness for Nurture — zero-dependency static server + Playwright
// helpers. Nothing here knows about a specific feature; the scenario files do.
//
// Why a harness at all: unit tests can't see a dead button, a modal that won't
// close, or a `hidden` attribute that CSS silently overrides. Those only show
// up in a real browser, so every test here drives real Chromium.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A fixed "now" so dates, "Today" grouping and expiry labels are deterministic.
// 14:00Z is 10:00 in New York (EDT) — daytime, so the auto theme is light.
export const T0 = new Date('2026-10-04T14:00:00Z');
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;

export const PHONE = { width: 390, height: 844 };
export const SMALL_PHONE = { width: 320, height: 568 };
export const TABLET = { width: 768, height: 1024 };

// ---------------------------------------------------------------- loading ---

export async function loadPlaywright() {
  const attempts = [];
  const norm = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);

  try {
    const m = norm(await import('playwright'));
    if (m) return m;
  } catch (e) { attempts.push(`import('playwright'): ${e.message.split('\n')[0]}`); }

  // Fall back to a global install (CI images and the cloud sandbox ship one).
  const roots = [];
  if (process.env.PLAYWRIGHT_MODULE_DIR) roots.push(process.env.PLAYWRIGHT_MODULE_DIR);
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch { /* no npm */ }
  for (const root of roots) {
    try {
      const m = norm(createRequire(path.join(root, path.sep))('playwright'));
      if (m) return m;
    } catch (e) { attempts.push(`require from ${root}: ${e.message.split('\n')[0]}`); }
  }

  throw new Error(
    'Playwright is not installed, so the browser tests cannot run.\n' +
    '  npm install            # installs the playwright devDependency\n' +
    '  npx playwright install chromium\n' +
    'Tried:\n  - ' + attempts.join('\n  - ')
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

export async function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    const inside = file === ROOT || file.startsWith(ROOT + path.sep);
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

/** One browser + one static server for a whole test file. */
export async function startHarness() {
  const pw = await loadPlaywright();
  const server = await startServer();
  const browser = await pw.chromium.launch();
  return {
    pw, browser, url: server.url,
    async stop() { await browser.close(); await server.close(); },
  };
}

// ------------------------------------------------------------ page spies ---

// Runs in the page before any app code. Records the non-visual ways a click can
// "do something": sound, haptics, notification prompts. (Audio `unlock()` runs on
// the first click and only uses createBufferSource, so we spy on createOscillator —
// otherwise the first click on a DEAD button would look like it did something.)
function installSpies() {
  const fx = (window.__fx = { audio: 0, vibrate: 0, notif: 0 });
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const orig = Ctx.prototype.createOscillator;
    Ctx.prototype.createOscillator = function (...a) { fx.audio++; return orig.apply(this, a); };
  } catch { /* no web audio */ }
  const nativeVibrate = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
  navigator.vibrate = (p) => { fx.vibrate++; return nativeVibrate ? nativeVibrate(p) : true; };
  if (window.Notification) {
    const rp = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...a) => { fx.notif++; return rp(...a); };
  }
}

const ALLOWED_CONSOLE = [
  // Most tests block the service worker on purpose; the app's own warning and Chromium's both mention it.
  /Service Worker registration failed/i,
  /Service Worker registration blocked by Playwright/i,
];

/**
 * Open the app in a fresh, isolated browser context (own IndexedDB/localStorage).
 *
 * opts:
 *   onboarded  (true)    pretend first-run onboarding was already completed
 *   standalone (false)   pretend the app is running as an installed PWA
 *   viewport   (PHONE)
 *   clock      ('running' | 'paused' | false)  fake clock starting at T0
 *   sw         (false)   allow the service worker (default: blocked)
 *   url        ('')      path/query appended to the base URL
 */
export async function openApp(h, opts = {}) {
  const {
    onboarded = true, standalone = false, viewport = PHONE, clock = 'running',
    sw = false, url = '', reducedMotion = 'no-preference',
  } = opts;

  const probe = {
    problems: [], dialogs: [], downloads: 0, fileChoosers: 0, navigations: 0,
    thirdParty: new Set(), // hostnames the app tried to reach that aren't our own server
    dialogAnswer: true,    // confirm() => OK. Flip with page.answerDialogs(false).
  };

  const context = await h.browser.newContext({
    viewport, locale: 'en-US', timezoneId: 'America/New_York',
    serviceWorkers: sw ? 'allow' : 'block', acceptDownloads: true, reducedMotion,
  });
  await context.addInitScript(installSpies);
  if (onboarded) await context.addInitScript(() => localStorage.setItem('onboarding_completed', 'true'));
  if (standalone) {
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  }

  // Keep the suite hermetic: never touch the real internet. Record who the app
  // *tried* to call (see the privacy guard test), and answer with an empty stub.
  const ownHost = new URL(h.url).host;
  await context.route((u) => u.host !== ownHost, (route) => {
    const u = new URL(route.request().url());
    probe.thirdParty.add(u.hostname);
    const isCss = u.hostname.endsWith('googleapis.com');
    return route.fulfill({ status: 200, contentType: isCss ? 'text/css' : 'application/octet-stream', body: '' });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(8000); // fail fast: a stuck test should say so in 8s, not 30s
  page.setDefaultNavigationTimeout(15000);
  page.probe = probe;
  page.answerDialogs = (ok) => { probe.dialogAnswer = ok; };

  page.on('pageerror', (e) => probe.problems.push(`uncaught exception: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if ((m.type() === 'error' || m.type() === 'warning') && !ALLOWED_CONSOLE.some((r) => r.test(text))) {
      probe.problems.push(`console.${m.type()}: ${text}`);
    }
  });
  page.on('requestfailed', (r) => probe.problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => { if (r.status() >= 400) probe.problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  page.on('dialog', async (d) => {
    probe.dialogs.push({ type: d.type(), message: d.message() });
    if (probe.dialogAnswer) await d.accept(); else await d.dismiss();
  });
  page.on('download', () => { probe.downloads++; });
  page.on('filechooser', () => { probe.fileChoosers++; });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) probe.navigations++; });

  page.clockMode = clock || 'real';
  if (clock) {
    await page.clock.install({ time: new Date(T0.getTime() - 5000) });
    await page.clock.pauseAt(T0);
    if (clock === 'running') await page.clock.resume();
  }

  await page.goto(h.url + url, { waitUntil: 'load' });
  await ready(page);
  return page;
}

export async function ready(page) {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true', null, { timeout: 15000 });
}

/** Run a test body against a fresh app and ALWAYS close the context. Fails the test on any
 *  uncaught error / console error / failed request unless the test opts out. */
export async function withApp(h, opts, body) {
  if (typeof opts === 'function') { body = opts; opts = {}; }
  const page = await openApp(h, opts);
  // A stuck page.evaluate() has no timeout of its own — turn any hang into a clear failure.
  const limit = opts.timeout ?? 60000;
  let timer;
  const hung = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`test body still running after ${limit}ms — something is hung`)), limit); });
  try {
    await Promise.race([body(page), hung]);
    if (!opts.allowProblems) {
      const unexpected = page.probe.problems.filter((p) => !(opts.ignore || []).some((r) => r.test(p)));
      if (unexpected.length) throw new Error('Page reported problems:\n  - ' + unexpected.join('\n  - '));
    }
  } finally {
    clearTimeout(timer);
    await page.context().close();
  }
}

// ------------------------------------------------------------- app helpers ---

export async function goTab(page, name) {
  await page.click(`.nav-item[data-tab="${name}"]`);
  await page.waitForSelector(`#tab-${name}.active`);
}

/** Advance the page's fake clock (only needed when it was opened with clock:'paused'). */
export async function tick(page, ms = 400) { await page.clock.runFor(ms); }

/** Let the app's own timers/animations run: advances a paused clock, or just waits on a live one. */
export async function settle(page, ms = 400) {
  if (page.clockMode === 'paused') await page.clock.runFor(ms);
  else await page.waitForTimeout(ms);
}

/** IDs of overlays/sheets/modals that are currently showing. */
export async function openOverlays(page) {
  return page.evaluate(() => {
    const open = [...document.querySelectorAll('.modal-overlay.open')].map((e) => e.id);
    const ob = document.getElementById('onboardingModal');
    if (ob && getComputedStyle(ob).display !== 'none') open.push('onboardingModal');
    return open;
  });
}

/** Re-run every render the app does after data changes. */
export async function refreshViews(page) {
  await page.evaluate(async () => {
    const { reminders } = await import('/js/reminders.js');
    await window.nurtureApp.renderTodayDashboard();
    await window.nurtureApp.renderInventory();
    await reminders.updateStatus();
  });
}

/**
 * Seed data straight into IndexedDB through the app's own modules, then re-render.
 * Times are offsets (ms) from the page's current clock; negative = in the past.
 */
export const seed = {
  async pump(page, { agoMs = 2 * HOUR, qty = 4, unit = 'oz', durationMin = 15, notes = '', id } = {}) {
    await page.evaluate(async (o) => {
      const { db, newId } = await import('/js/db.js');
      const start = Date.now() - o.agoMs;
      await db.addSession({ id: o.id || newId('pump'), type: 'pump', startTime: start, endTime: start + o.durationMin * 60000,
        durationSec: o.durationMin * 60, outputQty: o.qty, unit: o.unit, notes: o.notes });
    }, { agoMs, qty, unit, durationMin, notes, id });
    await refreshViews(page);
  },
  async feed(page, { agoMs = HOUR, qty = 3, unit = 'oz', feedType = 'formula', notes, id } = {}) {
    await page.evaluate(async (o) => {
      const { db, newId } = await import('/js/db.js');
      const start = Date.now() - o.agoMs;
      await db.addSession({ id: o.id || newId('sess'), type: 'feed', feedType: o.feedType, startTime: start, endTime: start,
        durationSec: 0, outputQty: o.qty, unit: o.unit,
        notes: o.notes !== undefined ? o.notes : (o.feedType === 'formula' ? 'Formula Feeding' : 'Breast Milk Feeding') });
    }, { agoMs, qty, unit, feedType, notes, id });
    await refreshViews(page);
  },
  /** location: fridge | freezer | deepFreezer | room | thawed */
  async pouch(page, { agoMs = 5 * HOUR, qty = 4, unit = 'oz', location = 'fridge', notes = '', status = 'active', id } = {}) {
    await page.evaluate(async (o) => {
      const { db, newId } = await import('/js/db.js');
      const { InventoryManager } = await import('/js/inventory.js');
      const pumpedAt = Date.now() - o.agoMs;
      const expiresAt = o.location === 'thawed'
        ? Date.now() + 20 * 3600 * 1000
        : InventoryManager.calculateExpiration(pumpedAt, o.location, window.nurtureApp.settings.storageWindows);
      await db.addInventoryItem({ id: o.id || newId('inv'), pumpedAt, quantity: o.qty, unit: o.unit, location: o.location,
        expiresAt, status: o.status, notes: o.notes });
    }, { agoMs, qty, unit, location, notes, status, id });
    await refreshViews(page);
  },
};

/** Seed a whole scenario in one go (one render at the end). Same offsets as `seed`. */
seed.bulk = async function bulk(page, { pumps = [], feeds = [], pouches = [] } = {}) {
  await page.evaluate(async (spec) => {
    const { db, newId } = await import('/js/db.js');
    const { InventoryManager } = await import('/js/inventory.js');
    const now = Date.now();
    for (const o of spec.pumps) {
      const start = now - (o.agoMs ?? 7200000); const dur = o.durationMin ?? 15;
      await db.addSession({ id: o.id || newId('pump'), type: 'pump', startTime: start, endTime: start + dur * 60000, durationSec: dur * 60,
        outputQty: o.qty ?? 4, unit: o.unit || 'oz', notes: o.notes || '' });
    }
    for (const o of spec.feeds) {
      const start = now - (o.agoMs ?? 3600000); const ft = o.feedType || 'formula';
      await db.addSession({ id: o.id || newId('sess'), type: 'feed', feedType: ft, startTime: start, endTime: start, durationSec: 0,
        outputQty: o.qty ?? 3, unit: o.unit || 'oz', notes: o.notes !== undefined ? o.notes : (ft === 'formula' ? 'Formula Feeding' : 'Breast Milk Feeding') });
    }
    for (const o of spec.pouches) {
      const loc = o.location || 'fridge'; const pumpedAt = now - (o.agoMs ?? 18000000);
      const expiresAt = loc === 'thawed' ? now + 20 * 3600000
        : InventoryManager.calculateExpiration(pumpedAt, loc, window.nurtureApp.settings.storageWindows);
      await db.addInventoryItem({ id: o.id || newId('inv'), pumpedAt, quantity: o.qty ?? 4, unit: o.unit || 'oz', location: loc,
        expiresAt, status: o.status || 'active', notes: o.notes || '' });
    }
  }, { pumps, feeds, pouches });
  await refreshViews(page);
};

export const dbRead = {
  sessions: (page) => page.evaluate(async () => (await import('/js/db.js')).db.getSessions()),
  inventory: (page, includeArchived = true) => page.evaluate(async (a) => (await import('/js/db.js')).db.getInventory(a), includeArchived),
  settings: (page) => page.evaluate(async () => (await import('/js/db.js')).db.getAllSettings()),
};

// --------------------------------------------------------- sweep primitives ---

/**
 * A fingerprint of everything a person can SEE: for each element, its text, box,
 * display/visibility, and class list; plus scroll position. Deliberately ignores
 * the `hidden` ATTRIBUTE (that's what a stylesheet can silently override — we care
 * whether the element actually left the screen) and anything mid-animation, so
 * pulsing dots and sliding sheets can't fake an "effect".
 */
export function layoutSignature(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg')) continue;
      if (el.getAnimations && el.getAnimations().length) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
      out.push([el.tagName, el.id, typeof el.className === 'string' ? el.className : '', own,
        Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height),
        cs.display, cs.visibility, el.value ?? '', el.checked ?? ''].join('|'));
    }
    out.push('scrollY=' + Math.round(window.scrollY), 'url=' + location.href);
    return out.join('\n');
  });
}

export async function fxCounts(page) {
  const fx = await page.evaluate(() => window.__fx || { audio: 0, vibrate: 0, notif: 0 });
  const p = page.probe;
  return { ...fx, dialogs: p.dialogs.length, downloads: p.downloads, fileChoosers: p.fileChoosers, navigations: p.navigations };
}

export function fxDelta(a, b) {
  const d = {};
  for (const k of Object.keys(b)) if (b[k] !== a[k]) d[k] = b[k] - (a[k] || 0);
  return d;
}

/**
 * Retry an assertion until it passes (or time runs out, then throw the LAST failure so the
 * message is the real one). Nearly every screen in this app repaints only after an awaited
 * IndexedDB read, so "click, then assert immediately" is a race — wrap the assertion instead.
 */
export async function eventually(fn, { timeout = 5000, interval = 50 } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, interval)); }
  }
  throw last;
}
