import test from 'node:test';
import assert from 'node:assert/strict';
import { relative, dayLabel, dayBounds, addDays, monthsBetween } from '../../../../js/core/time.js';
import { sleepState, wakeWindowForAge } from '../../../../js/domain/sleep.js';
import { forBaby, dayTotals, lastNDays, groupByDay } from '../../../../js/domain/trends.js';
const MIN = 60e3, HOUR = 60 * MIN;

test('relative boundaries', () => {
  const n = Date.UTC(2026, 5, 1, 12);
  assert.equal(relative(n - 59_999, n), 'just now');
  assert.equal(relative(n - 60_000, n), '1m ago');
  assert.equal(relative(n - (60 * MIN - 1), n), '59m ago');
  assert.equal(relative(n - (24 * HOUR - MIN), n), '23h 59m ago');
  assert.equal(relative(n - 24 * HOUR, n), '1d ago');
});

test('wake window boundaries', () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  assert.equal(wakeWindowForAge('2026-09-18', now).label, '4–12 weeks'); // 28 days
  assert.equal(wakeWindowForAge('2026-03-16', now).label, '7–10 months');
  assert.equal(wakeWindowForAge('2025-07-16', now), null); // 15 months
});

test('sleepState(babyId) agrees with forBaby on a babyId:null sleep (lenient import)', () => {
  const now = Date.UTC(2026, 5, 1, 12);
  const evs = [{ id: 'e1', type: 'sleep', startTime: now - 2 * HOUR, endTime: now - HOUR, babyId: null, data: { kind: 'nap' } }];
  const visible = forBaby(evs, 'baby_a');
  assert.equal(visible.length, 1, 'forBaby shows the null-baby sleep for baby_a');
  assert.equal(sleepState(evs, now, { babyId: 'baby_a' }).state, 'awake');
});

test('DST fall-back day bounds are 25h and lastNDays keys unique (TZ=America/New_York)', () => {
  const now = new Date(2026, 10, 3, 1, 30).getTime(); // Nov 3, DST ended Nov 1
  const keys = lastNDays([], 7, { now }).map(d => d.dayKey);
  assert.equal(new Set(keys).size, 7);
  const b = dayBounds(new Date(2026, 10, 1, 12));
  assert.equal((b.end - b.start) / HOUR, 25);
  const sleepE = { id: 's', type: 'sleep', startTime: new Date(2026, 9, 31, 21).getTime(), endTime: new Date(2026, 10, 1, 6).getTime(), data: { kind: 'night' } };
  const d1 = dayTotals([sleepE], new Date(2026, 9, 31, 12), { now });
  const d2 = dayTotals([sleepE], new Date(2026, 10, 1, 12), { now });
  assert.equal((d1.sleep.totalMs + d2.sleep.totalMs) / HOUR, 10); // 21:00 EDT -> 06:00 EST = 10h
});
