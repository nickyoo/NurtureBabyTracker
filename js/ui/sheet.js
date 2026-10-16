// Bottom sheets (ARCHITECTURE §7.1, DESIGN §6.6 + motion contract §7 #1–#3, #7).
//
//   const api = openSheet({ title: 'Bottle', origin: buttonEl, render(body, api) {
//     render(body, html`…`);
//     return () => { /* cleanup: unsubscribe stores */ };
//   } });
//   api.step(nextRender, { direction: 'forward' });   // slide + height animation
//   api.close(result);                                  // → api.closed resolves(result)
//
// One controller for every sheet in the app (quick log, feed, pump, sleep,
// diaper, event detail, stash, memory, confirm, keypad, time picker), so the
// motion, focus and dismiss behaviour is identical everywhere:
//  - Enter: scrim fades in (--dur-fast) while the sheet rises translateY(100%)
//    → 0 on the spring (--dur-sheet); the page behind scales to .985.
//    A sheet whose origin carries [data-sheet-grow] (the center +) instead
//    GROWS out of the + with a clip-path circle (--dur-grow), and a twin of
//    the + rotates into × and stays above the sheet as its close button.
//  - Exit: reverse (240 ms ease-in / circle collapse), then the node is
//    removed on transitionend — with a timeout fallback, because a
//    transitionend can be skipped (tab hidden, display change, zero-duration).
//  - Reduced motion (system or in-app [data-motion="reduce"]): opacity only.
//  - Focus moves into the sheet, is trapped, and returns to the origin.
//    The app root is inert and its scrolling locked while any sheet is open.
//  - Esc, scrim tap and dragging the grabber/header down dismiss it when
//    `dismissible`. Sheets stack: only the top one is interactive.
//
// No DOM access at import time (the router imports this in unit tests).

import { html, raw, element } from './html.js';
import { icon } from './icons.js';

/** CSS selector for things Tab can land on. */
const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="switch"], [role="slider"], [contenteditable="true"]';

/** Exit duration for a sheet (DESIGN §7.2 #1: 240 ms ease-in). */
const EXIT_MS = 240;
// Fallback slack on top of the expected duration before we stop waiting for
// transitionend and finish anyway.
const FALLBACK_SLACK_MS = 160;

const stack = [];          // open sheets, bottom → top (closing ones are removed)
let closingCount = 0;      // sheets still animating out
let seq = 0;
let globalsBound = false;
const changeListeners = new Set();
const idleWaiters = new Set();

/**
 * Is reduced motion in effect? The in-app setting (<html data-motion>) wins:
 * 'reduce' forces it, 'full' turns it off; otherwise the system preference.
 * @returns {boolean}
 */
export function motionReduced() {
  if (typeof document === 'undefined') return false;
  const pref = document.documentElement.getAttribute('data-motion');
  if (pref === 'reduce') return true;
  if (pref === 'full') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Run `fn` once `el` finishes a transition (its own, not a child's), or
 * after `ms` if transitionend never arrives.
 * @param {Element} el
 * @param {number} ms
 * @param {() => void} fn
 * @returns {() => void} cancel
 */
export function afterTransition(el, ms, fn) {
  let done = false;
  let timer = 0;
  const onEnd = (e) => { if (e.target === el) finish(); };
  function finish() {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', onEnd);
    el.removeEventListener('transitioncancel', onEnd);
    clearTimeout(timer);
    fn();
  }
  el.addEventListener('transitionend', onEnd);
  el.addEventListener('transitioncancel', onEnd);
  timer = setTimeout(finish, ms);
  return () => { done = true; clearTimeout(timer); el.removeEventListener('transitionend', onEnd); el.removeEventListener('transitioncancel', onEnd); };
}

/** Force a style flush so the next class change transitions from here. */
function reflow(el) {
  // Reading layout is the standard way to commit the current styles.
  // eslint-disable-next-line no-unused-expressions
  el.getBoundingClientRect();
}

function cssMs(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}

function appRoot() {
  return document.getElementById('app');
}

function sheetRoot() {
  let root = document.getElementById('sheetRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'sheetRoot';
    document.body.appendChild(root);
  }
  return root;
}

function notifyChange() {
  const info = { count: stack.length };
  for (const fn of [...changeListeners]) {
    try { fn(info); } catch (err) { console.error('sheet listener failed', err); }
  }
}

function checkIdle() {
  if (stack.length || closingCount) return;
  for (const fn of [...idleWaiters]) {
    idleWaiters.delete(fn);
    try { fn(); } catch (err) { console.error('sheet idle callback failed', err); }
  }
}

function visibleFocusables(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[inert]') && el.getClientRects().length > 0);
}

function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      if (top.dismissible) top.close(undefined);
      return;
    }
    if (e.key === 'Tab') {
      const items = visibleFocusables(top.layer);
      if (!items.length) { e.preventDefault(); top.sheet.focus({ preventScroll: true }); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !top.layer.contains(active))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (active === last || !top.layer.contains(active))) { e.preventDefault(); first.focus(); }
    }
  }, true);
  // Belt and braces for the trap: anything that steals focus outside the top
  // sheet (a script, an assistive-tech jump) gets it pulled back.
  document.addEventListener('focusin', (e) => {
    const top = stack[stack.length - 1];
    if (!top || top.layer.contains(e.target)) return;
    const toastRoot = document.getElementById('toastRoot');
    if (toastRoot && toastRoot.contains(e.target)) return;
    top.sheet.focus({ preventScroll: true });
  });
}

