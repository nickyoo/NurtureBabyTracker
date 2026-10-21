// Pure helpers of core/photos.js (downscale + crop geometry) and
// core/stash.js (pouch record validation shared with backup import).
// The canvas/IndexedDB paths run in Chromium: tests/e2e/core.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, squareCrop, MAX_EDGE, JPEG_QUALITY, PhotoDecodeError, orphanPhotoIds } from '../js/core/photos.js';
import { sanitizeInventoryItem, StashNotFoundError, stashTotalsByUnit } from '../js/core/stash.js';
import { roundForUnit } from '../js/core/units.js';

const NOW = new Date('2026-10-15T12:00:00').getTime();

test('photo constants match the spec (≤1600px, q≈0.82)', () => {
  assert.equal(MAX_EDGE, 1600);
  assert.equal(JPEG_QUALITY, 0.82);
  const e = new PhotoDecodeError();
  assert.equal(e.name, 'PhotoDecodeError');
  assert.match(e.message, /can’t be opened/);
});

test('fitWithin: long edge capped at 1600, aspect kept, never upscaled', () => {
  assert.deepEqual(fitWithin(3000, 2000), { width: 1600, height: 1067, scale: 1600 / 3000 });
  assert.deepEqual(fitWithin(2000, 3000), { width: 1067, height: 1600, scale: 1600 / 3000 });
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200, scale: 1600 / 4032 }, 'iPhone 12 MP');
  assert.deepEqual(fitWithin(1600, 1600), { width: 1600, height: 1600, scale: 1 });
  assert.deepEqual(fitWithin(100, 50), { width: 100, height: 50, scale: 1 });
  assert.deepEqual(fitWithin(10000, 10, 1600), { width: 1600, height: 2, scale: 0.16 });
  assert.deepEqual(fitWithin(50000, 1), { width: 1600, height: 1, scale: 1600 / 50000 }, 'never 0px');
  assert.deepEqual(fitWithin(0, NaN), { width: 1, height: 1, scale: 1 }, 'garbage dimensions stay drawable');
  assert.deepEqual(fitWithin(800, 600, 180), { width: 180, height: 135, scale: 180 / 800 });
});

test('squareCrop: centred by default; explicit crop clamped inside the image', () => {
  assert.deepEqual(squareCrop(400, 300), { sx: 50, sy: 0, side: 300 });
  assert.deepEqual(squareCrop(300, 400), { sx: 0, sy: 50, side: 300 });
  assert.deepEqual(squareCrop(500, 500), { sx: 0, sy: 0, side: 500 });
  assert.deepEqual(squareCrop(400, 300, { x: 0, y: 0, size: 0.5 }), { sx: 0, sy: 0, side: 150 });
  assert.deepEqual(squareCrop(400, 300, { x: 0.9, y: 0.9, size: 0.5 }), { sx: 250, sy: 150, side: 150 }, 'pushed back inside');
  assert.deepEqual(squareCrop(400, 300, { x: -1, y: -1, size: 5 }), { sx: 0, sy: 0, side: 300 }, 'size capped at the short edge');
  assert.equal(squareCrop(400, 300, { size: 0 }).side, 15, 'tiny crops floor at 5% of the short edge');
  assert.deepEqual(squareCrop(400, 300, { size: NaN }), { sx: 50, sy: 0, side: 300 });
});

const pouch = (over = {}) => ({ id: 'inv_1', pumpedAt: NOW - 3600e3, quantity: 4, unit: 'oz', location: 'fridge', expiresAt: NOW + 3 * 86400e3, status: 'active', notes: '', createdAt: NOW - 3600e3, ...over });

test('sanitizeInventoryItem: keeps the v1 pouch shape, known keys only', () => {
  const p = sanitizeInventoryItem({ ...pouch(), thawedAt: NOW, usedAt: 'x', updatedAt: NOW, deviceId: 'dev_abcdef12', consumedBy: ['evt_1', '<x>', 5], evil: '<script>' });
  assert.deepEqual(p, { ...pouch(), thawedAt: NOW, updatedAt: NOW, deviceId: 'dev_abcdef12', consumedBy: ['evt_1'] });
  assert.equal(sanitizeInventoryItem(pouch({ location: 'thawed' })).location, 'thawed');
});

