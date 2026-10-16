// Component gallery: the final mockup frames rebuilt from production CSS and
// js/ui modules (see gallery.html). Screen teams: this is reference MARKUP —
// copy the class structure, not the sample data. Dynamic sizes (goal-bar
// fill, split-bar parts) are set with el.style.setProperty (CSP-safe), never
// style="".

import { html, raw, render } from '../../../js/ui/html.js';
import { icon } from '../../../js/ui/icons.js';
import { createRouter } from '../../../js/ui/router.js';
import { openSheet } from '../../../js/ui/sheet.js';
import { mount as mountPills } from '../../../js/ui/livePill.js';

const q = new URLSearchParams(location.search);
const FRAME = q.get('frame') || 'today';
document.documentElement.setAttribute('data-theme', q.get('theme') === 'dark' ? 'dark' : 'light');
if (q.get('device') !== 'none') document.documentElement.classList.add('is-device');

/** Inline icon (aria-hidden SVG) for templates. */
const I = (name, size = 24) => raw(icon(name, { size }));

// Apply data-fill / data-part as CSS custom properties (CSP: no style="").
function applyVars(root) {
  for (const el of root.querySelectorAll('[data-fill]')) el.style.setProperty('--fill', el.dataset.fill);
  for (const el of root.querySelectorAll('[data-part]')) el.style.setProperty('--part', el.dataset.part);
}

// ------------------------------------------------------------------ Today

const masthead = html`
  <header class="masthead">
    <div class="masthead-text">
      <p class="eyebrow">Wednesday · October 14</p>
      <h1 class="masthead-title"><span class="masthead-name">Clara</span><span class="masthead-age">6 weeks</span></h1>
    </div>
    <button type="button" class="avatar-btn" aria-label="Clara’s profile and settings">
      <span class="avatar ph" aria-hidden="true"></span>
      <span class="gear-badge" aria-hidden="true">${I('gear', 15)}</span>
    </button>
  </header>`;

const cards = html`
  <div class="ql-grid">
    <button type="button" class="ql cat-feed" aria-label="Fed 2 hours 10 minutes ago, 4 ounces formula at 7:40 AM. Log a feed.">
      <span class="ql-top"><span class="ql-label">${I('bottle', 20)}Fed</span><span class="ql-well">${I('plus', 18)}</span></span>
      <span class="ql-val">2<small>h</small>10<small>m</small></span>
      <span class="ql-sub">ago · <b>4 oz</b> formula</span><span class="ql-sub">at 7:40 AM</span>
    </button>
    <button type="button" class="ql cat-sleep is-live" aria-label="Asleep 55 minutes, nap since 8:55 AM. Tap to log the wake-up.">
      <span class="ql-top"><span class="ql-label">${I('moon', 20)}Asleep</span><span class="live-chip"><span class="dot"></span>Nap</span></span>
      <span class="ql-val">55<small>m</small></span>
      <span class="ql-sub">since <b>8:55 AM</b></span><span class="ql-sub">Tap to wake</span>
    </button>
    <button type="button" class="ql cat-diaper" aria-label="Diaper 3 hours ago, wet, at 6:50 AM, 3 today. Log a diaper.">
      <span class="ql-top"><span class="ql-label">${I('diaper', 20)}Diaper</span><span class="ql-well">${I('plus', 18)}</span></span>
      <span class="ql-val">3<small>h</small>00<small>m</small></span>
      <span class="ql-sub">ago · <b>wet</b></span><span class="ql-sub">at 6:50 AM · 3 today</span>
    </button>
    <button type="button" class="ql cat-pump" aria-label="Pumped 2 hours 40 minutes ago, 3.5 ounces. 12.5 of 24 ounces today. Log a pump.">
      <span class="ql-top"><span class="ql-label">${I('pump', 20)}Pumped</span><span class="ql-well">${I('plus', 18)}</span></span>
      <span class="ql-val">2<small>h</small>40<small>m</small></span>
      <span class="ql-sub">ago · <b>3.5 oz</b> · 7:10</span>
      <span class="goal"><span class="goal-bar"><i data-fill="52%"></i></span><span class="goal-txt">12.5<small> / 24 oz</small></span></span>
    </button>
  </div>`;

