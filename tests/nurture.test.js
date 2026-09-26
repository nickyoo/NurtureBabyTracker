// Nurture unit tests — run with: npm test   (node --test tests/)
// Covers the safety-critical pure logic: milk expiry math, urgency badges,
// bottle safety countdowns, trend aggregation, and ID generation.
// No DOM or IndexedDB is needed; minimal browser stubs let the ES modules
// import cleanly under Node.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- Minimal browser stubs (must run before any module import) ---
globalThis.indexedDB = { open: () => ({}) }; // handlers get assigned; promise never settles — static methods under test never touch it
globalThis.window = globalThis;
globalThis.document = { addEventListener: () => {} };
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { InventoryManager, buildThawUpdate, summarizeStash, THAWED_LOCATION, FROZEN_LOCATIONS, shouldShowThawTile } = await import('../js/inventory.js');
const { BottleManager } = await import('../js/bottles.js');
const { TrendsManager } = await import('../js/trends.js');
const { newId } = await import('../js/db.js');
const { App, applySessionEdits } = await import('../js/app.js');
const { buildPumpSession, normalizePumpDuration } = await import('../js/timer.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- newId ---
test('newId: prefixed, unique, collision-safe', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = newId('sess');
    assert.match(id, /^sess_/);
    assert.ok(!ids.has(id), `duplicate id generated: ${id}`);
    ids.add(id);
  }
});

// ------------------------------------------------- calculateExpiration ---
test('calculateExpiration: fridge defaults to +4 days', () => {
  const pumpedAt = new Date('2026-09-20T10:00:00').getTime();
  const expires = InventoryManager.calculateExpiration(pumpedAt, 'fridge');
  assert.equal(expires, pumpedAt + 4 * DAY);
});

test('calculateExpiration: room temp defaults to +4 hours', () => {
  const pumpedAt = new Date('2026-09-20T10:00:00').getTime();
  const expires = InventoryManager.calculateExpiration(pumpedAt, 'room');
  assert.equal(expires, pumpedAt + 4 * HOUR);
});

test('calculateExpiration: freezer defaults to +6 months', () => {
  const pumpedAt = new Date('2026-01-15T10:00:00').getTime();
  const expires = InventoryManager.calculateExpiration(pumpedAt, 'freezer');
  const expected = new Date('2026-01-15T10:00:00');
  expected.setMonth(expected.getMonth() + 6);
  assert.equal(expires, expected.getTime());
});

test('calculateExpiration: deep freezer defaults to +12 months', () => {
  const pumpedAt = new Date('2026-01-15T10:00:00').getTime();
  const expires = InventoryManager.calculateExpiration(pumpedAt, 'deepFreezer');
  const expected = new Date('2026-01-15T10:00:00');
  expected.setMonth(expected.getMonth() + 12);
  assert.equal(expires, expected.getTime());
});

test('calculateExpiration: custom storage windows are respected', () => {
  const pumpedAt = new Date('2026-09-20T10:00:00').getTime();
  const windows = { roomTempHours: 2, fridgeDays: 2, freezerMonths: 3, deepFreezerMonths: 6 };
  assert.equal(
    InventoryManager.calculateExpiration(pumpedAt, 'fridge', windows),
    pumpedAt + 2 * DAY
  );
  assert.equal(
    InventoryManager.calculateExpiration(pumpedAt, 'room', windows),
    pumpedAt + 2 * HOUR
  );
});

test('calculateExpiration: unknown location leaves timestamp unchanged', () => {
  const pumpedAt = Date.now();
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'countertop'), pumpedAt);
});

// ---------------------------------------------------------- getUrgency ---
test('getUrgency: past expiry is expired', () => {
  const u = InventoryManager.getUrgency(Date.now() - HOUR);
  assert.equal(u.level, 'expired');
  assert.equal(u.badgeClass, 'badge-expired');
});

test('getUrgency: under 12h is red', () => {
  const u = InventoryManager.getUrgency(Date.now() + 6 * HOUR);
  assert.equal(u.level, 'red');
  assert.equal(u.badgeClass, 'badge-red');
});

test('getUrgency: 12–48h is yellow', () => {
  const u = InventoryManager.getUrgency(Date.now() + 24 * HOUR);
  assert.equal(u.level, 'yellow');
  assert.equal(u.badgeClass, 'badge-yellow');
});

test('getUrgency: several days out is green (days label)', () => {
  const u = InventoryManager.getUrgency(Date.now() + 5 * DAY);
  assert.equal(u.level, 'green');
  assert.match(u.label, /days left/);
});

