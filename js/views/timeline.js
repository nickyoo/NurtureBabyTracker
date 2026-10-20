// Timeline (DESIGN §6.8 DayPager / StatTile / TimelineStrip, §13 Frame 4;
// motion contract #9, #12, #20; ARCHITECTURE §5.2, §10c).
//
//  - Day pager: eyebrow "TIMELINE", the day's title ("Today" / "Yesterday" /
//    "Mon, Oct 12"), its full date, ‹ › round buttons (› is aria-disabled on
//    today) and a 7-day week row (role="tablist", roving focus, arrow keys).
//    Swiping the day's content sideways pages too. Paging slides the content
//    ±--move-lg with a cross-fade; the selected-day ring moves over --dur-fast.
//  - Summary tiles for the VISIBLE trackers only (fed / slept / diapers /
//    pumped). Tapping one filters the day's list to that category; tapping
//    it again (or "Show all") clears the filter.
//  - 24h activity strip: one lane per visible tracker, the night band
//    (7 PM – 7 AM), hatched future, a now-line on today, and marks whose SHAPE
//    carries the meaning (night sleep solid vs nap outline, bottle tick vs
//    hollow breastfeed tick, wet ring / dirty dot / both, pump diamond) plus a
//    legend. role="img" with a sentence summary; the list is its accessible
//    equivalent. Tapping a mark scrolls its row into view and opens the entry
//    sheet from that row; when the sheet closes the row gets the tint wash.
//  - "The day": every entry, newest first (ListRow → entry sheet). New rows
//    slide in where they land once the sheet that made them has closed;
//    deleted rows collapse.
//  - "Report for the pediatrician" → router.push('report').
//
// Only store subscriptions drive re-renders (views never call each other).

import { dayTotals } from '../domain/trends.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_ROW_MS = 1500;          // > --dur-highlight (1200 ms)
const SWIPE_MIN_PX = 56;
const NIGHT_FROM_HOUR = 19;       // the strip's shaded band: 7 PM – 7 AM (DESIGN §6.8)
const NIGHT_TO_HOUR = 7;
const UNIT_SPOKEN = Object.freeze({ oz: ['ounce', 'ounces'], mL: ['milliliter', 'milliliters'] });

// Strip geometry: the gallery's 322-wide viewBox, 22-tall lanes 28 apart.
const VB_W = 322;
const X0 = 30;
const PLOT_W = 288;
const LANE_H = 22;
const LANE_GAP = 28;
const LANE_TOP = 6;
const LANES = Object.freeze([
  { key: 'sleep', icon: 'moon', word: 'Sleep' },
  { key: 'feed', icon: 'bottle', word: 'Feeds' },
  { key: 'diaper', icon: 'diaper', word: 'Diapers' },
  { key: 'pump', icon: 'pump', word: 'Pumps' },
]);

let mountSeq = 0;

// ----------------------------------------------------------------- pure

/** Is this event's tracker visible? (Hidden trackers disappear everywhere.) */
function eventVisible(e, t) {
  switch (e && e.type) {
    case 'feed': return e.data && e.data.method === 'breast' ? t.breastfeeding !== false : t.bottle !== false;
    case 'pump': return t.pump !== false;
    case 'sleep': return t.sleep !== false;
    case 'diaper': return t.diaper !== false;
    case 'milestone': return t.memories !== false;
    default: return false;
  }
}

/** Which strip lanes / stat tiles show for these trackers, in lane order. */
function visibleLanes(t) {
  const on = {
    sleep: t.sleep !== false,
    feed: t.bottle !== false || t.breastfeeding !== false,
    diaper: t.diaper !== false,
    pump: t.pump !== false,
  };
  return LANES.filter((l) => on[l.key]);
}

/**
 * The 7 day-starts the week row shows for a selected day: weeks are paged
 * back from today, so today is always the last cell of the first page and a
 * future day is never offered.
 * @param {number} selectedStart local midnight of the selected day
 * @param {number} todayStart local midnight of today
 * @param {(ts: number, days: number) => number} addDays DST-safe day shift
 * @param {(ts: number) => number} startOf local midnight of a timestamp
 * @returns {number[]} oldest → newest
 */
function weekWindow(selectedStart, todayStart, addDays, startOf) {
  let end = todayStart;
  // How many whole weeks back is the selection?
  let guard = 0;
  while (selectedStart < startOf(addDays(end, -6)) && guard < 1000) { end = startOf(addDays(end, -7)); guard += 1; }
  const out = [];
  for (let i = 6; i >= 0; i -= 1) out.push(startOf(addDays(end, -i)));
  return out;
}

/** Vertical geometry of a strip with `n` lanes (n = 4 → the 140-tall frame). */
function stripGeometry(n) {
  const lanesBottom = LANE_TOP + Math.max(0, n - 1) * LANE_GAP + LANE_H;
  return { height: lanesBottom + 28, nowY2: lanesBottom + 4, axisY: lanesBottom + 22, laneY: (i) => LANE_TOP + i * LANE_GAP };
}

/**
 * Everything the 24h strip draws for one day (pure; unit-tested).
 * @param {object[]} events the day's (visible) events, incl. sleeps that overlap it
 * @param {{ dayStart: number, dayEnd: number, now: number, lanes: Array<{key: string}> }} o
 * @returns {{ marks: object[], nowX: number|null, x: (t: number) => number }}
 */