const row = ({ cat, time, mer, ic, title, meta, live = false, trail }) => html`
  <li><button type="button" class="row cat-${cat}">
    <span class="row-time">${time}<small>${mer}</small></span>
    <span class="chip-ic ${live ? 'ring-live' : ''}">${I(ic, 22)}</span>
    <span class="row-main"><b class="row-title">${title}</b><small class="row-meta">${meta}</small></span>
    ${trail}
  </button></li>`;

const rowsToday = html`
  <ul class="list">
    ${row({ cat: 'sleep', time: '8:55', mer: 'AM', ic: 'moon', title: 'Nap', meta: 'Asleep · 55m so far', live: true, trail: html`<span class="badge"><span class="dot"></span>Now</span>` })}
    ${row({ cat: 'feed', time: '7:40', mer: 'AM', ic: 'bottle', title: 'Bottle · formula', meta: 'Finished in 18 min', trail: html`<span class="amt">4 <small>oz</small></span>` })}
    ${row({ cat: 'pump', time: '7:10', mer: 'AM', ic: 'pump', title: 'Pumped', meta: '16 min · to fridge', trail: html`<span class="amt">3.5 <small>oz</small></span>` })}
    ${row({ cat: 'diaper', time: '6:50', mer: 'AM', ic: 'diaper', title: 'Diaper', meta: 'Wet', trail: html`<span class="row-glyph">${I('wet', 18)}</span>` })}
  </ul>`;

const today = html`<div class="view-pad">
  ${masthead}${cards}
  <div class="sec-hd"><h2 class="sec-title">Today</h2><button type="button" class="link">Timeline${I('chev-r', 18)}</button></div>
  ${rowsToday}
</div>`;

// --------------------------------------------------------------- Timeline

function strip(pid) {
  const x0 = 30; const W = 288; const X = (h) => x0 + (W * h) / 24; const lanes = [6, 34, 62, 90]; const LH = 22;
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h + m / 60; };
  const now = hm('9:50');
  const laneIcons = ['moon', 'bottle', 'diaper', 'pump'];
  const sy = lanes[0] + 4; const sh = LH - 8; const fy = lanes[1] + 3; const dy = lanes[2] + LH / 2; const py = lanes[3] + LH / 2;
  return html`
    <defs>
      <pattern id="hatch-${pid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="s-hatch"></line></pattern>
      ${lanes.map((y, i) => html`<clipPath id="lane${i}-${pid}"><rect x="${x0}" y="${y}" width="${W}" height="${LH}" rx="7"></rect></clipPath>`)}
    </defs>
    ${lanes.map((y, i) => html`
      <g class="s-icon" transform="translate(0 ${y + 1})">${I(laneIcons[i], 20)}</g>
      <g clip-path="url(#lane${i}-${pid})">
        <rect x="${x0}" y="${y}" width="${W}" height="${LH}" class="s-track"></rect>
        <rect x="${X(0)}" y="${y}" width="${X(7) - X(0)}" height="${LH}" class="s-band"></rect>
        <rect x="${X(19)}" y="${y}" width="${X(24) - X(19)}" height="${LH}" class="s-band"></rect>
        <rect x="${X(now)}" y="${y}" width="${X(24) - X(now)}" height="${LH}" fill="url(#hatch-${pid})"></rect>
      </g>`)}
    ${[['0:00', '2:00'], ['2:40', '6:30']].map(([a, b]) => html`<rect x="${X(hm(a))}" y="${sy}" width="${X(hm(b)) - X(hm(a))}" height="${sh}" rx="4" class="s-sleep"></rect>`)}
    <rect x="${X(hm('8:55')) + 1}" y="${sy + 1}" width="${X(now) - X(hm('8:55')) - 2}" height="${sh - 2}" rx="3.5" class="s-nap"></rect>
    ${['2:10', '7:40'].map((t) => html`<rect x="${X(hm(t)) - 2}" y="${fy}" width="4" height="16" rx="2" class="s-feed"></rect>`)}
    <rect x="${X(hm('5:05')) - 2.5}" y="${fy + 0.8}" width="5" height="14.4" rx="2.5" class="s-bf"></rect>
    <circle cx="${X(hm('2:25'))}" cy="${dy}" r="5" class="s-dia-dot"></circle>
    ${['5:20', '6:50'].map((t) => html`<circle cx="${X(hm(t))}" cy="${dy}" r="4.6" class="s-dia-ring"></circle>`)}
    ${['0:50', '4:20', '7:10'].map((t) => html`<rect x="${X(hm(t)) - 4.5}" y="${py - 4.5}" width="9" height="9" rx="1.5" transform="rotate(45 ${X(hm(t))} ${py})" class="s-pump"></rect>`)}
    <line x1="${X(now)}" y1="2" x2="${X(now)}" y2="116" class="s-now"></line>
    ${[[0, '12a'], [6, '6a'], [12, '12p'], [18, '6p'], [24, '12a']].map(([h, l]) => html`<text x="${X(h)}" y="134" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}" class="s-axis">${l}</text>`)}`;
}

