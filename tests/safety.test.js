// domain/safety.js — bottle safety windows, pace, live-bottle status and
// breastfeeding side math. The first block ports the v1 tests for the
// helpers that moved here from js/app.js, so both implementations agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safetyWindowSec, paceOzPerMin, pacePerMin, fmtSafetyWindow, getBottleTimerStatus, safetyLevel,
  bottleSafety, breastSideTotals, switchBreastSide,
} from '../js/domain/safety.js';

const MIN = 60 * 1000;
const T0 = new Date('2026-10-15T12:00:00').getTime();

// ------------------------------------------------- ported from v1 tests ---

test('safetyWindowSec: formula 1h, breast milk 2h, unknown → breast-milk window', () => {
  assert.equal(safetyWindowSec('formula'), 3600);
  assert.equal(safetyWindowSec('breastmilk'), 7200);
  assert.equal(safetyWindowSec(undefined), 7200);
  assert.equal(safetyWindowSec('juice'), 7200);
});

test('safetyWindowSec: storageWindows can stretch breast milk, never formula', () => {
  assert.equal(safetyWindowSec('breastmilk', { startedBottleHours: 1.5 }), 5400);
  assert.equal(safetyWindowSec('formula', { startedBottleHours: 5 }), 3600, 'formula stays 1h (CDC)');
  assert.equal(safetyWindowSec('breastmilk', { startedBottleHours: 0 }), 7200, 'zero ignored');
  assert.equal(safetyWindowSec('breastmilk', { startedBottleHours: -3 }), 7200, 'negative ignored');
  assert.equal(safetyWindowSec('breastmilk', { startedBottleHours: 'abc' }), 7200, 'garbage ignored');
  assert.equal(safetyWindowSec('breastmilk', null), 7200);
});

test('paceOzPerMin: rounded to 2dp, 0 when unmeasurable (ported)', () => {
  assert.equal(paceOzPerMin(4, 600), 0.4);
  assert.equal(paceOzPerMin(3, 420), 0.43);
  assert.equal(paceOzPerMin(0, 600), 0);
  assert.equal(paceOzPerMin(4, 0), 0);
  assert.equal(paceOzPerMin(4, -10), 0);
  assert.equal(paceOzPerMin(-1, 600), 0);
  assert.equal(paceOzPerMin(NaN, 600), 0);
  assert.equal(pacePerMin(120, 600), 12, 'unit-agnostic alias works in mL');
});

test('fmtSafetyWindow: "1h 15m", "15m", ceil to the minute, "expired" (ported)', () => {
  assert.equal(fmtSafetyWindow(4500), '1h 15m');
  assert.equal(fmtSafetyWindow(900), '15m');
  assert.equal(fmtSafetyWindow(61), '2m', 'rounds UP so it never under-promises');
  assert.equal(fmtSafetyWindow(3600), '1h 00m', 'minutes padded once there are hours (DESIGN §10)');
  assert.equal(fmtSafetyWindow(3900), '1h 05m');
  assert.equal(fmtSafetyWindow(0), 'expired');
  assert.equal(fmtSafetyWindow(-30), 'expired');
  assert.equal(fmtSafetyWindow(NaN), 'expired', 'NaN must not render as a time');
});

test('getBottleTimerStatus: wall-clock elapsed + countdown (ported)', () => {
  const s = getBottleTimerStatus(T0, 'formula', T0 + 10 * MIN);
  assert.deepEqual(s, { elapsedSec: 600, windowSec: 3600, safetyRemainingSec: 3000, expired: false });
  const late = getBottleTimerStatus(T0, 'formula', T0 + 61 * MIN);
  assert.equal(late.expired, true);
  assert.equal(late.safetyRemainingSec, -60);
  const bm = getBottleTimerStatus(T0, 'breastmilk', T0 + 61 * MIN);
  assert.equal(bm.expired, false);
  const skew = getBottleTimerStatus(T0, 'formula', T0 - 5 * MIN);
  assert.equal(skew.elapsedSec, 0, 'clock skew never goes negative');
  assert.equal(getBottleTimerStatus(T0, 'formula', T0 + 3600 * 1000).expired, true, 'exactly at the window = expired');
});

