// Live pills (ARCHITECTURE §7.5, DESIGN §6.5 + motion contract #6, #17).
//
// One dark pill per RUNNING event (endTime === null), for every baby,
// stacked above the nav on every tab and docked above the home indicator on
// pushed screens. Each shows: a 44px well (progress ring + category icon +
// live dot) · title + sub-line · a 1 Hz wall-clock timer · a 44px Finish.
//
// Sheets own what "open" and "finish" mean, so they register handlers:
//
//   livePill.register('feed', {
//     open(event, origin)   { openFeedSheet(ctx, { origin, resume: event }); },
//     finish(event, origin) { openFeedSheet(ctx, { origin, resume: event, step: 'amount' }); },
//   });
//   livePill.register('feed:breast', { … })   // more specific: type:method
//
// Without a handler, Finish stops the activity and offers Undo, and tapping
// the pill opens a small sheet with a Finish button — never a dead control.
//
// Clocks derive from timestamps on every tick (never a counter), tick once a
// second aligned to the wall clock, and stop entirely while the page is
// hidden. Bottle countdowns come from domain/safety.js bottleSafety().

import { html, element, raw, render } from './html.js';
import { icon } from './icons.js';
import { openSheet, motionReduced, afterTransition, focusFallback } from './sheet.js';
import { timerClock } from '../core/time.js';
import { bottleSafety, breastSideTotals, switchBreastSide } from '../domain/safety.js';
import { clock, spanSpoken, babyName } from './format.js';

const RING_C = 2 * Math.PI * 20; // r = 20 in a 44 viewBox
const WARN_SEC = 10 * 60;        // DESIGN §6.5: warning under 10 minutes
const ANNOUNCE_GAP_MS = 60 * 1000;

const handlers = new Map();
let inst = null;

/**
 * Register what Open / Finish do for a running event type. Keys: 'feed',
 * 'pump', 'sleep', or 'type:method' (e.g. 'feed:breast', 'feed:bottle') which
 * wins over the plain type. A bare function is treated as { open }.
 * Later registrations replace earlier ones.
 * @param {string} key
 * @param {((event: object, origin: Element) => void) | { open?: Function, finish?: Function, resume?: Function, discard?: Function }} h
 * @returns {() => void} unregister
 */
export function register(key, h) {
  const norm = typeof h === 'function' ? { open: h } : { ...(h || {}) };
  handlers.set(String(key), norm);
  return () => { if (handlers.get(String(key)) === norm) handlers.delete(String(key)); };
}

function handlerFor(event) {
  const method = event && event.data && event.data.method;
  return (method && handlers.get(`${event.type}:${method}`)) || handlers.get(event.type) || {};
}

// --------------------------------------------------------------- model

/**
 * Everything a pill displays for one running event at one instant. Pure
 * (exported for tests and for sheets that want the same wording).
 * @param {object} event a running event
 * @param {number} now
 * @param {{ storageWindows?: object, babies?: Array<{id: string, name: string}> }} [opts]
 * @returns {{ kind: string, cat: string, icon: string, title: string, sub: string, subIcon: string|null, level: string, time: string, ring: number, finishLabel: string, openLabel: string, spoken: string }}
 */
