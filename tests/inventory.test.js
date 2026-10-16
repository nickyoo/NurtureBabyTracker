// domain/inventory.js — FIFO + CDC expiry engine. The first half ports the
// v1 tests (tests/nurture.test.js) 1:1 against the moved module, whose
// exports are kept identical; the second half covers the v2 helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  InventoryManager, buildThawUpdate, summarizeStash, THAWED_LOCATION, FROZEN_LOCATIONS, shouldShowThawTile,
  calculateExpiration, getUrgency, effectiveStatus, isUsable, compareFifo, filterInventory, pickUseNext,
  buildInventoryItem, applyInventoryPatch, consumeUpdate, inventoryUpdatedAt, DEFAULT_STORAGE_WINDOWS, LOCATIONS, STATUSES,
  MAX_STORAGE_WINDOWS, maxExpiresAt,
} = await import('../js/domain/inventory.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-15T12:00:00').getTime();

// ------------------------------------------------- ported from v1 tests ---

test('calculateExpiration: fridge defaults to +4 days', () => {
  const pumpedAt = new Date('2026-09-20T10:00:00').getTime();
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'fridge'), pumpedAt + 4 * DAY);
});

test('calculateExpiration: room temp defaults to +4 hours', () => {
  const pumpedAt = new Date('2026-09-20T10:00:00').getTime();
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'room'), pumpedAt + 4 * HOUR);
});

test('calculateExpiration: freezer +6 months, deep freezer +12 months (calendar months)', () => {
  const pumpedAt = new Date('2026-01-15T10:00:00').getTime();
  const six = new Date('2026-01-15T10:00:00'); six.setMonth(six.getMonth() + 6);
  const twelve = new Date('2026-01-15T10:00:00'); twelve.setMonth(twelve.getMonth() + 12);
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'freezer'), six.getTime());
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'deepFreezer'), twelve.getTime());
});

test('calculateExpiration: custom storage windows are respected', () => {
  const pumpedAt = new Date('2026-09-20T10:00:00').getTime();
  const windows = { roomTempHours: 2, fridgeDays: 2, freezerMonths: 3, deepFreezerMonths: 6 };
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'fridge', windows), pumpedAt + 2 * DAY);
  assert.equal(InventoryManager.calculateExpiration(pumpedAt, 'room', windows), pumpedAt + 2 * HOUR);
});

test('calculateExpiration: unknown location leaves timestamp unchanged', () => {
  assert.equal(InventoryManager.calculateExpiration(NOW, 'countertop'), NOW);
  assert.equal(calculateExpiration(NOW, 'countertop'), NOW, 'plain export agrees');
});

test('getUrgency: expired / red <12h / yellow 12–48h / green days / green months', () => {
  assert.equal(InventoryManager.getUrgency(Date.now() - HOUR).level, 'expired');
  assert.equal(InventoryManager.getUrgency(Date.now() - HOUR).badgeClass, 'badge-expired');
  assert.equal(InventoryManager.getUrgency(Date.now() + 6 * HOUR).badgeClass, 'badge-red');
  assert.equal(InventoryManager.getUrgency(Date.now() + 24 * HOUR).badgeClass, 'badge-yellow');
  assert.match(InventoryManager.getUrgency(Date.now() + 5 * DAY).label, /days left/);
  assert.match(InventoryManager.getUrgency(Date.now() + 90 * DAY).label, /months left/);
});

test('getUrgency: injectable now, boundaries, NaN is expired (never "fresh")', () => {
  assert.equal(getUrgency(NOW, NOW).level, 'expired', 'exactly at expiry is expired');
  assert.equal(getUrgency(NOW + 12 * HOUR - 1, NOW).level, 'red');
  assert.equal(getUrgency(NOW + 12 * HOUR, NOW).level, 'yellow');
  assert.equal(getUrgency(NOW + 48 * HOUR, NOW).level, 'green');
  assert.equal(getUrgency(NOW + 30 * 60 * 1000, NOW).label, 'Expires in 1h (Today!)', 'rounds up to at least 1h');
  assert.equal(getUrgency(NaN, NOW).level, 'expired');
  assert.equal(getUrgency(undefined, NOW).level, 'expired');
});

