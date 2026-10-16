// Tabs, pushed screens and history (ARCHITECTURE §7.4, DESIGN §7.2 #11).
//
//   router.go('timeline')                 // tab switch, directional by nav order
//   router.push('settings', { page })     // pushed screen, slides in from the right
//   router.back()                         // top sheet → top screen → Today
//   router.showRoot('onboarding')         // full-screen root (no nav, no pill)
//   router.reset('today')                 // drop screens/root, land on a tab
//
// Back gesture / browser Back: the router keeps exactly ONE extra history
// entry (a "guard") whenever there is something to go back from — an open
// sheet, a pushed screen, or a tab other than Today. Each Back press pops the
// guard; we then close the top sheet, or pop the top screen, or return to
// Today, and re-arm the guard if there is still somewhere to go back from.
// One guard instead of one entry per level means in-app closes (Esc, ×,
// "Done") never leave stale entries that a later Back would land on.
//
// Every tab/screen mounts into its own <section class="view"> inside
// #viewport; each section is its own scroll container, so per-tab scroll is
// saved on leave and restored on return.
//
// The pure helpers (visibleTabs, resolveTab, tabDirection, backAction) carry
// the logic and are unit-tested; createRouter() is the DOM glue.

import { html, render, raw } from './html.js';
import { icon } from './icons.js';
import { openSheetCount, closeTopSheet, onSheetChange, motionReduced, afterTransition } from './sheet.js';

/** Tabs in nav order (the + sits between Timeline and Stash). */
export const TAB_ORDER = Object.freeze(['today', 'timeline', 'stash', 'memories']);
/** Tabs that disappear when their tracker is hidden (settings.trackers). */
export const TAB_TRACKER = Object.freeze({ stash: 'stash', memories: 'memories' });
/** Nav labels + icons. */
export const TAB_META = Object.freeze({
  today: { label: 'Today', icon: 'home' },
  timeline: { label: 'Timeline', icon: 'timeline' },
  stash: { label: 'Stash', icon: 'pouch' },
  memories: { label: 'Memories', icon: 'book' },
});

/**
 * Tabs to show for a trackers setting (hidden ≠ deleted; Today and Timeline
 * always show).
 * @param {Record<string, boolean>|null|undefined} trackers
 * @returns {string[]}
 */
export function visibleTabs(trackers) {
  return TAB_ORDER.filter((t) => !TAB_TRACKER[t] || !trackers || trackers[TAB_TRACKER[t]] !== false);
}

/**
 * The tab to actually show: the requested one if visible, else Today.
 * @param {string} tab
 * @param {Record<string, boolean>|null|undefined} trackers
 * @returns {string}
 */
export function resolveTab(tab, trackers) {
  return visibleTabs(trackers).includes(tab) ? tab : 'today';
}

/**
 * Direction of a tab switch by nav order: 1 = moving right (content enters
 * from the right), -1 = moving left, 0 = same tab / unknown.
 * @param {string} from
 * @param {string} to
 * @returns {-1|0|1}
 */
export function tabDirection(from, to) {
  const a = TAB_ORDER.indexOf(from);
  const b = TAB_ORDER.indexOf(to);
  if (a === -1 || b === -1 || a === b) return 0;
  return b > a ? 1 : -1;
}

/**
 * What one Back press should do.
 * @param {{ sheets: number, screens: number, tab: string, root?: boolean }} state
 * @returns {'sheet'|'screen'|'tab'|'none'}
 */
export function backAction({ sheets = 0, screens = 0, tab = 'today', root = false } = {}) {
  if (sheets > 0) return 'sheet';
  if (screens > 0) return 'screen';
  if (!root && tab !== 'today') return 'tab';
  return 'none';
}

/**
 * How many Back presses the app can absorb right now (0 = Back leaves).
 * @param {{ sheets: number, screens: number, tab: string, root?: boolean }} state
 * @returns {number}
 */
export function backDepth({ sheets = 0, screens = 0, tab = 'today', root = false } = {}) {
  return sheets + screens + (!root && tab !== 'today' ? 1 : 0);
}

const GUARD = Object.freeze({ nurture: 'guard' });

/**
 * @typedef {object} ViewModule
 * @property {string} id
 * @property {string} [title]
 * @property {(root: HTMLElement, ctx: object, params?: object) => ({ unmount?: () => void }|void)} mount
 */