test('getUrgency: months out is green (months label)', () => {
  const u = InventoryManager.getUrgency(Date.now() + 90 * DAY);
  assert.equal(u.level, 'green');
  assert.match(u.label, /months left/);
});

// ------------------------------------------------------ getBottleStatus ---
test('getBottleStatus: past expiry is expired with 0 percent', () => {
  const s = BottleManager.getBottleStatus({
    status: 'inProgress',
    expiresAt: Date.now() - 1000,
    durationLimitMinutes: 120,
  });
  assert.equal(s.state, 'expired');
  assert.equal(s.percent, 0);
  assert.equal(s.formattedRemaining, '0m');
});

test('getBottleStatus: explicit expired status wins', () => {
  const s = BottleManager.getBottleStatus({
    status: 'expired',
    expiresAt: Date.now() + HOUR,
    durationLimitMinutes: 120,
  });
  assert.equal(s.state, 'expired');
});

test('getBottleStatus: unstarted thawed bottle far from expiry is green', () => {
  const s = BottleManager.getBottleStatus({
    status: 'unstarted',
    expiresAt: Date.now() + 20 * HOUR,
    durationLimitMinutes: 24 * 60,
  });
  assert.equal(s.badgeClass, 'badge-green');
  assert.match(s.label, /left \(Unstarted\)/);
});

test('getBottleStatus: unstarted bottle under 2h is red, under 6h is yellow', () => {
  const red = BottleManager.getBottleStatus({
    status: 'unstarted',
    expiresAt: Date.now() + 60 * 60 * 1000,
    durationLimitMinutes: 24 * 60,
  });
  assert.equal(red.badgeClass, 'badge-red');

  const yellow = BottleManager.getBottleStatus({
    status: 'unstarted',
    expiresAt: Date.now() + 4 * HOUR,
    durationLimitMinutes: 24 * 60,
  });
  assert.equal(yellow.badgeClass, 'badge-yellow');
});

test('getBottleStatus: started bottle thresholds (red <15m, yellow <45m)', () => {
  const base = { status: 'inProgress', durationLimitMinutes: 120 };
  assert.equal(
    BottleManager.getBottleStatus({ ...base, expiresAt: Date.now() + 10 * 60 * 1000 }).badgeClass,
    'badge-red'
  );
  assert.equal(
    BottleManager.getBottleStatus({ ...base, expiresAt: Date.now() + 30 * 60 * 1000 }).badgeClass,
    'badge-yellow'
  );
  assert.equal(
    BottleManager.getBottleStatus({ ...base, expiresAt: Date.now() + 90 * 60 * 1000 }).badgeClass,
    'badge-green'
  );
});

test('getBottleStatus: remaining time formats as Xh Ym or Ym', () => {
  const base = { status: 'inProgress', durationLimitMinutes: 120 };
  const long = BottleManager.getBottleStatus({ ...base, expiresAt: Date.now() + 90 * 60 * 1000 });
  assert.equal(long.formattedRemaining, '1h 30m');
  const short = BottleManager.getBottleStatus({ ...base, expiresAt: Date.now() + 45 * 60 * 1000 });
  assert.equal(short.formattedRemaining, '45m');
});

// --------------------------------------------------- groupSessionsByDay ---
test('groupSessionsByDay: groups by day, newest first, with totals', () => {
  const now = Date.now();
  const sessions = [
    { id: 'a', type: 'pump', startTime: now - 1000, outputQty: 4 },
    { id: 'b', type: 'pump', startTime: now - 2000, outputQty: 3 },
    { id: 'c', type: 'feed', startTime: now - 26 * HOUR, outputQty: 0 },
  ];
  const groups = TrendsManager.groupSessionsByDay(sessions);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Today');
  assert.equal(groups[0].sessions.length, 2);
  assert.equal(groups[0].totalPumpQty, 7);
  assert.ok(groups[1].date < groups[0].date, 'groups sorted newest first');
  assert.equal(groups[1].feedCount, 1);
});

test('groupSessionsByDay: yesterday gets its label', () => {
  // Yesterday at noon local time — unambiguous regardless of when tests run
  const y = new Date();
  y.setDate(y.getDate() - 1);
  y.setHours(12, 0, 0, 0);
  const sessions = [{ id: 'a', type: 'feed', startTime: y.getTime() }];
  const groups = TrendsManager.groupSessionsByDay(sessions);
  assert.equal(groups[0].title, 'Yesterday');
});