const swatch = (inner) => html`<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">${inner}</svg>`;

const timeline = html`<div class="view-pad">
  <header class="page-hd">
    <div><p class="eyebrow">Timeline</p><h1 class="page-title">Today</h1><p class="page-sub">Wednesday, October 14</p></div>
    <div class="hd-actions">
      <button type="button" class="btn-round" aria-label="Previous day">${I('chev-l')}</button>
      <button type="button" class="btn-round" aria-label="Next day" aria-disabled="true">${I('chev-r')}</button>
    </div>
  </header>
  <div class="days" role="tablist" aria-label="This week">
    ${[['Th', 8], ['Fr', 9], ['Sa', 10], ['Su', 11], ['Mo', 12], ['Tu', 13], ['We', 14]].map(([d, n]) => html`
      <button type="button" class="day" role="tab" aria-selected="${n === 14 ? 'true' : 'false'}"><small>${d}</small><b>${n}</b>${n === 14 ? html`<span class="today-dot"></span>` : ''}</button>`)}
  </div>
  <div class="stats">
    <button type="button" class="stat cat-feed">${I('bottle', 20)}<b class="stat-val">7 <small>oz</small></b><small class="stat-lbl">3 feeds</small></button>
    <button type="button" class="stat cat-sleep">${I('moon', 20)}<b class="stat-val">6h 45m</b><small class="stat-lbl">slept</small></button>
    <button type="button" class="stat cat-diaper">${I('diaper', 20)}<b class="stat-val">3</b><small class="stat-lbl">diapers</small></button>
    <button type="button" class="stat cat-pump">${I('pump', 20)}<b class="stat-val">12.5 <small>oz</small></b><small class="stat-lbl">pumped</small></button>
  </div>
  <section class="strip" aria-label="24 hour activity">
    <div class="strip-hd"><b>24 hours</b><small>shaded = 7 PM – 7 AM</small></div>
    <svg width="322" height="140" viewBox="0 0 322 140" role="img" aria-label="Night sleep midnight to 2 AM and 2:40 to 6:30 AM, nap since 8:55 AM, 3 feeds, 3 diapers, 3 pumps">${strip('g1')}</svg>
    <div class="legend">
      <span>${swatch(html`<rect x="1" y="2" width="16" height="8" rx="3" class="s-sleep"></rect>`)}Night sleep</span>
      <span>${swatch(html`<rect x="2" y="3" width="14" height="6" rx="2.5" class="s-nap"></rect>`)}Nap</span>
      <span>${swatch(html`<rect x="7" y="0" width="4" height="12" rx="2" class="s-feed"></rect>`)}Bottle</span>
      <span>${swatch(html`<rect x="6.5" y=".8" width="5" height="10.4" rx="2.5" class="s-bf"></rect>`)}Breast</span>
      <span>${swatch(html`<rect x="5" y="2" width="8" height="8" rx="1.5" transform="rotate(45 9 6)" class="s-pump"></rect>`)}Pump</span>
      <span>${swatch(html`<circle cx="9" cy="6" r="4.2" class="s-dia-ring"></circle>`)}Wet</span>
      <span>${swatch(html`<circle cx="9" cy="6" r="4.6" class="s-dia-dot"></circle>`)}Dirty</span>
      <span>${swatch(html`<circle cx="9" cy="6" r="5" class="s-dia-ring"></circle><circle cx="9" cy="6" r="2" class="s-dia-dot"></circle>`)}Both</span>
    </div>
  </section>
  <div class="sec-hd"><h2 class="sec-title">The day</h2><span class="sec-meta">10 entries · newest first</span></div>
  ${rowsToday}
</div>`;

