// Display helpers shared by every view and sheet (DESIGN §10 "Formats").
//
// Pure (no DOM, no stores): each function takes the values it formats plus
// an injectable `now`, so a card, a row and the live pill all say the same
// thing at the same instant and tests are deterministic. Built on top of
// core/units (amounts) and core/time (clock + calendar math) — this file only
// decides WORDING, never maths.
//
// Copy rules baked in here (DESIGN §10):
//  - durations "2h 10m", "3h 00m", "55m", "Just now"
//  - amounts "4 oz", "3.5 oz", "120 mL" (no trailing .0; mL whole numbers)
//  - dates "Wed, Oct 14"; "Today" / "Yesterday" in lists
//  - ages "6 weeks", "6 weeks, 3 days", "3 months"
//  - never assume the baby's gender: helpers take a name, never a pronoun

import { formatAmount, amountParts, normalizeUnit } from '../core/units.js';
import {
  MINUTE, HOUR, toMs, clock as timeClock, meridiem as timeMeridiem, prefers12h,
  dayLabel as timeDayLabel, daysBetween, monthsBetween, parseLocalDate, addDays,
} from '../core/time.js';
import { breastSideTotals } from '../domain/safety.js';

/** Event type → category key used by .cat-* classes and icons. */
export const CATEGORY = Object.freeze({ feed: 'feed', pump: 'pump', sleep: 'sleep', diaper: 'diaper', milestone: 'mem', memory: 'mem', stash: 'pump' });

/**
 * Category key for an event or type ('feed'|'sleep'|'diaper'|'pump'|'mem').
 * @param {object|string} eventOrType
 * @returns {string}
 */
export function categoryOf(eventOrType) {
  const type = typeof eventOrType === 'string' ? eventOrType : eventOrType && eventOrType.type;
  return CATEGORY[type] || 'neutral';
}

/**
 * The .cat-* scope class for an event or type (sets --c-tint/--c-ink/…).
 * @param {object|string} eventOrType
 * @returns {string}
 */
export function categoryClass(eventOrType) {
  return `cat-${categoryOf(eventOrType)}`;
}

/**
 * "4 oz" / "120 mL" / "—", optionally converted to the display unit.
 * @param {unknown} value
 * @param {unknown} unit the unit the amount is stored in
 * @param {unknown} [displayUnit]
 * @returns {string}
 */
export function amount(value, unit, displayUnit) {
  return formatAmount(value, unit, displayUnit);
}

/**
 * Amount split for big-numeral + small-unit rendering.
 * @param {unknown} value
 * @param {unknown} unit
 * @param {unknown} [displayUnit]
 * @returns {{ value: string, unit: 'oz'|'mL', missing: boolean }}
 */
export function amountSplit(value, unit, displayUnit) {
  return amountParts(value, unit, displayUnit);
}

/**
 * Elapsed span split into numeral parts for the since-last cards:
 *   < 1 min  → [] (render the words "Just now")
 *   < 1 h    → [{v:'55', u:'m'}]
 *   < 24 h   → [{v:'2', u:'h'}, {v:'10', u:'m'}] (minutes 2-digit: '3h 00m')
 *   ≥ 24 h   → [{v:'1', u:'d'}, {v:'4', u:'h'}]
 * Truncates (59m59s is "59m"), never rounds up, so it can't claim more time.
 * @param {number} ms
 * @returns {Array<{ v: string, u: 'd'|'h'|'m' }>}
 */
export function spanParts(ms) {
  if (!Number.isFinite(ms) || ms < MINUTE) return [];
  const totalMin = Math.floor(ms / MINUTE);
  if (totalMin < 60) return [{ v: String(totalMin), u: 'm' }];
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) return [{ v: String(totalH), u: 'h' }, { v: String(totalMin % 60).padStart(2, '0'), u: 'm' }];
  const d = Math.floor(totalH / 24);
  return [{ v: String(d), u: 'd' }, { v: String(totalH % 24), u: 'h' }];
}

/**
 * Compact span text: "55m", "2h 10m", "3h 00m", "1d 4h", or "Just now".
 * @param {number} ms
 * @returns {string}
 */
