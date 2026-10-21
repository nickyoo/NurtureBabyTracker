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
//    An origin with [data-sheet-grow="rect"] (the live pill, #6) grows the
//    sheet out of its rect instead: the sheet header starts clipped to the
//    origin's box — or that of its closest [data-sheet-grow-rect] ancestor —
//    and FLIPs/unclips to its resting place over --dur-morph --ease-spring.
//  - Exit: reverse (240 ms ease-in / circle collapse), then the node is
//    removed on transitionend — with a timeout fallback, because a
//    transitionend can be skipped (tab hidden, display change, zero-duration).
//  - Reduced motion (system or in-app [data-motion="reduce"]): opacity only.
//    The + still turns into the × (instantly, no rotation): only the motion
//    is dropped, never the control.
//  - The whole layer ignores pointer taps that land within ENTER_GUARD_MS of
//    opening (guardEnterTaps): the second tap of a double-tap can neither
//    close the sheet it just opened (scrim, ×) nor hit whatever control has
//    grown in under the finger (a "Log wake-up" footer where the live pill
//    was). Keyboard activation is never delayed.
//  - The + twin is placed at the +'s RESTING geometry, measured with the
//    scale of the page behind (.985, possibly mid-transition when one sheet
//    opens another) divided out — so it lands exactly where the + reappears.
//    The origin's .is-sheet-origin / .is-under-sheet are reference-counted:
//    a closing sheet never un-hides a + that another open sheet still covers.
//  - Focus moves into the sheet, is trapped, and returns to the origin — or,
//    when the origin is gone (a finished live pill), to the next sensible
//    place (another pill, the +, the current view): never to <body>.
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
// Taps on the scrim / × this soon after opening are the tail of the tap (or
// double-tap) that opened the sheet, not a request to close it. Esc and
// Back stay immediate.
export const ENTER_GUARD_MS = 350;

const stack = [];          // open sheets, bottom → top (closing ones are removed)
const classHolds = new WeakMap(); // element → Map(className → holders)
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
 *
 * Only `transitionend` counts. A `transitioncancel` is NOT completion: when an
 * exit state is applied while the enter transition is still running (Esc
 * 150 ms after opening), the browser cancels the enter transition at that
 * moment — treating that as "done" removed surfaces 4 ms into their exit.
 * A cancelled exit simply falls through to the timeout.
 * @param {Element} el
 * @param {number} ms
 * @param {() => void} fn
 * @param {{ property?: string|string[] }} [opts] only a transitionend of this
 *   property (or one of these) counts — e.g. 'transform' for a slide-out, so
 *   a late end of some other property can't finish the exit early
 * @returns {() => void} cancel
 */
export function afterTransition(el, ms, fn, { property } = {}) {
  let done = false;
  let timer = 0;
  const props = property ? [].concat(property) : null;
  const onEnd = (e) => {
    if (e.target !== el) return;
    if (props && !props.includes(e.propertyName)) return;
    finish();
  };
  function finish() {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
    fn();
  }
  el.addEventListener('transitionend', onEnd);
  timer = setTimeout(finish, ms);
  return () => { done = true; clearTimeout(timer); el.removeEventListener('transitionend', onEnd); };
}

function usable(el) {
  return !!(el && el.isConnected && typeof el.focus === 'function' && !el.closest('[inert]') && !el.closest('[hidden]') && el.getClientRects().length > 0);
}

/**
 * Where focus should go when the element that had it (or should get it back)
 * no longer exists: another live pill, then the +, then the view on top.
 * Never <body>, which drops keyboard and screen-reader users at the top of
 * the document with nothing announced.
 * @param {{ preferPills?: boolean }} [opts]
 * @returns {HTMLElement|null}
 */
export function focusFallbackTarget({ preferPills = false } = {}) {
  if (typeof document === 'undefined') return null;
  const candidates = [];
  if (preferPills) candidates.push(...document.querySelectorAll('#livePills .lpill:not([inert]) .lpill-open'));
  candidates.push(document.getElementById('fab'));
  candidates.push(...document.querySelectorAll('#tabBar [aria-current="page"]'));
  const views = [...document.querySelectorAll('#viewport > .view')]
    .filter((v) => !v.inert && !v.classList.contains('is-covered') && !v.classList.contains('is-fading-out') && !v.classList.contains('is-leaving-right'));
  if (views.length) candidates.push(views[views.length - 1]);
  return candidates.find(usable) || null;
}

