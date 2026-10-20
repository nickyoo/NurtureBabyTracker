// Sleep sheet (DESIGN §6.3 sleep card, §6.5 live pill, §6.7 sleep tile,
// motion contract #1, #6, #7, #8; AUDIT §6.3; ARCHITECTURE §3 sleep data).
//
//   ctx.sheets.sleep({ origin })                                 // Start a nap / night sleep
//   ctx.sheets.sleep({ origin, preset: { kind, startTime } })    // from Today / quick log
//   ctx.sheets.sleep({ origin, preset: { view: 'past' } })       // straight to "Log a past sleep"
//   ctx.sheets.sleep({ origin, resume: runningSleepEvent })      // the live sleep (pill / row)
//
//  - Nap vs night is classified by the clock (domain/sleep classifyNapOrNight)
//    and can be overridden with the segmented control, before or during.
//  - Start: a running sleep event (live pill "Nap · since 8:55 AM"). The
//    header time chip back-dates the start ("fell asleep 10 min ago").
//  - Live: timer, "End nap" / "Wake up" (in-sheet ✓ Logged), "Woke up
//    earlier…" (pick the wake time), Nap ↔ Night, discard with Undo. The
//    pill's own Finish logs the wake-up in one tap with an Undo toast.
//  - Log a past sleep: fell asleep / woke up (Today | Yesterday + time),
//    validated: in order, not in the future, under a day, and never
//    overlapping the sleep running now or another logged sleep.
//  - Wake-window hint when the birth date is known: "Usually awake 60–90m at
//    6 weeks" (domain/sleep wakeWindowForAge) — calm, a hint, never a rule.
//  - Synchronous first render (the sheet may grow out of the + and is
//    measured in render()): running/last sleeps come from a cache that
//    setup(ctx) keeps warm from the events change bus.

