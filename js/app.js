// Nurture v2 bootstrap (ARCHITECTURE §2, §5.2, §8). Bootstrap ONLY:
//   1. theme on <html> before first paint: js/theme-boot.js (a blocking
//      classic script) does it from the per-device cache this file keeps
//   2. service worker
//   3. await runMigration()  (opens the v2 DB, migrates v1, loads settings)
//   4. baby-photo app icon, theme + motion from settings
//   5. build ctx, the router (+ nav), live pills; register sheets
//   6. onboarding or Today
// Everything else lives in views/ and sheets/, which only see `ctx`.
//
// This file must never import a legacy v1 module (js/db.js etc.): the v1
// db.js opens IndexedDB at version 1 and would fail against the v2 schema.
// tests/sw-assets.test.js enforces that by walking this import graph.

import { runMigration } from './core/migrate.js';
import { settings } from './core/settings.js';
import { events, RunningActivityError } from './core/store.js';
import { stash } from './core/stash.js';
import { photos } from './core/photos.js';
import * as units from './core/units.js';
import * as time from './core/time.js';
import { persist } from './core/persist.js';
import { html, raw, render, cls, element, fragment } from './ui/html.js';
import { icons } from './ui/icons.js';
import { openSheet, sheetsBusy, whenSheetsIdle, motionReduced } from './ui/sheet.js';
import { toast } from './ui/toast.js';
import { confirmSheet } from './ui/confirm.js';
import { createRouter } from './ui/router.js';
import { livePill } from './ui/livePill.js';
import { format } from './ui/format.js';

// ------------------------------------------------------------------ theme

const THEME_PREF_KEY = 'nurture.themePref'; // per-device copy of settings.theme, read by js/theme-boot.js
const MOTION_CACHE_KEY = 'nurture.motion';   // per-device: last applied motion preference
const NIGHT_START_HOUR = 19;                 // ARCHITECTURE §6: night hours 19:00–08:00
const NIGHT_END_HOUR = 8;
const BG = Object.freeze({ light: '#F6F1E8', dark: '#191512' }); // = --bg (tokens.css), for theme-color

const root = document.documentElement;
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: fine */ }
}

/**
 * 'auto' is dark when the system is dark OR during night hours (so a 3 am
 * feed is dim even on a phone left in light mode); explicit choices win.
 * @param {'auto'|'light'|'dark'} pref
 * @param {Date} [now]
 * @returns {'light'|'dark'}
 */
function resolveTheme(pref, now = new Date()) {
  if (pref === 'light' || pref === 'dark') return pref;
  const h = now.getHours();
  const night = h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
  return (darkQuery && darkQuery.matches) || night ? 'dark' : 'light';
}

let pendingTheme = null;

/**
 * Set <html data-theme>, cross-fading over --dur-theme. Never flips while a
 * sheet is open (DESIGN §2.1): the change is queued until sheets are idle.
 * @param {'light'|'dark'} theme
 * @param {{ animate?: boolean }} [opts]
 */
function applyTheme(theme, { animate = true } = {}) {
  if (root.getAttribute('data-theme') === theme) { pendingTheme = null; return; }
  if (sheetsBusy()) {
    const first = pendingTheme === null;
    pendingTheme = theme;
    if (first) whenSheetsIdle().then(() => { const t = pendingTheme; pendingTheme = null; if (t) applyTheme(t); });
    return;
  }
  if (animate && !motionReduced()) {
    root.classList.add('is-theme-switching');
    setTimeout(() => root.classList.remove('is-theme-switching'), 700);
  }
  root.setAttribute('data-theme', theme);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', BG[theme]);
}

function applyThemeFromSettings(animate = true) {
  const pref = settings.get('theme');
  storageSet(THEME_PREF_KEY, pref);
  applyTheme(resolveTheme(pref), { animate });
}

/** In-app Reduce motion: true → 'reduce', false → 'full', unset → follow the system. */
function applyMotion(pref) {
  if (pref === true) root.setAttribute('data-motion', 'reduce');
  else if (pref === false) root.setAttribute('data-motion', 'full');
  else root.removeAttribute('data-motion');
  storageSet(MOTION_CACHE_KEY, pref === true ? 'reduce' : pref === false ? 'full' : '');
}

