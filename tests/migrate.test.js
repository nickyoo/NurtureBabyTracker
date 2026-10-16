// core/migrate.js — pure v1 → v2 transforms (§3). runMigration() itself
// (IndexedDB upgrade + exactly-once) is exercised against a real seeded v1
// database in tests/e2e/core.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionToEvent, mapV1Settings, liveTimersToEvents, planDefaultBaby, isAutoNote, migratedEventId, v1BabyName,
  MISSING_AMOUNT_NOTE, LIVE_TIMER_KEYS,
} from '../js/core/migrate.js';
import { DEFAULT_STORAGE_WINDOWS } from '../js/domain/inventory.js';

const MIN = 60 * 1000;
const NOW = new Date('2026-10-15T12:00:00').getTime();
const T1 = NOW - 2 * 24 * 60 * MIN;
const DEV = 'dev_abcdef123456';
const BABY = 'baby_clara1';
const ctx = { deviceId: DEV, now: NOW, babyId: BABY };

test('pump session → pump event: direct mapping, parent-level, unit kept', () => {
  const s = { id: 'pump_aaa', type: 'pump', startTime: T1, endTime: T1 + 20 * MIN, durationSec: 1200, outputQty: 4.5, unit: 'oz', notes: 'morning', createdAt: T1 + 20 * MIN };
  const e = sessionToEvent(s, ctx);
  assert.deepEqual(e, {
    id: 'evt_pump_aaa', type: 'pump', startTime: T1, endTime: T1 + 20 * MIN, note: 'morning',
    data: { amount: 4.5, unit: 'oz', storedTo: null },
    createdAt: T1 + 20 * MIN, updatedAt: T1 + 20 * MIN, babyId: null, deviceId: DEV, migratedFrom: 'pump_aaa',
  });
  const ml = sessionToEvent({ ...s, id: 'pump_ml', outputQty: 130, unit: 'mL' }, ctx);
  assert.deepEqual(ml.data, { amount: 130, unit: 'mL', storedTo: null });
  const noEnd = sessionToEvent({ ...s, endTime: undefined }, ctx);
  assert.equal(noEnd.endTime, T1 + 1200 * 1000, 'missing endTime → start + duration');
  const backwards = sessionToEvent({ ...s, endTime: T1 - MIN, durationSec: 0 }, ctx);
  assert.equal(backwards.endTime, T1, 'end before start → start');
  assert.equal(sessionToEvent({ ...s, unit: undefined }, ctx).data.unit, 'oz', 'no unit → oz (v1 canonical)');
});

test('the v1.6 NaN bug: NaN / null / garbage amounts → null + note, user note kept', () => {
  const s = { id: 'pump_nan', type: 'pump', startTime: T1, endTime: T1 + MIN, outputQty: NaN, unit: 'mL', notes: '' };
  const e = sessionToEvent(s, ctx);
  assert.equal(e.data.amount, null);
  assert.equal(e.data.unit, 'mL');
  assert.equal(e.note, MISSING_AMOUNT_NOTE);
  assert.equal(sessionToEvent({ ...s, outputQty: null }, ctx).data.amount, null, 'JSON turns NaN into null');
  assert.equal(sessionToEvent({ ...s, outputQty: undefined }, ctx).data.amount, null);
  assert.equal(sessionToEvent({ ...s, outputQty: 'lots' }, ctx).data.amount, null);
  assert.equal(sessionToEvent({ ...s, outputQty: -2 }, ctx).data.amount, null);
  assert.equal(sessionToEvent({ ...s, outputQty: '3.5' }, ctx).data.amount, 3.5, 'numeric strings coerced');
  assert.equal(sessionToEvent({ ...s, outputQty: 0 }, ctx).data.amount, 0, 'zero is a real amount');
  assert.equal(sessionToEvent({ ...s, outputQty: 0 }, ctx).note, '');
  const withNote = sessionToEvent({ ...s, outputQty: null, notes: 'left side only' }, ctx);
  assert.equal(withNote.note, `left side only — ${MISSING_AMOUNT_NOTE}`);
});

