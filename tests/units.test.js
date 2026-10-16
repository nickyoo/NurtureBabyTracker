// core/units.js — oz/mL conversion, totals, formatting, steppers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ML_PER_OZ, normalizeUnit, convertQty, roundForUnit, amountOf, sumAmounts, amountParts, formatAmount,
  clampAmount, inputConfig, stepAmount, switchUnit, toFiniteNumber, MAX_NUMBER_STRING,
} from '../js/core/units.js';

test('normalizeUnit: mL in any case, everything else oz', () => {
  assert.equal(normalizeUnit('mL'), 'mL');
  assert.equal(normalizeUnit('ml'), 'mL');
  assert.equal(normalizeUnit(' ML '), 'mL');
  assert.equal(normalizeUnit('oz'), 'oz');
  assert.equal(normalizeUnit(undefined), 'oz');
  assert.equal(normalizeUnit(42), 'oz');
  assert.equal(normalizeUnit('cups'), 'oz');
});

test('convertQty: oz <-> mL, identity, missing unit as oz (ported v1 cases)', () => {
  assert.equal(convertQty(4, 'oz', 'oz'), 4);
  assert.equal(Math.round(convertQty(4, 'oz', 'mL')), 118);
  assert.equal(Math.round(convertQty(118.294, 'mL', 'oz') * 10) / 10, 4);
  assert.equal(Math.round(convertQty(2, undefined, 'mL')), 59);
  assert.equal(convertQty(1, 'oz', 'mL'), ML_PER_OZ);
});

test('convertQty: NaN / null / garbage count as 0 instead of poisoning totals', () => {
  assert.equal(convertQty(NaN, 'oz', 'oz'), 0);
  assert.equal(convertQty(null, 'mL', 'oz'), 0);
  assert.equal(convertQty(undefined, 'oz', 'mL'), 0);
  assert.equal(convertQty(Infinity, 'oz', 'mL'), 0);
  assert.equal(convertQty('abc', 'oz', 'mL'), 0);
  assert.equal(convertQty(true, 'oz', 'oz'), 0, 'booleans are not numbers');
  assert.equal(convertQty('4', 'oz', 'oz'), 4, 'numeric strings are');
});

test('toFiniteNumber: strict coercion', () => {
  assert.equal(toFiniteNumber(3), 3);
  assert.equal(toFiniteNumber(' 4.5 '), 4.5);
  assert.equal(toFiniteNumber('.5'), 0.5);
  assert.equal(toFiniteNumber('1e3'), 1000);
  assert.equal(toFiniteNumber('1e400'), null);
  assert.equal(toFiniteNumber(''), null);
  assert.equal(toFiniteNumber('4oz'), null);
  assert.equal(toFiniteNumber('0x10'), null);
  assert.equal(toFiniteNumber([4]), null);
  assert.equal(toFiniteNumber({ valueOf: () => 4 }), null);
  assert.equal(toFiniteNumber(false), null);
  assert.equal(toFiniteNumber(-Infinity), null);
});

test('roundForUnit: whole mL, 0.1 oz, no float dust', () => {
  assert.equal(roundForUnit(118.294, 'mL'), 118);
  assert.equal(roundForUnit(4.0571, 'oz'), 4.1);
  assert.equal(roundForUnit(0.1 + 0.2, 'oz'), 0.3);
  assert.equal(roundForUnit(NaN, 'oz'), 0);
});

test('amountOf: reads events, pouches and v1 sessions', () => {
  assert.deepEqual(amountOf({ data: { amount: 120, unit: 'mL' } }), { amount: 120, unit: 'mL' });
  assert.deepEqual(amountOf({ quantity: 4, unit: 'oz' }), { amount: 4, unit: 'oz' });
  assert.deepEqual(amountOf({ outputQty: NaN, unit: 'mL' }), { amount: null, unit: 'mL' });
  assert.deepEqual(amountOf({ data: { kind: 'wet' } }), { amount: null, unit: 'oz' });
  assert.deepEqual(amountOf(null), { amount: null, unit: 'oz' });
});

test('sumAmounts: mixed units total correctly in the display unit', () => {
  // Regression (AUDIT F6): 4 oz + 120 mL used to show "124 mL".
  const events = [
    { type: 'feed', data: { amount: 4, unit: 'oz' } },
    { type: 'feed', data: { amount: 120, unit: 'mL' } },
    { type: 'feed', data: { amount: null, unit: 'mL' } }, // legacy NaN pump
    { type: 'feed', data: { method: 'breast', left: 300 } }, // no amount
    { type: 'diaper', data: { kind: 'wet' } },
  ];
  assert.equal(sumAmounts(events, 'mL'), 238);
  assert.equal(sumAmounts(events, 'oz'), 8.1);
  assert.equal(sumAmounts([], 'oz'), 0);
  assert.equal(sumAmounts(null, 'mL'), 0);
  assert.ok(Math.abs(sumAmounts(events, 'oz', { round: false }) - (4 + 120 / ML_PER_OZ)) < 1e-9);
  const pouches = [{ quantity: 5, unit: 'oz' }, { quantity: 150, unit: 'mL' }];
  assert.equal(sumAmounts(pouches, 'oz'), 10.1);
});

