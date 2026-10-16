// domain/trends.js — per-day totals, pump goal, sleep, diapers, last-N-days.
// America/New_York so the DST day (Nov 1 2026, 25h) is a real test.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../js/domain/trends.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
let n = 0;
const ev = (type, startTime, endTime, data = {}, extra = {}) => ({ id: `evt_${++n}`, type, startTime, endTime: endTime === undefined ? startTime : endTime, data, note: '', ...extra });
const bottle = (t, amount, unit = 'oz', milk = 'formula', extra) => ev('feed', t, t + 10 * MIN, { method: 'bottle', milk, amount, unit }, extra);
const pump = (t, amount, unit = 'oz') => ev('pump', t, t + 15 * MIN, { amount, unit, storedTo: null }, { babyId: null });

const DAY_START = at(2026, 10, 14);
const NOW = at(2026, 10, 14, 20);

test('eventAmountIn: converts per event; null when there is no amount', () => {
  assert.equal(T.eventAmountIn(bottle(NOW, 4, 'oz'), 'oz'), 4);
  assert.ok(Math.abs(T.eventAmountIn(bottle(NOW, 120, 'mL'), 'oz') - 120 / 29.5735) < 1e-9);
  assert.equal(T.eventAmountIn(pump(NOW, null), 'oz'), null, 'legacy NaN pump');
  assert.equal(T.eventAmountIn(ev('diaper', NOW, NOW, { kind: 'wet' }), 'oz'), null);
  assert.equal(T.eventAmountIn({}, 'oz'), null);
  assert.equal(T.eventAmountIn(null, 'oz'), null);
});

test('overlapMs: clips to the window; running counts up to now', () => {
  const night = ev('sleep', at(2026, 10, 13, 21), at(2026, 10, 14, 6));
  assert.equal(T.overlapMs(night, DAY_START, DAY_START + 24 * HOUR), 6 * HOUR);
  assert.equal(T.overlapMs(night, at(2026, 10, 13), DAY_START), 3 * HOUR);
  const live = ev('sleep', NOW - HOUR, null);
  assert.equal(T.overlapMs(live, DAY_START, DAY_START + 24 * HOUR, NOW), HOUR);
  assert.equal(T.overlapMs(live, DAY_START, DAY_START + 24 * HOUR, NOW - 2 * HOUR), 0, 'skew: never negative');
  assert.equal(T.overlapMs({ startTime: 'x' }, 0, 1), 0);
});

test('rangeTotals: feeds by method + milk, mixed units, NaN-safe, running excluded', () => {
  const events = [
    bottle(at(2026, 10, 14, 8), 4, 'oz', 'formula'),
    bottle(at(2026, 10, 14, 11), 120, 'mL', 'breastmilk'),
    bottle(at(2026, 10, 14, 13), null, 'oz', 'breastmilk'), // amount wasn't recorded
    ev('feed', at(2026, 10, 14, 15), at(2026, 10, 14, 15, 20), { method: 'breast', left: 600, right: 300, lastSide: 'right', activeSide: null }),
    ev('feed', at(2026, 10, 14, 19, 50), null, { method: 'bottle', milk: 'formula', amount: null, unit: 'oz' }), // running
    pump(at(2026, 10, 14, 7), 3, 'oz'),
    pump(at(2026, 10, 14, 12), 90, 'mL'),
    pump(at(2026, 10, 14, 16), null),
    ev('diaper', at(2026, 10, 14, 9), undefined, { kind: 'wet' }),
    ev('diaper', at(2026, 10, 14, 10), undefined, { kind: 'both' }),
    ev('diaper', at(2026, 10, 14, 14), undefined, { kind: 'dirty' }),
    ev('diaper', at(2026, 10, 14, 17), undefined, { kind: 'dry' }),
    ev('milestone', at(2026, 10, 14, 12), undefined, { title: 'First smile', photoIds: [] }),
    bottle(at(2026, 10, 13, 23, 59), 6), // yesterday
    bottle(at(2026, 10, 15, 0, 0), 6), // tomorrow
  ];
  const oz = T.rangeTotals(events, DAY_START, DAY_START + 24 * HOUR, { unit: 'oz', now: NOW });
  assert.equal(oz.unit, 'oz');
  assert.equal(oz.feed.count, 4, 'running feed excluded until finished');
  assert.equal(oz.feed.bottleCount, 3);
  assert.equal(oz.feed.breastCount, 1);
  assert.equal(oz.feed.breastSec, 900);
  assert.equal(oz.feed.amount, 8.1, '4 oz + 120 mL (+ a missing amount as 0)');
  assert.equal(oz.feed.formulaAmount, 4);
  assert.equal(oz.feed.breastmilkAmount, 4.1);
  assert.equal(oz.pump.count, 3);
  assert.equal(oz.pump.amount, 6, '3 oz + 90 mL ≈ 6.0 oz');
  assert.deepEqual(oz.diaper, { count: 4, wet: 2, dirty: 2, both: 1, dry: 1 });
  assert.equal(oz.milestone.count, 1);
  const ml = T.rangeTotals(events, DAY_START, DAY_START + 24 * HOUR, { unit: 'mL', now: NOW });
  assert.equal(ml.feed.amount, 238, 'regression AUDIT F6: not "124 mL"');
  assert.equal(ml.pump.amount, 179);
  assert.equal(T.rangeTotals(null, 0, 1).feed.count, 0);
});

