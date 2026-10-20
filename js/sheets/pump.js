// Pump sheet (DESIGN §6.5 live pill, §6.7 pump tile, §6.8 stepper + keypad,
// motion contract #1, #6, #7, #8; AUDIT §2 "Pump timer: the amount is known
// only after pumping", AUDIT F1/F2; ARCHITECTURE §3 pump data, §4 stash).
//
//   ctx.sheets.pump({ origin })                               // Start timer · Log a past pump · today's goal
//   ctx.sheets.pump({ origin, preset: { startTime } })        // back-dated start (quick-log time chip)
//   ctx.sheets.pump({ origin, preset: { view: 'past' } })     // straight to "Log a past pump"
//   ctx.sheets.pump({ origin, resume: runningPumpEvent })     // the live timer
//   ctx.sheets.pump({ origin, resume, finishing: true })      // "How much did you pump?" (pill Finish)
//
//  - One pump runs at a time (pumps are the parent's: babyId null).
//  - Finish → "How much?": the amount is asked AFTER pumping. The end time is
//    the moment Finish was tapped, however long the typing takes; dismissing
//    the step leaves the pump running (its pill stays).
//  - Store it: Fridge / Freezer / Deep freezer / Don't store →
//    stash.addFromPump(pump, location), and the pouch id is recorded on the
//    pump (data.inventoryId + storedTo). Hidden Stash tracker → no choice.
//  - Log a past pump: how long (10 / 15 / 20 min or typed), how much, where,
//    and when it ended (the header time chip).
//  - Amounts are stored in the unit entered (oz or mL), never assumed oz.
//  - Synchronous first render (the sheet may grow out of the + and is
//    measured in render()): running / today's / last pump come from a cache
//    that setup(ctx) keeps warm from the events change bus.