/**
 * @typedef {object} SheetApi
 * @property {(result?: any) => Promise<any>} close   close (animated); resolves after removal
 * @property {(title: string) => void} setTitle
 * @property {(renderFn: (body: HTMLElement, api: SheetApi) => (void|(() => void)), opts?: { direction?: 'forward'|'back' }) => HTMLElement} step
 * @property {(on: boolean) => void} setDismissible
 * @property {HTMLElement} el        the <section role="dialog">
 * @property {HTMLElement} layer     the layer (scrim + sheet + optional ×)
 * @property {HTMLElement} header    slot at the end of the header row (time chip)
 * @property {HTMLElement} body      the CURRENT step's container
 * @property {Promise<any>} closed   resolves with the close() result
 * @property {() => boolean} isOpen
 */

/**
 * Open a bottom sheet.
 * @param {object} opts
 * @param {string} [opts.title] header title (Fraunces 26); also the dialog's accessible name
 * @param {string} [opts.label] accessible name when there is no visible title
 * @param {Element|null} [opts.origin] the trigger: gets a pressed state, focus returns to it; an origin with [data-sheet-grow] makes the sheet grow out of it (the +)
 * @param {(body: HTMLElement, api: SheetApi) => (void|(() => void))} opts.render builds the first step; may return a cleanup fn
 * @param {'auto'|'full'} [opts.size] auto = sizes to content up to the max; full = always max height
 * @param {boolean} [opts.dismissible=true] Esc / scrim / drag / back close it
 * @param {(result: any) => void} [opts.onClose] called after the sheet is removed
 * @param {string} [opts.className] extra class on the layer (e.g. 'sheet-quicklog')
 * @param {Element|string} [opts.initialFocus] element or selector to focus; default [autofocus] or the dialog itself
 * @returns {SheetApi}
 */