// ------------------------------------------------------- renderSvgChart ---
test('renderSvgChart: empty input returns empty string', () => {
  assert.equal(TrendsManager.renderSvgChart([], 'oz'), '');
  assert.equal(TrendsManager.renderSvgChart(null, 'oz'), '');
});

test('renderSvgChart: renders an svg with day labels and values', () => {
  const days = [
    { dayName: 'Mon', pumpVolume: 20 },
    { dayName: 'Tue', pumpVolume: 24 },
    { dayName: 'Today', pumpVolume: 18 },
  ];
  const svg = TrendsManager.renderSvgChart(days, 'oz');
  assert.match(svg, /<svg/);
  assert.match(svg, /Today/);
  assert.match(svg, /24/);
  // smooth bezier path present
  assert.match(svg, /<path d="M/);
});

// ----------------------------------------------------- formatPossessive ---
test('formatPossessive: handles names, s-endings, and blanks', () => {
  const app = new App();
  assert.equal(app.formatPossessive('Nick'), "Nick's");
  assert.equal(app.formatPossessive('Chris'), "Chris'");
  assert.equal(app.formatPossessive('JAMES'), "JAMES'");
  assert.equal(app.formatPossessive(''), '');
  assert.equal(app.formatPossessive('   '), '');
  assert.equal(app.formatPossessive(null), '');
});

// --------------------------------------------------- applySessionEdits ---
test('applySessionEdits: edits feed quantity/time without mutating the original', () => {
  const original = {
    id: 'feed-1', type: 'feed', feedType: 'formula',
    startTime: 1000, outputQty: 4, unit: 'oz', notes: 'Formula Bottle Feed',
  };
  const updated = applySessionEdits(original, { outputQty: 4.55, startTime: 2000 });
  assert.equal(updated.outputQty, 4.6); // rounded to 0.1
  assert.equal(updated.startTime, 2000);
  assert.equal(updated.feedType, 'formula');
  assert.equal(original.outputQty, 4); // untouched
  assert.equal(original.startTime, 1000);
  assert.ok(updated.updatedAt >= Date.now() - 1000);
});

test('applySessionEdits: feedType change rewrites auto-generated notes only', () => {
  const auto = { id: 'f1', type: 'feed', feedType: 'formula', startTime: 1, outputQty: 4, notes: 'Formula Bottle Feed' };
  const switched = applySessionEdits(auto, { feedType: 'breastmilk' });
  assert.equal(switched.feedType, 'breastmilk');
  assert.equal(switched.notes, 'Breast Milk Bottle Feed');

  const custom = { ...auto, notes: 'midnight cluster feed, she was fussy' };
  const kept = applySessionEdits(custom, { feedType: 'breastmilk' });
  assert.equal(kept.feedType, 'breastmilk');
  assert.equal(kept.notes, 'midnight cluster feed, she was fussy');
});

test('applySessionEdits: pump duration edits recompute durationSec and endTime', () => {
  const original = {
    id: 'p1', type: 'pump', startTime: 1_000_000,
    endTime: 1_900_000, durationSec: 900, outputQty: 5, unit: 'oz', notes: '',
  };
  const updated = applySessionEdits(original, { durationMin: 20, outputQty: 6 });
  assert.equal(updated.durationSec, 1200);
  assert.equal(updated.endTime, 1_000_000 + 1200 * 1000);
  assert.equal(updated.outputQty, 6);
  assert.equal(original.durationSec, 900); // untouched
});

test('applySessionEdits: empty edits still stamps updatedAt', () => {
  const original = { id: 'p2', type: 'pump', startTime: 5, outputQty: 3 };
  const updated = applySessionEdits(original, {});
  assert.deepEqual({ ...updated, updatedAt: 0 }, { ...original, updatedAt: 0 });
  assert.ok(typeof updated.updatedAt === 'number');
});

// ------------------------------------------------------- feed-flow helpers ---
const {
  safetyWindowSec,
  paceOzPerMin,
  fmtClock,
  fmtSafetyWindow,
  clampAmount,
  resolveLockedType,
  shouldFlipType,
  feedPresets,
  getBottleTimerStatus,
  buildFeedFlowPrefill,
  resolveFeedTimerStart,
} = await import('../js/app.js');

test('safetyWindowSec: formula 1h, breast milk 2h (CDC)', () => {
  assert.equal(safetyWindowSec('formula'), 3600);
  assert.equal(safetyWindowSec('breastmilk'), 7200);
  assert.equal(safetyWindowSec('unknown'), 7200); // safe default
});

test('paceOzPerMin: oz per minute rounded to 2dp, 0 when unmeasurable', () => {
  assert.equal(paceOzPerMin(4, 600), 0.4);
  assert.equal(paceOzPerMin(3, 600), 0.3);
  assert.equal(paceOzPerMin(1, 90), 0.67);
  assert.equal(paceOzPerMin(4, 0), 0);
  assert.equal(paceOzPerMin(0, 600), 0);
});

test('fmtClock: mm:ss and h:mm:ss', () => {
  assert.equal(fmtClock(0), '00:00');
  assert.equal(fmtClock(65), '01:05');
  assert.equal(fmtClock(600), '10:00');
  assert.equal(fmtClock(3665), '1:01:05');
  assert.equal(fmtClock(-5), '00:00');
});

test('fmtSafetyWindow: human countdown labels', () => {
  assert.equal(fmtSafetyWindow(4500), '1h 15m');
  assert.equal(fmtSafetyWindow(3600), '1h 0m');
  assert.equal(fmtSafetyWindow(900), '15m');
  assert.equal(fmtSafetyWindow(30), '1m');
  assert.equal(fmtSafetyWindow(0), 'expired');
  assert.equal(fmtSafetyWindow(-10), 'expired');
});

test('clampAmount: clamps, snaps to step, no float dust', () => {
  assert.equal(clampAmount(4.04, 0, 10, 0.1), 4);
  assert.equal(clampAmount(4.06, 0, 10, 0.1), 4.1);
  assert.equal(clampAmount(10.9, 0, 10, 0.1), 10);
  assert.equal(clampAmount(-2, 0, 10, 0.1), 0);
  assert.equal(clampAmount(127, 0, 300, 5), 125);
  assert.equal(clampAmount(128, 0, 300, 5), 130);
  assert.equal(clampAmount(NaN, 0, 10, 0.1), 0);
  assert.equal(clampAmount('abc', 2, 10, 0.1), 2);
});

test('resolveLockedType: upper half formula, lower half breast milk', () => {
  assert.equal(resolveLockedType(0.2), 'formula');
  assert.equal(resolveLockedType(0.49), 'formula');
  assert.equal(resolveLockedType(0.5), 'breastmilk');
  assert.equal(resolveLockedType(0.8), 'breastmilk');
});

test('shouldFlipType: 62/38 hysteresis resists mid-gesture drift', () => {
  assert.equal(shouldFlipType('formula', 0.7), true);
  assert.equal(shouldFlipType('formula', 0.62), false);
  assert.equal(shouldFlipType('formula', 0.5), false);
  assert.equal(shouldFlipType('breastmilk', 0.3), true);
  assert.equal(shouldFlipType('breastmilk', 0.38), false);
  assert.equal(shouldFlipType('breastmilk', 0.5), false);
});

test('feedPresets: oz and mL preset chips', () => {
  assert.deepEqual(feedPresets('oz'), [2, 4, 6, 8]);
  assert.deepEqual(feedPresets('mL'), [60, 120, 180, 240]);
});

test('getBottleTimerStatus: wall-clock elapsed + per-type safety countdown', () => {
  const start = 1_000_000_000_000;
  const halfHour = getBottleTimerStatus(start, 'formula', start + 1800 * 1000);
  assert.equal(halfHour.elapsedSec, 1800);
  assert.equal(halfHour.windowSec, 3600);
  assert.equal(halfHour.safetyRemainingSec, 1800);
  assert.equal(halfHour.expired, false);

  const done = getBottleTimerStatus(start, 'formula', start + 3600 * 1000);
  assert.equal(done.safetyRemainingSec, 0);
  assert.equal(done.expired, true);

  const milk = getBottleTimerStatus(start, 'breastmilk', start + 3600 * 1000);
  assert.equal(milk.windowSec, 7200);
  assert.equal(milk.safetyRemainingSec, 3600);
  assert.equal(milk.expired, false);

  const future = getBottleTimerStatus(start + 5000, 'formula', start);
  assert.equal(future.elapsedSec, 0); // clock skew never goes negative
});

// ------------------------------------------------------- buildPumpSession ---
test('buildPumpSession: shapes a pump record from manual inputs', () => {
  const start = 1_000_000_000_000;
  const s = buildPumpSession({ quantity: 4.5, durationMin: 20, unit: 'oz', startTime: start, notes: 'morning' });
  assert.equal(s.type, 'pump');
  assert.ok(s.id.startsWith('pump_'));
  assert.equal(s.outputQty, 4.5);
  assert.equal(s.unit, 'oz');
  assert.equal(s.durationSec, 1200);
  assert.equal(s.startTime, start);
  assert.equal(s.endTime, start + 1200 * 1000);
  assert.equal(s.createdAt, s.endTime);
  assert.equal(s.notes, 'morning');
});

test('buildPumpSession: defaults unit to oz and notes to empty string', () => {
  const s = buildPumpSession({ quantity: 100, durationMin: 15 });
  assert.equal(s.unit, 'oz');
  assert.equal(s.notes, '');
  assert.equal(s.durationSec, 900);
});

test('buildPumpSession: fractional minutes round to whole seconds', () => {
  const s = buildPumpSession({ quantity: 3, durationMin: 12.5 });
  assert.equal(s.durationSec, 750);
});

test('buildPumpSession: mL unit passes through untouched', () => {
  const s = buildPumpSession({ quantity: 120, durationMin: 10, unit: 'mL' });
  assert.equal(s.unit, 'mL');
  assert.equal(s.outputQty, 120);
});

// ----------------------------------------------------- thaw-from-stash ---
test('buildThawUpdate: frozen pouch moves frozen -> thawed with a fresh 24h clock', () => {
  const now = 1_000_000_000_000;
  const item = {
    id: 'inv_1', status: 'active', location: 'freezer',
    pumpedAt: now - 30 * DAY, quantity: 4, unit: 'oz',
    expiresAt: now + 150 * DAY, notes: 'morning bag',
  };
  const thawed = buildThawUpdate(item, {}, now);
  assert.equal(thawed.location, THAWED_LOCATION);
  assert.equal(thawed.thawedAt, now);
  assert.equal(thawed.expiresAt, now + 24 * HOUR);
  // identity + payload preserved
  assert.equal(thawed.id, 'inv_1');
  assert.equal(thawed.quantity, 4);
  assert.equal(thawed.pumpedAt, item.pumpedAt);
  assert.equal(thawed.notes, 'morning bag');
  // original untouched
  assert.equal(item.location, 'freezer');
  assert.equal(item.expiresAt, now + 150 * DAY);
});

test('buildThawUpdate: deep freezer thaws too; custom thawed window respected', () => {
  const now = 1_000_000_000_000;
  const item = { id: 'inv_2', status: 'active', location: 'deepFreezer', pumpedAt: now, quantity: 5, unit: 'oz', expiresAt: now };
  const thawed = buildThawUpdate(item, { thawedBottleHours: 12 }, now);
  assert.equal(thawed.location, 'thawed');
  assert.equal(thawed.expiresAt, now + 12 * HOUR);
});

test('buildThawUpdate: rejects non-frozen, inactive, or missing items', () => {
  const now = 1_000_000_000_000;
  const base = { id: 'x', status: 'active', pumpedAt: now, quantity: 4, unit: 'oz', expiresAt: now };
  assert.equal(buildThawUpdate({ ...base, location: 'fridge' }, {}, now), null);
  assert.equal(buildThawUpdate({ ...base, location: 'thawed' }, {}, now), null);
  assert.equal(buildThawUpdate({ ...base, location: 'freezer', status: 'used' }, {}, now), null);
  assert.equal(buildThawUpdate(null, {}, now), null);
});

test('FROZEN_LOCATIONS: covers both freezer types', () => {
  assert.deepEqual([...FROZEN_LOCATIONS].sort(), ['deepFreezer', 'freezer']);
});

// ---------------------------------------------------------- summarizeStash ---
test('summarizeStash: thawed items count into fridge totals', () => {
  const items = [
    { location: 'fridge', quantity: 6, unit: 'oz' },
    { location: 'thawed', quantity: 4, unit: 'oz' },
    { location: 'freezer', quantity: 8, unit: 'oz' },
    { location: 'deepFreezer', quantity: 10, unit: 'oz' },
    { location: 'room', quantity: 2, unit: 'oz' },
  ];
  const s = summarizeStash(items);
  assert.equal(s.fridgeOz, 10); // 6 fridge + 4 thawed
  assert.equal(s.freezerOz, 8);
  assert.equal(s.deepFreezerOz, 10);
  assert.equal(s.totalOz, 30);
  assert.equal(s.totalBags, 5);
});

test('summarizeStash: mL quantities convert to oz, empty input is zeros', () => {
  const s = summarizeStash([{ location: 'thawed', quantity: 120, unit: 'mL' }]);
  assert.ok(Math.abs(s.fridgeOz - 120 / 29.5735) < 0.05);
  assert.deepEqual(summarizeStash([]), { totalOz: 0, fridgeOz: 0, freezerOz: 0, deepFreezerOz: 0, totalBags: 0 });
});

// ----------------------------------------------------- buildFeedFlowPrefill ---
test('buildFeedFlowPrefill: thawed pouch prefills breastmilk type + oz amount + source', () => {
  const item = { id: 'inv_9', status: 'active', location: 'thawed', quantity: 4, unit: 'oz', expiresAt: Date.now() + HOUR };
  const pre = buildFeedFlowPrefill(item);
  assert.deepEqual(pre, { type: 'breastmilk', amountOz: 4, sourceInventoryId: 'inv_9' });
});

test('buildFeedFlowPrefill: mL pouches convert to oz, rounded to 0.1', () => {
  const item = { id: 'inv_10', status: 'active', location: 'thawed', quantity: 120, unit: 'mL' };
  const pre = buildFeedFlowPrefill(item);
  assert.equal(pre.type, 'breastmilk');
  assert.equal(pre.amountOz, 4.1);
});

test('buildFeedFlowPrefill: rejects frozen, fridge, used, or missing items', () => {
  const base = { id: 'x', status: 'active', quantity: 4, unit: 'oz' };
  assert.equal(buildFeedFlowPrefill({ ...base, location: 'freezer' }), null);
  assert.equal(buildFeedFlowPrefill({ ...base, location: 'fridge' }), null);
  assert.equal(buildFeedFlowPrefill({ ...base, location: 'thawed', status: 'used' }), null);
  assert.equal(buildFeedFlowPrefill(null), null);
});

// ----------------------------------------------- shouldShowThawTile ---
test('shouldShowThawTile: tile visible only when frozen stash exists', () => {
  assert.equal(shouldShowThawTile(0), false);
  assert.equal(shouldShowThawTile(3), true);
  assert.equal(shouldShowThawTile(1), true);
  assert.equal(shouldShowThawTile(-2), false);
  assert.equal(shouldShowThawTile(NaN), false);
  assert.equal(shouldShowThawTile(undefined), false);
});

// --------------------------------------------- normalizePumpDuration ---
test('normalizePumpDuration: accepts 10/15/20 chips and typed minutes', () => {
  assert.equal(normalizePumpDuration('10'), 10);
  assert.equal(normalizePumpDuration(15), 15);
  assert.equal(normalizePumpDuration('20'), 20);
  assert.equal(normalizePumpDuration('14.6'), 15); // rounds to whole minutes
});
test('normalizePumpDuration: rejects blank, zero, negative, non-numeric', () => {
  assert.equal(normalizePumpDuration(''), null);
  assert.equal(normalizePumpDuration('0'), null);
  assert.equal(normalizePumpDuration(0), null);
  assert.equal(normalizePumpDuration(-5), null);
  assert.equal(normalizePumpDuration('abc'), null);
  assert.equal(normalizePumpDuration(null), null);
  assert.equal(normalizePumpDuration(undefined), null);
});

// -------------------------------------------- resolveFeedTimerStart ---
test('resolveFeedTimerStart: carries draft type/amount/source into the live timer', () => {
  const start = resolveFeedTimerStart({ type: 'breastmilk', amountOz: 5.5, sourceInventoryId: 'inv_1' });
  assert.equal(start.type, 'breastmilk');
  assert.equal(start.amountOz, 5.5);
  assert.equal(start.sourceInventoryId, 'inv_1');
});
test('resolveFeedTimerStart: safe defaults when the draft was never picked', () => {
  assert.deepEqual(resolveFeedTimerStart({}), { type: 'formula', amountOz: 4.0, sourceInventoryId: null });
  assert.deepEqual(resolveFeedTimerStart(null), { type: 'formula', amountOz: 4.0, sourceInventoryId: null });
  assert.deepEqual(resolveFeedTimerStart({ type: 'breastmilk', amountOz: 0 }), { type: 'breastmilk', amountOz: 4.0, sourceInventoryId: null });
  const unknown = resolveFeedTimerStart({ type: 'weird', amountOz: 3 });
  assert.equal(unknown.type, 'formula'); // unknown type falls back to formula
});