test('sleepTotals: nap vs night, split across days, running up to now, longest stretch', () => {
  const events = [
    ev('sleep', at(2026, 10, 13, 21), at(2026, 10, 14, 6), { kind: 'night' }), // 3h yesterday + 6h today
    ev('sleep', at(2026, 10, 14, 10), at(2026, 10, 14, 11, 30), { kind: 'nap' }),
    ev('sleep', at(2026, 10, 14, 14), at(2026, 10, 14, 14, 45), { kind: 'nap' }),
    ev('sleep', at(2026, 10, 14, 19), null, { kind: 'night' }), // running for 1h at NOW
  ];
  const today = T.sleepTotals(events, DAY_START, DAY_START + 24 * HOUR, NOW);
  assert.equal(today.count, 3, 'counted on the day they START');
  assert.equal(today.totalMs, 6 * HOUR + 90 * MIN + 45 * MIN + HOUR);
  assert.equal(today.nightMs, 7 * HOUR);
  assert.equal(today.napMs, 135 * MIN);
  assert.equal(today.longestMs, 90 * MIN, 'longest stretch that STARTED today (the night began yesterday)');
  const yesterday = T.sleepTotals(events, at(2026, 10, 13), DAY_START, NOW);
  assert.equal(yesterday.count, 1);
  assert.equal(yesterday.totalMs, 3 * HOUR);
  assert.equal(yesterday.longestMs, 9 * HOUR, 'the whole night, not just the clipped part');
});

test('diaperCounts: wet/dirty include "both"', () => {
  const d = T.diaperCounts([
    ev('diaper', NOW, undefined, { kind: 'both' }),
    ev('diaper', NOW, undefined, { kind: 'wet' }),
    ev('diaper', NOW, undefined, { kind: 'mystery' }),
    ev('feed', NOW, undefined, { method: 'bottle', amount: 1, unit: 'oz' }),
  ], DAY_START, DAY_START + 24 * HOUR);
  assert.deepEqual(d, { count: 3, wet: 2, dirty: 1, both: 1, dry: 0 });
});

test('dayTotals: DST fall-back day is 25h and keeps its 23:30 events', () => {
  const late = bottle(at(2026, 11, 1, 23, 30), 5);
  const early = bottle(at(2026, 11, 1, 0, 30), 2);
  const t = T.dayTotals([late, early], at(2026, 11, 1, 12), { unit: 'oz', now: at(2026, 11, 2, 9) });
  assert.equal(t.dayKey, '2026-11-01');
  assert.equal(t.end - t.start, 25 * HOUR);
  assert.equal(t.feed.count, 2);
  assert.equal(t.feed.amount, 7);
});