export function openSheet(opts = {}) {
  const {
    title = '', label = '', origin = null, render: renderFirst, size = 'auto', dismissible = true,
    onClose, className = '', initialFocus,
  } = opts;
  if (typeof renderFirst !== 'function') throw new TypeError('openSheet: render(body, api) is required');
  bindGlobals();

  const id = `sheet-${(seq += 1)}`;
  const reduced = motionReduced();
  const originEl = origin && origin.nodeType === 1 ? origin : null;
  const grow = !!(originEl && originEl.hasAttribute('data-sheet-grow') && !reduced);
  const safeClass = /^[\w -]*$/.test(className) ? className : '';

  const layer = element(html`
    <div class="sheet-layer ${safeClass}" data-state="pre" data-size="${size === 'full' ? 'full' : 'auto'}">
      <div class="sheet-scrim" aria-hidden="true"></div>
      <section class="sheet" role="dialog" aria-modal="true" tabindex="-1"
        ${title ? html`aria-labelledby="${id}-title"` : html`aria-label="${label || 'Sheet'}"`}>
        <div class="sheet-grab" aria-hidden="true"><span class="sheet-grabber"></span></div>
        <button type="button" class="sheet-close sr-only-focusable">Close</button>
        <header class="sheet-hd ${title ? '' : 'is-empty'}">
          <h2 class="sheet-title" id="${id}-title">${title}</h2>
          <div class="sheet-hd-end"></div>
        </header>
        <div class="sheet-viewport"><div class="sheet-step" tabindex="-1"></div></div>
      </section>
    </div>`);

  const sheet = layer.querySelector('.sheet');
  const scrim = layer.querySelector('.sheet-scrim');
  const viewport = layer.querySelector('.sheet-viewport');
  const titleEl = layer.querySelector('.sheet-title');
  const closeBtn = layer.querySelector('.sheet-close');
  let currentStep = layer.querySelector('.sheet-step');
  let stepCleanup = null;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });

  const entry = {
    id, layer, sheet, dismissible, close: null, origin: originEl, fabX: null,
  };
  if (grow) layer.classList.add('is-grow');
  if (reduced) layer.classList.add('is-reduced');
  if (!dismissible) closeBtn.hidden = true;

  // ---- stacking: everything below the new sheet becomes inert ----
  const below = stack[stack.length - 1];
  if (below) below.layer.inert = true;
  if (!stack.length) {
    const app = appRoot();
    if (app) { app.inert = true; app.classList.add('is-behind-sheet'); }
    document.documentElement.classList.add('has-sheet');
  }
  layer.style.setProperty('--sheet-depth', String(stack.length));
  stack.push(entry);

  if (originEl) originEl.classList.add('is-sheet-origin');

  /** @type {SheetApi} */
  const api = {
    close: (result) => close(result),
    setTitle(t) {
      titleEl.textContent = String(t ?? '');
      layer.querySelector('.sheet-hd').classList.toggle('is-empty', !t);
      if (t) { sheet.setAttribute('aria-labelledby', `${id}-title`); sheet.removeAttribute('aria-label'); }
    },
    step: (fn, o) => step(fn, o),
    setDismissible(on) { entry.dismissible = !!on; closeBtn.hidden = !on; },
    el: sheet,
    layer,
    header: layer.querySelector('.sheet-hd-end'),
    get body() { return currentStep; },
    closed,
    isOpen: () => stack.includes(entry),
  };
  entry.close = api.close;

  sheetRoot().appendChild(layer);
  try {
    stepCleanup = renderFirst(currentStep, api) || null;
  } catch (err) {
    console.error('sheet render failed', err);
  }

  // ---- grow-from-+ geometry (DESIGN §7.2 #3) ----
  if (grow) {
    const o = originEl.getBoundingClientRect();
    const s = sheet.getBoundingClientRect();
    sheet.style.setProperty('--grow-x', `${o.left + o.width / 2 - s.left}px`);
    sheet.style.setProperty('--grow-y', `${o.top + o.height / 2 - s.top}px`);
    sheet.style.setProperty('--grow-r', `${o.width / 2}px`);
    const fabX = element(html`<button type="button" class="fab-x" aria-label="Close">${rawIcon('plus-bold', 30)}</button>`);
    fabX.style.setProperty('--fab-left', `${o.left}px`);
    fabX.style.setProperty('--fab-top', `${o.top}px`);
    fabX.style.setProperty('--fab-size-px', `${o.width}px`);
    fabX.addEventListener('click', () => api.close(undefined));
    layer.appendChild(fabX);
    entry.fabX = fabX;
    originEl.classList.add('is-under-sheet');
    // Tiles rise in, staggered 20 ms from 120 ms (motion contract #3).
    [...currentStep.querySelectorAll('[data-stagger]')].forEach((el, i) => el.style.setProperty('--stagger-i', String(i)));
    layer.classList.add('is-staggered');
  }

  // ---- enter ----
  reflow(layer);
  layer.setAttribute('data-state', 'open');
  if (grow) {
    afterTransition(sheet, cssMs('--dur-grow', 420) + FALLBACK_SLACK_MS, () => {
      // Drop the clip once grown: a clip-path costs compositing every frame
      // and would clip the sheet's own shadow.
      if (layer.getAttribute('data-state') === 'open') layer.classList.add('is-settled');
    });
  }
  focusInitial();
  notifyChange();

  // ---- dismiss gestures ----
  scrim.addEventListener('click', () => { if (entry.dismissible && isTop()) close(undefined); });
  closeBtn.addEventListener('click', () => close(undefined));
  bindDrag();

  function isTop() { return stack[stack.length - 1] === entry; }

  function focusInitial(container = currentStep) {
    let target = null;
    if (initialFocus && container === currentStep && !entry.focusedOnce) {
      target = typeof initialFocus === 'string' ? layer.querySelector(initialFocus) : initialFocus;
    }
    entry.focusedOnce = true;
    if (!target) target = container.querySelector('[autofocus]');
    // Default to the dialog itself: screen readers announce its title, and
    // no keyboard pops up over the content.
    (target || (container === currentStep && !entry.stepped ? sheet : container)).focus({ preventScroll: true });
  }

  function step(renderFn, { direction = 'forward' } = {}) {
    if (!stack.includes(entry)) return currentStep;
    entry.stepped = true;
    const dir = direction === 'back' ? 'is-back' : 'is-fwd';
    const old = currentStep;
    const oldH = viewport.offsetHeight;
    const scrolled = viewport.scrollTop;
    if (typeof stepCleanup === 'function') { try { stepCleanup(); } catch (err) { console.error(err); } }
    stepCleanup = null;

    const next = document.createElement('div');
    next.className = 'sheet-step';
    next.tabIndex = -1;
    old.classList.add('is-leaving');
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    old.style.setProperty('--leave-top', `${-scrolled}px`);
    next.classList.add('is-entering', dir);
    viewport.appendChild(next);
    currentStep = next;
    try {
      stepCleanup = renderFn(next, api) || null;
    } catch (err) {
      console.error('sheet step render failed', err);
    }
    viewport.scrollTop = 0;

    // Height: measure the new natural height, then animate from the old one.
    viewport.style.removeProperty('height');
    const newH = viewport.offsetHeight;
    viewport.style.setProperty('height', `${oldH}px`);
    reflow(viewport);
    viewport.classList.add('is-resizing');
    viewport.style.setProperty('height', `${newH}px`);
    old.classList.add(dir);
    next.classList.remove('is-entering');

    const base = cssMs('--dur-base', 280) + FALLBACK_SLACK_MS;
    afterTransition(old, cssMs('--dur-fast', 200) + FALLBACK_SLACK_MS, () => old.remove());
    afterTransition(viewport, base, () => {
      viewport.classList.remove('is-resizing');
      viewport.style.removeProperty('height');
    });
    afterTransition(next, base, () => next.classList.remove(dir));
    focusInitial(next);
    return next;
  }

  function bindDrag() {
    const handles = [layer.querySelector('.sheet-grab'), layer.querySelector('.sheet-hd')];
    let drag = null;
    const onDown = (e) => {
      if (!entry.dismissible || !isTop() || (e.button !== undefined && e.button !== 0)) return;
      if (e.target.closest(INTERACTIVE)) return;
      drag = { y0: e.clientY, h: sheet.offsetHeight || 1, dy: 0, samples: [[performance.now(), e.clientY]], id: e.pointerId };
      try { sheet.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      layer.classList.add('is-dragging');
    };
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y0);
      drag.samples.push([performance.now(), e.clientY]);
      if (drag.samples.length > 5) drag.samples.shift();
      sheet.style.setProperty('--drag-y', `${drag.dy}px`);
      layer.style.setProperty('--drag-progress', String(Math.min(1, drag.dy / drag.h)));
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [t0, y0] = drag.samples[0];
      const [t1, y1] = drag.samples[drag.samples.length - 1];
      const velocity = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0; // px/ms, + = down
      const shouldClose = drag.dy > drag.h * 0.25 || velocity > 0.5;
      drag = null;
      layer.classList.remove('is-dragging');
      layer.style.removeProperty('--drag-progress');
      if (shouldClose) {
        // Continue the slide from where the finger let go (even for the
        // grown quick-log sheet, which then exits like any other sheet).
        layer.classList.remove('is-grow', 'is-settled');
        layer.classList.add('is-drag-close');
        close(undefined);
      } else {
        sheet.style.setProperty('--drag-y', '0px');
      }
    };
    for (const h of handles) h.addEventListener('pointerdown', onDown);
    sheet.addEventListener('pointermove', onMove);
    sheet.addEventListener('pointerup', onUp);
    sheet.addEventListener('pointercancel', onUp);
  }

  function close(result) {
    if (entry.closing) return closed;
    entry.closing = true;
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    closingCount += 1;

    for (const fn of [stepCleanup]) {
      if (typeof fn === 'function') { try { fn(); } catch (err) { console.error('sheet cleanup failed', err); } }
    }
    stepCleanup = null;
    if (originEl) originEl.classList.remove('is-sheet-origin');

    const top = stack[stack.length - 1];
    if (top) top.layer.inert = false;
    if (!stack.length) {
      const app = appRoot();
      if (app) app.classList.remove('is-behind-sheet');
    }

    // Grown sheets collapse back into the ×: restore the full circle first
    // (it was dropped once settled) so the collapse has a start value.
    if (layer.classList.contains('is-grow') && layer.classList.contains('is-settled')) {
      layer.classList.remove('is-settled');
      reflow(sheet);
    }
    layer.setAttribute('data-state', 'closing');
    layer.inert = true;
    notifyChange();

    const growing = layer.classList.contains('is-grow');
    const ms = (reduced ? 150 : growing ? cssMs('--dur-base', 280) : EXIT_MS) + FALLBACK_SLACK_MS;
    afterTransition(sheet, ms, () => {
      const finish = () => {
        layer.remove();
        closingCount -= 1;
        if (originEl) originEl.classList.remove('is-under-sheet');
        if (!stack.length && !closingCount) {
          const app = appRoot();
          if (app) app.inert = false;
          document.documentElement.classList.remove('has-sheet');
        }
        restoreFocus();
        try { if (typeof onClose === 'function') onClose(result); } catch (err) { console.error('sheet onClose failed', err); }
        resolveClosed(result);
        checkIdle();
      };
      // The × rotates back into + after the circle has collapsed (#3).
      if (entry.fabX) {
        layer.classList.add('is-unrotating');
        afterTransition(entry.fabX, cssMs('--dur-fast', 200) + FALLBACK_SLACK_MS, finish);
      } else {
        finish();
      }
    });
    return closed;
  }

  function restoreFocus() {
    const target = originEl;
    if (!target || !target.isConnected) return;
    const top = stack[stack.length - 1];
    // Only when the origin is reachable again: either no sheet is open, or the
    // origin lives in the sheet that is now on top (nested sheets).
    if (top && !top.layer.contains(target)) return;
    if (target.closest('[inert]')) return;
    target.focus({ preventScroll: true });
  }

  return api;
}

