// Pediatrician report (ARCHITECTURE §10c; DESIGN §6.8, §10 copy voice).
// A pushed screen, reached from Timeline (and Settings):
//
//   ctx.router.push('report', { from: 'timeline' | 'settings', days: 7 | 14 })
//
//  - The active baby's last 7 or 14 COMPLETE days (domain/trends
//    reportSummary): feeds a day + total, bottle amount a day + total,
//    breastfeeds, wet / dirty diapers a day, sleep a day + the
//    longest stretch, pumping totals — visible trackers only (hidden trackers
//    disappear everywhere, their data stays).
//  - A day-by-day table, oldest first, the way a doctor reads a log.
//  - "Save as PDF / Print" (window.print with a clean print stylesheet in
//    css/views/report.css) and "Share CSV" (core/backup shareCsv: the OS share
//    sheet, or a download). Both stay on the phone until the parent shares.
//  - Calm copy that explains what's counted; a warm empty state when there's
//    nothing to report yet.
// Re-renders on store changes (events, units, trackers, active baby).

import { reportSummary } from '../domain/trends.js';
import { eventVisible } from '../ui/format.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = Object.freeze([7, 14]);
const UNIT_SPOKEN = Object.freeze({ oz: ['ounce', 'ounces'], mL: ['milliliter', 'milliliters'] });
let mountSeq = 0;

// ----------------------------------------------------------------- pure


/** Which report sections show for a trackers setting. */
function sections(t) {
  return {
    feeds: t.bottle !== false || t.breastfeeding !== false,
    bottle: t.bottle !== false,
    breast: t.breastfeeding !== false,
    diaper: t.diaper !== false,
    sleep: t.sleep !== false,
    pump: t.pump !== false,
  };
}

/** "4.5" / "4" (no trailing .0) for an average count. */
function num(n) {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10) / 10;
  return String(Number.isInteger(r) ? r : r.toFixed(1));
}

// ----------------------------------------------------------------- view