// ------------------------------------------------------------------ Stash

const pouchArt = html`<svg class="pouch-art" width="64" height="76" viewBox="0 0 64 76" aria-hidden="true">
  <path class="pa-body" d="M12 6h40v10l6 9v40a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V25l6-9z"></path>
  <path class="pa-milk" d="M8.5 40h47v25a4 4 0 0 1-4 4h-39a4 4 0 0 1-4-4z"></path>
  <path class="pa-line" d="M12 16h40"></path><path class="pa-line" d="M20 30h12"></path></svg>`;

const pouchRow = (amt, when, left) => html`
  <li><button type="button" class="row cat-pump">
    <span class="chip-ic">${I('pouch', 22)}</span>
    <span class="row-main"><b class="row-title">${amt}</b><small class="row-meta">${when}</small></span>
    <span class="badge badge-ok">${I('clock', 14)}${left}</span>
  </button></li>`;

const stash = html`<div class="view-pad">
  <header class="page-hd is-compact">
    <div><p class="eyebrow">Milk stash</p><div class="total"><b>46</b><small>oz</small></div></div>
    <div class="hd-actions"><button type="button" class="btn btn-outline">${I('plus', 20)}Add pouch</button></div>
  </header>
  <p class="page-sub">About 11 bottles of 4 oz</p>
  <div class="split" role="img" aria-label="Fridge 9 ounces, freezer 37 ounces"><i class="fr" data-part="9"></i><i class="fz" data-part="37"></i></div>
  <div class="split-legend">
    <span><i class="sw fr"></i>${I('fridge', 18)}Fridge <b>9 oz</b> · 2</span>
    <span><i class="sw fz"></i>${I('snow', 18)}Freezer <b>37 oz</b> · 8</span>
  </div>
  <section class="hero cat-pump" aria-label="Use next">
    <div class="hero-top"><span class="badge badge-next">${I('spark', 14)}Use next</span><span class="hero-loc">${I('snow', 18)}Oldest in freezer</span></div>
    <div class="hero-mid">${pouchArt}<div><div class="hero-amt">4<small> oz</small></div>
      <p class="hero-meta">Pumped <b>Sep 2</b> · frozen 6 weeks<br>Best by <b>Mar 2</b> · 4½ months left</p></div></div>
    <div class="btns"><button type="button" class="btn btn-primary">${I('thaw', 22)}Thaw</button><button type="button" class="btn btn-secondary">${I('bottle', 22)}Thaw &amp; feed</button></div>
  </section>
  <div class="sec-hd"><h2 class="sec-title">Fridge</h2><span class="sec-meta">9 oz · keeps 4 days</span></div>
  <ul class="list no-time">
    ${pouchRow('5.5 oz', 'Yesterday, 8:20 PM', '3 days left')}
    ${pouchRow('3.5 oz', 'Today, 7:10 AM', '4 days left')}
  </ul>
</div>`;

// --------------------------------------------------------------- Memories

const first = (title, meta, ph) => html`
  <li><button type="button" class="first-row">
    <span class="spark-chip">${I('spark', 22)}</span>
    <span class="first-text"><b>${title}</b><small>${meta}</small></span>
    <span class="print"><i class="ph ${ph}"></i></span>
  </button></li>`;