function stripMarks(events, { dayStart, dayEnd, now, lanes }) {
  const span = Math.max(1, dayEnd - dayStart);
  const x = (t) => X0 + (PLOT_W * (Math.min(dayEnd, Math.max(dayStart, t)) - dayStart)) / span;
  const laneIdx = new Map(lanes.map((l, i) => [l.key, i]));
  const marks = [];
  for (const e of events || []) {
    const cat = e.type;
    if (!laneIdx.has(cat)) continue;
    const lane = laneIdx.get(cat);
    const d = e.data || {};
    if (cat === 'sleep') {
      const end = e.endTime === null ? Math.max(e.startTime, now) : e.endTime;
      if (end <= dayStart || e.startTime >= dayEnd) continue;
      const night = d.kind === 'night';
      const x1 = x(e.startTime);
      let x2 = x(end);
      const minW = night ? 3 : 8;
      if (x2 - x1 < minW) x2 = Math.min(X0 + PLOT_W, x1 + minW);
      marks.push({ id: e.id, lane, shape: night ? 'night' : 'nap', x1, x2, cx: (x1 + x2) / 2, running: e.endTime === null });
      continue;
    }
    if (e.startTime < dayStart || e.startTime >= dayEnd) continue;
    const cx = x(e.startTime);
    let shape = cat;
    if (cat === 'feed') shape = d.method === 'breast' ? 'breast' : 'bottle';
    else if (cat === 'diaper') shape = ['wet', 'dirty', 'both', 'dry'].includes(d.kind) ? d.kind : 'wet';
    marks.push({ id: e.id, lane, shape, x1: cx, x2: cx, cx, running: e.endTime === null });
  }
  const nowX = now >= dayStart && now < dayEnd ? x(now) : null;
  return { marks, nowX, x };
}

/**
 * The mark nearest an svg-space point, within `tol` units of it (pure).
 * @param {object[]} marks from stripMarks
 * @param {number} sx
 * @param {number} lane
 * @param {number} [tol]
 * @returns {object|null}
 */
function hitMark(marks, sx, lane, tol = 10) {
  let best = null;
  let bestD = Infinity;
  for (const m of marks) {
    if (m.lane !== lane) continue;
    const d = sx < m.x1 ? m.x1 - sx : sx > m.x2 ? sx - m.x2 : 0;
    if (d <= tol && d < bestD) { best = m; bestD = d; }
  }
  return best;
}

/** Axis + band wording for 12h / 24h locales. */
function hourWords(hour12) {
  return hour12
    ? { axis: ['12a', '6a', '12p', '6p', '12a'], band: '7 PM – 7 AM' }
    : { axis: ['0', '6', '12', '18', '24'], band: '19:00 – 07:00' };
}

// ----------------------------------------------------------------- view