test('buildThawUpdate: frozen pouch moves frozen -> thawed with a fresh 24h clock', () => {
  const now = 1_000_000_000_000;
  const item = { id: 'inv_1', status: 'active', location: 'freezer', pumpedAt: now - 30 * DAY, quantity: 4, unit: 'oz', expiresAt: now + 150 * DAY, notes: 'morning bag' };
  const thawed = buildThawUpdate(item, {}, now);
  assert.equal(thawed.location, THAWED_LOCATION);
  assert.equal(thawed.thawedAt, now);
  assert.equal(thawed.expiresAt, now + 24 * HOUR);
  assert.equal(thawed.id, 'inv_1');
  assert.equal(thawed.quantity, 4);
  assert.equal(thawed.pumpedAt, item.pumpedAt);
  assert.equal(thawed.notes, 'morning bag');
  assert.equal(item.location, 'freezer', 'original untouched');
  assert.equal(item.expiresAt, now + 150 * DAY);
});

test('buildThawUpdate: deep freezer thaws too; custom thawed window respected', () => {
  const now = 1_000_000_000_000;
  const item = { id: 'inv_2', status: 'active', location: 'deepFreezer', pumpedAt: now, quantity: 5, unit: 'oz', expiresAt: now };
  assert.equal(buildThawUpdate(item, { thawedBottleHours: 12 }, now).expiresAt, now + 12 * HOUR);
});

test('buildThawUpdate: rejects non-frozen, inactive, or missing items', () => {
  const base = { id: 'x', status: 'active', pumpedAt: NOW, quantity: 4, unit: 'oz', expiresAt: NOW };
  assert.equal(buildThawUpdate({ ...base, location: 'fridge' }, {}, NOW), null);
  assert.equal(buildThawUpdate({ ...base, location: 'thawed' }, {}, NOW), null);
  assert.equal(buildThawUpdate({ ...base, location: 'freezer', status: 'used' }, {}, NOW), null);
  assert.equal(buildThawUpdate(null, {}, NOW), null);
});

test('FROZEN_LOCATIONS: covers both freezer types', () => {
  assert.deepEqual([...FROZEN_LOCATIONS].sort(), ['deepFreezer', 'freezer']);
});

test('summarizeStash: thawed items count into fridge totals', () => {
  const s = summarizeStash([
    { location: 'fridge', quantity: 6, unit: 'oz' },
    { location: 'thawed', quantity: 4, unit: 'oz' },
    { location: 'freezer', quantity: 8, unit: 'oz' },
    { location: 'deepFreezer', quantity: 10, unit: 'oz' },
    { location: 'room', quantity: 2, unit: 'oz' },
  ]);
  assert.deepEqual(s, { totalOz: 30, fridgeOz: 10, freezerOz: 8, deepFreezerOz: 10, totalBags: 5 });
});

test('summarizeStash: mL converts to oz; NaN quantities count 0; empty is zeros', () => {
  const s = summarizeStash([{ location: 'thawed', quantity: 120, unit: 'mL' }, { location: 'fridge', quantity: NaN, unit: 'oz' }]);
  assert.ok(Math.abs(s.fridgeOz - 120 / 29.5735) < 0.05);
  assert.equal(s.totalBags, 2);
  assert.deepEqual(summarizeStash([]), { totalOz: 0, fridgeOz: 0, freezerOz: 0, deepFreezerOz: 0, totalBags: 0 });
});

test('shouldShowThawTile: visible while frozen OR thawed stash exists', () => {
  assert.equal(shouldShowThawTile(0), false);
  assert.equal(shouldShowThawTile(3), true);
  assert.equal(shouldShowThawTile(-2), false);
  assert.equal(shouldShowThawTile(NaN), false);
  assert.equal(shouldShowThawTile(undefined), false);
  assert.equal(shouldShowThawTile(0, 1), true, 'regression: last frozen pouch thawed');
  assert.equal(shouldShowThawTile(0, NaN), false);
});

// --------------------------------------------------------- v2 helpers ---

const pouch = (over = {}) => ({ id: 'inv_a', pumpedAt: NOW - DAY, quantity: 4, unit: 'oz', location: 'fridge', expiresAt: NOW + 3 * DAY, status: 'active', createdAt: NOW - DAY, ...over });

test('constants: locations, statuses, CDC defaults', () => {
  assert.deepEqual([...LOCATIONS], ['room', 'fridge', 'freezer', 'deepFreezer', 'thawed']);
  assert.deepEqual([...STATUSES], ['active', 'used', 'discarded', 'expired']);
  assert.equal(DEFAULT_STORAGE_WINDOWS.thawedBottleHours, 24);
  assert.throws(() => { DEFAULT_STORAGE_WINDOWS.fridgeDays = 99; }, TypeError, 'frozen defaults');
});

