// Quick log — the "+" sheet (DESIGN §6.7, §13 Frame 3, motion #3 / #18).
//
//  - Grows out of the + (the + carries [data-sheet-grow]; sheet.js does the
//    clip-path growth, the × twin that stays in place, and the reduced-motion
//    × swap). Tiles rise in staggered ([data-stagger]).
//  - Header: "Log for <name>" + a time chip ("Now 9:50 ▾") that back-dates
//    whatever is logged next from this sheet: the one-tap diaper, an ended
//    nap, and it is handed to the next sheet as preset.startTime.
//  - Context-aware tiles, visible trackers only:
//      Bottle      "Feed a bottle" · "● Running 12:04" (live) → resume it
//      Breastfeed  "Start on left · last was R" · "● Left side 8:12" (live)
//      Pump        "12.5 of 24 oz today" · "● Pumping 12:04" (live)
//      Sleep       "Start a nap" / "Start night sleep" · End nap "Asleep 55m"
//                  (sun, live) → logs the wake-up here, with Undo
//      Diaper row  Wet / Dirty / Both commit at once (button flashes, the
//                  sheet collapses into the +, the row lands, Undo toast)
//      Memory, Stash milk (row tiles)
//  - A tile closes this sheet and opens its own sheet through ctx.sheets with
//    the + as origin (the tile is gone by then; focus returns to the +, and
//    the next sheet's × twin sits exactly on the +).
//  - Opening is synchronous (the + must never open-then-close on a double
//    tap): tiles render from a model cached by setup()'s store subscriptions,
//    then refresh in place.

import { classifyNapOrNight } from '../domain/sleep.js';
import { pumpProgress } from '../domain/trends.js';
import { breastSideTotals } from '../domain/safety.js';

const LS_EXPRESS_USES = 'nurture.expressUses'; // feed.js counts uses of hold-+ (the express gesture)
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;
const DIAPER_TOAST = Object.freeze({ wet: 'Wet diaper logged', dirty: 'Dirty diaper logged', both: 'Wet + dirty diaper logged' });
const WHEN_CHIPS = Object.freeze([
  { min: 0, label: 'Now' }, { min: 5, label: '5 min ago' }, { min: 15, label: '15 min ago' },
  { min: 30, label: '30 min ago' }, { min: 60, label: '1 hour ago' }, { min: 120, label: '2 hours ago' },
]);

let cache = null;       // last computed model (see computeModel)
let cacheGen = 0;

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }

/**
 * Everything the tiles need, for the active baby.
 * @param {object} ctx
 */
async function computeModel(ctx) {
  const b = ctx.settings.activeBaby();
  const babyId = b ? b.id : undefined;
  const dayStart = ctx.time.dayBounds(Date.now()).start;
  const [running, lastBreast, pumps] = await Promise.all([
    ctx.events.running(undefined, { babyId }),
    ctx.events.last('feed', (e) => !!(e.data && e.data.method === 'breast'), { babyId }),
    ctx.events.query({ type: 'pump', from: dayStart }),
  ]);
  return { babyId, dayStart, running, lastBreast, pumps };
}

function refreshCache(ctx) {
  const gen = (cacheGen += 1);
  return computeModel(ctx).then((m) => { if (gen === cacheGen) cache = m; return m; }, (err) => {
    console.warn('quick log: model refresh failed', err);
    return cache;
  });
}

/**
 * Open the quick-log sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element }} [opts] origin: the + (grows from it) or any trigger
 * @returns {object} sheet api
 */