// First paint: js/theme-boot.js already set data-theme / data-motion from
// the cache. If it couldn't run (e.g. a stale cached index.html), resolve
// now so base.css's paint gate (#app hidden until data-theme) still lifts.
if (!root.hasAttribute('data-theme')) root.setAttribute('data-theme', resolveTheme('auto'));

// -------------------------------------------------------------- app icon

const DEFAULT_ICONS = Object.freeze({ touch: 'icons/apple-touch-icon.png', favicon: 'icons/icon.svg', faviconType: 'image/svg+xml' });

/**
 * Point the apple-touch-icon + favicon at the baby's photo (ARCHITECTURE
 * §10), or back at the static icons when there is none.
 * @param {string|null} dataUrl a PNG data URL (settings.iconDataUrl)
 */
function applyIcon(dataUrl) {
  const ok = typeof dataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl);
  const touch = document.getElementById('appleTouchIcon');
  const fav = document.getElementById('favicon');
  if (touch) touch.setAttribute('href', ok ? dataUrl : DEFAULT_ICONS.touch);
  if (fav) {
    fav.setAttribute('type', ok ? 'image/png' : DEFAULT_ICONS.faviconType);
    fav.setAttribute('href', ok ? dataUrl : DEFAULT_ICONS.favicon);
  }
}

// -------------------------------------------------------- service worker

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const go = () => navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('service worker not registered', err));
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}

// ------------------------------------------------------------- modules

// Literal import() calls (not a template) so tests can walk the graph and
// prove no legacy v1 module is reachable. Loaded with allSettled so one
// broken screen can't stop the others from booting.
const VIEW_LOADERS = {
  today: () => import('./views/today.js'),
  timeline: () => import('./views/timeline.js'),
  stash: () => import('./views/stash.js'),
  memories: () => import('./views/memories.js'),
  settings: () => import('./views/settings.js'),
  onboarding: () => import('./views/onboarding.js'),
  report: () => import('./views/report.js'),
};
const SHEET_LOADERS = {
  quickLog: () => import('./sheets/quickLog.js'),
  feed: () => import('./sheets/feed.js'),
  pump: () => import('./sheets/pump.js'),
  sleep: () => import('./sheets/sleep.js'),
  diaper: () => import('./sheets/diaper.js'),
  event: () => import('./sheets/event.js'),
  stash: () => import('./sheets/stash.js'),
  memory: () => import('./sheets/memory.js'),
};
/** Each sheet module's opener export (ARCHITECTURE §5.3). */
const SHEET_EXPORTS = Object.freeze({
  quickLog: 'openQuickLogSheet', feed: 'openFeedSheet', pump: 'openPumpSheet', sleep: 'openSleepSheet',
  diaper: 'openDiaperSheet', event: 'openEventSheet', stash: 'openStashSheet', memory: 'openMemorySheet',
});

async function loadAll(loaders) {
  const names = Object.keys(loaders);
  const results = await Promise.allSettled(names.map((n) => loaders[n]()));
  const out = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out[names[i]] = r.value;
    else console.error(`module "${names[i]}" failed to load`, r.reason);
  });
  return out;
}

// --------------------------------------------------------------- boot

let ctx = null;
let router = null;

function fallbackSheet(name, { origin } = {}) {
  // A sheet whose module failed to load still opens something real.
  return openSheet({
    title: 'Not available yet',
    origin,
    render(body, api) {
      render(body, html`<div class="empty-state cat-neutral">
          <p class="empty-text">This part of Nurture didn’t load. Your data is safe.</p>
          <button type="button" class="btn btn-secondary" data-close>Close</button>
        </div>`);
      body.querySelector('[data-close]').addEventListener('click', () => api.close());
    },
  });
}

function buildSheets(sheetMods) {
  const sheets = {};
  for (const [name, exportName] of Object.entries(SHEET_EXPORTS)) {
    sheets[name] = (opts = {}) => {
      const mod = sheetMods[name];
      const fn = mod && (mod[exportName] || (mod.default && mod.default.open));
      if (typeof fn !== 'function') return fallbackSheet(name, opts);
      try {
        return fn(ctx, opts);
      } catch (err) {
        console.error(`sheet "${name}" failed to open`, err);
        return fallbackSheet(name, opts);
      }
    };
  }
  return Object.freeze(sheets);
}

