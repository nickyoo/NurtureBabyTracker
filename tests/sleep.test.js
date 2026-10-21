// domain/sleep.js — nap/night classification, wake windows by age, awake time.
// America/New_York so local-hour and DST behaviour is exercised for real.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../js/domain/sleep.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('classifyNapOrNight: 19:00–05:59 is night, otherwise nap (local hours)', () => {
  assert.equal(S.classifyNapOrNight(at(2026, 10, 15, 19, 0)), 'night');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 15, 18, 59)), 'nap');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 15, 23, 30)), 'night');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 16, 0, 0)), 'night');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 16, 5, 59)), 'night');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 16, 6, 0)), 'nap');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 16, 13, 0)), 'nap');
  assert.equal(S.classifyNapOrNight(new Date(2026, 9, 16, 20)), 'night', 'accepts Date');
  assert.equal(S.classifyNapOrNight(at(2026, 10, 16, 18), { nightStartHour: 18 }), 'night', 'configurable');
});

test('wakeWindowForAge: the commonly cited bands, by age', () => {
  const born = '2026-01-01';
  const band = now => { const w = S.wakeWindowForAge(born, now); return w && [w.min, w.max]; };
  assert.deepEqual(band(at(2026, 1, 1, 12)), [35, 60], 'day 0');
  assert.deepEqual(band(at(2026, 1, 28, 12)), [35, 60], 'day 27 (still < 4 weeks)');
  assert.deepEqual(band(at(2026, 1, 29, 12)), [60, 90], 'day 28 = 4 weeks');
  assert.deepEqual(band(at(2026, 3, 25, 12)), [60, 90], 'day 83 (< 12 weeks)');
  assert.deepEqual(band(at(2026, 3, 26, 12)), [75, 120], 'day 84 = 12 weeks');
  assert.deepEqual(band(at(2026, 5, 31, 12)), [75, 120], '4 months');
  assert.deepEqual(band(at(2026, 6, 1, 12)), [120, 180], '5 months → 2–3h');
  assert.deepEqual(band(at(2026, 7, 31, 12)), [120, 180], '6 months');
  assert.deepEqual(band(at(2026, 8, 1, 12)), [150, 210], '7 months → 2.5–3.5h');
  assert.deepEqual(band(at(2026, 11, 30, 12)), [150, 210], '10 months');
  assert.deepEqual(band(at(2026, 12, 1, 12)), [180, 240], '11 months → 3–4h');
  assert.deepEqual(band(at(2027, 3, 31, 12)), [180, 240], '14 months');
  assert.equal(band(at(2027, 4, 1, 12)), null, '15 months: past the useful range');
  assert.equal(S.wakeWindowForAge(born, at(2026, 1, 1, 12)).label, '0–4 weeks');
});

test('wakeWindowForAge: unknown, invalid, future birth dates → null', () => {
  const now = at(2026, 10, 15, 12);
  assert.equal(S.wakeWindowForAge(null, now), null);
  assert.equal(S.wakeWindowForAge(undefined, now), null);
  assert.equal(S.wakeWindowForAge('', now), null);
  assert.equal(S.wakeWindowForAge('not a date', now), null);
  assert.equal(S.wakeWindowForAge('2026-12-01', now), null, 'not born yet');
  assert.deepEqual(S.wakeWindowForAge(new Date(2026, 9, 1), now).min, 35, 'accepts Date');
  assert.deepEqual(S.wakeWindowForAge(at(2026, 10, 1), now).min, 35, 'accepts epoch ms');
});

test('wakeWindowForAge: YYYY-MM-DD is a LOCAL date (no off-by-one west of UTC)', () => {
  // Born 2026-01-01; at 2026-01-29 00:30 local the baby is exactly 28 days
  // old. Parsing the date as UTC midnight would make it 27 days old here.
  assert.deepEqual(S.wakeWindowForAge('2026-01-01', at(2026, 1, 29, 0, 30)).min, 60);
});