test('pumpProgress: goal stored in oz, shown in either unit', () => {
  const events = [pump(at(2026, 10, 14, 7), 10), pump(at(2026, 10, 14, 12), 300, 'mL'), pump(at(2026, 10, 13, 12), 99)];
  const oz = T.pumpProgress(events, 24, { unit: 'oz', now: NOW });
  assert.equal(oz.total, 20.1);
  assert.equal(oz.goal, 24);
  assert.equal(oz.remaining, 3.9);
  assert.ok(Math.abs(oz.fraction - 20.1 / 24) < 1e-9);
  assert.equal(oz.reached, false);
  assert.equal(oz.count, 2);
  const ml = T.pumpProgress(events, 24, { unit: 'mL', now: NOW });
  assert.equal(ml.goal, 710);
  assert.equal(ml.total, 596);
  assert.equal(ml.unit, 'mL');
  const reached = T.pumpProgress(events, 20, { now: NOW });
  assert.equal(reached.reached, true);
  assert.equal(reached.fraction, 1, 'clamped to 1');
  assert.equal(reached.remaining, 0);
  const noGoal = T.pumpProgress(events, NaN, { now: NOW });
  assert.deepEqual([noGoal.goal, noGoal.fraction, noGoal.reached], [0, 0, false]);
  const yesterday = T.pumpProgress(events, 24, { now: NOW, day: at(2026, 10, 13, 9) });
  assert.equal(yesterday.total, 99);
});

