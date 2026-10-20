// Stash sheet (DESIGN §6.6, §6.8 ExpiryBadge / UseNextHero / stepper + keypad,
// §13 Frame 5; motion contract #1, #3, #7, #8, #19; ARCHITECTURE §4 stash,
// §5.3 sheet contract; AUDIT §2 "Use next", F7–F10).
//
//   ctx.sheets.stash({ origin })                               // Add pouch
//   ctx.sheets.stash({ origin, preset: { startTime, location, quantity, unit, notes } })
//   ctx.sheets.stash({ origin, pouchId, pouch })              // pouch detail
//   ctx.sheets.stash({ origin, view: 'archived' })            // used / discarded / expired
//
//  - Add pouch: how much (stepper → keypad), where (Fridge / Freezer / Deep
//    freezer / Room temp), when it was pumped (the header time chip → a
//    date + time picker; old freezer milk is common), an optional note, and
//    a live "Keeps until …" line. Milk that would already be past its time
//    can't be added. In-sheet success ("Added"), no toast (#8).
//  - Pouch detail: amount, place, expiry in words, pumped / thawed / used
//    dates, note. Actions by state:
//      frozen   Thaw · Thaw & feed · Edit · Mark used · Discard
//      thawed / fridge / room   Feed · Mark used · Edit · Discard
//      expired  Discard · Edit
//      archived Put back (when still good) · Delete
//    Every change happens at once with an Undo toast (stash.get before →
//    stash.restore), never a confirm (ARCHITECTURE §1.5). The sheet closes
//    first so the toast is never hidden under the scrim.
//  - Feed / Thaw & feed open the feed sheet with that pouch as the source
//    (ctx.sheets.feed, preset { method: 'bottle', sourceInventoryId }).
//    Hidden bottle tracker → no feed buttons (Mark used instead).
//  - Edit: the add form, prefilled; thawed milk can't move (refreezing is
//    unsafe). "Delete pouch" for a pouch added by mistake (Undo).
//  - Archived: newest first, paged; a row steps into its detail.
//
// Synchronous first render: a sheet opened from the quick-log tile grows out
// of the + and is measured inside render(), so everything the first render
// needs comes from a module cache that setup(ctx) keeps warm from the stash
// change bus (plus the last bottle amounts for nothing — the stash is
// family-level, ARCHITECTURE §3).