test('wakeWindowForAge: DST changes do not shift the day count', () => {
  // 12 weeks after 2025-12-15 is 2026-03-09 — the day after spring-forward.
  assert.deepEqual(S.wakeWindowForAge('2025-12-15', at(2026, 3, 9, 0, 30)).min, 75);
  assert.deepEqual(S.wakeWindowForAge('2025-12-15', at(2026, 3, 8, 23, 30)).min, 60);
});

const sleep = (start, end, extra = {}) => ({ id: `s${start}`, type: 'sleep', startTime: start, endTime: end, data: { kind: 'nap' }, ...extra });

test('sleepState / awakeSince: asleep, awake, unknown', () => {
  const now = at(2026, 10, 15, 14);
  assert.deepEqual(S.sleepState([], now), { state: 'unknown', since: null, event: null });
  assert.equal(S.awakeSince(null, now), null);

  const nap = sleep(now - 3 * HOUR, now - 2 * HOUR);
  const older = sleep(now - 6 * HOUR, now - 5 * HOUR);
  const st = S.sleepState([older, nap, { type: 'feed', startTime: now - MIN, endTime: now }], now);
  assert.equal(st.state, 'awake');
  assert.equal(st.since, now - 2 * HOUR);
  assert.equal(st.event, nap);
  assert.equal(S.awakeSince([nap, older], now), now - 2 * HOUR);

  const running = sleep(now - 20 * MIN, null);
  const asleep = S.sleepState([nap, running], now);
  assert.equal(asleep.state, 'asleep');
  assert.equal(asleep.since, now - 20 * MIN);
  assert.equal(S.awakeSince([nap, running], now), null, 'asleep → not awake');
});

test('sleepState: ignores future sleeps, stale running ones and other babies', () => {
  const now = at(2026, 10, 15, 14);
  const done = sleep(now - 2 * HOUR, now - HOUR);
  const future = sleep(now + HOUR, now + 2 * HOUR);
  assert.equal(S.sleepState([done, future], now).since, now - HOUR, 'future edit ignored');

  // A forgotten running sleep that started BEFORE a later finished sleep
  // must not claim the baby is asleep now.
  const stale = sleep(now - 10 * HOUR, null);
  assert.equal(S.sleepState([stale, done], now).state, 'awake');

  // A sleep whose end is still in the future counts as asleep now.
  const ongoing = sleep(now - 30 * MIN, now + 30 * MIN);
  assert.equal(S.sleepState([done, ongoing], now).state, 'asleep');

  const twinA = sleep(now - 2 * HOUR, now - HOUR, { babyId: 'baby_a' });
  const twinB = sleep(now - 20 * MIN, null, { babyId: 'baby_b' });
  assert.equal(S.sleepState([twinA, twinB], now, { babyId: 'baby_a' }).state, 'awake');
  assert.equal(S.sleepState([twinA, twinB], now, { babyId: 'baby_b' }).state, 'asleep');
  assert.equal(S.awakeSince([twinA, twinB], now, { babyId: 'baby_a' }), now - HOUR);

  const junk = [null, { type: 'sleep', startTime: 'x' }, { type: 'sleep' }];
  assert.equal(S.sleepState(junk, now).state, 'unknown', 'junk records skipped');
});

test('nextNapWindow: wake time + age band', () => {
  const woke = at(2026, 10, 15, 9);
  const w = S.nextNapWindow(woke, '2026-09-01', at(2026, 10, 15, 9, 30));
  assert.deepEqual(w, { from: woke + 60 * MIN, to: woke + 90 * MIN, min: 60, max: 90 });
  assert.equal(S.nextNapWindow(null, '2026-09-01'), null);
  assert.equal(S.nextNapWindow(woke, null), null);
  assert.equal(S.nextNapWindow(NaN, '2026-09-01'), null);
});