// --------------------------------------------------------------- v2 only ---

test('safetyLevel: ok → soon (last 15 min) → expired', () => {
  assert.equal(safetyLevel(3600), 'ok');
  assert.equal(safetyLevel(15 * 60 + 1), 'ok');
  assert.equal(safetyLevel(15 * 60), 'soon');
  assert.equal(safetyLevel(1), 'soon');
  assert.equal(safetyLevel(0), 'expired');
  assert.equal(safetyLevel(NaN), 'expired');
});

test('bottleSafety: only for RUNNING bottle feeds; derives everything from startTime', () => {
  const running = { type: 'feed', startTime: T0, endTime: null, data: { method: 'bottle', milk: 'formula' } };
  const s = bottleSafety(running, T0 + 50 * MIN);
  assert.equal(s.windowSec, 3600);
  assert.equal(s.safetyRemainingSec, 600);
  assert.equal(s.level, 'soon');
  assert.equal(s.label, '10m');
  assert.ok(Math.abs(s.fraction - 600 / 3600) < 1e-9);
  const expired = bottleSafety(running, T0 + 2 * 3600 * 1000);
  assert.equal(expired.level, 'expired');
  assert.equal(expired.fraction, 0, 'fraction clamps at 0');
  const bm = bottleSafety({ ...running, data: { method: 'bottle', milk: 'breastmilk' } }, T0 + 50 * MIN);
  assert.equal(bm.level, 'ok');
  assert.equal(bottleSafety({ ...running, endTime: T0 + MIN }, T0), null, 'finished feed');
  assert.equal(bottleSafety({ ...running, data: { method: 'breast' } }, T0), null, 'breastfeeding');
  assert.equal(bottleSafety({ ...running, type: 'pump' }, T0), null, 'not a feed');
  assert.equal(bottleSafety(null), null);
  const custom = bottleSafety({ ...running, data: { method: 'bottle', milk: 'breastmilk' } }, T0, { startedBottleHours: 1 });
  assert.equal(custom.windowSec, 3600, 'Settings window respected');
});

test('breastSideTotals: banked seconds + the live side', () => {
  assert.deepEqual(breastSideTotals({ left: 120, right: 60 }), { left: 120, right: 60, total: 180 });
  const live = breastSideTotals({ left: 120, right: 0, activeSide: 'right', activeSince: T0 }, T0 + 90 * 1000);
  assert.deepEqual(live, { left: 120, right: 90, total: 210 });
  assert.deepEqual(breastSideTotals({ left: 'x', right: -5 }), { left: 0, right: 0, total: 0 }, 'garbage → 0');
  assert.deepEqual(breastSideTotals(null), { left: 0, right: 0, total: 0 });
  assert.deepEqual(breastSideTotals({ left: 10, activeSide: 'left', activeSince: T0 }, T0 - MIN), { left: 10, right: 0, total: 10 }, 'skew never subtracts');
  assert.deepEqual(breastSideTotals({ left: 10, activeSide: 'middle', activeSince: T0 }, T0 + MIN), { left: 10, right: 0, total: 10 });
});

test('switchBreastSide: banks the running side, starts/pauses, tracks lastSide', () => {
  const start = switchBreastSide({ left: 0, right: 0, lastSide: 'left', activeSide: null }, 'left', T0);
  assert.deepEqual(start, { left: 0, right: 0, activeSide: 'left', activeSince: T0, lastSide: 'left' });
  const swap = switchBreastSide(start, 'right', T0 + 5 * MIN);
  assert.deepEqual(swap, { left: 300, right: 0, activeSide: 'right', activeSince: T0 + 5 * MIN, lastSide: 'right' });
  const pause = switchBreastSide(swap, null, T0 + 8 * MIN);
  assert.deepEqual(pause, { left: 300, right: 180, activeSide: null, activeSince: null, lastSide: 'right' }, 'pause remembers the side that was running');
  const idle = switchBreastSide({ left: 5, right: 5, lastSide: 'right' }, null, T0);
  assert.equal(idle.lastSide, 'right', 'pausing while paused keeps lastSide');
  assert.equal(switchBreastSide({}, 'sideways', T0).activeSide, null, 'unknown side = pause');
});