test('feed session → bottle feed: milk type, unit, timing = logged at the END', () => {
  const T2 = NOW - 24 * 60 * MIN;
  const s = { id: 'sess_bbb', type: 'feed', feedType: 'breastmilk', startTime: T2, endTime: T2, durationSec: 900, outputQty: 120, unit: 'mL', notes: 'Bottle feed (120 mL prepared)', createdAt: T2 };
  const e = sessionToEvent(s, ctx);
  assert.equal(e.type, 'feed');
  assert.deepEqual(e.data, { method: 'bottle', milk: 'breastmilk', amount: 120, unit: 'mL', prepared: 120 });
  assert.deepEqual([e.startTime, e.endTime], [T2 - 900 * 1000, T2], 'v1 stamped feeds when logged, so the feed ENDS at the stamp');
  assert.equal(e.note, '', 'auto note dropped');
  assert.equal(e.babyId, BABY, 'feeds belong to the default baby');
  const f = sessionToEvent({ id: 'sess_c', type: 'feed', feedType: 'formula', startTime: T2, durationSec: 0, outputQty: 4, unit: 'oz', notes: 'Formula Feeding' }, ctx);
  assert.deepEqual([f.data.milk, f.data.amount, f.data.unit, f.startTime, f.endTime, f.note], ['formula', 4, 'oz', T2, T2, '']);
  assert.equal(sessionToEvent({ ...s, feedType: undefined }, ctx).data.milk, 'breastmilk', 'unknown → breast milk (v1 default)');
  const prepOz = sessionToEvent({ ...s, unit: 'mL', notes: 'Bottle feed (4 oz prepared)' }, ctx);
  assert.equal(prepOz.data.prepared, 118, 'prepared converted into the feed\'s unit');
  assert.equal(sessionToEvent({ ...s, notes: 'Bottle feed (lots prepared)' }, ctx).data.prepared, undefined);
});

test('auto notes dropped, real notes kept verbatim (incl. hostile text)', () => {
  for (const n of ['Formula Feeding', 'Breast Milk Feeding', 'Formula Bottle Feed', 'Breast Milk Bottle Feed', 'Pumped session (20:00)', 'Bottle feed (4 oz prepared)', '  formula feeding ']) {
    assert.ok(isAutoNote(n), n);
  }
  for (const n of ['Formula feeding went well', 'pumped', '', null, 42]) assert.ok(!isAutoNote(n), String(n));
  const xss = '<img src=x onerror=alert(1)>';
  assert.equal(sessionToEvent({ id: 's1', type: 'feed', startTime: NOW, outputQty: 3, notes: xss }, ctx).note, xss);
  assert.equal(sessionToEvent({ id: 's2', type: 'feed', startTime: NOW, outputQty: 3, notes: 'x'.repeat(5000) }, ctx).note.length, 2000);
});

test('unmigratable sessions → null (never a broken event)', () => {
  assert.equal(sessionToEvent(null, ctx), null);
  assert.equal(sessionToEvent('sess', ctx), null);
  assert.equal(sessionToEvent({ id: 'bot_1', type: 'bottle', startTime: NOW }, ctx), null);
  assert.equal(sessionToEvent({ id: 's', type: 'pump', startTime: 'yesterday' }, ctx), null);
  assert.equal(sessionToEvent({ id: 's', type: 'pump' }, ctx), null);
  assert.equal(sessionToEvent({ id: 's', type: 'pump', startTime: 12 }, ctx), null, '1970 timestamp');
});

test('migratedEventId: deterministic, so re-running can only skip', () => {
  assert.equal(migratedEventId({ id: 'sess_abc' }), 'evt_sess_abc');
  assert.equal(migratedEventId({ id: 'sess_abc' }), migratedEventId({ id: 'sess_abc' }));
  assert.equal(migratedEventId({ type: 'pump', startTime: 1700000000123.4 }), 'evt_v1_pump_1700000000123', 'no id → derived from type + time');
  assert.equal(migratedEventId({ id: '<script>', type: 'feed', startTime: 5 }), 'evt_v1_feed_5', 'hostile id never becomes a key');
  assert.equal(migratedEventId({ id: 'x'.repeat(95), type: 'feed' }), 'evt_v1_feed_x', 'too long');
  const e = sessionToEvent({ type: 'feed', startTime: NOW, outputQty: 2 }, ctx);
  assert.equal(e.id, `evt_v1_feed_${NOW}`);
  assert.ok(!('migratedFrom' in e), 'nothing to point back to');
});