export default {
  id: 'timeline',
  title: 'Timeline',
  /**
   * @param {HTMLElement} root the view's scrolling <section>
   * @param {object} ctx app ctx (ARCHITECTURE §5.2)
   * @param {{ day?: number }} [params] open on a given day
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx, params = {}) {
    const { html, render, element } = ctx.html;
    const { iconHtml } = ctx.icons;
    const F = ctx.format;
    const T = ctx.time;
    const I = (name, size) => iconHtml(name, { size });
    const pid = `tl${(mountSeq += 1)}`;

    const trackers = () => ctx.settings.get('trackers') || {};
    const unit = () => (ctx.settings.get('units') === 'mL' ? 'mL' : 'oz');
    const baby = () => ctx.settings.activeBaby();
    const babyName = () => F.babyName(baby());
    const startOf = (ts) => T.dayBounds(ts).start;
    const todayStart = () => startOf(Date.now());

    // ------------------------------------------------------------ state
    const want = Number(params && params.day);
    let selected = Number.isFinite(want) ? Math.min(startOf(want), todayStart()) : todayStart();
    let followToday = selected === todayStart(); // keep showing "today" across midnight
    let filter = null;          // 'feed' | 'sleep' | 'diaper' | 'pump' | null
    let data = null;            // the painted day's data
    let loadSeq = 0;
    let stopped = false;
    let dirty = false;
    let dirtyAnimate = true;
    let tickTimer = 0;
    let listReady = false;
    let pendingDir = 0;         // slide direction for the next content swap
    const rowEls = new Map();   // id → { li, sig }
    const timers = new Set();

    // ------------------------------------------------------------ skeleton
    render(root, html`<div class="view-pad tl">
      <header class="page-hd tl-hd" data-part="hd"></header>
      <p class="sr-only" aria-live="polite" data-part="announce"></p>
      <div class="days" role="tablist" aria-label="Pick a day" data-part="days"></div>
      <div class="tl-day" role="tabpanel" data-part="day">
        <div class="tl-stats" data-part="stats"></div>
        <div data-part="strip"></div>
        <div class="sec-hd" data-part="sec-hd"><h2 class="sec-title">The day</h2><span class="sec-meta" data-part="meta"></span></div>
        <div class="tl-list" data-part="list"></div>
      </div>
      <ul class="set-list tl-report" aria-label="More">
        <li><button type="button" class="set-row" data-action="report">
          <span class="chip-ic cat-accent">${I('report', 20)}</span>
          <span class="set-text"><b>Report for the pediatrician</b><small>Last 7 or 14 days · print or share</small></span>
          <span class="chev">${I('chev-r', 20)}</span>
        </button></li>
      </ul>
    </div>`);
    const part = (n) => root.querySelector(`[data-part="${n}"]`);
    const hdEl = part('hd');
    const daysEl = part('days');
    const dayEl = part('day');
    const statsEl = part('stats');
    const stripEl = part('strip');
    const secEl = part('sec-hd');
    const metaEl = part('meta');
    const listEl = part('list');
    const announceEl = part('announce');
    dayEl.id = `${pid}-day`;

    // ------------------------------------------------------------ header + week row
    function titleFor(dayStart) {
      return F.dayLabel(dayStart, Date.now());
    }
    function longDate(dayStart) {
      const d = new Date(dayStart);
      const sameYear = d.getFullYear() === new Date().getFullYear();
      return d.toLocaleDateString(undefined, sameYear
        ? { weekday: 'long', month: 'long', day: 'numeric' }
        : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }

    function paintHeader() {
      const isToday = selected === todayStart();
      const multi = (ctx.settings.babies() || []).length > 1;
      const title = titleFor(selected);
      const sig = `${selected}|${isToday}|${multi ? babyName() : ''}|${title}`;
      if (hdEl.dataset.sig === sig) return;
      hdEl.dataset.sig = sig;
      const hadFocus = hdEl.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      render(hdEl, html`
        <div class="tl-hd-text">
          <p class="eyebrow">${multi ? `Timeline · ${babyName()}` : 'Timeline'}</p>
          <h1 class="page-title">${title}</h1>
          <p class="page-sub">${longDate(selected)}</p>
        </div>
        <div class="hd-actions">
          <button type="button" class="btn-round" data-action="prev" aria-label="Previous day" aria-controls="${dayEl.id}">${I('chev-l', 24)}</button>
          <button type="button" class="btn-round" data-action="next" aria-label="Next day" aria-controls="${dayEl.id}" aria-disabled="${isToday ? 'true' : 'false'}">${I('chev-r', 24)}</button>
        </div>`);
      dayEl.setAttribute('aria-label', `${title}, ${longDate(selected)}`);
      if (hadFocus) {
        const b = hdEl.querySelector(`[data-action="${hadFocus}"]`);
        if (b) b.focus({ preventScroll: true });
      }
    }

    function paintDays() {
      const today = todayStart();
      const week = weekWindow(selected, today, T.addDays, startOf);
      const focusedDay = daysEl.contains(document.activeElement);
      const cells = week.map((d) => {
        const dt = new Date(d);
        const isSel = d === selected;
        const short = dt.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
        return html`<button type="button" class="day" role="tab" data-day="${d}" aria-controls="${dayEl.id}"
            aria-selected="${isSel ? 'true' : 'false'}" tabindex="${isSel ? '0' : '-1'}"
            aria-label="${`${d === today ? 'Today, ' : ''}${longDate(d)}`}">
          <small aria-hidden="true">${short}</small><b aria-hidden="true">${dt.getDate()}</b>${d === today ? html`<span class="today-dot" aria-hidden="true"></span>` : ''}
        </button>`;
      });
      // Same week → move the ring (aria-selected) in place so it transitions.
      const sig = `${week.join()}|${today}`;
      if (daysEl.dataset.sig === sig) {
        for (const b of daysEl.querySelectorAll('.day')) {
          const on = Number(b.dataset.day) === selected;
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.tabIndex = on ? 0 : -1;
        }
      } else {
        daysEl.dataset.sig = sig;
        render(daysEl, cells);
      }
      if (focusedDay) {
        const cur = daysEl.querySelector(`[data-day="${selected}"]`);
        if (cur) cur.focus({ preventScroll: true });
      }
    }

    // ------------------------------------------------------------ data
    async function load(dayStart) {
      const seq = (loadSeq += 1);
      const now = Date.now();
      const { end: dayEnd } = T.dayBounds(dayStart);
      const b = baby();
      const babyId = b ? b.id : undefined;
      const t = trackers();
      const [windowed, running] = await Promise.all([
        ctx.events.query({ from: dayStart - 2 * DAY_MS, to: dayEnd, babyId }),
        ctx.events.running(undefined, { babyId }),
      ]);
      if (seq !== loadSeq || stopped) return null;
      const byId = new Map();
      for (const e of [...windowed, ...running]) byId.set(e.id, e);
      const overlapping = [...byId.values()].filter((e) => {
        if (!eventVisible(e, t)) return false;
        if (e.startTime >= dayStart && e.startTime < dayEnd) return true;
        if (e.startTime >= dayEnd) return false;
        // Began earlier: a sleep that runs into this day, or anything still running.
        const end = e.endTime === null ? now : e.endTime;
        return end > dayStart && (e.type === 'sleep' || e.endTime === null);
      }).sort((a, c) => c.startTime - a.startTime || (c.createdAt || 0) - (a.createdAt || 0));
      return { dayStart, dayEnd, now, babyId, events: overlapping, dayKey: T.dayKey(dayStart) };
    }

    // ------------------------------------------------------------ stats
    const spokenAmt = (value, u) => `${value} ${UNIT_SPOKEN[u][Number(value) === 1 ? 0 : 1]}`;

    function statModels(d) {
      const t = trackers();
      const u = unit();
      const tot = dayTotals(d.events, d.dayStart, { unit: u, now: Math.min(Date.now(), d.dayEnd) });
      // Tiles read feed → sleep → diapers → pumped (frame 4); lanes start with sleep.
      const order = ['feed', 'sleep', 'diaper', 'pump'];
      const lanes = visibleLanes(t).slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      return lanes.map(({ key }) => {
        switch (key) {
          case 'feed': {
            const n = tot.feed.count;
            const showAmount = t.bottle !== false && (tot.feed.bottleCount > 0 || t.breastfeeding === false);
            const label = F.plural(n, 'feed');
            return showAmount
              ? { key, icon: t.bottle === false ? 'breast' : 'bottle', value: html`${String(tot.feed.amount)} <small>${u}</small>`, label, aria: `${spokenAmt(tot.feed.amount, u)} from ${label}` }
              : { key, icon: t.bottle === false ? 'breast' : 'bottle', value: html`${String(n)}`, label: n === 1 ? 'feed' : 'feeds', aria: label };
          }
          case 'sleep': {
            const ms = tot.sleep.totalMs;
            const v = ms < 60 * 1000 ? '0m' : F.span(ms);
            return { key, icon: 'moon', value: html`${v}`, label: 'slept', aria: `slept ${ms < 60 * 1000 ? 'no time yet' : F.spanSpoken(ms)}` };
          }
          case 'diaper': {
            const n = tot.diaper.count;
            return { key, icon: 'diaper', value: html`${String(n)}`, label: n === 1 ? 'diaper' : 'diapers', aria: F.plural(n, 'diaper') };
          }
          case 'pump':
          default:
            return { key, icon: 'pump', value: html`${String(tot.pump.amount)} <small>${u}</small>`, label: 'pumped', aria: `${spokenAmt(tot.pump.amount, u)} pumped` };
        }
      });
    }

    function paintStats(d) {
      const models = statModels(d);
      if (filter && !models.some((m) => m.key === filter)) filter = null;
      if (!models.length) { render(statsEl, null); return; }
      const focused = statsEl.contains(document.activeElement) ? document.activeElement.dataset.stat : null;
      render(statsEl, html`<div class="stats" data-n="${models.length}">
        ${models.map((m) => html`<button type="button" class="stat cat-${m.key}" data-stat="${m.key}"
            aria-pressed="${filter === m.key ? 'true' : 'false'}"
            aria-label="${`${m.aria}. ${filter === m.key ? 'Showing only these. Tap to show everything.' : 'Show only these.'}`}">
          ${I(m.icon, 20)}<b class="stat-val">${m.value}</b><small class="stat-lbl">${m.label}</small>
        </button>`)}
      </div>`);
      if (focused) {
        const b = statsEl.querySelector(`[data-stat="${focused}"]`);
        if (b) b.focus({ preventScroll: true });
      }
    }

    // ------------------------------------------------------------ strip
    let lastMarks = [];
    let lastLanes = [];

    function swatch(inner) {
      return html`<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">${inner}</svg>`;
    }

    function legendTpl(lanes, marks) {
      const t = trackers();
      const keys = new Set(lanes.map((l) => l.key));
      const items = [];
      if (keys.has('sleep')) {
        items.push(html`<span>${swatch(html`<rect x="1" y="2" width="16" height="8" rx="3" class="s-sleep"></rect>`)}Night sleep</span>`);
        items.push(html`<span>${swatch(html`<rect x="2" y="3" width="14" height="6" rx="2.5" class="s-nap"></rect>`)}Nap</span>`);
      }
      if (keys.has('feed') && t.bottle !== false) items.push(html`<span>${swatch(html`<rect x="7" y="0" width="4" height="12" rx="2" class="s-feed"></rect>`)}Bottle</span>`);
      if (keys.has('feed') && t.breastfeeding !== false) items.push(html`<span>${swatch(html`<rect x="6.5" y=".8" width="5" height="10.4" rx="2.5" class="s-bf"></rect>`)}Breast</span>`);
      if (keys.has('pump')) items.push(html`<span>${swatch(html`<rect x="5" y="2" width="8" height="8" rx="1.5" transform="rotate(45 9 6)" class="s-pump"></rect>`)}Pump</span>`);
      if (keys.has('diaper')) {
        items.push(html`<span>${swatch(html`<circle cx="9" cy="6" r="4.2" class="s-dia-ring"></circle>`)}Wet</span>`);
        items.push(html`<span>${swatch(html`<circle cx="9" cy="6" r="4.6" class="s-dia-dot"></circle>`)}Dirty</span>`);
        items.push(html`<span>${swatch(html`<circle cx="9" cy="6" r="5" class="s-dia-ring"></circle><circle cx="9" cy="6" r="2" class="s-dia-dot"></circle>`)}Both</span>`);
        if (marks.some((m) => m.shape === 'dry')) items.push(html`<span>${swatch(html`<circle cx="9" cy="6" r="4.2" class="s-dia-ring s-dia-dry"></circle>`)}Dry</span>`);
      }
      return html`<div class="legend" aria-hidden="true">${items}</div>`;
    }

    function stripSummary(d, marks, lanes) {
      const byId = new Map(d.events.map((e) => [e.id, e]));
      const keys = new Set(lanes.map((l) => l.key));
      const bits = [];
      if (keys.has('sleep')) {
        const sleeps = marks.filter((m) => m.shape === 'night' || m.shape === 'nap').map((m) => byId.get(m.id)).filter(Boolean)
          .sort((a, b) => a.startTime - b.startTime);
        const words = sleeps.slice(0, 4).map((e) => {
          const kind = e.data && e.data.kind === 'night' ? 'night sleep' : 'nap';
          return e.endTime === null ? `${kind} since ${F.clock(e.startTime)}` : `${kind} ${F.clock(e.startTime)} to ${F.clock(e.endTime)}`;
        });
        if (sleeps.length > 4) words.push(`${sleeps.length - 4} more sleeps`);
        bits.push(words.length ? words.join(', ') : 'no sleep');
      }
      const count = (cat) => marks.filter((m) => lanes[m.lane] && lanes[m.lane].key === cat).length;
      if (keys.has('feed')) bits.push(F.plural(count('feed'), 'feed'));
      if (keys.has('diaper')) bits.push(F.plural(count('diaper'), 'diaper'));
      if (keys.has('pump')) bits.push(F.plural(count('pump'), 'pump'));
      return `24 hours: ${bits.join(', ')}.`;
    }

    function paintStrip(d) {
      const lanes = visibleLanes(trackers());
      lastLanes = lanes;
      if (!lanes.length) { lastMarks = []; render(stripEl, null); return; }
      const { dayStart, dayEnd } = d;
      const now = Date.now();
      const geo = stripGeometry(lanes.length);
      const { marks, nowX, x } = stripMarks(d.events, { dayStart, dayEnd, now, lanes });
      lastMarks = marks;
      const hw = hourWords(T.prefers12h());
      const at = (h) => new Date(new Date(dayStart).getFullYear(), new Date(dayStart).getMonth(), new Date(dayStart).getDate(), h).getTime();
      const bandA = x(at(NIGHT_TO_HOUR));
      const bandB = x(at(NIGHT_FROM_HOUR));
      const end = X0 + PLOT_W;
      const futureFrom = dayEnd <= now ? null : (nowX === null ? X0 : nowX);
      const ly = (m) => geo.laneY(m.lane);
      const markTpl = (m) => {
        const y = ly(m);
        const id = m.id;
        switch (m.shape) {
          case 'night':
            return html`<rect x="${m.x1}" y="${y + 4}" width="${Math.max(1, m.x2 - m.x1)}" height="${LANE_H - 8}" rx="4" class="s-sleep s-mark" data-id="${id}"></rect>`;
          case 'nap':
            return html`<rect x="${m.x1 + 1}" y="${y + 5}" width="${Math.max(1, m.x2 - m.x1 - 2)}" height="${LANE_H - 10}" rx="3.5" class="s-nap s-mark" data-id="${id}"></rect>`;
          case 'bottle':
            return html`<rect x="${m.cx - 2}" y="${y + 3}" width="4" height="16" rx="2" class="s-feed s-mark" data-id="${id}"></rect>`;
          case 'breast':
            return html`<rect x="${m.cx - 2.5}" y="${y + 3.8}" width="5" height="14.4" rx="2.5" class="s-bf s-mark" data-id="${id}"></rect>`;
          case 'dirty':
            return html`<circle cx="${m.cx}" cy="${y + LANE_H / 2}" r="5" class="s-dia-dot s-mark" data-id="${id}"></circle>`;
          case 'both':
            return html`<g class="s-mark" data-id="${id}"><circle cx="${m.cx}" cy="${y + LANE_H / 2}" r="5" class="s-dia-ring"></circle><circle cx="${m.cx}" cy="${y + LANE_H / 2}" r="2" class="s-dia-dot"></circle></g>`;
          case 'dry':
            return html`<circle cx="${m.cx}" cy="${y + LANE_H / 2}" r="4.6" class="s-dia-ring s-dia-dry s-mark" data-id="${id}"></circle>`;
          case 'wet':
            return html`<circle cx="${m.cx}" cy="${y + LANE_H / 2}" r="4.6" class="s-dia-ring s-mark" data-id="${id}"></circle>`;
          case 'pump':
          default: {
            const cy = y + LANE_H / 2;
            return html`<rect x="${m.cx - 4.5}" y="${cy - 4.5}" width="9" height="9" rx="1.5" transform="rotate(45 ${m.cx} ${cy})" class="s-pump s-mark" data-id="${id}"></rect>`;
          }
        }
      };
      const axisAt = [0, 6, 12, 18].map((h) => x(at(h))).concat(end);
      render(stripEl, html`<section class="strip tl-strip" aria-label="24 hour activity">
        <div class="strip-hd"><b>24 hours</b><small>shaded = ${hw.band}</small></div>
        <svg width="${VB_W}" height="${geo.height}" viewBox="0 0 ${VB_W} ${geo.height}" role="img" aria-label="${stripSummary(d, marks, lanes)}">
          <defs>
            <pattern id="${pid}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="s-hatch"></line></pattern>
            ${lanes.map((l, i) => html`<clipPath id="${pid}-lane${i}"><rect x="${X0}" y="${geo.laneY(i)}" width="${PLOT_W}" height="${LANE_H}" rx="7"></rect></clipPath>`)}
          </defs>
          ${lanes.map((l, i) => {
            const y = geo.laneY(i);
            return html`<g class="s-icon" transform="translate(0 ${y + 1})">${I(l.icon, 20)}</g>
              <g clip-path="url(#${pid}-lane${i})">
                <rect x="${X0}" y="${y}" width="${PLOT_W}" height="${LANE_H}" class="s-track"></rect>
                <rect x="${X0}" y="${y}" width="${Math.max(0, bandA - X0)}" height="${LANE_H}" class="s-band"></rect>
                <rect x="${bandB}" y="${y}" width="${Math.max(0, end - bandB)}" height="${LANE_H}" class="s-band"></rect>
                ${futureFrom !== null ? html`<rect x="${futureFrom}" y="${y}" width="${Math.max(0, end - futureFrom)}" height="${LANE_H}" fill="url(#${pid}-hatch)"></rect>` : ''}
              </g>`;
          })}
          <g class="s-marks">${marks.map(markTpl)}</g>
          ${nowX !== null ? html`<line x1="${nowX}" y1="2" x2="${nowX}" y2="${geo.nowY2}" class="s-now"></line>` : ''}
          ${hw.axis.map((label, i) => html`<text x="${axisAt[i]}" y="${geo.axisY}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" class="s-axis">${label}</text>`)}
        </svg>
        ${legendTpl(lanes, marks)}
      </section>`);
    }

    // ------------------------------------------------------------ list
    function rowModel(e, now) {
      const u = unit();
      const cat = F.categoryOf(e);
      const live = e.endTime === null;
      const cp = F.clockParts(e.startTime);
      const amt = F.eventAmount(e, u);
      let trail = '';
      if (live) trail = html`<span class="badge"><span class="dot"></span>Now</span>`;
      else if (amt && !amt.missing) trail = html`<span class="amt">${amt.value} <small>${amt.unit}</small></span>`;
      else if (e.type === 'diaper') trail = html`<span class="row-glyph">${I(ctx.icons.diaperGlyph(e.data && e.data.kind), 18)}</span>`;
      const before = e.startTime < data.dayStart;
      const sub = F.eventSubtitle(e, { now });
      const meta = before ? `Began ${F.dateLabel(e.startTime, now).split(',')[0]} · ${sub}` : sub;
      const tpl = html`<button type="button" class="row cat-${cat}" data-event-id="${e.id}" aria-label="${`${F.eventLabel(e, { now, displayUnit: u })}${before ? ' Began the day before.' : ''}`}">
        <span class="row-time">${cp.time}<small>${cp.meridiem}</small></span>
        <span class="chip-ic${live ? ' ring-live' : ''}">${I(ctx.icons.categoryIcon(e), 22)}</span>
        <span class="row-main"><b class="row-title">${F.eventTitle(e)}</b><small class="row-meta">${meta}</small></span>
        ${trail}
      </button>`;
      return { id: e.id, tpl, sig: String(tpl) };
    }

    const catOfEvent = (e) => (e.type === 'milestone' ? 'mem' : e.type);

    function emptyTpl(d) {
      const isToday = d.dayStart === todayStart();
      const name = babyName();
      if (filter) {
        const words = { feed: 'feeds', sleep: 'sleep', diaper: 'diapers', pump: 'pumps' };
        return html`<div class="empty-state cat-${filter}" data-empty="filter">
          <span class="empty-disc">${I(LANES.find((l) => l.key === filter).icon, 30)}</span>
          <h2 class="empty-title">${`No ${words[filter]} this day`}</h2>
          <p class="empty-text">The rest of the day is still here.</p>
          <button type="button" class="btn btn-secondary" data-action="clear-filter">Show everything</button>
        </div>`;
      }
      if (!visibleLanes(trackers()).length && trackers().memories === false) {
        return html`<div class="empty-state cat-neutral" data-empty="trackers">
          <span class="empty-disc">${I('gear', 30)}</span>
          <h2 class="empty-title">Every tracker is hidden</h2>
          <p class="empty-text">Hidden trackers keep their data. Turn some back on to see them here.</p>
          <button type="button" class="btn btn-secondary" data-action="customize">Customize</button>
        </div>`;
      }
      if (isToday) {
        return html`<div class="empty-state cat-accent" data-empty="today">
          <span class="empty-disc">${I('timeline', 30)}</span>
          <h2 class="empty-title">Nothing logged yet today</h2>
          <p class="empty-text">${`Everything you log for ${name} today will line up here, newest first.`}</p>
          <button type="button" class="btn btn-primary" data-action="log">${I('plus', 22)}Log something</button>
        </div>`;
      }
      return html`<div class="empty-state cat-neutral" data-empty="day">
        <span class="empty-disc">${I('calendar', 30)}</span>
        <h2 class="empty-title">${`A quiet ${new Date(d.dayStart).toLocaleDateString(undefined, { weekday: 'long' })}`}</h2>
        <p class="empty-text">${`Nothing was logged for ${name} on ${F.dateLabel(d.dayStart)}.`}</p>
        <button type="button" class="btn btn-secondary" data-action="today">Back to today</button>
      </div>`;
    }

    function paintMeta(d, shown) {
      const total = d.events.length;
      if (filter) {
        render(metaEl, null);
        let link = secEl.querySelector('[data-action="clear-filter"]');
        if (!link) {
          link = element(html`<button type="button" class="link" data-action="clear-filter">Show all${I('chev-r', 18)}</button>`);
          secEl.appendChild(link);
        }
        metaEl.hidden = true;
        link.setAttribute('aria-label', `Showing ${shown} of ${F.plural(total, 'entry', 'entries')}. Show all`);
        return;
      }
      const link = secEl.querySelector('[data-action="clear-filter"]');
      if (link) {
        const hadFocus = link === document.activeElement;
        link.remove();
        if (hadFocus) {
          const first = statsEl.querySelector('[data-stat]');
          if (first) first.focus({ preventScroll: true }); else root.focus({ preventScroll: true });
        }
      }
      metaEl.hidden = false;
      render(metaEl, total ? `${F.plural(total, 'entry', 'entries')} · newest first` : '');
    }

    function paintList(d, { animate = false } = {}) {
      const now = Date.now();
      const shownEvents = filter ? d.events.filter((e) => catOfEvent(e) === filter) : d.events;
      paintMeta(d, shownEvents.length);
      const rows = shownEvents.map((e) => rowModel(e, now));
      let ul = listEl.querySelector('ul.list');
      if (!rows.length) {
        rowEls.clear();
        const tpl = emptyTpl(d);
        const cur = listEl.querySelector('[data-empty]');
        if (!cur || cur.textContent !== element(tpl).textContent) render(listEl, tpl);
        listReady = true;
        return;
      }
      if (!ul) {
        render(listEl, html`<ul class="list" aria-label="The day, newest first"></ul>`);
        ul = listEl.querySelector('ul.list');
        rowEls.clear();
      }
      const wanted = new Set(rows.map((r) => r.id));
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
          if (animate && listReady) markNew(li, { insert: true });
        } else {
          if (slot.sig !== r.sig) {
            const hadFocus = slot.li.contains(document.activeElement);
            const wasOrigin = slot.li.querySelector('.is-sheet-origin');
            const wasNew = slot.li.querySelector('.row.is-new');
            slot.sig = r.sig;
            render(slot.li, r.tpl);
            const btn = slot.li.firstElementChild;
            if (wasOrigin) btn.classList.add('is-sheet-origin');
            if (wasNew) btn.classList.add('is-new');
            if (hadFocus) btn.focus({ preventScroll: true });
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
    function markNew(li, { insert = false } = {}) {
      if (insert) li.classList.add('is-inserting');
      const btn = li.firstElementChild;
      if (btn) { btn.classList.remove('is-new'); void btn.offsetWidth; btn.classList.add('is-new'); }
      const t = setTimeout(() => {
        timers.delete(t);
        li.classList.remove('is-inserting');
        const b = li.firstElementChild;
        if (b) b.classList.remove('is-new');
      }, NEW_ROW_MS);
      timers.add(t);
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
      const t = setTimeout(done, 400);
      timers.add(t);
    }

    // ------------------------------------------------------------ painting
    function paintDay(d, { animate = false } = {}) {
      paintStats(d);
      paintStrip(d);
      paintList(d, { animate });
    }

    /** Slide the day's content in from the side it came from (#12). */
    function slideIn(dir) {
      if (!dir) return;
      dayEl.classList.remove('is-from-left', 'is-from-right');
      dayEl.classList.add(dir > 0 ? 'is-from-right' : 'is-from-left');
      dayEl.getBoundingClientRect();
      dayEl.classList.remove('is-from-left', 'is-from-right');
    }

    async function refresh({ animate = true } = {}) {
      const target = selected;
      const next = await load(target).catch((err) => { console.error('Timeline: load failed', err); return null; });
      if (!next || stopped || target !== selected) return;
      const sameScope = data && next.dayKey === data.dayKey && next.babyId === data.babyId;
      if (!sameScope) { listReady = false; rowEls.clear(); render(listEl, null); }
      data = next;
      const dir = pendingDir;
      pendingDir = 0;
      paintDay(data, { animate: animate && sameScope });
      if (!sameScope) slideIn(dir);
      scheduleTick();
    }

    function select(dayStart, { focusDay = false } = {}) {
      const today = todayStart();
      const d = Math.min(startOf(dayStart), today);
      if (d === selected) return;
      pendingDir = d > selected ? 1 : -1;
      selected = d;
      followToday = d === today;
      filter = null;
      paintHeader();
      paintDays();
      announceEl.textContent = `${titleFor(selected)}, ${longDate(selected)}`;
      if (focusDay) {
        const b = daysEl.querySelector(`[data-day="${selected}"]`);
        if (b) b.focus({ preventScroll: true });
      }
      refresh({ animate: false });
    }
    const step = (n) => select(T.addDays(selected, n));

    // ------------------------------------------------------------ store changes
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

    // ------------------------------------------------------------ minute tick (now-line, running rows)
    function scheduleTick() {
      clearTimeout(tickTimer);
      if (stopped || document.hidden) return;
      const now = Date.now();
      const viewingToday = selected === todayStart();
      // Today: the now-line and running rows move once a minute. Another
      // day: only wake for midnight (when "today" in the week row moves).
      const toMidnight = T.dayBounds(now).end - now;
      const delay = viewingToday ? Math.min(60000 - (now % 60000), toMidnight) : toMidnight;
      tickTimer = setTimeout(onTick, Math.max(250, delay + 40));
    }
    function onTick() {
      if (stopped || document.hidden) return;
      const today = todayStart();
      if (followToday && selected !== today) {
        selected = today;
        filter = null;
        paintHeader();
        paintDays();
        refresh({ animate: false });
        return;
      }
      paintHeader();
      paintDays();
      if (data && !document.documentElement.classList.contains('has-sheet')) {
        paintStats(data);
        paintStrip(data);
        paintList(data);
      }
      scheduleTick();
    }
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(tickTimer); return; }
      if (followToday) selected = todayStart();
      paintHeader();
      paintDays();
      refresh({ animate: false });
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ------------------------------------------------------------ strip taps
    function openFromRow(row, { highlightAfter = false } = {}) {
      const id = row.dataset.eventId;
      const ev = data && data.events.find((x) => x.id === id);
      const api = ctx.sheets.event({ origin: row, id, event: ev });
      if (highlightAfter && api && api.closed && typeof api.closed.then === 'function') {
        api.closed.then(() => {
          const slot = rowEls.get(id);
          if (slot && slot.li.isConnected) markNew(slot.li);
        });
      }
    }

    function onStripClick(e) {
      const svg = e.target.closest('svg[role="img"]');
      if (!svg || !data) return;
      let id = null;
      const direct = e.target.closest('[data-id]');
      if (direct) id = direct.getAttribute('data-id');
      if (!id) {
        const r = svg.getBoundingClientRect();
        if (!r.width) return;
        const scale = VB_W / r.width;
        const sx = (e.clientX - r.left) * scale;
        const sy = (e.clientY - r.top) * scale;
        const lane = Math.floor((sy - LANE_TOP + (LANE_GAP - LANE_H) / 2) / LANE_GAP);
        const m = lane >= 0 && lane < lastLanes.length ? hitMark(lastMarks, sx, lane, 12) : null;
        if (m) id = m.id;
      }
      if (!id) return;
      if (filter) { filter = null; paintStats(data); paintList(data); }
      const slot = rowEls.get(id);
      if (!slot) return;
      const row = slot.li.firstElementChild;
      row.scrollIntoView({ block: 'center', behavior: ctx.motionReduced() ? 'auto' : 'smooth' });
      openFromRow(row, { highlightAfter: true });
    }

    // ------------------------------------------------------------ swipe to page
    let swipe = null;
    const onDown = (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) { if (selected < todayStart()) step(1); } else step(-1);
    };
    const onCancel = () => { swipe = null; };
    dayEl.addEventListener('pointerdown', onDown);
    dayEl.addEventListener('pointerup', onUp);
    dayEl.addEventListener('pointercancel', onCancel);

    // ------------------------------------------------------------ keyboard on the week row
    const onDaysKey = (e) => {
      const cur = e.target.closest('.day');
      if (!cur) return;
      const map = { ArrowLeft: -1, ArrowRight: 1 };
      if (e.key in map) {
        e.preventDefault();
        const nextDay = startOf(T.addDays(Number(cur.dataset.day), map[e.key]));
        if (nextDay > todayStart()) return;
        select(nextDay, { focusDay: true });
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const cells = [...daysEl.querySelectorAll('.day')];
        const b = e.key === 'Home' ? cells[0] : cells[cells.length - 1];
        if (b) select(Number(b.dataset.day), { focusDay: true });
      }
    };
    daysEl.addEventListener('keydown', onDaysKey);

    // ------------------------------------------------------------ clicks
    const onClick = (e) => {
      const day = e.target.closest('.day[data-day]');
      if (day && daysEl.contains(day)) { select(Number(day.dataset.day)); return; }
      const stat = e.target.closest('[data-stat]');
      if (stat && statsEl.contains(stat)) {
        filter = filter === stat.dataset.stat ? null : stat.dataset.stat;
        if (data) { paintStats(data); paintList(data); }
        return;
      }
      if (stripEl.contains(e.target)) { onStripClick(e); return; }
      const row = e.target.closest('.row[data-event-id]');
      if (row && listEl.contains(row)) { openFromRow(row); return; }
      const b = e.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      switch (b.dataset.action) {
        case 'prev': step(-1); break;
        case 'next': if (selected < todayStart()) step(1); break;
        case 'today': select(todayStart()); break;
        case 'clear-filter':
          filter = null;
          if (data) { paintStats(data); paintList(data); }
          break;
        case 'log': ctx.sheets.quickLog({ origin: b }); break;
        case 'customize': ctx.router.push('settings', { page: 'customize' }); break;
        case 'report': ctx.router.push('report', { from: 'timeline' }); break;
        default: break;
      }
    };
    root.addEventListener('click', onClick);

    // ------------------------------------------------------------ subscriptions
    const offEvents = ctx.events.subscribe((c) => {
      if (!c) return;
      onStoreChange({ animate: c.op !== 'bulk' });
    });
    const offSettings = ctx.settings.subscribe((c) => {
      const key = c && c.key;
      if (['*', 'babies', 'activeBabyId'].includes(key)) { paintHeader(); refresh({ animate: false }); }
      else if (['trackers', 'units'].includes(key)) {
        if (data) { listReady = false; rowEls.clear(); render(listEl, null); }
        refresh({ animate: false });
      }
    });

    // ------------------------------------------------------------ first paint
    paintHeader();
    paintDays();
    refresh({ animate: false });

    return {
      unmount() {
        stopped = true;
        clearTimeout(tickTimer);
        for (const t of timers) clearTimeout(t);
        timers.clear();
        sheetWatch.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        root.removeEventListener('click', onClick);
        daysEl.removeEventListener('keydown', onDaysKey);
        dayEl.removeEventListener('pointerdown', onDown);
        dayEl.removeEventListener('pointerup', onUp);
        dayEl.removeEventListener('pointercancel', onCancel);
        offEvents();
        offSettings();
      },
    };
  },
};

// Exported for unit tests (pure).
export const _test = Object.freeze({ eventVisible, visibleLanes, weekWindow, stripGeometry, stripMarks, hitMark, hourWords });
