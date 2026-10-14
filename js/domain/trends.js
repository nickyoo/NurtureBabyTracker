// Aggregates over events (pure): per-day totals by type in a display unit,
// pump totals vs goal, sleep totals, diaper counts, last-N-days series.
//
// Conventions (so every card and chart agrees):
//  - An event belongs to the local day of its startTime (counts, amounts).
//  - Sleep TIME is clipped to the window, so a 21:00–06:00 night splits across
//    the two days it touches; a running sleep counts up to `now`.
//  - Running feeds/pumps (endTime null) are excluded from counts and amounts
//    until they're finished — their final amount isn't known yet.
//  - Amounts convert per event from the unit they were entered in.

import { convertQty, normalizeUnit, roundForUnit, toFiniteNumber } from '../core/units.js';
import { dayBounds, addDays, dayKey, toMs } from '../core/time.js';
import { breastSideTotals } from './safety.js';

/**
 * An event's amount in `unit`, or null when it has none (breastfeeding,
 * diapers, a legacy NaN pump).
 * @param {object} event
 * @param {'oz'|'mL'} unit
 * @returns {number|null}
 */
export function eventAmountIn(event, unit) {
  const d = event && event.data;
  if (!d) return null;
  const n = toFiniteNumber(d.amount);
  if (n === null) return null;
  return convertQty(n, d.unit, unit);
}

/**
 * Milliseconds of [startTime, endTime ?? now) that fall inside [from, to).
 * @param {object} event
 * @param {number} from
 * @param {number} to
 * @param {number} [now]
 * @returns {number}
 */
export function overlapMs(event, from, to, now = Date.now()) {
  if (!event || !Number.isFinite(event.startTime)) return 0;
  const end = event.endTime === null || event.endTime === undefined ? Math.max(event.startTime, now) : event.endTime;
  return Math.max(0, Math.min(end, to) - Math.max(event.startTime, from));
}

const isRunning = e => e.endTime === null || e.endTime === undefined;
const inRange = (e, from, to) => Number.isFinite(e.startTime) && e.startTime >= from && e.startTime < to;

/**
 * Sleep totals overlapping [from, to).
 * @param {object[]} events
 * @param {number} from
 * @param {number} to
 * @param {number} [now]
 * @returns {{count:number, totalMs:number, napMs:number, nightMs:number, longestMs:number}}
 */
export function sleepTotals(events, from, to, now = Date.now()) {
  const out = { count: 0, totalMs: 0, napMs: 0, nightMs: 0, longestMs: 0 };
  for (const e of events || []) {
    if (!e || e.type !== 'sleep') continue;
    const ms = overlapMs(e, from, to, now);
    if (inRange(e, from, to)) out.count += 1;
    if (ms <= 0) continue;
    out.totalMs += ms;
    if (e.data && e.data.kind === 'night') out.nightMs += ms; else out.napMs += ms;
    const whole = overlapMs(e, -Infinity, Infinity, now);
    if (whole > out.longestMs && inRange(e, from, to)) out.longestMs = whole;
  }
  return out;
}

/**
 * Diaper counts for diapers logged in [from, to). `wet` and `dirty` include
 * 'both' (that's how the "6+ wet diapers a day" check counts); `both`,
 * `dry` are the raw kinds.
 * @param {object[]} events
 * @param {number} from
 * @param {number} to
 * @returns {{count:number, wet:number, dirty:number, both:number, dry:number}}
 */
export function diaperCounts(events, from, to) {
  const out = { count: 0, wet: 0, dirty: 0, both: 0, dry: 0 };
  for (const e of events || []) {
    if (!e || e.type !== 'diaper' || !inRange(e, from, to)) continue;
    const kind = e.data && e.data.kind;
    out.count += 1;
    if (kind === 'wet' || kind === 'both') out.wet += 1;
    if (kind === 'dirty' || kind === 'both') out.dirty += 1;
    if (kind === 'both') out.both += 1;
    if (kind === 'dry') out.dry += 1;
  }
  return out;
}

/**
 * Totals for every type over [from, to), amounts in `unit`.
 * @param {object[]} events
 * @param {number} from
 * @param {number} to
 * @param {{ unit?: 'oz'|'mL', now?: number }} [opts]
 * @returns {{
 *   unit:'oz'|'mL',
 *   feed:{count:number, bottleCount:number, breastCount:number, amount:number, formulaAmount:number, breastmilkAmount:number, breastSec:number},
 *   pump:{count:number, amount:number},
 *   sleep:{count:number, totalMs:number, napMs:number, nightMs:number, longestMs:number},
 *   diaper:{count:number, wet:number, dirty:number, both:number, dry:number},
 *   milestone:{count:number}
 * }}
 */