/**
 * Focus the fallback target (see focusFallbackTarget) without scrolling.
 * @param {{ preferPills?: boolean }} [opts]
 * @returns {boolean} whether something took focus
 */
export function focusFallback(opts) {
  const t = focusFallbackTarget(opts);
  if (!t) return false;
  t.focus({ preventScroll: true });
  return true;
}

/**
 * Make `el` ignore pointer taps that belong to the gesture which made it
 * appear: a click whose pointerdown landed inside `el` less than `ms` after
 * `shownAt` (or before it — the press started on whatever was there before)
 * is swallowed in the capture phase, before any handler inside `el` sees it.
 * Keyboard and programmatic activation (click.detail === 0) always pass.
 * Used for every sheet layer and every toast: a double-tap on a live pill
 * must not land its second tap on the sheet / Undo toast the first one put
 * under the finger.
 * @param {EventTarget} el
 * @param {{ shownAt?: number, ms?: number }} [opts] shownAt in performance.now() time
 * @returns {() => void} remove the guard
 */
export function guardEnterTaps(el, { shownAt = now(), ms = ENTER_GUARD_MS } = {}) {
  let downAt = -Infinity;
  let active = true; // (some EventTarget implementations can't remove capture listeners)
  const onDown = () => { downAt = now(); };
  const onClick = (e) => {
    if (!active || !e.detail) return; // Enter / Space / el.click(): deliberate
    if (downAt - shownAt >= ms) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  el.addEventListener('pointerdown', onDown, true);
  el.addEventListener('click', onClick, true);
  return () => {
    active = false;
    el.removeEventListener('pointerdown', onDown, true);
    el.removeEventListener('click', onClick, true);
  };
}

/**
 * Map a rect measured on screen back through an ancestor's 2D transform, i.e.
 * where it would be with the transform removed. Pure (unit-tested).
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} m the ancestor's transform matrix
 * @param {{ x: number, y: number }} origin the ancestor's transform origin, in viewport coordinates
 * @returns {{ left: number, top: number, width: number, height: number, right: number, bottom: number }}
 */
export function untransformRect(rect, m, origin) {
  const det = m.a * m.d - m.b * m.c;
  const out = (l, t, r, b) => ({ left: l, top: t, width: r - l, height: b - t, right: r, bottom: b });
  if (!det || !Number.isFinite(det)) return out(rect.left, rect.top, rect.left + rect.width, rect.top + rect.height);
  // screen = origin + L·(p − origin) + (e, f)  ⇒  p = origin + L⁻¹·(screen − origin − (e, f))
  const inv = (x, y) => {
    const px = x - origin.x - m.e;
    const py = y - origin.y - m.f;
    return [origin.x + (m.d * px - m.c * py) / det, origin.y + (-m.b * px + m.a * py) / det];
  };
  const r = rect.left + rect.width;
  const b = rect.top + rect.height;
  const pts = [inv(rect.left, rect.top), inv(r, rect.top), inv(rect.left, b), inv(r, b)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return out(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/**
 * `el`'s rect as it is when the page behind sheets is NOT scaled: #app's
 * current (possibly mid-transition) transform divided out. The + lives in
 * #app; its twin lives in #sheetRoot, which is never scaled.
 * @param {Element} el
 */
function restingRect(el) {
  const rect = el.getBoundingClientRect();
  const app = appRoot();
  if (!app || !app.contains(el) || typeof DOMMatrixReadOnly !== 'function') return rect;
  const cs = getComputedStyle(app);
  if (!cs.transform || cs.transform === 'none') return rect;
  let m;
  try { m = new DOMMatrixReadOnly(cs.transform); } catch { return rect; }
  if (m.isIdentity) return rect;
  const [ox = 0, oy = 0] = String(cs.transformOrigin).split(' ').map(parseFloat);
  // offsetLeft/Top of the fixed #app: its untransformed box in the viewport.
  return untransformRect(rect, m, { x: app.offsetLeft + ox, y: app.offsetTop + oy });
}

/** Add a class that several sheets may want at once (reference-counted). */
function holdClass(el, cls) {
  let m = classHolds.get(el);
  if (!m) { m = new Map(); classHolds.set(el, m); }
  const n = (m.get(cls) || 0) + 1;
  m.set(cls, n);
  if (n === 1) el.classList.add(cls);
}

/** Release a holdClass(); the class goes once the last holder lets go. */
function releaseClass(el, cls) {
  const m = classHolds.get(el);
  const n = (m && m.get(cls)) || 0;
  if (n > 1) { m.set(cls, n - 1); return; }
  if (m) m.delete(cls);
  el.classList.remove(cls);
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

// ------------------------------------------------ shared-element flights
//
// #16 (card / row → its sheet): the header icon chip FLIPs from the tapped
// card's icon (or row's chip) as the sheet rises, and back on close.
// #6 (running-timer sheet → its live pill): on dismiss, the sheet shrinks
// back INTO the pill's rect — the reverse of the rect grow it opened with —
// and fades onto the pill as it lands, while the timer numeral flies into
// the pill's time. The pill itself never moves or blinks.
// Flights use a fixed-position copy in #sheetRoot (above every layer), so
// the real element's own layout — and the sheet's own motion — are
// untouched. Never under reduced motion.
//
// Hooks a sheet can carry (all optional):
//  - [data-sheet-icon]  its header icon, the #16 landing spot. Without one,
//    a header chip carrying the card's icon is added (.sheet-hd-chip).
//  - [data-pill-for="<event id>"]  "this sheet shows that running event":
//    dismissing it shrinks it into that event's live pill (#6). On a
//    [data-timer] element, the numeral also flies into the pill's time. A
//    sheet opened FROM a live pill goes back into it even without the hook.

/** The icon a card or row carries: a row's chip, a card's label icon. */
function originIcon(el) {
  return el.querySelector('[data-sheet-icon]') || el.querySelector('.chip-ic') || el.querySelector('.ql-label .ic') || null;
}

/**
 * The transform that maps a box laid out at `home` onto `rect` (transform
 * origin top-left). `uniform` keeps the aspect ratio (text), scaling by
 * height and centring horizontally. Pure (unit-tested).
 * @param {{ left: number, top: number, width: number, height: number }} home
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ uniform?: boolean }} [o]
 * @returns {string}
 */
export function flipTransform(home, rect, { uniform = false } = {}) {
  const r = (n) => Math.round(n * 10000) / 10000;
  const sx = home.width ? rect.width / home.width : 1;
  const sy = home.height ? rect.height / home.height : 1;
  if (uniform) {
    const s = sy;
    const dx = rect.left + rect.width / 2 - (home.left + (home.width * s) / 2);
    return `translate(${r(dx)}px, ${r(rect.top - home.top)}px) scale(${r(s)})`;
  }
  return `translate(${r(rect.left - home.left)}px, ${r(rect.top - home.top)}px) scale(${r(sx)}, ${r(sy)})`;
}

/**
 * Fly a copy of `el` from one viewport rect to another, then remove it.
 * The copy is laid out at `home` — the element's own natural box, so text
 * and icons keep their real size there — and transformed from `from` to `to`.
 * Resolves when done (or after a fallback).
 * @param {Element} el what the copy looks like
 * @param {DOMRect|object} home the box the copy is laid out in
 * @param {DOMRect|object} from start rect
 * @param {DOMRect|object} to end rect
 * @param {{ duration: number, easing: string, fadeOut?: boolean, fadeIn?: boolean, uniform?: boolean, color?: [string, string] }} o
 *   fadeOut: fade over the last 40% (merging into a visible target);
 *   fadeIn: start at .4 (lifting off a target that stays visible)
 * @returns {Promise<void>}
 */
function flyCopy(el, home, from, to, o) {
  return new Promise((resolve) => {
    const c = el.cloneNode(true);
    c.removeAttribute('id');
    c.removeAttribute('data-sheet-icon');
    c.setAttribute('aria-hidden', 'true');
    // The real element is hidden while its copy flies — the copy must not be.
    c.style.removeProperty('visibility');
    c.classList.add('sheet-flight');
    // Inline, so the element's own rules (loaded after components.css, same
    // specificity — e.g. .fd-timer's centred transform-origin) can't move it.
    c.style.setProperty('position', 'fixed');
    c.style.setProperty('margin', '0');
    c.style.setProperty('transform-origin', '0 0');
    c.style.setProperty('left', `${home.left}px`);
    c.style.setProperty('top', `${home.top}px`);
    c.style.setProperty('width', `${home.width}px`);
    c.style.setProperty('height', `${home.height}px`);
    sheetRoot().appendChild(c);
    const k0 = { transform: flipTransform(home, from, o), opacity: o.fadeIn ? 0.4 : 1 };
    const k1 = { transform: flipTransform(home, to, o), opacity: o.fadeOut ? 0 : 1 };
    if (o.color) { k0.color = o.color[0]; k1.color = o.color[1]; }
    const frames = o.fadeOut ? [k0, { opacity: 1, offset: 0.6 }, k1] : [k0, k1];
    let done = false;
    const end = () => { if (done) return; done = true; c.remove(); resolve(); };
    try {
      const a = c.animate(frames, { duration: o.duration, easing: o.easing, fill: 'forwards' });
      a.onfinish = end;
      a.oncancel = end;
    } catch { end(); return; }
    setTimeout(end, o.duration + 400);
  });
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function onScreen(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/**
 * @typedef {object} SheetApi
 * @property {(result?: any) => Promise<any>} close   close (animated); resolves after removal
 * @property {(title: string) => void} setTitle
 * @property {(renderFn: (body: HTMLElement, api: SheetApi) => (void|(() => void)), opts?: { direction?: 'forward'|'back'|'morph' }) => HTMLElement} step
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
 * @param {Element|null} [opts.origin] the trigger: gets a pressed state, focus returns to it; an origin with [data-sheet-grow] makes the sheet grow out of it with a × twin (the +); [data-sheet-grow="rect"] grows it out of the origin's rect, or its closest [data-sheet-grow-rect] ancestor's (the live pill)
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
  const growMode = originEl ? originEl.getAttribute('data-sheet-grow') : null;
  // A + origin keeps its × twin under reduced motion (DESIGN §7.3: swap the
  // icon instantly); only the clip-path growth and the rotation are dropped.
  const fabOrigin = growMode !== null && growMode !== 'rect';
  const grow = fabOrigin && !reduced;
  const rectGrow = growMode === 'rect' && !reduced;
  const originInPills = !!(originEl && originEl.closest('#livePills'));
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
    id, layer, sheet, dismissible, close: null, origin: originEl, fabX: null, openedAt: now(),
  };
  layer.classList.add('is-measuring');
  if (fabOrigin) layer.classList.add('is-fab');
  if (grow) layer.classList.add('is-grow');
  if (rectGrow) layer.classList.add('is-rect');
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

  if (originEl) holdClass(originEl, 'is-sheet-origin');

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

  // ---- the + becomes the × (DESIGN §7.2 #3, §7.3) ----
  if (fabOrigin) {
    // The +'s resting geometry: centre with #app's scale divided out (a
    // sheet opened from a quick-log tile measures while the page behind is
    // still at / easing to .985), size from layout (ignores a press scale).
    const o = restingRect(originEl);
    const size = originEl.offsetWidth || o.width;
    const cx = o.left + o.width / 2;
    const cy = o.top + o.height / 2;
    if (grow) {
      const s = sheet.getBoundingClientRect();
      sheet.style.setProperty('--grow-x', `${cx - s.left}px`);
      sheet.style.setProperty('--grow-y', `${cy - s.top}px`);
      sheet.style.setProperty('--grow-r', `${size / 2}px`);
    }
    const fabX = element(html`<button type="button" class="fab-x" aria-label="Close">${rawIcon('plus-bold', 30)}</button>`);
    fabX.style.setProperty('--fab-left', `${cx - size / 2}px`);
    fabX.style.setProperty('--fab-top', `${cy - size / 2}px`);
    fabX.style.setProperty('--fab-size-px', `${size}px`);
    fabX.addEventListener('click', () => { if (entered()) api.close(undefined); });
    layer.appendChild(fabX);
    entry.fabX = fabX;
    holdClass(originEl, 'is-under-sheet');
    if (grow) {
      // Tiles rise in, staggered 20 ms from 120 ms (motion contract #3).
      [...currentStep.querySelectorAll('[data-stagger]')].forEach((el, i) => el.style.setProperty('--stagger-i', String(i)));
      layer.classList.add('is-staggered');
    }
  }

  // ---- grow out of a rect: the live pill (DESIGN §7.2 #6) ----
  if (rectGrow) {
    const box = (originEl.closest('[data-sheet-grow-rect]') || originEl).getBoundingClientRect();
    const s = sheet.getBoundingClientRect(); // .is-rect rests at transform:none in the pre state
    const dy = Math.max(0, box.top - s.top);
    const radius = Math.min(box.height / 2, parseFloat(getComputedStyle(originEl.closest('[data-sheet-grow-rect]') || originEl).borderTopLeftRadius) || box.height / 2);
    // Start: the sheet's HEADER strip, the pill's size, sitting on the pill.
    sheet.style.setProperty('--rg-y', `${dy}px`);
    sheet.style.setProperty('--rg-l', `${Math.max(0, box.left - s.left)}px`);
    sheet.style.setProperty('--rg-r', `${Math.max(0, s.right - box.right)}px`);
    sheet.style.setProperty('--rg-b', `${Math.max(0, s.height - box.height)}px`);
    sheet.style.setProperty('--rg-rad', `${radius}px`);
  }

  // ---- card / row → sheet: the icon chip flies in (#16) ----
  let chipFlight = null; // { chip, icon } once set up
  if (!reduced && !fabOrigin && growMode === null && originEl && originEl.matches('.ql, .row') && typeof Element.prototype.animate === 'function') {
    const icon = originIcon(originEl);
    const s0 = sheet.getBoundingClientRect();
    // The sheet's declared header icon, else a header chip carrying the
    // card's icon. Never an arbitrary .chip-ic in the body: the sleep sheet's
    // "Awake" sun or a stash picker's pouch would be the wrong symbol.
    let chip = layer.querySelector('[data-sheet-icon]');
    if (chip && chip.getBoundingClientRect().top - s0.top > 160) chip = null;
    if (!chip && icon && title) {
      const cat = [...originEl.classList].find((c) => /^cat-[\w-]+$/.test(c)) || '';
      chip = element(html`<span class="chip-ic sheet-hd-chip ${cat}" aria-hidden="true"></span>`);
      const svg = (icon.matches('svg') ? icon : icon.querySelector('svg'));
      if (svg) chip.appendChild(svg.cloneNode(true));
      layer.querySelector('.sheet-hd').insertBefore(chip, titleEl);
    }
    if (chip && icon) chipFlight = { chip, icon };
  }

  // ---- enter ----
  // Commit the pre state WITH the --grow-* / --rg-* geometry while
  // transitions are still off (.is-measuring): the measuring pass above
  // already computed a style with the geometry unset, so setting it with
  // transitions on would start a transition from the unset values — and the
  // enter would then begin there (at rest) instead of on the + / the pill.
  reflow(layer);
  layer.classList.remove('is-measuring');
  reflow(layer);
  layer.setAttribute('data-state', 'open');
  if (grow || rectGrow) {
    const dur = grow ? cssMs('--dur-grow', 420) : cssMs('--dur-morph', 320);
    afterTransition(sheet, dur + FALLBACK_SLACK_MS, () => {
      // Drop the clip once grown: a clip-path costs compositing every frame
      // and would clip the sheet's own shadow.
      if (layer.getAttribute('data-state') === 'open') layer.classList.add('is-settled');
    }, { property: 'clip-path' });
  }
  if (chipFlight) {
    // Where the chip will rest: measured now (sheet at translateY(100%) in
    // the pre state), minus that offset. It flies there from the icon.
    const { chip, icon } = chipFlight;
    const r = chip.getBoundingClientRect();
    const sheetH = sheet.offsetHeight;
    const rest = { left: r.left, top: r.top - sheetH, width: r.width, height: r.height };
    const from = icon.getBoundingClientRect();
    if (from.width && r.width) {
      chip.style.setProperty('visibility', 'hidden');
      flyCopy(chip, rest, from, rest, { duration: cssMs('--dur-morph', 320), easing: cssVar('--ease-std', 'ease'), fadeIn: true })
        .then(() => chip.style.removeProperty('visibility'));
    } else {
      chipFlight = null;
    }
  }
  focusInitial();
  notifyChange();

  // ---- the tail of the opening tap hits nothing in the layer ----
  guardEnterTaps(layer, { shownAt: entry.openedAt });

  // ---- dismiss gestures ----
  scrim.addEventListener('click', () => { if (entry.dismissible && isTop() && entered()) close(undefined); });
  closeBtn.addEventListener('click', () => close(undefined));
  bindDrag();

  function isTop() { return stack[stack.length - 1] === entry; }
  // Past the enter guard: a tap now is a deliberate one (see ENTER_GUARD_MS).
  function entered() { return now() - entry.openedAt >= ENTER_GUARD_MS; }

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
    // 'morph': cross-fade only, no slide — for a step where one element
    // FLIPs from the old step into the new one (#5).
    const dir = direction === 'back' ? 'is-back' : direction === 'morph' ? 'is-morph' : 'is-fwd';
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
        layer.classList.remove('is-grow', 'is-rect', 'is-settled');
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

  // A dismissed running-timer sheet (#6): the live pill it goes back into —
  // the event it shows ([data-pill-for]), else the pill it was opened from —
  // plus its timer numeral and the pill's time, when both are on screen.
  // Null when there is no such pill still running and on screen (finished,
  // discarded: the sheet then leaves the ordinary way), under reduced motion,
  // when the sheet is closed with a result (an action, not a dismissal), on a
  // drag (the slide follows the finger), or mid-growth from the + (a circle
  // clip can't interpolate to the pill's rect).
  function livePillTarget(result) {
    if (reduced || result !== undefined) return null;
    if (layer.classList.contains('is-drag-close')) return null;
    if (layer.classList.contains('is-grow') && !layer.classList.contains('is-settled')) return null;
    const alive = [...document.querySelectorAll('#livePills .lpill')].filter((p) => !p.inert && !p.hasAttribute('data-ending'));
    const tagged = currentStep.querySelector('[data-pill-for]');
    let pill = tagged ? alive.find((p) => p.getAttribute('data-event-id') === tagged.getAttribute('data-pill-for')) : null;
    if (!pill && originInPills) pill = alive.find((p) => p.contains(originEl)) || null;
    if (!pill || !onScreen(pill)) return null;
    const timer = (tagged && tagged.matches('[data-timer]') ? tagged : null) || (originInPills ? currentStep.querySelector('[data-timer]') : null);
    const time = pill.querySelector('.lpill-time');
    const fly = !!(timer && time && onScreen(timer) && typeof Element.prototype.animate === 'function');
    return { pill, timer: fly ? timer : null, time: fly ? time : null };
  }

  function close(result) {
    if (entry.closing) return closed;
    entry.closing = true;
    // Measure the shared elements before anything changes (#6, #16).
    const toPill = livePillTarget(result);
    const chipBack = !toPill && chipFlight && onScreen(chipFlight.icon) && chipFlight.chip.isConnected ? chipFlight : null;
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    closingCount += 1;

    for (const fn of [stepCleanup]) {
      if (typeof fn === 'function') { try { fn(); } catch (err) { console.error('sheet cleanup failed', err); } }
    }
    stepCleanup = null;
    if (originEl) releaseClass(originEl, 'is-sheet-origin');

    const top = stack[stack.length - 1];
    if (top) top.layer.inert = false;
    if (!stack.length) {
      const app = appRoot();
      if (app) app.classList.remove('is-behind-sheet');
    }

    if (toPill) {
      // #6: shrink back INTO the live pill — the rect grow in reverse: the
      // sheet's header strip, the pill's size and radius, lands on the pill
      // (translateY + inset clip, --dur-morph on the spring) and fades onto
      // it. Not the slide, not the + collapse. The pill's RESTING rect: the
      // page behind is easing back from its .985 scale meanwhile.
      const box = restingRect(toPill.pill);
      const radius = Math.min(box.height / 2, parseFloat(getComputedStyle(toPill.pill).borderTopLeftRadius) || box.height / 2);
      const midGrow = layer.classList.contains('is-rect') && !layer.classList.contains('is-settled');
      if (!midGrow) {
        // Commit an explicit start (the full sheet as an inset clip, where
        // it is now) so the clip has a value to interpolate from: a settled
        // sheet has clip-path none, a + sheet had a circle.
        layer.classList.add('is-measuring');
        layer.classList.remove('is-grow', 'is-rect', 'is-settled', 'is-staggered');
        layer.classList.add('is-to-pill');
        reflow(sheet);
        layer.classList.remove('is-measuring');
      } else {
        // Still growing out of this pill: reverse from wherever it is.
        layer.classList.remove('is-rect');
        layer.classList.add('is-to-pill');
      }
      // The sheet's layout box (transforms ignored: it may be mid-rise or
      // mid-grow); the layer is fixed at the viewport's origin.
      const sTop = sheet.offsetTop;
      const sLeft = sheet.offsetLeft;
      const sRight = sLeft + sheet.offsetWidth;
      sheet.style.setProperty('--rg-y', `${box.top - sTop}px`);
      sheet.style.setProperty('--rg-l', `${Math.max(0, box.left - sLeft)}px`);
      sheet.style.setProperty('--rg-r', `${Math.max(0, sRight - box.right)}px`);
      sheet.style.setProperty('--rg-b', `${Math.max(0, sheet.offsetHeight - box.height)}px`);
      sheet.style.setProperty('--rg-rad', `${radius}px`);
      reflow(sheet);
      if (toPill.timer) {
        // …while the numeral flies into the pill's time.
        const from = toPill.timer.getBoundingClientRect();
        const to = restingRect(toPill.time);
        const color = [getComputedStyle(toPill.timer).color, getComputedStyle(toPill.time).color];
        toPill.timer.style.setProperty('visibility', 'hidden');
        flyCopy(toPill.timer, from, from, to, {
          duration: cssMs('--dur-morph', 320), easing: cssVar('--ease-spring', 'ease'), uniform: true, color,
        });
      }
    } else {
      // Grown sheets collapse back into the ×: restore the full circle first
      // (it was dropped once settled) so the collapse has a start value.
      if ((layer.classList.contains('is-grow') || layer.classList.contains('is-rect')) && layer.classList.contains('is-settled')) {
        layer.classList.remove('is-settled');
        reflow(sheet);
      }
      if (chipBack) {
        // #16 reverse: the chip flies back to the card / row it came from.
        const from = chipBack.chip.getBoundingClientRect();
        const to = restingRect(chipBack.icon);
        // A row's chip looks just like the copy: hide it, land opaque, swap.
        // A card's bare icon doesn't: it stays, and the copy fades into it.
        const swap = chipBack.icon.matches('.chip-ic');
        chipBack.chip.style.setProperty('visibility', 'hidden');
        if (swap) chipBack.icon.style.setProperty('visibility', 'hidden');
        flyCopy(chipBack.chip, from, from, to, { duration: cssMs('--dur-morph', 320), easing: cssVar('--ease-std', 'ease'), fadeOut: !swap })
          .then(() => { if (swap) chipBack.icon.style.removeProperty('visibility'); });
      }
    }
    layer.setAttribute('data-state', 'closing');
    layer.inert = true;
    notifyChange();

    const growing = layer.classList.contains('is-grow');
    const ms = (reduced ? 150 : toPill ? cssMs('--dur-morph', 320) : growing ? cssMs('--dur-base', 280) : EXIT_MS) + FALLBACK_SLACK_MS;
    // Wait for the EXIT property only (see afterTransition): the circle
    // collapse, the opacity fade, or the slide.
    const exitProp = reduced ? 'opacity' : growing ? 'clip-path' : 'transform';
    afterTransition(sheet, ms, () => {
      const finish = () => {
        layer.remove();
        closingCount -= 1;
        if (originEl && entry.fabX) releaseClass(originEl, 'is-under-sheet');
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
      // Reduced motion: no rotation to wait for — the + simply reappears.
      if (entry.fabX && !reduced) {
        layer.classList.add('is-unrotating');
        afterTransition(entry.fabX, cssMs('--dur-fast', 200) + FALLBACK_SLACK_MS, finish, { property: 'transform' });
      } else {
        finish();
      }
    }, { property: exitProp });
    return closed;
  }

  function restoreFocus() {
    const top = stack[stack.length - 1];
    const active = document.activeElement;
    if (top) {
      // A sheet is still open (nested, or opened by this one's action).
      // Return to the origin only if it lives in that sheet; otherwise
      // make sure focus is inside the top sheet (the trap) and leave it.
      if (originEl && top.layer.contains(originEl) && usable(originEl)) { originEl.focus({ preventScroll: true }); return; }
      if (!top.layer.contains(active)) top.sheet.focus({ preventScroll: true });
      return;
    }
    if (usable(originEl)) { originEl.focus({ preventScroll: true }); return; }
    // The origin is gone (a finished live pill, a re-rendered row). Don't
    // drop focus to <body> — unless something else already took it.
    if (active && active !== document.body && active.isConnected && !active.closest('[inert]')) return;
    focusFallback({ preferPills: originInPills });
  }

  return api;
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
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
