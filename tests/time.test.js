// core/time.js — relative time, durations, clocks, DST-safe day math.
// Runs in America/New_York so the DST cases are real (2026: Mar 8 springs
// forward, Nov 1 falls back). node --test gives each file its own process,
// so this doesn't leak into other test files.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../js/core/time.js');
const { HOUR, MINUTE, DAY } = T;

test('TZ override is active (DST tests below depend on it)', () => {
  assert.equal(new Date(2026, 0, 15, 12).getTimezoneOffset(), 300);
  assert.equal(new Date(2026, 6, 15, 12).getTimezoneOffset(), 240);
});

test('relative: just now / minutes / hours / days, injectable now', () => {
  const now = new Date(2026, 9, 14, 15, 0).getTime();
  assert.equal(T.relative(now, now), 'just now');
  assert.equal(T.relative(now - 59 * 1000, now), 'just now');
  assert.equal(T.relative(now - 5 * MINUTE, now), '5m ago');
  assert.equal(T.relative(now - 59 * MINUTE - 59 * 1000, now), '59m ago', 'truncates, never rounds up');
  assert.equal(T.relative(now - (2 * HOUR + 10 * MINUTE), now), '2h 10m ago');
  assert.equal(T.relative(now - 3 * HOUR, now), '3h ago');
  assert.equal(T.relative(now - (DAY + 4 * HOUR), now), '1d 4h ago');
  assert.equal(T.relative(now - 3 * DAY, now), '3d ago');
  assert.equal(T.relative(now + 5 * MINUTE, now), 'in 5m', 'future (clock skew) reads sensibly');
  assert.equal(T.relative(new Date(now - HOUR), new Date(now)), '1h ago', 'accepts Dates');
  assert.equal(T.relative(NaN, now), '');
});

test('duration: "1h 05m", minutes, seconds, garbage', () => {
  assert.equal(T.duration(65 * MINUTE), '1h 05m');
  assert.equal(T.duration(12 * MINUTE + 30 * 1000), '12m');
  assert.equal(T.duration(45 * 1000), '45s');
  assert.equal(T.duration(26 * HOUR), '26h 00m');
  assert.equal(T.duration(0), '0m');
  assert.equal(T.duration(-5), '0m');
  assert.equal(T.duration(NaN), '0m');
});

test('timerClock / fmtClock: mm:ss and h:mm:ss (ported v1 cases)', () => {
  assert.equal(T.fmtClock(0), '00:00');
  assert.equal(T.fmtClock(65), '01:05');
  assert.equal(T.fmtClock(600), '10:00');
  assert.equal(T.fmtClock(3665), '1:01:05');
  assert.equal(T.fmtClock(-5), '00:00');
  assert.equal(T.timerClock(NaN), '00:00');
  assert.equal(T.timerClock(99 * 3600 + 59 * 60 + 59), '99:59:59');
  assert.equal(T.timerClock(100 * 3600), '4 days', 'DI-12: over 99 h reads as days');
  assert.equal(T.timerClock(7200 * 3600 + 10), '300 days');
});

test('clock: 12h/24h, separate meridiem', () => {
  const noon4 = new Date(2026, 9, 14, 12, 4).getTime();
  const am3 = new Date(2026, 9, 14, 3, 7).getTime();
  const pm3 = new Date(2026, 9, 14, 15, 7).getTime();
  const midnight = new Date(2026, 9, 14, 0, 9).getTime();
  assert.equal(T.clock(noon4, { hour12: true }), '12:04');
  assert.equal(T.clock(am3, { hour12: true }), '3:07');
  assert.equal(T.clock(pm3, { hour12: true, meridiem: true }), '3:07 PM');
  assert.equal(T.clock(midnight, { hour12: true, meridiem: true }), '12:09 AM');
  assert.equal(T.clock(pm3, { hour12: false }), '15:07');
  assert.equal(T.clock(midnight, { hour12: false }), '00:09');
  assert.equal(T.meridiem(am3), 'AM');
  assert.equal(T.meridiem(noon4), 'PM');
  assert.equal(T.clock(NaN), '');
  assert.equal(typeof T.prefers12h(), 'boolean');
});

