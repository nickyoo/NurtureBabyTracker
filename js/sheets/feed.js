// Feed sheet (DESIGN §6.5–§6.8, motion contract #3–#8; ARCHITECTURE §3, §5.3).
//
//   ctx.sheets.feed({ origin })                                 // Bottle | Breastfeed switch
//   ctx.sheets.feed({ origin, preset: { method: 'bottle' } })   // straight to the bottle form
//   ctx.sheets.feed({ origin, preset: { method: 'breast' } })   // straight to the L/R picker
//   ctx.sheets.feed({ origin, preset: { method: 'bottle', sourceInventoryId } })  // feed from a pouch
//   ctx.sheets.feed({ origin, resume: runningFeedEvent })       // the live bottle / breastfeed
//
// What lives here:
//  - Bottle: formula / breast milk / "from stash" (thawed + fridge pouches as
//    sources; expired ones are listed but can't be picked, with a Discard
//    button), an amount stepper (role=spinbutton, presets, hold to repeat,
//    tap the value → keypad sheet, so nothing swaps size), the header time
//    chip for back-dating, "Start bottle" (live, CDC safety countdown from
//    domain/safety bottleSafety) or "Log finished bottle".
//  - Live bottle: timer + safety countdown, "How much did <name> drink?"
//    preselected with the prepared amount, pace, Finish (consumes the stash
//    pouch exactly once through stash.consumeForFeed) and Discard (Undo).
//    Expired: "Time's up — use a fresh bottle", Discard becomes primary.
//  - Breastfeeding: L/R with "Start on left · last was R", switch sides,
//    pause/resume, finish, discard, and "Log a past feed".
//  - Live pill handlers ('feed' for bottles, 'feed:breast').
//  - The express gesture: press and hold the + → a pad grows out of the +;
//    slide up/down for the milk (sticky), sideways for the amount, lift to
//    log (Undo toast); slide back onto the + to cancel.
//
// Synchronous first render: the sheet's height must be final in render() —
// sheet.js measures it to grow the sheet out of the + — so the data a
// first render needs (running feeds, last bottle/breastfeed per baby, stash
// sources) is kept in a small module cache, refreshed from the store change
// buses that setup(ctx) subscribes to.

import { bottleSafety, breastSideTotals } from '../domain/safety.js';

const HOLD_MS = 450;                 // DESIGN §7.2 #4
const SUCCESS_HOLD_MS = 400;         // DESIGN §7.2 #8
const WARN_SEC = 10 * 60;            // DESIGN §6.5: "use within 9 min" under 10 minutes
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EXPRESS_USES_KEY = 'nurture.expressUses'; // per-device: quick-log hides its tip after 2
const FRESH_LOCATIONS = ['thawed', 'fridge', 'room'];
const SIDE_WORD = Object.freeze({ left: 'Left', right: 'Right' });
const SIDE_LETTER = Object.freeze({ left: 'L', right: 'R' });

