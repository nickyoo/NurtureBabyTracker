// Relative time, durations, clocks and local-day bounds (pure, no DOM).
//
// Every function takes an injectable `now` so views and tests agree on the
// same instant. Day math is done with the local calendar (new Date(y, m, d))
// rather than by adding 24h, because DST days are 23h or 25h long — adding
// 86 400 000 ms across a DST change lands on 23:00 or 01:00 and files events
// under the wrong day.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Coerce Date | epoch ms | ISO string to epoch ms (NaN when invalid).
 * @param {Date|number|string} d
 * @returns {number}
 */
export function toMs(d) {
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number') return d;
  if (typeof d === 'string') {
    const local = parseLocalDate(d);
    return local === null ? Date.parse(d) : local;
  }
  return NaN;
}

/**
 * Parse 'YYYY-MM-DD' as LOCAL midnight. (`new Date('2026-01-15')` is UTC
 * midnight, which is the previous evening anywhere west of Greenwich.)
 * @param {string} s
 * @returns {number|null} epoch ms, or null if not a plain date string
 */
export function parseLocalDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  // Reject rollovers like 2026-02-31.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt.getTime();
}

/**
 * Local midnight at the start of the day containing `date`.
 * @param {Date|number} date
 * @returns {number} epoch ms
 */
export function startOfDay(date) {
  const d = new Date(toMs(date));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Shift a date by whole calendar days, keeping local wall-clock time
 * (DST-safe: 2 days after Saturday 09:00 is Monday 09:00 even across a
 * clock change).
 * @param {Date|number} date
 * @param {number} days
 * @returns {number} epoch ms
 */
export function addDays(date, days) {
  const d = new Date(toMs(date));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

/**
 * Local day bounds: `start` is local midnight, `end` is the NEXT local
 * midnight (exclusive). 23h/25h on DST days.
 * @param {Date|number} date
 * @returns {{ start: number, end: number }}
 */
export function dayBounds(date) {
  const d = new Date(toMs(date));
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start, end };
}

/**
 * Same local calendar day?
 * @param {Date|number} a
 * @param {Date|number} b
 * @returns {boolean}
 */
export function isSameDay(a, b) {
  const x = new Date(toMs(a));
  const y = new Date(toMs(b));
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * Local 'YYYY-MM-DD' key (sorts correctly, keeps the user's own day — unlike
 * toISOString, which is UTC).
 * @param {Date|number} date
 * @returns {string}
 */
export function dayKey(date) {
  const d = new Date(toMs(date));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * "just now", "5m ago", "2h 10m ago", "3h ago", "1d 4h ago", "in 5m".
 * @param {Date|number} ts
 * @param {Date|number} [now]
 * @returns {string}
 */
export function relative(ts, now = Date.now()) {
  const t = toMs(ts);
  const n = toMs(now);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return '';
  const diff = n - t;
  if (Math.abs(diff) < MINUTE) return 'just now';
  const span = compactSpan(Math.abs(diff));
  return diff > 0 ? `${span} ago` : `in ${span}`;
}

/**
 * Compact span used by relative(): "5m", "2h 10m", "3h", "1d 4h", "3d".
 * Truncates (a feed 59m59s ago is "59m ago", not "1h ago").
 * @param {number} ms
 * @returns {string}
 */
export function compactSpan(ms) {
  const totalMin = Math.floor(Math.max(0, ms) / MINUTE);
  if (totalMin < 60) return `${totalMin}m`;
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) {
    const m = totalMin % 60;
    return m ? `${totalH}h ${m}m` : `${totalH}h`;
  }
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Duration label: "45s", "12m", "1h 05m", "26h 00m". Input in milliseconds.
 * Negative/NaN → "0m".
 * @param {number} ms
 * @returns {string}
 */
export function duration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalSec = Math.floor(ms / SECOND);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  return `${h}h ${pad2(totalMin % 60)}m`;
}

/**
 * Running-timer clock from SECONDS: 65 → "01:05", 3665 → "1:01:05".
 * (Port of v1 fmtClock; negative clamps to 0 so clock skew never shows "-".)
 * @param {number} totalSeconds
 * @returns {string}
 */
export function timerClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const secs = s % 60;
  const mins = Math.floor(s / 60);
  const hrs = Math.floor(mins / 60);
  const mm = pad2(mins % 60);
  const ss = pad2(secs);
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** v1 name kept so ported call sites and tests read the same. */
export const fmtClock = timerClock;

/**
 * Does this locale use a 12-hour clock? (Intl; defaults to true when unknown.)
 * @param {string} [locale]
 * @returns {boolean}
 */
export function prefers12h(locale) {
  try {
    const hc = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    if (hc) return hc === 'h12' || hc === 'h11';
    return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 !== false;
  } catch {
    return true;
  }
}

/**
 * Wall-clock time of a timestamp: "12:04" / "3:04" (12h) or "15:04" (24h).
 * The AM/PM marker is separate (meridiem()) so the UI can set it smaller;
 * pass { meridiem: true } to get "3:04 PM" in one string.
 * @param {Date|number} ts
 * @param {{ hour12?: boolean, meridiem?: boolean }} [opts]
 * @returns {string}
 */
export function clock(ts, { hour12 = prefers12h(), meridiem: withMeridiem = false } = {}) {
  const d = new Date(toMs(ts));
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const mm = pad2(d.getMinutes());
  if (!hour12) return `${pad2(h)}:${mm}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return withMeridiem ? `${h12}:${mm} ${meridiem(d)}` : `${h12}:${mm}`;
}

/**
 * 'AM' | 'PM' for a timestamp.
 * @param {Date|number} ts
 * @returns {'AM'|'PM'}
 */
export function meridiem(ts) {
  return new Date(toMs(ts)).getHours() < 12 ? 'AM' : 'PM';
}

/**
 * Day heading: "Today", "Yesterday", or e.g. "Mon, Oct 12" (locale-aware).
 * @param {Date|number} ts
 * @param {Date|number} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function dayLabel(ts, now = Date.now(), locale) {
  const t = toMs(ts);
  if (isSameDay(t, now)) return 'Today';
  if (isSameDay(t, addDays(now, -1))) return 'Yesterday';
  const sameYear = new Date(t).getFullYear() === new Date(toMs(now)).getFullYear();
  return new Date(t).toLocaleDateString(locale, sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Whole calendar months between two dates (birthday-style: 15 Jan → 14 Feb is
 * 0 months, → 15 Feb is 1). Negative when `to` is before `from`.
 * @param {Date|number} from
 * @param {Date|number} to
 * @returns {number}
 */
export function monthsBetween(from, to) {
  const a = new Date(toMs(from));
  const b = new Date(toMs(to));
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (months > 0 && b.getDate() < a.getDate()) months -= 1;
  else if (months < 0 && b.getDate() > a.getDate()) months += 1;
  return months;
}

/**
 * Whole local calendar days between two dates (DST-safe).
 * @param {Date|number} from
 * @param {Date|number} to
 * @returns {number}
 */
export function daysBetween(from, to) {
  const a = new Date(startOfDay(from));
  const b = new Date(startOfDay(to));
  // Date.UTC of the local Y/M/D strips DST so the division is exact.
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
