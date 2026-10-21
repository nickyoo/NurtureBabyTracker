// core/ics.js — RFC 5545 pump-schedule calendar (pure). Runs in
// America/New_York so the export window really crosses DST changes.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const I = await import('../js/core/ics.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 15, 16, 0); // 12:00 EDT

const physical = text => text.split('\r\n');
const unfold = text => text.replace(/\r\n /g, '');
const contentLines = text => unfold(text).split('\r\n').filter(Boolean);
const octets = s => Buffer.byteLength(s, 'utf8');

test('escapeText: backslash, semicolon, comma, newlines; control chars dropped', () => {
  assert.equal(I.escapeText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(I.escapeText('line1\nline2\r\nline3\rline4'), 'line1\\nline2\\nline3\\nline4');
  assert.equal(I.escapeText('x\u0000y\u0007z'), 'xyz');
  assert.equal(I.escapeText(null), '');
  assert.equal(I.escapeText(42), '42');
  // Backslash first, so the escapes it adds aren't escaped twice.
  assert.equal(I.escapeText('\\,'), '\\\\\\,');
});

test('foldLine: ≤ 75 octets per physical line, continuation starts with one space', () => {
  const short = 'SUMMARY:Pump';
  assert.equal(I.foldLine(short), short);
  const exact = `X:${'a'.repeat(73)}`;
  assert.equal(octets(exact), 75);
  assert.equal(I.foldLine(exact), exact, 'exactly 75 octets is not folded');
  const long = `DESCRIPTION:${'b'.repeat(200)}`;
  const folded = I.foldLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  assert.equal(octets(parts[0]), 75);
  for (const p of parts.slice(1)) {
    assert.ok(p.startsWith(' '), 'continuation begins with a space');
    assert.ok(octets(p) <= 75);
  }
  assert.equal(folded.replace(/\r\n /g, ''), long, 'unfolds back to the original');
});

test('foldLine: counts UTF-8 bytes and never splits a multi-byte character', () => {
  for (const ch of ['é', '—', '👶']) {
    const line = `DESCRIPTION:${ch.repeat(60)}`;
    const folded = I.foldLine(line);
    for (const p of folded.split('\r\n')) {
      assert.ok(octets(p) <= 75, `${ch}: ${octets(p)} octets`);
      assert.ok(!p.includes('�'));
    }
    assert.equal(folded.replace(/\r\n /g, ''), line, `${ch} survives folding intact`);
  }
});

test('formatUtc / formatLocal / zoneOffsetMinutes', () => {
  assert.equal(I.formatUtc(Date.UTC(2026, 0, 5, 3, 4, 5)), '20260105T030405Z');
  assert.equal(I.formatLocal(Date.UTC(2026, 9, 15, 16, 0), 'America/New_York'), '20261015T120000');
  assert.equal(I.formatLocal(Date.UTC(2026, 9, 15, 16, 0), 'Asia/Tokyo'), '20261016T010000');
  assert.equal(I.zoneOffsetMinutes(Date.UTC(2026, 6, 1), 'America/New_York'), -240);
  assert.equal(I.zoneOffsetMinutes(Date.UTC(2026, 0, 1), 'America/New_York'), -300);
  assert.equal(I.zoneOffsetMinutes(Date.UTC(2026, 0, 1), 'Asia/Kolkata'), 330);
  assert.equal(I.zoneOffsetMinutes(Date.UTC(2026, 0, 1), 'UTC'), 0);
});

test('pumpTimes: zero / negative / non-numeric interval or days rejected', () => {
  for (const intervalMinutes of [0, -30, NaN, Infinity, '180', null, undefined]) {
    assert.throws(() => I.pumpTimes({ intervalMinutes, now: NOW }), RangeError, String(intervalMinutes));
    assert.throws(() => I.pumpScheduleIcs({ intervalMinutes, now: NOW }), RangeError, String(intervalMinutes));
  }
  for (const days of [0, -1, NaN, '7']) assert.throws(() => I.pumpTimes({ intervalMinutes: 180, days, now: NOW }), RangeError);
  assert.throws(() => I.pumpTimes({ intervalMinutes: 180, now: NaN }), RangeError);
  assert.throws(() => I.pumpTimes(), RangeError);
});

test('pumpTimes: last end + k × interval inside [now, now + days)', () => {
  const t = I.pumpTimes({ lastPumpEnd: NOW - HOUR, intervalMinutes: 180, days: 1, now: NOW });
  assert.equal(t[0], NOW + 2 * HOUR);
  assert.ok(t.every((x, i) => i === 0 || x - t[i - 1] === 3 * HOUR), 'evenly spaced');
  assert.ok(t.at(-1) < NOW + DAY);
  assert.equal(t.length, 8);
  const fresh = I.pumpTimes({ lastPumpEnd: null, intervalMinutes: 120, days: 1, now: NOW });
  assert.equal(fresh[0], NOW + 2 * HOUR, 'no pump yet → one interval from now');
  const overdue = I.pumpTimes({ lastPumpEnd: NOW - 10 * HOUR, intervalMinutes: 180, days: 1, now: NOW });
  assert.equal(overdue[0], NOW + 2 * HOUR, 'overdue keeps the rhythm (first slot ≥ now), no burst of past times');
  assert.ok(overdue.every(x => x >= NOW));
  const exact = I.pumpTimes({ lastPumpEnd: NOW - 3 * HOUR, intervalMinutes: 180, days: 1, now: NOW });
  assert.equal(exact[0], NOW, 'a slot exactly at now is kept');
});

test('pumpTimes: caps (event count, window length)', () => {
  assert.equal(I.pumpTimes({ intervalMinutes: 1, days: 30, now: NOW }).length, I.MAX_ICS_EVENTS);
  const capped = I.pumpTimes({ intervalMinutes: 24 * 60, days: 365, now: NOW });
  assert.ok(capped.length <= I.MAX_ICS_DAYS + 1);
  assert.equal(I.pumpTimes({ intervalMinutes: 180, days: 0.1, now: NOW }).length, 7, 'fractional days round up to a whole day (+3h … +21h)');
});

test('pumpTimes: absolute instants — every 3h stays 3h of real time across DST', () => {
  const beforeFallBack = Date.UTC(2026, 9, 31, 16); // Sat Oct 31, 12:00 EDT
  const t = I.pumpTimes({ lastPumpEnd: beforeFallBack, intervalMinutes: 180, days: 3, now: beforeFallBack });
  assert.ok(t.every((x, i) => i === 0 || x - t[i - 1] === 3 * HOUR));
  const local = t.map(x => new Date(x).getHours());
  // 00:00 EDT + 3h of real time is 02:00 EST: the wall clock shifts by one
  // hour after the change, the rhythm of real time doesn't.
  assert.deepEqual(local.slice(0, 7), [15, 18, 21, 0, 2, 5, 8]);
});

test('pumpScheduleIcs: RFC 5545 envelope, CRLF only, every line ≤ 75 octets', () => {
  const text = I.pumpScheduleIcs({ lastPumpEnd: NOW - HOUR, intervalMinutes: 180, days: 2, now: NOW });
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'no bare LF');
  assert.ok(!/\r(?!\n)/.test(text), 'no bare CR');
  for (const l of physical(text)) assert.ok(octets(l) <= 75, `${octets(l)}: ${l}`);
  const lines = contentLines(text);
  assert.ok(lines.includes(`PRODID:${I.ICS_PRODID}`));
  assert.ok(lines.includes('CALSCALE:GREGORIAN') && lines.includes('METHOD:PUBLISH'));
  assert.equal(lines.filter(l => l === 'BEGIN:VEVENT').length, 16);
  assert.equal(lines.filter(l => l === 'END:VEVENT').length, 16);
  assert.ok(!lines.some(l => l.startsWith('BEGIN:VTIMEZONE')), 'UTC mode needs no VTIMEZONE');
});