export function rangeTotals(events, from, to, { unit = 'oz', now = Date.now() } = {}) {
  const u = normalizeUnit(unit);
  const feed = { count: 0, bottleCount: 0, breastCount: 0, amount: 0, formulaAmount: 0, breastmilkAmount: 0, breastSec: 0 };
  const pump = { count: 0, amount: 0 };
  const milestone = { count: 0 };
  for (const e of events || []) {
    if (!e || !inRange(e, from, to)) continue;
    if (e.type === 'milestone') { milestone.count += 1; continue; }
    if (isRunning(e)) continue;
    const d = e.data || {};
    if (e.type === 'feed') {
      feed.count += 1;
      if (d.method === 'breast') {
        feed.breastCount += 1;
        feed.breastSec += breastSideTotals(d, now).total;
      } else {
        feed.bottleCount += 1;
        const amt = eventAmountIn(e, u) || 0;
        feed.amount += amt;
        if (d.milk === 'formula') feed.formulaAmount += amt; else feed.breastmilkAmount += amt;
      }
    } else if (e.type === 'pump') {
      pump.count += 1;
      pump.amount += eventAmountIn(e, u) || 0;
    }
  }
  feed.amount = roundForUnit(feed.amount, u);
  feed.formulaAmount = roundForUnit(feed.formulaAmount, u);
  feed.breastmilkAmount = roundForUnit(feed.breastmilkAmount, u);
  pump.amount = roundForUnit(pump.amount, u);
  return {
    unit: u,
    feed,
    pump,
    sleep: sleepTotals(events, from, to, now),
    diaper: diaperCounts(events, from, to),
    milestone,
  };
}

/**
 * Totals for the local day containing `day` (DST-safe bounds).
 * @param {object[]} events
 * @param {Date|number} day
 * @param {{ unit?: 'oz'|'mL', now?: number }} [opts]
 * @returns {ReturnType<typeof rangeTotals> & { dayKey: string, start: number, end: number }}
 */
export function dayTotals(events, day, opts = {}) {
  const { start, end } = dayBounds(day);
  return { dayKey: dayKey(start), start, end, ...rangeTotals(events, start, end, opts) };
}

/**
 * Pumped today vs the daily goal (goal is stored in oz, ARCHITECTURE §6).
 * @param {object[]} events
 * @param {number} goalOz
 * @param {{ unit?: 'oz'|'mL', now?: number, day?: Date|number }} [opts]
 * @returns {{ unit:'oz'|'mL', total:number, goal:number, remaining:number, fraction:number, reached:boolean, count:number }}
 */
export function pumpProgress(events, goalOz, { unit = 'oz', now = Date.now(), day = now } = {}) {
  const u = normalizeUnit(unit);
  const { start, end } = dayBounds(day);
  const totals = rangeTotals(events, start, end, { unit: u, now });
  const g = toFiniteNumber(goalOz);
  const goal = g !== null && g > 0 ? roundForUnit(convertQty(g, 'oz', u), u) : 0;
  const total = totals.pump.amount;
  return {
    unit: u,
    total,
    goal,
    remaining: goal > 0 ? roundForUnit(Math.max(0, goal - total), u) : 0,
    fraction: goal > 0 ? Math.max(0, Math.min(1, total / goal)) : 0,
    reached: goal > 0 && total >= goal,
    count: totals.pump.count,
  };
}

/**
 * Last `n` local days, oldest → newest (today last), each with dayTotals().
 * @param {object[]} events
 * @param {number} [n]
 * @param {{ unit?: 'oz'|'mL', now?: number }} [opts]
 * @returns {Array<ReturnType<typeof dayTotals> & { isToday: boolean }>}
 */
export function lastNDays(events, n = 7, { unit = 'oz', now = Date.now() } = {}) {
  const count = Math.max(0, Math.floor(n));
  if (!count) return [];
  const first = dayBounds(addDays(now, -(count - 1))).start;
  const last = dayBounds(now).end;
  // Pre-filter once so a long history doesn't cost n full scans.
  const windowed = (events || []).filter(e => e && Number.isFinite(e.startTime)
    && (e.startTime < last) && (e.startTime >= first || (e.type === 'sleep' && overlapMs(e, first, last, now) > 0)));
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = dayTotals(windowed, addDays(now, -i), { unit, now });
    out.push({ ...t, isToday: i === 0 });
  }
  return out;
}

/**
 * Group events by local day of startTime, newest day first, events within a
 * day newest first. For the Timeline.
 * @param {object[]} events
 * @returns {Array<{ dayKey: string, start: number, end: number, events: object[] }>}
 */
export function groupByDay(events) {
  const groups = new Map();
  for (const e of events || []) {
    if (!e || !Number.isFinite(e.startTime)) continue;
    const key = dayKey(e.startTime);
    let g = groups.get(key);
    if (!g) {
      const b = dayBounds(e.startTime);
      g = { dayKey: key, start: b.start, end: b.end, events: [] };
      groups.set(key, g);
    }
    g.events.push(e);
  }
  const out = [...groups.values()].sort((a, b) => b.start - a.start);
  for (const g of out) g.events.sort((a, b) => b.startTime - a.startTime);
  return out;
}

/**
 * Most recent event of `type` (by startTime) matching `predicate`, from an
 * in-memory list. Finished events only unless `includeRunning`.
 * @param {object[]} events
 * @param {string} type
 * @param {{ predicate?: (e: object) => boolean, includeRunning?: boolean, now?: Date|number }} [opts]
 * @returns {object|null}
 */
export function latest(events, type, { predicate, includeRunning = false, now } = {}) {
  const cutoff = now === undefined ? Infinity : toMs(now);
  let best = null;
  for (const e of events || []) {
    if (!e || e.type !== type || !Number.isFinite(e.startTime) || e.startTime > cutoff) continue;
    if (!includeRunning && isRunning(e)) continue;
    if (predicate && !predicate(e)) continue;
    if (!best || e.startTime > best.startTime) best = e;
  }
  return best;
}