import { pumpProgress } from '../domain/trends.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SUCCESS_HOLD_MS = 400;      // DESIGN §7.2 #8
const MAX_BACKDATE_MS = 7 * DAY;
const MAX_PUMP_MIN = 180;
const DURATIONS = Object.freeze([10, 15, 20]);
const PLACES = Object.freeze(['fridge', 'freezer', 'deepFreezer', 'none']);
const PLACE_WORD = Object.freeze({ fridge: 'Fridge', freezer: 'Freezer', deepFreezer: 'Deep freezer', none: 'Don’t store' });
const PLACE_ICON = Object.freeze({ fridge: 'fridge', freezer: 'snow', deepFreezer: 'snow', none: 'close' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isRunningError = (ctx, err) => !!err && ((ctx.RunningActivityError && err instanceof ctx.RunningActivityError) || err.name === 'RunningActivityError');
let uidSeq = 0;
const uid = () => `pm${(uidSeq += 1)}`;

// ================================================================ cache

const cache = { ready: false, running: null, today: [], last: null };
let cacheCtx = null;
let cacheTimer = 0;
let chain = Promise.resolve();
const cacheSubs = new Set();

function scheduleRefresh() {
  if (!cacheCtx) return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => { chain = chain.then(runRefresh); }, 16);
}

async function runRefresh() {
  const ctx = cacheCtx;
  try {
    const dayStart = ctx.time.dayBounds(Date.now()).start;
    const [running, today, last] = await Promise.all([
      ctx.events.running('pump'),
      ctx.events.query({ type: 'pump', from: dayStart - DAY }), // a little extra: progress filters by day itself
      ctx.events.last('pump'),
    ]);
    Object.assign(cache, { ready: true, running: running[0] || null, today, last });
  } catch (err) {
    console.warn('pump sheet: refresh failed', err);
    return;
  }
  for (const fn of [...cacheSubs]) {
    try { fn(); } catch (err) { console.error('pump sheet listener failed', err); }
  }
}

// ============================================================== helpers

function unitNow(ctx) {
  return ctx.units.normalizeUnit(ctx.settings.get('units'));
}

function spokenAmount(v, unit) {
  if (unit === 'mL') return `${v} milliliters`;
  if (unit === 'min') return `${v} ${Number(v) === 1 ? 'minute' : 'minutes'}`;
  return `${v} ${Number(v) === 1 ? 'ounce' : 'ounces'}`;
}

function numText(ctx, v, unit) {
  if (unit === 'min') return String(Math.round(v));
  return String(ctx.units.roundForUnit(v, unit));
}

/** Today's pumping vs the goal, in the display unit (domain/trends pumpProgress). */
function progress(ctx, extra = 0, unit = unitNow(ctx)) {
  const events = extra > 0 ? [...cache.today, { type: 'pump', startTime: Date.now(), endTime: Date.now(), data: { amount: extra, unit } }] : cache.today;
  return pumpProgress(events, ctx.settings.get('pumpGoalOz'), { unit });
}

/** The usual amount: the last pump's, else 4 oz / 120 mL. */
function defaultAmount(ctx, unit) {
  const cfg = ctx.units.inputConfig(unit);
  const last = cache.last;
  const a = last && last.data ? ctx.units.toFiniteNumber(last.data.amount) : null;
  const v = a !== null && a > 0 ? ctx.units.convertQty(a, last.data.unit, unit) : unit === 'mL' ? 120 : 4;
  return ctx.units.clampAmount(v, 0, cfg.max, cfg.fineStep);
}

/** Where the milk usually goes: last time's choice (v1 pumps had none → fridge). */
function defaultPlace() {
  const last = cache.last;
  if (last && !last.migratedFrom && last.data) {
    if (['fridge', 'freezer', 'deepFreezer'].includes(last.data.storedTo)) return last.data.storedTo;
    if (last.data.storedTo === null && last.data.amount > 0) return 'none';
  }
  return 'fridge';
}

function placeHint(ctx, place) {
  const w = ctx.settings.get('storageWindows') || {};
  const n = (v, d) => (Number(v) > 0 ? Number(v) : d);
  switch (place) {
    case 'fridge': { const d = n(w.fridgeDays, 4); return `Up to ${d} ${d === 1 ? 'day' : 'days'}`; }
    case 'freezer': return `Up to ${n(w.freezerMonths, 6)} months`;
    case 'deepFreezer': return `Up to ${n(w.deepFreezerMonths, 12)} months`;
    default: return 'Skip the stash';
  }
}

/** Roving radio buttons inside a container (click, arrows, Home/End). */
function bindRadios(container, selector, onPick) {
  const items = () => [...container.querySelectorAll(selector)].filter((b) => !b.disabled);
  const pick = (btn, focus) => {
    for (const b of items()) {
      const on = b === btn;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    if (focus) btn.focus();
    onPick(btn);
  };
  container.addEventListener('click', (e) => {
    const btn = e.target.closest(selector);
    if (!btn || btn.disabled || !container.contains(btn)) return;
    // Re-picking the checked radio still runs onPick (e.g. "Other…" re-opens the keypad).
    pick(btn, false);
  });
  container.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j === null) return;
    e.preventDefault();
    pick(list[j], true);
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
const timeValue = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * Time picker sheet behind a time chip (DESIGN §6.6): one tap on "Now / 5 /
 * 15 / 30 min / 1 / 2 hours ago", or Today | Yesterday + a time. Never in the
 * future, never before `min`. Resolves { ts } (ts null = now) or undefined.
 */
function openWhen(ctx, { origin, value = null, title = 'When?', nowLabel = 'Now', min = null, minMsg = '' }) {
  const { html, render } = ctx.html;
  return new Promise((resolve) => {
    let result;
    const base = value ?? Date.now();
    const yesterday = !ctx.time.isSameDay(base, Date.now());
    ctx.openSheet({
      title,
      origin,
      className: 'sheet-pump sheet-nb-when',
      onClose: () => resolve(result),
      render(body, api) {
        const quick = [[0, nowLabel], [5, '5 min ago'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 hour ago'], [120, '2 hours ago']]
          .filter(([m]) => min === null || Date.now() - m * MINUTE >= min);
        const ago = value === null ? 0 : Math.round((Date.now() - value) / MINUTE);
        render(body, html`<div class="nb nb-when">
            ${quick.length ? html`<div class="chip-row nb-when-quick" role="group" aria-label="Quick times">
              ${quick.map(([m, l]) => html`<button type="button" class="chip" data-ago="${m}" aria-pressed="${(value === null ? m === 0 : m > 0 && Math.abs(m - ago) <= 1) ? 'true' : 'false'}"><span class="chip-face">${l}</span></button>`)}
            </div>` : ''}
            <div class="nb-when-custom">
              <div class="segmented nb-seg" role="radiogroup" aria-label="Day" data-seg="day">
                <button type="button" role="radio" aria-checked="${yesterday ? 'false' : 'true'}" tabindex="${yesterday ? '-1' : '0'}" data-value="0">Today</button>
                <button type="button" role="radio" aria-checked="${yesterday ? 'true' : 'false'}" tabindex="${yesterday ? '0' : '-1'}" data-value="-1">Yesterday</button>
              </div>
              <label class="field nb-when-field"><span class="field-label">Time</span>
                <input class="field-input num" type="time" step="60" data-time value="${timeValue(base)}">
              </label>
            </div>
            <p class="nb-when-note" data-note aria-live="polite"></p>
            <p class="field-error" data-err role="status" hidden></p>
            <div class="sheet-footer"><button type="button" class="btn btn-primary btn-block" data-when-done>Set time</button></div>
          </div>`);
        let day = yesterday ? -1 : 0;
        const input = body.querySelector('[data-time]');
        const note = body.querySelector('[data-note]');
        const err = body.querySelector('[data-err]');
        const pickTs = () => {
          const m = /^(\d{1,2}):(\d{2})/.exec(input.value || '');
          if (!m) return null;
          const n = new Date();
          return new Date(n.getFullYear(), n.getMonth(), n.getDate() + day, Number(m[1]), Number(m[2])).getTime();
        };
        const sync = () => {
          err.hidden = true;
          const ts = pickTs();
          note.textContent = ts === null ? '' : `${ctx.format.dayLabel(ts)} at ${ctx.format.clock(ts)}${ts <= Date.now() ? ` · ${ctx.format.since(ts).replace('Just now', 'just now')}` : ''}`;
        };
        bindRadios(body.querySelector('[data-seg="day"]'), '[role="radio"]', (b) => { day = Number(b.dataset.value); sync(); });
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);
        sync();
        const quickEl = body.querySelector('.nb-when-quick');
        if (quickEl) {
          quickEl.addEventListener('click', (e) => {
            const b = e.target.closest('[data-ago]');
            if (!b) return;
            const m = Number(b.dataset.ago);
            result = { ts: m === 0 ? null : Date.now() - m * MINUTE };
            api.close(result);
          });
        }
        body.querySelector('[data-when-done]').addEventListener('click', () => {
          const ts = pickTs();
          const fail = (msg) => { render(err, html`${ctx.icons.iconHtml('info', { size: 16 })}${msg}`); err.hidden = false; };
          if (ts === null) { fail('Pick a time.'); return; }
          if (ts > Date.now() + 30 * 1000) { fail('That time hasn’t happened yet.'); return; }
          if (min !== null && ts < min) { fail(minMsg || 'That’s too early.'); return; }
          if (Date.now() - ts > MAX_BACKDATE_MS) { fail('That’s more than a week ago.'); return; }
          result = { ts: Date.now() - ts < MINUTE ? null : ts };
          api.close(result);
        });
      },
    });
  });
}

/**
 * Keypad sheet (DESIGN §6.8 NumberStepper + Keypad): a nested sheet with a
 * big readout and a 3×4 pad. Resolves the number, or null when dismissed.
 */
function openKeypad(ctx, { origin, title, value, unit, max, decimals, firstKey }) {
  const { html, render } = ctx.html;
  const I = (n, s) => ctx.icons.iconHtml(n, { size: s });
  return new Promise((resolve) => {
    let result = null;
    let text = numText(ctx, value, unit);
    let fresh = true;
    ctx.openSheet({
      title,
      origin,
      className: 'sheet-pump sheet-nb-keypad',
      onClose: () => resolve(result),
      render(body, api) {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? '.' : '', '0', 'del'];
        render(body, html`<div class="nb nb-kp">
            <p class="nb-kp-display num" aria-live="polite"><span data-kp-val></span><small>${unit}</small></p>
            <p class="nb-kp-help" data-kp-help></p>
            <div class="nb-kp-grid">
              ${keys.map((k) => (k === '' ? html`<span aria-hidden="true"></span>`
                : k === 'del' ? html`<button type="button" class="nb-key nb-key-del" data-key="del" aria-label="Delete">${I('chev-l', 26)}</button>`
                  : html`<button type="button" class="nb-key num" data-key="${k}" aria-label="${k === '.' ? 'Decimal point' : k}">${k}</button>`))}
            </div>
            <div class="sheet-footer"><button type="button" class="btn btn-primary btn-block" data-kp-done>Done</button></div>
          </div>`);
        const valEl = body.querySelector('[data-kp-val]');
        const help = body.querySelector('[data-kp-help]');
        const paint = () => {
          valEl.textContent = text === '' ? '0' : text;
          const n = Number(text);
          help.textContent = Number.isFinite(n) && n > max ? `Up to ${max} ${unit}` : '';
        };
        const press = (k) => {
          if (k === 'del') { text = fresh ? '' : text.slice(0, -1); fresh = false; paint(); return; }
          if (fresh) { text = ''; fresh = false; }
          if (k === '.') {
            if (!decimals || text.includes('.')) return;
            text = text === '' ? '0.' : `${text}.`;
          } else {
            const [, frac = null] = text.split('.');
            if (frac !== null && frac.length >= decimals) return;
            if (text.replace('.', '').length >= 4) return;
            text = text === '0' ? k : text + k;
          }
          paint();
        };
        const done = () => {
          const n = text === '' ? 0 : Number(text);
          result = Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : null;
          api.close(result);
        };
        body.querySelector('.nb-kp-grid').addEventListener('click', (e) => {
          const b = e.target.closest('[data-key]');
          if (b) press(b.dataset.key);
        });
        body.querySelector('[data-kp-done]').addEventListener('click', done);
        api.el.addEventListener('keydown', (e) => {
          if (/^[0-9]$/.test(e.key) || (e.key === '.' && decimals)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); press('del'); } else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); done(); }
        });
        if (firstKey) press(firstKey);
        paint();
      },
    });
  });
}