test('pumpScheduleIcs: UID per event (unique + deterministic), DTSTAMP, DISPLAY alarm at start', () => {
  const opts = { lastPumpEnd: NOW - HOUR, intervalMinutes: 180, days: 1, now: NOW };
  const lines = contentLines(I.pumpScheduleIcs(opts));
  const uids = lines.filter(l => l.startsWith('UID:'));
  assert.equal(uids.length, 8);
  assert.equal(new Set(uids).size, 8, 'unique');
  assert.equal(uids[0], `UID:nurture-pump-${I.formatUtc(NOW + 2 * HOUR)}@nurture.local`);
  assert.deepEqual(contentLines(I.pumpScheduleIcs({ ...opts, now: NOW + MIN })).filter(l => l.startsWith('UID:')), uids,
    're-exporting the same schedule yields the same UIDs (calendar updates instead of duplicating)');
  assert.ok(lines.filter(l => l.startsWith('DTSTAMP:')).every(l => l === `DTSTAMP:${I.formatUtc(NOW)}`));
  assert.ok(lines.includes(`DTSTART:${I.formatUtc(NOW + 2 * HOUR)}`));
  assert.ok(lines.includes(`DTEND:${I.formatUtc(NOW + 2 * HOUR + 20 * MIN)}`), 'default 20 min');
  assert.equal(lines.filter(l => l === 'BEGIN:VALARM').length, 8);
  assert.equal(lines.filter(l => l === 'TRIGGER:-PT0M').length, 8);
  assert.equal(lines.filter(l => l === 'ACTION:DISPLAY').length, 8);
  // Every VALARM sits inside a VEVENT with a DESCRIPTION (required for DISPLAY).
  const firstAlarm = lines.indexOf('BEGIN:VALARM');
  assert.deepEqual(lines.slice(firstAlarm, firstAlarm + 5), ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Pump', 'TRIGGER:-PT0M', 'END:VALARM']);
});

test('pumpScheduleIcs: commas/semicolons/newlines escaped; no property injection', () => {
  const text = I.pumpScheduleIcs({
    intervalMinutes: 180, days: 1, now: NOW,
    summary: 'Pump, left; right',
    description: 'Line one\r\nATTENDEE:mailto:evil@example.com\nEND:VEVENT',
    calendarName: 'Clara, pump; plan',
  });
  const lines = contentLines(text);
  assert.ok(lines.includes('SUMMARY:Pump\\, left\\; right'));
  assert.ok(lines.includes('X-WR-CALNAME:Clara\\, pump\\; plan'));
  assert.ok(lines.includes('DESCRIPTION:Line one\\nATTENDEE:mailto:evil@example.com\\nEND:VEVENT'));
  assert.ok(!lines.some(l => l.startsWith('ATTENDEE')), 'injected text never becomes its own property');
  assert.equal(lines.filter(l => l === 'END:VEVENT').length, lines.filter(l => l === 'BEGIN:VEVENT').length);
  const longDesc = I.pumpScheduleIcs({ intervalMinutes: 180, days: 1, now: NOW, description: 'Pump time — '.repeat(30) });
  for (const l of physical(longDesc)) assert.ok(octets(l) <= 75);
  assert.ok(contentLines(longDesc).includes(`DESCRIPTION:${'Pump time — '.repeat(30)}`), 'folding is lossless');
  const blank = contentLines(I.pumpScheduleIcs({ intervalMinutes: 180, days: 1, now: NOW, summary: '', description: '' }));
  assert.ok(blank.includes('SUMMARY:Pump') && !blank.some(l => l.startsWith('DESCRIPTION:Time')));
});

test('pumpScheduleIcs: duration is clamped to the interval', () => {
  const lines = contentLines(I.pumpScheduleIcs({ intervalMinutes: 15, days: 1, now: NOW, durationMinutes: 45 }));
  const start = lines.find(l => l.startsWith('DTSTART:')).slice(8);
  const end = lines.find(l => l.startsWith('DTEND:')).slice(6);
  assert.equal(start, I.formatUtc(NOW + 15 * MIN));
  assert.equal(end, I.formatUtc(NOW + 30 * MIN), 'events never overlap the next pump');
});

test('pumpScheduleIcs with tzid: local times + a VTIMEZONE that covers the DST change', () => {
  const now = Date.UTC(2026, 9, 31, 12); // Sat 08:00 EDT, the day before fall-back
  const text = I.pumpScheduleIcs({ lastPumpEnd: now - HOUR, intervalMinutes: 180, days: 2, now, tzid: 'America/New_York' });
  for (const l of physical(text)) assert.ok(octets(l) <= 75);
  const lines = contentLines(text);
  assert.ok(lines.includes('BEGIN:VTIMEZONE') && lines.includes('TZID:America/New_York') && lines.includes('END:VTIMEZONE'));
  assert.ok(lines.indexOf('END:VTIMEZONE') < lines.indexOf('BEGIN:VEVENT'), 'VTIMEZONE precedes events');
  const std = lines.indexOf('BEGIN:STANDARD');
  assert.deepEqual(lines.slice(std, std + 5), ['BEGIN:STANDARD', 'DTSTART:20261101T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD'],
    'the fall-back transition, at 02:00 local daylight time');
  assert.ok(lines.includes('DTSTART;TZID=America/New_York:20261031T100000'));
  assert.ok(lines.some(l => l.startsWith('DTSTART;TZID=America/New_York:20261101T')));
  assert.ok(!lines.some(l => /^DTSTART:\d{8}T\d{6}Z$/.test(l)), 'event times are local, not UTC');
  const spring = contentLines(I.pumpScheduleIcs({ intervalMinutes: 180, days: 2, now: Date.UTC(2026, 2, 7, 17), tzid: 'America/New_York' }));
  const day = spring.indexOf('BEGIN:DAYLIGHT');
  assert.deepEqual(spring.slice(day + 1, day + 4), ['DTSTART:20260308T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400']);
  const noDst = contentLines(I.pumpScheduleIcs({ intervalMinutes: 180, days: 2, now, tzid: 'Asia/Kolkata' }));
  assert.equal(noDst.filter(l => l.startsWith('BEGIN:STANDARD') || l.startsWith('BEGIN:DAYLIGHT')).length, 1, 'one observance when nothing changes');
  assert.ok(noDst.includes('TZOFFSETTO:+0530'));
});

test('tzid is validated (it is written verbatim into the file)', () => {
  for (const tzid of ['America/New_York\r\nX-EVIL:1', 'Etc/GMT;X=1', 'America:NY', '../../etc', 'x'.repeat(65), 42]) {
    assert.throws(() => I.pumpScheduleIcs({ intervalMinutes: 180, now: NOW, tzid }), RangeError, String(tzid));
  }
  assert.throws(() => I.assertTzid('Mars/Olympus_Mons'), RangeError);
  assert.equal(I.assertTzid('Europe/London'), 'Europe/London');
  assert.doesNotThrow(() => I.pumpScheduleIcs({ intervalMinutes: 180, now: NOW, tzid: '' }), 'empty = UTC mode');
});
