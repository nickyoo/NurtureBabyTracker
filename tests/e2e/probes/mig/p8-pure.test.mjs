import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionToEvent } from '../../../../js/core/migrate.js';
const NOW = Date.UTC(2026, 9, 16, 12);
const BABY = 'baby_x';
test('junk durationSec must not drop an otherwise valid v1 feed', () => {
  const s = { id: 'sess_d', type: 'feed', feedType: 'formula', startTime: NOW - 3600e3, endTime: NOW - 3600e3, durationSec: 1e12, outputQty: 4, unit: 'oz', notes: 'night feed', createdAt: NOW - 3600e3 };
  assert.notEqual(sessionToEvent(s, { now: NOW, babyId: BABY }), null, 'feed with valid time + amount was dropped');
});
test('two v1 feeds at the same ms with non-string ids both survive', () => {
  const mk = (id, qty) => ({ id, type: 'feed', feedType: 'formula', startTime: NOW - 3600e3, endTime: NOW - 3600e3, durationSec: 0, outputQty: qty, unit: 'oz', createdAt: NOW - 3600e3 });
  const a = sessionToEvent(mk(1, 4), { now: NOW, babyId: BABY });
  const b = sessionToEvent(mk(2, 2), { now: NOW, babyId: BABY });
  assert.notEqual(a.id, b.id, `both map to ${a.id}; runMigration keeps the first and silently skips the second`);
});