let uidSeq = 0;
const uid = () => `fd${(uidSeq += 1)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBottle = (e) => !!(e && e.type === 'feed' && (!e.data || e.data.method !== 'breast'));
const isBreast = (e) => !!(e && e.type === 'feed' && e.data && e.data.method === 'breast');
const methodOf = (e) => (isBreast(e) ? 'breast' : 'bottle');
const isRunningError = (ctx, err) => !!err && ((ctx.RunningActivityError && err instanceof ctx.RunningActivityError) || err.name === 'RunningActivityError');

// ================================================================ cache

const cache = {
  ready: false,
  running: [],            // running feed events, every baby
  lastBottle: new Map(),  // babyId → last finished bottle feed
  lastBreast: new Map(),  // babyId → last finished breastfeed
  sources: [],            // usable thawed / fridge / room pouches (thawed first, soonest expiry)
  expired: [],            // recently expired fresh pouches (shown, not pickable)
  frozen: 0,              // usable frozen pouches (they need thawing first)
};
const cacheSubs = new Set();
let cacheCtx = null;
let cacheTimer = 0;
let pending = { events: false, stash: false };
let chain = Promise.resolve();

function scheduleRefresh(parts) {
  if (!cacheCtx) return;
  if (parts.events) pending.events = true;
  if (parts.stash) pending.stash = true;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    const p = pending;
    pending = { events: false, stash: false };
    // Chained, so an older refresh can never land after a newer one.
    chain = chain.then(() => runRefresh(p));
  }, 16);
}

async function runRefresh(parts) {
  const ctx = cacheCtx;
  try {
    if (parts.events) await loadEvents(ctx);
    if (parts.stash) await loadStash(ctx);
    cache.ready = true;
  } catch (err) {
    console.warn('feed sheet: refresh failed', err);
    return;
  }
  for (const fn of [...cacheSubs]) {
    try { fn(parts); } catch (err) { console.error('feed sheet listener failed', err); }
  }
}

async function loadEvents(ctx) {
  const running = await ctx.events.running('feed');
  const babies = ctx.settings.get('babies') || [];
  const lastBottle = new Map();
  const lastBreast = new Map();
  for (const b of babies) {
    lastBottle.set(b.id, await ctx.events.last('feed', isBottle, { babyId: b.id }));
    lastBreast.set(b.id, await ctx.events.last('feed', isBreast, { babyId: b.id }));
  }
  Object.assign(cache, { running, lastBottle, lastBreast });
}

async function loadStash(ctx) {
  const now = Date.now();
  const usable = await ctx.stash.list({ filter: 'all', now });
  const rank = (i) => (i.location === 'thawed' ? 0 : 1);
  cache.sources = usable.filter((i) => FRESH_LOCATIONS.includes(i.location))
    .sort((a, b) => (rank(a) - rank(b)) || (a.expiresAt - b.expiresAt));
  cache.frozen = usable.filter((i) => i.location === 'freezer' || i.location === 'deepFreezer').length;
  const expired = await ctx.stash.list({ filter: 'expired', now });
  cache.expired = expired
    .filter((i) => FRESH_LOCATIONS.includes(i.location) && now - i.expiresAt < 3 * DAY)
    .sort((a, b) => b.expiresAt - a.expiresAt)
    .slice(0, 3);
}

/** The running feed for a baby (one per baby: bottle OR breast). */
function runningFor(babyId) {
  return cache.running.find((e) => (e.babyId ?? null) === (babyId ?? null)) || null;
}

// ============================================================== helpers

function unitsNow(ctx) {
  return ctx.units.normalizeUnit(ctx.settings.get('units'));
}

function numText(ctx, v, unit) {
  if (unit === 'min') return String(Math.round(v));
  return String(ctx.units.roundForUnit(v, unit));
}

function spokenAmount(v, unit) {
  if (unit === 'mL') return `${v} milliliters`;
  if (unit === 'min') return `${v} ${v === 1 ? 'minute' : 'minutes'}`;
  return `${v} ${Number(v) === 1 ? 'ounce' : 'ounces'}`;
}

/** Default bottle size: the baby's last bottle, else 4 oz / 120 mL, snapped to the step. */
function defaultBottleAmount(ctx, babyId, unit) {
  const cfg = ctx.units.inputConfig(unit);
  const last = cache.lastBottle.get(babyId);
  let v = null;
  const a = last && last.data ? ctx.units.toFiniteNumber(last.data.amount) : null;
  if (a !== null && a > 0) v = ctx.units.convertQty(a, last.data.unit, unit);
  if (v === null) v = unit === 'mL' ? 120 : 4;
  return ctx.units.clampAmount(v, cfg.step, cfg.max, cfg.step);
}

function pouchAmount(ctx, item, unit) {
  const cfg = ctx.units.inputConfig(unit);
  const v = ctx.units.convertQty(item.quantity, item.unit, unit);
  return ctx.units.clampAmount(v, cfg.fineStep, cfg.max, cfg.fineStep);
}

/** ExpiryBadge (DESIGN §6.8): always words + a clock icon, never color alone. */
function expiryBadge(item, now) {
  const left = item.expiresAt - now;
  if (!(left > 0)) return { cls: 'badge-danger', text: 'Expired · discard' };
  if (left < HOUR) return { cls: 'badge-warn', text: `Use within ${Math.max(1, Math.ceil(left / MINUTE))} min` };
  if (left < DAY) return { cls: left < 6 * HOUR ? 'badge-warn' : 'badge-ok', text: `Use within ${Math.ceil(left / HOUR)}h` };
  const d = Math.floor(left / DAY);
  return { cls: d <= 1 ? 'badge-warn' : 'badge-ok', text: `${d} ${d === 1 ? 'day' : 'days'} left` };
}

function pouchMeta(ctx, item, now) {
  const f = ctx.format;
  if (item.location === 'thawed' && Number.isFinite(item.thawedAt)) return `Thawed ${f.since(item.thawedAt, now).replace('Just now', 'just now')}`;
  const where = item.location === 'room' ? 'Room temp' : 'Fridge';
  const day = f.dayLabel(item.pumpedAt, now);
  return `${where} · ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day} ${f.clock(item.pumpedAt)}`;
}

function readExpressUses() {
  try { return Number(localStorage.getItem(EXPRESS_USES_KEY)) || 0; } catch { return 0; }
}

function bumpExpressUses() {
  try { localStorage.setItem(EXPRESS_USES_KEY, String(readExpressUses() + 1)); } catch { /* private mode */ }
}

/** Discard a running bottle (delete it) with Undo. The milk that was poured
 * from a pouch is gone either way, so the pouch is consumed (exactly once). */
async function discardBottle(ctx, event) {
  const removed = await ctx.events.remove(event.id);
  if (!removed) return null;
  if (removed.data && removed.data.sourceInventoryId) {
    try { await ctx.stash.consumeForFeed(removed); } catch (err) { console.warn('feed sheet: pouch not updated', err); }
  }
  ctx.toast({ message: 'Bottle discarded', action: { label: 'Undo', run: () => ctx.events.restore(removed) } });
  return removed;
}

/** Finish a breastfeed in one tap (pill Finish): stop + Undo. */
async function finishBreast(ctx, event) {
  const wasSide = event.data && (event.data.activeSide === 'left' || event.data.activeSide === 'right') ? event.data.activeSide : null;
  const done = await ctx.events.stop(event.id);
  const t = ctx.format.eventSubtitle(done);
  ctx.toast({
    message: t ? `Breastfeed logged · ${t}` : 'Breastfeed logged',
    action: { label: 'Undo', run: () => ctx.events.update(event.id, wasSide ? { endTime: null, data: { activeSide: wasSide } } : { endTime: null }) },
  });
  return done;
}

// ================================================================ sheet

/**
 * Open the feed sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {object} [opts]
 * @param {Element} [opts.origin] the tapped element (motion + focus return)
 * @param {{ method?: 'bottle'|'breast', milk?: 'formula'|'breastmilk'|'stash', amount?: number, unit?: 'oz'|'mL', sourceInventoryId?: string, startTime?: number, side?: 'left'|'right' }} [opts.preset]
 *   startTime: a back-dated time (e.g. from the quick-log time chip); side: the suggested breast side
 * @param {object} [opts.resume] a running feed event → its live view
 * @param {boolean} [opts.finishing] (with resume) open on "How much did <name> drink?"
 * @returns {object} sheet api
 */
export function openFeedSheet(ctx, { origin = null, preset = null, resume = null, finishing = false } = {}) {
  const { html, raw, render } = ctx.html;
  const I = (name, size = 20) => raw(ctx.icons.icon(name, { size }));
  const p = preset && typeof preset === 'object' ? preset : {};
  const trackers = ctx.settings.get('trackers') || {};
  const babies = ctx.settings.get('babies') || [];
  const multi = babies.length > 1;
  const baby = (resume && resume.babyId && babies.find((b) => b.id === resume.babyId)) || ctx.activeBaby();
  const babyId = baby ? baby.id : null;
  const name = ctx.format.babyName(baby);
  const bottleOn = trackers.bottle !== false;
  const breastOn = trackers.breastfeeding !== false;
  const formulaOn = trackers.formula !== false;
  const stashOn = trackers.stash !== false;

  const st = {
    unit: unitsNow(ctx),
    when: null,            // null = now; else epoch ms
    milk: 'breastmilk',
    sourceId: null,
    amount: 0,
  };

  // ---- initial milk / amount ----
  const lastB = cache.lastBottle.get(babyId);
  st.milk = p.milk || (p.sourceInventoryId ? 'stash' : (lastB && lastB.data && lastB.data.milk === 'formula' ? 'formula' : 'breastmilk'));
  if (st.milk === 'formula' && !formulaOn) st.milk = 'breastmilk';
  if (st.milk === 'stash' && !stashOn) st.milk = 'breastmilk';
  if (p.sourceInventoryId) st.sourceId = p.sourceInventoryId;
  // A time picked in the quick-log sheet's chip carries over.
  const presetTime = ctx.units.toFiniteNumber(p.startTime);
  if (presetTime !== null && presetTime < Date.now() - MINUTE && Date.now() - presetTime < 7 * DAY) st.when = presetTime;
  st.amount = defaultBottleAmount(ctx, babyId, st.unit);
  const presetAmount = ctx.units.toFiniteNumber(p.amount);
  if (presetAmount !== null && presetAmount > 0) {
    const cfg = ctx.units.inputConfig(st.unit);
    st.amount = ctx.units.clampAmount(ctx.units.convertQty(presetAmount, p.unit || st.unit, st.unit), cfg.fineStep, cfg.max, cfg.fineStep);
  } else if (st.sourceId) {
    const src = cache.sources.find((s) => s.id === st.sourceId);
    if (src) st.amount = pouchAmount(ctx, src, st.unit);
  }

  // ---- which view first ----
  const want = p.method === 'breast' ? 'breast' : p.method === 'bottle' ? 'bottle' : null;
  const chooseMethod = () => {
    if (want === 'bottle' && bottleOn) return 'bottle';
    if (want === 'breast' && breastOn) return 'breast';
    if (bottleOn && !breastOn) return 'bottle';
    if (breastOn && !bottleOn) return 'breast';
    if (!bottleOn && !breastOn) return null;
    const lb = cache.lastBottle.get(babyId);
    const lr = cache.lastBreast.get(babyId);
    return lr && (!lb || lr.startTime > lb.startTime) ? 'breast' : 'bottle';
  };
  const showMethodSwitch = !want && bottleOn && breastOn;
  let first;
  if (resume) {
    first = { view: methodOf(resume) === 'breast' ? 'liveBreast' : 'liveBottle', event: resume, finishing: !!finishing };
  } else {
    const run = runningFor(babyId);
    if (run && !p.sourceInventoryId && (!want || methodOf(run) === want)) first = { view: methodOf(run) === 'breast' ? 'liveBreast' : 'liveBottle', event: run };
    else first = { view: 'form', method: chooseMethod() };
  }

  const titleFor = (kind) => {
    const base = { bottle: 'Bottle', breast: 'Breastfeed', feed: 'Feed', past: 'Past breastfeed' }[kind] || 'Feed';
    return multi ? `${name} · ${base}` : base;
  };
  const firstTitle = first.view === 'liveBottle'
    ? (first.finishing ? `How much did ${name} drink?` : titleFor('bottle'))
    : first.view === 'liveBreast' ? titleFor('breast')
      : first.method === null ? 'Feed' : showMethodSwitch ? titleFor('feed') : titleFor(first.method);

  let api = null;
  const openedAt = performance.now(); // steppers ignore presses in the opening tap's tail
  let chipMode = 'none';     // 'when' | 'started' | 'none'
  let chipEvent = null;      // the live bottle the "Started" chip edits
  let unitHook = null;       // the current view's reaction to a units change
  let chipTimer = 0;

  const offSettings = ctx.settings.subscribe((change) => {
    if (!change) return;
    if (change.key === 'units' || change.key === '*') {
      const next = unitsNow(ctx);
      if (next !== st.unit) {
        const prev = st.unit;
        st.unit = next;
        if (unitHook) unitHook(prev, next);
      }
    }
  });

  api = ctx.openSheet({
    title: firstTitle,
    origin,
    className: 'sheet-feed',
    initialFocus: first.finishing ? '[data-amount]' : undefined,
    onClose() {
      clearInterval(chipTimer);
      offSettings();
    },
    render(body, a) {
      api = a;
      chipTimer = setInterval(() => { if (chipMode === 'when' && st.when === null) renderChip(); }, 20 * 1000);
      return showView(first, body);
    },
  });
  return api;

  // ------------------------------------------------------------ routing

  function showView(v, body) {
    switch (v.view) {
      case 'liveBottle': return liveBottle(body, v.event, v);
      case 'liveBreast': return liveBreast(body, v.event, v);
      case 'past': return breastPast(body);
      default:
        if (v.method === null) return hiddenView(body);
        return v.method === 'breast' ? breastForm(body) : bottleForm(body);
    }
  }

  function go(v, direction = 'forward') {
    if (!api || !api.isOpen()) return null;
    return api.step((b) => showView(v, b), { direction });
  }

  // ------------------------------------------------------------- header

  function setChip(mode, event = null) {
    chipMode = mode;
    chipEvent = event;
    renderChip();
  }

  function renderChip() {
    if (!api) return;
    if (chipMode === 'none') { render(api.header, null); return; }
    const now = Date.now();
    let word;
    let ts;
    if (chipMode === 'started') {
      ts = chipEvent.startTime;
      word = 'Started';
    } else {
      ts = st.when ?? now;
      word = st.when === null ? 'Now' : ctx.time.isSameDay(ts, now) ? 'Today' : ctx.format.dayLabel(ts, now);
    }
    const spoken = chipMode === 'started'
      ? `Started at ${ctx.format.clock(ts)}. Change`
      : st.when === null ? `Time: now, ${ctx.format.clock(ts)}. Change` : `Time: ${word}, ${ctx.format.clock(ts)}. Change`;
    render(api.header, html`<button type="button" class="time-chip" data-when aria-label="${spoken}">${I('clock', 18)}${word} <span class="num">${ctx.time.clock(ts)}</span>${I('chev-d', 18)}</button>`);
    const btn = api.header.querySelector('[data-when]');
    btn.addEventListener('click', async () => {
      if (chipMode === 'started') {
        const ev = chipEvent;
        const res = await openWhen(ctx, { origin: btn, value: ev.startTime, title: 'Bottle started', nowLabel: 'Just now' });
        if (!res) return;
        try {
          const next = await ctx.events.update(ev.id, { startTime: res.ts ?? Date.now() });
          chipEvent = next;
        } catch (err) { console.warn('feed sheet: start time not changed', err); }
        renderChip();
        return;
      }
      const res = await openWhen(ctx, { origin: btn, value: st.when, title: 'When?' });
      if (!res) return;
      st.when = res.ts;
      renderChip();
    });
  }

  // ----------------------------------------------------- shared bits

  function methodSwitch(current) {
    if (!showMethodSwitch) return '';
    return segTpl('method', [{ value: 'bottle', label: 'Bottle', icon: 'bottle' }, { value: 'breast', label: 'Breastfeed', icon: 'breast' }], current, 'Feeding method');
  }

  function bindMethodSwitch(body, current) {
    const seg = body.querySelector('[data-seg="method"]');
    if (!seg) return;
    bindSeg(seg, (v) => {
      if (v === current) return;
      go({ view: 'form', method: v }, v === 'breast' ? 'forward' : 'back');
    });
  }

  function lockFooter(body, on) {
    for (const b of body.querySelectorAll('.sheet-footer .btn, [data-lockable]')) {
      if (on) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; } else if (b.dataset.wasDisabled !== '1') b.disabled = false;
    }
  }

  function setBusy(btn, on) {
    if (on) { btn.style.setProperty('min-width', `${btn.offsetWidth}px`); btn.setAttribute('aria-busy', 'true'); } else btn.removeAttribute('aria-busy');
  }

  function showError(body, msg = 'That didn’t save. Try again.') {
    const el = body.querySelector('[data-error]');
    if (!el) return;
    render(el, html`${I('info', 16)}${msg}`);
    el.hidden = false;
  }

  // In-sheet success (#8): the primary becomes ✓ Logged, holds, then closes.
  async function succeed(btn) {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.classList.add('is-success');
    render(btn, html`${I('check', 22)}Logged`);
    await sleep(SUCCESS_HOLD_MS);
    if (api.isOpen()) api.close('logged');
  }

  // ===================================================== hidden trackers

  function hiddenView(body) {
    setChip('none');
    render(body, html`<div class="empty-state cat-feed">
        <span class="empty-disc">${I('bottle', 30)}</span>
        <h3 class="empty-title">Feeding is hidden</h3>
        <p class="empty-text">Bottle and breastfeeding are turned off. Hidden trackers keep their data.</p>
        <button type="button" class="btn btn-primary" data-open-settings>Open Settings</button>
      </div>`);
    body.querySelector('[data-open-settings]').addEventListener('click', () => {
      api.close();
      try { ctx.router.push('settings'); } catch (err) { console.warn('feed sheet: settings not reachable', err); }
    });
    return null;
  }

  // ========================================================= bottle form

  function bottleForm(body) {
    api.setTitle(showMethodSwitch ? titleFor('feed') : titleFor('bottle'));
    setChip('when');
    const milkOpts = [
      formulaOn && { value: 'formula', label: 'Formula' },
      { value: 'breastmilk', label: 'Breast milk' },
      stashOn && { value: 'stash', label: 'From stash' },
    ].filter(Boolean);
    if (!milkOpts.some((o) => o.value === st.milk)) st.milk = 'breastmilk';
    const ids = { amt: uid(), banner: uid() };
    let busy = false;

    const other = runningFor(babyId);
    render(body, html`<div class="fd">
        ${methodSwitch('bottle')}
        ${milkOpts.length > 1 ? segTpl('milk', milkOpts, st.milk, 'Milk') : ''}
        <div class="fd-sources" data-sources></div>
        <div class="fd-amount">
          <p class="fd-label" id="${ids.amt}">How much?</p>
          ${stepperTpl(ids.amt)}
        </div>
        <p class="note fd-note" data-safety-note></p>
        ${other ? html`<div class="fd-banner cat-feed" id="${ids.banner}">
            <span class="dot" aria-hidden="true"></span>
            <span class="fd-banner-text">${methodOf(other) === 'breast' ? 'Breastfeed' : 'A bottle'} is running for ${name}.</span>
            <button type="button" class="btn btn-ghost btn-sm" data-open-running>Open it</button>
          </div>` : ''}
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-start ${other ? raw(`aria-describedby="${ids.banner}" disabled`) : ''}>${I('play', 22)}Start bottle</button>
          <button type="button" class="btn btn-secondary btn-block" data-log>Log finished bottle</button>
        </div>
      </div>`);

    bindMethodSwitch(body, 'bottle');
    const cfg = () => ctx.units.inputConfig(st.unit);
    const stepper = makeStepper(ctx, body.querySelector('[data-stepper]'), {
      guardFrom: openedAt,
      value: st.amount,
      unit: st.unit,
      min: cfg().step,
      max: cfg().max,
      step: cfg().step,
      fine: cfg().fineStep,
      presets: cfg().presets,
      label: 'Amount',
      keypadTitle: 'How much?',
      onChange(v) { st.amount = v; },
    });

    const startBtn = body.querySelector('[data-start]');
    const logBtn = body.querySelector('[data-log]');
    const sourcesEl = body.querySelector('[data-sources]');
    const noteEl = body.querySelector('[data-safety-note]');

    function paintNote() {
      const sw = ctx.settings.get('storageWindows') || {};
      const h = st.milk === 'formula' ? 1 : (Number(sw.startedBottleHours) > 0 ? Number(sw.startedBottleHours) : 2);
      const hours = `${ctx.units.roundForUnit(h, 'oz')} ${h === 1 ? 'hour' : 'hours'}`;
      render(noteEl, html`${I('clock', 16)}<span>${st.milk === 'formula' ? 'Formula' : 'Breast milk'} is good for ${hours} once feeding starts.</span>`);
    }

    function canCommit() {
      if (st.milk !== 'stash') return true;
      return !!(st.sourceId && cache.sources.some((s) => s.id === st.sourceId));
    }

    function paintButtons() {
      const ok = canCommit();
      if (!busy) {
        startBtn.disabled = !!runningFor(babyId) || !ok;
        logBtn.disabled = !ok;
      }
    }

    function paintSources() {
      sourcesEl.hidden = st.milk !== 'stash';
      if (st.milk !== 'stash') { render(sourcesEl, null); return; }
      const now = Date.now();
      // A preset pouch that the cache doesn't know yet (just thawed): fetch it.
      if (st.sourceId && !cache.sources.some((s) => s.id === st.sourceId)) {
        ctx.stash.get(st.sourceId).then((item) => {
          if (item && item.status === 'active' && item.expiresAt > Date.now() && FRESH_LOCATIONS.includes(item.location) && !cache.sources.some((s) => s.id === item.id)) {
            cache.sources = [item, ...cache.sources];
            if (api.isOpen() && body.isConnected) { stepper.set(pouchAmount(ctx, item, st.unit), true); st.amount = stepper.value; paintSources(); paintButtons(); }
          }
        }).catch(() => {});
      }
      if (!st.sourceId || !cache.sources.some((s) => s.id === st.sourceId)) {
        st.sourceId = cache.sources.length ? cache.sources[0].id : st.sourceId;
      }
      if (!cache.sources.length && !cache.expired.length) {
        render(sourcesEl, html`<div class="fd-src-empty">
            <span class="fd-src-empty-ic cat-pump">${I('pouch', 20)}</span>
            <span class="fd-src-empty-text"><b>No thawed milk ready</b><small>${cache.frozen ? 'Frozen milk needs thawing first.' : 'Thawed or fridge milk shows up here.'}</small>
              <button type="button" class="btn btn-ghost btn-sm fd-go-stash" data-go-stash>Open Stash${I('chev-r', 18)}</button></span>
          </div>`);
      } else {
        render(sourcesEl, html`
          <div class="fd-src-list" role="radiogroup" aria-label="Milk from the stash">
            ${cache.sources.map((s) => {
              const b = expiryBadge(s, now);
              const on = s.id === st.sourceId;
              const amt = ctx.format.amountSplit(s.quantity, s.unit, st.unit);
              return html`<button type="button" class="fd-src cat-pump" role="radio" aria-checked="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}" data-src="${s.id}">
                  <span class="chip-ic">${I(s.location === 'thawed' ? 'thaw' : 'fridge', 22)}</span>
                  <span class="fd-src-main"><b class="num">${amt.value} <small>${amt.unit}</small></b><small>${pouchMeta(ctx, s, now)}</small></span>
                  <span class="badge ${b.cls}">${I('clock', 14)}${b.text}</span>
                  <span class="fd-src-check" aria-hidden="true">${I('check', 18)}</span>
                </button>`;
            })}
          </div>
          ${cache.expired.map((s) => {
            const amt = ctx.format.amountSplit(s.quantity, s.unit, st.unit);
            return html`<div class="fd-src cat-pump is-expired">
                <span class="chip-ic">${I('pouch', 22)}</span>
                <span class="fd-src-main"><b class="num">${amt.value} <small>${amt.unit}</small></b><small><span class="fd-expired-word">${I('clock', 14)}Expired</span> · not for feeding</small></span>
                <button type="button" class="btn btn-danger-soft btn-sm" data-discard-src="${s.id}" aria-label="Discard expired ${amt.value} ${amt.unit} pouch">Discard</button>
              </div>`;
          })}
          ${!cache.sources.length ? html`<p class="note fd-note">${I('info', 16)}<span>${cache.frozen ? 'Frozen milk needs thawing first.' : 'No usable milk in the stash right now.'}</span></p>` : ''}`);
      }
      const go2 = sourcesEl.querySelector('[data-go-stash]');
      if (go2) go2.addEventListener('click', () => { api.close(); ctx.router.go('stash'); });
      const list = sourcesEl.querySelector('[role="radiogroup"]');
      if (list) {
        bindRadios(list, '[data-src]', (btn) => {
          st.sourceId = btn.dataset.src;
          const s = cache.sources.find((x) => x.id === st.sourceId);
          if (s) { stepper.set(pouchAmount(ctx, s, st.unit), true); st.amount = stepper.value; }
          paintButtons();
        });
      }
      for (const d of sourcesEl.querySelectorAll('[data-discard-src]')) {
        d.addEventListener('click', async () => {
          const id = d.dataset.discardSrc;
          d.disabled = true;
          try {
            const before = await ctx.stash.get(id);
            await ctx.stash.discard(id);
            ctx.toast({ message: 'Pouch discarded', action: { label: 'Undo', run: () => ctx.stash.restore(before) } });
          } catch (err) {
            d.disabled = false;
            console.warn('feed sheet: pouch not discarded', err);
          }
        });
      }
    }

    const milkSeg = body.querySelector('[data-seg="milk"]');
    if (milkSeg) {
      bindSeg(milkSeg, (v) => {
        st.milk = v;
        if (v === 'stash') {
          const s = cache.sources.find((x) => x.id === st.sourceId) || cache.sources[0];
          if (s) { st.sourceId = s.id; stepper.set(pouchAmount(ctx, s, st.unit), true); st.amount = stepper.value; }
        }
        paintSources();
        paintNote();
        paintButtons();
      });
    }
    const openRun = body.querySelector('[data-open-running]');
    if (openRun) openRun.addEventListener('click', () => { const r = runningFor(babyId); if (r) go({ view: methodOf(r) === 'breast' ? 'liveBreast' : 'liveBottle', event: r }); });

    paintSources();
    paintNote();
    paintButtons();

    const sub = (parts) => { if (parts.stash) paintSources(); paintButtons(); };
    cacheSubs.add(sub);
    unitHook = (from, to) => {
      const c = ctx.units.inputConfig(to);
      st.amount = ctx.units.clampAmount(ctx.units.convertQty(st.amount, from, to), c.step, c.max, c.fineStep);
      stepper.configure({ unit: to, min: c.step, max: c.max, step: c.step, fine: c.fineStep, presets: c.presets, value: st.amount });
      paintSources();
    };

    function bottleData() {
      const data = { method: 'bottle', milk: st.milk === 'formula' ? 'formula' : 'breastmilk', amount: st.amount, unit: st.unit };
      if (st.milk === 'stash' && st.sourceId) data.sourceInventoryId = st.sourceId;
      return data;
    }

    startBtn.addEventListener('click', async () => {
      if (busy || startBtn.disabled) return;
      busy = true;
      setBusy(startBtn, true);
      lockFooter(body, true);
      const data = { ...bottleData(), prepared: st.amount };
      const hero = body.querySelector('.fd-value');
      const from = hero ? hero.getBoundingClientRect() : null;
      try {
        const ev = await ctx.events.start('feed', data, { startTime: st.when ?? Date.now(), babyId });
        go({ view: 'liveBottle', event: ev, morphFrom: from });
      } catch (err) {
        busy = false;
        setBusy(startBtn, false);
        lockFooter(body, false);
        paintButtons();
        if (isRunningError(ctx, err) && err.running) { go({ view: methodOf(err.running) === 'breast' ? 'liveBreast' : 'liveBottle', event: err.running }); return; }
        console.warn('feed sheet: bottle not started', err);
        showError(body);
      }
    });

    logBtn.addEventListener('click', async () => {
      if (busy || logBtn.disabled) return;
      busy = true;
      setBusy(logBtn, true);
      lockFooter(body, true);
      try {
        const ev = await ctx.events.add({ type: 'feed', startTime: st.when ?? Date.now(), babyId, data: bottleData() });
        if (ev.data.sourceInventoryId) {
          try { await ctx.stash.consumeForFeed(ev); } catch (err) { console.warn('feed sheet: pouch not updated', err); }
        }
        await succeed(logBtn);
      } catch (err) {
        busy = false;
        setBusy(logBtn, false);
        lockFooter(body, false);
        paintButtons();
        console.warn('feed sheet: bottle not logged', err);
        showError(body);
      }
    });

    return () => { cacheSubs.delete(sub); unitHook = null; stepper.destroy(); };
  }

  // ========================================================= live bottle

  function liveBottle(body, event, { finishing: fin = false, morphFrom = null } = {}) {
    let ev = event;
    let done = false;   // this sheet ended it (don't react to our own change)
    let busy = false;
    const evUnit = () => ctx.units.normalizeUnit(ev.data && ev.data.unit);
    api.setTitle(fin ? `How much did ${name} drink?` : titleFor('bottle'));
    setChip(fin ? 'none' : 'started', ev);
    const ids = { amt: uid() };
    const d = ev.data || {};
    const madeAmt = ctx.units.toFiniteNumber(d.prepared) ?? ctx.units.toFiniteNumber(d.amount);
    const cfg = () => ctx.units.inputConfig(st.unit);
    let amount = madeAmt !== null
      ? ctx.units.clampAmount(ctx.units.convertQty(madeAmt, evUnit(), st.unit), 0, cfg().max, cfg().fineStep)
      : defaultBottleAmount(ctx, babyId, st.unit);
    const milkWord = d.milk === 'formula' ? 'Formula' : 'Breast milk';
    let level = null;

    render(body, html`<div class="fd fd-live">
        <div class="fd-hero cat-feed">
          <span class="fd-timer num" aria-hidden="true" data-timer>00:00</span>
          <span class="fd-hero-sub">${milkWord}${madeAmt !== null ? html` · <b class="num">${ctx.format.amount(madeAmt, evUnit(), st.unit)}</b> made` : ''}${d.sourceInventoryId ? ' · from the stash' : ''}</span>
          <span class="badge fd-safety" data-safety></span>
          <span class="goal-bar fd-safety-bar" aria-hidden="true"><i data-safety-bar></i></span>
        </div>
        <p class="fd-callout" data-expired hidden>${I('clock', 18)}<span>Time’s up — use a fresh bottle.</span></p>
        <p class="sr-only" aria-live="polite" data-announce></p>
        <div class="fd-amount">
          <p class="fd-label" id="${ids.amt}">How much did ${name} drink?</p>
          ${stepperTpl(ids.amt)}
          <p class="fd-pace" data-pace></p>
        </div>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer" data-footer></div>
      </div>`);

    const stepper = makeStepper(ctx, body.querySelector('[data-stepper]'), {
      guardFrom: openedAt,
      value: amount,
      unit: st.unit,
      min: 0,
      max: cfg().max,
      step: cfg().step,
      fine: cfg().fineStep,
      presets: cfg().presets,
      label: `How much ${name} drank`,
      keypadTitle: `How much did ${name} drink?`,
      onChange(v) { amount = v; paintFooter(); paintPace(); },
    });

    const timerEl = body.querySelector('[data-timer]');
    const safetyEl = body.querySelector('[data-safety]');
    const barEl = body.querySelector('[data-safety-bar]');
    const expiredEl = body.querySelector('[data-expired]');
    const paceEl = body.querySelector('[data-pace]');
    const footer = body.querySelector('[data-footer]');
    const announceEl = body.querySelector('[data-announce]');

    function amountText() { return ctx.format.amount(amount, st.unit); }

    function paintFooter() {
      const expired = level === 'expired';
      const finishLabel = expired ? `Log ${amountText()} anyway` : `Finish · ${amountText()}`;
      const existing = footer.querySelector('[data-finish]');
      if (existing && footer.dataset.mode === (expired ? 'expired' : 'ok')) {
        if (!busy) existing.textContent = finishLabel;
        return;
      }
      footer.dataset.mode = expired ? 'expired' : 'ok';
      const fBtn = html`<button type="button" class="btn ${expired ? 'btn-secondary' : 'btn-primary'} btn-block" data-finish>${finishLabel}</button>`;
      const dBtn = html`<button type="button" class="btn ${expired ? 'btn-primary' : 'btn-secondary'} btn-block" data-discard>${expired ? html`${I('trash', 22)}Discard bottle` : 'Discard bottle'}</button>`;
      const hadFocus = footer.contains(document.activeElement) ? document.activeElement.hasAttribute('data-finish') ? 'finish' : 'discard' : null;
      render(footer, expired ? html`${dBtn}${fBtn}` : html`${fBtn}${dBtn}`);
      footer.querySelector('[data-finish]').addEventListener('click', onFinish);
      footer.querySelector('[data-discard]').addEventListener('click', onDiscard);
      if (hadFocus) footer.querySelector(`[data-${hadFocus}]`).focus({ preventScroll: true });
    }

    function paintPace() {
      const sec = Math.max(0, (Date.now() - ev.startTime) / 1000);
      const pace = ctx.units.roundForUnit(sec >= 60 ? (amount / (sec / 60)) : 0, st.unit);
      if (!(sec >= 60) || !(amount > 0) || !(pace > 0)) { render(paceEl, html`<span class="text-3">Pace shows after a minute</span>`); return; }
      render(paceEl, html`Pace <b class="num">${pace} ${st.unit}</b> a minute · <span class="num">${ctx.format.durationLabel(sec * 1000)}</span>`);
    }

    function tick() {
      const now = Date.now();
      const s = bottleSafety(ev, now, ctx.settings.get('storageWindows'));
      timerEl.textContent = ctx.time.timerClock((now - ev.startTime) / 1000);
      let lv = 'ok';
      let text = '';
      if (s) {
        if (s.expired) { lv = 'expired'; text = `Past ${Math.round(s.windowSec / 3600)}h · discard`; } else if (s.safetyRemainingSec < WARN_SEC) { lv = 'soon'; text = `Use within ${Math.max(1, Math.ceil(s.safetyRemainingSec / 60))} min`; } else text = `Good for ${s.label}`;
        barEl.style.setProperty('--fill', `${(s.fraction * 100).toFixed(1)}%`);
      }
      render(safetyEl, html`${I('clock', 14)}${text}`);
      safetyEl.className = `badge fd-safety ${lv === 'ok' ? 'badge-ok' : lv === 'soon' ? 'badge-warn' : 'badge-danger'}`;
      if (lv !== level) {
        const prev = level;
        level = lv;
        expiredEl.hidden = lv !== 'expired';
        body.querySelector('.fd-live').dataset.level = lv;
        paintFooter();
        if (prev && lv !== 'ok') announceEl.textContent = lv === 'expired' ? 'Time’s up. Use a fresh bottle.' : text;
      }
      paintPace();
    }

    let timer = 0;
    const loop = () => {
      tick();
      const ms = 1000 - ((Date.now() - ev.startTime) % 1000);
      timer = setTimeout(loop, Math.max(30, ms + 5));
    };
    loop();

    // FLIP (#5): the amount hero shrinks into the timer header.
    if (morphFrom && !ctx.motionReduced() && typeof timerEl.animate === 'function') {
      requestAnimationFrame(() => {
        const to = timerEl.getBoundingClientRect();
        if (!to.width || !morphFrom.width) return;
        const dx = (morphFrom.left + morphFrom.width / 2) - (to.left + to.width / 2);
        const dy = (morphFrom.top + morphFrom.height / 2) - (to.top + to.height / 2);
        const s = Math.max(0.5, Math.min(1.6, morphFrom.height / to.height));
        timerEl.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
      });
    }

    const offEvents = ctx.events.subscribe((change) => {
      if (!change) return;
      if (change.op === 'bulk') { ctx.events.get(ev.id).then((e) => { if (!done && (!e || e.endTime !== null)) api.close(); else if (e) ev = e; }).catch(() => {}); return; }
      const e = change.event;
      if (!e || e.id !== ev.id) return;
      if (change.op === 'remove' || e.endTime !== null) { if (!done && api.isOpen()) api.close(); return; }
      ev = e;
      if (chipMode === 'started') { chipEvent = e; renderChip(); }
      tick();
    });
    // A stale pill tap (it already ended elsewhere) closes quietly.
    ctx.events.get(ev.id).then((e) => { if (!done && api.isOpen() && (!e || e.endTime !== null)) api.close(); }).catch(() => {});

    unitHook = (from, to) => {
      const c = ctx.units.inputConfig(to);
      amount = ctx.units.clampAmount(ctx.units.convertQty(amount, from, to), 0, c.max, c.fineStep);
      stepper.configure({ unit: to, min: 0, max: c.max, step: c.step, fine: c.fineStep, presets: c.presets, value: amount });
      paintFooter();
      paintPace();
    };

    async function onFinish(e) {
      const btn = e.currentTarget;
      if (busy) return;
      busy = true;
      done = true;
      setBusy(btn, true);
      lockFooter(body, true);
      const data = { amount, unit: st.unit };
      const prep = ctx.units.toFiniteNumber(ev.data && ev.data.prepared);
      if (prep !== null && evUnit() !== st.unit) data.prepared = ctx.units.roundForUnit(ctx.units.convertQty(prep, evUnit(), st.unit), st.unit);
      try {
        const fin2 = await ctx.events.stop(ev.id, { data });
        if (fin2.data && fin2.data.sourceInventoryId) {
          try { await ctx.stash.consumeForFeed(fin2); } catch (err) { console.warn('feed sheet: pouch not updated', err); }
        }
        await succeed(btn);
      } catch (err) {
        busy = false;
        done = false;
        setBusy(btn, false);
        lockFooter(body, false);
        console.warn('feed sheet: bottle not finished', err);
        showError(body);
      }
    }

    async function onDiscard(e) {
      const btn = e.currentTarget;
      if (busy) return;
      busy = true;
      done = true;
      setBusy(btn, true);
      lockFooter(body, true);
      try {
        api.close('discarded');
        await discardBottle(ctx, ev);
      } catch (err) {
        console.warn('feed sheet: bottle not discarded', err);
      }
    }

    return () => { clearTimeout(timer); offEvents(); unitHook = null; stepper.destroy(); };
  }

  // ========================================================= breast form

  function breastForm(body) {
    api.setTitle(showMethodSwitch ? titleFor('feed') : titleFor('breast'));
    setChip('when');
    const last = cache.lastBreast.get(babyId);
    const lastSide = last && last.data ? (last.data.lastSide === 'right' ? 'right' : 'left') : null;
    const suggest = p.side === 'left' || p.side === 'right' ? p.side : lastSide === 'left' ? 'right' : 'left';
    const other = runningFor(babyId);
    let busy = false;
    render(body, html`<div class="fd">
        ${methodSwitch('breast')}
        <p class="fd-hint">${lastSide ? html`Start on <b>${suggest}</b> · last was ${SIDE_LETTER[lastSide]}` : 'Which side first?'}</p>
        <div class="tiles fd-sides">
          ${['left', 'right'].map((side) => html`<button type="button" class="tile cat-feed fd-side ${lastSide && side === suggest ? 'is-suggested' : ''}" data-side="${side}" data-stagger data-lockable ${other ? 'disabled' : ''}>
              <span class="tile-ic fd-letter" aria-hidden="true">${SIDE_LETTER[side]}</span>
              <span class="tile-label">Start ${side}</span>
              <small class="tile-ctx">${lastSide && side === suggest ? 'Suggested' : lastSide === side ? 'Last time' : 'Tap to start'}</small>
            </button>`)}
        </div>
        ${other ? html`<div class="fd-banner cat-feed">
            <span class="dot" aria-hidden="true"></span>
            <span class="fd-banner-text">${methodOf(other) === 'breast' ? 'A breastfeed' : 'A bottle'} is running for ${name}.</span>
            <button type="button" class="btn btn-ghost btn-sm" data-open-running>Open it</button>
          </div>` : ''}
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-secondary btn-block" data-past>${I('edit', 22)}Log a past feed</button>
        </div>
      </div>`);
    bindMethodSwitch(body, 'breast');
    const openRun = body.querySelector('[data-open-running]');
    if (openRun) openRun.addEventListener('click', () => { const r = runningFor(babyId); if (r) go({ view: methodOf(r) === 'breast' ? 'liveBreast' : 'liveBottle', event: r }); });
    body.querySelector('[data-past]').addEventListener('click', () => go({ view: 'past' }));
    for (const tile of body.querySelectorAll('[data-side]')) {
      tile.addEventListener('click', async () => {
        if (busy || tile.disabled) return;
        busy = true;
        lockFooter(body, true);
        const side = tile.dataset.side;
        try {
          const ev = await ctx.events.start('feed', { method: 'breast', left: 0, right: 0, activeSide: side, lastSide: side }, { startTime: st.when ?? Date.now(), babyId });
          go({ view: 'liveBreast', event: ev });
        } catch (err) {
          busy = false;
          lockFooter(body, false);
          if (isRunningError(ctx, err) && err.running) { go({ view: methodOf(err.running) === 'breast' ? 'liveBreast' : 'liveBottle', event: err.running }); return; }
          console.warn('feed sheet: breastfeed not started', err);
          showError(body);
        }
      });
    }
    return null;
  }

  // ===================================================== past breastfeed

  function breastPast(body) {
    api.setTitle(titleFor('past'));
    setChip('when');
    const last = cache.lastBreast.get(babyId);
    const mins = { left: 10, right: 10 };
    let ended = last && last.data && last.data.lastSide === 'left' ? 'right' : 'left';
    let busy = false;
    const ids = { l: uid(), r: uid() };
    render(body, html`<div class="fd">
        <button type="button" class="btn btn-ghost fd-back" data-back>${I('chev-l', 20)}Back</button>
        <div class="fd-amount fd-amount-sm">
          <p class="fd-label" id="${ids.l}">Left side</p>
          ${stepperTpl(ids.l, 'l')}
        </div>
        <div class="fd-amount fd-amount-sm">
          <p class="fd-label" id="${ids.r}">Right side</p>
          ${stepperTpl(ids.r, 'r')}
        </div>
        <div class="fd-row">
          <span class="fd-label">Finished on</span>
          ${segTpl('ended', [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], ended, 'Finished on')}
        </div>
        <p class="note fd-note">${I('clock', 16)}<span>The time above is when the feed ended.</span></p>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-log>Log breastfeed</button>
        </div>
      </div>`);
    const logBtn = body.querySelector('[data-log]');
    const mk = (key, side) => makeStepper(ctx, body.querySelector(`[data-stepper="${key}"]`), {
      guardFrom: openedAt, value: mins[side], unit: 'min', min: 0, max: 90, step: 1, fine: 1, presets: [5, 10, 15, 20],
      label: `${SIDE_WORD[side]} side minutes`, keypadTitle: `${SIDE_WORD[side]} side`,
      onChange(v) { mins[side] = v; logBtn.disabled = !(mins.left + mins.right > 0); },
    });
    const sl = mk('l', 'left');
    const sr = mk('r', 'right');
    bindSeg(body.querySelector('[data-seg="ended"]'), (v) => { ended = v; });
    body.querySelector('[data-back]').addEventListener('click', () => go({ view: 'form', method: 'breast' }, 'back'));
    logBtn.addEventListener('click', async () => {
      if (busy || logBtn.disabled) return;
      busy = true;
      setBusy(logBtn, true);
      lockFooter(body, true);
      const end = st.when ?? Date.now();
      const total = (mins.left + mins.right) * MINUTE;
      try {
        await ctx.events.add({
          type: 'feed', startTime: end - total, endTime: end, babyId,
          data: { method: 'breast', left: mins.left * 60, right: mins.right * 60, lastSide: ended, activeSide: null },
        });
        await succeed(logBtn);
      } catch (err) {
        busy = false;
        setBusy(logBtn, false);
        lockFooter(body, false);
        console.warn('feed sheet: breastfeed not logged', err);
        showError(body);
      }
    });
    return () => { sl.destroy(); sr.destroy(); };
  }

  // ========================================================= live breast

  function liveBreast(body, event) {
    let ev = event;
    let done = false;
    let busy = false;
    api.setTitle(titleFor('breast'));
    setChip('none');
    render(body, html`<div class="fd fd-live">
        <div class="fd-hero cat-feed">
          <span class="fd-timer num" aria-hidden="true" data-total>00:00</span>
          <span class="fd-hero-sub" data-state></span>
        </div>
        <div class="tiles fd-sides" role="group" aria-label="Sides">
          ${['left', 'right'].map((side) => html`<button type="button" class="tile cat-feed fd-side" data-side="${side}" data-lockable aria-pressed="false">
              <span class="tile-ic fd-letter" aria-hidden="true">${SIDE_LETTER[side]}</span>
              <span class="tile-label">${SIDE_WORD[side]} <span class="num fd-side-time" data-side-time="${side}">0:00</span></span>
              <small class="tile-ctx" data-side-ctx="${side}"></small>
            </button>`)}
        </div>
        <p class="sr-only" aria-live="polite" data-announce></p>
        <button type="button" class="btn btn-ghost fd-mistake" data-discard data-lockable>Started by mistake? Discard</button>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-finish>Finish</button>
          <button type="button" class="btn btn-secondary btn-block" data-pause></button>
        </div>
      </div>`);
    const totalEl = body.querySelector('[data-total]');
    const stateEl = body.querySelector('[data-state]');
    const pauseBtn = body.querySelector('[data-pause]');
    const announceEl = body.querySelector('[data-announce]');
    let paintedSide = undefined;

    const mmss = (sec) => {
      const s = Math.max(0, Math.floor(sec));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };

    function paint() {
      const now = Date.now();
      const d = ev.data || {};
      const t = breastSideTotals(d, now);
      totalEl.textContent = ctx.time.timerClock(t.total);
      const active = d.activeSide === 'left' || d.activeSide === 'right' ? d.activeSide : null;
      for (const side of ['left', 'right']) body.querySelector(`[data-side-time="${side}"]`).textContent = mmss(t[side]);
      if (paintedSide !== active) {
        paintedSide = active;
        render(stateEl, active ? html`<span class="dot" aria-hidden="true"></span>${SIDE_WORD[active]} side` : html`${I('pause', 16)}Paused`);
        for (const side of ['left', 'right']) {
          const tile = body.querySelector(`[data-side="${side}"]`);
          const on = side === active;
          tile.classList.toggle('is-live', on);
          tile.setAttribute('aria-pressed', on ? 'true' : 'false');
          render(body.querySelector(`[data-side-ctx="${side}"]`), on ? html`<span class="dot"></span>Now · tap to pause` : active ? 'Tap to switch' : 'Tap to resume');
        }
        render(pauseBtn, active ? html`${I('pause', 22)}Pause` : html`${I('play', 22)}Resume ${d.lastSide === 'right' ? 'right' : 'left'}`);
      }
    }

    let timer = 0;
    const loop = () => {
      paint();
      const anchor = (ev.data && Number.isFinite(ev.data.activeSince) && ev.data.activeSince) || ev.startTime;
      const ms = 1000 - ((Date.now() - anchor) % 1000);
      timer = setTimeout(loop, Math.max(30, ms + 5));
    };
    loop();

    async function setSide(side) {
      if (busy) return;
      busy = true;
      try {
        ev = await ctx.events.update(ev.id, { data: { activeSide: side } });
        announceEl.textContent = side ? `${SIDE_WORD[side]} side` : 'Paused';
        clearTimeout(timer);
        loop();
      } catch (err) {
        console.warn('feed sheet: side not changed', err);
        showError(body, 'That didn’t change. Try again.');
      } finally { busy = false; }
    }

    for (const tile of body.querySelectorAll('[data-side]')) {
      tile.addEventListener('click', () => {
        const side = tile.dataset.side;
        const active = ev.data && ev.data.activeSide;
        setSide(active === side ? null : side);
      });
    }
    pauseBtn.addEventListener('click', () => {
      const d = ev.data || {};
      setSide(d.activeSide ? null : (d.lastSide === 'right' ? 'right' : 'left'));
    });
    body.querySelector('[data-finish]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (busy) return;
      busy = true;
      done = true;
      setBusy(btn, true);
      lockFooter(body, true);
      try {
        await ctx.events.stop(ev.id);
        await succeed(btn);
      } catch (err) {
        busy = false;
        done = false;
        setBusy(btn, false);
        lockFooter(body, false);
        console.warn('feed sheet: breastfeed not finished', err);
        showError(body);
      }
    });
    body.querySelector('[data-discard]').addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      done = true;
      api.close('discarded');
      try {
        const removed = await ctx.events.remove(ev.id);
        if (removed) ctx.toast({ message: 'Breastfeed discarded', action: { label: 'Undo', run: () => ctx.events.restore(removed) } });
      } catch (err) { console.warn('feed sheet: breastfeed not discarded', err); }
    });

    const offEvents = ctx.events.subscribe((change) => {
      if (!change) return;
      if (change.op === 'bulk') { ctx.events.get(ev.id).then((e) => { if (!done && (!e || e.endTime !== null)) api.close(); else if (e) { ev = e; paintedSide = undefined; paint(); } }).catch(() => {}); return; }
      const e = change.event;
      if (!e || e.id !== ev.id) return;
      if (change.op === 'remove' || e.endTime !== null) { if (!done && api.isOpen()) api.close(); return; }
      ev = e;
      paintedSide = undefined;
      clearTimeout(timer);
      loop();
    });
    ctx.events.get(ev.id).then((e) => { if (!done && api.isOpen() && (!e || e.endTime !== null)) api.close(); }).catch(() => {});

    return () => { clearTimeout(timer); offEvents(); };
  }

  // ======================================================== templates

  function segTpl(key, options, selected, label) {
    return html`<div class="segmented cat-scoped cat-feed fd-seg" role="radiogroup" aria-label="${label}" data-seg="${key}">
        ${options.map((o) => html`<button type="button" role="radio" aria-checked="${o.value === selected ? 'true' : 'false'}" tabindex="${o.value === selected ? '0' : '-1'}" data-value="${o.value}">${o.icon ? I(o.icon, 18) : ''}${o.label}</button>`)}
      </div>`;
  }

  function stepperTpl(labelId, key = 'amt') {
    return html`<div class="fd-stepper" data-stepper="${key}">
        <div class="stepper">
          <button type="button" class="stepper-btn" data-dec aria-label="Less">${I('minus', 24)}</button>
          <label class="fd-value">
            <input class="fd-value-input num" data-amount type="text" role="spinbutton" readonly inputmode="none" autocomplete="off" aria-describedby="${labelId}">
            <small class="fd-value-unit" aria-hidden="true" data-unit></small>
          </label>
          <button type="button" class="stepper-btn" data-inc aria-label="More">${I('plus', 24)}</button>
        </div>
        <div class="quick-chips" data-presets></div>
      </div>`;
  }
}

// ======================================================== controls

/** Segmented control: role=radiogroup, arrows move + select (DESIGN §6.8). */
function bindSeg(seg, onChange) {
  bindRadios(seg, '[role="radio"]', (btn) => onChange(btn.dataset.value));
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
    if (btn.getAttribute('aria-checked') === 'true') return;
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

/**
 * NumberStepper (DESIGN §6.8): − value + with quick presets. The value is a
 * read-only role=spinbutton input (arrow keys / Page / Home / End); tapping
 * it opens the keypad sheet, so nothing swaps size. Hold −/+ to repeat 8/s.
 * @returns {{ readonly value: number, set: (v: number, silent?: boolean) => void, configure: (o: object) => void, destroy: () => void }}
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

  const unitLabel = () => (o.unit === 'min' ? 'min' : o.unit);
  const snap = (v) => ctx.units.clampAmount(v, o.min, o.max, o.fine);

  function renderPresets() {
    render(presetsEl, (o.presets || []).map((p) => html`<button type="button" class="quick-chip" data-preset="${p}" aria-pressed="false" aria-label="${spokenAmount(p, o.unit)}">${p} ${unitLabel()}</button>`));
  }

  function paint() {
    const text = numText(ctx, value, o.unit);
    input.value = text;
    // Nunito digits are 0.6em (tabular); the point is narrower.
    const dots = (text.match(/\./g) || []).length;
    input.style.setProperty('--w', `${((text.length - dots) * 0.6 + dots * 0.3 + 0.06).toFixed(2)}em`);
    input.setAttribute('aria-valuenow', String(value));
    input.setAttribute('aria-valuemin', String(o.min));
    input.setAttribute('aria-valuemax', String(o.max));
    input.setAttribute('aria-valuetext', spokenAmount(Number(text), o.unit));
    input.setAttribute('aria-label', `${o.label}. Tap to type`);
    unitEl.textContent = unitLabel();
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
    const base = dir > 0 ? Math.floor((value + 1e-9) / s) * s + s : Math.ceil((value - 1e-9) / s) * s - s;
    set(base);
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
    // The tail of the tap that opened the sheet is not a press (sheet.js ENTER_GUARD_MS).
    if (o.guardFrom && performance.now() - o.guardFrom < 350) { pointerStepped = true; return; }
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

  const decDown = (e) => onPointerDown(e, -1);
  const incDown = (e) => onPointerDown(e, 1);
  dec.addEventListener('pointerdown', decDown);
  inc.addEventListener('pointerdown', incDown);
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
      const v = await openKeypad(ctx, {
        origin: input,
        title: o.keypadTitle || o.label,
        value,
        unit: o.unit,
        max: o.max,
        decimals: o.unit === 'oz' ? 1 : 0,
        firstKey,
      });
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

/**
 * Keypad sheet (DESIGN §6.8 NumberStepper + Keypad): a nested sheet with a
 * big readout and a 3×4 pad. Resolves the number, or null when dismissed.
 */
function openKeypad(ctx, { origin, title, value, unit, max, decimals, firstKey }) {
  const { html, raw, render } = ctx.html;
  const I = (n, s) => raw(ctx.icons.icon(n, { size: s }));
  const unitLabel = unit === 'min' ? 'min' : unit;
  return new Promise((resolve) => {
    let result = null;
    let text = numText(ctx, value, unit);
    let fresh = true;
    ctx.openSheet({
      title,
      origin,
      className: 'sheet-feed sheet-keypad',
      onClose: () => resolve(result),
      render(body, api) {
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? '.' : '', '0', 'del'];
        render(body, html`<div class="fd fd-kp">
            <p class="fd-kp-display num" aria-live="polite"><span data-kp-val></span><small>${unitLabel}</small></p>
            <p class="fd-kp-help" data-kp-help></p>
            <div class="fd-kp-grid">
              ${keys.map((k) => (k === '' ? html`<span aria-hidden="true"></span>`
                : k === 'del' ? html`<button type="button" class="fd-key fd-key-del" data-key="del" aria-label="Delete">${I('chev-l', 26)}</button>`
                  : html`<button type="button" class="fd-key num" data-key="${k}" ${k === '.' ? raw('aria-label="Decimal point"') : ''}>${k}</button>`))}
            </div>
            <div class="sheet-footer"><button type="button" class="btn btn-primary btn-block" data-kp-done>Done</button></div>
          </div>`);
        const valEl = body.querySelector('[data-kp-val]');
        const help = body.querySelector('[data-kp-help]');
        const paint = () => {
          valEl.textContent = text === '' ? '0' : text;
          const n = Number(text);
          help.textContent = Number.isFinite(n) && n > max ? `Up to ${max} ${unitLabel}` : '';
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
        body.querySelector('.fd-kp-grid').addEventListener('click', (e) => {
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
 * Time picker sheet (the header time chip, DESIGN §6.6): one-tap "Now / 5 /
 * 15 / 30 min / 1 hour ago", or Today | Yesterday + a time field. Never a
 * time in the future. Resolves { ts } (ts null = now) or undefined.
 */
function openWhen(ctx, { origin, value = null, title = 'When?', nowLabel = 'Now' }) {
  const { html, render } = ctx.html;
  return new Promise((resolve) => {
    let result;
    const base = value ?? Date.now();
    const pad2 = (n) => String(n).padStart(2, '0');
    const d0 = new Date(base);
    const yesterday = !ctx.time.isSameDay(base, Date.now());
    ctx.openSheet({
      title,
      origin,
      className: 'sheet-feed sheet-when',
      onClose: () => resolve(result),
      render(body, api) {
        const quick = [[0, nowLabel], [5, '5 min ago'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 hour ago']];
        render(body, html`<div class="fd fd-when">
            <div class="chip-row fd-when-quick">
              ${quick.map(([m, l]) => html`<button type="button" class="chip" data-ago="${m}"><span class="chip-face">${l}</span></button>`)}
            </div>
            <div class="fd-when-custom">
              <div class="segmented fd-seg" role="radiogroup" aria-label="Day" data-seg="day">
                <button type="button" role="radio" aria-checked="${yesterday ? 'false' : 'true'}" tabindex="${yesterday ? '-1' : '0'}" data-value="today">Today</button>
                <button type="button" role="radio" aria-checked="${yesterday ? 'true' : 'false'}" tabindex="${yesterday ? '0' : '-1'}" data-value="yesterday">Yesterday</button>
              </div>
              <label class="field fd-when-field"><span class="field-label">Time</span>
                <input class="field-input num" type="time" step="60" data-time value="${pad2(d0.getHours())}:${pad2(d0.getMinutes())}">
              </label>
            </div>
            <p class="field-error" data-when-error role="status" hidden></p>
            <div class="sheet-footer"><button type="button" class="btn btn-primary btn-block" data-when-done>Set time</button></div>
          </div>`);
        let day = yesterday ? 'yesterday' : 'today';
        const err = body.querySelector('[data-when-error]');
        const input = body.querySelector('[data-time]');
        bindSeg(body.querySelector('[data-seg="day"]'), (v) => { day = v; err.hidden = true; });
        body.querySelector('.fd-when-quick').addEventListener('click', (e) => {
          const b = e.target.closest('[data-ago]');
          if (!b) return;
          const m = Number(b.dataset.ago);
          result = { ts: m === 0 ? null : Date.now() - m * MINUTE };
          api.close(result);
        });
        input.addEventListener('input', () => { err.hidden = true; });
        body.querySelector('[data-when-done]').addEventListener('click', () => {
          const m = /^(\d{1,2}):(\d{2})/.exec(input.value || '');
          if (!m) { render(err, 'Pick a time.'); err.hidden = false; return; }
          const now = new Date();
          const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 'yesterday' ? 1 : 0), Number(m[1]), Number(m[2])).getTime();
          if (t > Date.now() + 30 * 1000) { render(err, 'That time hasn’t happened yet.'); err.hidden = false; return; }
          result = { ts: Date.now() - t < MINUTE ? null : t };
          api.close(result);
        });
      },
    });
  });
}

// =================================================== express gesture

/**
 * Press and hold the + (DESIGN §7.2 #4): after 450 ms a pad grows out of the
 * + (clip-path circle from its center). Slide up/down for the milk (sticky,
 * with hysteresis), sideways for the amount; lift to log a finished bottle
 * with an Undo toast; slide back onto the + (or Esc) to cancel. A running
 * bottle opens its live sheet instead.
 */
function setupExpress(ctx) {
  let hold = null;
  let session = null;
  let suppressUntil = 0;

  const removeHold = () => {
    window.removeEventListener('pointermove', onHoldMove, true);
    window.removeEventListener('pointerup', endHold, true);
    window.removeEventListener('pointercancel', endHold, true);
  };
  function endHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    removeHold();
    hold = null;
  }
  function onHoldMove(e) {
    if (!hold || e.pointerId !== hold.id) return;
    if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) endHold();
  }
  function afterLift(id, fn) {
    const up = (e) => {
      if (e.pointerId !== id) return;
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      fn();
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  function fire() {
    const h = hold;
    removeHold();
    hold = null;
    if (!h || !h.fab.isConnected || document.documentElement.classList.contains('has-sheet')) return;
    suppressUntil = Infinity;
    afterLift(h.id, () => { suppressUntil = Date.now() + 450; });
    try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* unsupported */ }
    const baby = ctx.activeBaby();
    const run = runningFor(baby ? baby.id : null);
    if (run && methodOf(run) === 'bottle') { openFeedSheet(ctx, { origin: h.fab, resume: run }); return; }
    session = startPad(ctx, h, () => { session = null; });
  }

  document.addEventListener('pointerdown', (e) => {
    // A new press is a new gesture: only the click that ends a hold is eaten.
    if (!session) suppressUntil = 0;
    const fab = e.target && e.target.closest ? e.target.closest('#fab') : null;
    if (!fab || hold || session) return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (document.documentElement.classList.contains('has-sheet')) return;
    const t = ctx.settings.get('trackers') || {};
    if (t.bottle === false) return;
    hold = { id: e.pointerId, x: e.clientX, y: e.clientY, fab, timer: setTimeout(fire, HOLD_MS) };
    window.addEventListener('pointermove', onHoldMove, true);
    window.addEventListener('pointerup', endHold, true);
    window.addEventListener('pointercancel', endHold, true);
  }, true);
  // The release of a hold is not a tap on the + (no quick-log sheet).
  document.addEventListener('click', (e) => {
    if (Date.now() >= suppressUntil) return;
    const t = e.target;
    if (t && t.closest && (t.closest('#fab') || t.closest('.xp-layer') || t === document.body)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressUntil = 0;
    }
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.closest && e.target.closest('#fab')) e.preventDefault();
  }, true);
}

function startPad(ctx, h, onEnd) {
  const { html, raw, element } = ctx.html;
  const I = (n, s) => raw(ctx.icons.icon(n, { size: s }));
  const trackers = ctx.settings.get('trackers') || {};
  const unit = unitsNow(ctx);
  const cfg = ctx.units.inputConfig(unit);
  const baby = ctx.activeBaby();
  const babyId = baby ? baby.id : null;
  const name = ctx.format.babyName(baby);
  const last = cache.lastBottle.get(babyId);
  const lastMilk = last && last.data && last.data.milk === 'formula' ? 'formula' : 'breastmilk';
  const formulaOn = trackers.formula !== false;
  const lower = formulaOn ? lastMilk : 'breastmilk';
  const upper = formulaOn ? (lower === 'formula' ? 'breastmilk' : 'formula') : null;
  const word = (m) => (m === 'formula' ? 'Formula' : 'Breast milk');
  const base = defaultBottleAmount(ctx, babyId, unit);
  const PX_PER_STEP = 16;
  const CANCEL_R = 30;
  const HYST = 20;
  const reduced = ctx.motionReduced();

  const layer = element(html`<div class="xp-layer ${reduced ? 'is-reduced' : ''}" data-state="pre" aria-hidden="true">
      <div class="xp-scrim"></div>
      <div class="xp-pad cat-feed">
        <p class="xp-cap eyebrow">Bottle for ${name}</p>
        ${upper ? html`<div class="xp-zone" data-zone="upper"><span class="xp-zone-ic">${I('bottle', 20)}</span><b>${word(upper)}</b><small>Slide up</small></div>` : ''}
        <div class="xp-readout">
          <span class="xp-arrow">${I('chev-l', 22)}</span>
          <span class="xp-amt num"><b data-xp-amt></b><small>${unit}</small></span>
          <span class="xp-arrow">${I('chev-r', 22)}</span>
        </div>
        <p class="xp-sub">Slide sideways for more or less</p>
        <div class="xp-zone" data-zone="lower"><span class="xp-zone-ic">${I('bottle', 20)}</span><b>${word(lower)}</b><small>${upper ? 'Slide up a little' : 'Slide up'}</small></div>
        <p class="xp-foot" data-xp-foot></p>
      </div>
      <div class="xp-anchor">${I('plus-bold', 30)}</div>
    </div>`);
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'assertive');
  layer.appendChild(live);

  const fr = h.fab.getBoundingClientRect();
  const cx = fr.left + fr.width / 2;
  const cy = fr.top + fr.height / 2;
  layer.style.setProperty('--xp-fab-l', `${fr.left}px`);
  layer.style.setProperty('--xp-fab-t', `${fr.top}px`);
  layer.style.setProperty('--xp-fab-s', `${fr.width}px`);
  layer.style.setProperty('--xp-bottom', `${Math.max(0, window.innerHeight - fr.top + 12)}px`);
  document.body.appendChild(layer);
  const pad = layer.querySelector('.xp-pad');
  const pr = pad.getBoundingClientRect();
  pad.style.setProperty('--gx', `${cx - pr.left}px`);
  pad.style.setProperty('--gy', `${cy - pr.top}px`);
  pad.style.setProperty('--gr', `${fr.width / 2}px`);
  const upperEl = layer.querySelector('[data-zone="upper"]');
  const lowerEl = layer.querySelector('[data-zone="lower"]');
  const amtEl = layer.querySelector('[data-xp-amt]');
  const footEl = layer.querySelector('[data-xp-foot]');
  const boundary = upperEl
    ? (upperEl.getBoundingClientRect().bottom + lowerEl.getBoundingClientRect().top) / 2
    : -Infinity;
  layer.getBoundingClientRect();
  layer.setAttribute('data-state', 'open');

  const st = { milk: null, amount: base, cancel: true, ended: false };

  function paint() {
    amtEl.textContent = numText(ctx, st.amount, unit);
    if (upperEl) upperEl.classList.toggle('is-on', !st.cancel && st.milk === upper);
    lowerEl.classList.toggle('is-on', !st.cancel && st.milk === lower);
    layer.classList.toggle('is-cancel', st.cancel);
    footEl.textContent = st.cancel ? 'Lift on + to cancel' : `Lift to log ${ctx.format.amount(st.amount, unit)} ${word(st.milk).toLowerCase()}`;
  }

  const onMove = (e) => {
    if (e.pointerId !== h.id || st.ended) return;
    const dx = e.clientX - h.x;
    const dy = e.clientY - h.y;
    const prevMilk = st.milk;
    if (Math.hypot(dx, dy) < CANCEL_R) {
      st.cancel = true;
    } else {
      st.cancel = false;
      if (!upper) st.milk = lower;
      else if (!st.milk) st.milk = e.clientY < boundary ? upper : lower;
      else if (st.milk === lower && e.clientY < boundary - HYST) st.milk = upper;
      else if (st.milk === upper && e.clientY > boundary + HYST) st.milk = lower;
      st.amount = ctx.units.clampAmount(base + Math.round(dx / PX_PER_STEP) * cfg.step, cfg.step, cfg.max, cfg.fineStep);
    }
    if (prevMilk && st.milk !== prevMilk) {
      try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* unsupported */ }
      live.textContent = word(st.milk);
    }
    paint();
  };
  const onUp = (e) => {
    if (e.pointerId !== h.id) return;
    finish(e.type === 'pointerup' && !st.cancel && !!st.milk);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  const onVis = () => { if (document.hidden) finish(false); };

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', onVis);
  paint();

  function finish(log) {
    if (st.ended) return;
    st.ended = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    // Collapse back into the + (#4), then go.
    if (pad.getAnimations) for (const a of pad.getAnimations()) a.finish();
    layer.setAttribute('data-state', 'closing');
    const remove = () => { layer.remove(); onEnd(); };
    let gone = false;
    const once = () => { if (!gone) { gone = true; remove(); } };
    pad.addEventListener('transitionend', (ev) => { if (ev.target === pad) once(); });
    setTimeout(once, reduced ? 320 : 420);
    if (log) logBottle(ctx, { babyId, milk: st.milk, amount: st.amount, unit, forName: (ctx.settings.get('babies') || []).length > 1 ? name : '' });
  }

  return { cancel: () => finish(false) };
}

async function logBottle(ctx, { babyId, milk, amount, unit, forName = '' }) {
  try {
    const ev = await ctx.events.add({ type: 'feed', babyId, data: { method: 'bottle', milk, amount, unit } });
    bumpExpressUses();
    ctx.toast({
      message: `Logged ${ctx.format.amount(amount, unit)} ${milk === 'formula' ? 'formula' : 'breast milk'}${forName ? ` for ${forName}` : ''}`,
      action: { label: 'Undo', doneMessage: 'Removed', run: () => ctx.events.remove(ev.id) },
    });
  } catch (err) {
    console.warn('feed sheet: express bottle not logged', err);
    ctx.toast({ message: 'That didn’t save. Try again.', tone: 'warn' });
  }
}

// ================================================================ setup

/**
 * One-time wiring at boot (called by app.js): the data cache, the live-pill
 * handlers and the express gesture on the +.
 * @param {object} ctx
 */
export function setup(ctx) {
  cacheCtx = ctx;
  ctx.events.subscribe((c) => {
    if (!c || c.op === 'bulk' || (c.event && c.event.type === 'feed') || (c.prev && c.prev.type === 'feed')) scheduleRefresh({ events: true });
  });
  ctx.stash.subscribe(() => scheduleRefresh({ stash: true }));
  ctx.settings.subscribe((c) => {
    if (c && (c.key === 'babies' || c.key === '*')) scheduleRefresh({ events: true, stash: c.key === '*' });
  });
  scheduleRefresh({ events: true, stash: true });

  // 'feed' (not 'feed:bottle') so a test or another module can still
  // override bottles with a plain 'feed' handler; breastfeeding is more
  // specific and wins for method 'breast'.
  ctx.livePill.register('feed', {
    open: (event, origin) => openFeedSheet(ctx, { origin, resume: event }),
    finish: (event, origin) => (isBreast(event) ? finishBreast(ctx, event) : openFeedSheet(ctx, { origin, resume: event, finishing: true })),
    discard: (event) => discardBottle(ctx, event),
  });
  ctx.livePill.register('feed:breast', {
    open: (event, origin) => openFeedSheet(ctx, { origin, resume: event }),
    finish: (event) => finishBreast(ctx, event),
    resume: (event) => ctx.events.update(event.id, { data: { activeSide: event.data && event.data.lastSide === 'right' ? 'right' : 'left' } }),
  });

  setupExpress(ctx);
}
