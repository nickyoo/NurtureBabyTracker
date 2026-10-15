// Sleep: nap vs night classification, age-based wake windows, awake time
// (pure). Wake-window ranges are the commonly cited newborn/infant guidance;
// they are a gentle hint, never a rule, and the UI should say so.

import { toMs, monthsBetween, daysBetween, MINUTE } from '../core/time.js';

/** Sleeps starting at or after this local hour count as night… */
export const NIGHT_START_HOUR = 19;
/** …until this local hour (exclusive) the next morning. */
export const NIGHT_END_HOUR = 6;

/**
 * 'night' for sleeps starting 19:00–05:59 local time, otherwise 'nap'.
 * The user can always override the kind on the event.
 * @param {Date|number} start
 * @param {{ nightStartHour?: number, nightEndHour?: number }} [opts]
 * @returns {'nap'|'night'}
 */
export function classifyNapOrNight(start, { nightStartHour = NIGHT_START_HOUR, nightEndHour = NIGHT_END_HOUR } = {}) {
  const h = new Date(toMs(start)).getHours();
  return h >= nightStartHour || h < nightEndHour ? 'night' : 'nap';
}

// Bands are checked in order; `maxDays`/`maxMonths` are exclusive upper ages.
const WAKE_WINDOWS = Object.freeze([
  { maxDays: 28, min: 35, max: 60, label: '0–4 weeks' },
  { maxDays: 84, min: 60, max: 90, label: '4–12 weeks' },
  { maxMonths: 5, min: 75, max: 120, label: '3–4 months' },
  { maxMonths: 7, min: 120, max: 180, label: '5–7 months' },
  { maxMonths: 11, min: 150, max: 210, label: '7–10 months' },
  { maxMonths: 15, min: 180, max: 240, label: '11–14 months' },
]);

/**
 * Typical wake window for the baby's age, in minutes. null when the birth
 * date is unknown/invalid, in the future, or the baby is past 14 months
 * (where the hint stops being useful).
 * @param {string|Date|number|null} birthDate 'YYYY-MM-DD' (local) preferred
 * @param {Date|number} [now]
 * @returns {{min:number, max:number, label:string}|null}
 */
export function wakeWindowForAge(birthDate, now = Date.now()) {
  if (birthDate === null || birthDate === undefined || birthDate === '') return null;
  const born = toMs(birthDate);
  const n = toMs(now);
  if (!Number.isFinite(born) || !Number.isFinite(n) || born > n) return null;
  const days = daysBetween(born, n);
  const months = monthsBetween(born, n);
  for (const band of WAKE_WINDOWS) {
    if (band.maxDays !== undefined ? days < band.maxDays : months < band.maxMonths) {
      return { min: band.min, max: band.max, label: band.label };
    }
  }
  return null;
}

/**
 * Current sleep state from events (any types; only `sleep` is considered).
 *  - 'asleep' since the running sleep's start
 *  - 'awake' since the most recent finished sleep's end
 *  - 'unknown' when no sleep has been logged
 * Sleeps that start after `now` (clock skew, future edits) are ignored.
 * @param {object[]} events
 * @param {Date|number} [now]
 * @returns {{ state: 'asleep'|'awake'|'unknown', since: number|null, event: object|null }}
 */
export function sleepState(events, now = Date.now()) {
  const n = toMs(now);
  let running = null;
  let lastEnded = null;
  for (const e of events || []) {
    if (!e || e.type !== 'sleep' || !Number.isFinite(e.startTime) || e.startTime > n) continue;
    if (e.endTime === null || e.endTime === undefined || e.endTime > n) {
      if (!running || e.startTime > running.startTime) running = e;
    } else if (!lastEnded || e.endTime > lastEnded.endTime) {
      lastEnded = e;
    }
  }
  if (running && (!lastEnded || running.startTime >= lastEnded.endTime)) {
    return { state: 'asleep', since: running.startTime, event: running };
  }
  if (lastEnded) return { state: 'awake', since: lastEnded.endTime, event: lastEnded };
  return { state: 'unknown', since: null, event: null };
}

/**
 * When the baby last woke up (epoch ms), or null if asleep now or unknown.
 * @param {object[]} events
 * @param {Date|number} [now]
 * @returns {number|null}
 */
export function awakeSince(events, now = Date.now()) {
  const s = sleepState(events, now);
  return s.state === 'awake' ? s.since : null;
}

/**
 * Suggested next-nap window ("sweet spot") from wake time + age:
 * { from, to } epoch ms, or null without a wake time or a wake window.
 * @param {number|null} wokeAt
 * @param {string|Date|number|null} birthDate
 * @param {Date|number} [now]
 * @returns {{from:number, to:number, min:number, max:number}|null}
 */
export function nextNapWindow(wokeAt, birthDate, now = Date.now()) {
  if (!Number.isFinite(wokeAt)) return null;
  const w = wakeWindowForAge(birthDate, now);
  if (!w) return null;
  return { from: wokeAt + w.min * MINUTE, to: wokeAt + w.max * MINUTE, min: w.min, max: w.max };
}