test('startOfDay / dayBounds: local midnight to next local midnight', () => {
  const t = new Date(2026, 9, 14, 15, 30).getTime();
  const { start, end } = T.dayBounds(t);
  assert.equal(start, new Date(2026, 9, 14).getTime());
  assert.equal(end, new Date(2026, 9, 15).getTime());
  assert.equal(end - start, DAY);
  assert.equal(T.startOfDay(t), start);
  assert.equal(T.startOfDay(new Date(t)), start);
});

test('dayBounds is DST-safe: 23h spring-forward, 25h fall-back', () => {
  const spring = T.dayBounds(new Date(2026, 2, 8, 12));
  assert.equal(spring.end - spring.start, 23 * HOUR);
  assert.equal(new Date(spring.end).getHours(), 0, 'end is a real local midnight');
  const fall = T.dayBounds(new Date(2026, 10, 1, 12));
  assert.equal(fall.end - fall.start, 25 * HOUR);
  // An event at 23:30 on the short day stays on that day (start + 24h would
  // have filed it under the next day).
  const late = new Date(2026, 2, 8, 23, 30).getTime();
  assert.ok(late >= spring.start && late < spring.end);
  assert.equal(T.dayKey(late), '2026-03-08');
});

test('addDays keeps wall-clock time across DST; daysBetween counts calendar days', () => {
  const sat9 = new Date(2026, 2, 7, 9, 0).getTime();
  const sun9 = T.addDays(sat9, 1);
  assert.equal(new Date(sun9).getHours(), 9);
  assert.equal(sun9 - sat9, 23 * HOUR);
  assert.equal(new Date(T.addDays(sat9, -7)).getDate(), 28, 'back across a month boundary');
  assert.equal(T.daysBetween(new Date(2026, 2, 7, 23), new Date(2026, 2, 9, 1)), 2);
  assert.equal(T.daysBetween(new Date(2026, 10, 2), new Date(2026, 9, 31)), -2);
});

test('isSameDay / dayKey are local, not UTC', () => {
  // 21:30 New York is already tomorrow in UTC.
  const evening = new Date(2026, 9, 14, 21, 30).getTime();
  assert.equal(T.dayKey(evening), '2026-10-14');
  assert.notEqual(new Date(evening).toISOString().slice(0, 10), '2026-10-14');
  assert.equal(T.isSameDay(evening, new Date(2026, 9, 14, 0, 1)), true);
  assert.equal(T.isSameDay(evening, new Date(2026, 9, 15, 0, 1)), false);
});

test('parseLocalDate / toMs: YYYY-MM-DD is local midnight; rollovers rejected', () => {
  assert.equal(T.parseLocalDate('2026-01-15'), new Date(2026, 0, 15).getTime());
  assert.equal(T.parseLocalDate('2026-02-31'), null);
  assert.equal(T.parseLocalDate('15/01/2026'), null);
  assert.equal(T.parseLocalDate(null), null);
  assert.equal(T.toMs('2026-01-15'), new Date(2026, 0, 15).getTime());
  assert.ok(Number.isNaN(T.toMs({})));
});

test('dayLabel: Today / Yesterday / weekday date', () => {
  const now = new Date(2026, 9, 14, 10).getTime();
  assert.equal(T.dayLabel(now - HOUR, now), 'Today');
  assert.equal(T.dayLabel(new Date(2026, 9, 13, 23, 59), now), 'Yesterday');
  assert.match(T.dayLabel(new Date(2026, 9, 10), now, 'en-US'), /Oct/);
  assert.match(T.dayLabel(new Date(2025, 9, 10), now, 'en-US'), /2025/);
});

test('monthsBetween: birthday-style whole months', () => {
  assert.equal(T.monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 14)), 0);
  assert.equal(T.monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 15)), 1);
  assert.equal(T.monthsBetween(new Date(2026, 0, 31), new Date(2026, 1, 28)), 0);
  assert.equal(T.monthsBetween(new Date(2025, 10, 1), new Date(2026, 10, 1)), 12);
});