export function span(ms) {
  const parts = spanParts(ms);
  return parts.length ? parts.map(p => p.v + p.u).join(' ') : 'Just now';
}

/**
 * "2h 10m ago" / "55m ago" / "Just now". Future timestamps (clock skew)
 * read "Just now" rather than "in 5m" — a log never happens in the future.
 * @param {Date|number} ts
 * @param {Date|number} [now]
 * @returns {string}
 */
export function since(ts, now = Date.now()) {
  const t = toMs(ts);
  const n = toMs(now);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return '';
  const parts = spanParts(n - t);
  return parts.length ? `${parts.map(p => p.v + p.u).join(' ')} ago` : 'Just now';
}

/**
 * Spoken form of a span for aria-labels: "2 hours 10 minutes".
 * @param {number} ms
 * @returns {string}
 */
export function spanSpoken(ms) {
  const parts = spanParts(ms);
  if (!parts.length) return 'less than a minute';
  const words = { d: ['day', 'days'], h: ['hour', 'hours'], m: ['minute', 'minutes'] };
  return parts
    .map(p => ({ n: Number(p.v), u: p.u }))
    .filter((p, i, all) => p.n > 0 || all.length === 1)
    .map(p => `${p.n} ${words[p.u][p.n === 1 ? 0 : 1]}`)
    .join(' ');
}

/**
 * Wall-clock time with AM/PM: "7:40 AM" (12h locales) or "07:40" (24h).
 * @param {Date|number} ts
 * @param {{ hour12?: boolean }} [opts]
 * @returns {string}
 */
export function clock(ts, { hour12 = prefers12h() } = {}) {
  return timeClock(ts, { hour12, meridiem: true });
}

/**
 * Clock split for the row time column ("7:40" over a small "AM").
 * meridiem is '' in 24-hour locales.
 * @param {Date|number} ts
 * @param {{ hour12?: boolean }} [opts]
 * @returns {{ time: string, meridiem: string }}
 */
export function clockParts(ts, { hour12 = prefers12h() } = {}) {
  return { time: timeClock(ts, { hour12 }), meridiem: hour12 ? timeMeridiem(ts) : '' };
}

/**
 * Duration of a finished activity for row meta: "45 sec", "18 min",
 * "1h 05m".
 * @param {number} ms
 * @returns {string}
 */
export function durationLabel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min';
  if (ms < MINUTE) return `${Math.max(1, Math.floor(ms / 1000))} sec`;
  const totalMin = Math.floor(ms / MINUTE);
  if (totalMin < 60) return `${totalMin} min`;
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
}

/**
 * "Today", "Yesterday", "Wed, Oct 14" (or with year when not this year).
 * @param {Date|number} ts
 * @param {Date|number} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function dayLabel(ts, now = Date.now(), locale) {
  return timeDayLabel(ts, now, locale);
}

/**
 * Always a date, never "Today": "Wed, Oct 14" (adds the year when it isn't
 * the current one).
 * @param {Date|number} ts
 * @param {Date|number} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function dateLabel(ts, now = Date.now(), locale) {
  const t = new Date(toMs(ts));
  if (Number.isNaN(t.getTime())) return '';
  const sameYear = t.getFullYear() === new Date(toMs(now)).getFullYear();
  return t.toLocaleDateString(locale, sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Masthead eyebrow: "Wednesday · October 14" (CSS uppercases it).
 * @param {Date|number} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function eyebrowDate(now = Date.now(), locale) {
  const d = new Date(toMs(now));
  return `${d.toLocaleDateString(locale, { weekday: 'long' })} · ${d.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}`;
}

// birthDate may be 'YYYY-MM-DD' (settings) or epoch ms / Date.
function birthMs(birthDate) {
  if (birthDate === null || birthDate === undefined || birthDate === '') return NaN;
  if (typeof birthDate === 'string') {
    const local = parseLocalDate(birthDate);
    return local === null ? NaN : local;
  }
  return toMs(birthDate);
}

/**
 * Age wording (DESIGN §6.2): "Born today", "1 day", "4 days", "1 week",
 * "6 weeks", "6 weeks, 3 days", then "3 months" from 13 weeks, "1 year,
 * 2 months" from 24 months as "2 years". '' when unknown or in the future.
 * @param {string|number|Date|null} birthDate 'YYYY-MM-DD' or a timestamp
 * @param {Date|number} [at] when (default now) — pass a memory's date for "age at"
 * @returns {string}
 */
