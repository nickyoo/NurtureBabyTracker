import test from 'node:test';
import assert from 'node:assert/strict';
import { reportSummary, forBaby } from '../../../../js/domain/trends.js';
import { sleepState, awakeSince } from '../../../../js/domain/sleep.js';
import { applyEventPatch } from '../../../../js/core/store.js';
import { buildInventoryItem } from '../../../../js/domain/inventory.js';
import { sanitizeInventoryItem } from '../../../../js/core/stash.js';
import { dayKey } from '../../../../js/core/time.js';
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

test('reportSummary (default: today excluded) must not flag yesterday as isToday', () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  const r = reportSummary([], { days: 7, now });
  const flagged = r.days.filter(d => d.isToday).map(d => d.dayKey);
  assert.deepEqual(flagged, [], `rows flagged isToday: ${flagged} (today is ${dayKey(now)})`);
});

test('sleepState({babyId}) sees the same null-baby sleep that forBaby/events.query show', () => {
  const now = Date.UTC(2026, 5, 1, 12);
  const evs = [{ id: 'e1', type: 'sleep', startTime: now - 2 * HOUR, endTime: now - HOUR, babyId: null, data: { kind: 'nap' } }];
  assert.equal(forBaby(evs, 'baby_a').length, 1);
  assert.equal(sleepState(evs, now, { babyId: 'baby_a' }).state, 'awake');
  assert.equal(awakeSince(evs, now, { babyId: 'baby_a' }), now - HOUR);
});

test('editing a null-baby event with its unchanged babyId (null) should succeed', () => {
  const ev = { id: 'evt_1', type: 'diaper', startTime: Date.now() - HOUR, endTime: Date.now() - HOUR, note: '', data: { kind: 'wet' }, createdAt: Date.now() - HOUR, updatedAt: Date.now() - HOUR, babyId: null };
  assert.doesNotThrow(() => applyEventPatch(ev, { note: 'x' }));
  assert.doesNotThrow(() => applyEventPatch(ev, { note: 'x', babyId: ev.babyId }));
});

test('a pouch the app creates must pass the pouch sanitizer used by Undo/import', () => {
  const now = Date.now();
  const item = buildInventoryItem({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: now + 3 * DAY }, undefined, { now, id: 'inv_x' });
  assert.notEqual(sanitizeInventoryItem(item, { now }), null);
});