/**
 * NumberStepper (DESIGN §6.8): − value + with quick presets. The value is a
 * read-only role=spinbutton input (arrow keys / Page / Home / End); tapping
 * it opens the keypad sheet, so nothing swaps size. Hold −/+ to repeat 8/s.
 */
function makeStepper(ctx, root, opts) {
  const { html, render } = ctx.html;
  let o = { ...opts };
  let value = o.value;
  const input = root.querySelector('[data-amount]');
  const dec = root.querySelector('[data-dec]');
  const inc = root.querySelector('[data-inc]');
  const unitEl = root.querySelector('[data-unit]');
  const presetsEl = root.querySelector('[data-presets]');
  let repeatTimer = 0;
  let repeatDelay = 0;
  let pointerStepped = false;
  let keypadOpen = false;
  const snap = (v) => ctx.units.clampAmount(v, o.min, o.max, o.fine);

  function renderPresets() {
    render(presetsEl, (o.presets || []).map((p) => html`<button type="button" class="quick-chip" data-preset="${p}" aria-pressed="false" aria-label="${spokenAmount(p, o.unit)}">${p} ${o.unit}</button>`));
  }
  function paint() {
    const text = numText(ctx, value, o.unit);
    input.value = text;
    const dots = (text.match(/\./g) || []).length;
    input.style.setProperty('--w', `${((text.length - dots) * 0.6 + dots * 0.3 + 0.06).toFixed(2)}em`);
    input.setAttribute('aria-valuenow', String(value));
    input.setAttribute('aria-valuemin', String(o.min));
    input.setAttribute('aria-valuemax', String(o.max));
    input.setAttribute('aria-valuetext', spokenAmount(Number(text), o.unit));
    input.setAttribute('aria-label', `${o.label}. Tap to type`);
    unitEl.textContent = o.unit;
    dec.disabled = value <= o.min;
    inc.disabled = value >= o.max;
    for (const c of presetsEl.querySelectorAll('[data-preset]')) c.setAttribute('aria-pressed', Number(c.dataset.preset) === value ? 'true' : 'false');
  }
  function set(v, silent = false) {
    const next = snap(v);
    const changed = next !== value;
    value = next;
    paint();
    if (changed && !silent && typeof o.onChange === 'function') o.onChange(value);
  }
  // Steps land on multiples of the step (4.3 → 4.5 → 5), never 4.8.
  function bump(dir) {
    const s = o.step;
    set(dir > 0 ? Math.floor((value + 1e-9) / s) * s + s : Math.ceil((value - 1e-9) / s) * s - s);
  }
  function stopRepeat() {
    clearTimeout(repeatDelay);
    clearInterval(repeatTimer);
    repeatDelay = 0;
    repeatTimer = 0;
    window.removeEventListener('pointerup', stopRepeat, true);
    window.removeEventListener('pointercancel', stopRepeat, true);
  }
  function onPointerDown(e, dir) {
    if (e.button !== undefined && e.button !== 0) return;
    const btn = dir > 0 ? inc : dec;
    if (btn.disabled) return;
    pointerStepped = true;
    bump(dir);
    stopRepeat();
    repeatDelay = setTimeout(() => {
      repeatTimer = setInterval(() => {
        if ((dir > 0 ? inc : dec).disabled) { stopRepeat(); return; }
        bump(dir);
      }, 125);
    }, 400);
    window.addEventListener('pointerup', stopRepeat, true);
    window.addEventListener('pointercancel', stopRepeat, true);
  }
  dec.addEventListener('pointerdown', (e) => onPointerDown(e, -1));
  inc.addEventListener('pointerdown', (e) => onPointerDown(e, 1));
  dec.addEventListener('pointerleave', stopRepeat);
  inc.addEventListener('pointerleave', stopRepeat);
  // Keyboard (detail 0) steps on click; a pointer already stepped on down.
  const clickStep = (dir) => (e) => {
    if (pointerStepped && e.detail !== 0) { pointerStepped = false; return; }
    pointerStepped = false;
    bump(dir);
  };
  dec.addEventListener('click', clickStep(-1));
  inc.addEventListener('click', clickStep(1));
  dec.addEventListener('contextmenu', (e) => e.preventDefault());
  inc.addEventListener('contextmenu', (e) => e.preventDefault());
  presetsEl.addEventListener('click', (e) => {
    const c = e.target.closest('[data-preset]');
    if (c) set(Number(c.dataset.preset));
  });
  input.addEventListener('keydown', (e) => {
    const big = o.unit === 'mL' ? 30 : o.unit === 'min' ? 5 : 1;
    let handled = true;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') bump(1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') bump(-1);
    else if (e.key === 'PageUp') set(value + big);
    else if (e.key === 'PageDown') set(value - big);
    else if (e.key === 'Home') set(o.min);
    else if (e.key === 'End') set(o.max);
    else if (e.key === 'Enter' || e.key === ' ') openPad();
    else if (/^[0-9.]$/.test(e.key)) openPad(e.key);
    else handled = false;
    if (handled) e.preventDefault();
  });
  input.addEventListener('click', () => openPad());
  async function openPad(firstKey) {
    if (keypadOpen) return;
    keypadOpen = true;
    try {
      const v = await openKeypad(ctx, { origin: input, title: o.keypadTitle || o.label, value, unit: o.unit, max: o.max, decimals: o.unit === 'oz' ? 1 : 0, firstKey });
      if (v !== null && v !== undefined) set(v);
    } finally {
      keypadOpen = false;
    }
  }
  renderPresets();
  paint();
  return {
    get value() { return value; },
    set,
    configure(next) {
      o = { ...o, ...next };
      renderPresets();
      value = snap(next.value ?? value);
      paint();
    },
    destroy() { stopRepeat(); },
  };
}