test('effectiveStatus / isUsable: active past expiry reads expired before any sweep', () => {
  assert.equal(effectiveStatus(pouch(), NOW), 'active');
  assert.equal(effectiveStatus(pouch({ expiresAt: NOW }), NOW), 'expired');
  assert.equal(effectiveStatus(pouch({ status: 'used', expiresAt: NOW - DAY }), NOW), 'used', 'archived stays archived');
  assert.equal(effectiveStatus(pouch({ status: 'weird' }), NOW), 'active');
  assert.equal(effectiveStatus(null, NOW), 'expired');
  assert.equal(isUsable(pouch(), NOW), true);
  assert.equal(isUsable(pouch({ expiresAt: NOW - 1 }), NOW), false);
});

test('compareFifo: oldest pumped first, stable ties', () => {
  const a = pouch({ id: 'inv_a', pumpedAt: 1, createdAt: 5 });
  const b = pouch({ id: 'inv_b', pumpedAt: 1, createdAt: 5 });
  const c = pouch({ id: 'inv_c', pumpedAt: 0 });
  assert.deepEqual([b, a, c].sort(compareFifo).map(x => x.id), ['inv_c', 'inv_a', 'inv_b']);
});

test('filterInventory: every filter, expired never usable, unknown filter throws', () => {
  const items = [
    pouch({ id: 'f1', location: 'fridge', pumpedAt: NOW - 2 * DAY }),
    pouch({ id: 'f2', location: 'fridge', pumpedAt: NOW - 3 * DAY, expiresAt: NOW - 3 * HOUR }),
    pouch({ id: 'z1', location: 'freezer', pumpedAt: NOW - 30 * DAY, expiresAt: NOW + 100 * DAY }),
    pouch({ id: 'd1', location: 'deepFreezer', pumpedAt: NOW - 40 * DAY, expiresAt: NOW + 200 * DAY }),
    pouch({ id: 't1', location: 'thawed', expiresAt: NOW + 10 * HOUR }),
    pouch({ id: 't2', location: 'thawed', expiresAt: NOW + 2 * HOUR }),
    pouch({ id: 'r1', location: 'room', expiresAt: NOW + HOUR }),
    pouch({ id: 'u1', status: 'used', usedAt: NOW - HOUR }),
    pouch({ id: 'x1', status: 'discarded', discardedAt: NOW - 2 * HOUR }),
    null,
  ];
  const ids = f => filterInventory(items, f, NOW).map(i => i.id);
  assert.deepEqual(ids('all'), ['d1', 'z1', 'f1', 'r1', 't1', 't2'], 'usable, FIFO (ties by id)');
  assert.ok(!ids('all').includes('f2'), 'expired fridge pouch excluded');
  assert.deepEqual(ids('fridge').sort(), ['f1', 't1', 't2']);
  assert.deepEqual(ids('frozen'), ['d1', 'z1'], 'FIFO');
  assert.deepEqual(ids('thawed'), ['t2', 't1'], 'soonest expiry first');
  assert.deepEqual(ids('room'), ['r1']);
  assert.deepEqual(ids('expired'), ['f2']);
  assert.deepEqual(ids('archived'), ['u1', 'x1', 'f2'], 'not usable, most recently archived first');
  assert.equal(ids('everything').length, 9);
  assert.throws(() => filterInventory(items, 'nope', NOW), RangeError);
  assert.deepEqual(filterInventory(null, 'all', NOW), []);
});

test('pickUseNext: thawed first, then fridge/room by expiry, then frozen FIFO', () => {
  const frozen = pouch({ id: 'z', location: 'freezer', pumpedAt: NOW - 50 * DAY, expiresAt: NOW + 100 * DAY });
  const fridge = pouch({ id: 'f', location: 'fridge', expiresAt: NOW + DAY });
  const thawed = pouch({ id: 't', location: 'thawed', expiresAt: NOW + 20 * HOUR });
  const expiredThawed = pouch({ id: 'tx', location: 'thawed', expiresAt: NOW - 1 });
  assert.equal(pickUseNext([frozen, fridge, thawed, expiredThawed], NOW).id, 't');
  assert.equal(pickUseNext([frozen, fridge, expiredThawed], NOW).id, 'f');
  assert.equal(pickUseNext([frozen], NOW).id, 'z');
  assert.equal(pickUseNext([expiredThawed], NOW), null);
  assert.equal(pickUseNext(undefined, NOW), null);
});