/**
 * Build the router (and the bottom nav it owns).
 * @param {object} cfg
 * @param {HTMLElement} cfg.viewport  #viewport — views mount in sections here
 * @param {HTMLElement} cfg.nav       #tabBar — rendered by the router
 * @param {Record<string, ViewModule>} cfg.views  id → module (tabs, screens, roots)
 * @param {() => object} cfg.getCtx   returns the shared ctx (ARCHITECTURE §5.2)
 * @param {{ get: (k: string) => any, subscribe: (fn: Function) => () => void }} cfg.settings
 * @param {(fab: HTMLElement) => void} [cfg.onFab]  the + was pressed
 * @param {string[]} [cfg.roots]      view ids shown as roots (default ['onboarding'])
 * @returns {object} router
 */
export function createRouter({ viewport, nav, views, getCtx, settings, onFab, roots = ['onboarding'] }) {
  const listeners = new Set();
  const scrollMemory = new Map();
  let tab = null;          // current tab id
  let tabView = null;      // { id, section, handle }
  const screens = [];      // pushed screens, bottom → top
  let rootView = null;     // onboarding
  let ignorePops = 0;
  let fab = null;

  // ------------------------------------------------------------- nav

  function trackers() {
    try { return settings.get('trackers'); } catch { return null; }
  }

  function renderNav() {
    const shown = visibleTabs(trackers());
    const cell = (id) => {
      if (!shown.includes(id)) return html`<span class="tab-spacer" aria-hidden="true"></span>`;
      const m = TAB_META[id];
      return html`<button type="button" class="tab" data-tab="${id}" ${id === tab && !rootView ? raw('aria-current="page"') : ''}>
        ${raw(icon(m.icon, { size: 26 }))}<span class="tab-label">${m.label}</span></button>`;
    };
    render(nav, html`
      ${cell('today')}${cell('timeline')}
      <div class="nav-slot">
        <button type="button" class="fab" id="fab" data-sheet-grow aria-haspopup="dialog" aria-label="Log something">${raw(icon('plus-bold', { size: 30 }))}</button>
      </div>
      ${cell('stash')}${cell('memories')}`);
    fab = nav.querySelector('#fab');
  }

  nav.setAttribute('aria-label', 'Main');
  nav.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { api.go(t.getAttribute('data-tab')); return; }
    const f = e.target.closest('#fab');
    if (f && typeof onFab === 'function') onFab(f);
  });

  function updateNavCurrent() {
    for (const b of nav.querySelectorAll('[data-tab]')) {
      if (b.getAttribute('data-tab') === tab && !rootView) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  function setChrome() {
    const chrome = rootView ? 'bare' : screens.length ? 'screen' : 'tabs';
    document.body.setAttribute('data-chrome', chrome);
    nav.inert = chrome !== 'tabs';
    nav.hidden = chrome === 'bare';
  }

  // ----------------------------------------------------------- views

  function mountView(id, params, kind) {
    const mod = views[id];
    const section = document.createElement('section');
    section.className = `view view-${kind}`;
    section.setAttribute('data-view', id);
    section.setAttribute('aria-label', (mod && mod.title) || id);
    viewport.appendChild(section);
    let handle = null;
    if (!mod || typeof mod.mount !== 'function') {
      renderViewError(section, id);
    } else {
      try {
        const ctx = { ...getCtx(), params: params || {} };
        handle = mod.mount(section, ctx, params || {}) || null;
      } catch (err) {
        console.error(`view "${id}" failed to mount`, err);
        renderViewError(section, id);
      }
    }
    return { id, params: params || {}, section, handle, stopWatch: watchOverflow(section) };
  }

  function renderViewError(section, id) {
    render(section, html`<div class="view-pad"><div class="empty-state cat-neutral">
      <span class="empty-disc">${raw(icon('info', { size: 30 }))}</span>
      <h2 class="empty-title">This screen didn’t load</h2>
      <p class="empty-text">Your data is safe. Try going back and opening it again.</p>
      ${id !== 'today' ? html`<button type="button" class="btn btn-primary" data-router-home>Back to Today</button>` : ''}
    </div></div>`);
    const b = section.querySelector('[data-router-home]');
    if (b) b.addEventListener('click', () => api.reset('today'));
  }

  function unmountView(v, { animateOut = null } = {}) {
    if (!v) return;
    if (v.stopWatch) v.stopWatch();
    try { if (v.handle && typeof v.handle.unmount === 'function') v.handle.unmount(); } catch (err) { console.error(`view "${v.id}" failed to unmount`, err); }
    if (animateOut && !motionReducedNow()) {
      v.section.classList.add(animateOut);
      v.section.inert = true;
      afterTransition(v.section, 520, () => v.section.remove());
    } else if (animateOut) {
      v.section.classList.add('is-fading-out');
      v.section.inert = true;
      afterTransition(v.section, 300, () => v.section.remove());
    } else {
      v.section.remove();
    }
  }

  const motionReducedNow = () => motionReduced();

  function enter(section, cls) {
    section.classList.add(cls);
    // commit the start position, then let it transition to rest
    section.getBoundingClientRect();
    section.classList.remove(cls);
  }

  // Fade the bottom 24px only while there is more content below (DESIGN §5:
  // never over resting content).
  function watchOverflow(section) {
    const update = () => {
      const more = section.scrollTop + section.clientHeight < section.scrollHeight - 2;
      section.classList.toggle('has-more-below', more);
    };
    section.addEventListener('scroll', update, { passive: true });
    let ro = null;
    let mo = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(update);
      ro.observe(section);
      for (const c of section.children) ro.observe(c);
      mo = new MutationObserver(() => { for (const c of section.children) ro.observe(c); update(); });
      mo.observe(section, { childList: true });
    }
    requestAnimationFrame(update);
    return () => { if (ro) ro.disconnect(); if (mo) mo.disconnect(); };
  }

  function restoreScroll(section, y) {
    if (!y) return;
    let userMoved = false;
    const mark = () => { userMoved = true; };
    section.addEventListener('touchstart', mark, { once: true, passive: true });
    section.addEventListener('wheel', mark, { once: true, passive: true });
    let tries = 0;
    // Views may render async (store queries), so retry briefly until the
    // content is tall enough — unless the parent already started scrolling.
    const attempt = () => {
      if (userMoved || !section.isConnected) return;
      section.scrollTop = y;
      if (Math.abs(section.scrollTop - y) > 1 && tries < 20) { tries += 1; setTimeout(attempt, 50); }
    };
    attempt();
  }

  // --------------------------------------------------------- history

  function depth() {
    return backDepth({ sheets: openSheetCount(), screens: screens.length, tab: tab || 'today', root: !!rootView });
  }

  function syncHistory() {
    if (typeof history === 'undefined') return;
    const want = depth() > 0;
    const onGuard = !!(history.state && history.state.nurture === 'guard');
    if (want && !onGuard) {
      history.pushState(GUARD, '');
    } else if (!want && onGuard) {
      ignorePops += 1;
      history.back();
    }
  }

  function handleBack() {
    switch (backAction({ sheets: openSheetCount(), screens: screens.length, tab: tab || 'today', root: !!rootView })) {
      case 'sheet': closeTopSheet(); break; // a non-dismissible sheet stays; the guard is re-armed
      case 'screen': popScreen(); break;
      case 'tab': api.go('today'); break;
      default: break;
    }
  }

  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops -= 1;
    } else {
      handleBack();
    }
    syncHistory();
  });
  onSheetChange(() => syncHistory());

  // ------------------------------------------------------- navigation

  function emit() {
    const info = api.current();
    for (const fn of [...listeners]) {
      try { fn(info); } catch (err) { console.error('router listener failed', err); }
    }
  }

  function popScreen({ animate = true } = {}) {
    const top = screens.pop();
    if (!top) return;
    const below = screens[screens.length - 1] || tabView;
    if (below) below.section.inert = false;
    unmountView(top, { animateOut: animate ? 'is-leaving-right' : null });
    setChrome();
    emit();
    syncHistory();
  }

  const api = {
    /**
     * Switch tab. Hidden tabs resolve to Today. Pushed screens are dropped.
     * @param {string} id
     * @param {{ animate?: boolean }} [opts]
     */
    go(id, { animate = true } = {}) {
      const next = resolveTab(id, trackers());
      if (rootView) { unmountView(rootView); rootView = null; renderNav(); }
      while (screens.length) unmountView(screens.pop());
      if (next === tab && tabView) {
        // Tapping the active tab scrolls it back to the top.
        tabView.section.inert = false;
        tabView.section.scrollTo({ top: 0, behavior: motionReduced() ? 'auto' : 'smooth' });
        setChrome();
        updateNavCurrent();
        emit();
        syncHistory();
        return;
      }
      const dir = tabDirection(tab, next);
      const prev = tabView;
      if (prev) scrollMemory.set(prev.id, prev.section.scrollTop);
      tab = next;
      tabView = mountView(next, {}, 'tab');
      if (prev) {
        if (animate && dir) {
          enter(tabView.section, dir > 0 ? 'is-entering-right' : 'is-entering-left');
          unmountView(prev, { animateOut: 'is-fading-out' });
        } else {
          unmountView(prev);
        }
      }
      restoreScroll(tabView.section, scrollMemory.get(next) || 0);
      setChrome();
      updateNavCurrent();
      emit();
      syncHistory();
    },

    /**
     * Push a screen (settings + sub-pages, report…) over the current tab.
     * The same id may be pushed again with different params (sub-pages).
     * @param {string} id
     * @param {object} [params]
     * @param {{ animate?: boolean }} [opts]
     */
    push(id, params = {}, { animate = true } = {}) {
      if (roots.includes(id)) { api.showRoot(id, params); return; }
      if (TAB_ORDER.includes(id)) { api.go(id); return; }
      const below = screens[screens.length - 1] || tabView;
      const v = mountView(id, params, 'screen');
      screens.push(v);
      if (animate) enter(v.section, 'is-entering-push');
      if (below) {
        // let the slide finish before hiding the page underneath from AT
        below.section.inert = true;
      }
      setChrome();
      emit();
      syncHistory();
    },

    /** One level back: top sheet, then top screen, then Today. */
    back() {
      handleBack();
      syncHistory();
    },

    /** Pop the top pushed screen (no-op without one). */
    pop() { popScreen(); },

    /**
     * Show a full-screen root (onboarding): no nav, no live pill, and Back
     * leaves the app rather than skipping onboarding.
     * @param {string} id
     * @param {object} [params]
     */
    showRoot(id, params = {}) {
      while (screens.length) unmountView(screens.pop());
      if (tabView) { scrollMemory.set(tabView.id, tabView.section.scrollTop); unmountView(tabView); tabView = null; }
      if (rootView) unmountView(rootView);
      rootView = mountView(id, params, 'root');
      tab = null;
      renderNav();
      setChrome();
      emit();
      syncHistory();
    },

    /**
     * Drop screens and any root; land on a tab (default Today).
     * @param {string} [id]
     */
    reset(id = 'today') {
      const hadRoot = !!rootView;
      if (rootView) { unmountView(rootView, { animateOut: 'is-fading-out' }); rootView = null; }
      while (screens.length) unmountView(screens.pop());
      if (hadRoot || !tabView) {
        tab = null;
        renderNav();
      }
      api.go(id, { animate: false });
    },

    /** @returns {{ tab: string|null, screen: string|null, params: object, root: string|null, screens: string[] }} */
    current() {
      const top = screens[screens.length - 1];
      return {
        tab,
        screen: top ? top.id : null,
        params: top ? top.params : {},
        root: rootView ? rootView.id : null,
        screens: screens.map((s) => s.id),
      };
    },

    /** The section of whatever is on top (root, screen or tab). */
    activeSection() {
      return (rootView || screens[screens.length - 1] || tabView || {}).section || null;
    },

    /** Visible tab ids for the current trackers. */
    tabs: () => visibleTabs(trackers()),

    /** The center + button (re-rendered with the nav, so always read fresh). */
    get fab() { return fab; },

    /** The nav button for a tab (for "pill shrinks into Today" motion). */
    tabButton(id) { return nav.querySelector(`[data-tab="${id}"]`); },

    /**
     * Listen for navigation: fn(router.current()).
     * @param {(info: object) => void} fn
     * @returns {() => void}
     */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  // Tracker visibility: hidden tabs disappear everywhere (DESIGN §10), and
  // if the current tab just got hidden, fall back to Today.
  settings.subscribe((change) => {
    if (!change || (change.key !== 'trackers' && change.key !== '*')) return;
    renderNav();
    if (tab && !visibleTabs(trackers()).includes(tab) && !rootView) api.go('today', { animate: false });
    else updateNavCurrent();
  });

  renderNav();
  return api;
}