export function openQuickLogSheet(ctx, { origin } = {}) {
  const { html, render } = ctx.html;
  const { iconHtml } = ctx.icons;
  const F = ctx.format;
  const I = (name, size) => iconHtml(name, { size });
  const t = ctx.settings.get('trackers') || {};
  const unit = ctx.settings.get('units') === 'mL' ? 'mL' : 'oz';
  const b = ctx.settings.activeBaby();
  const babyId = b ? b.id : undefined;
  const name = F.babyName(b);

  let model = cache && cache.babyId === babyId && cache.dayStart === ctx.time.dayBounds(Date.now()).start ? cache : null;
  let chosen = null;      // back-dated time (epoch ms) or null = now
  let busy = false;       // a tile/diaper action is under way (double-tap guard)
  let tilesStep = null;   // the step element holding the tiles (null while picking a time)
  let ticker = 0;
  let closed = false;

  const tileKeys = [
    t.bottle !== false && 'bottle',
    t.breastfeeding !== false && 'breast',
    t.pump !== false && 'pump',
    t.sleep !== false && 'sleep',
  ].filter(Boolean);
  const rowKeys = [t.memories !== false && 'memory', t.stash !== false && 'stash'].filter(Boolean);
  const hasDiaper = t.diaper !== false;
  const nothing = !tileKeys.length && !rowKeys.length && !hasDiaper;

  // ------------------------------------------------------------ models
  const runningOf = (type, pred) => (model ? model.running.find((e) => e.type === type && (!pred || pred(e))) : null) || null;
  const isBottle = (e) => !!(e.data && e.data.method !== 'breast');
  const isBreast = (e) => !!(e.data && e.data.method === 'breast');
  const at = () => chosen ?? Date.now();
  const withTime = (preset) => (chosen === null ? preset : { ...preset, startTime: chosen });

  /** One tile at `now`. */
  function tileModel(key, now) {
    switch (key) {
      case 'bottle': {
        const live = runningOf('feed', isBottle);
        if (live) {
          const sec = Math.floor(Math.max(0, now - live.startTime) / 1000);
          return {
            key, cat: 'feed', icon: 'bottle', label: 'Bottle', live: true,
            ctx: html`<span class="dot"></span>Running <b class="num">${ctx.time.timerClock(sec)}</b>`,
            aria: `Bottle, running ${F.spanSpoken(now - live.startTime)}. Open the bottle timer.`,
            open: (o) => ctx.sheets.feed({ origin: o, resume: live }),
          };
        }
        return {
          key, cat: 'feed', icon: 'bottle', label: 'Bottle', ctx: html`Feed a bottle`, aria: 'Bottle. Feed a bottle.',
          open: (o) => ctx.sheets.feed({ origin: o, preset: withTime({ method: 'bottle' }) }),
        };
      }
      case 'breast': {
        const live = runningOf('feed', isBreast);
        if (live) {
          const tot = breastSideTotals(live.data, now);
          const side = live.data.activeSide;
          const word = side ? `${side === 'left' ? 'Left' : 'Right'} side` : 'Paused';
          return {
            key, cat: 'feed', icon: 'breast', label: 'Breastfeed', live: true,
            ctx: html`<span class="dot"></span>${word} <b class="num">${ctx.time.timerClock(tot.total)}</b>`,
            aria: `Breastfeed, ${word.toLowerCase()}, ${F.spanSpoken(tot.total * 1000)}. Open the breastfeeding timer.`,
            open: (o) => ctx.sheets.feed({ origin: o, resume: live }),
          };
        }
        const lb = model && model.lastBreast;
        const last = lb && lb.data ? (lb.data.lastSide === 'right' ? 'right' : 'left') : null;
        const next = last === 'left' ? 'right' : 'left';
        return {
          key, cat: 'feed', icon: 'breast', label: 'Breastfeed',
          ctx: last ? html`Start on <b>${next}</b> · last was ${last === 'left' ? 'L' : 'R'}` : html`Left / right timer`,
          aria: last ? `Breastfeed. Start on the ${next}; last time was ${last}.` : 'Breastfeed. Left and right timer.',
          open: (o) => ctx.sheets.feed({ origin: o, preset: withTime({ method: 'breast', ...(last ? { side: next } : {}) }) }),
        };
      }
      case 'pump': {
        const live = runningOf('pump');
        if (live) {
          const sec = Math.floor(Math.max(0, now - live.startTime) / 1000);
          return {
            key, cat: 'pump', icon: 'pump', label: 'Pump', live: true,
            ctx: html`<span class="dot"></span>Pumping <b class="num">${ctx.time.timerClock(sec)}</b>`,
            aria: `Pump, running ${F.spanSpoken(now - live.startTime)}. Open the pump timer.`,
            open: (o) => ctx.sheets.pump({ origin: o, resume: live }),
          };
        }
        const prog = pumpProgress(model ? model.pumps : [], ctx.settings.get('pumpGoalOz'), { unit, now });
        let c; let aria;
        if (prog.goal > 0) {
          c = html`<b>${String(prog.total)}</b> of ${String(prog.goal)} ${prog.unit} today`;
          aria = `Pump. ${prog.total} of ${prog.goal} ${prog.unit} today.`;
        } else if (prog.total > 0) {
          c = html`<b>${String(prog.total)} ${prog.unit}</b> today`;
          aria = `Pump. ${prog.total} ${prog.unit} today.`;
        } else {
          c = html`Timer or past pump`;
          aria = 'Pump. Timer or past pump.';
        }
        return { key, cat: 'pump', icon: 'pump', label: 'Pump', ctx: c, aria, open: (o) => ctx.sheets.pump({ origin: o, ...(chosen === null ? {} : { preset: { startTime: chosen } }) }) };
      }
      case 'sleep': {
        const live = runningOf('sleep');
        if (live) {
          const night = live.data && live.data.kind === 'night';
          const label = night ? 'Wake up' : 'End nap';
          return {
            key, cat: 'sleep', icon: 'sun', label, live: true,
            ctx: html`Asleep <b class="num">${F.span(now - live.startTime)}</b>`,
            aria: `${label}. Asleep ${F.spanSpoken(now - live.startTime)} since ${F.clock(live.startTime)}. Logs the wake-up${chosen === null ? '' : ` at ${F.clock(chosen)}`}.`,
            wake: live,
          };
        }
        const kind = classifyNapOrNight(at());
        const c = kind === 'night' ? 'Start night sleep' : 'Start a nap';
        return {
          key, cat: 'sleep', icon: 'moon', label: 'Sleep', ctx: html`${c}`, aria: `Sleep. ${c}.`,
          open: (o) => ctx.sheets.sleep({ origin: o, preset: withTime({ kind }) }),
        };
      }
      case 'memory':
        return {
          key, cat: 'mem', icon: 'spark', label: 'Memory', ctx: html`Photo or first`, aria: 'Memory. Photo or first.', row: true,
          open: (o) => ctx.sheets.memory({ origin: o, ...(chosen === null ? {} : { preset: { startTime: chosen } }) }),
        };
      case 'stash':
        return {
          key, cat: 'pump', icon: 'pouch', label: 'Stash milk', ctx: html`Fridge or freezer`, aria: 'Stash milk. Fridge or freezer.', row: true,
          open: (o) => ctx.sheets.stash({ origin: o, ...(chosen === null ? {} : { preset: { startTime: chosen } }) }),
        };
      default:
        return null;
    }
  }

  const tileInner = (m) => (m.row
    ? html`<span class="tile-ic">${I(m.icon, 20)}</span><span class="tile-text"><span class="tile-label">${m.label}</span><small class="tile-ctx">${m.ctx}</small></span>`
    : html`<span class="tile-ic">${I(m.icon, 20)}</span><span class="tile-label">${m.label}</span><small class="tile-ctx">${m.ctx}</small>`);
  const tileClass = (m) => `tile${m.row ? ' row-tile' : ''} cat-${m.cat}${m.live ? ' is-live' : ''}`;

  let staggerNow = true;
  const stag = () => (staggerNow ? html`data-stagger` : '');
  function tileTpl(m) {
    return html`<button type="button" class="${tileClass(m)}" data-key="${m.key}" aria-label="${m.aria}" ${stag()}>${tileInner(m)}</button>`;
  }

  // ------------------------------------------------------------ time chip
  function chipTpl() {
    const now = Date.now();
    if (chosen === null) {
      return html`<button type="button" class="time-chip" data-when aria-label="${`Time: now, ${F.clock(now)}. Change`}">${I('clock', 18)}Now <span class="num">${F.clockParts(now).time}</span>${I('chev-d', 18)}</button>`;
    }
    const ago = F.span(now - chosen);
    return html`<button type="button" class="time-chip is-set" data-when aria-label="${`Time: ${F.clock(chosen)}, ${ago} ago. Change`}">${I('clock', 18)}${ago} ago <span class="num">${F.clockParts(chosen).time}</span>${I('chev-d', 18)}</button>`;
  }
  let api = null;
  function paintChip() {
    if (!api || closed) return;
    if (!tilesStep) { render(api.header, null); return; }
    render(api.header, chipTpl());
  }

  // ------------------------------------------------------------ tiles step
  let staggered = false;   // only the first paint rises in (motion #3)
  function renderTiles(body) {
    tilesStep = body;
    const stagger = !staggered;
    staggered = true;
    const now = Date.now();
    const tiles = tileKeys.map((k) => tileModel(k, now));
    const rows = rowKeys.map((k) => tileModel(k, now));
    staggerNow = stagger;
    const showTip = t.bottle !== false && (Number(lsGet(LS_EXPRESS_USES)) || 0) < 2;
    render(body, html`
      ${tiles.length ? html`<div class="tiles">${tiles.map(tileTpl)}</div>` : ''}
      ${hasDiaper ? html`<div class="diaper-row cat-diaper" role="group" aria-label="Log a diaper in one tap" ${stag()}>
          <span class="lbl" aria-hidden="true"><b>Diaper</b><small>One tap</small></span>
          <button type="button" class="dbtn" data-diaper="wet" aria-label="Wet diaper">${I('wet', 18)}Wet</button>
          <button type="button" class="dbtn" data-diaper="dirty" aria-label="Dirty diaper">${I('dirty', 18)}Dirty</button>
          <button type="button" class="dbtn" data-diaper="both" aria-label="Wet and dirty diaper">${I('both', 18)}Both</button>
        </div>` : ''}
      ${rows.length ? html`<div class="tiles${hasDiaper ? '' : ' ql-rows'}">${rows.map(tileTpl)}</div>` : ''}
      ${showTip ? html`<p class="hint" ${stag()}>Tip: hold <b>+</b> to log a bottle in one move.</p>` : ''}
      ${nothing ? html`<div class="empty-state cat-neutral">
          <span class="empty-disc">${I('gear', 30)}</span>
          <h3 class="empty-title">Every tracker is hidden</h3>
          <p class="empty-text">Hidden trackers keep their data. Turn some back on in Settings.</p>
          <button type="button" class="btn btn-secondary" data-customize>Customize</button>
        </div>` : ''}`);
    paintChip();

    const onClick = (e) => {
      if (busy) return;
      const tileEl = e.target.closest('[data-key]');
      if (tileEl && body.contains(tileEl)) { onTile(tileEl); return; }
      const d = e.target.closest('[data-diaper]');
      if (d && body.contains(d)) { onDiaper(d); return; }
      if (e.target.closest('[data-customize]')) {
        api.close();
        ctx.router.push('settings', { page: 'customize' });
      }
    };
    body.addEventListener('click', onClick);
    return () => { body.removeEventListener('click', onClick); if (tilesStep === body) tilesStep = null; };
  }

  /** Patch every tile's content in place (keeps focus and the stagger). */
  function paintTiles() {
    if (!tilesStep || closed) return;
    const now = Date.now();
    for (const el of tilesStep.querySelectorAll('[data-key]')) {
      const m = tileModel(el.dataset.key, now);
      if (!m) continue;
      const cls = tileClass(m);
      const sig = `${cls}|${m.label}|${m.icon}|${String(m.ctx)}|${m.aria}`;
      if (el.__sig === sig) continue;
      el.__sig = sig;
      const keep = ['is-sheet-origin'].filter((c) => el.classList.contains(c));
      el.className = [cls, ...keep].join(' ');
      el.setAttribute('aria-label', m.aria);
      render(el, tileInner(m));
    }
  }

  function onTile(el) {
    const m = tileModel(el.dataset.key, Date.now());
    if (!m) return;
    if (m.wake) { wake(m.wake); return; }
    busy = true;
    api.close();
    // The tile is about to disappear, so the next sheet's origin is the +
    // (focus returns there when it closes, and its × twin sits on the +).
    m.open(ctx.fab || origin);
  }

  async function wake(event) {
    busy = true;
    const endTime = chosen === null ? undefined : Math.max(event.startTime, chosen);
    let ok = true;
    const stopping = ctx.events.stop(event.id, endTime === undefined ? {} : { endTime }).catch((err) => {
      ok = false;
      console.error('wake-up failed', err);
    });
    api.close();
    await Promise.all([stopping, api.closed]);
    if (!ok) { ctx.toast({ message: 'That didn’t save. Try again.', tone: 'warn' }); return; }
    ctx.toast({ message: 'Wake-up logged', action: { label: 'Undo', run: () => ctx.events.update(event.id, { endTime: null }) } });
  }

  async function onDiaper(btn) {
    busy = true;
    const kind = btn.dataset.diaper;
    const all = [...btn.parentElement.querySelectorAll('.dbtn')];
    btn.classList.add('is-done');
    for (const o of all) o.setAttribute('aria-disabled', 'true');
    let added = null;
    try {
      added = await ctx.events.add({ type: 'diaper', startTime: at(), data: { kind } });
    } catch (err) {
      console.error('diaper log failed', err);
      btn.classList.remove('is-done');
      for (const o of all) o.removeAttribute('aria-disabled');
      busy = false;
      ctx.toast({ message: 'That didn’t save. Try again.', tone: 'warn' });
      return;
    }
    // Let the tint flash register (--dur-press), then collapse into the +.
    await new Promise((r) => setTimeout(r, ctx.motionReduced() ? 0 : 160));
    api.close();
    await api.closed;
    ctx.toast({ message: DIAPER_TOAST[kind] || 'Diaper logged', action: { label: 'Undo', run: () => ctx.events.remove(added.id) } });
  }

  // ------------------------------------------------------------ time picker step
  function openPicker() {
    if (busy || !tilesStep) return;
    api.step(renderPicker, { direction: 'forward' });
    paintChip();
  }
  function backToTiles() {
    api.step(renderTiles, { direction: 'back' });
    paintChip();
  }
  function toTimeValue(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  /** "HH:MM" → today at that time; later than now means yesterday. */
  function fromTimeValue(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
    if (!m) return null;
    const now = Date.now();
    const d = new Date(now);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    let ts = d.getTime();
    if (ts > now + 60 * 1000) { d.setDate(d.getDate() - 1); ts = d.getTime(); }
    return Math.max(now - MAX_BACKDATE_MS, Math.min(now, ts));
  }
  function renderPicker(body) {
    const now = Date.now();
    const current = chosen === null ? 0 : Math.round((now - chosen) / 60000);
    const preset = WHEN_CHIPS.find((c) => (chosen === null ? c.min === 0 : c.min > 0 && Math.abs(c.min - current) <= 1));
    render(body, html`
      <p class="ql-when-q">When did it happen?</p>
      <div class="chip-row ql-when-chips" role="radiogroup" aria-label="When">
        ${WHEN_CHIPS.map((c) => html`<button type="button" class="chip" role="radio" data-min="${c.min}" aria-checked="${preset === c ? 'true' : 'false'}"><span class="chip-face">${c.label}</span></button>`)}
      </div>
      <label class="field ql-when-field">
        <span class="field-label">Or pick a time</span>
        <input class="field-input num" type="time" data-time value="${toTimeValue(chosen ?? now)}">
      </label>
      <p class="ql-when-note" data-note aria-live="polite"></p>
      <div class="ql-when-actions">
        <button type="button" class="btn btn-primary btn-block" data-use>Use this time</button>
      </div>`);
    const input = body.querySelector('[data-time]');
    const note = body.querySelector('[data-note]');
    const sync = () => {
      const ts = fromTimeValue(input.value);
      note.textContent = ts === null ? '' : `${F.dayLabel(ts)} at ${F.clock(ts)} · ${F.since(ts)}`;
    };
    sync();
    const onClick = (e) => {
      const chip = e.target.closest('[data-min]');
      if (chip) {
        const min = Number(chip.dataset.min);
        chosen = min === 0 ? null : Date.now() - min * 60000;
        backToTiles();
        return;
      }
      if (e.target.closest('[data-use]')) {
        const ts = fromTimeValue(input.value);
        chosen = ts === null || Date.now() - ts < 60 * 1000 ? null : ts;
        backToTiles();
      }
    };
    const onKey = (e) => {
      // Arrow keys move through the radio chips (DESIGN §11).
      const chip = e.target.closest('[role="radio"]');
      if (!chip || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const chips = [...body.querySelectorAll('[role="radio"]')];
      const i = chips.indexOf(chip) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
      chips[(i + chips.length) % chips.length].focus();
    };
    body.addEventListener('click', onClick);
    body.addEventListener('keydown', onKey);
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    return () => {
      body.removeEventListener('click', onClick);
      body.removeEventListener('keydown', onKey);
    };
  }

  // ------------------------------------------------------------ live updates
  function scheduleTick() {
    clearTimeout(ticker);
    if (closed) return;
    // Running tiles show a seconds clock; otherwise the chip's minute is enough.
    const anyLive = !!(model && model.running.length);
    const now = Date.now();
    ticker = setTimeout(() => {
      paintTiles();
      paintChip();
      scheduleTick();
    }, anyLive ? 1000 - (now % 1000) + 10 : 60000 - (now % 60000) + 20);
  }
  async function reload() {
    const m = await refreshCache(ctx);
    if (closed || !m || m.babyId !== babyId) return;
    model = m;
    paintTiles();
    scheduleTick();
  }

  api = ctx.openSheet({
    title: `Log for ${name}`,
    origin,
    className: 'sheet-quicklog',
    render: (body, a) => { api = a; return renderTiles(body); },
    onClose: () => {
      closed = true;
      clearTimeout(ticker);
      offEvents();
      offSettings();
    },
  });
  // The time chip lives in the header slot, outside the steps.
  const onHeader = (e) => { if (e.target.closest('[data-when]')) openPicker(); };
  api.header.addEventListener('click', onHeader);
  const offEvents = ctx.events.subscribe(() => reload());
  const offSettings = ctx.settings.subscribe((c) => {
    if (c && ['*', 'units', 'pumpGoalOz'].includes(c.key)) paintTiles();
  });
  reload();
  return api;
}

/**
 * Boot wiring (app.js): keep the tile model warm so the sheet can open
 * synchronously with live context.
 * @param {object} ctx
 */
export function setup(ctx) {
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; refreshCache(ctx); }, 50);
  };
  ctx.events.subscribe(later);
  ctx.settings.subscribe((c) => { if (c && ['*', 'activeBabyId', 'babies'].includes(c.key)) later(); });
  later();
}