export function pillModel(event, now, { storageWindows, babies = [] } = {}) {
  const d = event.data || {};
  const elapsedMs = Math.max(0, now - event.startTime);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  let m;
  if (event.type === 'feed' && d.method === 'breast') {
    const totals = breastSideTotals(d, now);
    const paused = !d.activeSide;
    m = {
      kind: 'breast', cat: 'feed', icon: 'breast', title: 'Breastfeed',
      sub: paused ? 'Paused' : `${d.activeSide === 'left' ? 'Left' : 'Right'} side`,
      subIcon: paused ? 'pause' : null, level: paused ? 'paused' : 'ok',
      time: timerClock(totals.total), ring: (totals.total % 1800) / 1800,
      finishLabel: paused ? 'Resume' : 'Finish', openLabel: 'Open breastfeeding timer',
    };
  } else if (event.type === 'feed') {
    const s = bottleSafety(event, now, storageWindows);
    const remaining = s ? s.safetyRemainingSec : 0;
    const windowH = s ? Math.round(s.windowSec / 3600) : 1;
    let level = 'ok';
    let sub = s ? `good for ${s.label}` : '';
    if (s && s.expired) { level = 'expired'; sub = `Past ${windowH}h · discard`; } else if (s && remaining < WARN_SEC) { level = 'soon'; sub = `use within ${Math.max(1, Math.ceil(remaining / 60))} min`; }
    m = {
      kind: 'bottle', cat: 'feed', icon: 'bottle', title: 'Bottle', sub,
      subIcon: level === 'ok' ? null : 'clock', level,
      time: timerClock(elapsedSec), ring: s ? 1 - s.fraction : 0,
      finishLabel: level === 'expired' ? 'Discard' : 'Finish', openLabel: 'Open bottle timer',
    };
  } else if (event.type === 'pump') {
    m = {
      kind: 'pump', cat: 'pump', icon: 'pump', title: 'Pump', sub: `since ${clock(event.startTime)}`, subIcon: null,
      level: 'ok', time: timerClock(elapsedSec), ring: Math.min(1, elapsedMs / (20 * 60 * 1000)),
      finishLabel: 'Finish', openLabel: 'Open pump timer',
    };
  } else if (event.type === 'sleep') {
    m = {
      kind: 'sleep', cat: 'sleep', icon: 'moon', title: d.kind === 'night' ? 'Night sleep' : 'Nap',
      sub: `since ${clock(event.startTime)}`, subIcon: null, level: 'ok', time: timerClock(elapsedSec),
      ring: (elapsedMs % 3600000) / 3600000, finishLabel: d.kind === 'night' ? 'Wake up' : 'End nap', openLabel: 'Open sleep timer',
    };
  } else {
    m = {
      kind: event.type, cat: 'neutral', icon: 'clock', title: 'Running', sub: `since ${clock(event.startTime)}`, subIcon: null,
      level: 'ok', time: timerClock(elapsedSec), ring: 0, finishLabel: 'Finish', openLabel: 'Open timer',
    };
  }
  // Name the child only when there is more than one (twins can both nap).
  if (event.babyId && babies.length > 1) {
    const b = babies.find((x) => x.id === event.babyId);
    if (b) m.title = `${babyName(b)} · ${m.title}`;
  }
  m.spoken = `${m.title}, ${m.level === 'paused' ? 'paused' : 'running'}, ${spanSpoken(elapsedMs)}${m.sub ? `, ${m.sub}` : ''}`;
  return m;
}

// ----------------------------------------------------------------- DOM

function pillTemplate(event, m) {
  return html`
    <div class="lpill lp-${m.cat}" role="group" aria-label="${m.spoken}" data-event-id="${event.id}" data-kind="${m.kind}" data-level="${m.level}" data-state="pre" data-sheet-grow-rect>
      <button type="button" class="lpill-open" aria-label="${m.openLabel}" data-sheet-grow="rect">
        <span class="lpill-well">
          <svg class="lpill-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
            <circle class="lpill-ring-track" cx="22" cy="22" r="20"></circle>
            <circle class="lpill-ring-arc" cx="22" cy="22" r="20"></circle>
          </svg>
          ${raw(icon(m.icon, { size: 22 }))}
          <span class="lpill-dot"></span>
        </span>
        <span class="lpill-txt"><b class="lpill-title">${m.title}</b><small class="lpill-sub"></small></span>
        <span class="lpill-time num" aria-hidden="true">${m.time}</span>
      </button>
      <button type="button" class="lpill-finish">${m.finishLabel}</button>
    </div>`;
}

function paint(el, m, minuteChanged) {
  el.querySelector('.lpill-time').textContent = m.time;
  const arc = el.querySelector('.lpill-ring-arc');
  arc.style.setProperty('stroke-dasharray', `${(RING_C * Math.max(0, Math.min(1, m.ring))).toFixed(2)} ${RING_C.toFixed(2)}`);
  if (el.getAttribute('data-level') !== m.level || !el.__painted) el.setAttribute('data-level', m.level);
  const fin = el.querySelector('.lpill-finish');
  if (fin.textContent !== m.finishLabel) fin.textContent = m.finishLabel; // e.g. a nap switched to night sleep
  const subKey = `${m.subIcon || ''}|${m.sub}`;
  if (el.__subKey !== subKey) {
    el.__subKey = subKey;
    render(el.querySelector('.lpill-sub'), html`${m.subIcon ? raw(icon(m.subIcon, { size: 14 })) : ''}${m.sub}`);
  }
  const title = el.querySelector('.lpill-title');
  if (title.textContent !== m.title) title.textContent = m.title;
  // The group's label is read on focus; refresh it once a minute, not every
  // second (DESIGN §6.5: announce at most once a minute).
  if (minuteChanged || !el.__painted) el.setAttribute('aria-label', m.spoken);
  el.__painted = true;
}

/**
 * Mount the live pills into #livePills. Call once at boot.
 * @param {HTMLElement} root
 * @param {object} ctx the app ctx (events, settings, toast, router)
 * @returns {{ refresh: () => Promise<void>, unmount: () => void }}
 */