function rawIcon(name, size) {
  return raw(icon(name, { size }));
}

/**
 * Close the top sheet if it is dismissible (Android back / router).
 * @param {any} [result]
 * @returns {boolean} true when a sheet was closed
 */
export function closeTopSheet(result) {
  const top = stack[stack.length - 1];
  if (!top || !top.dismissible) return false;
  top.close(result);
  return true;
}

/**
 * Close every open sheet (e.g. before a full reset). Non-dismissible ones too.
 */
export function closeAllSheets() {
  for (const entry of [...stack].reverse()) entry.close(undefined);
}

/**
 * How many sheets are open (closing ones excluded).
 * @returns {number}
 */
export function openSheetCount() {
  return stack.length;
}

/**
 * Is any sheet open or still animating out? (Theme changes wait for this.)
 * @returns {boolean}
 */
export function sheetsBusy() {
  return stack.length > 0 || closingCount > 0;
}

/**
 * Resolve once no sheet is open or closing.
 * @returns {Promise<void>}
 */
export function whenSheetsIdle() {
  if (!sheetsBusy()) return Promise.resolve();
  return new Promise((r) => idleWaiters.add(r));
}

/**
 * Listen for sheets opening/closing: fn({ count }). The router uses it to
 * keep one history entry per back-able level.
 * @param {(info: { count: number }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onSheetChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