const memories = html`<div class="view-pad">
  <header class="page-hd is-compact">
    <div><p class="eyebrow">Clara’s book</p><h1 class="page-title">Memories</h1></div>
    <div class="hd-actions"><button type="button" class="btn btn-outline">${I('camera', 20)}Add</button></div>
  </header>
  <figure class="cover"><i class="cover-photo ph" role="img" aria-label="Photo: the first real smile"></i>
    <figcaption class="cover-cap"><span class="it">The first real smile</span><small>Fri, Oct 9 · 5 weeks</small></figcaption></figure>
  <div class="sec-hd"><h2 class="sec-title">Firsts</h2><span class="sec-meta">3 of 12 kept</span></div>
  <ul class="firsts">
    ${first('First real smile', 'Fri, Oct 9 · 5 weeks, 2 days', '')}
    ${first('Head up in tummy time', 'Mon, Sep 28 · 3 weeks, 5 days', 'ph-2')}
    ${first('First bath at home', 'Sun, Sep 6 · 4 days', 'ph-3')}
    <li><div class="first-row is-suggested">
      <span class="spark-chip">${I('spark', 22)}</span>
      <span class="first-text"><span class="it">Laughs out loud</span><small>Usually 3–4 months</small></span>
      <button type="button" class="btn btn-outline">${I('plus', 20)}Add</button>
    </div></li>
  </ul>
</div>`;

// -------------------------------------------------------------- Customize

const tracker = (cat, ic, title, sub, { on = true, dragging = false } = {}) => html`
  <li><div class="set-row ${dragging ? 'is-dragging' : ''}">
    <button type="button" class="grip" aria-label="Reorder ${title}">${I('grip', 20)}</button>
    <span class="chip-ic ${cat}">${I(ic, 20)}</span>
    <span class="set-text"><b>${title}</b><small>${sub}</small></span>
    <button type="button" class="toggle" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="Show ${title}"></button>
  </div></li>`;

const customize = html`<div class="view-pad">
  <div class="navbar"><button type="button" class="back" data-back>${I('chev-l')}Settings</button><h1 class="navbar-title">Customize</h1><span></span></div>
  <p class="intro">Choose what shows on Today and in +. Drag to reorder. Hidden trackers keep their data.</p>
  <p class="grp-lbl">Trackers</p>
  <ul class="set-list">
    ${tracker('cat-feed', 'bottle', 'Bottle feeds', 'Formula & breast milk')}
    ${tracker('cat-feed', 'breast', 'Breastfeeding', 'Left / right timer')}
    ${tracker('cat-sleep', 'moon', 'Sleep', 'Naps, nights, wake windows', { dragging: true })}
    ${tracker('cat-pump', 'pump', 'Pumping', 'Goal 24 oz a day')}
    ${tracker('cat-pump', 'pouch', 'Milk stash', 'Fridge & freezer')}
    ${tracker('cat-diaper', 'diaper', 'Diapers', 'Wet, dirty, both')}
    ${tracker('cat-mem', 'spark', 'Milestones & memories', 'Hidden · photos kept', { on: false })}
  </ul>
  <p class="grp-lbl">Comfort &amp; privacy</p>
  <ul class="set-list">
    <li><button type="button" class="set-row" role="switch" aria-checked="false">
      <span class="chip-ic cat-neutral">${I('motion', 20)}</span>
      <span class="set-text"><b>Reduce motion</b><small>Fades instead of slides</small></span>
      <span class="toggle" aria-checked="false" aria-hidden="true"></span>
    </button></li>
    <li><button type="button" class="set-row">
      <span class="chip-ic cat-accent">${I('shield', 20)}</span>
      <span class="set-text"><b>Privacy &amp; your data</b><small><span class="proof">${I('check', 14)}0 network requests</span> · 14.2 MB</small></span>
      <span class="chev">${I('chev-r', 20)}</span>
    </button></li>
  </ul>
</div>`;

// ----------------------------------------------------------- Quick log (3)