export default {
  id: 'report',
  title: 'Report for the pediatrician',
  /**
   * @param {HTMLElement} root the screen's scrolling <section>
   * @param {object} ctx app ctx (ARCHITECTURE §5.2)
   * @param {{ from?: 'timeline'|'settings', days?: number }} [params]
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx, params = {}) {
    const { html, render } = ctx.html;
    const F = ctx.format;
    const I = (name, size) => ctx.icons.iconHtml(name, { size });
    const pid = `rp${(mountSeq += 1)}`;

    let days = RANGES.includes(Number(params.days)) ? Number(params.days) : 7;
    let stopped = false;
    let loadSeq = 0;
    let sharing = false;
    const backLabel = params.from === 'settings' ? 'Settings' : params.from === 'today' ? 'Today' : 'Timeline';

    const trackers = () => ctx.settings.get('trackers') || {};
    const unit = () => (ctx.settings.get('units') === 'mL' ? 'mL' : 'oz');
    const baby = () => ctx.activeBaby();
    const name = () => F.babyName(baby());
    const spokenAmt = (v, u) => `${v} ${UNIT_SPOKEN[u][Number(v) === 1 ? 0 : 1]}`;

    render(root, html`<div class="view-pad rp">
      <div class="navbar rp-nav">
        <button type="button" class="back" data-action="back">${I('chev-l', 24)}${backLabel}</button>
        <h1 class="navbar-title">Report</h1><span></span>
      </div>
      <header class="rp-hd" data-part="hd"></header>
      <div class="segmented rp-range" role="radiogroup" aria-label="How many days" data-part="range">
        ${RANGES.map((n) => html`<button type="button" role="radio" data-days="${n}" aria-checked="${n === days ? 'true' : 'false'}" tabindex="${n === days ? '0' : '-1'}">Last ${n} days</button>`)}
      </div>
      <div class="rp-body" data-part="body"></div>
      <div class="rp-actions" data-part="actions">
        <button type="button" class="btn btn-primary btn-block" data-action="print">${I('report', 22)}Save as PDF / Print</button>
        <button type="button" class="btn btn-secondary btn-block" data-action="csv">${I('share', 22)}Share CSV</button>
        <p class="note rp-privacy">${I('lock', 16)}<span>Made on this phone. Nothing leaves it unless you print or share it.</span></p>
      </div>
    </div>`);
    const part = (n) => root.querySelector(`[data-part="${n}"]`);
    const hdEl = part('hd');
    const rangeEl = part('range');
    const bodyEl = part('body');
    const actionsEl = part('actions');

    function rangeWords(s) {
      const from = new Date(s.from);
      const to = new Date(s.to - 1);
      const sameYear = from.getFullYear() === to.getFullYear() && to.getFullYear() === new Date().getFullYear();
      const o = sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
      return `${from.toLocaleDateString(undefined, o)} – ${to.toLocaleDateString(undefined, o)}`;
    }

    function paintHeader(s) {
      const b = baby();
      const age = b && b.birthDate ? F.babyAge(b.birthDate) : '';
      const n = name();
      render(hdEl, html`
        <p class="eyebrow">For the pediatrician</p>
        <h2 class="page-title rp-title">${`${F.possessive(n)} last ${days} days`}</h2>
        <p class="page-sub">${s ? rangeWords(s) : ''}${age ? ` · ${age} old` : ''}</p>
        <p class="rp-print-meta">${`Made with Nurture on ${F.dateLabel(Date.now())}${b && b.birthDate ? ` · born ${F.dateLabel(ctx.time.parseLocalDate(b.birthDate))}` : ''}`}</p>`);
    }

    // A summary tile: icon + word, big value + unit word, one quiet line.
    const tile = ({ cat, icon, word, value, unitWord, sub, aria }) => html`<li class="rp-tile cat-${cat}" aria-label="${aria}">
        <span class="rp-tile-top" aria-hidden="true">${I(icon, 20)}${word}</span>
        <span class="rp-tile-val" aria-hidden="true">${value}${unitWord ? html` <small>${unitWord}</small>` : ''}</span>
        <span class="rp-tile-sub" aria-hidden="true">${sub}</span>
      </li>`;

    function tiles(s, show) {
      const u = s.unit;
      const out = [];
      const n = s.daysWithData;
      const inAll = `in ${F.plural(n, 'day')}`;
      if (show.feeds) {
        out.push(tile({
          cat: 'feed', icon: show.bottle ? 'bottle' : 'breast', word: 'Feeds',
          value: num(s.perDay.feeds), unitWord: 'a day',
          sub: `${s.totals.feeds} ${inAll}`,
          aria: `Feeds: ${num(s.perDay.feeds)} a day, ${s.totals.feeds} ${inAll}.`,
        }));
      }
      if (show.bottle) {
        out.push(tile({
          cat: 'feed', icon: 'bottle', word: 'Bottles',
          value: html`${String(s.perDay.bottleAmount)}<small>${u}</small>`, unitWord: 'a day',
          sub: `${s.totals.bottleAmount} ${u} in all`,
          aria: `Bottles: ${spokenAmt(s.perDay.bottleAmount, u)} a day, ${spokenAmt(s.totals.bottleAmount, u)} in all.`,
        }));
      }
      if (show.breast) {
        out.push(tile({
          cat: 'feed', icon: 'breast', word: 'Breastfeeds',
          value: num(s.perDay.breastSessions), unitWord: 'a day',
          sub: `${F.plural(s.totals.breastSessions, 'breastfeed')} in all`,
          aria: `Breastfeeds: ${num(s.perDay.breastSessions)} ${s.perDay.breastSessions === 1 ? 'breastfeed' : 'breastfeeds'} a day, ${s.totals.breastSessions} in all.`,
        }));
      }
      if (show.diaper) {
        out.push(tile({
          cat: 'diaper', icon: 'diaper', word: 'Diapers',
          value: html`${num(s.perDay.wet)}<small>wet</small> ${num(s.perDay.dirty)}<small>dirty</small>`, unitWord: '',
          sub: `a day · ${s.totals.wet} wet, ${s.totals.dirty} dirty in all`,
          aria: `Diapers: ${num(s.perDay.wet)} wet and ${num(s.perDay.dirty)} dirty a day; ${s.totals.wet} wet and ${s.totals.dirty} dirty in all.`,
        }));
      }
      if (show.sleep) {
        const per = s.perDay.sleepMs;
        out.push(tile({
          cat: 'sleep', icon: 'moon', word: 'Sleep',
          value: per >= 60000 ? F.span(per) : '0m', unitWord: 'a day',
          sub: s.longestSleepMs >= 60000 ? `Longest stretch ${F.span(s.longestSleepMs)}` : 'No long stretch yet',
          aria: `Sleep: ${per >= 60000 ? F.spanSpoken(per) : 'no time'} a day. Longest stretch ${s.longestSleepMs >= 60000 ? F.spanSpoken(s.longestSleepMs) : 'none yet'}.`,
        }));
      }
      if (show.pump) {
        out.push(tile({
          cat: 'pump', icon: 'pump', word: 'Pumped',
          value: html`${String(s.perDay.pumpAmount)}<small>${u}</small>`, unitWord: 'a day',
          sub: `${num(s.perDay.pumps)} ${s.perDay.pumps === 1 ? 'pump' : 'pumps'} a day · ${s.totals.pumpAmount} ${u} in all`,
          aria: `Pumped: ${spokenAmt(s.perDay.pumpAmount, u)} a day from ${num(s.perDay.pumps)} ${s.perDay.pumps === 1 ? 'pump' : 'pumps'}; ${spokenAmt(s.totals.pumpAmount, u)} in all.`,
        }));
      }
      return out;
    }

    function table(s, show) {
      const u = s.unit;
      const cols = [];
      const t = s.totals;
      if (show.feeds) cols.push({ h: 'Feeds', v: (d) => String(d.feed.count) });
      if (show.bottle && (t.bottleAmount > 0 || !show.breast)) cols.push({ h: 'Bottle', sub: u, title: `Bottle ${u === 'oz' ? 'ounces' : 'milliliters'}`, v: (d) => String(d.feed.amount) });
      if (show.breast && (t.breastSessions > 0 || !show.bottle)) cols.push({ h: 'Breast', sub: 'times', title: 'Breastfeeds', v: (d) => String(d.feed.breastCount) });
      if (show.diaper) cols.push({ h: 'Diapers', sub: 'wet · dirty', title: 'Wet and dirty diapers', v: (d) => `${d.diaper.wet} · ${d.diaper.dirty}` });
      if (show.sleep) cols.push({ h: 'Sleep', v: (d) => (d.sleep.totalMs >= 60000 ? F.span(d.sleep.totalMs) : '0m') });
      if (show.pump && (t.pumps > 0 || cols.length < 4)) cols.push({ h: 'Pump', sub: u, title: `Pumped, ${u === 'oz' ? 'ounces' : 'milliliters'}`, v: (d) => String(d.pump.amount) });
      if (!cols.length) return '';
      const hasData = (d) => d.feed.count + d.pump.count + d.diaper.count + d.sleep.count > 0 || d.sleep.totalMs > 0;
      return html`<div class="rp-table-wrap" role="region" aria-labelledby="${pid}-days" tabindex="0">
          <table class="rp-table" data-cols="${cols.length + 1}">
            <thead><tr><th scope="col">Day</th>${cols.map((c) => html`<th scope="col">${c.title ? html`<abbr title="${c.title}">${c.h}</abbr>` : c.h}${c.sub ? html`<small>${c.sub}</small>` : ''}</th>`)}</tr></thead>
            <tbody>${s.days.map((d) => {
              const dt = new Date(d.start);
              return html`<tr class="${hasData(d) ? '' : 'is-empty'}">
                <th scope="row" aria-label="${F.dateLabel(d.start)}">${dt.toLocaleDateString(undefined, { weekday: 'short' })} <span class="num">${dt.getDate()}</span></th>
                ${cols.map((c) => html`<td>${hasData(d) ? c.v(d) : '—'}</td>`)}
              </tr>`;
            })}</tbody>
          </table>
        </div>`;
    }

    function emptyTpl() {
      const n = name();
      return html`<div class="empty-state cat-accent rp-empty">
          <span class="empty-disc">${I('report', 30)}</span>
          <h2 class="empty-title">Nothing to report yet</h2>
          <p class="empty-text">${`Once a full day is logged for ${n}, a summary for the pediatrician will appear here. Today joins the report once it’s over.`}</p>
          <button type="button" class="btn btn-secondary" data-action="back">${`Back to ${backLabel.toLowerCase() === 'timeline' ? 'the timeline' : backLabel}`}</button>
        </div>`;
    }

    function hiddenTpl() {
      return html`<div class="empty-state cat-neutral rp-empty">
          <span class="empty-disc">${I('gear', 30)}</span>
          <h2 class="empty-title">Every tracker is hidden</h2>
          <p class="empty-text">Hidden trackers keep their data. Turn some back on in Customize to see them here.</p>
          <button type="button" class="btn btn-secondary" data-action="customize">Customize</button>
        </div>`;
    }

    async function refresh() {
      const seq = (loadSeq += 1);
      const now = Date.now();
      const todayStart = ctx.time.dayBounds(now).start;
      const from = ctx.time.dayBounds(ctx.time.addDays(now, -days)).start - DAY_MS;
      const b = baby();
      let list;
      try {
        list = await ctx.events.query({ from, to: todayStart, overlap: true, babyId: b ? b.id : undefined });
      } catch (err) {
        console.error('Report: load failed', err);
        list = [];
      }
      if (stopped || seq !== loadSeq) return;
      const t = trackers();
      const show = sections(t);
      const visible = list.filter((e) => eventVisible(e, t));
      const s = reportSummary(visible, { days, unit: unit(), now });
      paintHeader(s);
      const any = Object.values(show).some(Boolean);
      if (!any) {
        render(bodyEl, hiddenTpl());
        actionsEl.hidden = true;
        return;
      }
      if (!s.daysWithData) {
        render(bodyEl, emptyTpl());
        actionsEl.hidden = false;
        actionsEl.querySelector('[data-action="print"]').disabled = true;
        return;
      }
      actionsEl.hidden = false;
      actionsEl.querySelector('[data-action="print"]').disabled = false;
      const gap = s.dayCount - s.daysWithData;
      render(bodyEl, html`
        <p class="intro rp-intro">${`A summary of the last ${days} full days, made on this phone. Averages count only the days with entries${gap ? ` (${F.plural(s.daysWithData, 'day')} of ${s.dayCount})` : ''}, so a quiet day doesn’t pull them down. Today joins once it’s over.`}</p>
        <ul class="rp-tiles" aria-label="Averages">${tiles(s, show)}</ul>
        <div class="sec-hd"><h2 class="sec-title" id="${`${pid}-days`}">Day by day</h2><span class="sec-meta">oldest first</span></div>
        ${table(s, show)}
        <p class="rp-foot">Amounts are in ${s.unit === 'oz' ? 'ounces' : 'milliliters'}. Sleep is counted on the day it happened, so a night that crosses midnight is split between two days. Feeds include bottles and breastfeeds; timers still running aren’t counted.</p>`);
    }

    // ------------------------------------------------------------ actions
    async function doShare(btn) {
      if (sharing) return;
      sharing = true;
      btn.setAttribute('aria-busy', 'true');
      try {
        const b = baby();
        const result = await ctx.backup.shareCsv({ unit: unit(), babyId: b ? b.id : undefined });
        if (result === 'download') ctx.toast({ message: 'CSV saved to your downloads' });
      } catch (err) {
        console.warn('Report: CSV not shared', err);
        ctx.toast({ message: 'That didn’t share. Try again.', tone: 'warn' });
      } finally {
        sharing = false;
        btn.removeAttribute('aria-busy');
      }
    }

    function pickRange(btn, focus) {
      const n = Number(btn.dataset.days);
      if (!RANGES.includes(n)) return;
      for (const b of rangeEl.querySelectorAll('[role="radio"]')) {
        const on = b === btn;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
      if (focus) btn.focus();
      if (n === days) return;
      days = n;
      refresh();
    }

    const onClick = (e) => {
      const r = e.target.closest('[role="radio"][data-days]');
      if (r && rangeEl.contains(r)) { pickRange(r, false); return; }
      const b = e.target.closest('[data-action]');
      if (!b || !root.contains(b) || b.disabled) return;
      switch (b.dataset.action) {
        case 'back': ctx.router.back(); break;
        case 'print': window.print(); break;
        case 'csv': doShare(b); break;
        case 'customize': ctx.router.push('settings', { page: 'customize' }); break;
        default: break;
      }
    };
    const onKey = (e) => {
      const list = [...rangeEl.querySelectorAll('[role="radio"]')];
      const i = list.indexOf(document.activeElement);
      if (i === -1) return;
      let j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = list.length - 1;
      if (j === null) return;
      e.preventDefault();
      pickRange(list[j], true);
    };
    root.addEventListener('click', onClick);
    rangeEl.addEventListener('keydown', onKey);

    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (!stopped) refresh(); });
    };
    const offEvents = ctx.events.subscribe(() => queue());
    const offSettings = ctx.settings.subscribe((c) => {
      const key = c && c.key;
      if (['*', 'babies', 'activeBabyId', 'trackers', 'units'].includes(key)) queue();
    });

    paintHeader(null);
    refresh();

    return {
      unmount() {
        stopped = true;
        root.removeEventListener('click', onClick);
        rangeEl.removeEventListener('keydown', onKey);
        offEvents();
        offSettings();
      },
    };
  },
};

// Exported for unit tests (pure).
export const _test = Object.freeze({ eventVisible, sections, num });