test('buildInventoryItem: computes expiry, rounds per unit, rejects NaN/≤0/bad location', () => {
  const item = buildInventoryItem({ pumpedAt: NOW, quantity: '4.04', unit: 'oz', location: 'fridge', notes: 'n' }, DEFAULT_STORAGE_WINDOWS, { now: NOW, id: 'inv_new', deviceId: 'dev_abcdef' });
  assert.deepEqual(item, {
    id: 'inv_new', pumpedAt: NOW, quantity: 4, unit: 'oz', location: 'fridge', expiresAt: NOW + 4 * DAY,
    status: 'active', notes: 'n', createdAt: NOW, updatedAt: NOW, deviceId: 'dev_abcdef',
  });
  assert.equal(buildInventoryItem({ quantity: 120.4, unit: 'ml', location: 'freezer' }, undefined, { now: NOW, id: 'i' }).quantity, 120);
  assert.equal(buildInventoryItem({ quantity: 1, location: 'room' }, undefined, { now: NOW, id: 'i' }).pumpedAt, NOW, 'pumpedAt defaults to now');
  for (const q of [NaN, null, 0, -1, 'abc', Infinity, true]) {
    assert.throws(() => buildInventoryItem({ quantity: q, location: 'fridge' }, undefined, { now: NOW, id: 'i' }), RangeError, String(q));
  }
  assert.throws(() => buildInventoryItem({ quantity: 1, location: 'thawed' }, undefined, { now: NOW, id: 'i' }), RangeError, 'thawed only via thaw()');
  assert.equal(buildInventoryItem({ quantity: 1, location: 'fridge', notes: 'x'.repeat(5000) }, undefined, { now: NOW, id: 'i' }).notes.length, 2000);
});

test('applyInventoryPatch: re-expires on move, never moves thawed milk, validates', () => {
  const p = pouch({ location: 'fridge', pumpedAt: NOW - DAY });
  const moved = applyInventoryPatch(p, { location: 'freezer' }, DEFAULT_STORAGE_WINDOWS, NOW);
  const six = new Date(NOW - DAY); six.setMonth(six.getMonth() + 6);
  assert.equal(moved.expiresAt, six.getTime());
  assert.equal(moved.updatedAt, NOW);
  assert.equal(p.location, 'fridge', 'input not mutated');
  assert.equal(applyInventoryPatch(p, { pumpedAt: NOW }, DEFAULT_STORAGE_WINDOWS, NOW).expiresAt, NOW + 4 * DAY);
  assert.equal(applyInventoryPatch(p, { location: 'freezer', expiresAt: NOW + 5 }, DEFAULT_STORAGE_WINDOWS, NOW).expiresAt, NOW + 5, 'explicit expiry wins');
  assert.equal(applyInventoryPatch(p, { quantity: 120, unit: 'mL' }, DEFAULT_STORAGE_WINDOWS, NOW).quantity, 120);
  const thawed = pouch({ location: 'thawed', expiresAt: NOW + 10 * HOUR });
  assert.throws(() => applyInventoryPatch(thawed, { location: 'freezer' }, DEFAULT_STORAGE_WINDOWS, NOW), RangeError);
  assert.equal(applyInventoryPatch(thawed, { pumpedAt: NOW - 2 * DAY }, DEFAULT_STORAGE_WINDOWS, NOW).expiresAt, NOW + 10 * HOUR, 'thawed clock not restarted');
  assert.throws(() => applyInventoryPatch(p, { quantity: 0 }), RangeError);
  assert.throws(() => applyInventoryPatch(p, { quantity: 'NaN' }), RangeError);
  assert.throws(() => applyInventoryPatch(p, { pumpedAt: 'yesterday' }), RangeError);
  assert.throws(() => applyInventoryPatch(p, { location: 'attic' }), RangeError);
  assert.throws(() => applyInventoryPatch(p, { expiresAt: null }), RangeError);
});

test('consumeUpdate: partial use leaves remainder in the pouch unit; whole use → used', () => {
  const p = pouch({ quantity: 120, unit: 'mL' });
  assert.equal(consumeUpdate(p, 1, 'oz', NOW).quantity, 90);
  const used = consumeUpdate(p, 4, 'oz', NOW);
  assert.equal(used.status, 'used', '4 oz (118.3 mL) of a 120 mL pouch is within the 0.1 oz tolerance');
  assert.equal(consumeUpdate(p, 3.9, 'oz', NOW).quantity, 5, '3.9 oz leaves a real 5 mL remainder');
  assert.equal(used.usedAt, NOW);
  assert.equal(consumeUpdate(p, 200, 'mL', NOW).status, 'used', 'over-pouring clamps to used');
  assert.equal(consumeUpdate(p, 0, 'oz', NOW), null);
  assert.equal(consumeUpdate(p, NaN, 'oz', NOW), null);
  assert.equal(consumeUpdate(pouch({ expiresAt: NOW - 1 }), 1, 'oz', NOW), null, 'expired pouch untouched');
  assert.equal(consumeUpdate(null, 1, 'oz', NOW), null);
});

