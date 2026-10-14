// Bottle safety windows, feeding pace and live-bottle status (pure).
// Ported from v1 js/app.js so the live bottle's CDC countdown has exactly one
// implementation, derived from the running event's startTime — which is what
// lets a bottle survive a reload with no localStorage (ARCHITECTURE §3).

import { toFiniteNumber } from '../core/units.js';

/**
 * CDC safety window for a started bottle, in seconds. Formula is only good
 * for 1 hour once feeding begins; breast milk for 2 hours. Unknown types get
 * the breast-milk window (v1 behaviour). `storageWindows.startedBottleHours`
 * (Settings) can override the breast-milk window; formula stays 1h.
 * @param {string} feedType 'formula' | 'breastmilk'
 * @param {{startedBottleHours?: number}} [storageWindows]
 * @returns {number}
 */
export function safetyWindowSec(feedType, storageWindows) {
  if (feedType === 'formula') return 3600;
  const h = toFiniteNumber(storageWindows && storageWindows.startedBottleHours);
  return h !== null && h > 0 ? Math.round(h * 3600) : 7200;
}

/**
 * Feeding pace per minute, rounded to 2 decimals; 0 when unmeasurable.
 * Unit-agnostic (oz/min or mL/min — whatever unit `eaten` is in).
 * @param {number} eaten
 * @param {number} durationSec
 * @returns {number}
 */
export function paceOzPerMin(eaten, durationSec) {
  if (!durationSec || durationSec <= 0 || !eaten || eaten <= 0) return 0;
  return Math.round((eaten / (durationSec / 60)) * 100) / 100;
}

/** Unit-agnostic alias of paceOzPerMin (the math never cared about oz). */
export const pacePerMin = paceOzPerMin;

/**
 * Human safety-countdown label: 4500 → "1h 15m", 900 → "15m", <=0 → "expired".
 * @param {number} remainingSec
 * @returns {string}
 */
export function fmtSafetyWindow(remainingSec) {
  if (!(remainingSec > 0)) return 'expired';
  const mins = Math.ceil(remainingSec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Pure bottle-timer state from the wall clock: elapsed + safety countdown.
 * The UI just re-renders from timestamps, so backgrounding can't drift it.
 * @param {number} startTs epoch ms the bottle started
 * @param {string} feedType 'formula' | 'breastmilk'
 * @param {number} nowTs
 * @param {object} [storageWindows]
 * @returns {{elapsedSec:number, windowSec:number, safetyRemainingSec:number, expired:boolean}}
 */
export function getBottleTimerStatus(startTs, feedType, nowTs, storageWindows) {
  const elapsedSec = Math.max(0, Math.floor((nowTs - startTs) / 1000));
  const windowSec = safetyWindowSec(feedType, storageWindows);
  const safetyRemainingSec = windowSec - elapsedSec;
  return { elapsedSec, windowSec, safetyRemainingSec, expired: safetyRemainingSec <= 0 };
}

/**
 * Tone for the countdown: 'ok' → 'soon' (last 15 min) → 'expired'. Status is
 * conveyed in text too; this only picks the color/icon (AUDIT §5).
 * @param {number} remainingSec
 * @returns {'ok'|'soon'|'expired'}
 */
export function safetyLevel(remainingSec) {
  if (!(remainingSec > 0)) return 'expired';
  return remainingSec <= 15 * 60 ? 'soon' : 'ok';
}

/**
 * Live status for a RUNNING bottle-feed event (`type:'feed'`,
 * `data.method:'bottle'`). Returns null for anything else (breastfeeding,
 * finished feeds), so the live pill can call it blindly.
 * @param {object} event
 * @param {number} [now]
 * @param {object} [storageWindows]
 * @returns {null | {elapsedSec:number, windowSec:number, safetyRemainingSec:number, expired:boolean, level:'ok'|'soon'|'expired', label:string, fraction:number}}
 */
export function bottleSafety(event, now = Date.now(), storageWindows) {
  if (!event || event.type !== 'feed' || event.endTime !== null) return null;
  const data = event.data || {};
  if (data.method !== 'bottle') return null;
  const st = getBottleTimerStatus(event.startTime, data.milk === 'formula' ? 'formula' : 'breastmilk', now, storageWindows);
  return {
    ...st,
    level: safetyLevel(st.safetyRemainingSec),
    label: fmtSafetyWindow(st.safetyRemainingSec),
    // 1 → full window left, 0 → expired (for a progress bar).
    fraction: Math.max(0, Math.min(1, st.safetyRemainingSec / st.windowSec)),
  };
}

/**
 * Breastfeeding side totals in seconds, including the side that is running
 * right now (`data.activeSide` since `data.activeSince`).
 * @param {{left?:number, right?:number, activeSide?:'left'|'right'|null, activeSince?:number}} data
 * @param {number} [now]
 * @returns {{left:number, right:number, total:number}}
 */
export function breastSideTotals(data, now = Date.now()) {
  const d = data || {};
  let left = Math.max(0, toFiniteNumber(d.left) ?? 0);
  let right = Math.max(0, toFiniteNumber(d.right) ?? 0);
  const since = toFiniteNumber(d.activeSince);
  if ((d.activeSide === 'left' || d.activeSide === 'right') && since !== null) {
    const live = Math.max(0, Math.floor((now - since) / 1000));
    if (d.activeSide === 'left') left += live; else right += live;
  }
  return { left, right, total: left + right };
}

/**
 * The data patch for switching/pausing breastfeeding sides: banks the running
 * side's seconds, then starts `side` (or pauses when side is null). Feed it to
 * events.update(id, { data: patch }).
 * @param {object} data current event.data
 * @param {'left'|'right'|null} side
 * @param {number} [now]
 * @returns {{left:number, right:number, activeSide:'left'|'right'|null, activeSince:number|null, lastSide:'left'|'right'}}
 */
export function switchBreastSide(data, side, now = Date.now()) {
  const totals = breastSideTotals(data, now);
  const d = data || {};
  const next = side === 'left' || side === 'right' ? side : null;
  return {
    left: totals.left,
    right: totals.right,
    activeSide: next,
    activeSince: next ? now : null,
    lastSide: next || (d.activeSide === 'left' || d.activeSide === 'right' ? d.activeSide : (d.lastSide === 'right' ? 'right' : 'left')),
  };
}