export function mount(root, ctx) {
  if (inst) inst.unmount();
  const { events, settings } = ctx;
  const pills = new Map(); // id → { el, event }
  const finished = new Set(); // ids that ended by being finished (vs deleted)
  let running = [];
  let timer = 0;
  let initial = true;
  let lastMinute = -1;
  let lastAnnounce = 0;
  let refreshing = null;
  let refreshAgain = false;
  let stopped = false;

  root.setAttribute('aria-label', 'Running now');
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  const announce = (text) => {
    const now = Date.now();
    if (now - lastAnnounce < ANNOUNCE_GAP_MS) return;
    lastAnnounce = now;
    live.textContent = text;
  };

  const opts = () => ({ storageWindows: settings.get('storageWindows'), babies: settings.get('babies') || [] });

  function setCount() {
    const n = pills.size;
    document.body.setAttribute('data-pills', String(n));
    document.body.style.setProperty('--pill-count', String(n));
  }

  function tick() {
    clearTimeout(timer);
    if (stopped || document.hidden) return;
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const minuteChanged = minute !== lastMinute;
    lastMinute = minute;
    const o = opts();
    for (const { el, event } of pills.values()) {
      const m = pillModel(event, now, o);
      const prevLevel = el.getAttribute('data-level');
      paint(el, m, minuteChanged);
      if (prevLevel && prevLevel !== m.level && (m.level === 'soon' || m.level === 'expired')) announce(`${m.title}: ${m.sub}`);
    }
    if (!pills.size) return;
    // Wake just after the next whole second of the soonest-turning timer
    // (each counts from its own start, not from the wall clock's second).
    const t = Date.now();
    let delay = 1000;
    for (const { event } of pills.values()) {
      const anchor = (event.data && Number.isFinite(event.data.activeSince) && event.data.activeSince) || event.startTime;
      delay = Math.min(delay, 1000 - (((t - anchor) % 1000) + 1000) % 1000);
    }
    timer = setTimeout(tick, Math.max(20, delay + 5));
  }

  function addPill(event, animate) {
    const m = pillModel(event, Date.now(), opts());
    const el = element(pillTemplate(event, m));
    paint(el, m, true);
    // Origins are the buttons themselves, so focus returns to them when the
    // sheet they open closes. The open button carries data-sheet-grow="rect"
    // (and the pill data-sheet-grow-rect), so ANY sheet opened from it —
    // registered handler or fallback — grows out of the pill's rect (#6).
    const openBtn = el.querySelector('.lpill-open');
    const finishBtn = el.querySelector('.lpill-finish');
    openBtn.addEventListener('click', () => onOpen(event.id, openBtn));
    finishBtn.addEventListener('click', () => onFinish(event.id, finishBtn));
    root.insertBefore(el, live);
    if (animate) {
      // rise --move-md and fade in (reduced motion: the tokens zero the move)
      el.getBoundingClientRect();
      el.setAttribute('data-state', 'in');
    } else {
      el.setAttribute('data-state', 'static');
    }
    pills.set(event.id, { el, event });
    if (animate) announce(`${m.title} timer running`);
  }

  function removePill(id) {
    const p = pills.get(id);
    if (!p) return;
    pills.delete(id);
    const { el } = p;
    // Inerting a focused pill would drop focus to <body>: hand it to the
    // next pill first, else the + / current view (sheet.js fallback chain).
    if (el.contains(document.activeElement)) {
      const next = [...root.querySelectorAll('.lpill:not([inert]) .lpill-open')].find((b) => !el.contains(b));
      if (next) next.focus({ preventScroll: true }); else focusFallback();
    }
    el.inert = true;
    const wasFinished = finished.delete(id);
    // Finish shrinks the pill into its new timeline row when that row is on
    // screen, otherwise into the Today tab, which gets a one-shot dot (#6).
    let target = null;
    if (wasFinished) {
      const section = ctx.router && ctx.router.activeSection ? ctx.router.activeSection() : null;
      const row = section ? section.querySelector(`[data-event-id="${CSS.escape(id)}"]`) : null;
      if (row && isOnScreen(row)) target = row;
      else if (ctx.router && ctx.router.tabButton) {
        target = ctx.router.tabButton('today');
        if (target && !ctx.router.current().screen && ctx.router.current().tab !== 'today') {
          target.classList.add('has-dot');
          setTimeout(() => target.classList.remove('has-dot'), 2600);
        }
      }
    }
    const from = el.getBoundingClientRect();
    if (target && !motionReduced() && typeof el.animate === 'function') {
      const to = target.getBoundingClientRect();
      const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
      const s = Math.max(0.08, Math.min(1, to.height / from.height));
      const anim = el.animate(
        [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 }],
        { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
      );
      anim.onfinish = () => { el.remove(); };
      setTimeout(() => el.remove(), 700);
    } else {
      el.setAttribute('data-state', 'out');
      afterTransition(el, 450, () => el.remove(), { property: 'opacity' });
    }
  }

  function isOnScreen(node) {
    const r = node.getBoundingClientRect();
    return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  async function refresh() {
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => {
      try {
        running = await events.running();
      } catch (err) {
        console.error('live pill refresh failed', err);
        return;
      }
      if (stopped) return;
      const ids = new Set(running.map((e) => e.id));
      for (const id of [...pills.keys()]) if (!ids.has(id)) removePill(id);
      for (const e of running) {
        const p = pills.get(e.id);
        if (p) p.event = e; else addPill(e, !initial);
      }
      // keep DOM order = start order (oldest closest to the nav). Only move
      // nodes when the order is actually wrong: re-inserting a node blurs
      // it, which would drop a keyboard user's focus on a pill to <body>.
      const want = running.map((e) => pills.get(e.id)).filter(Boolean).map((p) => p.el);
      const have = [...root.children].filter((n) => want.includes(n));
      if (want.some((n, i) => have[i] !== n)) {
        const active = document.activeElement;
        for (const n of want) root.insertBefore(n, live);
        if (active && active !== document.activeElement && active.isConnected) active.focus({ preventScroll: true });
      }
      initial = false;
      setCount();
      tick();
    })();
    try { await refreshing; } finally {
      refreshing = null;
      if (refreshAgain) { refreshAgain = false; refresh(); }
    }
    return undefined;
  }

  async function onOpen(id, el) {
    const p = pills.get(id);
    if (!p) return;
    const h = handlerFor(p.event);
    if (typeof h.open === 'function') { h.open(p.event, el); return; }
    fallbackSheet(p.event, el);
  }

  async function onFinish(id, el) {
    const p = pills.get(id);
    if (!p) return;
    const event = p.event;
    const h = handlerFor(event);
    const level = p.el.getAttribute('data-level');
    try {
      if (level === 'paused') {
        if (typeof h.resume === 'function') { h.resume(event, el); return; }
        await events.update(event.id, { data: switchBreastSide(event.data, event.data.lastSide === 'right' ? 'right' : 'left', Date.now()) });
        return;
      }
      if (level === 'expired' && typeof h.discard === 'function') { h.discard(event, el); return; }
      if (typeof h.finish === 'function') { finished.add(event.id); h.finish(event, el, { expired: level === 'expired' }); return; }
      await defaultFinish(event);
    } catch (err) {
      console.error('finish failed', err);
    }
  }

  async function defaultFinish(event) {
    finished.add(event.id);
    const m = pillModel(event, Date.now(), opts());
    await events.stop(event.id);
    if (ctx.toast) {
      ctx.toast({
        message: `${m.title} logged`,
        action: { label: 'Undo', run: () => events.update(event.id, { endTime: null }) },
      });
    }
  }

  function fallbackSheet(event, origin) {
    const m = pillModel(event, Date.now(), opts());
    openSheet({
      title: m.title,
      origin,
      render(body, api) {
        render(body, html`<p class="sheet-text">${m.sub}</p>
          <div class="sheet-footer"><button type="button" class="btn btn-primary btn-block" data-finish>${m.finishLabel}</button></div>`);
        body.querySelector('[data-finish]').addEventListener('click', async () => {
          api.close();
          await defaultFinish(event);
        });
      },
    });
  }

  const offEvents = events.subscribe((change) => {
    if (!change) return;
    const e = change.event;
    const prev = change.prev;
    if (change.op === 'update' && prev && prev.endTime === null && e && e.endTime !== null) finished.add(e.id);
    const relevant = change.op === 'bulk'
      || (e && e.endTime === null)
      || (prev && prev.endTime === null)
      || (e && pills.has(e.id));
    if (relevant) refresh();
  });
  const offSettings = settings.subscribe((change) => {
    if (change && ['*', 'babies', 'storageWindows'].includes(change.key)) tick();
  });
  const onVis = () => { if (!document.hidden) refresh(); };
  document.addEventListener('visibilitychange', onVis);

  refresh();

  inst = {
    refresh,
    unmount() {
      stopped = true;
      clearTimeout(timer);
      offEvents();
      offSettings();
      document.removeEventListener('visibilitychange', onVis);
      for (const { el } of pills.values()) el.remove();
      pills.clear();
      live.remove();
      setCount();
      inst = null;
    },
  };
  return inst;
}

/** Re-query running events now (e.g. after an import). */
export function refresh() {
  return inst ? inst.refresh() : Promise.resolve();
}

/** The live pill API as one object, for ctx injection. */
export const livePill = Object.freeze({ mount, register, refresh, pillModel });