test('formatAmount / amountParts: "4 oz", "120 mL", "—" when missing', () => {
  assert.equal(formatAmount(4, 'oz'), '4 oz');
  assert.equal(formatAmount(4.25, 'oz'), '4.3 oz');
  assert.equal(formatAmount(120, 'mL'), '120 mL');
  assert.equal(formatAmount(4, 'oz', 'mL'), '118 mL');
  assert.equal(formatAmount(120, 'mL', 'oz'), '4.1 oz');
  assert.equal(formatAmount(null, 'oz'), '—');
  assert.equal(formatAmount(NaN, 'mL', 'oz'), '—');
  assert.equal(formatAmount(0, 'oz'), '0 oz');
  assert.deepEqual(amountParts(4, 'oz', 'mL'), { value: '118', unit: 'mL', missing: false });
  assert.deepEqual(amountParts(undefined, 'mL'), { value: '—', unit: 'mL', missing: true });
});

test('clampAmount: clamps, snaps to step, no float dust (ported v1 cases)', () => {
  assert.equal(clampAmount(4.04, 0, 10, 0.1), 4);
  assert.equal(clampAmount(4.06, 0, 10, 0.1), 4.1);
  assert.equal(clampAmount(10.9, 0, 10, 0.1), 10);
  assert.equal(clampAmount(-2, 0, 10, 0.1), 0);
  assert.equal(clampAmount(127, 0, 300, 5), 125);
  assert.equal(clampAmount(128, 0, 300, 5), 130);
  assert.equal(clampAmount(NaN, 0, 10, 0.1), 0);
  assert.equal(clampAmount('abc', 2, 10, 0.1), 2);
  assert.equal(clampAmount(2.26, 0, 10, 0.25), 2.25);
  assert.equal(clampAmount(0.7 + 0.1, 0, 10, 0.1), 0.8);
});

test('inputConfig: per-unit presets/chips (AUDIT F14: no +0.5 mL chips)', () => {
  assert.deepEqual([...inputConfig('oz').presets], [2, 4, 6, 8]);
  assert.deepEqual([...inputConfig('mL').presets], [60, 120, 180, 240]);
  assert.deepEqual([...inputConfig('mL').chips], [15, 30, 60, 90]);
  assert.ok(inputConfig('ml').chips.every(c => c >= 15), 'mL chips are mL-sized');
  assert.equal(inputConfig(undefined), inputConfig('oz'));
});

test('stepAmount: nudges within the unit range; NaN never escapes', () => {
  assert.equal(stepAmount(4, 0.5, 'oz'), 4.5);
  assert.equal(stepAmount(0.2, -0.5, 'oz'), 0);
  assert.equal(stepAmount(16, 1, 'oz'), 16);
  assert.equal(stepAmount(120, 15, 'mL'), 135);
  assert.equal(stepAmount(NaN, 30, 'mL'), 30);
  assert.equal(stepAmount(4, NaN, 'oz'), 4);
});

test('switchUnit: converts an in-progress amount and snaps to the new unit', () => {
  assert.equal(switchUnit(4, 'oz', 'mL'), 120);
  assert.equal(switchUnit(120, 'mL', 'oz'), 4.1);
  assert.equal(switchUnit(4, 'oz', 'oz'), 4);
  assert.equal(switchUnit(null, 'oz', 'mL'), 0);
});

// ---------------------------------------------------- regressions (R2) ---

test('regression: toFiniteNumber rejects a huge numeric-looking string at once (import ReDoS)', () => {
  // Was quadratic: 40k digits + 'x' took ~5 s, so a 100 KB backup froze the tab.
  const t0 = performance.now();
  assert.equal(toFiniteNumber('1'.repeat(1e5) + 'x'), null);
  assert.equal(toFiniteNumber(' '.repeat(1e5) + '1'), null);
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
  // Up to the cap, the (now unambiguous) pattern still fails fast on garbage.
  const t1 = performance.now();
  for (let i = 0; i < 2000; i++) toFiniteNumber(`${'1'.repeat(MAX_NUMBER_STRING - 1)}x`);
  assert.ok(performance.now() - t1 < 200, 'near-cap garbage stays cheap');
  assert.equal(toFiniteNumber('1'.repeat(MAX_NUMBER_STRING)), Number('1'.repeat(MAX_NUMBER_STRING)), 'a string at the cap still parses');
  assert.equal(toFiniteNumber('1'.repeat(MAX_NUMBER_STRING + 1)), null);
  // Same accepted / refused forms as before the rewrite.
  for (const [str, n] of [['4.', 4], ['+3', 3], ['-1.5e-2', -0.015], [' 2 ', 2], ['.5e1', 5], ['1.e2', 100], ['007', 7]]) {
    assert.equal(toFiniteNumber(str), n, str);
  }
  for (const str of ['.', '1..2', 'e5', '1e', '--1', '1.2.3', '1 2', '.e1', '+']) assert.equal(toFiniteNumber(str), null, str);
});