import { classifyNapOrNight, wakeWindowForAge, nextNapWindow } from '../domain/sleep.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SUCCESS_HOLD_MS = 400;      // DESIGN §7.2 #8
const MAX_BACKDATE_MS = 7 * DAY;
const KIND_WORD = Object.freeze({ nap: 'Nap', night: 'Night sleep' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isRunningError = (ctx, err) => !!err && ((ctx.RunningActivityError && err instanceof ctx.RunningActivityError) || err.name === 'RunningActivityError');
let uidSeq = 0;
const uid = () => `sl${(uidSeq += 1)}`;

// ================================================================ cache

const cache = { ready: false, running: [], last: new Map() };
let cacheCtx = null;
let cacheTimer = 0;
let chain = Promise.resolve();

function scheduleRefresh() {
  if (!cacheCtx) return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => { chain = chain.then(runRefresh); }, 16);
}

async function runRefresh() {
  const ctx = cacheCtx;
  try {
    const running = await ctx.events.running('sleep');
    const last = new Map();
    for (const b of ctx.settings.get('babies') || []) last.set(b.id, await ctx.events.last('sleep', undefined, { babyId: b.id }));
    Object.assign(cache, { ready: true, running, last });
  } catch (err) {
    console.warn('sleep sheet: refresh failed', err);
  }
}

function runningFor(babyId) {
  return cache.running.find((e) => (e.babyId ?? null) === (babyId ?? null)) || null;
}

// ============================================================== helpers

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
    if (!btn || btn.disabled || !container.contains(btn) || btn.getAttribute('aria-checked') === 'true') return;
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

/** Set a radio group's checked value without firing its handler. */
function setRadio(container, value) {
  for (const b of container.querySelectorAll('[role="radio"]')) {
    const on = b.dataset.value === String(value);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const timeValue = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** Local day offset of `ts` from today (0 today, -1 yesterday, …). */
function dayOffset(ctx, ts) {
  return ctx.time.daysBetween(Date.now(), ts);
}

/** Today + `offset` days at "HH:MM", or null. */
function fromDayTime(offset, hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, Number(m[1]), Number(m[2])).getTime();
}

/**
 * "60–90m", "2–3h", "75m–2h", "2.5–3.5h": a wake-window range, compact.
 * @param {number} min minutes
 * @param {number} max minutes
 * @returns {string}
 */
export function rangeLabel(min, max) {
  const asH = (m) => m >= 120 && m % 30 === 0;
  const h = (m) => String(Math.round((m / 60) * 10) / 10);
  if (asH(min) && asH(max)) return `${h(min)}–${h(max)}h`;
  if (!asH(min) && !asH(max)) return `${min}–${max}m`;
  return `${asH(min) ? `${h(min)}h` : `${min}m`}–${asH(max) ? `${h(max)}h` : `${max}m`}`;
}

/** "9:45–10:15 AM" (one AM/PM when both share it), else "11:40 AM–12:10 PM". */
function clockRange(F, a, b) {
  const x = F.clock(a);
  const y = F.clock(b);
  const mx = / (AM|PM)$/.exec(x);
  const my = / (AM|PM)$/.exec(y);
  return mx && my && mx[1] === my[1] ? `${x.slice(0, -3)}–${y}` : `${x}–${y}`;
}

/**
 * Why a past sleep can't be logged as entered, or '' when it can. Pure.
 * @param {{ start: number|null, end: number|null, now: number, running?: object|null, others?: object[], clock: (ts: number) => string, day: (ts: number) => string }} o
 * @returns {string}
 */
export function pastSleepProblem({ start, end, now, running = null, others = [], clock, day }) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Pick both times.';
  if (end > now + 30 * 1000) return 'That time hasn’t happened yet.';
  if (end <= start) return 'Waking up comes after falling asleep. Check the times or days.';
  if (end - start > DAY) return 'That’s more than a day. Check the days.';
  if (running && end > running.startTime) {
    return `That overlaps the ${running.data && running.data.kind === 'night' ? 'night sleep' : 'nap'} running now (since ${clock(running.startTime)}).`;
  }
  for (const s of others) {
    if (!s || s.endTime === null || (running && s.id === running.id)) continue;
    if (s.startTime < end && s.endTime > start) {
      const word = s.data && s.data.kind === 'night' ? 'night sleep' : 'nap';
      const d = day(s.startTime);
      const when = d === 'Today' ? '' : d === 'Yesterday' ? 'yesterday ' : `on ${d} `;
      return `That overlaps a ${word} logged ${when}${clock(s.startTime)} – ${clock(s.endTime)}.`;
    }
  }
  return '';
}

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
      className: 'sheet-sleep sheet-nb-when',
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
        const sync = () => {
          err.hidden = true;
          const ts = fromDayTime(day, input.value);
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
          const ts = fromDayTime(day, input.value);
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
 * Log the wake-up in one tap with Undo (pill Finish). The toast text is the
 * same everywhere a sleep ends in the background ("Wake-up logged").
 */
async function wakeWithUndo(ctx, event) {
  try {
    await ctx.events.stop(event.id);
  } catch (err) {
    console.error('sleep sheet: wake-up not logged', err);
    ctx.toast({ message: 'That didn’t save. Try again.', tone: 'warn' });
    return;
  }
  ctx.toast({ message: 'Wake-up logged', action: { label: 'Undo', run: () => ctx.events.update(event.id, { endTime: null }) } });
}

// ================================================================ sheet

/**
 * Open the sleep sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {object} [opts]
 * @param {Element} [opts.origin] the tapped element (motion + focus return)
 * @param {{ kind?: 'nap'|'night', startTime?: number, view?: 'past' }} [opts.preset]
 *   kind: preselect nap / night; startTime: back-date the start (quick-log chip)
 * @param {object} [opts.resume] a running sleep event → its live view
 * @returns {object} sheet api
 */
export function openSleepSheet(ctx, { origin = null, preset = null, resume = null } = {}) {
  const { html, render } = ctx.html;
  const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
  const F = ctx.format;
  const p = preset && typeof preset === 'object' ? preset : {};
  const babies = ctx.settings.get('babies') || [];
  const multi = babies.length > 1;
  const baby = (resume && resume.babyId && babies.find((b) => b.id === resume.babyId)) || ctx.activeBaby();
  const babyId = baby ? baby.id : null;
  const name = F.babyName(baby);
  const hidden = !resume && (ctx.settings.get('trackers') || {}).sleep === false;
  const titled = (t) => (multi ? `${name} · ${t}` : t);

  const st = {
    when: null,             // start time for "Start" (null = now)
    kind: null,             // picked by hand; null = follow the clock
  };
  const suggested = p.kind === 'night' || p.kind === 'nap' ? p.kind : null; // the caller's guess (Today / quick log)
  const presetTime = ctx.units.toFiniteNumber(p.startTime);
  if (presetTime !== null && Date.now() - presetTime > MINUTE && Date.now() - presetTime < MAX_BACKDATE_MS) st.when = presetTime;
  let whenTouched = false;  // a start time picked here replaces the caller's guess
  const autoKind = () => (!whenTouched && suggested) || classifyNapOrNight(st.when ?? Date.now());
  const kindNow = () => st.kind || autoKind();

  let first;
  if (hidden) first = { view: 'hidden' };
  else if (resume) first = { view: 'live', event: resume };
  else if (runningFor(babyId)) first = { view: 'live', event: runningFor(babyId) };
  else if (p.view === 'past') first = { view: 'past' };
  else first = { view: 'home' };

  let api = null;
  let whenHook = null;           // the home view's reaction to a new start time (kind follows the clock)
  let showingLive = first.view === 'live';
  let chip = { mode: 'none' };   // 'when' (start time for Start) | 'started' (edit a running sleep) | 'none'
  let chipTimer = 0;
  let closed = false;

  api = ctx.openSheet({
    title: first.view === 'live' ? titled(KIND_WORD[first.event.data && first.event.data.kind === 'night' ? 'night' : 'nap']) : first.view === 'past' ? titled('Past sleep') : titled('Sleep'),
    origin,
    className: 'sheet-sleep',
    onClose() { closed = true; clearInterval(chipTimer); offSettings(); },
    render(body, a) {
      api = a;
      chipTimer = setInterval(() => { if (chip.mode === 'when' && st.when === null) renderChip(); }, 20 * 1000);
      return show(first, body);
    },
  });
  const offSettings = ctx.settings.subscribe((c) => {
    if (!c || closed) return;
    if ((c.key === 'trackers' || c.key === '*') && !showingLive && (ctx.settings.get('trackers') || {}).sleep === false && api.isOpen()) api.close();
  });
  renderChip();
  return api;

  // ------------------------------------------------------------ routing

  function show(v, body) {
    switch (v.view) {
      case 'hidden': return hiddenView(body);
      case 'live': return liveView(body, v.event, v);
      case 'past': return pastView(body);
      default: return homeView(body);
    }
  }

  function go(v, direction = 'forward') {
    if (!api || !api.isOpen()) return null;
    showingLive = v.view === 'live';
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
      word = ctx.time.isSameDay(ts, now) ? 'Since' : F.dayLabel(ts, now);
      spoken = `Fell asleep at ${F.clock(ts)}. Change`;
    } else {
      ts = st.when ?? now;
      word = st.when === null ? 'Now' : ctx.time.isSameDay(ts, now) ? 'Today' : F.dayLabel(ts, now);
      spoken = st.when === null ? `Fell asleep: now, ${F.clock(ts)}. Change` : `Fell asleep: ${word}, ${F.clock(ts)}. Change`;
    }
    render(api.header, html`<button type="button" class="time-chip ${chip.mode === 'when' && st.when === null ? '' : 'is-set'}" data-when aria-label="${spoken}">${I('clock', 18)}${word} <span class="num">${ctx.time.clock(ts)}</span>${I('chev-d', 18)}</button>`);
    const btn = api.header.querySelector('[data-when]');
    btn.addEventListener('click', async () => {
      const last = cache.last.get(babyId);
      const lastEnd = last && Number.isFinite(last.endTime) ? last.endTime : null;
      if (chip.mode === 'started') {
        const ev = chip.event;
        const res = await openWhen(ctx, {
          origin: btn, value: ev.startTime, title: `When did ${name} fall asleep?`, nowLabel: 'Just now',
          min: lastEnd, minMsg: lastEnd ? `That’s before the last sleep ended (${F.clock(lastEnd)}).` : '',
        });
        if (!res || closed) return;
        try {
          const next = await ctx.events.update(ev.id, { startTime: res.ts ?? Date.now() });
          if (chip.event && chip.event.id === next.id) chip = { mode: 'started', event: next };
        } catch (err) { console.warn('sleep sheet: start time not changed', err); }
        renderChip();
        return;
      }
      const res = await openWhen(ctx, {
        origin: btn, value: st.when, title: `When did ${name} fall asleep?`,
        min: lastEnd, minMsg: lastEnd ? `That’s before the last sleep ended (${F.clock(lastEnd)}).` : '',
      });
      if (!res || closed) return;
      st.when = res.ts;
      whenTouched = true;
      renderChip();
      if (whenHook) whenHook();
    });
  }

  // ----------------------------------------------------- shared bits

  function kindSeg(current, label = 'Kind of sleep') {
    return html`<div class="segmented cat-scoped cat-sleep nb-seg" role="radiogroup" aria-label="${label}" data-seg="kind">
        <button type="button" role="radio" aria-checked="${current === 'nap' ? 'true' : 'false'}" tabindex="${current === 'nap' ? '0' : '-1'}" data-value="nap">${I('sun', 18)}Nap</button>
        <button type="button" role="radio" aria-checked="${current === 'night' ? 'true' : 'false'}" tabindex="${current === 'night' ? '0' : '-1'}" data-value="night">${I('moon', 18)}Night sleep</button>
      </div>`;
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

  async function succeed(btn, word = 'Logged') {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.classList.add('is-success');
    render(btn, html`${I('check', 22)}${word}`);
    await wait(SUCCESS_HOLD_MS);
    if (api.isOpen()) api.close('logged');
  }

  /** "Awake 1h 05m · since 8:45 AM" + the wake-window hint, or null. */
  function awakeModel(now) {
    const last = cache.last.get(babyId);
    const woke = last && Number.isFinite(last.endTime) && last.endTime <= now ? last.endTime : null;
    const birth = baby && baby.birthDate;
    const w = wakeWindowForAge(birth, now);
    const age = birth ? F.babyAge(birth, now) : '';
    let hint = null;
    if (w && age) {
      // "6 weeks", not "6 weeks, 3 days": the bands are weeks wide.
      hint = `Usually awake ${rangeLabel(w.min, w.max)} at ${age === 'Born today' ? 'birth' : age.split(',')[0]}.`;
      const win = nextNapWindow(woke, birth, now);
      // A next-nap window only makes sense by day (nights are one long sleep).
      if (win && now < win.to && classifyNapOrNight(win.from) === 'nap') hint += ` Next nap around ${clockRange(F, win.from, win.to)}.`;
    }
    return { woke, hint, needsBirth: !birth };
  }

  // ----------------------------------------------------- hidden tracker

  function hiddenView(body) {
    setChip({ mode: 'none' });
    render(body, html`<div class="empty-state cat-sleep">
        <span class="empty-disc">${I('moon', 30)}</span>
        <h3 class="empty-title">Sleep is hidden</h3>
        <p class="empty-text">Turn sleep back on in Customize. Hidden trackers keep their data.</p>
        <button type="button" class="btn btn-primary" data-customize>Customize</button>
      </div>`);
    body.querySelector('[data-customize]').addEventListener('click', () => {
      api.close();
      try { ctx.router.push('settings', { page: 'customize' }); } catch (err) { console.warn('sleep sheet: settings not reachable', err); }
    });
    return null;
  }

  // =========================================================== home

  function homeView(body) {
    api.setTitle(titled('Sleep'));
    setChip({ mode: 'when' });
    const now = Date.now();
    const aw = awakeModel(now);
    let busy = false;
    const startLabel = (k) => (k === 'night' ? 'Start night sleep' : 'Start nap');

    render(body, html`<div class="nb sl">
        ${kindSeg(kindNow())}
        ${aw.woke !== null ? html`<div class="sl-awake cat-sleep" data-awake>
            <span class="chip-ic">${I('sun', 22)}</span>
            <span class="sl-awake-text"><b>Awake <span class="num" data-awake-span>${F.span(now - aw.woke)}</span></b><small>since ${F.clock(aw.woke)}</small></span>
          </div>` : ''}
        ${aw.hint ? html`<p class="note sl-hint">${I('clock', 16)}<span data-hint>${aw.hint}</span></p>` : ''}
        ${aw.needsBirth ? html`<button type="button" class="btn btn-ghost sl-birth" data-birth>Add ${F.possessive(name)} birth date for wake-window hints</button>` : ''}
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-start>${I('moon', 22)}<span data-start-label>${startLabel(kindNow())}</span></button>
          <button type="button" class="btn btn-secondary btn-block" data-past>${I('edit', 22)}Log a past sleep</button>
          <button type="button" class="btn btn-ghost sl-notnow" data-close>Not now</button>
        </div>
      </div>`);

    const seg = body.querySelector('[data-seg="kind"]');
    const startBtn = body.querySelector('[data-start]');
    const labelEl = body.querySelector('[data-start-label]');
    bindRadios(seg, '[role="radio"]', (b) => {
      st.kind = b.dataset.value;
      labelEl.textContent = startLabel(st.kind);
    });
    whenHook = () => {
      if (!body.isConnected) return;
      if (!st.kind) setRadio(seg, autoKind());
      labelEl.textContent = startLabel(kindNow());
      showError(body, '');
    };
    body.querySelector('[data-close]').addEventListener('click', () => api.close());
    body.querySelector('[data-past]').addEventListener('click', () => { if (!busy) go({ view: 'past' }); });
    const birth = body.querySelector('[data-birth]');
    if (birth) {
      birth.addEventListener('click', () => {
        api.close();
        try { ctx.router.push('settings', { page: 'baby' }); } catch (err) { console.warn('sleep sheet: settings not reachable', err); }
      });
    }

    // Awake time ticks with the minute.
    const tick = setInterval(() => {
      const el = body.querySelector('[data-awake-span]');
      const m = awakeModel(Date.now());
      if (el && m.woke !== null) el.textContent = F.span(Date.now() - m.woke);
      const h = body.querySelector('[data-hint]');
      if (h && m.hint) h.textContent = m.hint;
    }, 30 * 1000);

    startBtn.addEventListener('click', async () => {
      if (busy) return;
      const startTime = st.when ?? Date.now();
      const last = cache.last.get(babyId);
      if (last && Number.isFinite(last.endTime) && startTime < last.endTime) {
        showError(body, `That’s before the last sleep ended (${F.clock(last.endTime)}). Change the time above.`);
        return;
      }
      busy = true;
      setBusy(startBtn, true);
      lock(body, true);
      try {
        const ev = await ctx.events.start('sleep', { kind: kindNow() }, { startTime, babyId });
        go({ view: 'live', event: ev });
      } catch (err) {
        busy = false;
        setBusy(startBtn, false);
        lock(body, false);
        if (isRunningError(ctx, err) && err.running) { go({ view: 'live', event: err.running }); return; }
        console.warn('sleep sheet: sleep not started', err);
        showError(body);
      }
    });
    return () => { clearInterval(tick); whenHook = null; };
  }

  // =========================================================== live

  function liveView(body, event) {
    let ev = event;
    let done = false;  // this sheet ended it (don't react to our own change)
    let busy = false;
    const kindOf = () => (ev.data && ev.data.kind === 'night' ? 'night' : 'nap');
    const finishLabel = () => (kindOf() === 'night' ? 'Wake up' : 'End nap');
    api.setTitle(titled(KIND_WORD[kindOf()]));
    setChip({ mode: 'started', event: ev });

    render(body, html`<div class="nb sl sl-live">
        <div class="nb-hero cat-sleep">
          <span class="nb-timer num" data-timer aria-hidden="true">00:00</span>
          <span class="nb-hero-sub"><span class="dot" aria-hidden="true"></span><span data-since></span></span>
        </div>
        ${kindSeg(kindOf(), 'Nap or night sleep')}
        <button type="button" class="btn btn-ghost nb-mistake" data-discard data-lockable>Started by mistake? Discard</button>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-finish>${I('sun', 22)}<span data-finish-label>${finishLabel()}</span></button>
          <button type="button" class="btn btn-secondary btn-block" data-earlier>${I('clock', 22)}Woke up earlier…</button>
        </div>
      </div>`);

    const timerEl = body.querySelector('[data-timer]');
    const sinceEl = body.querySelector('[data-since]');
    const seg = body.querySelector('[data-seg="kind"]');
    const finishBtn = body.querySelector('[data-finish]');

    function paint() {
      const now = Date.now();
      timerEl.textContent = ctx.time.timerClock((now - ev.startTime) / 1000);
      render(sinceEl, html`Asleep since <b>${F.clock(ev.startTime)}</b>${ctx.time.isSameDay(ev.startTime, now) ? '' : html` ${F.dayLabel(ev.startTime, now).toLowerCase()}`}`);
    }
    let timer = 0;
    const loop = () => {
      paint();
      const ms = 1000 - ((Date.now() - ev.startTime) % 1000);
      timer = setTimeout(loop, Math.max(30, ms + 5));
    };
    loop();

    bindRadios(seg, '[role="radio"]', async (b) => {
      const kind = b.dataset.value;
      try {
        ev = await ctx.events.update(ev.id, { data: { kind } });
        api.setTitle(titled(KIND_WORD[kindOf()]));
        body.querySelector('[data-finish-label]').textContent = finishLabel();
      } catch (err) {
        console.warn('sleep sheet: kind not changed', err);
        setRadio(seg, kindOf());
        showError(body, 'That didn’t change. Try again.');
      }
    });

    async function end(btn, endTime) {
      if (busy) return;
      busy = true;
      done = true;
      setBusy(btn, true);
      lock(body, true);
      try {
        await ctx.events.stop(ev.id, endTime === undefined ? {} : { endTime });
        await succeed(btn);
      } catch (err) {
        busy = false;
        done = false;
        setBusy(btn, false);
        lock(body, false);
        console.warn('sleep sheet: wake-up not logged', err);
        showError(body);
      }
    }

    finishBtn.addEventListener('click', () => end(finishBtn));
    body.querySelector('[data-earlier]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (busy) return;
      const res = await openWhen(ctx, {
        origin: btn, value: null, title: `When did ${name} wake up?`, nowLabel: 'Just now',
        min: ev.startTime, minMsg: `That’s before ${name} fell asleep (${F.clock(ev.startTime)}).`,
      });
      if (!res || closed) return;
      end(btn, res.ts ?? Date.now());
    });
    body.querySelector('[data-discard]').addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      done = true;
      api.close('discarded');
      try {
        const removed = await ctx.events.remove(ev.id);
        if (removed) ctx.toast({ message: `${KIND_WORD[kindOf()]} discarded`, action: { label: 'Undo', run: () => ctx.events.restore(removed) } });
      } catch (err) { console.warn('sleep sheet: not discarded', err); }
    });

    const offEvents = ctx.events.subscribe((change) => {
      if (!change) return;
      if (change.op === 'bulk') {
        ctx.events.get(ev.id).then((e) => { if (!done && (!e || e.endTime !== null)) api.close(); else if (e) { ev = e; paint(); } }).catch(() => {});
        return;
      }
      const e = change.event;
      if (!e || e.id !== ev.id) return;
      if (change.op === 'remove' || e.endTime !== null) { if (!done && api.isOpen()) api.close(); return; }
      ev = e;
      setRadio(seg, kindOf());
      if (chip.mode === 'started') { chip = { mode: 'started', event: e }; renderChip(); }
      paint();
    });
    // A stale pill tap (it already ended elsewhere) closes quietly.
    ctx.events.get(ev.id).then((e) => { if (!done && api.isOpen() && (!e || e.endTime !== null)) api.close(); }).catch(() => {});

    return () => { clearTimeout(timer); offEvents(); };
  }

  // =========================================================== past

  function pastView(body) {
    api.setTitle(titled('Past sleep'));
    setChip({ mode: 'none' });
    const ids = { start: uid(), end: uid(), sum: uid() };
    const now = Date.now();
    // Defaults: woke up now (to the 5 minutes), asleep an hour before — but
    // never reaching back into the last logged sleep.
    const FIVE = 5 * MINUTE;
    let end = Math.floor(now / FIVE) * FIVE;
    let start = end - HOUR;
    const last = cache.last.get(babyId);
    if (last && Number.isFinite(last.endTime) && last.endTime > start && last.endTime < end - 10 * MINUTE) start = Math.ceil(last.endTime / FIVE) * FIVE;
    let kind = st.kind;              // picked by hand in this sheet; null = follow the start time
    let recent = [];                 // this baby's sleeps of the last few days (overlap check)
    let busy = false;
    const dayOpts = [{ v: 0, l: 'Today' }, { v: -1, l: 'Yesterday' }];
    const dayTpl = (key, ts, label) => {
      const off = Math.max(-1, Math.min(0, dayOffset(ctx, ts)));
      return html`<div class="segmented nb-seg sl-day" role="radiogroup" aria-label="${label}" data-seg="${key}">
          ${dayOpts.map((o) => html`<button type="button" role="radio" aria-checked="${o.v === off ? 'true' : 'false'}" tabindex="${o.v === off ? '0' : '-1'}" data-value="${o.v}">${o.l}</button>`)}
        </div>`;
    };

    render(body, html`<div class="nb sl">
        <button type="button" class="btn btn-ghost nb-back" data-back>${I('chev-l', 20)}Back</button>
        <div class="sl-when" role="group" aria-labelledby="${ids.start}">
          <p class="nb-label" id="${ids.start}">${I('moon', 18)}Fell asleep</p>
          <div class="sl-when-row">
            ${dayTpl('startDay', start, 'Fell asleep: day')}
            <label class="field sl-field"><span class="field-label">Time</span>
              <input class="field-input num" type="time" step="60" data-start value="${timeValue(start)}" aria-describedby="${ids.sum}">
            </label>
          </div>
        </div>
        <div class="sl-when" role="group" aria-labelledby="${ids.end}">
          <p class="nb-label" id="${ids.end}">${I('sun', 18)}Woke up</p>
          <div class="sl-when-row">
            ${dayTpl('endDay', end, 'Woke up: day')}
            <label class="field sl-field"><span class="field-label">Time</span>
              <input class="field-input num" type="time" step="60" data-end value="${timeValue(end)}" aria-describedby="${ids.sum}">
            </label>
          </div>
        </div>
        ${kindSeg(kind || classifyNapOrNight(start))}
        <p class="sl-sum" id="${ids.sum}" data-sum aria-live="polite"></p>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-log>Log sleep</button>
        </div>
      </div>`);

    const startIn = body.querySelector('[data-start]');
    const endIn = body.querySelector('[data-end]');
    const startSeg = body.querySelector('[data-seg="startDay"]');
    const endSeg = body.querySelector('[data-seg="endDay"]');
    const kindSegEl = body.querySelector('[data-seg="kind"]');
    const sumEl = body.querySelector('[data-sum]');
    const logBtn = body.querySelector('[data-log]');
    let startDay = Math.max(-1, Math.min(0, dayOffset(ctx, start)));
    let endDay = Math.max(-1, Math.min(0, dayOffset(ctx, end)));

    function read() {
      start = fromDayTime(startDay, startIn.value);
      end = fromDayTime(endDay, endIn.value);
    }

    function validate() {
      read();
      const k = kind || (Number.isFinite(start) ? classifyNapOrNight(start) : 'nap');
      if (!kind) setRadio(kindSegEl, k);
      const problem = pastSleepProblem({
        start, end, now: Date.now(), running: runningFor(babyId), others: recent,
        clock: (t) => F.clock(t), day: (t) => F.dayLabel(t),
      });
      if (problem) {
        sumEl.textContent = '';
        showError(body, problem);
      } else {
        showError(body, '');
        render(sumEl, html`${KIND_WORD[k]} · slept <b class="num">${F.span(end - start)}</b>`);
      }
      logBtn.disabled = !!problem;
      return problem ? null : { start, end, kind: k };
    }

    const onInput = () => validate();
    startIn.addEventListener('input', onInput);
    startIn.addEventListener('change', onInput);
    endIn.addEventListener('input', onInput);
    endIn.addEventListener('change', onInput);
    bindRadios(startSeg, '[role="radio"]', (b) => { startDay = Number(b.dataset.value); onInput(); });
    bindRadios(endSeg, '[role="radio"]', (b) => { endDay = Number(b.dataset.value); onInput(); });
    bindRadios(kindSegEl, '[role="radio"]', (b) => { kind = b.dataset.value; validate(); });
    body.querySelector('[data-back]').addEventListener('click', () => go({ view: 'home' }, 'back'));

    // Earlier sleeps for the overlap check (a night that began 2 days ago still counts).
    ctx.events.query({ type: 'sleep', babyId, from: Date.now() - 4 * DAY, running: false })
      .then((list) => { recent = list.filter((e) => (e.babyId ?? null) === (babyId ?? null)); if (body.isConnected) validate(); })
      .catch((err) => console.warn('sleep sheet: recent sleeps not loaded', err));
    validate();

    logBtn.addEventListener('click', async () => {
      if (busy) return;
      const ok = validate();
      if (!ok) return;
      busy = true;
      setBusy(logBtn, true);
      lock(body, true);
      try {
        // Re-check against the store (another tab may have logged meanwhile).
        const fresh = await ctx.events.query({ type: 'sleep', babyId, from: ok.start - 2 * DAY });
        const mine = fresh.filter((e) => (e.babyId ?? null) === (babyId ?? null));
        const problem = pastSleepProblem({
          start: ok.start, end: ok.end, now: Date.now(), running: mine.find((e) => e.endTime === null) || null, others: mine,
          clock: (t) => F.clock(t), day: (t) => F.dayLabel(t),
        });
        if (problem) throw Object.assign(new Error(problem), { userMessage: problem });
        await ctx.events.add({ type: 'sleep', startTime: ok.start, endTime: ok.end, babyId, data: { kind: ok.kind } });
        await succeed(logBtn);
      } catch (err) {
        busy = false;
        setBusy(logBtn, false);
        lock(body, false);
        if (!err.userMessage) console.warn('sleep sheet: past sleep not logged', err);
        showError(body, err.userMessage || undefined);
      }
    });
    return null;
  }
}

/**
 * One-time wiring at boot (called by app.js): the running/last-sleep cache
 * and the live-pill handlers.
 * @param {object} ctx
 */
export function setup(ctx) {
  cacheCtx = ctx;
  ctx.events.subscribe((c) => {
    if (!c || c.op === 'bulk' || (c.event && c.event.type === 'sleep') || (c.prev && c.prev.type === 'sleep')) scheduleRefresh();
  });
  ctx.settings.subscribe((c) => { if (c && (c.key === 'babies' || c.key === '*')) scheduleRefresh(); });
  scheduleRefresh();

  ctx.livePill.register('sleep', {
    open: (event, origin) => openSleepSheet(ctx, { origin, resume: event }),
    // Waking needs no extra input: Finish logs it at once, with Undo.
    finish: (event) => wakeWithUndo(ctx, event),
  });
}
