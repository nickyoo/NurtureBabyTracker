// Entry sheet: view / edit / delete any logged event (DESIGN §6.4 "one
// pattern everywhere: tap a row → its detail sheet", §6.6, motion #1, #7,
// #8, #9; ARCHITECTURE §4, §5.3; AUDIT §2 "Edit vs row tap").
//
//   ctx.sheets.event({ origin: rowEl, id, event })     // the row's event (sync render)
//   ctx.sheets.event({ origin, id })                    // fetched first (loading line)
//   ctx.sheets.event({ origin, id, event, mode: 'edit' }) // straight to the edit form
//
// Works for EVERY type — bottle / breastfeed, pump, sleep (nap / night),
// diaper, milestone — finished or still running:
//  - View: a hero (category chip, the headline value, when it happened), a
//    short facts list, the note; Edit (primary) and Delete (soft
//    destructive). A running entry also offers its live sheet ("Back to the
//    timer") and keeps its "so far" value ticking.
//  - Edit (steps forward): type-appropriate fields — start (and end, for
//    things that last) as date + time, amount with its unit (the family's
//    display unit; untouched amounts keep their exact stored value), milk,
//    breast sides in minutes, nap / night, diaper kind + color + texture,
//    milestone title, note, and "who" when there are two babies.
//    Validation is calm and inline: the end can't be before the start and
//    nothing can be later than a minute from now. Save shows "Saved" in the
//    button (#8), then the sheet closes and the row moves where it belongs.
//  - Delete: events.remove → the sheet closes → the row collapses → an Undo
//    toast (events.restore). Reversible, so no confirm (§10 "Deleted · Undo").
//
// Never imports another sheet or view: the live sheets are reached through
// ctx.sheets.<name>.

import { breastSideTotals } from '../domain/safety.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const FUTURE_SLACK_MS = MINUTE;       // "no future beyond now + 1 min"
const SUCCESS_HOLD_MS = 400;          // DESIGN §7.2 #8
const TICK_MS = 15 * 1000;            // running "so far" values
const MAX_SIDE_MIN = 240;
const AMOUNT_MAX = Object.freeze({ oz: 64, mL: 2000 });

