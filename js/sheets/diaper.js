// Diaper sheet (DESIGN §6.7 diaper row, §6.8, motion contract #1, #7, #8, #18;
// ARCHITECTURE §3 diaper data, §5.3 sheet contract).
//
//   ctx.sheets.diaper({ origin })                          // one-tap Wet / Dirty / Both / Dry
//   ctx.sheets.diaper({ origin, preset: { startTime } })   // back-dated (quick-log time chip)
//   ctx.sheets.diaper({ origin, preset: { kind, details: true } })  // straight to the details step
//   ctx.sheets.diaper({ origin, event })                   // add details to a logged diaper
//
//  - One tap logs at once: the tile flashes its tint, the sheet closes back
//    into whatever opened it, and a toast offers Undo (DESIGN §7.2 #18).
//  - The header time chip back-dates the change ("Now 9:50 ▾" → time picker).
//  - "Add color, texture or a note" steps forward to an optional details
//    form; color and texture only apply to dirty diapers.
//  - Synchronous first render (the sheet grows out of the + and is measured
//    in render()): today's counts come from a small cache that setup(ctx)
//    keeps warm from the events change bus.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SUCCESS_HOLD_MS = 400;      // DESIGN §7.2 #8
const FLASH_MS = 160;             // the tapped tile's tint registers (--dur-press + a frame)
const MAX_BACKDATE_MS = 7 * DAY;

const KINDS = Object.freeze(['wet', 'dirty', 'both', 'dry']);
const KIND_WORD = Object.freeze({ wet: 'Wet', dirty: 'Dirty', both: 'Both', dry: 'Dry' });
const KIND_SPOKEN = Object.freeze({ wet: 'Wet diaper', dirty: 'Dirty diaper', both: 'Wet and dirty diaper', dry: 'Dry diaper' });
const KIND_TOAST = Object.freeze({ wet: 'Wet diaper logged', dirty: 'Dirty diaper logged', both: 'Wet + dirty diaper logged', dry: 'Dry diaper logged' });
const KIND_ICON = Object.freeze({ wet: 'wet', dirty: 'dirty', both: 'both', dry: 'diaper' });
// Stored lowercase in data.color / data.consistency (format.eventSubtitle shows "Dirty · yellow").
const COLORS = Object.freeze(['yellow', 'green', 'brown', 'black']);
const TEXTURES = Object.freeze(['runny', 'seedy', 'soft', 'firm']);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const hasStool = (kind) => kind === 'dirty' || kind === 'both';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let uidSeq = 0;
const uid = () => `dp${(uidSeq += 1)}`;

// ================================================================ cache

const cache = { ready: false, dayStart: 0, today: [], last: new Map() };
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
    const dayStart = ctx.time.dayBounds(Date.now()).start;
    const today = await ctx.events.query({ type: 'diaper', from: dayStart });
    const last = new Map();
    for (const b of ctx.settings.get('babies') || []) last.set(b.id, await ctx.events.last('diaper', undefined, { babyId: b.id }));
    Object.assign(cache, { ready: true, dayStart, today, last });
  } catch (err) {
    console.warn('diaper sheet: refresh failed', err);
  }
}

