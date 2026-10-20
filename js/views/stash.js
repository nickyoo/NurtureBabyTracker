// Stash (DESIGN §6.8 Stash split bar / UseNextHero / ExpiryBadge, §13 Frame 5;
// motion contract #9, #10, #19; ARCHITECTURE §4, §5.2; AUDIT §2 "Use next",
// F7–F10, F12).
//
//  - Header: "MILK STASH", the usable total in the display unit (56 px), an
//    outline "Add pouch" action, and "About 11 bottles of 4 oz" — the bottle
//    is the active baby's usual bottle (median of the last two weeks), so
//    switching baby updates it. With two babies the line names the baby.
//  - Split bar: fridge (fridge + thawed + room, solid) vs freezer (freezer +
//    deep freezer, striped), legend with amount + pouch count.
//  - "Use next" hero (UseNextHero): thawed milk first (its clock is running),
//    then fridge milk that must go within a day, otherwise the oldest frozen
//    pouch (FIFO), otherwise the soonest fridge pouch (DESIGN §16.1 — the
//    frame's rule). States: frozen [Thaw][Thaw & feed] · thawed [Feed]
//    [Discard] · fridge [Feed][Mark used] · expired [Discard]. Thaw keeps
//    the hero in place and cross-fades its pouch art (#19); the pouch's row
//    collapses out of the freezer and slides into Thawed.
//  - Sections, oldest first: Thawed · Fridge · Room temp · Freezer · Deep
//    freezer · Expired (last 30 days, "Expired · discard"). Rows are buttons
//    → the pouch detail sheet. Keyed rows: new ones slide in where they land
//    after the sheet that made them has closed (#9), removed ones collapse.
//  - "Used & discarded" → the archive sheet. Warm empty state, never blank.
//  - Every change gets an Undo toast (stash.get before → stash.restore).
//  - Hidden bottle tracker: no feed buttons (Mark used instead). Hidden stash
//    tracker: the router drops the tab.
//
// Only store subscriptions drive re-renders; the DOM is a persistent
// skeleton patched in place, so focus and pressed states survive refreshes.

import { effectiveStatus, FROZEN_LOCATIONS, THAWED_LOCATION, DEFAULT_STORAGE_WINDOWS } from '../domain/inventory.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30.44 * DAY;
const NEW_ROW_MS = 1500;          // > --dur-highlight (1200 ms)
const EXPIRED_SHOWN_MS = 30 * DAY; // older expired pouches live in the archive only
const SECTIONS = Object.freeze(['thawed', 'fridge', 'room', 'freezer', 'deepFreezer', 'expired']);
const SEC_WORD = Object.freeze({ thawed: 'Thawed', fridge: 'Fridge', room: 'Room temp', freezer: 'Freezer', deepFreezer: 'Deep freezer', expired: 'Expired' });
const SEC_ICON = Object.freeze({ thawed: 'thaw', fridge: 'fridge', room: 'pouch', freezer: 'snow', deepFreezer: 'snow', expired: 'clock' });
const PLACE_IN = Object.freeze({ fridge: 'in the fridge', freezer: 'in the freezer', deepFreezer: 'in the deep freezer', room: 'at room temp', thawed: 'thawed' });
const UNIT_SPOKEN = Object.freeze({ oz: ['ounce', 'ounces'], mL: ['milliliter', 'milliliters'] });

const isFrozen = (item) => FROZEN_LOCATIONS.includes(item.location);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const spoken = (v, unit) => `${v} ${UNIT_SPOKEN[unit][Number(v) === 1 ? 0 : 1]}`;

