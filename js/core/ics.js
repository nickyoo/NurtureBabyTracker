// Calendar pump reminders (ARCHITECTURE §10c): the next N days of pump times
// as an RFC 5545 .ics file with an alarm on each, shared to the phone's
// Calendar. Web apps can't alert while closed; Calendar can — and nothing
// leaves the device (the file goes to the OS share sheet or a download).
//
// The text builder is PURE and tested. Times are absolute instants (last pump
// end + k × interval), so a pump every 3h stays every 3h of real time across a
// DST change. By default they're written in UTC ("…Z"), which every calendar
// converts to local time. Passing `tzid` writes local wall times with that
// TZID instead and includes a matching VTIMEZONE (RFC 5545 requires one for
// every TZID used), generated from Intl for exactly the exported window.

import { addDays } from './time.js';
import { shareFile } from './backup.js';
import { last } from './store.js';
import { get as getSetting, load as loadSettings } from './settings.js';

export const ICS_PRODID = '-//Nurture//Pump schedule 1.0//EN';
/** Hard cap on VEVENTs in one file (a 1-minute interval can't make 10k). */
export const MAX_ICS_EVENTS = 500;
/** Longest export window. */
export const MAX_ICS_DAYS = 60;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const CRLF = '\r\n';
// IANA zone names only: letters, digits, _ + - and up to three slashes. This
// value is written into the file verbatim, so it must never carry CR/LF, ';'
// or ':' (property-parameter injection).
const TZID_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,3}$/;

/**
 * Escape a TEXT value (RFC 5545 §3.3.11): backslash, semicolon, comma and
 * newlines; other control characters are dropped. Pure.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeText(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function utf8Length(codePoint) {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Fold a content line to ≤ 75 octets per physical line (RFC 5545 §3.1):
 * CRLF + one space before each continuation. Counts UTF-8 bytes and never
 * splits a multi-byte character. Pure.
 * @param {string} line one unfolded content line (no CR/LF inside)
 * @returns {string}
 */
export function foldLine(line) {
  let out = '';
  let cur = '';
  let bytes = 0;
  let limit = 75; // the first line; continuations spend 1 octet on the space
  for (const ch of String(line)) {
    const n = utf8Length(ch.codePointAt(0));
    if (bytes + n > limit) {
      out += `${cur}${CRLF} `;
      cur = '';
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += n;
  }
  return out + cur;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * UTC DATE-TIME: 20261015T130500Z. Pure.
 * @param {number} ts epoch ms
 * @returns {string}
 */
export function formatUtc(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const dtfCache = new Map();
function zoneFormatter(tzid) {
  let f = dtfCache.get(tzid);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tzid, f);
  }
  return f;
}

function zoneParts(ts, tzid) {
  const p = {};
  for (const { type, value } of zoneFormatter(tzid).formatToParts(new Date(ts))) p[type] = value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/**
 * Offset of `tzid` from UTC at instant `ts`, in minutes (EDT → -240). Pure.
 * @param {number} ts
 * @param {string} tzid
 * @returns {number}
 */
export function zoneOffsetMinutes(ts, tzid) {
  const p = zoneParts(ts, tzid);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / MINUTE);
}

/**
 * Local DATE-TIME (no Z) of `ts` in `tzid`: 20261101T010000. Pure.
 * @param {number} ts
 * @param {string} tzid
 * @returns {string}
 */
export function formatLocal(ts, tzid) {
  const p = zoneParts(ts, tzid);
  return `${p.y}${pad(p.mo)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}${pad(p.s)}`;
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const m = Math.abs(minutes);
  return `${sign}${pad(Math.floor(m / 60))}${pad(m % 60)}`;
}

/**
 * Validate an IANA time zone name; throws RangeError if unusable.
 * @param {unknown} tzid
 * @returns {string}
 */
export function assertTzid(tzid) {
  if (typeof tzid !== 'string' || tzid.length > 64 || !TZID_RE.test(tzid)) throw new RangeError('Invalid time zone');
  try { zoneFormatter(tzid); } catch { throw new RangeError('Unknown time zone'); }
  return tzid;
}

/**
 * The pump times to export (pure): last pump end + k × interval, keeping only
 * times in [now, now + days), at most MAX_ICS_EVENTS. With no last pump the
 * schedule starts one interval from now. If pumps are overdue, the rhythm is
 * kept (the next time is the first slot ≥ now), never a burst of past times.
 * Throws RangeError for a zero/negative/non-finite interval or day count.
 * @param {{ lastPumpEnd?: number|null, intervalMinutes: number, days?: number, now?: number }} opts
 * @returns {number[]} epoch ms, ascending
 */
export function pumpTimes({ lastPumpEnd = null, intervalMinutes, days = 7, now = Date.now() } = {}) {
  if (typeof intervalMinutes !== 'number' || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new RangeError('intervalMinutes must be a positive number');
  }
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) throw new RangeError('days must be a positive number');
  if (!Number.isFinite(now)) throw new RangeError('now must be a timestamp');
  const step = intervalMinutes * MINUTE;
  const end = addDays(now, Math.min(MAX_ICS_DAYS, Math.ceil(days)));
  let t = (Number.isFinite(lastPumpEnd) ? lastPumpEnd : now) + step;
  if (t < now) t += Math.ceil((now - t) / step) * step;
  const out = [];
  for (; t < end && out.length < MAX_ICS_EVENTS; t += step) out.push(Math.round(t));
  return out;
}