export function babyAge(birthDate, at = Date.now()) {
  const b = birthMs(birthDate);
  const t = toMs(at);
  if (!Number.isFinite(b) || !Number.isFinite(t)) return '';
  const days = daysBetween(b, t);
  if (days < 0) return '';
  if (days === 0) return 'Born today';
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const weeks = Math.floor(days / 7);
  if (weeks < 13) {
    const rest = days % 7;
    const w = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    return rest ? `${w}, ${rest} ${rest === 1 ? 'day' : 'days'}` : w;
  }
  const months = Math.max(3, monthsBetween(b, t));
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  const m = months % 12;
  const y = `${years} ${years === 1 ? 'year' : 'years'}`;
  return m ? `${y}, ${m} ${m === 1 ? 'month' : 'months'}` : y;
}

/**
 * A display name for a baby record, with a gender-neutral fallback.
 * @param {{ name?: string }|null|undefined} baby
 * @param {string} [fallback]
 * @returns {string}
 */
export function babyName(baby, fallback = 'Baby') {
  const n = baby && typeof baby.name === 'string' ? baby.name.trim() : '';
  return n || fallback;
}

/**
 * "Clara’s" (typographic apostrophe). Names ending in s get ’s too
 * ("James’s"), which reads naturally aloud.
 * @param {string} name
 * @returns {string}
 */
export function possessive(name) {
  const n = String(name || '').trim();
  return n ? `${n}’s` : '';
}