import {
  calculateExpiration, effectiveStatus, maxExpiresAt, FROZEN_LOCATIONS, THAWED_LOCATION, DEFAULT_STORAGE_WINDOWS,
} from '../domain/inventory.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30.44 * DAY;
const SUCCESS_HOLD_MS = 400;          // DESIGN §7.2 #8
const MAX_PUMPED_AGO = 24 * MONTH;    // the longest frozen window Settings allows
const ARCHIVE_PAGE = 40;
const PLACES = Object.freeze(['fridge', 'freezer', 'deepFreezer', 'room']);
const PLACE_WORD = Object.freeze({ fridge: 'Fridge', freezer: 'Freezer', deepFreezer: 'Deep freezer', room: 'Room temp', thawed: 'Thawed' });
const PLACE_IN = Object.freeze({ fridge: 'in the fridge', freezer: 'in the freezer', deepFreezer: 'in the deep freezer', room: 'at room temp', thawed: 'thawed, in the fridge' });
const PLACE_ICON = Object.freeze({ fridge: 'fridge', freezer: 'snow', deepFreezer: 'snow', room: 'pouch', thawed: 'thaw' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The feed sheet keeps its own pouch cache, refreshed from the stash bus
// (16 ms debounce + a read). A pouch thawed a moment ago must be in it
// before "Thaw & feed" opens the feed sheet, or the sheet falls back to
// another source. See the FOUNDATION REQUEST for feed.js in the report.
const FEED_CACHE_SETTLE_MS = 200;
let uidSeq = 0;
const uid = () => `sx${(uidSeq += 1)}`;

// ================================================================ cache

const cache = { ready: false, items: [] };
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
  try {
    cache.items = await cacheCtx.stash.list({ filter: 'everything' });
    cache.ready = true;
  } catch (err) {
    console.warn('stash sheet: refresh failed', err);
    return;
  }
  for (const fn of [...cacheSubs]) {
    try { fn(); } catch (err) { console.error('stash sheet listener failed', err); }
  }
}

/** Keep a fresh copy of a pouch in the cache right away (before the bus round-trip). */
function cachePut(item) {
  if (!item || !item.id) return;
  const i = cache.items.findIndex((x) => x.id === item.id);
  if (i === -1) cache.items.push(item); else cache.items[i] = item;
}

// ============================================================== helpers

function unitNow(ctx) {
  return ctx.units.normalizeUnit(ctx.settings.get('units'));
}

function windows(ctx) {
  return { ...DEFAULT_STORAGE_WINDOWS, ...(ctx.settings.get('storageWindows') || {}) };
}

function spokenAmount(v, unit) {
  if (unit === 'mL') return `${v} milliliters`;
  return `${v} ${Number(v) === 1 ? 'ounce' : 'ounces'}`;
}

function numText(ctx, v, unit) {
  return String(ctx.units.roundForUnit(v, unit));
}

const isFrozen = (item) => FROZEN_LOCATIONS.includes(item.location);
const isArchived = (item, now) => effectiveStatus(item, now) !== 'active';

/** "4½" for halves. */
function half(n) {
  const whole = Math.floor(n);
  if (n === whole) return String(whole);
  return whole ? `${whole}½` : '½';
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "6 weeks", "3 days", "5h", "4½ months" — how long something has been. */
function ageWords(ms) {
  if (ms < HOUR) return 'under an hour';
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 14 * DAY) return plural(Math.floor(ms / DAY), 'day');
  if (ms < 60 * DAY) return plural(Math.floor(ms / (7 * DAY)), 'week');
  return `${half(Math.round((ms / MONTH) * 2) / 2)} months`;
}

/** "4½ months left", "3 days left", "5h left", "20 min left". Never claims time that isn't there. */
function leftWords(ms) {
  if (ms >= 60 * DAY) return `${half(Math.floor((ms / MONTH) * 2) / 2)} months left`;
  if (ms >= 14 * DAY) return `${Math.floor(ms / (7 * DAY))} weeks left`;
  if (ms >= 2 * DAY) return `${Math.round(ms / DAY)} days left`;
  if (ms >= DAY) return '1 day left';
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h left`;
  return `${Math.max(1, Math.floor(ms / MINUTE))} min left`;
}

/** "Sep 2" (plus the year when it isn't this year). */
function shortDate(ts, now = Date.now()) {
  const d = new Date(ts);
  const opts = { month: 'short', day: 'numeric' };
  // The year only when the month and day alone could mislead ("Best by Mar 2"
  // six months out is clear; a date ~a year away or older is not).
  if (Math.abs(ts - now) > 300 * DAY) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** "Yesterday, 8:20 PM" / "Wed, Sep 2, 7:10 AM". */
function dayTime(ctx, ts, now = Date.now()) {
  return `${ctx.format.dayLabel(ts, now)}, ${ctx.format.clock(ts)}`;
}

/** Mid-sentence day: "today", "yesterday", else "Oct 12". */
function relDay(ts, now = Date.now()) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const start = d0.getTime();
  if (ts >= start && ts < start + DAY) return 'today';
  if (ts >= start - DAY && ts < start) return 'yesterday';
  return shortDate(ts, now);
}

/** "Fri" within the week, else "Oct 30". */
function byDay(ctx, ts, now = Date.now()) {
  if (ctx.time.isSameDay(ts, now)) return ctx.format.clock(ts);
  if (ts - now < 6 * DAY) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  return shortDate(ts, now);
}

/**
 * ExpiryBadge (DESIGN §6.8): words + clock icon, never color alone.
 *  ok "4 days left" · warn "1 day left" / "Use within 5h" · ok/warn "Best by Mar 2"
 *  (frozen) · danger "Expired · discard". Danger is never used for "soon".
 */
function expiryBadge(ctx, item, now = Date.now()) {
  const status = effectiveStatus(item, now);
  if (status === 'used') return { tone: 'neutral', icon: 'check', text: 'Used' };
  if (status === 'discarded') return { tone: 'neutral', icon: 'trash', text: 'Discarded' };
  if (status === 'expired') return { tone: 'danger', icon: 'clock', text: 'Expired · discard' };
  const left = item.expiresAt - now;
  if (isFrozen(item)) return { tone: left < 14 * DAY ? 'warn' : 'ok', icon: 'clock', text: `Best by ${shortDate(item.expiresAt, now)}` };
  if (left < HOUR) return { tone: 'warn', icon: 'clock', text: `Use within ${Math.max(1, Math.floor(left / MINUTE))} min` };
  if (left < DAY) return { tone: 'warn', icon: 'clock', text: `Use within ${Math.floor(left / HOUR)}h` };
  if (left < 2 * DAY) return { tone: 'warn', icon: 'clock', text: '1 day left' };
  return { tone: 'ok', icon: 'clock', text: `${Math.round(left / DAY)} days left` };
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
const dateValue = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const timeValue = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * "When was it pumped?" (behind the header time chip). One tap on Now /
 * 1 / 3 hours ago / This morning-ish, or any date + time up to two years
 * back (freezer milk can be months old). Never in the future. Resolves
 * { ts } (ts null = now) or undefined when dismissed.
 */
function openWhen(ctx, { origin, value = null }) {
  const { html, render } = ctx.html;
  return new Promise((resolve) => {
    let result;
    const base = value ?? Date.now();
    ctx.openSheet({
      title: 'When was it pumped?',
      origin,
      className: 'sheet-stash sheet-sx-when',
      onClose: () => resolve(result),
      render(body, api) {
        const quick = [[0, 'Now'], [60, '1 hour ago'], [180, '3 hours ago'], [24 * 60, 'Yesterday']];
        const ago = value === null ? 0 : Math.round((Date.now() - value) / MINUTE);
        const today = new Date();
        const min = Date.now() - MAX_PUMPED_AGO;
        render(body, html`<div class="sx sx-when">
            <div class="chip-row sx-when-quick cat-pump" role="group" aria-label="Quick times">
              ${quick.map(([m, l]) => html`<button type="button" class="chip" data-ago="${m}" aria-pressed="${(value === null ? m === 0 : m > 0 && Math.abs(m - ago) <= 1) ? 'true' : 'false'}"><span class="chip-face">${l}</span></button>`)}
            </div>
            <div class="sx-when-fields">
              <label class="field"><span class="field-label">Date</span>
                <input class="field-input num" type="date" data-date value="${dateValue(base)}" max="${dateValue(today)}" min="${dateValue(min)}">
              </label>
              <label class="field"><span class="field-label">Time</span>
                <input class="field-input num" type="time" step="60" data-time value="${timeValue(base)}">
              </label>
            </div>
            <p class="sx-when-note" data-note aria-live="polite"></p>
            <p class="field-error" data-err role="status" hidden></p>
            <div class="sheet-footer"><button type="button" class="btn btn-primary btn-block" data-when-done>Set time</button></div>
          </div>`);
        const dateIn = body.querySelector('[data-date]');
        const timeIn = body.querySelector('[data-time]');
        const note = body.querySelector('[data-note]');
        const err = body.querySelector('[data-err]');
        const pickTs = () => {
          const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIn.value || '');
          const t = /^(\d{1,2}):(\d{2})/.exec(timeIn.value || '');
          if (!d || !t) return null;
          return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])).getTime();
        };
        const sync = () => {
          err.hidden = true;
          const ts = pickTs();
          note.textContent = ts === null ? '' : `${dayTime(ctx, ts)}${ts <= Date.now() ? ` · ${ageWords(Date.now() - ts)} ago` : ''}`;
        };
        for (const el of [dateIn, timeIn]) { el.addEventListener('input', sync); el.addEventListener('change', sync); }
        sync();
        body.querySelector('.sx-when-quick').addEventListener('click', (e) => {
          const b = e.target.closest('[data-ago]');
          if (!b) return;
          const m = Number(b.dataset.ago);
          result = { ts: m === 0 ? null : Date.now() - m * MINUTE };
          api.close(result);
        });
        body.querySelector('[data-when-done]').addEventListener('click', () => {
          const ts = pickTs();
          const fail = (msg) => { render(err, html`${ctx.icons.iconHtml('info', { size: 16 })}${msg}`); err.hidden = false; };
          if (ts === null) { fail('Pick a date and a time.'); return; }
          if (ts > Date.now() + 30 * 1000) { fail('That time hasn’t happened yet.'); return; }
          if (ts < min) { fail('That’s more than two years ago.'); return; }
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
      className: 'sheet-stash sheet-sx-keypad',
      onClose: () => resolve(result),
      render(body, api) {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? '.' : '', '0', 'del'];
        render(body, html`<div class="sx sx-kp">
            <p class="sx-kp-display num" aria-live="polite"><span data-kp-val></span><small>${unit}</small></p>
            <p class="sx-kp-help" data-kp-help></p>
            <div class="sx-kp-grid">
              ${keys.map((k) => (k === '' ? html`<span aria-hidden="true"></span>`
                : k === 'del' ? html`<button type="button" class="sx-key sx-key-del" data-key="del" aria-label="Delete">${I('chev-l', 26)}</button>`
                  : html`<button type="button" class="sx-key num" data-key="${k}" aria-label="${k === '.' ? 'Decimal point' : k}">${k}</button>`))}
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
        body.querySelector('.sx-kp-grid').addEventListener('click', (e) => {
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
 * read-only role=spinbutton input; tapping it opens the keypad sheet, so
 * nothing swaps size. Hold −/+ to repeat 8/s.
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
    const big = o.unit === 'mL' ? 30 : 1;
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
    destroy() { stopRepeat(); },
  };
}

/** The usual pouch: the amount + place of the last pouch added, else 4 oz / 120 mL in the fridge. */
function addDefaults(ctx, unit) {
  const cfg = ctx.units.inputConfig(unit);
  const last = cache.items.reduce((a, b) => (!a || (b.createdAt || 0) > (a.createdAt || 0) ? b : a), null);
  const q = last ? ctx.units.toFiniteNumber(last.quantity) : null;
  const amount = q !== null && q > 0 ? ctx.units.convertQty(q, last.unit, unit) : unit === 'mL' ? 120 : 4;
  let place = 'fridge';
  if (last && PLACES.includes(last.location)) place = last.location;
  else if (last && last.location === THAWED_LOCATION) place = 'freezer';
  return { amount: ctx.units.clampAmount(amount, cfg.fineStep, cfg.max, cfg.fineStep), place };
}

// ================================================================ sheet

/**
 * Open the stash sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {object} [opts]
 * @param {Element} [opts.origin] the tapped element (motion + focus return)
 * @param {{ startTime?: number, location?: string, quantity?: number, unit?: 'oz'|'mL', notes?: string }} [opts.preset]
 *   for Add pouch: startTime = when it was pumped (quick-log time chip)
 * @param {string} [opts.pouchId] open this pouch's detail
 * @param {object} [opts.pouch] the pouch record, if the caller has it (faster first paint)
 * @param {'add'|'detail'|'archived'} [opts.view] 'archived' = used / discarded / expired list
 * @returns {object} sheet api
 */
export function openStashSheet(ctx, { origin = null, preset = null, pouchId = null, pouch = null, view = null } = {}) {
  const { html, render } = ctx.html;
  const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
  const F = ctx.format;
  const p = preset && typeof preset === 'object' ? preset : {};
  const originEl = origin && origin.nodeType === 1 ? origin : null;
  const trackers = () => ctx.settings.get('trackers') || {};
  const stashOn = () => trackers().stash !== false;
  const bottleOn = () => trackers().bottle !== false;
  const wantId = pouchId || (pouch && pouch.id) || null;
  if (pouch && pouch.id && !cache.items.some((x) => x.id === pouch.id)) cachePut(pouch);

  const findPouch = (id) => cache.items.find((x) => x.id === id) || null;

  let api = null;
  let closed = false;

  // ---------------------------------------------------- first view
  let first;
  if (!stashOn()) first = { view: 'hidden' };
  else if (view === 'archived') first = { view: 'archive' };
  else if (wantId) first = { view: 'detail', id: wantId };
  else first = { view: 'add' };

  const titleFor = (v, item) => {
    if (v === 'hidden') return 'Milk stash';
    if (v === 'archive') return 'Used & discarded';
    if (v === 'add') return 'Add pouch';
    if (v === 'edit') return 'Edit pouch';
    if (!item) return 'Pouch';
    const s = effectiveStatus(item, Date.now());
    if (s === 'used') return 'Used pouch';
    if (s === 'discarded') return 'Discarded pouch';
    if (s === 'expired') return 'Expired pouch';
    return `${PLACE_WORD[item.location] || 'Stash'} pouch`;
  };

  api = ctx.openSheet({
    title: titleFor(first.view, first.id ? findPouch(first.id) : null),
    origin,
    className: 'sheet-stash',
    onClose: () => { closed = true; },
    render(body, sheetApi) {
      api = sheetApi;
      return show(body, first);
    },
  });
  return api;

  // ============================================================ routing

  function show(body, v) {
    switch (v.view) {
      case 'hidden': return hiddenView(body);
      case 'archive': return archiveView(body, v);
      case 'detail': return detailView(body, v);
      case 'edit': return formView(body, v);
      default: return formView(body, { view: 'add' });
    }
  }

  function go(v, direction = 'forward') {
    if (closed) return;
    api.step((body) => show(body, v), { direction });
  }

  function reopenOrigin() {
    const ok = originEl && originEl.isConnected && !originEl.closest('[inert]') && originEl.getClientRects().length > 0;
    return ok ? originEl : ctx.fab || originEl;
  }

  // ---------------------------------------------------- shared bits

  function setChip(mode) {
    if (closed) return;
    if (!mode) { render(api.header, null); return; }
    const now = Date.now();
    const ts = mode.when ?? now;
    const word = mode.when === null ? 'Now' : ctx.time.isSameDay(ts, now) ? 'Today' : F.dayLabel(ts, now);
    const spoken = mode.when === null ? `Pumped: now, ${F.clock(ts)}. Change` : `Pumped: ${word}, ${F.clock(ts)}. Change`;
    render(api.header, html`<button type="button" class="time-chip ${mode.when === null ? '' : 'is-set'}" data-when aria-label="${spoken}">${I('clock', 18)}${word} <span class="num">${ctx.time.clock(ts)}</span>${I('chev-d', 18)}</button>`);
    const btn = api.header.querySelector('[data-when]');
    btn.addEventListener('click', async () => {
      const res = await openWhen(ctx, { origin: btn, value: mode.when });
      if (!res || closed) return;
      mode.onPick(res.ts);
      setChip({ ...mode, when: res.ts });
    });
  }

  function showError(body, msg = 'That didn’t save. Try again.') {
    const el = body.querySelector('[data-error]');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
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

  async function succeed(btn, word) {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.classList.add('is-success');
    render(btn, html`${I('check', 22)}${word}`);
    await wait(SUCCESS_HOLD_MS);
  }

  // ----------------------------------------------------- hidden tracker

  function hiddenView(body) {
    setChip(null);
    render(body, html`<div class="empty-state cat-pump">
        <span class="empty-disc">${I('pouch', 30)}</span>
        <h3 class="empty-title">Milk stash is hidden</h3>
        <p class="empty-text">Turn it back on in Customize. Hidden trackers keep their data.</p>
        <button type="button" class="btn btn-primary" data-customize>Customize</button>
      </div>`);
    body.querySelector('[data-customize]').addEventListener('click', () => {
      api.close();
      try { ctx.router.push('settings', { page: 'customize' }); } catch (err) { console.warn('stash sheet: settings not reachable', err); }
    });
    return null;
  }

  // ======================================================== add / edit

  function formView(body, v) {
    const editing = v.view === 'edit';
    const item = editing ? findPouch(v.id) : null;
    if (editing && !item) return goneView(body);
    api.setTitle(titleFor(editing ? 'edit' : 'add'));
    const unit = unitNow(ctx);
    const cfg = ctx.units.inputConfig(unit);
    const thawed = editing && item.location === THAWED_LOCATION;
    const st = { unit, amount: 0, place: 'fridge', when: null, note: '' };
    if (editing) {
      st.amount = ctx.units.clampAmount(ctx.units.convertQty(item.quantity, item.unit, unit), cfg.fineStep, cfg.max, cfg.fineStep);
      st.place = item.location;
      st.when = item.pumpedAt;
      st.note = item.notes || '';
    } else {
      const d = addDefaults(ctx, unit);
      st.amount = d.amount;
      st.place = d.place;
      const q = ctx.units.toFiniteNumber(p.quantity);
      if (q !== null && q > 0) st.amount = ctx.units.clampAmount(ctx.units.convertQty(q, p.unit || unit, unit), cfg.fineStep, cfg.max, cfg.fineStep);
      if (PLACES.includes(p.location)) st.place = p.location;
      const t = ctx.units.toFiniteNumber(p.startTime);
      if (t !== null && t < Date.now() - MINUTE && Date.now() - t < MAX_PUMPED_AGO) st.when = t;
      if (typeof p.notes === 'string') st.note = p.notes.slice(0, 500);
    }
    const initialAmount = st.amount;
    const ids = { amt: uid(), place: uid(), note: uid() };
    let busy = false;
    const placeHint = (pl) => {
      const w = windows(ctx);
      switch (pl) {
        case 'fridge': return `Up to ${plural(w.fridgeDays, 'day')}`;
        case 'freezer': return `Up to ${w.freezerMonths} months`;
        case 'deepFreezer': return `Up to ${w.deepFreezerMonths} months`;
        case 'room': return `Up to ${plural(w.roomTempHours, 'hour')}`;
        default: return '';
      }
    };
    render(body, html`<div class="sx sx-form">
        ${editing ? html`<button type="button" class="btn btn-ghost sx-back" data-back>${I('chev-l', 20)}Back</button>` : ''}
        <div class="sx-amount">
          <p class="sx-label sx-label-c" id="${ids.amt}">How much?</p>
          <div class="sx-stepper" data-stepper>
            <div class="stepper">
              <button type="button" class="stepper-btn" data-dec aria-label="Less">${I('minus', 24)}</button>
              <label class="sx-value">
                <input class="sx-value-input num" data-amount type="text" role="spinbutton" readonly inputmode="none" autocomplete="off" aria-describedby="${ids.amt}">
                <small class="sx-value-unit" aria-hidden="true" data-unit></small>
              </label>
              <button type="button" class="stepper-btn" data-inc aria-label="More">${I('plus', 24)}</button>
            </div>
            <div class="quick-chips" data-presets></div>
          </div>
        </div>
        <div class="sx-block">
          <p class="sx-label" id="${ids.place}">Where is it?</p>
          ${thawed
            ? html`<p class="note sx-thawed-note">${I('thaw', 16)}<span>Thawed milk stays in the fridge. It can’t go back in the freezer.</span></p>`
            : html`<div class="sx-places" role="radiogroup" aria-labelledby="${ids.place}" data-places>
              ${PLACES.map((pl) => html`<button type="button" class="sx-place cat-pump" role="radio" data-value="${pl}" aria-checked="${pl === st.place ? 'true' : 'false'}" tabindex="${pl === st.place ? '0' : '-1'}">
                  <span class="sx-place-ic">${I(PLACE_ICON[pl], 20)}</span>
                  <span class="sx-place-text"><b>${PLACE_WORD[pl]}</b><small>${placeHint(pl)}</small></span>
                </button>`)}
            </div>`}
        </div>
        <label class="field sx-note-field"><span class="field-label" id="${ids.note}">Note <span class="sx-optional">(optional)</span></span>
          <textarea class="field-input" data-note rows="2" maxlength="500" placeholder="Evening pump, bag 2…">${st.note}</textarea>
        </label>
        <p class="note sx-keeps" data-keeps aria-live="polite"></p>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-save></button>
          ${editing ? html`<button type="button" class="btn btn-ghost sx-quiet sx-danger" data-delete data-lockable>${I('trash', 20)}Delete pouch</button>` : ''}
        </div>
      </div>`);
    const saveBtn = body.querySelector('[data-save]');
    const keepsEl = body.querySelector('[data-keeps]');
    const noteEl = body.querySelector('[data-note]');

    function expiryFor() {
      const pumpedAt = st.when ?? Date.now();
      if (thawed) return item.expiresAt;
      const raw = calculateExpiration(pumpedAt, st.place, windows(ctx));
      return Math.min(raw, maxExpiresAt({ pumpedAt, location: st.place }));
    }
    function paint() {
      const now = Date.now();
      const exp = expiryFor();
      const amt = F.amount(st.amount, st.unit);
      const past = exp <= now;
      if (past) {
        render(keepsEl, html`${I('info', 16)}<span>Pumped then, this milk is already past its time ${PLACE_IN[st.place] || ''}.</span>`);
        keepsEl.classList.add('is-warn');
      } else {
        const frozen = isFrozen({ location: st.place });
        render(keepsEl, html`${I('clock', 16)}<span>${frozen ? 'Best by' : 'Keeps until'} <b>${frozen ? shortDate(exp, now) : dayTime(ctx, exp, now)}</b> · ${leftWords(exp - now)}</span>`);
        keepsEl.classList.remove('is-warn');
      }
      if (!busy) {
        saveBtn.textContent = editing ? 'Save changes' : `Add pouch · ${amt}`;
        saveBtn.disabled = past || !(st.amount > 0);
      }
    }
    const stepper = makeStepper(ctx, body.querySelector('[data-stepper]'), {
      value: st.amount, unit: st.unit, min: cfg.fineStep, max: cfg.max, step: cfg.step, fine: cfg.fineStep, presets: cfg.presets,
      label: 'Amount in the pouch', keypadTitle: 'How much?',
      onChange(val) { st.amount = val; paint(); },
    });
    const placesEl = body.querySelector('[data-places]');
    if (placesEl) bindRadios(placesEl, '[role="radio"]', (b) => { st.place = b.dataset.value; paint(); });
    noteEl.addEventListener('input', () => { st.note = noteEl.value; });
    setChip({ when: st.when, onPick: (ts) => { st.when = ts; paint(); } });
    paint();

    const back = body.querySelector('[data-back]');
    if (back) back.addEventListener('click', () => { if (!busy) go({ view: 'detail', id: item.id, from: v.from }, 'back'); });

    saveBtn.addEventListener('click', async () => {
      if (busy || saveBtn.disabled) return;
      busy = true;
      showError(body, null);
      setBusy(saveBtn, true);
      lock(body, true);
      const note = noteEl.value.trim().slice(0, 500);
      try {
        if (editing) {
          const patch = { notes: note };
          if (st.amount !== initialAmount) { patch.quantity = st.amount; patch.unit = st.unit; }
          if (!thawed && st.place !== item.location) patch.location = st.place;
          const pumped = st.when ?? Date.now();
          if (pumped !== item.pumpedAt) patch.pumpedAt = pumped;
          cachePut(await ctx.stash.update(item.id, patch));
        } else {
          cachePut(await ctx.stash.add({ pumpedAt: st.when ?? Date.now(), quantity: st.amount, unit: st.unit, location: st.place, notes: note }));
        }
      } catch (err) {
        busy = false;
        setBusy(saveBtn, false);
        lock(body, false);
        console.warn('stash sheet: pouch not saved', err);
        showError(body, err instanceof RangeError && /thaw|pumped/i.test(err.message)
          ? 'That pumped time doesn’t fit this pouch. Check the date.' : 'That didn’t save. Try again.');
        paint();
        return;
      }
      await succeed(saveBtn, editing ? 'Saved' : 'Added');
      if (closed) return;
      if (editing) go({ view: 'detail', id: item.id, from: v.from }, 'back');
      else api.close('added');
    });

    const del = body.querySelector('[data-delete]');
    if (del) {
      del.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        lock(body, true);
        try {
          const removed = await ctx.stash.remove(item.id);
          await api.close('deleted');
          if (removed) ctx.toast({ message: 'Pouch deleted', action: { label: 'Undo', run: () => ctx.stash.restore(removed) } });
        } catch (err) {
          busy = false;
          lock(body, false);
          console.warn('stash sheet: pouch not deleted', err);
          showError(body, 'That didn’t delete. Try again.');
        }
      });
    }

    return () => { stepper.destroy(); };
  }

  // ============================================================ detail

  function goneView(body) {
    setChip(null);
    api.setTitle('Pouch');
    render(body, html`<div class="empty-state cat-pump">
        <span class="empty-disc">${I('pouch', 30)}</span>
        <h3 class="empty-title">This pouch is gone</h3>
        <p class="empty-text">It was deleted, maybe on another screen.</p>
        <button type="button" class="btn btn-primary" data-done>Close</button>
      </div>`);
    body.querySelector('[data-done]').addEventListener('click', () => api.close());
    return null;
  }

  function detailView(body, v) {
    setChip(null);
    let item = findPouch(v.id);
    let busy = false;
    let painted = false;

    if (!item && !cache.ready) {
      // First open before the cache warmed up: a quiet placeholder, then paint.
      render(body, html`<div class="sx sx-loading"><p class="sheet-text">Opening…</p></div>`);
      ctx.stash.get(v.id).then((got) => {
        if (closed || !body.isConnected) return;
        if (got) { cachePut(got); item = got; paint(); } else goneView(body);
      }).catch(() => { if (!closed && body.isConnected) goneView(body); });
    } else if (!item) {
      return goneView(body);
    }

    function factsTpl(now) {
      const rows = [];
      rows.push(['Pumped', `${dayTime(ctx, item.pumpedAt, now)} · ${ageWords(Math.max(0, now - item.pumpedAt))} ago`]);
      if (Number.isFinite(item.thawedAt)) rows.push(['Thawed', `${dayTime(ctx, item.thawedAt, now)} · ${ageWords(Math.max(0, now - item.thawedAt))} ago`]);
      const s = effectiveStatus(item, now);
      if (s === 'used' && Number.isFinite(item.usedAt)) rows.push(['Used', dayTime(ctx, item.usedAt, now)]);
      else if (s === 'discarded' && Number.isFinite(item.discardedAt)) rows.push(['Discarded', dayTime(ctx, item.discardedAt, now)]);
      if (s === 'active') {
        rows.push([isFrozen(item) ? 'Best by' : 'Use by', `${dayTime(ctx, item.expiresAt, now)} · ${leftWords(item.expiresAt - now)}`]);
      } else if (s === 'expired' || item.expiresAt <= now) {
        rows.push(['Expired', `${dayTime(ctx, item.expiresAt, now)}`]);
      }
      if (item.notes) rows.push(['Note', item.notes]);
      return html`<dl class="sx-facts">${rows.map(([k, val]) => html`<div class="sx-fact"><dt>${k}</dt><dd class="${k === 'Note' ? 'sx-fact-note' : 'num'}">${val}</dd></div>`)}</dl>`;
    }

    function actionsFor(now) {
      const s = effectiveStatus(item, now);
      const feed = bottleOn();
      if (s === 'active' && isFrozen(item)) {
        return {
          primary: { act: 'thaw', icon: 'thaw', label: 'Thaw' },
          secondary: feed ? { act: 'thaw-feed', icon: 'bottle', label: 'Thaw & feed' } : null,
          more: [{ act: 'edit', icon: 'edit', label: 'Edit' }, { act: 'used', icon: 'check', label: 'Mark used' }, { act: 'discard', icon: 'trash', label: 'Discard', danger: true }],
        };
      }
      if (s === 'active') {
        return {
          primary: feed ? { act: 'feed', icon: 'bottle', label: 'Feed from this pouch' } : { act: 'used', icon: 'check', label: 'Mark used' },
          secondary: feed ? { act: 'used', icon: 'check', label: 'Mark used' } : null,
          more: [{ act: 'edit', icon: 'edit', label: 'Edit' }, { act: 'discard', icon: 'trash', label: 'Discard', danger: true }],
        };
      }
      if (s === 'expired') {
        return {
          primary: { act: 'discard', icon: 'trash', label: 'Discard' },
          secondary: null,
          more: [{ act: 'edit', icon: 'edit', label: 'Edit' }],
        };
      }
      // used / discarded
      const stillGood = item.expiresAt > now;
      return {
        primary: stillGood ? { act: 'restore', icon: 'undo', label: 'Put back in the stash' } : null,
        secondary: null,
        more: [{ act: 'delete', icon: 'trash', label: 'Delete', danger: true }],
      };
    }

    function paint() {
      if (!item) return;
      const now = Date.now();
      api.setTitle(titleFor('detail', item));
      const unit = unitNow(ctx);
      const a = F.amountSplit(item.quantity, item.unit, unit);
      const badge = expiryBadge(ctx, item, now);
      const s = effectiveStatus(item, now);
      const where = s === 'active' || s === 'expired' ? PLACE_IN[item.location] || '' : '';
      const acts = actionsFor(now);
      const btn = (b, cls) => html`<button type="button" class="btn btn-block ${cls}" data-act="${b.act}">${I(b.icon, 22)}${b.label}</button>`;
      const hadFocus = body.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
      render(body, html`<div class="sx sx-detail">
          ${v.from === 'archive' ? html`<button type="button" class="btn btn-ghost sx-back" data-back>${I('chev-l', 20)}Used &amp; discarded</button>` : ''}
          <div class="sx-sum cat-pump">
            <span class="sx-sum-ic">${I(s === 'active' || s === 'expired' ? PLACE_ICON[item.location] || 'pouch' : 'pouch', 26)}</span>
            <div class="sx-sum-main">
              <p class="sx-sum-amt num">${a.value}<small> ${a.unit}</small></p>
              ${where ? html`<p class="sx-sum-loc">${where.charAt(0).toUpperCase()}${where.slice(1)}</p>` : ''}
            </div>
            <span class="badge badge-${badge.tone}">${I(badge.icon, 14)}${badge.text}</span>
          </div>
          ${factsTpl(now)}
          <p class="field-error" data-error role="status" hidden></p>
          <div class="sheet-footer">
            ${acts.primary ? btn(acts.primary, 'btn-primary') : ''}
            ${acts.secondary ? btn(acts.secondary, 'btn-secondary') : ''}
            ${acts.more.length ? html`<div class="sx-more sx-more-${acts.more.length}">
              ${acts.more.map((m) => html`<button type="button" class="btn btn-ghost sx-quiet ${m.danger ? 'sx-danger' : ''}" data-act="${m.act}">${I(m.icon, 20)}${m.label}</button>`)}
            </div>` : ''}
          </div>
        </div>`);
      painted = true;
      if (hadFocus) {
        const again = body.querySelector(`[data-act="${hadFocus}"]`) || body.querySelector('[data-act]');
        if (again) again.focus({ preventScroll: true });
      }
      const back = body.querySelector('[data-back]');
      if (back) back.addEventListener('click', () => { if (!busy) go({ view: 'archive', page: v.page }, 'back'); });
    }

    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !body.contains(b) || busy || !item) return;
      run(b.dataset.act, b);
    });

    async function run(act, btn) {
      const id = item.id;
      if (act === 'edit') { go({ view: 'edit', id, from: v.from, page: v.page }); return; }
      if (act === 'feed') {
        api.close('feed');
        ctx.sheets.feed({ origin: reopenOrigin(), preset: { method: 'bottle', sourceInventoryId: id } });
        return;
      }
      busy = true;
      showError(body, null);
      setBusy(btn, true);
      lock(body, true);
      for (const b of body.querySelectorAll('[data-act]')) b.disabled = true;
      let message = '';
      let before = null;
      try {
        before = await ctx.stash.get(id);
        if (!before) { busy = false; goneView(body); return; }
        switch (act) {
          case 'thaw':
          case 'thaw-feed': {
            const next = await ctx.stash.thaw(id);
            if (!next) throw new Error('not thawable');
            cachePut(next);
            message = `Thawed · use within ${windows(ctx).thawedBottleHours}h`;
            break;
          }
          case 'used': cachePut(await ctx.stash.markUsed(id)); message = 'Marked used'; break;
          case 'discard': cachePut(await ctx.stash.discard(id)); message = 'Pouch discarded'; break;
          case 'restore': {
            const back = { ...before, status: 'active', updatedAt: Date.now() };
            delete back.usedAt;
            delete back.discardedAt;
            cachePut(await ctx.stash.restore(back));
            message = 'Back in the stash';
            break;
          }
          case 'delete': await ctx.stash.remove(id); message = 'Pouch deleted'; break;
          default: busy = false; return;
        }
      } catch (err) {
        busy = false;
        console.warn(`stash sheet: ${act} failed`, err);
        const fresh = await ctx.stash.get(id).catch(() => null);
        if (fresh) { cachePut(fresh); item = fresh; }
        paint();
        showError(body, 'That didn’t work. Try again.');
        return;
      }
      if (act === 'thaw-feed') {
        // The feed sheet takes over; Undo would hide under it, and thawing
        // is what "Thaw & feed" asked for.
        await wait(FEED_CACHE_SETTLE_MS);
        if (closed) return;
        api.close('thaw-feed');
        ctx.sheets.feed({ origin: reopenOrigin(), preset: { method: 'bottle', sourceInventoryId: id } });
        return;
      }
      await api.close(act);
      ctx.toast({ message, action: { label: 'Undo', run: () => ctx.stash.restore(before) } });
    }

    // Changes from elsewhere (a feed used it up, it expired, Undo) repaint in place.
    const onCache = () => {
      if (busy || closed || !body.isConnected) return;
      const next = findPouch(v.id);
      if (!next) { goneView(body); return; }
      if (next === item && painted) return;
      item = next;
      paint();
    };
    cacheSubs.add(onCache);
    // Expiry words move with the clock.
    const tick = setInterval(() => { if (!busy && painted && !document.hidden) paint(); }, 60 * 1000);
    if (item) paint();
    return () => { cacheSubs.delete(onCache); clearInterval(tick); };
  }

  // =========================================================== archive

  function archiveView(body, v) {
    setChip(null);
    api.setTitle(titleFor('archive'));
    let limit = Math.max(ARCHIVE_PAGE, v.page || 0);
    const list = () => {
      const now = Date.now();
      const stamp = (i) => i.usedAt || i.discardedAt || i.expiresAt || i.pumpedAt || 0;
      return cache.items.filter((i) => isArchived(i, now)).sort((a, b) => stamp(b) - stamp(a));
    };
    function rowTpl(item, now, unit) {
      const s = effectiveStatus(item, now);
      const a = F.amountSplit(item.quantity, item.unit, unit);
      const badge = expiryBadge(ctx, item, now);
      // The badge says what happened and when ("Used today", "Discarded Oct 12",
      // "Expired yesterday"); the meta line says when it was pumped.
      const word = s === 'used' ? 'Used' : s === 'discarded' ? 'Discarded' : 'Expired';
      const at = s === 'used' && Number.isFinite(item.usedAt) ? item.usedAt
        : s === 'discarded' && Number.isFinite(item.discardedAt) ? item.discardedAt : item.expiresAt;
      const badgeText = Number.isFinite(at) ? `${word} ${relDay(at, now)}` : word;
      const note = (item.notes || '').split('\n')[0].trim().slice(0, 60);
      const meta = `Pumped ${shortDate(item.pumpedAt, now)}${note ? ` · ${note}` : ''}`;
      return html`<li><button type="button" class="row cat-pump" data-pouch="${item.id}" aria-label="${`${spokenAmount(a.value, a.unit)}, ${badgeText}. ${meta}. Open pouch.`}">
          <span class="chip-ic">${I('pouch', 22)}</span>
          <span class="row-main"><b class="row-title num">${a.value} ${a.unit}</b><small class="row-meta">${meta}</small></span>
          <span class="badge badge-${badge.tone === 'danger' ? 'danger' : 'neutral'}">${I(badge.icon, 14)}${badgeText}</span>
        </button></li>`;
    }
    function paint() {
      const now = Date.now();
      const unit = unitNow(ctx);
      const all = list();
      const shown = all.slice(0, limit);
      const focusId = body.contains(document.activeElement) ? document.activeElement.getAttribute('data-pouch') : null;
      if (!all.length) {
        render(body, html`<div class="empty-state cat-pump">
            <span class="empty-disc">${I('pouch', 30)}</span>
            <h3 class="empty-title">Nothing here yet</h3>
            <p class="empty-text">Pouches you use or discard are kept here, in case you need them back.</p>
            <button type="button" class="btn btn-primary" data-done>Close</button>
          </div>`);
        body.querySelector('[data-done]').addEventListener('click', () => api.close());
        return;
      }
      render(body, html`<div class="sx sx-archive">
          <p class="sheet-text">${plural(all.length, 'pouch', 'pouches')}, newest first. Tap one to put it back or delete it.</p>
          <ul class="list no-time" aria-label="Used, discarded and expired pouches">${shown.map((i) => rowTpl(i, now, unit))}</ul>
          ${all.length > shown.length ? html`<button type="button" class="btn btn-secondary btn-block sx-more-rows" data-more>Show ${Math.min(ARCHIVE_PAGE, all.length - shown.length)} more</button>` : ''}
        </div>`);
      if (focusId) {
        const again = body.querySelector(`[data-pouch="${focusId}"]`);
        if (again) again.focus({ preventScroll: true });
      }
    }
    body.addEventListener('click', (e) => {
      const more = e.target.closest('[data-more]');
      if (more) {
        const firstNew = limit;
        limit += ARCHIVE_PAGE;
        paint();
        const rows = body.querySelectorAll('[data-pouch]');
        if (rows[firstNew]) rows[firstNew].focus({ preventScroll: false });
        return;
      }
      const row = e.target.closest('[data-pouch]');
      if (row) go({ view: 'detail', id: row.dataset.pouch, from: 'archive', page: limit });
    });
    const onCache = () => { if (!closed && body.isConnected) paint(); };
    cacheSubs.add(onCache);
    if (!cache.ready) scheduleRefresh();
    paint();
    return () => { cacheSubs.delete(onCache); };
  }
}

// ================================================================ setup

/**
 * One-time wiring at boot (called by app.js): keeps the pouch cache warm
 * from the stash change bus so the sheet's first render is synchronous.
 * (The stash has no live activity, so nothing registers with the pill.)
 * @param {object} ctx
 */
export function setup(ctx) {
  cacheCtx = ctx;
  ctx.stash.subscribe(() => scheduleRefresh());
  ctx.settings.subscribe((c) => { if (c && (c.key === '*' || c.key === 'storageWindows')) scheduleRefresh(); });
  scheduleRefresh();
}

// Exported for unit tests (pure).
export const _test = Object.freeze({ ageWords, leftWords, half, expiryBadge });
