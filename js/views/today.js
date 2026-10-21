// Today (DESIGN §6.2, §6.3, §13 Frames 1–2; ARCHITECTURE §5.2, §10b).
//
// Answers four questions in one glance and logs each in one tap:
//  - Masthead: date eyebrow, the baby's name + italic age, avatar with a gear
//    badge → Settings. With two or more babies the eyebrow becomes a baby
//    switcher (a small sheet that sets activeBabyId) and the date moves into
//    the age line.
//  - "Since last" cards in settings.todayOrder, visible trackers only. Each
//    card is ONE button that logs that thing (its sheet grows from the card);
//    the small + well is part of the same button. A running nap turns its card
//    live ("● Nap", "since 8:55 AM", "Tap to wake") and a tap logs the wake-up
//    with Undo. Numbers re-render as the minutes turn, tabular.
//  - Today's list, newest first: tap a row → the entry sheet. New rows slide
//    in where they land once the sheet that made them has closed; deleted
//    rows collapse.
//  - Weekly backup nudge (persist.isBackupDue), an install-as-protection hint
//    when not installed, and warm empty states — never a modal, never blank.
//
// Only the store subscriptions drive re-renders (views never call each
// other). The DOM is a persistent skeleton patched in place, so focus and
// card press states survive every refresh.

import { classifyNapOrNight } from '../domain/sleep.js';
import { pumpProgress } from '../domain/trends.js';
import { breastSideTotals } from '../domain/safety.js';
import { eventVisible } from '../ui/format.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NUDGE_SNOOZE_MS = 3 * DAY_MS;          // "Not now" quiets the backup card this long
const INSTALL_AFTER_MS = 3 * DAY_MS;         // AUDIT §2: install hint only after day 3…
const LS_NUDGE = 'nurture.today.backupSnoozedAt';
const LS_INSTALL = 'nurture.today.installHintDismissed'; // …and once
const NEW_ROW_MS = 1500;                      // > --dur-highlight (1200 ms)

const DIAPER_WORD = Object.freeze({ wet: 'wet', dirty: 'dirty', both: 'wet + dirty', dry: 'dry' });
const UNIT_SPOKEN = Object.freeze({ oz: ['ounce', 'ounces'], mL: ['milliliter', 'milliliters'] });

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

function isStandalone() {
  try {
    return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch { return false; }
}
function isIOS() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
}


/** Today's cards, in the family's order, visible trackers only. */
function visibleCards(order, t) {
  const known = ['feed', 'sleep', 'diaper', 'pump', 'stash'];
  const seq = [...(Array.isArray(order) ? order : []).filter((k) => known.includes(k))];
  for (const k of known) if (!seq.includes(k)) seq.push(k);
  const on = {
    feed: t.bottle !== false || t.breastfeeding !== false,
    sleep: t.sleep !== false,
    diaper: t.diaper !== false,
    pump: t.pump !== false,
    stash: t.stash !== false,
  };
  return [...new Set(seq)].filter((k) => on[k]);
}

