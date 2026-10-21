// Round-1 import-security probes (expected to FAIL against the current code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../../../../js/core/backup.js';
const H = 3600e3, D = 24 * H;
const NOW = new Date('2026-10-15T12:00:00').getTime();
const B = 'baby_clara1';
const file = over => ({ app: 'nurture', schema: 2, settings: { babies: [{ id: B, name: 'Clara' }] }, ...over });

test('imported fridge pouch cannot claim an expiry beyond the longest allowed fridge window (14 d)', () => {
  const v = validateBackup(file({ inventory: [{ id: 'inv_evil', pumpedAt: NOW - 30 * D, quantity: 5, unit: 'oz', location: 'fridge', expiresAt: Date.UTC(2099, 0, 1), status: 'active' }] }), { now: NOW });
  const p = v.data.inventory[0];
  assert.ok(!p || p.status !== 'active' || p.expiresAt <= p.pumpedAt + 14 * D, `30-day-old fridge milk imported as active, expires ${new Date(p.expiresAt).toISOString()}`);
});

test('imported events/updatedAt far in the future are rejected or clamped', () => {
  const v = validateBackup(file({ events: [{ id: 'evt_f', type: 'sleep', startTime: Date.UTC(2090, 0, 1), endTime: null, babyId: B, updatedAt: Date.UTC(2099, 0, 1) }] }), { now: NOW });
  const e = v.data.events[0];
  assert.ok(!e || (e.startTime <= NOW + D && e.updatedAt <= NOW + D), `accepted startTime ${e && new Date(e.startTime).toISOString()} updatedAt ${e && new Date(e.updatedAt).toISOString()}`);
});

test('instant-only types (diaper, milestone) are never imported as running', () => {
  const v = validateBackup(file({ events: [
    { id: 'evt_d', type: 'diaper', startTime: NOW - H, endTime: null, babyId: B, data: { kind: 'wet' } },
    { id: 'evt_m', type: 'milestone', startTime: NOW - H, endTime: null, babyId: B, data: { title: 'x' } },
  ] }), { now: NOW });
  for (const e of v.data.events) assert.notEqual(e.endTime, null, `${e.type} imported as running`);
});

test('a malformed or fully-rejected photos field is "no photos" (null), so replace keeps the journal', () => {
  assert.equal(validateBackup(file({ photos: 5 }), { now: NOW }).data.photos, null, 'photos: 5');
  assert.equal(validateBackup(file({ photos: [{ id: 'pho_x', data: '!!', width: 1, height: 1 }] }), { now: NOW }).data.photos, null, 'all photos rejected');
});