function showBootNote(text) {
  const vp = document.getElementById('viewport');
  if (!vp || vp.querySelector('.view')) return;
  render(vp, html`<div class="boot-msg"><p>${text}</p></div>`);
}

function showFatal(err) {
  console.error('Nurture failed to start', err);
  const vp = document.getElementById('viewport');
  if (!vp) return;
  document.body.setAttribute('data-chrome', 'bare');
  render(vp, html`<div class="boot-msg">
      <h1 class="disp">Nurture couldn’t open its storage</h1>
      <p>Nothing on this phone was changed. If Nurture is open in another tab or window, close it, then try again.</p>
      <button type="button" class="btn btn-primary" data-reload>Try again</button>
    </div>`);
  vp.querySelector('[data-reload]').addEventListener('click', () => location.reload());
}

let persistAsked = false;
function askPersistence() {
  if (persistAsked) return;
  persistAsked = true;
  persist.requestPersistence().catch((err) => console.warn('storage persistence request failed', err));
}

async function boot() {
  registerServiceWorker();
  const slow = setTimeout(() => showBootNote('Still opening… If Nurture is open in another tab, close it.'), 6000);
  await runMigration();
  clearTimeout(slow);

  // Before anything the user could reach "Add to Home Screen" from.
  applyIcon(settings.get('iconDataUrl'));
  applyMotion(settings.get('reduceMotion'));
  applyThemeFromSettings(false);

  const [viewMods, sheetMods] = await Promise.all([loadAll(VIEW_LOADERS), loadAll(SHEET_LOADERS)]);
  const views = {};
  for (const [id, mod] of Object.entries(viewMods)) views[id] = mod.default || mod;

  const base = {
    openSheet, toast, confirmSheet, settings, events, stash, photos, units, time, format, icons, persist,
    html: Object.freeze({ html, raw, render, cls, element, fragment }),
    livePill: Object.freeze({ register: livePill.register, refresh: livePill.refresh, pillModel: livePill.pillModel }),
    RunningActivityError,
    activeBaby: () => settings.activeBaby(),
    motionReduced,
  };
  ctx = { ...base };
  ctx.sheets = buildSheets(sheetMods);

  router = createRouter({
    viewport: document.getElementById('viewport'),
    nav: document.getElementById('tabBar'),
    views,
    getCtx: () => ctx,
    settings,
    onFab: (fab) => ctx.sheets.quickLog({ origin: fab }),
  });
  ctx.router = router;
  Object.defineProperty(ctx, 'fab', { get: () => router.fab, enumerable: true });
  Object.freeze(ctx);

  // Sheets register live-pill handlers etc. (optional `setup(ctx)` export).
  for (const [name, mod] of Object.entries(sheetMods)) {
    if (mod && typeof mod.setup === 'function') {
      try { mod.setup(ctx); } catch (err) { console.error(`sheet "${name}" setup failed`, err); }
    }
  }
  livePill.mount(document.getElementById('livePills'), ctx);

  if (settings.get('onboarded')) router.go('today', { animate: false });
  else router.showRoot('onboarding');

  // ---- keep the shell in step with settings ----
  settings.subscribe((change) => {
    const key = change && change.key;
    if (key === 'theme' || key === '*') applyThemeFromSettings(true);
    if (key === 'reduceMotion' || key === '*') applyMotion(settings.get('reduceMotion'));
    if (key === 'iconDataUrl' || key === '*') applyIcon(settings.get('iconDataUrl'));
    if (key === 'onboarded' || key === '*') {
      const onboarded = settings.get('onboarded');
      const cur = router.current();
      if (onboarded && cur.root === 'onboarding') {
        router.reset('today');
        askPersistence(); // §10b: right after onboarding
      } else if (!onboarded && !cur.root) {
        router.showRoot('onboarding'); // e.g. after "Erase everything"
      }
    }
  });
  // §10b: and on the first meaningful log.
  events.subscribe((change) => {
    if (change && change.op === 'add' && !change.restored && settings.get('persistGranted') !== true) askPersistence();
  });

  // Auto theme follows the clock (night hours) and the system scheme.
  setInterval(() => applyThemeFromSettings(true), 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyThemeFromSettings(true); });
  if (darkQuery && typeof darkQuery.addEventListener === 'function') darkQuery.addEventListener('change', () => applyThemeFromSettings(true));
}

boot().catch(showFatal);