const MILK_WORD = Object.freeze({ formula: 'Formula', breastmilk: 'Breast milk' });
const KIND_WORD = Object.freeze({ nap: 'Nap', night: 'Night sleep' });
const DIAPER_KINDS = Object.freeze(['wet', 'dirty', 'both', 'dry']);
const DIAPER_WORD = Object.freeze({ wet: 'Wet', dirty: 'Dirty', both: 'Both', dry: 'Dry' });
const DIAPER_LONG = Object.freeze({ wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty', dry: 'Dry' });
const DIAPER_GLYPH = Object.freeze({ wet: 'wet', dirty: 'dirty', both: 'both', dry: 'diaper' });
// Same words the diaper sheet stores (data.color / data.consistency, lowercase).
const COLORS = Object.freeze(['yellow', 'green', 'brown', 'black']);
const TEXTURES = Object.freeze(['runny', 'seedy', 'soft', 'firm']);
const STORED_WORD = Object.freeze({ fridge: 'Fridge', freezer: 'Freezer', deepFreezer: 'Deep freezer' });
const DELETE_WORD = Object.freeze({ bottle: 'Bottle', breast: 'Breastfeed', pump: 'Pump', diaper: 'Diaper', milestone: 'Memory' });
const EDIT_TITLE = Object.freeze({ bottle: 'Edit bottle', breast: 'Edit breastfeed', pump: 'Edit pump', nap: 'Edit nap', night: 'Edit night sleep', diaper: 'Edit diaper', milestone: 'Edit memory' });
const UNIT_SPOKEN = Object.freeze({ oz: ['ounce', 'ounces'], mL: ['milliliter', 'milliliters'] });

let uidSeq = 0;
const uid = () => `ev${(uidSeq += 1)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const hasStool = (kind) => kind === 'dirty' || kind === 'both';

// ================================================================ pure

/** Which shape of event this is (drives the fields). */
function kindOf(e) {
  if (!e) return 'unknown';
  if (e.type === 'feed') return e.data && e.data.method === 'breast' ? 'breast' : 'bottle';
  return e.type;
}

/**
 * Does this event last (start + end) rather than happen at an instant?
 * Bottles last when they were timed; a quick-logged bottle is an instant.
 * @param {object} e
 * @returns {boolean}
 */
function hasDuration(e) {
  const k = kindOf(e);
  if (k === 'sleep' || k === 'pump' || k === 'breast') return true;
  if (k === 'bottle') return e.endTime === null || (Number.isFinite(e.endTime) && e.endTime - e.startTime >= MINUTE);
  return false;
}

/** 'YYYY-MM-DD' for a local date input. */
function dateValue(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'HH:MM' for a local time input. */
function timeValue(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Local date + time inputs → epoch ms, or NaN.
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} time 'HH:MM' (seconds ignored)
 * @returns {number}
 */
function fromInputs(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  if (!dm || !tm) return NaN;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  if (d.getFullYear() !== Number(dm[1]) || d.getMonth() !== Number(dm[2]) - 1 || d.getDate() !== Number(dm[3])) return NaN;
  return d.getTime();
}

/**
 * A typed amount → number (blank → null), accepting "4,5".
 * @param {string} s
 * @returns {number|null|undefined} undefined when it isn't a number
 */
function parseAmount(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d{0,5}(\.\d{0,2})?$/.test(t) || t === '.') return undefined;
  return Number(t);
}

/**
 * The edit form's problem in calm words, or '' when it can be saved. Pure.
 * @param {{ start: number, end: number|null, running: boolean, now: number, amount?: number|null|undefined, amountMax?: number, left?: number, right?: number, title?: string, needsTitle?: boolean }} v
 * @returns {string}
 */
function editProblem(v) {
  const latest = v.now + FUTURE_SLACK_MS;
  if (!Number.isFinite(v.start)) return 'Pick a day and a time for the start.';
  if (v.start > latest) return 'That start is still to come. Pick a time up to now.';
  if (!v.running && v.end !== null && v.end !== undefined) {
    if (!Number.isFinite(v.end)) return 'Pick a day and a time for the end.';
    if (v.end < v.start) return 'The end can’t be before the start.';
    if (v.end > latest) return 'That end is still to come. Pick a time up to now.';
    if (v.end - v.start > 48 * HOUR) return 'That’s longer than two days. Check the dates.';
  }
  if (v.amount === undefined && 'amount' in v) return 'Type the amount as a number, like 4 or 4.5.';
  if (Number.isFinite(v.amount) && (v.amount < 0 || v.amount > v.amountMax)) return `Pick an amount up to ${v.amountMax}.`;
  for (const side of ['left', 'right']) {
    if (side in v && (!Number.isFinite(v[side]) || v[side] < 0 || v[side] > MAX_SIDE_MIN)) return `Minutes per side go from 0 to ${MAX_SIDE_MIN}.`;
  }
  if (v.needsTitle && !String(v.title || '').trim()) return 'Give this memory a name.';
  return '';
}

// ================================================================ sheet

/**
 * Open the entry sheet for one event.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {object} [opts]
 * @param {Element|null} [opts.origin] the tapped row (gets the pressed state; focus returns to it)
 * @param {string} [opts.id] the event id
 * @param {object} [opts.event] the event itself (renders synchronously); fetched when absent
 * @param {object} [opts.preset] accepted for the contract; an event object here counts as opts.event
 * @param {'view'|'edit'} [opts.mode] open straight on the edit form
 * @returns {object} sheet api; api.closed resolves 'saved' | 'deleted' | undefined
 */
export function openEventSheet(ctx, { origin = null, id = null, event = null, preset = null, mode = 'view' } = {}) {
  const { html, render } = ctx.html;
  const F = ctx.format;
  const I = (name, size) => ctx.icons.iconHtml(name, { size });

  let ev = event && event.id ? event : (preset && preset.id && preset.type ? preset : null);
  const eventId = (ev && ev.id) || id || null;
  let api = null;
  let view = 'view';           // 'view' | 'edit' | 'gone'
  let busy = false;
  let closingFor = null;       // 'deleted' | 'saved' while we close it ourselves
  let tick = 0;

  const unit = () => (ctx.settings.get('units') === 'mL' ? 'mL' : 'oz');
  const babies = () => ctx.settings.babies() || [];
  const multi = () => babies().length > 1;
  const babyOf = (e) => babies().find((b) => b.id === e.babyId) || null;
  const titleOf = (e) => (e ? F.eventTitle(e) : 'Entry');
  const spokenAmt = (value, u) => `${value} ${UNIT_SPOKEN[u][Number(value) === 1 ? 0 : 1]}`;

  // ------------------------------------------------------------ view

  /** When it happened: "Today · 7:40 – 7:58 AM", "Since 8:55 AM". */
  function whenLine(e, now) {
    const day = F.dayLabel(e.startTime, now);
    if (e.endTime === null) return `${day} · since ${F.clock(e.startTime)}`;
    if (!hasDuration(e) || e.endTime === e.startTime) return `${day} · ${F.clock(e.startTime)}`;
    const endDay = F.dayLabel(e.endTime, now);
    return endDay === day
      ? `${day} · ${F.clock(e.startTime)} – ${F.clock(e.endTime)}`
      : `${day} ${F.clock(e.startTime)} – ${endDay} ${F.clock(e.endTime)}`;
  }

  /** The hero's big value: an amount, a duration or a word. */
  function heroValue(e, now) {
    const k = kindOf(e);
    const running = e.endTime === null;
    const took = (running ? now : e.endTime) - e.startTime;
    if (k === 'bottle' || k === 'pump') {
      const a = F.eventAmount(e, unit());
      if (a && !a.missing) return { tpl: html`${a.value}<small>${a.unit}</small>`, spoken: spokenAmt(a.value, a.unit) };
      if (running) return spanValue(took);
      return { tpl: html`<span class="ev-words">No amount yet</span>`, spoken: 'no amount recorded' };
    }
    if (k === 'breast') {
      const t = breastSideTotals(e.data || {}, running ? now : e.endTime);
      return spanValue(t.total * 1000 || took);
    }
    if (k === 'sleep') return spanValue(took);
    if (k === 'diaper') {
      const kind = (e.data && e.data.kind) || 'wet';
      return { tpl: html`<span class="ev-words">${DIAPER_LONG[kind] || 'Diaper'}</span>`, spoken: DIAPER_LONG[kind] || 'Diaper' };
    }
    return null;
  }

  function spanValue(ms) {
    const parts = F.spanParts(ms);
    if (!parts.length) return { tpl: html`<span class="ev-words">Just now</span>`, spoken: 'just now' };
    return { tpl: parts.map((p) => html`${p.v}<small>${p.u}</small>`), spoken: F.spanSpoken(ms) };
  }

  /** [label, value] facts for the view step. */
  function facts(e, now) {
    const k = kindOf(e);
    const d = e.data || {};
    const running = e.endTime === null;
    const out = [];
    if (multi() && e.type !== 'pump') out.push(['For', F.babyName(babyOf(e))]);
    const started = (label) => out.push([label, `${F.dayLabel(e.startTime, now)}, ${F.clock(e.startTime)}`]);
    const ended = (label) => { if (!running) out.push([label, `${F.dayLabel(e.endTime, now)}, ${F.clock(e.endTime)}`]); };
    switch (k) {
      case 'bottle':
        out.push(['Milk', MILK_WORD[d.milk] || 'Breast milk']);
        if (running) {
          const a = F.eventAmount(e, unit());
          if (a && !a.missing) out.push(['Made', `${a.value} ${a.unit}`]);
          started('Started');
        } else if (hasDuration(e)) {
          started('Started');
          ended('Finished');
          out.push(['Took', F.durationLabel(e.endTime - e.startTime)]);
        } else {
          started('At');
        }
        if (d.sourceInventoryId) out.push(['From', 'Your stash']);
        break;
      case 'breast': {
        const t = breastSideTotals(d, running ? now : e.endTime);
        out.push(['Left', t.left ? F.durationLabel(t.left * 1000) : '—']);
        out.push(['Right', t.right ? F.durationLabel(t.right * 1000) : '—']);
        if (running) out.push(['Now on', d.activeSide ? `${cap(d.activeSide)} side` : 'Paused']);
        started('Started');
        ended('Finished');
        break;
      }
      case 'pump':
        started('Started');
        ended('Finished');
        if (!running) out.push(['Took', F.durationLabel(e.endTime - e.startTime)]);
        if (!running) out.push(['Stored', STORED_WORD[d.storedTo] || 'Not stored']);
        break;
      case 'sleep':
        out.push(['Kind', KIND_WORD[d.kind] || 'Nap']);
        started('Fell asleep');
        if (running) out.push(['Woke up', 'Still asleep']);
        else ended('Woke up');
        break;
      case 'diaper':
        started('At');
        if (d.color) out.push(['Color', cap(d.color)]);
        if (d.consistency) out.push(['Texture', cap(d.consistency)]);
        break;
      case 'milestone':
        started('On');
        if (Array.isArray(d.photoIds) && d.photoIds.length) out.push(['Photos', F.plural(d.photoIds.length, 'photo')]);
        break;
      default:
        started('At');
    }
    return out;
  }

  function hintFor(e) {
    const d = e.data || {};
    if (e.type === 'pump' && d.inventoryId) return 'This milk is in your stash. Changing or deleting this entry leaves the pouch as it is.';
    if (kindOf(e) === 'bottle' && d.sourceInventoryId) return 'This bottle came from your stash. Deleting it doesn’t put the milk back.';
    return '';
  }

  /** The live sheet for a running entry, if there is one. */
  function liveSheet(e) {
    if (!e || e.endTime !== null) return null;
    const k = kindOf(e);
    if (k === 'sleep') return { label: e.data && e.data.kind === 'night' ? 'Back to night sleep' : 'Back to the nap', open: (o) => ctx.sheets.sleep({ origin: o, resume: e }) };
    if (k === 'pump') return { label: 'Back to the pump timer', open: (o) => ctx.sheets.pump({ origin: o, resume: e }) };
    if (k === 'bottle' || k === 'breast') return { label: k === 'breast' ? 'Back to the breastfeed' : 'Back to the bottle', open: (o) => ctx.sheets.feed({ origin: o, resume: e }) };
    return null;
  }

  function viewTpl(e, now) {
    const cat = F.categoryOf(e);
    const running = e.endTime === null;
    const hero = heroValue(e, now);
    const k = kindOf(e);
    const iconName = k === 'diaper' ? DIAPER_GLYPH[(e.data && e.data.kind) || 'wet'] : ctx.icons.categoryIcon(e);
    const live = liveSheet(e);
    const hint = hintFor(e);
    const list = facts(e, now);
    const note = String(e.note || '').trim();
    const amt = F.eventAmount(e, unit());
    const missingAmount = (k === 'bottle' || k === 'pump') && !running && (!amt || amt.missing);
    return html`<div class="ev ev-view cat-${cat}">
        <div class="ev-hero">
          <span class="chip-ic${running ? ' ring-live' : ''}">${I(iconName, 22)}</span>
          <div class="ev-hero-text">
            ${hero ? html`<p class="ev-big"><span aria-hidden="true" data-big>${hero.tpl}</span><span class="sr-only" data-big-sr>${hero.spoken}</span></p>` : ''}
            <p class="ev-when" data-when>${whenLine(e, now)}</p>
          </div>
          ${running ? html`<span class="badge ev-now"><span class="dot"></span>${k === 'sleep' ? 'Asleep' : 'Now'}</span>` : ''}
        </div>
        ${list.length ? html`<dl class="ev-facts" data-facts>${list.map(([dt, dd]) => html`<div class="ev-fact"><dt>${dt}</dt><dd>${dd}</dd></div>`)}</dl>` : ''}
        ${note ? html`<div class="ev-note"><p class="ev-note-lbl">Note</p><p class="ev-note-txt">${note}</p></div>` : ''}
        ${missingAmount ? html`<p class="note ev-hint">${I('info', 16)}<span>The amount wasn’t recorded. Tap Edit to add it.</span></p>` : ''}
        ${hint ? html`<p class="note ev-hint">${I('pouch', 16)}<span>${hint}</span></p>` : ''}
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer ev-footer">
          ${live ? html`<button type="button" class="btn btn-primary btn-block" data-live>${I(ctx.icons.categoryIcon(e), 22)}${live.label}</button>` : ''}
          <div class="ev-btns">
            <button type="button" class="btn btn-danger-soft" data-delete>${I('trash', 22)}Delete</button>
            <button type="button" class="btn ${live ? 'btn-secondary' : 'btn-primary'}" data-edit>${I('edit', 22)}Edit</button>
          </div>
        </div>
      </div>`;
  }

  function showError(body, msg) {
    const el = body.querySelector('[data-error]');
    if (!el) return;
    if (!msg) { el.hidden = true; render(el, null); return; }
    render(el, html`${I('info', 16)}<span>${msg}</span>`);
    el.hidden = false;
  }

  function paintView(body) {
    view = 'view';
    api.setTitle(titleOf(ev));
    render(body, viewTpl(ev, Date.now()));
    body.querySelector('[data-edit]').addEventListener('click', () => {
      if (busy || !ev) return;
      api.step((b) => paintEdit(b), { direction: 'forward' });
    });
    body.querySelector('[data-delete]').addEventListener('click', (e) => remove(body, e.currentTarget));
    const liveBtn = body.querySelector('[data-live]');
    if (liveBtn) {
      liveBtn.addEventListener('click', async () => {
        if (busy) return;
        const live = liveSheet(ev);
        if (!live) return;
        busy = true;
        closingFor = 'live';
        api.close('live');
        await api.closed;
        live.open(origin && origin.isConnected ? origin : ctx.fab);
      });
    }
    scheduleTick(body);
    return null;
  }

  function scheduleTick(body) {
    clearInterval(tick);
    if (!ev || ev.endTime !== null) return;
    tick = setInterval(() => {
      if (view !== 'view' || !api.isOpen() || !body.isConnected || !ev) { clearInterval(tick); return; }
      const now = Date.now();
      const hero = heroValue(ev, now);
      const big = body.querySelector('[data-big]');
      const bigSr = body.querySelector('[data-big-sr]');
      if (big && hero) { render(big, hero.tpl); if (bigSr) bigSr.textContent = hero.spoken; }
      const facts = body.querySelector('[data-facts]');
      if (facts) render(facts, facts_(ev, now));
    }, TICK_MS);
  }
  const facts_ = (e, now) => facts(e, now).map(([dt, dd]) => html`<div class="ev-fact"><dt>${dt}</dt><dd>${dd}</dd></div>`);

  async function remove(body, btn) {
    if (busy || !ev) return;
    busy = true;
    const k = kindOf(ev);
    const title = k === 'sleep' ? (KIND_WORD[ev.data && ev.data.kind] || 'Sleep') : (DELETE_WORD[k] || titleOf(ev));
    btn.setAttribute('aria-busy', 'true');
    let removed = null;
    closingFor = 'deleted'; // our own remove must not repaint "This entry is gone"
    try {
      removed = await ctx.events.remove(ev.id);
    } catch (err) {
      console.error('entry sheet: delete failed', err);
      closingFor = null;
      btn.removeAttribute('aria-busy');
      busy = false;
      showError(body, 'That didn’t delete. Try again.');
      return;
    }
    if (api.isOpen()) api.close('deleted');
    await api.closed;
    if (removed) {
      ctx.toast({
        message: `${title} deleted`,
        action: { label: 'Undo', run: () => ctx.events.restore(removed) },
      });
    }
  }

  // ------------------------------------------------------------ edit

  function paintEdit(body) {
    view = 'edit';
    clearInterval(tick);
    const e = ev;
    const k = kindOf(e);
    const d = e.data || {};
    const running = e.endTime === null;
    const showEnd = !running && hasDuration(e);
    const u = unit();
    const now = Date.now();
    const ids = { start: uid(), end: uid(), amt: uid(), note: uid(), err: uid(), who: uid(), color: uid(), texture: uid(), title: uid() };
    const today = dateValue(now);
    api.setTitle(EDIT_TITLE[k === 'sleep' ? (d.kind === 'night' ? 'night' : 'nap') : k] || 'Edit entry');

    // The amount, in the display unit (untouched → the stored value is kept as is).
    const amtCfg = ctx.units.inputConfig(u);
    const amtMax = AMOUNT_MAX[u];
    const storedAmt = F.eventAmount(e, u);
    const initialAmt = storedAmt && !storedAmt.missing ? storedAmt.value : '';
    const breast = k === 'breast' ? breastSideTotals(d, running ? now : e.endTime) : null;
    const initLeft = breast ? Math.round(breast.left / 60) : 0;
    const initRight = breast ? Math.round(breast.right / 60) : 0;

    const st = {
      milk: d.milk === 'formula' ? 'formula' : 'breastmilk',
      sleepKind: d.kind === 'night' ? 'night' : 'nap',
      diaperKind: DIAPER_KINDS.includes(d.kind) ? d.kind : 'wet',
      color: typeof d.color === 'string' ? d.color : '',
      texture: typeof d.consistency === 'string' ? d.consistency : '',
      babyId: e.babyId ?? null,
    };

    const radios = (key, label, options, current, extra = '') => {
      const any = options.some((o) => o.v === current);
      return html`<div class="segmented cat-scoped ev-seg ${extra}" role="radiogroup" aria-label="${label}" data-seg="${key}">
        ${options.map((o, i) => html`<button type="button" role="radio" aria-checked="${o.v === current ? 'true' : 'false'}" tabindex="${o.v === current || (!any && i === 0) ? '0' : '-1'}" data-value="${o.v}" aria-label="${o.aria || o.l}">${o.icon ? I(o.icon, 16) : ''}${o.l}</button>`)}
      </div>`;
    };
    const chips = (key, values, current, labelId) => html`<div class="chip-row ev-chips" role="group" aria-labelledby="${labelId}" data-chips="${key}">
        ${values.map((v) => html`<button type="button" class="chip" data-value="${v}" aria-pressed="${v === current ? 'true' : 'false'}"><span class="chip-face">${cap(v)}</span></button>`)}
      </div>`;
    const whenTpl = (key, label, ts, labelId) => html`<div class="ev-when-grp" role="group" aria-labelledby="${labelId}">
        <p class="ev-lbl" id="${labelId}">${label}</p>
        <div class="ev-when-row">
          <label class="field"><span class="field-label">Day</span>
            <input class="field-input num" type="date" data-field="${`${key}-date`}" max="${today}" value="${dateValue(ts)}" aria-describedby="${ids.err}"></label>
          <label class="field"><span class="field-label">Time</span>
            <input class="field-input num" type="time" step="60" data-field="${`${key}-time`}" value="${timeValue(ts)}" aria-describedby="${ids.err}"></label>
        </div>
      </div>`;

    const typeFields = [];
    if (multi() && e.type !== 'pump') {
      typeFields.push(html`<div class="ev-block"><p class="ev-lbl" id="${ids.who}">Who</p>
        ${radios('who', 'Who', babies().map((b) => ({ v: b.id, l: F.babyName(b) })), st.babyId, 'cat-neutral')}</div>`);
    }
    if (k === 'bottle') {
      typeFields.push(radios('milk', 'Milk', [{ v: 'formula', l: 'Formula' }, { v: 'breastmilk', l: 'Breast milk' }], st.milk));
    }
    if (k === 'bottle' || k === 'pump') {
      typeFields.push(html`<div class="ev-block">
        <p class="ev-lbl" id="${ids.amt}">${k === 'pump' ? 'How much' : running ? 'Bottle made' : 'How much'}</p>
        <div class="stepper ev-stepper">
          <button type="button" class="stepper-btn" data-dec aria-label="${`Less, ${amtCfg.step} ${u}`}">${I('minus', 24)}</button>
          <label class="ev-value">
            <input class="ev-value-input num" data-amount type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
              role="spinbutton" aria-labelledby="${ids.amt}" aria-valuemin="0" aria-valuemax="${amtMax}" placeholder="—" value="${initialAmt}">
            <small class="ev-value-unit" aria-hidden="true">${u}</small>
          </label>
          <button type="button" class="stepper-btn" data-inc aria-label="${`More, ${amtCfg.step} ${u}`}">${I('plus', 24)}</button>
        </div>
      </div>`);
    }
    if (k === 'breast') {
      typeFields.push(html`<div class="ev-block"><p class="ev-lbl">Minutes on each side</p>
        <div class="ev-when-row">
          <label class="field"><span class="field-label">Left</span>
            <input class="field-input num" type="number" inputmode="numeric" min="0" max="${MAX_SIDE_MIN}" step="1" data-left value="${initLeft}" ${running ? 'readonly' : ''} aria-describedby="${ids.err}"></label>
          <label class="field"><span class="field-label">Right</span>
            <input class="field-input num" type="number" inputmode="numeric" min="0" max="${MAX_SIDE_MIN}" step="1" data-right value="${initRight}" ${running ? 'readonly' : ''} aria-describedby="${ids.err}"></label>
        </div>
        ${running ? html`<p class="field-help">The sides keep counting while the feed runs. Change them after it’s finished.</p>` : ''}
      </div>`);
    }
    if (k === 'sleep') {
      typeFields.push(radios('sleep', 'Kind of sleep', [{ v: 'nap', l: 'Nap' }, { v: 'night', l: 'Night sleep' }], st.sleepKind));
    }
    if (k === 'diaper') {
      typeFields.push(radios('diaper', 'Kind', DIAPER_KINDS.map((x) => ({ v: x, l: DIAPER_WORD[x], icon: DIAPER_GLYPH[x], aria: DIAPER_LONG[x] })), st.diaperKind));
      typeFields.push(html`<div class="ev-more ${hasStool(st.diaperKind) ? '' : 'is-collapsed'}" data-more>
        <p class="ev-lbl" id="${ids.color}">Color</p>
        ${chips('color', COLORS, st.color, ids.color)}
        <p class="ev-lbl" id="${ids.texture}">Texture</p>
        ${chips('texture', TEXTURES, st.texture, ids.texture)}
      </div>`);
    }
    if (k === 'milestone') {
      typeFields.push(html`<label class="field"><span class="field-label">Name</span>
        <input class="field-input" type="text" maxlength="200" data-title value="${d.title || ''}" autocomplete="off" aria-describedby="${ids.err}"></label>`);
    }

    render(body, html`<div class="ev ev-edit cat-${F.categoryOf(e)}">
        <button type="button" class="btn btn-ghost ev-back" data-back>${I('chev-l', 20)}Back</button>
        ${typeFields}
        ${whenTpl('start', k === 'sleep' ? 'Fell asleep' : showEnd || running ? 'Started' : 'When', e.startTime, ids.start)}
        ${showEnd ? whenTpl('end', k === 'sleep' ? 'Woke up' : 'Finished', e.endTime, ids.end) : ''}
        ${running ? html`<p class="note ev-hint">${I('clock', 16)}<span>${k === 'sleep' ? 'Still asleep. Log the wake-up from its sheet.' : 'Still going. Finish it from its timer.'}</span></p>` : ''}
        <label class="field"><span class="field-label">Note</span>
          <textarea class="field-input" rows="2" maxlength="2000" data-note placeholder="Anything to remember"></textarea></label>
        <p class="field-error" id="${ids.err}" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-save>Save</button>
        </div>
      </div>`);

    const q = (sel) => body.querySelector(sel);
    const noteEl = q('[data-note]');
    noteEl.value = e.note || '';
    const amtEl = q('[data-amount]');
    const saveBtn = q('[data-save]');
    const moreEl = q('[data-more]');
    if (moreEl) moreEl.inert = !hasStool(st.diaperKind);

    // Untouched inputs keep the stored value exactly (seconds, unit).
    const init = {
      startDate: dateValue(e.startTime), startTime: timeValue(e.startTime),
      endDate: showEnd ? dateValue(e.endTime) : '', endTime: showEnd ? timeValue(e.endTime) : '',
      amount: initialAmt,
    };

    function read() {
      const now2 = Date.now();
      const sd = q('[data-field="start-date"]').value;
      const stime = q('[data-field="start-time"]').value;
      const start = sd === init.startDate && stime === init.startTime ? e.startTime : fromInputs(sd, stime);
      let end = null;
      if (showEnd) {
        const ed = q('[data-field="end-date"]').value;
        const et = q('[data-field="end-time"]').value;
        end = ed === init.endDate && et === init.endTime ? e.endTime : fromInputs(ed, et);
      } else if (!running) {
        end = Number.isFinite(start) ? start + Math.max(0, e.endTime - e.startTime) : NaN;
      }
      const out = { start, end, running, now: now2 };
      if (amtEl) {
        out.amount = amtEl.value.trim() === String(init.amount) ? (storedAmt && !storedAmt.missing ? Number(storedAmt.value) : null) : parseAmount(amtEl.value);
        out.amountMax = amtMax;
        out.amountTouched = amtEl.value.trim() !== String(init.amount);
      }
      if (k === 'breast' && !running) {
        out.left = Number(q('[data-left]').value || 0);
        out.right = Number(q('[data-right]').value || 0);
        out.sidesTouched = out.left !== initLeft || out.right !== initRight;
      }
      if (k === 'milestone') { out.title = q('[data-title]').value; out.needsTitle = true; }
      return out;
    }

    function validate({ quiet = false } = {}) {
      const v = read();
      const problem = editProblem(v);
      if (!quiet || problem) showError(body, problem);
      saveBtn.disabled = !!problem;
      if (amtEl) {
        amtEl.style.setProperty('--chars', String(Math.max(1, Math.min(6, amtEl.value.length || 1))));
        const n = Number.isFinite(v.amount) ? v.amount : 0;
        amtEl.setAttribute('aria-valuenow', String(n));
        amtEl.setAttribute('aria-valuetext', Number.isFinite(v.amount) ? spokenAmt(v.amount, u) : 'not recorded');
        q('[data-dec]').disabled = !(n > 0);
        q('[data-inc]').disabled = !(n < amtMax);
      }
      return problem ? null : v;
    }
    const onInput = () => validate();
    for (const inp of body.querySelectorAll('input')) {
      inp.addEventListener('input', onInput);
      inp.addEventListener('change', onInput);
    }

    if (amtEl) {
      const bump = (dir) => {
        const v = parseAmount(amtEl.value);
        const base = Number.isFinite(v) ? v : 0;
        const next = Math.min(amtMax, Math.max(0, ctx.units.clampAmount(base + dir * amtCfg.step, 0, amtMax, amtCfg.fineStep)));
        amtEl.value = String(next);
        onInput();
      };
      q('[data-dec]').addEventListener('click', () => bump(-1));
      q('[data-inc]').addEventListener('click', () => bump(1));
      amtEl.addEventListener('keydown', (evt) => {
        if (evt.key === 'ArrowUp') { evt.preventDefault(); bump(1); }
        if (evt.key === 'ArrowDown') { evt.preventDefault(); bump(-1); }
      });
      amtEl.addEventListener('focus', () => amtEl.select());
    }
    bindRadios(q('[data-seg="milk"]'), (b) => { st.milk = b.dataset.value; });
    bindRadios(q('[data-seg="sleep"]'), (b) => { st.sleepKind = b.dataset.value; });
    bindRadios(q('[data-seg="who"]'), (b) => { st.babyId = b.dataset.value; });
    bindRadios(q('[data-seg="diaper"]'), (b) => {
      st.diaperKind = b.dataset.value;
      if (moreEl) {
        moreEl.classList.toggle('is-collapsed', !hasStool(st.diaperKind));
        moreEl.inert = !hasStool(st.diaperKind);
      }
    });
    bindChips(q('[data-chips="color"]'), (v) => { st.color = v; });
    bindChips(q('[data-chips="texture"]'), (v) => { st.texture = v; });
    q('[data-back]').addEventListener('click', () => {
      if (busy) return;
      api.step((b) => paintView(b), { direction: 'back' });
    });

    saveBtn.addEventListener('click', async () => {
      if (busy) return;
      const v = validate();
      if (!v) return;
      busy = true;
      saveBtn.style.setProperty('min-width', `${saveBtn.offsetWidth}px`);
      saveBtn.setAttribute('aria-busy', 'true');
      const patch = { startTime: v.start, note: noteEl.value.trim() };
      if (!running) patch.endTime = v.end;
      if (multi() && e.type !== 'pump' && st.babyId && st.babyId !== e.babyId) patch.babyId = st.babyId;
      const data = {};
      if (k === 'bottle') data.milk = st.milk;
      if ((k === 'bottle' || k === 'pump') && v.amountTouched) { data.amount = v.amount; data.unit = u; }
      if (k === 'breast' && !running && v.sidesTouched) {
        data.left = Math.round(v.left * 60);
        data.right = Math.round(v.right * 60);
      }
      if (k === 'sleep') data.kind = st.sleepKind;
      if (k === 'diaper') {
        const stool = hasStool(st.diaperKind);
        data.kind = st.diaperKind;
        data.color = stool ? st.color : '';
        data.consistency = stool ? st.texture : '';
      }
      if (k === 'milestone') data.title = v.title.trim();
      if (Object.keys(data).length) patch.data = data;
      try {
        ev = await ctx.events.update(e.id, patch);
      } catch (err) {
        busy = false;
        saveBtn.removeAttribute('aria-busy');
        saveBtn.style.removeProperty('min-width');
        const isRunning = err && (err.name === 'RunningActivityError' || (ctx.RunningActivityError && err instanceof ctx.RunningActivityError));
        if (isRunning) showError(body, `${F.babyName(babies().find((b) => b.id === st.babyId))} already has one running. Finish that first.`);
        else { console.warn('entry sheet: not saved', err); showError(body, 'That didn’t save. Check the times and try again.'); }
        return;
      }
      saveBtn.removeAttribute('aria-busy');
      saveBtn.classList.add('is-success');
      render(saveBtn, html`${I('check', 22)}Saved`);
      closingFor = 'saved';
      await wait(SUCCESS_HOLD_MS);
      if (api.isOpen()) api.close('saved');
    });

    validate({ quiet: true });
    return null;
  }

  // ------------------------------------------------------------ open

  function loadingTpl() {
    return html`<div class="ev ev-view cat-neutral"><p class="sheet-text ev-loading">Opening…</p></div>`;
  }
  function goneTpl() {
    return html`<div class="empty-state cat-neutral ev-gone">
        <span class="empty-disc">${I('info', 30)}</span>
        <h3 class="empty-title">This entry is gone</h3>
        <p class="empty-text">It was deleted, maybe on another tab. Nothing else changed.</p>
        <button type="button" class="btn btn-secondary" data-close>Close</button>
      </div>`;
  }
  function paintGone(body) {
    view = 'gone';
    clearInterval(tick);
    api.setTitle('Entry');
    render(body, goneTpl());
    body.querySelector('[data-close]').addEventListener('click', () => api.close());
  }

  api = ctx.openSheet({
    title: ev ? titleOf(ev) : 'Entry',
    origin,
    className: 'sheet-event',
    render(body, sheetApi) {
      api = sheetApi;
      if (ev) {
        if (mode === 'edit') paintEdit(body); else paintView(body);
      } else {
        render(body, loadingTpl());
      }
      const off = ctx.events.subscribe((change) => {
        if (!change || !api.isOpen() || closingFor) return;
        if (change.op === 'bulk') {
          if (!eventId) return;
          ctx.events.get(eventId).then((fresh) => {
            if (!api.isOpen() || closingFor) return;
            if (!fresh) { paintGone(api.body); return; }
            ev = fresh;
            if (view === 'view') paintView(api.body);
          }).catch(() => {});
          return;
        }
        const ce = change.event;
        if (!ce || ce.id !== eventId) return;
        if (change.op === 'remove') { paintGone(api.body); return; }
        ev = ce;
        if (view === 'view') paintView(api.body);
      });
      const offSettings = ctx.settings.subscribe((c) => {
        const key = c && c.key;
        if (view === 'view' && ev && api.isOpen() && ['units', 'babies', '*'].includes(key)) paintView(api.body);
      });
      return () => { clearInterval(tick); off(); offSettings(); };
    },
  });

  if (!ev && eventId) {
    ctx.events.get(eventId).then((fresh) => {
      if (!api.isOpen()) return;
      if (!fresh) { paintGone(api.body); return; }
      ev = fresh;
      if (mode === 'edit') { paintEdit(api.body); } else paintView(api.body);
    }).catch((err) => {
      console.error('entry sheet: load failed', err);
      if (api.isOpen()) paintGone(api.body);
    });
  } else if (!ev) {
    paintGone(api.body);
  }
  return api;
}

// ================================================================ controls

/** Roving radio buttons (segmented control): click, arrows, Home/End. */
function bindRadios(container, onPick) {
  if (!container) return;
  const items = () => [...container.querySelectorAll('[role="radio"]')].filter((b) => !b.disabled);
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
    const btn = e.target.closest('[role="radio"]');
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

/** Single-choice toggle chips that can be cleared (tap the chosen one again). */
function bindChips(container, onPick) {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip[data-value]');
    if (!btn || !container.contains(btn)) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    for (const b of container.querySelectorAll('.chip[data-value]')) b.setAttribute('aria-pressed', b === btn && on ? 'true' : 'false');
    onPick(on ? btn.dataset.value : '');
  });
}

/**
 * One-time wiring at boot (called by app.js). The entry sheet keeps no
 * cache and registers no live pill: running entries hand over to their own
 * sheets (feed / pump / sleep).
 * @param {object} ctx
 */
export function setup(ctx) {
  void ctx;
}

// Exported for unit tests (pure).
export const _test = Object.freeze({ kindOf, hasDuration, dateValue, timeValue, fromInputs, parseAmount, editProblem });