test('sanitizeInventoryItem: rejects unusable pouches, repairs the rest', () => {
  for (const [raw, why] of [
    [null, 'null'], [[], 'array'], [pouch({ id: '<img src=x>' }), 'bad id'], [pouch({ quantity: NaN }), 'NaN quantity'],
    [pouch({ quantity: -1 }), 'negative'], [pouch({ quantity: 1e6 }), 'absurd'], [pouch({ location: 'garage' }), 'location'],
    [pouch({ pumpedAt: 'yesterday' }), 'time'], [pouch({ pumpedAt: 3 }), '1970'],
  ]) assert.equal(sanitizeInventoryItem(raw), null, why);
  const fixed = sanitizeInventoryItem(pouch({ quantity: '120', unit: 'ml', status: 'hacked', expiresAt: null, createdAt: undefined, notes: 'n'.repeat(5000) }));
  assert.deepEqual([fixed.quantity, fixed.unit, fixed.status, fixed.expiresAt, fixed.createdAt, fixed.notes.length],
    [120, 'mL', 'active', fixed.pumpedAt, fixed.pumpedAt, 2000]);
  const proto = sanitizeInventoryItem(JSON.parse(`{"id":"inv_p","pumpedAt":${NOW},"quantity":1,"location":"room","__proto__":{"polluted":1}}`));
  assert.ok(!Object.prototype.hasOwnProperty.call(proto, '__proto__'));
  assert.equal(({}).polluted, undefined);
  assert.equal(sanitizeInventoryItem(pouch({ consumedBy: Array.from({ length: 50 }, (_, i) => `evt_${i}`) })).consumedBy.length, 20);
});

test('StashNotFoundError carries the id', () => {
  const e = new StashNotFoundError('inv_x');
  assert.deepEqual([e.name, e.id], ['StashNotFoundError', 'inv_x']);
});

test('orphanPhotoIds: only unreferenced photos older than a day are dropped', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const recs = [
    { id: 'pho_used', createdAt: NOW - 30 * DAY },
    { id: 'pho_old', createdAt: NOW - 2 * DAY },
    { id: 'pho_fresh', createdAt: NOW - 60 * 1000 },   // maybe in an open sheet / Undo window
    { id: 'pho_nodate' },                               // unknown age: kept
  ];
  assert.deepEqual(orphanPhotoIds(recs, ['pho_used'], { now: NOW }), ['pho_old']);
  assert.deepEqual(orphanPhotoIds(recs, new Set(['pho_used', 'pho_old']), { now: NOW }), []);
  assert.deepEqual(orphanPhotoIds(recs, [], { now: NOW, minAgeMs: 0 }).sort(), ['pho_fresh', 'pho_old', 'pho_used']);
  assert.deepEqual(orphanPhotoIds(null, [], { now: NOW }), []);
});

test('DI-10: Today and the Stash tab total the same pouches the same way (387 vs 386 mL)', () => {
  const items = [
    { quantity: 4, unit: 'oz', location: 'thawed' },
    { quantity: 120, unit: 'mL', location: 'fridge' },
    { quantity: 5, unit: 'oz', location: 'freezer' },
  ];
  const t = stashTotalsByUnit(items);
  const ml = { total: roundForUnit(t.mL.total, 'mL'), fresh: roundForUnit(t.mL.fresh, 'mL'), frozen: roundForUnit(t.mL.frozen, 'mL') };
  assert.deepEqual(ml, { total: 386, fresh: 238, frozen: 148 }, 'what the Stash tab shows (rounded once)');
  assert.equal(roundForUnit(t.oz.total, 'oz'), 13.1);
  assert.deepEqual(stashTotalsByUnit([{ quantity: 2, unit: 'oz', location: 'room' }, { quantity: NaN, unit: 'oz', location: 'deepFreezer' }]).oz, { total: 2, fresh: 2, frozen: 0 }, 'room counts as fresh; NaN as 0');
});
