// v1 → v2 test port (the last of tests/nurture.test.js, deleted with the v1
// modules). Most v1 tests moved earlier, next to the v2 module that took the
// behaviour over:
//   newId → db.test.js · calculateExpiration / getUrgency / buildThawUpdate /
//   summarizeStash / shouldShowThawTile / FROZEN_LOCATIONS → inventory.test.js ·
//   safetyWindowSec / paceOzPerMin / fmtSafetyWindow / getBottleTimerStatus →
//   safety.test.js · fmtClock → time.test.js · clampAmount / convertQty /
//   sumQty (sumAmounts) / feedPresets (inputConfig) → units.test.js ·
//   formatPossessive / plural → format.test.js · groupSessionsByDay →
//   trends.test.js (groupByDay) · applySessionEdits → store.test.js
//   (applyEventPatch) and timeline-report-event.test.js (edit validation).
// v1-only shapes with no v2 equivalent (prepared-bottle records, the v1 SVG
// chart, auto-generated "Formula Bottle Feed" notes, buildPumpSession's
// session record) were retired with their features.
// What's left is ported here: the express-bottle gesture's milk pick with
// hysteresis (v1 resolveLockedType / shouldFlipType), its amount slide, the
// thawed-pouch prefill (v1 buildFeedFlowPrefill) and edit immutability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as units from '../js/core/units.js';
import { applyEventPatch } from '../js/core/store.js';

const { _test: feed } = await import('../js/sheets/feed.js');
const ctx = { units };

test('express gesture: first pick is by zone, upper = the other milk, lower = last used', () => {
  const z = { boundary: 400, lower: 'breastmilk', upper: 'formula' };
  assert.equal(feed.expressMilk({ ...z, milk: null, y: 350 }), 'formula');
  assert.equal(feed.expressMilk({ ...z, milk: null, y: 450 }), 'breastmilk');
});

test('express gesture: hysteresis resists drift across the boundary (v1 shouldFlipType)', () => {
  const z = { boundary: 400, lower: 'breastmilk', upper: 'formula', hyst: 20 };
  assert.equal(feed.expressMilk({ ...z, milk: 'breastmilk', y: 390 }), 'breastmilk', 'just past the line: no flip');
  assert.equal(feed.expressMilk({ ...z, milk: 'breastmilk', y: 379 }), 'formula', '20px past: flips');
  assert.equal(feed.expressMilk({ ...z, milk: 'formula', y: 415 }), 'formula');
  assert.equal(feed.expressMilk({ ...z, milk: 'formula', y: 421 }), 'breastmilk');
});

test('express gesture: with formula hidden there is only one milk', () => {
  assert.equal(feed.expressMilk({ milk: null, y: 0, boundary: -Infinity, lower: 'breastmilk', upper: null }), 'breastmilk');
  assert.equal(feed.expressMilk({ milk: 'formula', y: 0, boundary: -Infinity, lower: 'breastmilk', upper: null }), 'breastmilk');
});

test('express gesture: sideways slide steps the amount, clamped, no float dust', () => {
  const oz = units.inputConfig('oz');
  const ml = units.inputConfig('mL');
  assert.equal(feed.expressAmount(units, 4, 0, oz), 4);
  assert.equal(feed.expressAmount(units, 4, 32, oz), 4 + 2 * oz.step);
  assert.equal(feed.expressAmount(units, 4, -10000, oz), oz.step, 'never below one step');
  assert.equal(feed.expressAmount(units, 4, 1e6, oz), oz.max, 'never above the max');
  const m = feed.expressAmount(units, 120, 16, ml);
  assert.equal(m, 120 + ml.step);
  assert.ok(Number.isInteger(m), 'mL stays an integer');
});

test('thawed pouch prefill: amount converts to the display unit (v1 buildFeedFlowPrefill)', () => {
  assert.equal(feed.pouchAmount(ctx, { quantity: 4, unit: 'oz' }, 'oz'), 4);
  assert.equal(feed.pouchAmount(ctx, { quantity: 150, unit: 'mL' }, 'oz'), 5.1, '150 mL ≈ 5.07 oz → 5.1');
  assert.equal(feed.pouchAmount(ctx, { quantity: 4, unit: 'oz' }, 'mL'), 120, '118 mL snaps to the mL stepper (fine step)');
  assert.equal(feed.pouchAmount(ctx, { quantity: 3.5 }, 'oz'), 3.5, 'missing unit reads as oz');
});

test('editing an entry never mutates the original (v1 applySessionEdits)', () => {
  const NOW = Date.UTC(2026, 9, 14, 12);
  const original = Object.freeze({
    id: 'evt_1', type: 'feed', startTime: NOW - 3600e3, endTime: NOW - 3000e3, note: '', babyId: 'baby_a',
    createdAt: NOW - 3600e3, updatedAt: NOW - 3600e3, deviceId: 'dev_abcdef',
    data: Object.freeze({ method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }),
  });
  const u = applyEventPatch(original, { startTime: NOW - 1800e3, endTime: NOW - 1200e3, data: { amount: 4.5 } }, NOW);
  assert.equal(u.data.amount, 4.5);
  assert.equal(u.data.milk, 'formula', 'data merges one level deep');
  assert.equal(u.startTime, NOW - 1800e3);
  assert.equal(original.data.amount, 4);
  assert.equal(original.startTime, NOW - 3600e3);
  assert.ok(u.updatedAt > original.updatedAt);
});