function openQuickLog(origin) {
  return openSheet({
    title: 'Log for Clara',
    origin,
    className: 'sheet-quicklog',
    render(body, api) {
      render(api.header, html`<button type="button" class="time-chip" aria-label="Time: now, 9:50 AM. Change">${I('clock', 18)}Now <span class="num">9:50</span>${I('chev-d', 18)}</button>`);
      render(body, html`
        <div class="tiles">
          <button type="button" class="tile cat-feed is-live" data-stagger><span class="tile-ic">${I('bottle', 20)}</span><span class="tile-label">Bottle</span><small class="tile-ctx"><span class="dot"></span>Running <b>12:04</b></small></button>
          <button type="button" class="tile cat-feed" data-stagger><span class="tile-ic">${I('breast', 20)}</span><span class="tile-label">Breastfeed</span><small class="tile-ctx">Start on <b>left</b> · last was R</small></button>
          <button type="button" class="tile cat-pump" data-stagger><span class="tile-ic">${I('pump', 20)}</span><span class="tile-label">Pump</span><small class="tile-ctx"><b>12.5</b> of 24 oz today</small></button>
          <button type="button" class="tile cat-sleep is-live" data-stagger><span class="tile-ic">${I('sun', 20)}</span><span class="tile-label">End nap</span><small class="tile-ctx">Asleep <b>55m</b></small></button>
        </div>
        <div class="diaper-row cat-diaper" role="group" aria-label="Log a diaper in one tap" data-stagger>
          <span class="lbl"><b>Diaper</b><small>One tap</small></span>
          <button type="button" class="dbtn">${I('wet', 18)}Wet</button><button type="button" class="dbtn">${I('dirty', 18)}Dirty</button><button type="button" class="dbtn">${I('both', 18)}Both</button>
        </div>
        <div class="tiles">
          <button type="button" class="tile row-tile cat-mem" data-stagger><span class="tile-ic">${I('spark', 20)}</span><span class="tile-text"><span class="tile-label">Memory</span><small class="tile-ctx">Photo or first</small></span></button>
          <button type="button" class="tile row-tile cat-pump" data-stagger><span class="tile-ic">${I('pouch', 20)}</span><span class="tile-text"><span class="tile-label">Stash milk</span><small class="tile-ctx">Fridge or freezer</small></span></button>
        </div>
        <p class="hint">Tip: hold <b>+</b> to log a bottle in one move.</p>`);
    },
  });
}

// ------------------------------------------------------------------ mount

const staticView = (id, title, tpl) => ({
  id,
  title,
  mount(root) { render(root, tpl); applyVars(root); return { unmount() {} }; },
});

const views = {
  today: staticView('today', 'Today', today),
  timeline: staticView('timeline', 'Timeline', timeline),
  stash: staticView('stash', 'Stash', stash),
  memories: staticView('memories', 'Memories', memories),
  customize: staticView('customize', 'Customize', customize),
};

// A tiny observable stand-in for core/settings (only what the router reads).
let trackers = { bottle: true, formula: true, breastfeeding: true, pump: true, stash: true, sleep: true, diaper: true, memories: true };
const settingsListeners = new Set();
const settings = {
  get: (k) => (k === 'trackers' ? { ...trackers } : k === 'babies' ? [] : undefined),
  subscribe: (fn) => { settingsListeners.add(fn); return () => settingsListeners.delete(fn); },
};

const router = createRouter({
  viewport: document.getElementById('viewport'),
  nav: document.getElementById('tabBar'),
  views,
  getCtx: () => ({}),
  settings,
  onFab: (fab) => openQuickLog(fab),
});

// A breast-milk bottle started 12:04 ago: 2h window → "good for 1h 48m".
const startedAt = Date.now() - (12 * 60 + 4) * 1000;
const bottle = { id: 'evt_gallery', type: 'feed', startTime: startedAt, endTime: null, data: { method: 'bottle', milk: 'breastmilk', amount: 4, unit: 'oz' }, babyId: null };
mountPills(document.getElementById('livePills'), {
  events: { running: async () => [bottle], subscribe: () => () => {} },
  settings: { get: (k) => (k === 'storageWindows' ? { startedBottleHours: 2 } : undefined), subscribe: () => () => {} },
  router,
});

if (FRAME === 'customize') {
  router.go('today', { animate: false });
  router.push('customize', {}, { animate: false });
} else if (FRAME === 'quicklog') {
  router.go('today', { animate: false });
  openQuickLog(router.fab);
} else {
  router.go(views[FRAME] ? FRAME : 'today', { animate: false });
}
// Fixture-only hooks for tests/e2e/gallery.mjs (router edge cases).
window.__gallery = {
  router,
  setTrackers(patch) {
    trackers = { ...trackers, ...patch };
    for (const fn of settingsListeners) fn({ key: 'trackers', value: { ...trackers } });
  },
};
document.documentElement.dataset.galleryReady = 'true';
