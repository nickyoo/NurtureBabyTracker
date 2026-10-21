import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionToEvent } from '../../../../js/core/migrate.js';
import { applyInventoryPatch } from '../../../../js/domain/inventory.js';
const NOW = Date.UTC(2026, 9, 16, 12);
test('v1 feed edited to a later day survives migration', () => {
  const s = { id: 'sess_wrongday', type: 'feed', feedType: 'breastmilk', startTime: NOW + 3 * 864e5, endTime: NOW - 5 * 36e5, durationSec: 0, outputQty: 5, unit: 'oz', notes: 'first bottle from daddy', createdAt: NOW - 5 * 36e5 };
  assert.notEqual(sessionToEvent(s, { now: NOW, babyId: 'baby_x' }), null);
});
test('editing only a pouch note keeps its quantity', () => {
  const p = { id: 'inv_q', pumpedAt: NOW - 864e5, quantity: 3.75, unit: 'oz', location: 'fridge', expiresAt: NOW + 3 * 864e5, status: 'active', notes: '' };
  assert.equal(applyInventoryPatch(p, { notes: 'top shelf' }, undefined, NOW).quantity, 3.75);
  assert.equal(applyInventoryPatch({ ...p, quantity: '4' }, { notes: 'x' }, undefined, NOW).quantity, 4);
});