/** Today's diapers for a baby (a cache from an earlier day is a superset: filter by today's start). */
function todayFor(ctx, babyId) {
  const start = ctx.time.dayBounds(Date.now()).start;
  return cache.today.filter((e) => e.startTime >= start && ctx.events.matchesBaby(e, babyId));
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

/** A single-choice toggle group that can also be cleared (optional details). */
function bindToggles(container, onChange) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[aria-pressed]');
    if (!btn || !container.contains(btn)) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    for (const b of container.querySelectorAll('[aria-pressed]')) b.setAttribute('aria-pressed', b === btn && on ? 'true' : 'false');
    onChange(on ? btn.dataset.value : '');
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
const timeValue = (ts) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * Time picker sheet behind the header time chip (DESIGN §6.6): one tap on
 * "Now / 5 / 15 / 30 min / 1 / 2 hours ago", or Today | Yesterday + a time.
 * Never a time in the future. Resolves { ts } (ts null = now) or undefined.
 */
function openWhen(ctx, { origin, value = null, title = 'When?', nowLabel = 'Now' }) {
  const { html, render } = ctx.html;
  return new Promise((resolve) => {
    let result;
    const base = value ?? Date.now();
    const yesterday = !ctx.time.isSameDay(base, Date.now());
    ctx.openSheet({
      title,
      origin,
      className: 'sheet-diaper sheet-nb-when',
      onClose: () => resolve(result),
      render(body, api) {
        const quick = [[0, nowLabel], [5, '5 min ago'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 hour ago'], [120, '2 hours ago']];
        const ago = value === null ? 0 : Math.round((Date.now() - value) / MINUTE);
        render(body, html`<div class="nb nb-when">
            <div class="chip-row nb-when-quick" role="group" aria-label="Quick times">
              ${quick.map(([m, l]) => html`<button type="button" class="chip" data-ago="${m}" aria-pressed="${(value === null ? m === 0 : m > 0 && Math.abs(m - ago) <= 1) ? 'true' : 'false'}"><span class="chip-face">${l}</span></button>`)}
            </div>
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
        body.querySelector('.nb-when-quick').addEventListener('click', (e) => {
          const b = e.target.closest('[data-ago]');
          if (!b) return;
          const m = Number(b.dataset.ago);
          result = { ts: m === 0 ? null : Date.now() - m * MINUTE };
          api.close(result);
        });
        body.querySelector('[data-when-done]').addEventListener('click', () => {
          const ts = pickTs();
          const fail = (msg) => { render(err, html`${ctx.icons.iconHtml('info', { size: 16 })}${msg}`); err.hidden = false; };
          if (ts === null) { fail('Pick a time.'); return; }
          if (ts > Date.now() + 30 * 1000) { fail('That time hasn’t happened yet.'); return; }
          if (Date.now() - ts > MAX_BACKDATE_MS) { fail('That’s more than a week ago.'); return; }
          result = { ts: Date.now() - ts < MINUTE ? null : ts };
          api.close(result);
        });
      },
    });
  });
}

// ================================================================ sheet

/**
 * Open the diaper sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {object} [opts]
 * @param {Element} [opts.origin] the tapped element (motion + focus return)
 * @param {{ startTime?: number, kind?: 'wet'|'dirty'|'both'|'dry', details?: boolean }} [opts.preset]
 *   startTime: back-date the change; details: open on the details step
 * @param {object} [opts.event] a logged diaper → edit its details (time, kind, color, texture, note)
 * @returns {object} sheet api
 */
/**
 * "Add details" from the one-tap toast: open the details step for the diaper
 * just logged, growing from its new row when one is on screen (else the +).
 * @param {object} ctx
 * @param {object} added the diaper event
 */
function openDetailsFor(ctx, added) {
  const row = [...document.querySelectorAll('[data-event-id]')]
    .find((el) => el.getAttribute('data-event-id') === added.id && el.matches('button, a') && el.getClientRects().length);
  return ctx.sheets.diaper({ origin: row || ctx.fab, event: added });
}

export function openDiaperSheet(ctx, { origin = null, preset = null, event = null } = {}) {
  const { html, render } = ctx.html;
  const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
  const F = ctx.format;
  const p = preset && typeof preset === 'object' ? preset : {};
  const editing = !!(event && event.type === 'diaper' && event.id);
  const babies = ctx.settings.get('babies') || [];
  const baby = (editing && event.babyId && babies.find((b) => b.id === event.babyId)) || ctx.activeBaby();
  const babyId = baby ? baby.id : null;
  const name = F.babyName(baby);
  const multi = babies.length > 1;
  const hidden = !editing && (ctx.settings.get('trackers') || {}).diaper === false;
  const title = multi ? `${name} · Diaper` : 'Diaper';

  const st = {
    when: null, // null = now; else epoch ms
    kind: KINDS.includes(p.kind) ? p.kind : 'wet',
    color: '',
    texture: '',
    note: '',
  };
  const presetTime = ctx.units.toFiniteNumber(p.startTime);
  if (presetTime !== null && Date.now() - presetTime > MINUTE && Date.now() - presetTime < MAX_BACKDATE_MS) st.when = presetTime;
  if (editing) {
    const d = event.data || {};
    st.when = event.startTime;
    st.kind = KINDS.includes(d.kind) ? d.kind : 'wet';
    st.color = typeof d.color === 'string' ? d.color : '';
    st.texture = typeof d.consistency === 'string' ? d.consistency : '';
    st.note = typeof event.note === 'string' ? event.note : '';
  }

  let api = null;
  let chipOn = !hidden;
  let chipTimer = 0;
  let closed = false;
  let paintCounts = null;   // the kinds view's in-place count refresh
  let offEvents = () => {};
  let offSettings = () => {};

  api = ctx.openSheet({
    title,
    origin,
    className: 'sheet-diaper',
    onClose() { closed = true; clearInterval(chipTimer); offEvents(); offSettings(); },
    render(body, a) {
      api = a;
      chipTimer = setInterval(() => { if (st.when === null) renderChip(); }, 20 * 1000);
      if (hidden) return hiddenView(body);
      return editing || p.details ? detailsView(body) : kindsView(body);
    },
  });
  // Counts refresh in place when a diaper is logged elsewhere (another tab).
  offEvents = ctx.events.subscribe((c) => {
    if (!c || c.op === 'bulk' || (c.event && c.event.type === 'diaper')) {
      setTimeout(() => { if (!closed) chain.then(() => paintCounts && paintCounts()); }, 40);
    }
  });
  offSettings = ctx.settings.subscribe((c) => {
    if (!c || closed || editing) return;
    if ((c.key === 'trackers' || c.key === '*') && (ctx.settings.get('trackers') || {}).diaper === false && api.isOpen()) api.close();
  });
  renderChip();
  return api;

  // ------------------------------------------------------------- header

  function renderChip() {
    if (!api || closed) return;
    if (!chipOn) { render(api.header, null); return; }
    const now = Date.now();
    const ts = st.when ?? now;
    const word = st.when === null ? 'Now' : ctx.time.isSameDay(ts, now) ? 'Today' : F.dayLabel(ts, now);
    const spoken = st.when === null ? `Time: now, ${F.clock(ts)}. Change` : `Time: ${word}, ${F.clock(ts)}. Change`;
    render(api.header, html`<button type="button" class="time-chip ${st.when === null ? '' : 'is-set'}" data-when aria-label="${spoken}">${I('clock', 18)}${word} <span class="num">${ctx.time.clock(ts)}</span>${I('chev-d', 18)}</button>`);
    const btn = api.header.querySelector('[data-when]');
    btn.addEventListener('click', async () => {
      const res = await openWhen(ctx, { origin: btn, value: st.when, title: editing ? 'Changed at' : 'When was the change?' });
      if (!res || closed) return;
      st.when = res.ts;
      renderChip();
      if (paintCounts) paintCounts();
    });
  }

  // ----------------------------------------------------- hidden tracker

  function hiddenView(body) {
    chipOn = false;
    render(body, html`<div class="empty-state cat-diaper">
        <span class="empty-disc">${I('diaper', 30)}</span>
        <h3 class="empty-title">Diapers are hidden</h3>
        <p class="empty-text">Turn diapers back on in Customize. Hidden trackers keep their data.</p>
        <button type="button" class="btn btn-primary" data-customize>Customize</button>
      </div>`);
    body.querySelector('[data-customize]').addEventListener('click', () => {
      api.close();
      try { ctx.router.push('settings', { page: 'customize' }); } catch (err) { console.warn('diaper sheet: settings not reachable', err); }
    });
    return null;
  }

  // ------------------------------------------------------ one-tap kinds

  function kindsView(body) {
    api.setTitle(title);
    const now = Date.now();
    const today = todayFor(ctx, babyId);
    const count = (k) => today.filter((e) => e.data && e.data.kind === k).length;
    const tileCtx = (k) => { const n = count(k); return n ? `${n} today` : 'Logs now'; };
    let busy = false;

    render(body, html`<div class="nb dp">
        <p class="dp-intro" data-intro>${introTpl(today, now)}</p>
        <div class="tiles dp-kinds" role="group" aria-label="${`Log a diaper for ${name} in one tap`}">
          ${KINDS.map((k) => html`<button type="button" class="tile cat-diaper dp-kind" data-kind="${k}" data-stagger aria-label="${`${KIND_SPOKEN[k]}. Logs now.`}">
              <span class="tile-ic">${I(KIND_ICON[k], k === 'dry' ? 20 : 18)}</span>
              <span class="tile-label">${KIND_WORD[k]}</span>
              <small class="tile-ctx" data-ctx="${k}">${tileCtx(k)}</small>
            </button>`)}
        </div>
        <button type="button" class="btn btn-ghost dp-more-btn" data-details>${I('edit', 20)}Add color, texture or a note</button>
      </div>`);

    paintCounts = () => {
      if (closed || !body.isConnected) return;
      const t = todayFor(ctx, babyId);
      const intro = body.querySelector('[data-intro]');
      if (intro) render(intro, introTpl(t, Date.now()));
      for (const k of KINDS) {
        const el = body.querySelector(`[data-ctx="${k}"]`);
        const n = t.filter((e) => e.data && e.data.kind === k).length;
        if (el) el.textContent = n ? `${n} today` : 'Logs now';
      }
    };

    body.querySelector('[data-details]').addEventListener('click', () => {
      if (busy) return;
      api.step((b) => detailsView(b), { direction: 'forward' });
    });

    const grid = body.querySelector('.dp-kinds');
    grid.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-kind]');
      if (!btn || busy) return;
      busy = true;
      const kind = btn.dataset.kind;
      const tiles = [...grid.querySelectorAll('[data-kind]')];
      btn.classList.add('is-done');
      for (const t of tiles) t.setAttribute('aria-disabled', 'true');
      const at = st.when ?? Date.now();
      let added = null;
      try {
        added = await ctx.events.add({ type: 'diaper', startTime: at, babyId, data: { kind } });
      } catch (err) {
        console.error('diaper sheet: not logged', err);
        btn.classList.remove('is-done');
        for (const t of tiles) t.removeAttribute('aria-disabled');
        busy = false;
        ctx.toast({ message: ctx.format.saveError(err), tone: 'warn' });
        return;
      }
      // The tint registers, then the sheet collapses back into its trigger (#18).
      await wait(ctx.motionReduced() ? 0 : FLASH_MS);
      api.close('logged');
      await api.closed;
      const bits = [KIND_TOAST[kind]];
      if (st.when !== null) bits.push(F.clock(at));
      ctx.toast({
        message: `${bits.join(' · ')}${multi ? ` for ${name}` : ''}`,
        action: { label: 'Undo', doneMessage: 'Removed', run: () => ctx.events.remove(added.id) },
        secondaryAction: { label: 'Add details', run: () => openDetailsFor(ctx, added) },
      });
    });
    return () => { paintCounts = null; };
  }

  function introTpl(today, now) {
    const last = cache.last.get(babyId);
    const n = today.length;
    if (!last) return html`Tap one to log it. Details are optional.`;
    return html`Last change <b class="num">${F.since(last.startTime, now).replace('Just now', 'just now')}</b>${n ? html` · <b class="num">${String(n)}</b> today` : ''}`;
  }

  // ------------------------------------------------------------ details

  function detailsView(body) {
    api.setTitle(editing ? (multi ? `${name} · Diaper details` : 'Diaper details') : title);
    const ids = { color: uid(), texture: uid(), note: uid() };
    let busy = false;
    const backable = !editing && !p.details;

    const toggles = (key, values, current, labelId) => html`<div class="chip-row dp-chips cat-diaper" role="group" aria-labelledby="${labelId}" data-toggles="${key}">
        ${values.map((v) => html`<button type="button" class="chip" data-value="${v}" aria-pressed="${v === current ? 'true' : 'false'}"><span class="chip-face">${cap(v)}</span></button>`)}
      </div>`;

    render(body, html`<div class="nb dp">
        ${backable ? html`<button type="button" class="btn btn-ghost nb-back" data-back>${I('chev-l', 20)}Back</button>` : ''}
        <div class="segmented cat-scoped cat-diaper nb-seg dp-seg" role="radiogroup" aria-label="Kind" data-seg="kind">
          ${KINDS.map((k) => html`<button type="button" role="radio" aria-checked="${k === st.kind ? 'true' : 'false'}" tabindex="${k === st.kind ? '0' : '-1'}" data-value="${k}" aria-label="${KIND_SPOKEN[k]}">${I(KIND_ICON[k], k === 'dry' ? 18 : 16)}${KIND_WORD[k]}</button>`)}
        </div>
        <div class="dp-more ${hasStool(st.kind) ? '' : 'is-collapsed'}" data-more>
          <div class="dp-more-inner">
            <p class="nb-label" id="${ids.color}">Color</p>
            ${toggles('color', COLORS, st.color, ids.color)}
            <p class="nb-label" id="${ids.texture}">Texture</p>
            ${toggles('texture', TEXTURES, st.texture, ids.texture)}
          </div>
        </div>
        <label class="field dp-note" for="${ids.note}"><span class="field-label">Note (optional)</span>
          <textarea class="field-input" id="${ids.note}" rows="2" maxlength="2000" data-note placeholder="Anything to remember"></textarea>
        </label>
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-save>${editing ? 'Save' : 'Log diaper'}</button>
        </div>
      </div>`);

    const more = body.querySelector('[data-more]');
    const note = body.querySelector('[data-note]');
    note.value = st.note;
    more.inert = !hasStool(st.kind);
    bindRadios(body.querySelector('[data-seg="kind"]'), '[role="radio"]', (b) => {
      st.kind = b.dataset.value;
      more.classList.toggle('is-collapsed', !hasStool(st.kind));
      more.inert = !hasStool(st.kind);
    });
    bindToggles(body.querySelector('[data-toggles="color"]'), (v) => { st.color = v; });
    bindToggles(body.querySelector('[data-toggles="texture"]'), (v) => { st.texture = v; });
    note.addEventListener('input', () => { st.note = note.value; });
    const back = body.querySelector('[data-back]');
    if (back) back.addEventListener('click', () => api.step((b) => kindsView(b), { direction: 'back' }));

    const saveBtn = body.querySelector('[data-save]');
    saveBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      saveBtn.style.setProperty('min-width', `${saveBtn.offsetWidth}px`);
      saveBtn.setAttribute('aria-busy', 'true');
      const stool = hasStool(st.kind);
      const data = { kind: st.kind, color: stool ? st.color : '', consistency: stool ? st.texture : '' };
      const noteText = String(st.note || '').trim();
      try {
        if (editing) {
          await ctx.events.update(event.id, { startTime: st.when ?? Date.now(), endTime: st.when ?? Date.now(), note: noteText, data });
        } else {
          const t = st.when ?? Date.now();
          const clean = { kind: data.kind };
          if (data.color) clean.color = data.color;
          if (data.consistency) clean.consistency = data.consistency;
          await ctx.events.add({ type: 'diaper', startTime: t, babyId, note: noteText, data: clean });
        }
        saveBtn.removeAttribute('aria-busy');
        saveBtn.classList.add('is-success');
        render(saveBtn, html`${I('check', 22)}${editing ? 'Saved' : 'Logged'}`);
        await wait(SUCCESS_HOLD_MS);
        if (api.isOpen()) api.close('logged');
      } catch (err) {
        console.warn('diaper sheet: not saved', err);
        busy = false;
        saveBtn.removeAttribute('aria-busy');
        const e = body.querySelector('[data-error]');
        render(e, html`${I('info', 16)}${ctx.format.saveError(err)}`);
        e.hidden = false;
      }
    });
    return null;
  }
}

/**
 * One-time wiring at boot (called by app.js): keep today's diaper counts
 * warm so the sheet opens synchronously with them.
 * @param {object} ctx
 */
export function setup(ctx) {
  cacheCtx = ctx;
  ctx.events.subscribe((c) => {
    if (!c || c.op === 'bulk' || (c.event && c.event.type === 'diaper') || (c.prev && c.prev.type === 'diaper')) scheduleRefresh();
  });
  ctx.settings.subscribe((c) => { if (c && (c.key === 'babies' || c.key === '*')) scheduleRefresh(); });
  scheduleRefresh();
}