test('mapV1Settings: real keys mapped, junk keys ignored (records or map)', () => {
  const v1 = [
    { key: 'dailyGoalOz', value: 26 }, { key: 'pumpIntervalMinutes', value: 120 }, { key: 'units', value: 'mL' },
    { key: 'themeMode', value: 'dark' }, { key: 'soundEnabled', value: false },
    { key: 'storageWindows', value: { fridgeDays: 3, freezerMonths: 6, deepFreezerMonths: 12, roomTempHours: 4 } },
    { key: 'parentName', value: 'Nick' }, { key: 'babyName', value: 'Clara' }, { key: 'onboarding_completed', value: true },
    { key: 'dailyPumpingGoal', value: 30 }, { key: 'reminderIntervalHours', value: 2 }, { key: 'preferredUnit', value: 'oz' },
  ];
  const out = mapV1Settings(v1);
  assert.deepEqual(out, {
    pumpGoalOz: 26, pumpIntervalMinutes: 120, units: 'mL', theme: 'dark', sound: 'off',
    storageWindows: { ...DEFAULT_STORAGE_WINDOWS, fridgeDays: 3 }, parentName: 'Nick', onboarded: true,
  });
  const asMap = mapV1Settings(Object.fromEntries(v1.map(r => [r.key, r.value])));
  assert.deepEqual(asMap, out, 'accepts a { key: value } map too');
});

test('mapV1Settings: sound default becomes night-off; invalid values dropped; babies with babyId', () => {
  assert.equal(mapV1Settings({ soundEnabled: true }).sound, 'night-off', 'v1 default-on → calmer v2 default');
  assert.deepEqual(mapV1Settings({ units: 'cups', themeMode: 'neon', dailyGoalOz: 'NaN', pumpIntervalMinutes: 5 }), {}, 'nothing invalid comes through');
  assert.deepEqual(mapV1Settings({}), {});
  assert.deepEqual(mapV1Settings(null), {});
  assert.equal(mapV1Settings({ onboarding_completed: 'yes' }).onboarded, false, 'only literal true counts');
  const withBaby = mapV1Settings({ babyName: ' Clara ' }, { babyId: BABY, now: NOW });
  assert.deepEqual(withBaby.babies, [{ id: BABY, name: 'Clara', birthDate: null, photoId: null, createdAt: NOW }]);
  assert.equal(withBaby.activeBabyId, BABY);
  assert.ok(!('babies' in mapV1Settings({ babyName: 'Clara' })), 'without babyId the caller handles babies');
  const proto = mapV1Settings(JSON.parse('[{"key":"__proto__","value":{"units":"mL"}},{"key":"units","value":"oz"}]'));
  assert.deepEqual(proto, { units: 'oz' });
  assert.equal(({}).units, undefined, 'no prototype pollution');
});

test('v1BabyName: trimmed, capped, "Baby" placeholder is not a name', () => {
  assert.equal(v1BabyName([{ key: 'babyName', value: '  Clara ' }]), 'Clara');
  assert.equal(v1BabyName({ babyName: 'Baby' }), '');
  assert.equal(v1BabyName({ babyName: 'baby' }), '');
  assert.equal(v1BabyName({ babyName: 42 }), '');
  assert.equal(v1BabyName({}), '');
  assert.equal(v1BabyName({ babyName: 'n'.repeat(500) }).length, 100);
});