test('inventoryUpdatedAt: explicit updatedAt, else newest lifecycle stamp (v1 pouches)', () => {
  assert.equal(inventoryUpdatedAt({ updatedAt: 5, createdAt: 9 }), 5);
  assert.equal(inventoryUpdatedAt({ createdAt: 1, thawedAt: 7, pumpedAt: 0 }), 7);
  assert.equal(inventoryUpdatedAt({}), 0);
  assert.equal(inventoryUpdatedAt(null), 0);
});

// ---------------------------------------------------- regressions (R1) ---

test('regression: correcting an expired pouch (wrong place logged) brings it back when its new expiry is ahead', () => {
  // Logged at room temp 5h ago → the sweep marked it expired; it was really in the freezer.
  const swept = pouch({ location: 'room', pumpedAt: NOW - 5 * HOUR, expiresAt: NOW - HOUR, status: 'expired' });
  const fixed = applyInventoryPatch(swept, { location: 'freezer' }, DEFAULT_STORAGE_WINDOWS, NOW);
  assert.ok(fixed.expiresAt > NOW);
  assert.equal(fixed.status, 'active');
  assert.equal(effectiveStatus(fixed, NOW), 'active');
  assert.equal(buildThawUpdate(fixed, DEFAULT_STORAGE_WINDOWS, NOW).location, THAWED_LOCATION, 'and can be thawed');
  assert.equal(pickUseNext([fixed], NOW).id, fixed.id);
  // Still past its expiry after the edit → stays expired; used/discarded never revive.
  assert.equal(applyInventoryPatch(swept, { notes: 'oops' }, DEFAULT_STORAGE_WINDOWS, NOW).status, 'expired');
  assert.equal(applyInventoryPatch(swept, { expiresAt: NOW - 1 }, DEFAULT_STORAGE_WINDOWS, NOW).status, 'expired');
  assert.equal(applyInventoryPatch(pouch({ status: 'used', expiresAt: NOW + DAY }), { notes: 'x' }, DEFAULT_STORAGE_WINDOWS, NOW).status, 'used');
  assert.equal(applyInventoryPatch(pouch({ status: 'discarded', expiresAt: NOW + DAY }), { location: 'freezer' }, DEFAULT_STORAGE_WINDOWS, NOW).status, 'discarded');
});

test('maxExpiresAt: the longest window any setting allows, per location', () => {
  const p = NOW - 30 * DAY;
  assert.equal(maxExpiresAt({ pumpedAt: p, location: 'room' }), p + 24 * HOUR);
  assert.equal(maxExpiresAt({ pumpedAt: p, location: 'fridge' }), p + 14 * DAY);
  const two = new Date(p); two.setMonth(two.getMonth() + 24);
  assert.equal(maxExpiresAt({ pumpedAt: p, location: 'freezer' }), two.getTime());
  assert.equal(maxExpiresAt({ pumpedAt: p, location: 'deepFreezer' }), two.getTime());
  assert.equal(maxExpiresAt({ pumpedAt: p, location: 'thawed', thawedAt: NOW }), NOW + 72 * HOUR);
  assert.equal(maxExpiresAt({ pumpedAt: p, location: 'thawed' }), two.getTime() + 72 * HOUR, 'no thawedAt: latest possible thaw + window');
  // Every pouch the app itself can build stays within the bound, even at the max settings.
  for (const location of ['room', 'fridge', 'freezer', 'deepFreezer']) {
    const item = buildInventoryItem({ quantity: 1, location, pumpedAt: p }, MAX_STORAGE_WINDOWS, { now: NOW, id: 'i' });
    assert.ok(item.expiresAt <= maxExpiresAt(item), location);
  }
  const thawed = buildThawUpdate({ ...pouch({ location: 'freezer' }) }, MAX_STORAGE_WINDOWS, NOW);
  assert.ok(thawed.expiresAt <= maxExpiresAt(thawed));
});
