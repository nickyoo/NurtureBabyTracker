// Pure helpers exported by the sleep sheet (js/sheets/sleep.js):
// rangeLabel (wake-window wording) and pastSleepProblem (log-past-sleep
// validation: order, future, length, overlaps with the running sleep and
// with logged sleeps). The sheet module touches no DOM at import time.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { rangeLabel, pastSleepProblem, defaultPastWindow } = await import('../js/sheets/sleep.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = new Date(2026, 9, 14, 9, 50).getTime();
const clock = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const day = (t) => (new Date(t).getDate() === 14 ? 'Today' : new Date(t).getDate() === 13 ? 'Yesterday' : 'Mon, Oct 12');
const base = { now: NOW, clock, day };

test('rangeLabel: minutes, hours and mixed ranges stay compact', () => {
  assert.equal(rangeLabel(60, 90), '60–90m');
  assert.equal(rangeLabel(35, 60), '35–60m');
  assert.equal(rangeLabel(120, 180), '2–3h');
  assert.equal(rangeLabel(150, 210), '2.5–3.5h');
  assert.equal(rangeLabel(75, 120), '75m–2h');
});

test('pastSleepProblem: a sensible past sleep is fine', () => {
  assert.equal(pastSleepProblem({ ...base, start: NOW - 3 * HOUR, end: NOW - 2 * HOUR }), '');
});

test('pastSleepProblem: missing times, future, wrong order, over a day', () => {
  assert.match(pastSleepProblem({ ...base, start: null, end: NOW }), /Pick both/);
  assert.match(pastSleepProblem({ ...base, start: NOW - HOUR, end: NOW + 10 * MIN }), /hasn’t happened/);
  assert.match(pastSleepProblem({ ...base, start: NOW - HOUR, end: NOW - 2 * HOUR }), /comes after/);
  assert.match(pastSleepProblem({ ...base, start: NOW - HOUR, end: NOW - HOUR }), /comes after/);
  assert.match(pastSleepProblem({ ...base, start: NOW - 30 * HOUR, end: NOW - HOUR }), /more than a day/);
});

test('pastSleepProblem: never overlaps the sleep running now', () => {
  const running = { id: 'r', startTime: NOW - 90 * MIN, endTime: null, data: { kind: 'nap' } };
  assert.match(pastSleepProblem({ ...base, start: NOW - 2 * HOUR, end: NOW - HOUR, running }), /overlaps the nap running now/);
  // Entirely before it is fine.
  assert.equal(pastSleepProblem({ ...base, start: NOW - 3 * HOUR, end: NOW - 2 * HOUR, running }), '');
});

test('pastSleepProblem: never overlaps a logged sleep; touching edges is fine', () => {
  const others = [{ id: 'a', startTime: NOW - 5 * HOUR, endTime: NOW - 4 * HOUR, data: { kind: 'night' } }];
  assert.match(pastSleepProblem({ ...base, start: NOW - 4.5 * HOUR, end: NOW - 3 * HOUR, others }), /overlaps a night sleep logged/);
  assert.equal(pastSleepProblem({ ...base, start: NOW - 4 * HOUR, end: NOW - 3 * HOUR, others }), '');
  const yesterday = [{ id: 'b', startTime: NOW - 14 * HOUR, endTime: NOW - 12 * HOUR, data: { kind: 'night' } }];
  assert.match(pastSleepProblem({ ...base, start: NOW - 13 * HOUR, end: NOW - 11 * HOUR, others: yesterday }), /logged yesterday/);
});

test('FLOW-10: defaultPastWindow never opens on an overlap', () => {
  const at = (h, m) => new Date(2026, 9, 14, h, m).getTime();
  const now = at(12, 10);
  // No sleeps: woke up now (to the 5 min), asleep an hour before.
  assert.deepEqual(defaultPastWindow({ now }), { start: at(11, 10), end: at(12, 10) });
  // The repro: a nap 11:29–12:09 just ended → the hour moves to end where it began.
  const nap = { startTime: at(11, 29), endTime: at(12, 9) };
  const w = defaultPastWindow({ now, sleeps: [nap] });
  assert.deepEqual(w, { start: at(10, 25), end: at(11, 25) });
  assert.equal(pastSleepProblem({ ...base, now, start: w.start, end: w.end, others: [nap] }), '');
  // A nap that ended mid-hour with room after it: start right after it.
  const early = { startTime: at(10, 30), endTime: at(11, 32) };
  assert.deepEqual(defaultPastWindow({ now, sleeps: [early] }), { start: at(11, 35), end: at(12, 10) });
  // Two sleeps back to back: keeps moving back until it fits.
  const a = { startTime: at(10, 0), endTime: at(11, 0) };
  const w2 = defaultPastWindow({ now: at(11, 40), sleeps: [a, { startTime: at(11, 5), endTime: at(11, 38) }] });
  assert.equal(pastSleepProblem({ ...base, now: at(11, 40), start: w2.start, end: w2.end, others: [a, { startTime: at(11, 5), endTime: at(11, 38) }] }), '');
  assert.ok(w2.end <= at(10, 0));
});