test('planDefaultBaby: names the unnamed default instead of adding a second baby', () => {
  const unnamed = [{ id: 'baby_auto1', name: '', birthDate: null, photoId: null, createdAt: NOW }];
  const p = planDefaultBaby(unnamed, 'baby_auto1', 'Clara', NOW);
  assert.deepEqual(p.babies.map(b => [b.id, b.name]), [['baby_auto1', 'Clara']]);
  assert.equal(p.babyId, 'baby_auto1');
  assert.equal(p.changed, true);

  const named = [{ id: 'baby_x', name: 'Ivy', birthDate: null, photoId: null, createdAt: NOW }];
  const keep = planDefaultBaby(named, 'baby_x', 'Clara', NOW);
  assert.deepEqual([keep.babies[0].name, keep.changed], ['Ivy', false], 'never renames a named baby');

  const twins = [{ id: 'baby_a', name: '' }, { id: 'baby_b', name: '' }];
  const t = planDefaultBaby(twins, 'baby_b', 'Clara', NOW);
  assert.deepEqual([t.changed, t.babyId], [false, 'baby_b'], 'ambiguous with two babies: leave names alone, use the active one');
  assert.equal(planDefaultBaby(twins, 'baby_ghost', '', NOW).babyId, 'baby_a', 'stale active id → first baby');

  const fresh = planDefaultBaby(undefined, undefined, 'Clara', NOW);
  assert.equal(fresh.babies.length, 1);
  assert.match(fresh.babies[0].id, /^baby_/);
  assert.deepEqual([fresh.babies[0].name, fresh.babyId, fresh.changed], ['Clara', fresh.babies[0].id, true]);
  assert.equal(planDefaultBaby('garbage', null, '', NOW).babies.length, 1);
});

test('liveTimersToEvents: v1 localStorage timers → RUNNING events', () => {
  assert.equal(LIVE_TIMER_KEYS.pump, 'nurture_active_pump_timer');
  assert.equal(LIVE_TIMER_KEYS.bottle, 'nurture_bottle_timer');
  const pump = JSON.stringify({ active: true, type: 'pump', startedAt: NOW - 10 * MIN, pumpOutputOz: 3.5, pumpOutputMl: 100, storeDestination: 'freezer' });
  const bottle = JSON.stringify({ startTs: NOW - 5 * MIN, feedType: 'breastmilk', preparedOz: 4, sourceInventoryId: 'inv_thawed-1' });
  const [p, b] = liveTimersToEvents({ pump, bottle }, { deviceId: DEV, now: NOW, unit: 'mL', babyId: BABY });
  assert.deepEqual([p.type, p.startTime, p.endTime, p.babyId], ['pump', NOW - 10 * MIN, null, null]);
  assert.deepEqual(p.data, { amount: null, unit: 'mL', storedTo: 'freezer' }, 'amount is entered on stop');
  assert.equal(p.id, `evt_live_pump_${NOW - 10 * MIN}`, 'deterministic id');
  assert.deepEqual([b.type, b.startTime, b.endTime, b.babyId], ['feed', NOW - 5 * MIN, null, BABY]);
  assert.deepEqual(b.data, { method: 'bottle', milk: 'breastmilk', amount: null, unit: 'mL', prepared: 118, sourceInventoryId: 'inv_thawed-1' }, 'canonical-oz prepared → user unit');
  assert.equal(b.deviceId, DEV);
});

test('liveTimersToEvents: inactive, corrupt, hostile or future timers', () => {
  const none = (raw, c = {}) => assert.deepEqual(liveTimersToEvents(raw, { now: NOW, ...c }), []);
  none({});
  none({ pump: null, bottle: null });
  none({ pump: '{not json', bottle: 'undefined' });
  none({ pump: JSON.stringify({ active: false, startedAt: NOW }) });
  none({ pump: JSON.stringify({ active: true }) });
  none({ bottle: JSON.stringify({ startTs: NOW }) }, {}, 'bottle without feedType (v1 restore ignores it too)');
  none({ bottle: JSON.stringify({ startTs: 'soon', feedType: 'formula' }) });
  none({ pump: JSON.stringify({ active: true, startedAt: 5 }) }, {}, '1970');
  const [future] = liveTimersToEvents({ pump: JSON.stringify({ active: true, startedAt: NOW + 60 * MIN, storeDestination: 'none' }) }, { now: NOW });
  assert.equal(future.startTime, NOW, 'a start in the future (clock skew) is clamped to now');
  assert.equal(future.data.storedTo, null, '"none" → null');
  const [hostile] = liveTimersToEvents({ bottle: JSON.stringify({ startTs: NOW, feedType: 'formula', sourceInventoryId: '<img src=x>', preparedOz: 'NaN' }) }, { now: NOW, babyId: BABY });
  assert.ok(!('sourceInventoryId' in hostile.data) && !('prepared' in hostile.data));
  assert.equal(hostile.data.milk, 'formula');
  assert.equal(hostile.data.unit, 'oz', 'unit defaults to oz');
});