// VTIMEZONE covering [from, to]: one observance for the offset in force at
// `from`, plus one per transition inside the window (found by hourly steps,
// then narrowed to the minute). Explicit onsets, no RRULE — valid RFC 5545
// and exact for the exported range, with no hand-written DST rules to rot.
function vtimezone(tzid, from, to) {
  const year = new Date(from).getUTCFullYear();
  const standard = Math.min(zoneOffsetMinutes(Date.UTC(year, 0, 1), tzid), zoneOffsetMinutes(Date.UTC(year, 6, 1), tzid));
  const kind = off => (off > standard ? 'DAYLIGHT' : 'STANDARD');
  const start = Math.floor(from / HOUR) * HOUR;
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tzid}`];
  const observance = (onset, fromOff, toOff) => {
    // DTSTART is the onset in local time BEFORE the change (TZOFFSETFROM).
    const local = new Date(onset + fromOff * MINUTE);
    const stampLocal = `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}00`;
    lines.push(`BEGIN:${kind(toOff)}`, `DTSTART:${stampLocal}`, `TZOFFSETFROM:${formatOffset(fromOff)}`, `TZOFFSETTO:${formatOffset(toOff)}`, `END:${kind(toOff)}`);
  };
  let prevOff = zoneOffsetMinutes(start, tzid);
  observance(start, prevOff, prevOff);
  for (let t = start; t < to; t += HOUR) {
    const next = Math.min(t + HOUR, to);
    const off = zoneOffsetMinutes(next, tzid);
    if (off === prevOff) continue;
    let lo = t;
    let hi = next; // offset(lo) = prevOff, offset(hi) = off
    while (hi - lo > MINUTE) {
      const mid = Math.floor((lo + hi) / 2 / MINUTE) * MINUTE;
      if (mid <= lo || mid >= hi) break;
      if (zoneOffsetMinutes(mid, tzid) === prevOff) lo = mid; else hi = mid;
    }
    observance(hi, prevOff, off);
    prevOff = off;
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

/**
 * RFC 5545 calendar of upcoming pump times (pure). CRLF line endings, lines
 * folded at 75 octets, one VEVENT per pump with a deterministic UID (so
 * re-importing the same schedule updates instead of duplicating), DTSTAMP,
 * and a DISPLAY alarm at the start time (TRIGGER:-PT0M).
 * @param {{
 *   lastPumpEnd?: number|null, intervalMinutes: number, days?: number, now?: number, tzid?: string,
 *   durationMinutes?: number, summary?: string, description?: string, calendarName?: string
 * }} opts
 * @returns {string}
 */
export function pumpScheduleIcs({
  lastPumpEnd = null, intervalMinutes, days = 7, now = Date.now(), tzid,
  durationMinutes = 20, summary = 'Pump', description = 'Time to pump — from Nurture', calendarName = 'Nurture pump schedule',
} = {}) {
  const times = pumpTimes({ lastPumpEnd, intervalMinutes, days, now });
  const zone = tzid === undefined || tzid === null || tzid === '' ? null : assertTzid(tzid);
  const dur = Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.min(durationMinutes, intervalMinutes, 240) : 20;
  const title = escapeText(String(summary ?? '').slice(0, 200)) || 'Pump';
  const desc = escapeText(String(description ?? '').slice(0, 2000));
  const dt = (name, ts) => (zone ? `${name};TZID=${zone}:${formatLocal(ts, zone)}` : `${name}:${formatUtc(ts)}`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(String(calendarName ?? '').slice(0, 200))}`,
  ];
  if (zone && times.length) lines.push(...vtimezone(zone, Math.min(now, times[0]), times[times.length - 1] + dur * MINUTE + HOUR));
  const stamp = formatUtc(now);
  for (const t of times) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:nurture-pump-${formatUtc(t)}@nurture.local`,
      `DTSTAMP:${stamp}`,
      dt('DTSTART', t),
      dt('DTEND', t + dur * MINUTE),
      `SUMMARY:${title}`,
      ...(desc ? [`DESCRIPTION:${desc}`] : []),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title}`,
      'TRIGGER:-PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Build the schedule from the live data (last finished pump, Settings
 * interval) unless given, and share it to Calendar via the OS share sheet,
 * or download it. Call from a user gesture.
 * @param {{ lastPumpEnd?: number|null, intervalMinutes?: number, days?: number, tzid?: string, summary?: string, description?: string }} [opts]
 * @returns {Promise<'share'|'download'|'cancelled'>}
 */
export async function shareIcs(opts = {}) {
  await loadSettings();
  let lastPumpEnd = opts.lastPumpEnd;
  if (lastPumpEnd === undefined) {
    const pump = await last('pump');
    lastPumpEnd = pump ? (pump.endTime ?? pump.startTime) : null;
  }
  const text = pumpScheduleIcs({
    ...opts,
    lastPumpEnd,
    intervalMinutes: opts.intervalMinutes ?? getSetting('pumpIntervalMinutes'),
    now: Date.now(),
  });
  const file = new File([text], 'nurture-pump-schedule.ics', { type: 'text/calendar;charset=utf-8' });
  return shareFile(file, { title: 'Pump schedule' });
}

/** The ICS API as one object. */
export const ics = Object.freeze({ pumpScheduleIcs, pumpTimes, shareIcs, escapeText, foldLine });