function half(n) {
  const whole = Math.floor(n);
  if (n === whole) return String(whole);
  return whole ? `${whole}½` : '½';
}
/** "6 weeks", "3 days", "5h" — how long something has been. */
function ageWords(ms) {
  if (ms < HOUR) return 'under an hour';
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 14 * DAY) return plural(Math.floor(ms / DAY), 'day');
  if (ms < 60 * DAY) return plural(Math.floor(ms / (7 * DAY)), 'week');
  return `${half(Math.round((ms / MONTH) * 2) / 2)} months`;
}
/** "4½ months left", "3 days left", "5h left". Never claims time that isn't there. */
function leftWords(ms) {
  if (ms >= 60 * DAY) return `${half(Math.floor((ms / MONTH) * 2) / 2)} months left`;
  if (ms >= 14 * DAY) return `${Math.floor(ms / (7 * DAY))} weeks left`;
  if (ms >= 2 * DAY) return `${Math.round(ms / DAY)} days left`;
  if (ms >= DAY) return '1 day left';
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h left`;
  return `${Math.max(1, Math.floor(ms / MINUTE))} min left`;
}
/** "23h" / "40 min": what's left of a short window. */
function withinWords(ms) {
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.max(1, Math.floor(ms / MINUTE))} min`;
}
function shortDate(ts, now = Date.now()) {
  const d = new Date(ts);
  const opts = { month: 'short', day: 'numeric' };
  // The year only when the month and day alone could mislead ("Best by Mar 2"
  // six months out is clear; a date ~a year away or older is not).
  if (Math.abs(ts - now) > 300 * DAY) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/**
 * ExpiryBadge (DESIGN §6.8): words + clock icon, never color alone; danger
 * only for expired milk, never for "soon".
 */
function expiryBadge(item, now) {
  if (effectiveStatus(item, now) !== 'active') return { tone: 'danger', text: 'Expired · discard' };
  const left = item.expiresAt - now;
  if (isFrozen(item)) return { tone: left < 14 * DAY ? 'warn' : 'ok', text: `Best by ${shortDate(item.expiresAt, now)}` };
  if (left < HOUR) return { tone: 'warn', text: `Use within ${Math.max(1, Math.floor(left / MINUTE))} min` };
  if (left < DAY) return { tone: 'warn', text: `Use within ${Math.floor(left / HOUR)}h` };
  if (left < 2 * DAY) return { tone: 'warn', text: '1 day left' };
  return { tone: 'ok', text: `${Math.round(left / DAY)} days left` };
}

/**
 * The "Use next" pouch (DESIGN §16.1, Frame 5): thawed milk first (soonest
 * expiry), then fridge / room milk that must go within a day, then the
 * oldest frozen pouch (FIFO), then the soonest fridge / room pouch.
 * Expired milk is never offered.
 * @param {object[]} usable active, unexpired pouches
 * @param {number} now
 * @returns {object|null}
 */
function pickHero(usable, now) {
  const soonest = (a, b) => (a.expiresAt - b.expiresAt) || (a.pumpedAt - b.pumpedAt);
  const thawed = usable.filter((i) => i.location === THAWED_LOCATION).sort(soonest);
  if (thawed.length) return thawed[0];
  const fresh = usable.filter((i) => i.location === 'fridge' || i.location === 'room').sort(soonest);
  if (fresh.length && fresh[0].expiresAt - now < DAY) return fresh[0];
  const frozen = usable.filter(isFrozen).sort((a, b) => (a.pumpedAt - b.pumpedAt) || ((a.createdAt || 0) - (b.createdAt || 0)) || String(a.id).localeCompare(String(b.id)));
  if (frozen.length) return frozen[0];
  return fresh[0] || null;
}

function median(nums) {
  const s = nums.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default {
  id: 'stash',
  title: 'Stash',
  /**
   * @param {HTMLElement} root the view's scrolling <section>
   * @param {object} ctx app ctx (ARCHITECTURE §5.2)
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render, element } = ctx.html;
    const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
    const F = ctx.format;
    const trackers = () => ctx.settings.get('trackers') || {};
    const unitNow = () => ctx.units.normalizeUnit(ctx.settings.get('units'));
    const windows = () => ({ ...DEFAULT_STORAGE_WINDOWS, ...(ctx.settings.get('storageWindows') || {}) });

    render(root, html`<div class="view-pad stx">
        <header class="page-hd is-compact stx-hd">
          <div class="stx-hd-text"><h1 class="eyebrow">Milk stash</h1><div data-total></div></div>
          <div class="hd-actions" data-hd-actions>
            <button type="button" class="btn btn-outline" data-action="add">${I('plus', 20)}Add pouch</button>
          </div>
        </header>
        <div class="stx-summary" data-summary></div>
        <div class="stx-hero-slot" data-hero-slot></div>
        <div class="stx-secs" data-secs></div>
        <div data-empty></div>
        <div class="stx-archive-slot" data-archive-slot></div>
      </div>`);
    const totalEl = root.querySelector('[data-total]');
    const hdActions = root.querySelector('[data-hd-actions]');
    const summaryEl = root.querySelector('[data-summary]');
    const heroSlot = root.querySelector('[data-hero-slot]');
    const secsEl = root.querySelector('[data-secs]');
    const emptyEl = root.querySelector('[data-empty]');
    const archiveSlot = root.querySelector('[data-archive-slot]');

    let stopped = false;
    let data = null;
    let ready = false;            // first paint done (later paints may animate)
    let busy = false;             // a hero action is in flight (double-tap guard)
    let hold = 0;                 // an action is about to open a sheet: defer repaints
    let dirty = false;
    let dirtyAnimate = true;
    let seq = 0;
    let tickTimer = 0;
    const sigs = { total: '', summary: '', empty: '', archive: '', heroBtns: '', heroText: '' };
    const secEls = new Map();     // key → { el, ul, head, removeTimer }
    const rowEls = new Map();     // pouch id → { li, btn, sig, sec }
    const newRowTimers = new Set();
    let heroId = null;

    // ------------------------------------------------------------ load
    async function load() {
      const now = Date.now();
      const t = trackers();
      const baby = ctx.activeBaby();
      const babyId = baby ? baby.id : null;
      const [all, feeds] = await Promise.all([
        ctx.stash.list({ filter: 'everything', now }),
        t.bottle !== false ? ctx.events.query({ type: 'feed', from: now - 14 * DAY, babyId }).catch(() => []) : Promise.resolve([]),
      ]);
      return { now, all, feeds, baby };
    }

    function model(d) {
      const now = Date.now();
      const unit = unitNow();
      const usable = d.all.filter((i) => effectiveStatus(i, now) === 'active');
      const expired = d.all.filter((i) => effectiveStatus(i, now) === 'expired' && now - i.expiresAt < EXPIRED_SHOWN_MS);
      const archived = d.all.filter((i) => effectiveStatus(i, now) !== 'active').length;
      const inUnit = (i) => ctx.units.convertQty(i.quantity, i.unit, unit);
      const sum = (list) => ctx.units.roundForUnit(list.reduce((a, i) => a + inUnit(i), 0), unit);
      const fresh = usable.filter((i) => !isFrozen(i));
      const frozen = usable.filter(isFrozen);
      const secs = {
        thawed: usable.filter((i) => i.location === THAWED_LOCATION).sort((a, b) => (a.expiresAt - b.expiresAt) || (a.pumpedAt - b.pumpedAt)),
        fridge: usable.filter((i) => i.location === 'fridge').sort((a, b) => a.pumpedAt - b.pumpedAt),
        room: usable.filter((i) => i.location === 'room').sort((a, b) => a.pumpedAt - b.pumpedAt),
        freezer: usable.filter((i) => i.location === 'freezer').sort((a, b) => a.pumpedAt - b.pumpedAt),
        deepFreezer: usable.filter((i) => i.location === 'deepFreezer').sort((a, b) => a.pumpedAt - b.pumpedAt),
        expired: expired.sort((a, b) => b.expiresAt - a.expiresAt),
      };
      // The family's usual bottle for the active baby (median of finished bottles).
      const amounts = d.feeds
        .filter((e) => e.endTime !== null && e.data && e.data.method === 'bottle' && Number(e.data.amount) > 0)
        .slice(0, 20)
        .map((e) => ctx.units.convertQty(e.data.amount, e.data.unit, unit));
      const med = median(amounts);
      const snap = unit === 'mL' ? 10 : 0.5;
      const bottle = med === null ? (unit === 'mL' ? 120 : 4) : Math.max(snap, Math.round(med / snap) * snap);
      let hero = pickHero(usable, now);
      if (!hero && expired.length) hero = secs.expired[0];
      return {
        now, unit, usable, expired, archived, secs, hero, bottle,
        total: sum(usable), freshAmt: sum(fresh), frozenAmt: sum(frozen), freshCount: fresh.length, frozenCount: frozen.length,
      };
    }

    // ------------------------------------------------------------ header
    function paintHeader(m) {
      const empty = !m.usable.length && !m.expired.length;
      const sig = empty ? 'empty' : `${m.total}${m.unit}`;
      if (sig !== sigs.total) {
        sigs.total = sig;
        if (empty) render(totalEl, html`<p class="page-title">Stash</p>`);
        else render(totalEl, html`<p class="total stx-total" aria-label="${`${spoken(m.total, m.unit)} stored`}"><b>${String(m.total)}</b><small>${m.unit}</small></p>`);
      }
      hdActions.hidden = empty;
    }

    function paintSummary(m) {
      if (!m.usable.length && !m.expired.length) {
        if (sigs.summary !== '') { sigs.summary = ''; render(summaryEl, null); }
        return;
      }
      const t = trackers();
      const babies = ctx.settings.get('babies') || [];
      let sub;
      if (!m.usable.length) sub = 'Nothing ready to use right now';
      else if (t.bottle === false) sub = plural(m.usable.length, 'pouch', 'pouches');
      else {
        const n = Math.floor((m.total + 1e-9) / m.bottle);
        const size = `${ctx.units.roundForUnit(m.bottle, m.unit)} ${m.unit}`;
        const whose = babies.length > 1 ? `${F.possessive(F.babyName(ctx.activeBaby()))} ` : '';
        if (n < 1) sub = `Less than one of ${whose}${size} bottles`;
        else if (whose) sub = `About ${n} of ${whose}${size} bottles`;
        else sub = `About ${plural(n, 'bottle')} of ${size}`;
      }
      const sig = JSON.stringify([sub, m.freshAmt, m.frozenAmt, m.freshCount, m.frozenCount, m.unit, m.usable.length]);
      if (sig === sigs.summary) return;
      sigs.summary = sig;
      const u = m.unit;
      render(summaryEl, html`
        <p class="page-sub stx-sub">${sub}</p>
        ${m.usable.length ? html`
          <div class="split stx-split" role="img" aria-label="${`Fridge ${spoken(m.freshAmt, u)}, freezer ${spoken(m.frozenAmt, u)}`}">
            ${m.freshAmt > 0 ? html`<i class="fr" data-part="${m.freshAmt}"></i>` : ''}
            ${m.frozenAmt > 0 ? html`<i class="fz" data-part="${m.frozenAmt}"></i>` : ''}
          </div>
          <div class="split-legend stx-legend">
            <span><i class="sw fr"></i>${I('fridge', 18)}Fridge <b>${String(m.freshAmt)} ${u}</b> · ${m.freshCount}</span>
            <span><i class="sw fz"></i>${I('snow', 18)}Freezer <b>${String(m.frozenAmt)} ${u}</b> · ${m.frozenCount}</span>
          </div>` : ''}`);
      for (const el of summaryEl.querySelectorAll('[data-part]')) el.style.setProperty('--part', el.dataset.part);
    }

    // ------------------------------------------------------------ hero
    const ART = html`<svg class="pouch-art stx-art" width="64" height="76" viewBox="0 0 64 76" aria-hidden="true" data-art>
        <path class="pa-body" d="M12 6h40v10l6 9v40a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V25l6-9z"></path>
        <path class="pa-milk stx-milk-still" d="M8.5 40h47v25a4 4 0 0 1-4 4h-39a4 4 0 0 1-4-4z"></path>
        <path class="pa-milk stx-milk-thawed" d="M8.5 37c4.5-2.4 9-2.4 13.5 0s9 2.4 13.5 0 9-2.4 13.5 0c2.4 1.3 4.6 1.3 6.5.6V65a4 4 0 0 1-4 4h-39a4 4 0 0 1-4-4z"></path>
        <path class="pa-line" d="M12 16h40"></path><path class="pa-line" d="M20 30h12"></path>
        <path class="stx-art-drop" d="M32 45.5s4.6 5 4.6 8.3a4.6 4.6 0 0 1-9.2 0c0-3.3 4.6-8.3 4.6-8.3z"></path>
      </svg>`;

    function heroModel(m) {
      const p = m.hero;
      if (!p) return null;
      const now = m.now;
      const a = F.amountSplit(p.quantity, p.unit, m.unit);
      const feedOn = trackers().bottle !== false;
      const status = effectiveStatus(p, now);
      const b = (act, icon, label, primary) => ({ act, icon, label, primary });
      let state;
      let tag;
      let loc;
      let meta;
      let btns;
      if (status !== 'active') {
        state = 'expired';
        tag = { cls: 'badge-danger', icon: 'clock', text: 'Expired · discard' };
        loc = { icon: SEC_ICON[p.location] || 'pouch', text: (PLACE_IN[p.location] || '').replace(/^./, (c) => c.toUpperCase()) };
        meta = html`Pumped <b>${shortDate(p.pumpedAt, now)}</b><br>Expired <b>${F.dayLabel(p.expiresAt, now)}</b>`;
        btns = [b('discard', 'trash', 'Discard', true)];
      } else if (isFrozen(p)) {
        state = 'frozen';
        tag = { cls: 'badge-next', icon: 'spark', text: 'Use next' };
        loc = { icon: 'snow', text: p.location === 'deepFreezer' ? 'Oldest in deep freezer' : 'Oldest in freezer' };
        meta = html`Pumped <b>${shortDate(p.pumpedAt, now)}</b> · frozen ${ageWords(Math.max(0, now - p.pumpedAt))}<br>Best by <b>${shortDate(p.expiresAt, now)}</b> · ${leftWords(p.expiresAt - now)}`;
        btns = feedOn ? [b('thaw', 'thaw', 'Thaw', true), b('thaw-feed', 'bottle', 'Thaw & feed', false)] : [b('thaw', 'thaw', 'Thaw', true)];
      } else if (p.location === THAWED_LOCATION) {
        state = 'thawed';
        tag = { cls: 'badge-next', icon: 'spark', text: 'Use next' };
        loc = { icon: 'thaw', text: 'Thawed · use first' };
        const since = Number.isFinite(p.thawedAt) ? html`Thawed <b>${ageWords(Math.max(0, now - p.thawedAt)).replace('under an hour', 'just now')}${now - p.thawedAt < HOUR ? '' : ' ago'}</b> · ` : '';
        meta = html`${since}use within <b>${withinWords(p.expiresAt - now)}</b><br>Pumped <b>${shortDate(p.pumpedAt, now)}</b>`;
        btns = feedOn ? [b('feed', 'bottle', 'Feed', true), b('discard', 'trash', 'Discard', false)] : [b('used', 'check', 'Mark used', true), b('discard', 'trash', 'Discard', false)];
      } else {
        state = 'fresh';
        tag = { cls: 'badge-next', icon: 'spark', text: 'Use next' };
        loc = { icon: p.location === 'room' ? 'pouch' : 'fridge', text: p.location === 'room' ? 'Room temp · use first' : 'Fridge · use first' };
        meta = html`Pumped <b>${F.dayLabel(p.pumpedAt, now)}, ${F.clock(p.pumpedAt)}</b><br>Use by <b>${byDay(p.expiresAt, now)}</b> · ${leftWords(p.expiresAt - now)}`;
        btns = feedOn ? [b('feed', 'bottle', 'Feed', true), b('used', 'check', 'Mark used', false)] : [b('used', 'check', 'Mark used', true), b('discard', 'trash', 'Discard', false)];
      }
      return { id: p.id, state, tag, loc, meta, btns, a };
    }

    function byDay(ts, now) {
      if (ctx.time.isSameDay(ts, now)) return F.clock(ts);
      if (ts - now < 6 * DAY) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
      return shortDate(ts, now);
    }

    function paintHero(m, { animate }) {
      const h = heroModel(m);
      let hero = heroSlot.querySelector('.stx-hero');
      if (!h) {
        heroId = null;
        if (hero) {
          if (hero.contains(document.activeElement)) root.focus({ preventScroll: true });
          hero.remove();
        }
        sigs.heroBtns = '';
        sigs.heroText = '';
        return;
      }
      const hadFocus = hero && hero.contains(document.activeElement) ? document.activeElement.getAttribute('data-hero-act') : null;
      if (!hero) {
        render(heroSlot, html`<section class="hero cat-pump stx-hero" aria-label="Use next">
            <div class="hero-top"><span class="badge" data-hero-tag></span><span class="hero-loc" data-hero-loc></span></div>
            <div class="hero-mid">${ART}<div class="stx-hero-text"><p class="hero-amt" data-hero-amt></p><p class="hero-meta" data-hero-meta></p></div></div>
            <div class="btns" data-hero-btns></div>
          </section>`);
        hero = heroSlot.querySelector('.stx-hero');
        sigs.heroBtns = '';
        sigs.heroText = '';
        if (animate && ready) hero.classList.add('is-entering');
      }
      const art = hero.querySelector('[data-art]');
      art.classList.toggle('is-thawed', h.state === 'thawed');
      art.classList.toggle('is-expired', h.state === 'expired');
      hero.dataset.state = h.state;
      hero.dataset.pouch = h.id;
      const textSig = JSON.stringify([h.tag, h.loc, String(h.meta), h.a]);
      if (textSig !== sigs.heroText) {
        sigs.heroText = textSig;
        const tag = hero.querySelector('[data-hero-tag]');
        tag.className = `badge ${h.tag.cls}`;
        render(tag, html`${I(h.tag.icon, 14)}${h.tag.text}`);
        render(hero.querySelector('[data-hero-loc]'), html`${I(h.loc.icon, 18)}${h.loc.text}`);
        render(hero.querySelector('[data-hero-amt]'), html`<span class="num">${h.a.value}</span><small> ${h.a.unit}</small>`);
        render(hero.querySelector('[data-hero-meta]'), h.meta);
      }
      const btnSig = JSON.stringify([h.id, h.btns]);
      if (btnSig !== sigs.heroBtns) {
        sigs.heroBtns = btnSig;
        const box = hero.querySelector('[data-hero-btns]');
        box.classList.toggle('stx-btns-one', h.btns.length === 1);
        render(box, h.btns.map((x) => html`<button type="button" class="btn ${x.primary ? 'btn-primary' : 'btn-secondary'}" data-hero-act="${x.act}" data-id="${h.id}">${I(x.icon, 22)}${x.label}</button>`));
        if (hadFocus) {
          const again = box.querySelector(`[data-hero-act="${hadFocus}"]`) || box.querySelector('[data-hero-act]');
          if (again) again.focus({ preventScroll: true });
        }
      }
      heroId = h.id;
    }

    // ------------------------------------------------------------ sections + rows
    function secMeta(key) {
      const w = windows();
      switch (key) {
        case 'thawed': return `Use within ${w.thawedBottleHours}h`;
        case 'fridge': return `Keeps ${plural(Number(w.fridgeDays), 'day')}`;
        case 'room': return `Keeps ${plural(Number(w.roomTempHours), 'hour')}`;
        case 'freezer': return `Best within ${w.freezerMonths} months`;
        case 'deepFreezer': return `Best within ${w.deepFreezerMonths} months`;
        case 'expired': return 'Discard when you can';
        default: return '';
      }
    }

    function rowModel(item, sec, m) {
      const now = m.now;
      const a = F.amountSplit(item.quantity, item.unit, m.unit);
      const badge = expiryBadge(item, now);
      let meta;
      if (sec === 'expired') meta = `${SEC_WORD[item.location] || 'Stash'} · pumped ${shortDate(item.pumpedAt, now)}`;
      // Thawed: the thaw clock is what matters (the badge says what's left).
      else if (sec === 'thawed') meta = Number.isFinite(item.thawedAt) ? `Thawed ${now - item.thawedAt < HOUR ? 'just now' : `${ageWords(now - item.thawedAt)} ago`}` : `Pumped ${shortDate(item.pumpedAt, now)}`;
      else if (isFrozen(item)) meta = ctx.time.isSameDay(item.pumpedAt, now) ? `Today, ${F.clock(item.pumpedAt)}` : F.dayLabel(item.pumpedAt, now);
      else meta = `${F.dayLabel(item.pumpedAt, now)}, ${F.clock(item.pumpedAt)}`;
      const note = (item.notes || '').split('\n')[0].trim();
      if (note) meta += ` · ${note.slice(0, 60)}`;
      const aria = `${spoken(a.value, a.unit)}, ${SEC_WORD[sec] === 'Expired' ? `expired, ${PLACE_IN[item.location] || ''}` : (PLACE_IN[item.location] || '')}, pumped ${F.dayLabel(item.pumpedAt, now)} ${F.clock(item.pumpedAt)}. ${badge.text}. Open pouch.`;
      const tpl = html`<span class="chip-ic">${I('pouch', 22)}</span>
        <span class="row-main"><b class="row-title"><span class="num">${a.value}</span> ${a.unit}</b><small class="row-meta">${meta}</small></span>
        <span class="badge badge-${badge.tone}">${I('clock', 14)}${badge.text}</span>`;
      return { id: item.id, sec, tpl, aria, sig: JSON.stringify([a, meta, badge, aria]) };
    }

    function ensureSection(key, m, total, count, animate) {
      let s = secEls.get(key);
      if (s && s.removeTimer) { clearTimeout(s.removeTimer); s.removeTimer = 0; s.el.classList.remove('is-leaving'); }
      if (!s) {
        const id = `stx-sec-${key}`;
        const el = element(html`<section class="stx-sec cat-pump" data-sec="${key}" aria-labelledby="${id}">
            <div class="sec-hd"><h2 class="sec-title stx-sec-title" id="${id}">${I(SEC_ICON[key], 24)}<span>${SEC_WORD[key]}</span><span class="stx-sec-amt" data-amt></span></h2><span class="sec-meta" data-meta></span></div>
            <ul class="list no-time" aria-label="${`${SEC_WORD[key]}, ${key === 'expired' ? 'newest first' : 'oldest first'}`}"></ul>
          </section>`);
        // Keep SECTIONS order.
        const after = SECTIONS.slice(SECTIONS.indexOf(key) + 1).map((k) => secEls.get(k)).find((x) => x && x.el.isConnected);
        secsEl.insertBefore(el, after ? after.el : null);
        s = { el, ul: el.querySelector('ul'), amt: el.querySelector('[data-amt]'), meta: el.querySelector('[data-meta]'), removeTimer: 0, sig: '' };
        secEls.set(key, s);
        if (animate) el.classList.add('is-entering');
      }
      const sig = JSON.stringify([total, count, secMeta(key)]);
      if (sig !== s.sig) {
        s.sig = sig;
        s.amt.textContent = key === 'expired' ? plural(count, 'pouch', 'pouches') : total;
        s.meta.textContent = secMeta(key);
      }
      return s;
    }

    function dropSection(key, animate) {
      const s = secEls.get(key);
      if (!s || s.removeTimer) return;
      if (!animate || ctx.motionReduced()) { s.el.remove(); secEls.delete(key); return; }
      s.el.classList.remove('is-entering');
      s.el.classList.add('is-leaving');
      s.removeTimer = setTimeout(() => { s.el.remove(); if (secEls.get(key) === s) secEls.delete(key); }, 260);
    }

    function paintSections(m, { animate }) {
      const wanted = new Map();
      for (const key of SECTIONS) for (const item of m.secs[key]) wanted.set(item.id, key);
      // Rows that left (or moved to another section) collapse first.
      for (const [id, slot] of [...rowEls]) {
        if (wanted.get(id) === slot.sec) continue;
        rowEls.delete(id);
        removeRow(slot.li, animate);
      }
      for (const key of SECTIONS) {
        const items = m.secs[key];
        if (!items.length) { dropSection(key, animate); continue; }
        const total = F.amount(items.reduce((a, i) => a + ctx.units.convertQty(i.quantity, i.unit, m.unit), 0), m.unit);
        const s = ensureSection(key, m, total, items.length, animate && ready);
        let prev = null;
        for (const item of items) {
          const r = rowModel(item, key, m);
          let slot = rowEls.get(r.id);
          if (!slot) {
            const li = element(html`<li><button type="button" class="row cat-pump stx-row" data-pouch="${r.id}" aria-label="${r.aria}">${r.tpl}</button></li>`);
            slot = { li, btn: li.firstElementChild, sig: r.sig, sec: key };
            rowEls.set(r.id, slot);
            insertAfter(s.ul, li, prev);
            if (animate && ready) markNew(li);
          } else {
            if (slot.sig !== r.sig) {
              slot.sig = r.sig;
              slot.btn.setAttribute('aria-label', r.aria);
              render(slot.btn, r.tpl);
            }
            const expected = prev ? nextLive(prev) : firstLive(s.ul);
            if (expected !== slot.li) insertAfter(s.ul, slot.li, prev);
          }
          prev = slot.li;
        }
      }
    }
    const isLeaving = (n) => n.classList.contains('is-removing');
    function firstLive(ul) { let n = ul.firstElementChild; while (n && isLeaving(n)) n = n.nextElementSibling; return n; }
    function nextLive(li) { let n = li.nextElementSibling; while (n && isLeaving(n)) n = n.nextElementSibling; return n; }
    function insertAfter(ul, li, prev) {
      const ref = prev ? prev.nextElementSibling : ul.firstElementChild;
      if (ref !== li) ul.insertBefore(li, ref);
    }
    function markNew(li) {
      li.classList.add('is-inserting');
      const btn = li.firstElementChild;
      if (btn) btn.classList.add('is-new');
      const t = setTimeout(() => {
        newRowTimers.delete(t);
        li.classList.remove('is-inserting');
        if (btn) btn.classList.remove('is-new');
      }, NEW_ROW_MS);
      newRowTimers.add(t);
    }
    function removeRow(li, animate) {
      if (li.contains(document.activeElement)) {
        const next = nextLive(li) || li.previousElementSibling;
        const target = next && next.firstElementChild;
        if (target && !isLeaving(next)) target.focus({ preventScroll: true }); else root.focus({ preventScroll: true });
      }
      if (!animate || !ready || ctx.motionReduced()) { li.remove(); return; }
      li.style.setProperty('max-height', `${li.offsetHeight}px`);
      li.getBoundingClientRect();
      li.classList.add('is-removing');
      const done = () => li.remove();
      li.addEventListener('transitionend', (e) => { if (e.target === li && e.propertyName === 'max-height') done(); });
      setTimeout(done, 400);
    }

    // ------------------------------------------------------------ empty + archive
    function paintEmpty(m) {
      const empty = !m.usable.length && !m.expired.length;
      const want = empty ? (m.archived ? 'used' : 'new') : '';
      if (want === sigs.empty) return;
      sigs.empty = want;
      // The empty state's Add pouch had focus (it was the sheet's origin):
      // hand it to the header's Add pouch, which takes its place.
      if (emptyEl.contains(document.activeElement)) {
        const add = !want && !hdActions.hidden && hdActions.querySelector('[data-action="add"]');
        if (add) add.focus({ preventScroll: true }); else root.focus({ preventScroll: true });
      }
      if (!want) { render(emptyEl, null); return; }
      render(emptyEl, html`<div class="empty-state cat-pump stx-empty ${ready ? 'is-entering' : ''}">
          <span class="empty-disc">${I('pouch', 30)}</span>
          <h2 class="empty-title">${want === 'new' ? 'No milk stored yet' : 'The stash is empty'}</h2>
          <p class="empty-text">${want === 'new' ? 'Pumped milk you save will line up here, oldest first.' : 'Everything’s been used. New pouches will line up here, oldest first.'}</p>
          <button type="button" class="btn btn-primary" data-action="add">${I('plus', 22)}Add pouch</button>
        </div>`);
    }

    function paintArchive(m) {
      const sig = String(m.archived);
      if (sig === sigs.archive) return;
      sigs.archive = sig;
      if (!m.archived) {
        if (archiveSlot.contains(document.activeElement)) root.focus({ preventScroll: true });
        render(archiveSlot, null);
        return;
      }
      const btn = archiveSlot.querySelector('[data-action="archive"]');
      const label = `Used and discarded: ${plural(m.archived, 'pouch', 'pouches')}`;
      const inner = html`<span class="chip-ic">${I('check', 22)}</span>
          <span class="row-main"><b class="row-title">Used &amp; discarded</b><small class="row-meta">${plural(m.archived, 'pouch', 'pouches')}</small></span>
          ${I('chev-r', 20)}`;
      if (btn) { btn.setAttribute('aria-label', label); render(btn, inner); return; }
      render(archiveSlot, html`<ul class="list no-time stx-archive"><li><button type="button" class="row cat-neutral stx-archive-row" data-action="archive" aria-label="${label}">${inner}</button></li></ul>`);
    }

    // ------------------------------------------------------------ refresh
    async function refresh({ animate = true } = {}) {
      const my = (seq += 1);
      const next = await load().catch((err) => { console.error('Stash: load failed', err); return null; });
      if (!next || stopped || my !== seq) return;
      data = next;
      paint({ animate });
    }

    function paint({ animate }) {
      if (!data) return;
      const m = model(data);
      const anim = animate && ready;
      paintHeader(m);
      paintSummary(m);
      paintHero(m, { animate: anim });
      paintSections(m, { animate: anim });
      paintEmpty(m);
      paintArchive(m);
      ready = true;
      scheduleTick();
    }

    /** Store changes under an open sheet (or mid-action) wait until it has closed (#9). */
    function onStoreChange({ animate = true } = {}) {
      if (hold > 0 || document.documentElement.classList.contains('has-sheet')) {
        dirty = true;
        dirtyAnimate = dirtyAnimate && animate;
        return;
      }
      queueRefresh(animate);
    }
    let queued = null;
    function queueRefresh(animate) {
      if (queued) { queued.animate = queued.animate && animate; return; }
      queued = { animate };
      queueMicrotask(() => { const q = queued; queued = null; refresh(q); });
    }
    function flushDirty() {
      if (!dirty || hold > 0 || document.documentElement.classList.contains('has-sheet')) return;
      dirty = false;
      const a = dirtyAnimate;
      dirtyAnimate = true;
      queueRefresh(a);
    }
    const sheetWatch = new MutationObserver(flushDirty);
    sheetWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Expiry words move with the clock; a pouch that runs out moves to Expired.
    function scheduleTick() {
      clearTimeout(tickTimer);
      if (stopped || document.hidden) return;
      tickTimer = setTimeout(() => onStoreChange({ animate: true }), 60 * 1000);
    }
    const onVisibility = () => { if (!document.hidden) onStoreChange({ animate: false }); else clearTimeout(tickTimer); };
    document.addEventListener('visibilitychange', onVisibility);

    // ------------------------------------------------------------ actions
    function setBusy(btn, on) {
      if (!btn) return;
      if (on) { btn.style.setProperty('min-width', `${btn.offsetWidth}px`); btn.setAttribute('aria-busy', 'true'); } else { btn.removeAttribute('aria-busy'); btn.style.removeProperty('min-width'); }
    }

    async function heroAction(act, btn) {
      const id = btn.dataset.id;
      if (!id || busy) return;
      if (act === 'feed') {
        ctx.sheets.feed({ origin: btn, preset: { method: 'bottle', sourceInventoryId: id } });
        return;
      }
      busy = true;
      setBusy(btn, true);
      const opensSheet = act === 'thaw-feed';
      if (opensSheet) hold += 1;
      try {
        const before = await ctx.stash.get(id);
        if (!before) return;
        if (act === 'thaw' || act === 'thaw-feed') {
          const next = await ctx.stash.thaw(id);
          if (!next) { ctx.toast({ message: 'That pouch isn’t frozen any more.' }); return; }
          if (opensSheet) {
            if (stopped) return;
            // The feed sheet fetches a pouch its cache hasn't seen yet and
            // keeps it selected meanwhile, so no settle wait is needed.
            ctx.sheets.feed({ origin: btn, preset: { method: 'bottle', sourceInventoryId: id } });
          } else {
            ctx.toast({ message: `Thawed · use within ${windows().thawedBottleHours}h`, action: { label: 'Undo', run: () => ctx.stash.restore(before) } });
          }
        } else if (act === 'used') {
          await ctx.stash.markUsed(id);
          ctx.toast({ message: 'Marked used', action: { label: 'Undo', run: () => ctx.stash.restore(before) } });
        } else if (act === 'discard') {
          await ctx.stash.discard(id);
          ctx.toast({ message: 'Pouch discarded', action: { label: 'Undo', run: () => ctx.stash.restore(before) } });
        }
      } catch (err) {
        console.error(`Stash: ${act} failed`, err);
        ctx.toast({ message: 'That didn’t work. Try again.', tone: 'warn' });
      } finally {
        busy = false;
        setBusy(btn, false);
        if (opensSheet) { hold -= 1; flushDirty(); }
      }
    }

    const onClick = (e) => {
      const heroBtn = e.target.closest('[data-hero-act]');
      if (heroBtn && root.contains(heroBtn)) { heroAction(heroBtn.dataset.heroAct, heroBtn); return; }
      const row = e.target.closest('.stx-row[data-pouch]');
      if (row && root.contains(row)) {
        const pouch = data && data.all.find((x) => x.id === row.dataset.pouch);
        ctx.sheets.stash({ origin: row, pouchId: row.dataset.pouch, pouch });
        return;
      }
      const b = e.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      if (b.dataset.action === 'add') ctx.sheets.stash({ origin: b });
      else if (b.dataset.action === 'archive') ctx.sheets.stash({ origin: b, view: 'archived' });
    };
    root.addEventListener('click', onClick);
    const onAnimEnd = (e) => {
      const t = e.target;
      if (t.classList && t.classList.contains('is-entering') && (t.classList.contains('stx-sec') || t.classList.contains('stx-hero') || t.classList.contains('stx-empty'))) t.classList.remove('is-entering');
    };
    root.addEventListener('animationend', onAnimEnd);

    // ------------------------------------------------------------ subscriptions
    const offStash = ctx.stash.subscribe((c) => onStoreChange({ animate: !c || c.op !== 'bulk' }));
    const offEvents = ctx.events.subscribe((c) => {
      if (!c || c.op === 'bulk' || (c.event && c.event.type === 'feed') || (c.prev && c.prev.type === 'feed')) onStoreChange({ animate: false });
    });
    const offSettings = ctx.settings.subscribe((c) => {
      const key = c && c.key;
      if (['*', 'units', 'storageWindows', 'trackers', 'babies', 'activeBabyId'].includes(key)) onStoreChange({ animate: false });
    });

    refresh({ animate: false });

    return {
      unmount() {
        stopped = true;
        clearTimeout(tickTimer);
        for (const t of newRowTimers) clearTimeout(t);
        newRowTimers.clear();
        for (const s of secEls.values()) clearTimeout(s.removeTimer);
        sheetWatch.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        root.removeEventListener('click', onClick);
        root.removeEventListener('animationend', onAnimEnd);
        offStash();
        offEvents();
        offSettings();
      },
    };
  },
};

// Exported for unit tests (pure).
export const _test = Object.freeze({ pickHero, expiryBadge, ageWords, leftWords, half, median });