/**
 * "1 feed" / "3 feeds"; pass the plural for irregular words.
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 * @returns {string}
 */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const DIAPER_WORDS = Object.freeze({ wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty', dry: 'Dry' });
const STORED_WORDS = Object.freeze({ fridge: 'to fridge', freezer: 'to freezer', deepFreezer: 'to deep freezer' });
const SLEEP_WORDS = Object.freeze({ nap: 'Nap', night: 'Night sleep' });

/**
 * Row title for any event (ListRow, detail sheet header).
 * @param {object} event
 * @returns {string}
 */
export function eventTitle(event) {
  if (!event) return '';
  const d = event.data || {};
  switch (event.type) {
    case 'feed':
      if (d.method === 'breast') return 'Breastfeed';
      return d.milk === 'formula' ? 'Bottle · formula' : 'Bottle · breast milk';
    case 'pump': return event.endTime === null ? 'Pumping' : 'Pumped';
    case 'sleep': return SLEEP_WORDS[d.kind] || 'Sleep';
    case 'diaper': return 'Diaper';
    case 'milestone': return (typeof d.title === 'string' && d.title.trim()) || 'Memory';
    default: return '';
  }
}

/**
 * Row meta line for any event: what a parent needs at a glance.
 *   bottle  "Finished in 18 min" · running "Started 12m ago"
 *   breast  "L 8 min · R 6 min" · running "Left side · 14m so far"
 *   pump    "16 min · to fridge" · running "14m so far"
 *   sleep   "Slept 1h 20m" · running "Asleep · 55m so far"
 *   diaper  "Wet" / "Dirty · yellow"
 *   memory  the note (or "")
 * A missing amount (the v1 NaN bug) says so, so the row can offer an edit.
 * @param {object} event
 * @param {{ now?: number }} [opts]
 * @returns {string}
 */
export function eventSubtitle(event, { now = Date.now() } = {}) {
  if (!event) return '';
  const d = event.data || {};
  const running = event.endTime === null;
  const took = running ? now - event.startTime : event.endTime - event.startTime;
  switch (event.type) {
    case 'feed': {
      if (d.method === 'breast') {
        const t = breastSideTotals(d, now);
        if (running) {
          if (!d.activeSide) return `Paused · ${span(t.total * 1000)} so far`;
          return `${d.activeSide === 'left' ? 'Left' : 'Right'} side · ${span(t.total * 1000)} so far`;
        }
        const sides = [];
        if (t.left) sides.push(`L ${durationLabel(t.left * 1000)}`);
        if (t.right) sides.push(`R ${durationLabel(t.right * 1000)}`);
        return sides.length ? sides.join(' · ') : durationLabel(took);
      }
      if (running) return `Started ${since(event.startTime, now)}`;
      if (d.amount === null || d.amount === undefined) return 'Amount not recorded · tap to add';
      return took >= MINUTE ? `Finished in ${durationLabel(took)}` : (event.note ? firstLine(event.note) : '');
    }
    case 'pump': {
      if (running) return `${span(took)} so far`;
      const bits = [];
      if (took >= MINUTE) bits.push(durationLabel(took));
      if (STORED_WORDS[d.storedTo]) bits.push(STORED_WORDS[d.storedTo]);
      if (d.amount === null || d.amount === undefined) bits.push('amount not recorded');
      return bits.join(' · ');
    }
    case 'sleep':
      return running ? `Asleep · ${span(took)} so far` : `Slept ${span(took) === 'Just now' ? '<1m' : span(took)}`;
    case 'diaper': {
      const words = [DIAPER_WORDS[d.kind] || 'Diaper'];
      if (d.color) words.push(d.color);
      return words.join(' · ');
    }
    case 'milestone':
      return event.note ? firstLine(event.note) : '';
    default:
      return '';
  }
}

/**
 * Trailing amount for a row ({ value, unit } in the display unit), or null
 * when the event type has none.
 * @param {object} event
 * @param {'oz'|'mL'} [displayUnit]
 * @returns {{ value: string, unit: 'oz'|'mL', missing: boolean }|null}
 */
export function eventAmount(event, displayUnit) {
  if (!event || !event.data) return null;
  const d = event.data;
  const hasAmount = event.type === 'pump' || (event.type === 'feed' && d.method !== 'breast');
  if (!hasAmount) return null;
  return amountParts(d.amount, normalizeUnit(d.unit), displayUnit === undefined ? normalizeUnit(d.unit) : displayUnit);
}

/**
 * One-sentence accessible label for a row: "Bottle · formula, 4 oz, 7:40 AM.
 * Finished in 18 min."
 * @param {object} event
 * @param {{ now?: number, displayUnit?: 'oz'|'mL', hour12?: boolean }} [opts]
 * @returns {string}
 */
export function eventLabel(event, { now = Date.now(), displayUnit, hour12 } = {}) {
  if (!event) return '';
  const parts = [eventTitle(event)];
  const amt = eventAmount(event, displayUnit);
  if (amt && !amt.missing) parts.push(`${amt.value} ${amt.unit}`);
  parts.push(event.endTime === null ? `since ${clock(event.startTime, { hour12 })}` : clock(event.startTime, { hour12 }));
  const sub = eventSubtitle(event, { now });
  return `${parts.join(', ')}.${sub ? ` ${sub}.` : ''}`;
}

function firstLine(s) {
  return String(s).split('\n')[0].slice(0, 120);
}

/**
 * Is `ts` within the given local day offset from now? (0 = today.)
 * Convenience for list grouping.
 * @param {Date|number} ts
 * @param {number} offsetDays
 * @param {Date|number} [now]
 * @returns {boolean}
 */
export function isDayOffset(ts, offsetDays, now = Date.now()) {
  return daysBetween(addDays(now, offsetDays), ts) === 0;
}

/** Hours/minutes constants re-exported for view math. */
export { MINUTE, HOUR };

/** The format API as one object, for ctx injection (ARCHITECTURE §5.2). */
export const format = Object.freeze({
  CATEGORY, categoryOf, categoryClass, amount, amountSplit, spanParts, span, since, spanSpoken,
  clock, clockParts, durationLabel, dayLabel, dateLabel, eyebrowDate, babyAge, babyName, possessive,
  plural, eventTitle, eventSubtitle, eventAmount, eventLabel, isDayOffset,
});