export default {
  id: 'today',
  title: 'Today',
  /**
   * @param {HTMLElement} root the view's scrolling <section>
   * @param {object} ctx app ctx (ARCHITECTURE §5.2)
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render, element } = ctx.html;
    const { iconHtml } = ctx.icons;
    const F = ctx.format;
    const I = (name, size) => iconHtml(name, { size });

    // ------------------------------------------------------------ state
    let data = null;             // last query result (see load())
    let loadSeq = 0;
    let mountedBabyId = null;    // rows from a different baby never animate in
    let mountedDayKey = '';
    let listReady = false;       // first paint of the list done (no insert animation)
    let dirty = false;           // a store change arrived while a sheet was open
    let dirtyAnimate = true;
    let tickTimer = 0;
    let nudgeState = { backup: false, install: false };
    let waking = false;
    let stopped = false;
    const cardEls = new Map();   // key → { el, sig, valSig, fill }
    const rowEls = new Map();    // id → { li, sig }
    const newRowTimers = new Set();

    const trackers = () => ctx.settings.get('trackers') || {};
    const unit = () => (ctx.settings.get('units') === 'mL' ? 'mL' : 'oz');
    const baby = () => ctx.settings.activeBaby();
    const babyName = () => F.babyName(baby());
    const dayStartOf = (ts) => ctx.time.dayBounds(ts).start;
    const dayKeyOf = (ts) => ctx.time.dayKey(ts);

    // ------------------------------------------------------- skeleton
    render(root, html`<div class="view-pad today">
      <header class="masthead" data-part="masthead"></header>
      <div class="today-cards" data-part="cards"></div>
      <div class="today-notes" data-part="notes"></div>
      <div class="sec-hd" data-part="sec-hd">
        <h2 class="sec-title">Today</h2>
        <button type="button" class="link" data-action="timeline">Timeline${I('chev-r', 18)}</button>
      </div>
      <div class="today-list" data-part="list"></div>
    </div>`);
    const part = (n) => root.querySelector(`[data-part="${n}"]`);
    const mastEl = part('masthead');
    const cardsEl = part('cards');
    const notesEl = part('notes');
    const listEl = part('list');

    // ------------------------------------------------------- masthead
    let avatarUrl = null;
    let avatarFor = null;
    function paintMasthead() {
      const b = baby();
      const name = babyName();
      const all = ctx.settings.babies() || [];
      const multi = all.length > 1;
      const now = Date.now();
      const age = b ? F.babyAge(b.birthDate, now) : '';
      const ageLine = multi ? [age, F.dateLabel(now)].filter(Boolean).join(' · ') : age;
      const initial = name.slice(0, 1).toUpperCase();
      const photo = b && b.photoId && avatarFor === b.photoId ? avatarUrl : null;
      render(mastEl, html`
        <div class="masthead-text">
          ${multi
            ? html`<button type="button" class="baby-switch eyebrow" data-action="switch-baby" aria-haspopup="dialog" aria-label="${`Showing ${name}. Switch baby`}">${name}${I('chev-d', 18)}</button>`
            : html`<p class="eyebrow">${F.eyebrowDate(now)}</p>`}
          <h1 class="masthead-title"><span class="masthead-name">${name}</span>${ageLine ? html`<span class="masthead-age">${ageLine}</span>` : ''}</h1>
        </div>
        <button type="button" class="avatar-btn" data-action="settings" aria-label="${`${F.possessive(name)} profile and settings`}">
          ${photo
            ? html`<img class="avatar" src="${photo}" alt="">`
            : html`<span class="avatar avatar-fallback" aria-hidden="true">${initial}</span>`}
          <span class="gear-badge" aria-hidden="true">${I('gear', 15)}</span>
        </button>`);
      if (b && b.photoId && avatarFor !== b.photoId) loadAvatar(b.photoId);
    }
    async function loadAvatar(photoId) {
      avatarFor = photoId;
      avatarUrl = null;
      try {
        const url = await ctx.photos.get(photoId);
        if (stopped || avatarFor !== photoId) return;
        avatarUrl = url;
        if (url) paintMasthead();
      } catch (err) { console.warn('avatar photo unavailable', err); }
    }

    // ------------------------------------------------------- data
    async function load() {
      const seq = (loadSeq += 1);
      const now = Date.now();
      const b = baby();
      const babyId = b ? b.id : undefined;
      const t = trackers();
      const dayStart = dayStartOf(now);
      const feedPred = (e) => eventVisible(e, t);
      const [today, running, lastFeed, lastSleep, lastDiaper, lastPump, lastMemory, nights, stashSum] = await Promise.all([
        ctx.events.query({ from: dayStart, babyId }),
        ctx.events.running(undefined, { babyId }),
        ctx.events.last('feed', feedPred, { babyId }),
        ctx.events.last('sleep', undefined, { babyId }),
        ctx.events.last('diaper', undefined, { babyId }),
        ctx.events.last('pump', undefined, { babyId }),
        ctx.events.last('milestone', undefined, { babyId }),
        // a night sleep that began yesterday still belongs on today's list
        ctx.events.query({ type: 'sleep', from: dayStart - 2 * DAY_MS, to: dayStart, babyId }),
        t.stash !== false ? ctx.stash.summary().catch(() => null) : Promise.resolve(null),
      ]);
      if (seq !== loadSeq || stopped) return null;
      const byId = new Map();
      for (const e of [...today, ...running, ...nights.filter((s) => s.endTime === null || s.endTime > dayStart)]) byId.set(e.id, e);
      const list = [...byId.values()]
        .filter((e) => eventVisible(e, t))
        .sort((a, b2) => b2.startTime - a.startTime || (b2.createdAt || 0) - (a.createdAt || 0));
      const runningMine = running.filter((e) => e.type === 'pump' || !babyId || e.babyId === babyId || e.babyId === null);
      return {
        now, babyId, dayStart, dayKey: dayKeyOf(now),
        today, list, running: runningMine,
        lastFeed, lastSleep, lastDiaper, lastPump, stashSum,
        hasAny: !!(lastFeed || lastSleep || lastDiaper || lastPump || lastMemory || running.length || today.length),
      };
    }

    // ------------------------------------------------------- cards
    const spoken = (value, u) => `${value} ${UNIT_SPOKEN[u][Number(value) === 1 ? 0 : 1]}`;
    const whenLine = (ts, now) => (ctx.time.isSameDay(ts, now) ? `at ${F.clock(ts)}` : `${F.dayLabel(ts, now)} at ${F.clock(ts)}`);

    // "Just now" stands alone: the sub-line drops its "ago ·" until a minute has passed.
    const ago = (ts, now) => (F.spanParts(now - ts).length ? 'ago · ' : '');

    function valueOfSpan(ms) {
      const parts = F.spanParts(ms);
      if (!parts.length) return { words: 'Just now', sig: 'now' };
      return { parts, sig: parts.map((p) => p.v + p.u).join(' ') };
    }

    /** Everything one card shows at `now` (pure over `d`). */
    function cardModel(key, d, now, { forceStash = false } = {}) {
      const t = trackers();
      const u = unit();
      const runningOf = (type, pred) => d.running.find((e) => e.type === type && (!pred || pred(e))) || null;
      switch (key) {
        case 'feed': {
          const live = runningOf('feed', (e) => e.data && e.data.method === 'breast' && t.breastfeeding !== false);
          const anyRunning = runningOf('feed', (e) => eventVisible(e, t));
          if (live) {
            const tot = breastSideTotals(live.data, now);
            const side = live.data.activeSide;
            const chip = side ? (side === 'left' ? 'Left' : 'Right') : 'Paused';
            return {
              key, cat: 'feed', icon: 'breast', label: 'Feeding', live: true, chip,
              value: valueOfSpan(tot.total * 1000), anchor: live.data.activeSince || live.startTime,
              sub1: html`since <b>${F.clock(live.startTime)}</b>`, sub2: html`Tap to open`,
              aria: `Breastfeeding, ${side ? `${chip.toLowerCase()} side` : 'paused'}, ${F.spanSpoken(tot.total * 1000)} since ${F.clock(live.startTime)}. Open the breastfeeding timer.`,
              tap: { kind: 'resume', sheet: 'feed', event: live },
            };
          }
          const e = d.lastFeed;
          if (!e) {
            return {
              key, cat: 'feed', icon: t.bottle === false ? 'breast' : 'bottle', label: 'Fed', stale: true,
              sub1: html`No feeds yet`, sub2: html`Tap to log`, aria: 'No feeds logged yet. Log a feed.',
              tap: anyRunning ? { kind: 'resume', sheet: 'feed', event: anyRunning } : { kind: 'open', sheet: 'feed', preset: { method: t.bottle === false ? 'breast' : 'bottle' } },
            };
          }
          const dd = e.data || {};
          let what; let whatSpoken; let whatShort;
          if (dd.method === 'breast') {
            const secs = breastSideTotals(dd, e.endTime ?? now).total;
            what = html`${ago(e.startTime, now)}<b>${F.durationLabel(secs * 1000)}</b> breastfeed`;
            // FLOW-11: when "ago · 11 min breastfeed" doesn't fit the half-width
            // card, the key detail stays whole and the "ago ·" goes.
            whatShort = html`<b>${F.durationLabel(secs * 1000)}</b> breastfeed`;
            whatSpoken = `breastfed ${F.durationLabel(secs * 1000)}`;
          } else {
            const a = F.amountSplit(dd.amount, dd.unit, u);
            const milk = dd.milk === 'formula' ? 'formula' : 'breast milk';
            what = a.missing ? html`${ago(e.startTime, now)}${milk} bottle` : html`${ago(e.startTime, now)}<b>${a.value} ${a.unit}</b> ${milk}`;
            whatShort = a.missing ? html`${milk} bottle` : html`<b>${a.value} ${a.unit}</b> ${milk}`;
            whatSpoken = a.missing ? `${milk} bottle` : `${spoken(a.value, a.unit)} ${milk}`;
          }
          const method = t.bottle === false ? 'breast' : t.breastfeeding === false ? 'bottle' : (dd.method === 'breast' ? 'breast' : 'bottle');
          return {
            key, cat: 'feed', icon: dd.method === 'breast' ? 'breast' : 'bottle', label: 'Fed',
            value: valueOfSpan(now - e.startTime), anchor: e.startTime,
            sub1: what, sub1Short: whatShort, sub2: html`${whenLine(e.startTime, now)}`,
            aria: `Fed ${F.spanSpoken(now - e.startTime)} ago, ${whatSpoken}, ${whenLine(e.startTime, now)}. Log a feed.`,
            tap: anyRunning ? { kind: 'resume', sheet: 'feed', event: anyRunning } : { kind: 'open', sheet: 'feed', preset: { method } },
          };
        }
        case 'sleep': {
          const live = runningOf('sleep');
          if (live) {
            const kind = live.data && live.data.kind === 'night' ? 'Night' : 'Nap';
            return {
              key, cat: 'sleep', icon: 'moon', label: 'Asleep', live: true, chip: kind,
              value: valueOfSpan(now - live.startTime), anchor: live.startTime,
              sub1: html`since <b>${F.clock(live.startTime)}</b>`, sub2: html`Tap to wake`,
              aria: `Asleep ${F.spanSpoken(now - live.startTime)}, ${kind === 'Night' ? 'night sleep' : 'nap'} since ${F.clock(live.startTime)}. Tap to log the wake-up.`,
              tap: { kind: 'wake', event: live },
            };
          }
          const e = d.lastSleep;
          const preset = { kind: classifyNapOrNight(now) };
          if (!e) {
            return {
              key, cat: 'sleep', icon: 'moon', label: 'Sleep', stale: true,
              sub1: html`No sleep logged yet`, sub2: html`Tap to log`, aria: 'No sleep logged yet. Log a sleep.',
              tap: { kind: 'open', sheet: 'sleep', preset },
            };
          }
          const slept = e.endTime - e.startTime;
          const kindWord = e.data && e.data.kind === 'night' ? 'night sleep' : 'nap';
          return {
            key, cat: 'sleep', icon: 'sun', label: 'Awake',
            value: valueOfSpan(now - e.endTime), anchor: e.endTime,
            sub1: html`since <b>${F.clock(e.endTime)}</b>`,
            sub2: html`after a <b>${F.span(slept)}</b> ${kindWord}`,
            aria: `Awake ${F.spanSpoken(now - e.endTime)}, since ${F.clock(e.endTime)}, after a ${F.spanSpoken(slept)} ${kindWord}. Log a sleep.`,
            tap: { kind: 'open', sheet: 'sleep', preset },
          };
        }
        case 'diaper': {
          const e = d.lastDiaper;
          if (!e) {
            return {
              key, cat: 'diaper', icon: 'diaper', label: 'Diaper', stale: true,
              sub1: html`No diapers yet`, sub2: html`Tap to log`, aria: 'No diapers logged yet. Log a diaper.',
              tap: { kind: 'open', sheet: 'diaper' },
            };
          }
          const word = DIAPER_WORD[e.data && e.data.kind] || 'diaper';
          const count = d.today.filter((x) => x.type === 'diaper' && x.startTime >= d.dayStart).length;
          const when = whenLine(e.startTime, now);
          return {
            key, cat: 'diaper', icon: 'diaper', label: 'Diaper',
            value: valueOfSpan(now - e.startTime), anchor: e.startTime,
            sub1: html`${ago(e.startTime, now)}<b>${word}</b>`,
            sub2: html`${when}${count ? ` · ${count} today` : ''}`,
            aria: `Diaper ${F.spanSpoken(now - e.startTime)} ago, ${word}, ${when}${count ? `, ${count} today` : ''}. Log a diaper.`,
            tap: { kind: 'open', sheet: 'diaper' },
          };
        }
        case 'pump': {
          const prog = pumpProgress(d.today, ctx.settings.get('pumpGoalOz'), { unit: u, now });
          const goal = prog.goal > 0
            ? { fill: `${Math.round(prog.fraction * 100)}%`, total: String(prog.total), goal: String(prog.goal), unit: prog.unit }
            : null;
          const progSpoken = goal ? `${goal.total} of ${spoken(goal.goal, u)} today` : `${spoken(prog.total, u)} today`;
          const live = runningOf('pump');
          const base = { key, cat: 'pump', icon: 'pump', goal, todayTotal: prog.total };
          if (live) {
            return {
              ...base, label: 'Pumping', live: true, chip: 'Now',
              value: valueOfSpan(now - live.startTime), anchor: live.startTime,
              sub1: html`since <b>${F.clock(live.startTime)}</b>`, sub2: goal ? null : html`Tap to finish`,
              aria: `Pumping ${F.spanSpoken(now - live.startTime)}, since ${F.clock(live.startTime)}. ${progSpoken}. Open the pump timer.`,
              tap: { kind: 'resume', sheet: 'pump', event: live },
            };
          }
          const e = d.lastPump;
          if (!e) {
            return {
              ...base, label: 'Pumped', stale: true,
              sub1: html`No pumps yet`, sub2: goal ? null : html`Tap to log`,
              aria: `No pumps logged yet.${goal ? ` ${progSpoken}.` : ''} Log a pump.`,
              tap: { kind: 'open', sheet: 'pump' },
            };
          }
          const a = F.amountSplit(e.data && e.data.amount, e.data && e.data.unit, u);
          const at = F.clockParts(e.startTime).time;
          return {
            ...base, label: 'Pumped',
            value: valueOfSpan(now - e.startTime), anchor: e.startTime,
            sub1: a.missing ? html`${ago(e.startTime, now)}${at}` : html`${ago(e.startTime, now)}<b>${a.value} ${a.unit}</b> · ${at}`,
            sub2: goal ? null : html`<b>${String(prog.total)} ${prog.unit}</b> today`,
            aria: `Pumped ${F.spanSpoken(now - e.startTime)} ago${a.missing ? '' : `, ${spoken(a.value, a.unit)}`}, at ${F.clock(e.startTime)}. ${progSpoken}. Log a pump.`,
            tap: { kind: 'open', sheet: 'pump' },
          };
        }
        case 'stash': {
          const s = d.stashSum;
          // AUDIT F12: no stash card until milk has ever been stored (unless it's the only card).
          if ((!s || !s.everStored) && !forceStash) return null;
          const totalOz = s ? s.totalOz : 0;
          if (!s || !(totalOz > 0)) {
            return {
              key, cat: 'pump', icon: 'pouch', label: 'Stash', stale: true,
              sub1: html`No milk stored yet`, sub2: html`Tap to add a pouch`,
              aria: 'No milk stored yet. Add a pouch.', tap: { kind: 'open', sheet: 'stash' },
            };
          }
          // DI-10: round once, from the same unrounded per-unit sums the Stash
          // tab uses (fresh = fridge + thawed + room), so the two always agree.
          const by = s.byUnit && s.byUnit[u];
          const conv = (oz) => F.amountSplit(oz, 'oz', u).value;
          const total = by ? F.amountSplit(by.total, u, u) : F.amountSplit(totalOz, 'oz', u);
          const fridge = by ? F.amountSplit(by.fresh, u, u).value : conv(s.fridgeOz || 0);
          const frozen = by ? F.amountSplit(by.frozen, u, u).value : conv((s.freezerOz || 0) + (s.deepFreezerOz || 0));
          const bags = F.plural(s.totalBags || 0, 'pouch', 'pouches');
          return {
            key, cat: 'pump', icon: 'pouch', label: 'Stash',
            value: { amount: total, sig: `${total.value}${total.unit}` },
            sub1: html`<b>${fridge}</b> fridge · <b>${frozen}</b> frozen`, sub2: html`${bags}`,
            aria: `Stash ${spoken(total.value, total.unit)}: ${fridge} in the fridge, ${frozen} frozen, ${bags}. Add a pouch.`,
            tap: { kind: 'open', sheet: 'stash' },
          };
        }
        default:
          return null;
      }
    }

    function valueTpl(m) {
      if (m.stale) return html`<span class="ql-val is-dash" aria-hidden="true">—</span>`;
      const v = m.value;
      if (v.words) return html`<span class="ql-val is-words">${v.words}</span>`;
      if (v.amount) return html`<span class="ql-val">${v.amount.value}<small>${v.amount.unit}</small></span>`;
      return html`<span class="ql-val">${v.parts.map((p) => html`${p.v}<small>${p.u}</small>`)}</span>`;
    }

    function cardInner(m) {
      return html`
        <span class="ql-top">
          <span class="ql-label">${I(m.icon, 20)}${m.label}</span>
          ${m.live ? html`<span class="live-chip"><span class="dot"></span>${m.chip}</span>` : html`<span class="ql-well">${I('plus', 18)}</span>`}
        </span>
        ${valueTpl(m)}
        <span class="ql-sub" data-sub1>${m.sub1}</span>
        ${m.goal
          ? html`<span class="goal"><span class="goal-bar"><i></i></span><span class="goal-txt">${m.goal.total}<small> / ${m.goal.goal} ${m.goal.unit}</small></span></span>`
          : html`<span class="ql-sub">${m.sub2}</span>`}`;
    }

    // A live chip next to a long label ("Pumping ● Now", "Feeding ● Paused")
    // can be wider than a half-width card on a narrow phone: drop the
    // label's icon first (the chip and the words still say it's running).
    // FLOW-11: the first sub-line's key detail ("11 min breastfeed") must not
    // be cut to "11 min breastf…": if it doesn't fit, use the short form.
    function fitSub(el, m) {
      const sub = el.querySelector('[data-sub1]');
      if (!sub || !m.sub1Short) return;
      if (sub.scrollWidth > sub.clientWidth + 1) render(sub, m.sub1Short);
    }

    function fitTop(el) {
      const label = el.querySelector('.ql-top > .ql-label');
      if (!label) return;
      el.classList.remove('is-tight');
      if (el.classList.contains('is-live') && label.scrollWidth > label.clientWidth + 1) el.classList.add('is-tight');
    }

    const cardSig = (m) => [m.key, m.icon, m.label, m.live ? m.chip : '', m.stale ? '—' : m.value.sig, String(m.sub1), m.goal ? JSON.stringify(m.goal) : String(m.sub2), m.aria].join('|');

    function paintCards(now, { fresh = false } = {}) {
      if (!data) return;
      const wantKeys = visibleCards(ctx.settings.get('todayOrder'), trackers());
      let models = wantKeys.map((k) => cardModel(k, data, now)).filter(Boolean);
      if (!models.length && wantKeys.includes('stash')) models = [cardModel('stash', data, now, { forceStash: true })];
      const keys = models.map((m) => m.key);
      if (!keys.length) {
        cardEls.clear();
        if (!cardsEl.querySelector('[data-empty="trackers"]')) {
          render(cardsEl, html`<div class="empty-state cat-neutral" data-empty="trackers">
            <span class="empty-disc">${I('gear', 30)}</span>
            <h2 class="empty-title">Every tracker is hidden</h2>
            <p class="empty-text">Hidden trackers keep their data. Turn some back on to see them here.</p>
            <button type="button" class="btn btn-secondary" data-action="customize">Customize</button>
          </div>`);
        }
        return;
      }
      // Same cards in the same order → patch in place; otherwise rebuild.
      const grid = cardsEl.querySelector('.ql-grid');
      const haveKeys = grid ? [...grid.children].map((c) => c.dataset.card) : [];
      if (!grid || haveKeys.join() !== keys.join()) {
        cardEls.clear();
        render(cardsEl, html`<div class="ql-grid">${keys.map((k) => html`<button type="button" class="ql" data-card="${k}"></button>`)}</div>`);
        for (const el of cardsEl.querySelectorAll('.ql')) cardEls.set(el.dataset.card, { el, sig: '', valSig: '', fill: null });
        fresh = false; // a rebuilt grid has nothing to cross-fade from
      }
      for (const m of models) {
        const slot = cardEls.get(m.key);
        if (!slot) continue;
        slot.model = m;
        const sig = cardSig(m);
        if (sig === slot.sig) continue;
        const el = slot.el;
        const prevVal = slot.valSig;
        const prevFill = slot.fill;
        slot.sig = sig;
        slot.valSig = m.stale ? '—' : m.value.sig;
        el.className = `ql cat-${m.cat}${m.live ? ' is-live' : ''}${el.classList.contains('is-sheet-origin') ? ' is-sheet-origin' : ''}`;
        el.setAttribute('aria-label', m.aria);
        render(el, cardInner(m));
        fitTop(el);
        fitSub(el, m);
        const bar = el.querySelector('.goal-bar > i');
        if (bar && m.goal) {
          // Animate the fill only when its value changes (motion #14).
          if (prevFill !== null && prevFill !== m.goal.fill) {
            bar.style.setProperty('--fill', prevFill);
            bar.getBoundingClientRect();
          }
          bar.style.setProperty('--fill', m.goal.fill);
          slot.fill = m.goal.fill;
        } else {
          slot.fill = null;
        }
        // A store change (not a minute tick) cross-fades the value (#9).
        if (fresh && prevVal && prevVal !== slot.valSig) {
          const v = el.querySelector('.ql-val');
          if (v) v.classList.add('is-fresh');
        }
      }
    }

    // ------------------------------------------------------- notes (backup nudge / install hint)
    function paintNotes() {
      const name = babyName();
      if (nudgeState.backup) {
        const never = ctx.settings.get('lastBackupAt') === null;
        if (notesEl.querySelector('[data-note="backup"]')) return;
        render(notesEl, html`<section class="note-card" data-note="backup" aria-label="Backup reminder">
          <span class="chip-ic cat-accent">${I('shield', 22)}</span>
          <div class="note-main">
            <p class="note-title">Keep a copy safe</p>
            <p class="note-text">${never ? '' : 'It’s been a week. '}${F.possessive(name)} log lives only on this phone.</p>
          </div>
          <div class="note-actions is-wide">
            <button type="button" class="btn btn-secondary btn-sm" data-action="backup">${I('share', 20)}<span>Save a backup<span class="note-files"> to Files</span></span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="snooze-backup">Not now</button>
          </div>
        </section>`);
        return;
      }
      if (nudgeState.install) {
        if (notesEl.querySelector('[data-note="install"]')) return;
        const ios = isIOS();
        render(notesEl, html`<section class="note-card" data-note="install" aria-label="Install tip">
          <span class="chip-ic cat-accent">${I('phone', 22)}</span>
          <div class="note-main">
            <p class="note-title">Keep this log for good</p>
            <p class="note-text">${ios
              ? `Add Nurture to your Home Screen so iPhone never clears ${F.possessive(name)} log. Tap Share, then Add to Home Screen.`
              : `Install Nurture from your browser’s menu so it never clears ${F.possessive(name)} log.`}</p>
            <div class="note-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-action="dismiss-install">Got it</button>
            </div>
          </div>
        </section>`);
        return;
      }
      collapseNote();
    }
    function collapseNote() {
      const card = notesEl.querySelector('.note-card');
      if (!card || card.classList.contains('is-leaving')) return;
      if (ctx.motionReduced()) { card.remove(); return; }
      card.style.setProperty('--note-h', `${card.offsetHeight}px`);
      card.getBoundingClientRect();
      card.classList.add('is-leaving');
      const done = () => card.remove();
      card.addEventListener('transitionend', (e) => { if (e.target === card && e.propertyName === 'max-height') done(); });
      setTimeout(done, 450);
    }
    async function checkNotes() {
      let backup = false;
      let install = false;
      try {
        const snoozed = Number(lsGet(LS_NUDGE)) || 0;
        backup = Date.now() - snoozed >= NUDGE_SNOOZE_MS && await ctx.persist.isBackupDue();
        if (!backup && !isStandalone() && lsGet(LS_INSTALL) !== '1') {
          const since = await ctx.persist.dataSince();
          install = Number.isFinite(since) && Date.now() - since >= INSTALL_AFTER_MS;
        }
      } catch (err) { console.warn('backup check failed', err); }
      if (stopped) return;
      nudgeState = { backup, install };
      paintNotes();
    }
    async function saveBackup(btn) {
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      try {
        const result = await ctx.backup.share();
        if (result !== 'cancelled') {
          nudgeState.backup = false;
          paintNotes();
          ctx.toast({ message: result === 'share' ? 'Backup saved' : 'Backup downloaded' });
        }
      } catch (err) {
        console.error('backup failed', err);
        ctx.toast({ message: 'That didn’t work. Try again.', tone: 'warn' });
      } finally {
        if (btn.isConnected) btn.removeAttribute('aria-busy');
      }
    }

    // ------------------------------------------------------- list
    function rowModel(e, now) {
      const u = unit();
      const cat = F.categoryOf(e);
      const live = e.endTime === null;
      const cp = F.clockParts(e.startTime);
      let trail = '';
      const amt = F.eventAmount(e, u);
      if (live) trail = html`<span class="badge"><span class="dot"></span>Now</span>`;
      else if (amt && !amt.missing) trail = html`<span class="amt">${amt.value} <small>${amt.unit}</small></span>`;
      else if (e.type === 'diaper') trail = html`<span class="row-glyph">${I(ctx.icons.diaperGlyph(e.data && e.data.kind), 18)}</span>`;
      const notToday = e.startTime < data.dayStart;
      const tpl = html`<button type="button" class="row cat-${cat}" data-event-id="${e.id}" aria-label="${F.eventLabel(e, { now, displayUnit: u })}${notToday ? ' Started yesterday.' : ''}">
        <span class="row-time">${cp.time}<small>${cp.meridiem}</small></span>
        <span class="chip-ic${live ? ' ring-live' : ''}">${I(ctx.icons.categoryIcon(e), 22)}</span>
        <span class="row-main"><b class="row-title">${F.eventTitle(e)}</b><small class="row-meta">${F.eventSubtitle(e, { now })}</small></span>
        ${trail}
      </button>`;
      return { id: e.id, tpl, sig: String(tpl) };
    }

    function emptyListTpl() {
      const t = trackers();
      const words = [
        (t.bottle !== false || t.breastfeeding !== false) && 'feeds',
        t.sleep !== false && 'naps',
        t.diaper !== false && 'diapers',
        t.pump !== false && 'pumps',
      ].filter(Boolean);
      const listWords = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] || 'entries');
      const name = babyName();
      if (!data.hasAny) {
        return html`<div class="empty-state cat-accent" data-empty="new">
          <span class="empty-disc">${I('spark', 30)}</span>
          <h2 class="empty-title">${`A fresh page for ${name}`}</h2>
          <p class="empty-text">${`Tap a card or + to log the first one. Today’s ${listWords} will line up here, newest first.`}</p>
          <button type="button" class="btn btn-primary" data-action="first-log">${I('plus', 22)}Log the first one</button>
        </div>`;
      }
      return html`<div class="empty-state cat-neutral" data-empty="today">
        <span class="empty-disc">${I('timeline', 30)}</span>
        <h2 class="empty-title">Nothing logged yet today</h2>
        <p class="empty-text">${`Today’s ${listWords} will line up here, newest first.`}</p>
      </div>`;
    }

    function paintList(now, { animate = false } = {}) {
      if (!data) return;
      const rows = data.list.map((e) => rowModel(e, now));
      let ul = listEl.querySelector('ul.list');
      if (!rows.length) {
        rowEls.clear();
        const want = data.hasAny ? 'today' : 'new';
        const cur = listEl.querySelector('[data-empty]');
        if (!cur || cur.dataset.empty !== want || cur.textContent !== element(emptyListTpl()).textContent) render(listEl, emptyListTpl());
        listReady = true;
        return;
      }
      if (!ul) {
        render(listEl, html`<ul class="list" aria-label="Today, newest first"></ul>`);
        ul = listEl.querySelector('ul.list');
        rowEls.clear();
      }
      const wanted = new Set(rows.map((r) => r.id));
      // Removed rows collapse (#9 delete), then go.
      for (const [id, slot] of [...rowEls]) {
        if (wanted.has(id)) continue;
        rowEls.delete(id);
        removeRow(slot.li, animate && listReady);
      }
      let prev = null;
      for (const r of rows) {
        let slot = rowEls.get(r.id);
        if (!slot) {
          const li = element(html`<li>${r.tpl}</li>`);
          slot = { li, sig: r.sig };
          rowEls.set(r.id, slot);
          insertAfter(ul, li, prev);
          if (animate && listReady) markNew(li);
        } else {
          if (slot.sig !== r.sig) {
            const hadFocus = slot.li.contains(document.activeElement);
            const wasOrigin = slot.li.querySelector('.is-sheet-origin');
            slot.sig = r.sig;
            render(slot.li, r.tpl);
            if (wasOrigin) slot.li.firstElementChild.classList.add('is-sheet-origin');
            if (hadFocus) slot.li.firstElementChild.focus({ preventScroll: true });
          }
          const expected = prev ? nextLive(prev) : firstLive(ul);
          if (expected !== slot.li) insertAfter(ul, slot.li, prev);
        }
        prev = slot.li;
      }
      listReady = true;
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
        const b = li.firstElementChild;
        if (b) b.classList.remove('is-new');
      }, NEW_ROW_MS);
      newRowTimers.add(t);
    }
    function removeRow(li, animate) {
      if (li.contains(document.activeElement)) {
        const next = nextLive(li) || li.previousElementSibling;
        const target = next && next.firstElementChild;
        if (target) target.focus({ preventScroll: true }); else root.focus({ preventScroll: true });
      }
      if (!animate || ctx.motionReduced()) { li.remove(); return; }
      li.style.setProperty('max-height', `${li.offsetHeight}px`);
      li.getBoundingClientRect();
      li.classList.add('is-removing');
      const done = () => li.remove();
      li.addEventListener('transitionend', (e) => { if (e.target === li && e.propertyName === 'max-height') done(); });
      setTimeout(done, 400);
    }

    // ------------------------------------------------------- refresh + ticking
    async function refresh({ animate = true } = {}) {
      const next = await load().catch((err) => { console.error('Today: load failed', err); return null; });
      if (!next || stopped) return;
      const sameScope = next.babyId === mountedBabyId && next.dayKey === mountedDayKey;
      if (!sameScope) { listReady = false; rowEls.clear(); render(listEl, null); }
      mountedBabyId = next.babyId;
      mountedDayKey = next.dayKey;
      data = next;
      const now = Date.now();
      paintCards(now, { fresh: animate && sameScope });
      paintList(now, { animate: animate && sameScope });
      scheduleTick();
    }

    /** Store changes under an open sheet wait until it has closed (#9). */
    function onStoreChange({ animate = true } = {}) {
      if (document.documentElement.classList.contains('has-sheet')) {
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
    const sheetWatch = new MutationObserver(() => {
      if (dirty && !document.documentElement.classList.contains('has-sheet')) {
        dirty = false;
        const a = dirtyAnimate;
        dirtyAnimate = true;
        queueRefresh(a);
      }
    });
    sheetWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    function scheduleTick() {
      clearTimeout(tickTimer);
      if (stopped || document.hidden || !data) return;
      const now = Date.now();
      // Wake when the soonest-turning card numeral turns its next minute
      // (each counts from its own anchor), or at midnight; at most 60 s.
      let delay = 60000;
      for (const slot of cardEls.values()) {
        const a = slot.model && slot.model.anchor;
        if (Number.isFinite(a)) delay = Math.min(delay, 60000 - (((now - a) % 60000) + 60000) % 60000);
      }
      delay = Math.min(delay, ctx.time.dayBounds(now).end - now);
      tickTimer = setTimeout(onTick, Math.max(250, delay + 40));
    }
    function onTick() {
      if (stopped || document.hidden) return;
      const now = Date.now();
      if (data && dayKeyOf(now) !== mountedDayKey) {
        paintMasthead();
        refresh({ animate: false });
        return;
      }
      paintCards(now);
      paintList(now);
      scheduleTick();
    }
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(tickTimer); return; }
      paintMasthead();
      refresh({ animate: false });
      checkNotes();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // A rotation / resize changes how much fits on a card's top row and first
    // sub-line: re-fit them (fitTop, fitSub) from the full text.
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (stopped || !data) return;
        for (const slot of cardEls.values()) slot.sig = '';
        paintCards(Date.now());
      }, 150);
    };
    window.addEventListener('resize', onResize);

    // ------------------------------------------------------- actions
    function openCard(card) {
      const slot = cardEls.get(card.dataset.card);
      const m = slot && slot.model;
      if (!m || !m.tap) return;
      const tap = m.tap;
      if (tap.kind === 'wake') { wake(tap.event); return; }
      const open = ctx.sheets[tap.sheet];
      if (typeof open !== 'function') return;
      if (tap.kind === 'resume') open({ origin: card, resume: tap.event });
      else open({ origin: card, ...(tap.preset ? { preset: tap.preset } : {}) });
    }

    async function wake(event) {
      if (waking) return;
      waking = true;
      try {
        await ctx.events.stop(event.id);
        ctx.toast({
          message: 'Wake-up logged',
          action: { label: 'Undo', run: () => ctx.events.update(event.id, { endTime: null }) },
        });
      } catch (err) {
        console.error('wake-up failed', err);
        ctx.toast({ message: ctx.format.saveError(err), tone: 'warn' });
      } finally {
        waking = false;
      }
    }

    function openBabySwitcher(origin) {
      const list = ctx.settings.babies() || [];
      const activeId = (baby() || {}).id;
      ctx.openSheet({
        title: 'Who are you logging for?',
        origin,
        className: 'sheet-babies',
        render(body, api) {
          render(body, html`<ul class="list no-time">${list.map((b) => {
            const name = F.babyName(b);
            const age = F.babyAge(b.birthDate);
            const on = b.id === activeId;
            return html`<li><button type="button" class="row baby-row" data-baby="${b.id}" aria-pressed="${on ? 'true' : 'false'}">
              <span class="avatar avatar-sm avatar-fallback" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>
              <span class="row-main"><b class="row-title">${name}</b>${age ? html`<small class="row-meta">${age}</small>` : ''}</span>
              ${on ? html`<span class="baby-check">${I('check', 22)}</span>` : ''}
            </button></li>`;
          })}</ul>`);
          const onPick = async (e) => {
            const b = e.target.closest('[data-baby]');
            if (!b) return;
            const id = b.dataset.baby;
            if (id !== activeId) {
              try { await ctx.settings.setActiveBaby(id); } catch (err) { console.error('switch baby failed', err); }
            }
            api.close();
          };
          body.addEventListener('click', onPick);
          return () => body.removeEventListener('click', onPick);
        },
      });
    }

    const onClick = (e) => {
      const card = e.target.closest('.ql[data-card]');
      if (card && root.contains(card)) { openCard(card); return; }
      const row = e.target.closest('.row[data-event-id]');
      if (row && listEl.contains(row)) {
        const ev = data && data.list.find((x) => x.id === row.dataset.eventId);
        ctx.sheets.event({ origin: row, id: row.dataset.eventId, event: ev });
        return;
      }
      const b = e.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      switch (b.dataset.action) {
        case 'settings': ctx.router.push('settings'); break;
        case 'customize': ctx.router.push('settings', { page: 'customize' }); break;
        case 'timeline': ctx.router.go('timeline'); break;
        case 'switch-baby': openBabySwitcher(b); break;
        case 'first-log': ctx.sheets.quickLog({ origin: b }); break;
        case 'backup': saveBackup(b); break;
        case 'snooze-backup':
          lsSet(LS_NUDGE, String(Date.now()));
          nudgeState.backup = false;
          paintNotes();
          break;
        case 'dismiss-install':
          lsSet(LS_INSTALL, '1');
          nudgeState.install = false;
          paintNotes();
          break;
        default: break;
      }
    };
    root.addEventListener('click', onClick);
    // The value cross-fade class is one-shot.
    const onAnimEnd = (e) => { if (e.target.classList && e.target.classList.contains('is-fresh')) e.target.classList.remove('is-fresh'); };
    root.addEventListener('animationend', onAnimEnd);

    // ------------------------------------------------------- subscriptions
    const offEvents = ctx.events.subscribe((c) => {
      if (!c) return;
      onStoreChange({ animate: c.op !== 'bulk' });
      if (c.op === 'add' || c.op === 'bulk') checkNotes();
    });
    const offStash = ctx.stash.subscribe(() => { if (trackers().stash !== false) onStoreChange({ animate: true }); });
    const offSettings = ctx.settings.subscribe((c) => {
      const key = c && c.key;
      if (['*', 'babies', 'activeBabyId'].includes(key)) { paintMasthead(); refresh({ animate: false }); }
      else if (['trackers', 'todayOrder', 'units', 'pumpGoalOz', 'storageWindows'].includes(key)) refresh({ animate: false });
      if (['*', 'lastBackupAt'].includes(key)) checkNotes();
    });
    const offPhotos = ctx.photos.subscribe ? ctx.photos.subscribe(() => { avatarFor = null; paintMasthead(); }) : () => {};

    // ------------------------------------------------------- first paint
    paintMasthead();
    refresh({ animate: false });
    checkNotes();

    return {
      unmount() {
        stopped = true;
        clearTimeout(tickTimer);
        for (const t of newRowTimers) clearTimeout(t);
        newRowTimers.clear();
        sheetWatch.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('resize', onResize);
        clearTimeout(resizeTimer);
        root.removeEventListener('click', onClick);
        root.removeEventListener('animationend', onAnimEnd);
        offEvents();
        offStash();
        offSettings();
        offPhotos();
      },
    };
  },
};

// Exported for unit tests (pure).
export const _test = Object.freeze({ visibleCards, eventVisible });