/** Store a finished pump's milk and link the pouch back to the pump. */
async function storeMilk(ctx, pump, place) {
  if (!place || place === 'none' || !(pump.data && pump.data.amount > 0)) return null;
  const pouch = await ctx.stash.addFromPump(pump, place);
  await ctx.events.update(pump.id, { data: { inventoryId: pouch.id, storedTo: place } });
  return pouch;
}

// ================================================================ sheet

/**
 * Open the pump sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {object} [opts]
 * @param {Element} [opts.origin] the tapped element (motion + focus return)
 * @param {{ startTime?: number, view?: 'past' }} [opts.preset] startTime: back-date (quick-log chip)
 * @param {object} [opts.resume] a running pump event → its live view
 * @param {boolean} [opts.finishing] (with resume) open on "How much did you pump?"
 * @returns {object} sheet api
 */
export function openPumpSheet(ctx, { origin = null, preset = null, resume = null, finishing = false } = {}) {
  const { html, render } = ctx.html;
  const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
  const F = ctx.format;
  const p = preset && typeof preset === 'object' ? preset : {};
  const trackers = ctx.settings.get('trackers') || {};
  const hidden = !resume && trackers.pump === false;
  const stashOn = () => (ctx.settings.get('trackers') || {}).stash !== false;

  const st = {
    unit: unitNow(ctx),
    when: null,        // home: when the timer started · past: when the pump ended (null = now)
    amount: 0,
    place: defaultPlace(),
    minutes: 15,
  };
  st.amount = defaultAmount(ctx, st.unit);
  const presetTime = ctx.units.toFiniteNumber(p.startTime);
  if (presetTime !== null && Date.now() - presetTime > MINUTE && Date.now() - presetTime < MAX_BACKDATE_MS) st.when = presetTime;

  let first;
  if (hidden) first = { view: 'hidden' };
  else if (resume) first = finishing ? { view: 'amount', event: resume } : { view: 'live', event: resume };
  else if (cache.running) first = { view: 'live', event: cache.running };
  else if (p.view === 'past') first = { view: 'past' };
  else first = { view: 'home' };

  const TITLE = { hidden: 'Pump', home: 'Pump', live: 'Pumping', amount: 'How much did you pump?', past: 'Past pump' };
  let api = null;
  let chip = { mode: 'none' };   // 'start' | 'end' | 'started' | 'none'
  let chipTimer = 0;
  let closed = false;
  let unitHook = null;           // the current view's reaction to a units change
  let whenHook = null;           // the past view's reaction to a new end time
  let showing = first.view;

  api = ctx.openSheet({
    title: TITLE[first.view],
    origin,
    className: 'sheet-pump',
    initialFocus: first.view === 'amount' ? '[data-amount]' : undefined,
    onClose() { closed = true; clearInterval(chipTimer); offSettings(); },
    render(body, a) {
      api = a;
      chipTimer = setInterval(() => { if ((chip.mode === 'start' || chip.mode === 'end') && st.when === null) renderChip(); }, 20 * 1000);
      return show(first, body);
    },
  });
  const offSettings = ctx.settings.subscribe((c) => {
    if (!c || closed) return;
    if (c.key === 'units' || c.key === '*') {
      const next = unitNow(ctx);
      if (next !== st.unit) { const prev = st.unit; st.unit = next; if (unitHook) unitHook(prev, next); }
    }
    if ((c.key === 'trackers' || c.key === '*') && (showing === 'home' || showing === 'past') && (ctx.settings.get('trackers') || {}).pump === false && api.isOpen()) api.close();
  });
  renderChip();
  return api;

  // ------------------------------------------------------------ routing

  function show(v, body) {
    showing = v.view;
    unitHook = null;
    switch (v.view) {
      case 'hidden': return hiddenView(body);
      case 'live': return liveView(body, v.event);
      case 'amount': return amountView(body, v.event, v);
      case 'past': return pastView(body);
      default: return homeView(body);
    }
  }

  function go(v, direction = 'forward') {
    if (!api || !api.isOpen()) return null;
    return api.step((b) => show(v, b), { direction });
  }

  // ------------------------------------------------------------- header

  function setChip(next) {
    chip = next;
    renderChip();
  }

  function renderChip() {
    if (!api || closed) return;
    if (chip.mode === 'none') { render(api.header, null); return; }
    const now = Date.now();
    let word;
    let ts;
    let spoken;
    if (chip.mode === 'started') {
      ts = chip.event.startTime;
      word = ctx.time.isSameDay(ts, now) ? 'Started' : F.dayLabel(ts, now);
      spoken = `Started at ${F.clock(ts)}. Change`;
    } else {
      ts = st.when ?? now;
      word = st.when === null ? 'Now' : ctx.time.isSameDay(ts, now) ? 'Today' : F.dayLabel(ts, now);
      const what = chip.mode === 'end' ? 'Ended' : 'Started';
      spoken = st.when === null ? `${what}: now, ${F.clock(ts)}. Change` : `${what}: ${word}, ${F.clock(ts)}. Change`;
    }
    render(api.header, html`<button type="button" class="time-chip ${chip.mode !== 'started' && st.when === null ? '' : 'is-set'}" data-when aria-label="${spoken}">${I('clock', 18)}${word} <span class="num">${ctx.time.clock(ts)}</span>${I('chev-d', 18)}</button>`);
    const btn = api.header.querySelector('[data-when]');
    btn.addEventListener('click', async () => {
      if (chip.mode === 'started') {
        const ev = chip.event;
        const res = await openWhen(ctx, { origin: btn, value: ev.startTime, title: 'When did you start?', nowLabel: 'Just now' });
        if (!res || closed) return;
        try {
          const next = await ctx.events.update(ev.id, { startTime: res.ts ?? Date.now() });
          if (chip.event && chip.event.id === next.id) chip = { mode: 'started', event: next };
        } catch (err) { console.warn('pump sheet: start time not changed', err); }
        renderChip();
        return;
      }
      const res = await openWhen(ctx, { origin: btn, value: st.when, title: chip.mode === 'end' ? 'When did it end?' : 'When did you start?' });
      if (!res || closed) return;
      st.when = res.ts;
      renderChip();
      if (whenHook) whenHook();
    });
  }

  // ----------------------------------------------------- shared bits

  function showError(body, msg = 'That didn’t save. Try again.') {
    const el = body.querySelector('[data-error]');
    if (!el) return;
    if (!msg) { el.hidden = true; return; }
    render(el, html`${I('info', 16)}${msg}`);
    el.hidden = false;
  }

  function setBusy(btn, on) {
    if (on) { btn.style.setProperty('min-width', `${btn.offsetWidth}px`); btn.setAttribute('aria-busy', 'true'); } else btn.removeAttribute('aria-busy');
  }

  function lock(body, on) {
    for (const b of body.querySelectorAll('.sheet-footer .btn, [data-lockable]')) {
      if (on) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; } else if (b.dataset.wasDisabled !== '1') b.disabled = false;
    }
  }

  async function succeed(btn, word = 'Logged') {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.classList.add('is-success');
    render(btn, html`${I('check', 22)}${word}`);
    await wait(SUCCESS_HOLD_MS);
    if (api.isOpen()) api.close('logged');
  }

  /** The goal card: "12.5 of 24 oz today", a bar, and what's been logged. */
  function goalTpl(extra = 0) {
    const pr = progress(ctx, extra, st.unit);
    const fill = `${Math.round(pr.fraction * 100)}%`;
    const count = pr.count;
    const last = cache.last;
    const lastLine = last && ctx.time.isSameDay(last.startTime, Date.now())
      ? html` · last at <b>${F.clock(last.startTime)}</b>` : '';
    return {
      fill,
      tpl: html`<div class="pm-goal-top">
          <span class="pm-goal-val num"><b data-goal-total>${String(pr.total)}</b>${pr.goal > 0 ? html` <small>of ${String(pr.goal)} ${pr.unit}</small>` : html` <small>${pr.unit}</small>`}</span>
          <span class="pm-goal-word">${pr.reached ? html`${I('check', 16)}Goal reached` : 'today'}</span>
        </div>
        ${pr.goal > 0 ? html`<span class="goal-bar pm-goal-bar" aria-hidden="true"><i data-goal-fill></i></span>` : ''}
        <p class="pm-goal-meta">${count ? html`${F.plural(count, 'pump')} today${lastLine}` : 'No pumps yet today'}</p>`,
      spoken: pr.goal > 0 ? `${pr.total} of ${spokenAmount(pr.goal, pr.unit)} pumped today` : `${spokenAmount(pr.total, pr.unit)} pumped today`,
    };
  }

  function paintGoal(el, extra = 0) {
    if (!el) return;
    const g = goalTpl(extra);
    render(el, g.tpl);
    el.setAttribute('aria-label', g.spoken);
    const bar = el.querySelector('[data-goal-fill]');
    if (bar) bar.style.setProperty('--fill', g.fill);
  }

  /** Stepper markup (the value is a read-only spinbutton; tap → keypad). */
  function stepperTpl(labelId) {
    return html`<div class="nb-stepper" data-stepper>
        <div class="stepper">
          <button type="button" class="stepper-btn" data-dec aria-label="Less">${I('minus', 24)}</button>
          <label class="nb-value">
            <input class="nb-value-input num" data-amount type="text" role="spinbutton" readonly inputmode="none" autocomplete="off" aria-describedby="${labelId}">
            <small class="nb-value-unit" aria-hidden="true" data-unit></small>
          </label>
          <button type="button" class="stepper-btn" data-inc aria-label="More">${I('plus', 24)}</button>
        </div>
        <div class="quick-chips" data-presets></div>
      </div>`;
  }

  function amountStepper(body, onChange) {
    const cfg = () => ctx.units.inputConfig(st.unit);
    const stepper = makeStepper(ctx, body.querySelector('[data-stepper]'), {
      value: st.amount, unit: st.unit, min: 0, max: cfg().max, step: cfg().step, fine: cfg().fineStep, presets: cfg().presets,
      label: 'Amount pumped', keypadTitle: 'How much?',
      onChange(v) { st.amount = v; onChange(); },
    });
    unitHook = (from, to) => {
      const c = ctx.units.inputConfig(to);
      st.amount = ctx.units.clampAmount(ctx.units.convertQty(st.amount, from, to), 0, c.max, c.fineStep);
      stepper.configure({ unit: to, min: 0, max: c.max, step: c.step, fine: c.fineStep, presets: c.presets, value: st.amount });
      onChange();
    };
    return stepper;
  }

  /** Fridge / Freezer / Deep freezer / Don't store (radio tiles). */
  function placesTpl(labelId) {
    if (!stashOn()) return '';
    return html`<div class="pm-places" role="radiogroup" aria-labelledby="${labelId}" data-places>
        ${PLACES.map((pl) => html`<button type="button" class="pm-place cat-pump" role="radio" data-value="${pl}" aria-checked="${pl === st.place ? 'true' : 'false'}" tabindex="${pl === st.place ? '0' : '-1'}">
            <span class="pm-place-ic">${I(PLACE_ICON[pl], 20)}</span>
            <span class="pm-place-text"><b>${PLACE_WORD[pl]}</b><small>${placeHint(ctx, pl)}</small></span>
          </button>`)}
      </div>`;
  }

  function bindPlaces(body, onChange) {
    const el = body.querySelector('[data-places]');
    if (!el) return () => {};
    bindRadios(el, '[role="radio"]', (b) => { st.place = b.dataset.value; onChange(); });
    // Nothing to store when nothing was pumped.
    return () => {
      const none = !(st.amount > 0);
      for (const b of el.querySelectorAll('[role="radio"]')) {
        const dis = none && b.dataset.value !== 'none';
        b.disabled = dis;
        if (dis) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      }
    };
  }

  function placeFor() { return stashOn() && st.amount > 0 && st.place !== 'none' ? st.place : null; }
  function saveLabel(word) { return `${word} · ${ctx.format.amount(st.amount, st.unit)}`; }

  // ----------------------------------------------------- hidden tracker

  function hiddenView(body) {
    setChip({ mode: 'none' });
    render(body, html`<div class="empty-state cat-pump">
        <span class="empty-disc">${I('pump', 30)}</span>
        <h3 class="empty-title">Pumping is hidden</h3>
        <p class="empty-text">Turn pumping back on in Customize. Hidden trackers keep their data.</p>
        <button type="button" class="btn btn-primary" data-customize>Customize</button>
      </div>`);
    body.querySelector('[data-customize]').addEventListener('click', () => {
      api.close();
      try { ctx.router.push('settings', { page: 'customize' }); } catch (err) { console.warn('pump sheet: settings not reachable', err); }
    });
    return null;
  }

  // =========================================================== home

  function homeView(body) {
    api.setTitle(TITLE.home);
    setChip({ mode: 'start' });
    let busy = false;
    render(body, html`<div class="nb pm">
        <section class="pm-goal cat-pump" data-goal role="group"></section>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-start>${I('play', 22)}Start pump timer</button>
          <button type="button" class="btn btn-secondary btn-block" data-past>${I('edit', 22)}Log a past pump</button>
          <button type="button" class="btn btn-ghost pm-notnow" data-close>Not now</button>
        </div>
      </div>`);
    const goalEl = body.querySelector('[data-goal]');
    paintGoal(goalEl);
    const sub = () => { if (body.isConnected) paintGoal(goalEl); };
    cacheSubs.add(sub);
    unitHook = () => paintGoal(goalEl);

    body.querySelector('[data-close]').addEventListener('click', () => api.close());
    body.querySelector('[data-past]').addEventListener('click', () => { if (!busy) { st.when = null; go({ view: 'past' }); } });
    const startBtn = body.querySelector('[data-start]');
    startBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      setBusy(startBtn, true);
      lock(body, true);
      try {
        const ev = await ctx.events.start('pump', { amount: null, unit: st.unit, storedTo: null }, { startTime: st.when ?? Date.now() });
        go({ view: 'live', event: ev });
      } catch (err) {
        busy = false;
        setBusy(startBtn, false);
        lock(body, false);
        if (isRunningError(ctx, err) && err.running) { go({ view: 'live', event: err.running }); return; }
        console.warn('pump sheet: pump not started', err);
        showError(body);
      }
    });
    return () => { cacheSubs.delete(sub); };
  }

  // =========================================================== live

  function liveView(body, event) {
    let ev = event;
    let done = false;
    let busy = false;
    api.setTitle(TITLE.live);
    setChip({ mode: 'started', event: ev });
    render(body, html`<div class="nb pm pm-live">
        <div class="nb-hero cat-pump">
          <span class="nb-timer num" data-timer aria-hidden="true">00:00</span>
          <span class="nb-hero-sub"><span class="dot" aria-hidden="true"></span><span data-since></span></span>
        </div>
        <section class="pm-goal cat-pump is-compact" data-goal role="group"></section>
        <button type="button" class="btn btn-ghost nb-mistake" data-discard data-lockable>Started by mistake? Discard</button>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-finish>${I('stop', 22)}Finish</button>
        </div>
      </div>`);
    const timerEl = body.querySelector('[data-timer]');
    const sinceEl = body.querySelector('[data-since]');
    const goalEl = body.querySelector('[data-goal]');
    paintGoal(goalEl);
    const sub = () => { if (body.isConnected) paintGoal(goalEl); };
    cacheSubs.add(sub);
    unitHook = () => paintGoal(goalEl);

    function paint() {
      const now = Date.now();
      timerEl.textContent = ctx.time.timerClock((now - ev.startTime) / 1000);
      render(sinceEl, html`Pumping since <b>${F.clock(ev.startTime)}</b>`);
    }
    let timer = 0;
    const loop = () => {
      paint();
      const ms = 1000 - ((Date.now() - ev.startTime) % 1000);
      timer = setTimeout(loop, Math.max(30, ms + 5));
    };
    loop();

    body.querySelector('[data-finish]').addEventListener('click', () => {
      if (busy) return;
      go({ view: 'amount', event: ev, finishAt: Date.now() });
    });
    body.querySelector('[data-discard]').addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      done = true;
      api.close('discarded');
      try {
        const removed = await ctx.events.remove(ev.id);
        if (removed) ctx.toast({ message: 'Pump discarded', action: { label: 'Undo', run: () => ctx.events.restore(removed) } });
      } catch (err) { console.warn('pump sheet: pump not discarded', err); }
    });

    const offEvents = watchEvent(ev, (e) => { ev = e; paint(); if (chip.mode === 'started') { chip = { mode: 'started', event: e }; renderChip(); } }, () => done);
    return () => { clearTimeout(timer); offEvents(); cacheSubs.delete(sub); };
  }

  /** Follow one running pump: closes the sheet if it ends or goes elsewhere. */
  function watchEvent(event, onChange, isDone) {
    const off = ctx.events.subscribe((change) => {
      if (!change) return;
      if (change.op === 'bulk') {
        ctx.events.get(event.id).then((e) => { if (!isDone() && (!e || e.endTime !== null)) api.close(); else if (e) onChange(e); }).catch(() => {});
        return;
      }
      const e = change.event;
      if (!e || e.id !== event.id) return;
      if (change.op === 'remove' || e.endTime !== null) { if (!isDone() && api.isOpen()) api.close(); return; }
      onChange(e);
    });
    // A stale pill tap (it already ended elsewhere) closes quietly.
    ctx.events.get(event.id).then((e) => { if (!isDone() && api.isOpen() && (!e || e.endTime !== null)) api.close(); }).catch(() => {});
    return off;
  }

  // =========================================================== how much?

  function amountView(body, event, { finishAt = Date.now() } = {}) {
    let ev = event;
    let done = false;
    let busy = false;
    const endAt = Math.max(ev.startTime, Math.min(Date.now(), finishAt));
    api.setTitle(TITLE.amount);
    setChip({ mode: 'none' });
    const ids = { amt: uid(), place: uid() };
    render(body, html`<div class="nb pm">
        <p class="pm-dur" data-dur></p>
        <div class="nb-amount">
          <p class="sr-only" id="${ids.amt}">How much did you pump?</p>
          ${stepperTpl(ids.amt)}
          <p class="pm-today" data-today aria-live="polite"></p>
        </div>
        ${stashOn() ? html`<div class="nb-block"><p class="nb-label" id="${ids.place}">Store it</p>${placesTpl(ids.place)}</div>` : ''}
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-finish></button>
          <button type="button" class="btn btn-secondary btn-block" data-keep>Keep pumping</button>
        </div>
      </div>`);
    const saveBtn = body.querySelector('[data-finish]');
    const todayEl = body.querySelector('[data-today]');
    const paintPlaces = bindPlaces(body, () => {});
    function paint() {
      render(body.querySelector('[data-dur]'), html`Pumped <b class="num">${F.durationLabel(endAt - ev.startTime)}</b> · ${F.clock(ev.startTime)} – ${F.clock(endAt)}`);
      if (!busy) saveBtn.textContent = saveLabel('Save');
      const pr = progress(ctx, st.amount, st.unit);
      render(todayEl, pr.goal > 0
        ? html`With this, <b class="num">${String(pr.total)}</b> of ${String(pr.goal)} ${pr.unit} today${pr.reached ? ' · goal reached' : ''}`
        : html`With this, <b class="num">${String(pr.total)} ${pr.unit}</b> today`);
      paintPlaces();
    }
    const stepper = amountStepper(body, paint);
    paint();

    body.querySelector('[data-keep]').addEventListener('click', () => { if (!busy) go({ view: 'live', event: ev }, 'back'); });
    saveBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      done = true;
      setBusy(saveBtn, true);
      lock(body, true);
      const place = placeFor();
      let finished;
      try {
        finished = await ctx.events.stop(ev.id, { endTime: endAt, data: { amount: st.amount, unit: st.unit } });
      } catch (err) {
        busy = false;
        done = false;
        setBusy(saveBtn, false);
        lock(body, false);
        console.warn('pump sheet: pump not finished', err);
        showError(body);
        return;
      }
      let stashFailed = false;
      try { await storeMilk(ctx, finished, place); } catch (err) { stashFailed = true; console.warn('pump sheet: milk not stored', err); }
      await succeed(saveBtn);
      if (stashFailed) ctx.toast({ message: 'Pump logged. The milk didn’t reach the stash — add it from Stash.', tone: 'warn' });
    });
    const offEvents = watchEvent(ev, (e) => { ev = e; paint(); }, () => done);
    return () => { offEvents(); stepper.destroy(); };
  }

  // =========================================================== past pump

  function pastView(body) {
    api.setTitle(TITLE.past);
    setChip({ mode: 'end' });
    const ids = { dur: uid(), amt: uid(), place: uid() };
    let busy = false;
    const isPreset = (m) => DURATIONS.includes(m);
    render(body, html`<div class="nb pm">
        <button type="button" class="btn btn-ghost nb-back" data-back>${I('chev-l', 20)}Back</button>
        <div class="nb-block">
          <p class="nb-label" id="${ids.dur}">How long?</p>
          <div class="chip-row pm-durs cat-pump" role="radiogroup" aria-labelledby="${ids.dur}" data-durs>
            ${DURATIONS.map((m) => html`<button type="button" class="chip" role="radio" data-min="${m}" aria-checked="${m === st.minutes ? 'true' : 'false'}" tabindex="${m === st.minutes ? '0' : '-1'}"><span class="chip-face num">${m} min</span></button>`)}
            <button type="button" class="chip" role="radio" data-min="other" aria-checked="${isPreset(st.minutes) ? 'false' : 'true'}" tabindex="${isPreset(st.minutes) ? '-1' : '0'}" data-other><span class="chip-face num" data-other-face>${isPreset(st.minutes) ? 'Other…' : `${st.minutes} min`}</span></button>
          </div>
        </div>
        <div class="nb-amount">
          <p class="nb-label nb-label-c" id="${ids.amt}">How much?</p>
          ${stepperTpl(ids.amt)}
        </div>
        ${stashOn() ? html`<div class="nb-block"><p class="nb-label" id="${ids.place}">Store it</p>${placesTpl(ids.place)}</div>` : ''}
        <p class="note pm-span" data-span>${I('clock', 16)}<span data-span-text></span></p>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-log></button>
        </div>
      </div>`);
    const logBtn = body.querySelector('[data-log]');
    const spanEl = body.querySelector('[data-span-text]');
    const durs = body.querySelector('[data-durs]');
    const otherFace = body.querySelector('[data-other-face]');
    const paintPlaces = bindPlaces(body, () => {});
    function paint() {
      const end = st.when ?? Date.now();
      const start = end - st.minutes * MINUTE;
      spanEl.textContent = `${F.clock(start)} – ${F.clock(end)}${ctx.time.isSameDay(end, Date.now()) ? '' : ` · ${F.dayLabel(end)}`} · ${st.minutes} min`;
      if (!busy) logBtn.textContent = saveLabel('Log pump');
      paintPlaces();
    }
    const stepper = amountStepper(body, paint);
    whenHook = paint;
    paint();

    bindRadios(durs, '[role="radio"]', async (b) => {
      if (b.dataset.min !== 'other') {
        st.minutes = Number(b.dataset.min);
        otherFace.textContent = 'Other…';
        paint();
        return;
      }
      const v = await openKeypad(ctx, { origin: b, title: 'How many minutes?', value: st.minutes, unit: 'min', max: MAX_PUMP_MIN, decimals: 0 });
      if (closed || !body.isConnected) return;
      if (v !== null && v !== undefined && v >= 1) st.minutes = Math.round(v);
      const preset = isPreset(st.minutes);
      for (const c of durs.querySelectorAll('[role="radio"]')) {
        const on = preset ? Number(c.dataset.min) === st.minutes : c.dataset.min === 'other';
        c.setAttribute('aria-checked', on ? 'true' : 'false');
        c.tabIndex = on ? 0 : -1;
      }
      otherFace.textContent = preset ? 'Other…' : `${st.minutes} min`;
      paint();
    });
    body.querySelector('[data-back]').addEventListener('click', () => { st.when = null; go({ view: 'home' }, 'back'); });

    logBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      setBusy(logBtn, true);
      lock(body, true);
      const end = st.when ?? Date.now();
      const place = placeFor();
      let ev;
      try {
        ev = await ctx.events.add({ type: 'pump', startTime: end - st.minutes * MINUTE, endTime: end, data: { amount: st.amount, unit: st.unit, storedTo: null } });
      } catch (err) {
        busy = false;
        setBusy(logBtn, false);
        lock(body, false);
        console.warn('pump sheet: past pump not logged', err);
        showError(body);
        return;
      }
      let stashFailed = false;
      try { await storeMilk(ctx, ev, place); } catch (err) { stashFailed = true; console.warn('pump sheet: milk not stored', err); }
      await succeed(logBtn);
      if (stashFailed) ctx.toast({ message: 'Pump logged. The milk didn’t reach the stash — add it from Stash.', tone: 'warn' });
    });
    return () => { stepper.destroy(); whenHook = null; };
  }
}

/**
 * One-time wiring at boot (called by app.js): the pump cache and the
 * live-pill handlers (Finish → "How much did you pump?").
 * @param {object} ctx
 */
export function setup(ctx) {
  cacheCtx = ctx;
  ctx.events.subscribe((c) => {
    if (!c || c.op === 'bulk' || (c.event && c.event.type === 'pump') || (c.prev && c.prev.type === 'pump')) scheduleRefresh();
  });
  ctx.settings.subscribe((c) => { if (c && ['*', 'units', 'pumpGoalOz'].includes(c.key)) scheduleRefresh(); });
  scheduleRefresh();

  ctx.livePill.register('pump', {
    open: (event, origin) => openPumpSheet(ctx, { origin, resume: event }),
    finish: (event, origin) => openPumpSheet(ctx, { origin, resume: event, finishing: true }),
  });
}
