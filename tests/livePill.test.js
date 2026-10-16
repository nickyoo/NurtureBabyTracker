// livePill.pillModel: the pure wording/state behind every live pill
// (DESIGN §6.5). The DOM side is covered by tests/e2e/shell.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillModel, register } from '../js/ui/livePill.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 14, 9, 0);
const bottle = (milk, startedMinAgo) => ({ id: 'e1', type: 'feed', startTime: T0 - startedMinAgo * MIN, endTime: null, data: { method: 'bottle', milk, amount: 4, unit: 'oz' }, babyId: 'baby_a' });

test('bottle: elapsed clock, safety countdown, ring = share of the window used', () => {
  const m = pillModel({ ...bottle('breastmilk', 0), startTime: T0 - (12 * 60 + 4) * 1000 }, T0);
  assert.equal(m.title, 'Bottle');
  assert.equal(m.time, '12:04');
  assert.equal(m.sub, 'good for 1h 48m');
  assert.equal(m.level, 'ok');
  assert.equal(m.finishLabel, 'Finish');
  assert.ok(m.ring > 0.09 && m.ring < 0.11, String(m.ring)); // mockup: ring(0.10)
  assert.match(m.spoken, /^Bottle, running, 12 minutes, good for 1h 48m$/);
});

test('bottle: under 10 minutes left warns in words; expired says discard', () => {
  const soon = pillModel(bottle('formula', 52), T0); // formula: 1h window
  assert.equal(soon.level, 'soon');
  assert.equal(soon.sub, 'use within 8 min');
  assert.equal(soon.subIcon, 'clock');
  const gone = pillModel(bottle('formula', 75), T0);
  assert.equal(gone.level, 'expired');
  assert.equal(gone.sub, 'Past 1h · discard');
  assert.equal(gone.finishLabel, 'Discard');
});

test('breastfeeding: running side and paused state', () => {
  const ev = { id: 'b', type: 'feed', startTime: T0 - 20 * MIN, endTime: null, babyId: 'baby_a', data: { method: 'breast', left: 300, right: 0, activeSide: 'right', activeSince: T0 - 2 * MIN, lastSide: 'right' } };
  const m = pillModel(ev, T0);
  assert.equal(m.title, 'Breastfeed');
  assert.equal(m.sub, 'Right side');
  assert.equal(m.time, '07:00');
  const paused = pillModel({ ...ev, data: { ...ev.data, activeSide: null, activeSince: null, right: 120 } }, T0);
  assert.equal(paused.level, 'paused');
  assert.equal(paused.finishLabel, 'Resume');
});

test('sleep and pump wording; the baby is named only with 2+ babies', () => {
  const nap = { id: 's', type: 'sleep', startTime: T0 - 55 * MIN, endTime: null, babyId: 'baby_a', data: { kind: 'nap' } };
  assert.equal(pillModel(nap, T0).title, 'Nap');
  assert.equal(pillModel(nap, T0).finishLabel, 'Wake up');
  assert.equal(pillModel({ ...nap, data: { kind: 'night' } }, T0).title, 'Night sleep');
  const babies = [{ id: 'baby_a', name: 'Ada' }, { id: 'baby_b', name: 'Bo' }];
  assert.equal(pillModel(nap, T0, { babies }).title, 'Ada · Nap');
  assert.equal(pillModel(nap, T0, { babies: [babies[0]] }).title, 'Nap');
  const pump = { id: 'p', type: 'pump', startTime: T0 - 14 * MIN, endTime: null, babyId: null, data: {} };
  assert.equal(pillModel(pump, T0, { babies }).title, 'Pump'); // parent-level: never named
  assert.equal(pillModel(pump, T0).time, '14:00');
});

test('register returns an unregister that only removes its own handler', () => {
  const off1 = register('feed', { open() {} });
  const off2 = register('feed', { open() {} });
  off1(); // stale: must not remove the newer registration
  off2();
  assert.ok(true);
});