test('lastNDays: oldest → newest, today last, sleeps that cross into the window counted', () => {
  const events = [
    bottle(at(2026, 10, 8, 9), 4), // first day of a 7-day window ending Oct 14
    bottle(at(2026, 10, 7, 23), 9), // before the window
    bottle(at(2026, 10, 14, 9), 3),
    ev('sleep', at(2026, 10, 7, 22), at(2026, 10, 8, 4), { kind: 'night' }),
  ];
  const days = T.lastNDays(events, 7, { unit: 'oz', now: NOW });
  assert.equal(days.length, 7);
  assert.deepEqual(days.map(d => d.dayKey), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(days.map(d => d.isToday), [false, false, false, false, false, false, true]);
  assert.equal(days[0].feed.amount, 4, 'the 23:00 feed the day before is excluded');
  assert.equal(days[0].sleep.totalMs, 4 * HOUR, 'the night that began before the window still counts its in-window part');
  assert.equal(days[6].feed.amount, 3);
  assert.equal(days[3].feed.count, 0, 'empty days are present with zeros');
  assert.deepEqual(T.lastNDays(events, 0, { now: NOW }), []);
  assert.equal(T.lastNDays(events, 2.9, { now: NOW }).length, 2);
});

test('lastNDays across the DST change keeps calendar days', () => {
  const days = T.lastNDays([], 3, { now: at(2026, 11, 2, 12) });
  assert.deepEqual(days.map(d => d.dayKey), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(days[1].end - days[1].start, 25 * HOUR);
});

test('forBaby: one baby + parent-level pumps', () => {
  const a = bottle(NOW, 1, 'oz', 'formula', { babyId: 'baby_a' });
  const b = bottle(NOW, 2, 'oz', 'formula', { babyId: 'baby_b' });
  const p = pump(NOW, 3);
  assert.deepEqual(T.forBaby([a, b, p], 'baby_a'), [a, p]);
  assert.deepEqual(T.forBaby([a, b, p, null]), [a, b, p], 'undefined → everyone');
  assert.equal(T.rangeTotals(T.forBaby([a, b, p], 'baby_b'), DAY_START, DAY_START + 24 * HOUR, { now: NOW }).feed.amount, 2);
});

test('groupByDay: newest day first, newest event first', () => {
  const e1 = bottle(at(2026, 10, 13, 9), 1);
  const e2 = bottle(at(2026, 10, 14, 8), 1);
  const e3 = bottle(at(2026, 10, 14, 18), 1);
  const g = T.groupByDay([e1, e2, e3, null, { startTime: NaN }]);
  assert.deepEqual(g.map(x => x.dayKey), ['2026-10-14', '2026-10-13']);
  assert.deepEqual(g[0].events, [e3, e2]);
  assert.equal(g[0].start, DAY_START);
});

test('latest: most recent finished of a type, with predicate / running / cutoff', () => {
  const f1 = bottle(at(2026, 10, 14, 8), 1, 'oz', 'formula');
  const f2 = bottle(at(2026, 10, 14, 12), 1, 'oz', 'breastmilk');
  const live = ev('feed', at(2026, 10, 14, 19), null, { method: 'bottle', milk: 'formula' });
  assert.equal(T.latest([f1, f2, live], 'feed'), f2);
  assert.equal(T.latest([f1, f2, live], 'feed', { includeRunning: true }), live);
  assert.equal(T.latest([f1, f2], 'feed', { predicate: e => e.data.milk === 'formula' }), f1);
  assert.equal(T.latest([f1, f2], 'feed', { now: at(2026, 10, 14, 10) }), f1);
  assert.equal(T.latest([f1], 'pump'), null);
});

test('reportSummary: last N complete days, totals + per-day averages over days with data', () => {
  const now = at(2026, 10, 15, 10); // a Thursday morning — today is excluded by default
  const events = [
    bottle(at(2026, 10, 13, 8), 4), bottle(at(2026, 10, 13, 12), 120, 'mL', 'breastmilk'),
    ev('feed', at(2026, 10, 13, 15), at(2026, 10, 13, 15, 20), { method: 'breast', left: 600, right: 600 }),
    ev('diaper', at(2026, 10, 13, 9), undefined, { kind: 'both' }), ev('diaper', at(2026, 10, 13, 11), undefined, { kind: 'wet' }),
    ev('sleep', at(2026, 10, 13, 13), at(2026, 10, 13, 15), { kind: 'nap' }),
    bottle(at(2026, 10, 14, 8), 5),
    ev('sleep', at(2026, 10, 14, 20), at(2026, 10, 15, 5), { kind: 'night' }), // 4h on the 14th, 5h today
    pump(at(2026, 10, 14, 7), 4), pump(at(2026, 10, 14, 13), 60, 'mL'),
    bottle(at(2026, 10, 15, 8), 9), // today — not in the report
  ];
  const r = T.reportSummary(events, { days: 7, unit: 'oz', now });
  assert.equal(r.dayCount, 7);
  assert.equal(r.days.length, 7);
  assert.equal(r.days.at(-1).dayKey, '2026-10-14', 'ends with yesterday');
  assert.equal(r.from, at(2026, 10, 8));
  assert.equal(r.to, at(2026, 10, 15));
  assert.equal(r.daysWithData, 2);
  assert.deepEqual(r.totals, { feeds: 4, bottleAmount: 13.1, breastSessions: 1, wet: 2, dirty: 1, sleepMs: 6 * HOUR, pumps: 2, pumpAmount: 6 });
  assert.deepEqual(r.perDay, { feeds: 2, bottleAmount: 6.6, breastSessions: 0.5, wet: 1, dirty: 0.5, sleepMs: 3 * HOUR, pumps: 1, pumpAmount: 3 });
  assert.equal(r.longestSleepMs, 9 * HOUR, 'the whole night counts as one stretch');
  const withToday = T.reportSummary(events, { days: 7, now, includeToday: true });
  assert.equal(withToday.days.at(-1).dayKey, '2026-10-15');
  assert.equal(withToday.totals.feeds, 5, 'today\'s feed counts when asked for');
  assert.equal(withToday.days[0].dayKey, '2026-10-09', 'still 7 days');
  const ml = T.reportSummary(events, { days: 7, unit: 'mL', now });
  assert.equal(ml.totals.bottleAmount, 386, '9 oz + 120 mL');
});

test('reportSummary: empty log and odd day counts are safe', () => {
  const r = T.reportSummary([], { now: NOW });
  assert.deepEqual([r.daysWithData, r.totals.feeds, r.perDay.feeds, r.longestSleepMs], [0, 0, 0, 0]);
  assert.equal(T.reportSummary([], { days: 14, now: NOW }).days.length, 14);
  assert.equal(T.reportSummary([], { days: 0, now: NOW }).days.length, 1);
  assert.equal(T.reportSummary([], { days: 1000, now: NOW }).days.length, 90);
  assert.equal(T.reportSummary([], { days: NaN, now: NOW }).days.length, 7);
});
