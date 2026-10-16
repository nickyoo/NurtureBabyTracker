// core/store.js — the PURE half: event schema (sanitizeEvent /
// sanitizeEventData), edits (applyEventPatch), baby filtering and ordering.
// The IndexedDB half (add/update/start/stop/…) runs in real Chromium:
// tests/e2e/core.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEvent, sanitizeEventData, applyEventPatch, matchesBaby, compareNewestFirst,
  EVENT_TYPES, BABY_TYPES, PARENT_TYPES, LIMITS, RunningActivityError, NotFoundError,
} from '../js/core/store.js';

const NOW = new Date('2026-10-15T12:00:00').getTime();
const BABY = 'baby_11111111-2222-3333-4444-555555555555';
const DEV = 'dev_abcdef123456';
const base = (over = {}) => ({ id: 'evt_1', type: 'diaper', startTime: NOW - 1000, data: { kind: 'wet' }, babyId: BABY, ...over });

test('types: five event types; pump is the only parent-level one', () => {
  assert.deepEqual([...EVENT_TYPES], ['feed', 'pump', 'sleep', 'diaper', 'milestone']);
  assert.deepEqual([...BABY_TYPES], ['feed', 'sleep', 'diaper', 'milestone']);
  assert.deepEqual([...PARENT_TYPES], ['pump']);
  assert.ok(Object.isFrozen(EVENT_TYPES));
});

test('sanitizeEvent: output has exactly the §3 keys', () => {
  const r = sanitizeEvent({ ...base(), createdAt: NOW - 500, updatedAt: NOW - 400, deviceId: DEV, migratedFrom: 'sess_1', extra: 1, html: '<b>' }, { now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), ['babyId', 'createdAt', 'data', 'deviceId', 'endTime', 'id', 'migratedFrom', 'note', 'startTime', 'type', 'updatedAt'].sort());
  assert.equal(r.value.endTime, r.value.startTime, 'missing endTime = an instant');
  assert.equal(r.value.note, '');
  assert.equal(r.value.updatedAt, NOW - 400);
});

test('sanitizeEvent: rejects unknown types, bad ids, implausible times', () => {
  for (const [raw, why] of [
    [null, 'null'], [[], 'array'], ['evt', 'string'],
    [base({ type: 'breastfeed' }), 'unknown type'], [base({ type: '__proto__' }), 'proto type'],
    [base({ id: '<img src=x onerror=alert(1)>' }), 'hostile id'], [base({ id: '' }), 'empty id'], [base({ id: 'x'.repeat(101) }), 'long id'], [base({ id: 42 }), 'numeric id'],
    [base({ startTime: 'yesterday' }), 'string time'], [base({ startTime: NaN }), 'NaN time'], [base({ startTime: 5 }), '1970'], [base({ startTime: Date.UTC(2200, 0, 1) }), 'year 2200'],
    [base({ endTime: 'later' }), 'bad endTime'],
  ]) assert.equal(sanitizeEvent(raw, { now: NOW }).ok, false, why);
  assert.equal(sanitizeEvent(base({ startTime: String(NOW) }), { now: NOW }).value.startTime, NOW, 'numeric strings coerced');
});

test('sanitizeEvent: endTime < startTime rejected when strict, clamped otherwise; null = running', () => {
  const bad = base({ endTime: NOW - 5000 });
  assert.equal(sanitizeEvent(bad, { strict: true, now: NOW }).ok, false);
  assert.equal(sanitizeEvent(bad, { now: NOW }).value.endTime, NOW - 1000);
  assert.equal(sanitizeEvent(base({ endTime: null }), { now: NOW }).value.endTime, null);
});

test('sanitizeEvent: babyId rules (multiple babies)', () => {
  const pumpEv = { id: 'evt_p', type: 'pump', startTime: NOW, data: { amount: 4, unit: 'oz' }, babyId: BABY };
  assert.equal(sanitizeEvent(pumpEv, { strict: true }).value.babyId, null, 'pump is always parent-level');
  assert.equal(sanitizeEvent(base({ babyId: undefined }), { strict: true }).ok, false, 'app writes need a baby');
  assert.equal(sanitizeEvent(base({ babyId: undefined }), { strict: true, allowNullBaby: true }).value.babyId, null, 'unless the event never had one');
  assert.equal(sanitizeEvent(base({ babyId: 'baby_<x>' }), { strict: true, allowNullBaby: true }).ok, false, 'but never an invalid one');
  assert.equal(sanitizeEvent(base({ babyId: undefined }), { defaultBabyId: BABY }).value.babyId, BABY, 'imports fall back to a default');
  assert.equal(sanitizeEvent(base({ babyId: '<img src=x>' }), { defaultBabyId: BABY }).value.babyId, BABY, 'hostile id replaced');
  assert.equal(sanitizeEvent(base({ babyId: undefined }), {}).value.babyId, null, 'no default → kept (shows for every baby), never dropped');
  assert.equal(sanitizeEvent(base({ babyId: undefined }), { defaultBabyId: 'nope' }).value.babyId, null, 'invalid default ignored');
});

test('sanitizeEvent: deviceId / createdAt / migratedFrom', () => {
  const r = sanitizeEvent(base({ deviceId: 'dev_<script>', createdAt: 'x' }), { now: NOW, deviceId: DEV });
  assert.equal(r.value.deviceId, DEV, 'invalid device replaced by ours');
  assert.equal(r.value.createdAt, NOW);
  assert.equal(r.value.updatedAt, NOW, 'updatedAt falls back to createdAt');
  assert.ok(!('deviceId' in sanitizeEvent(base(), { now: NOW }).value), 'no deviceId at all → key omitted');
  assert.ok(!('migratedFrom' in sanitizeEvent(base({ migratedFrom: '<x>' })).value));
});

test('sanitizeEvent: hostile strings stay plain text, capped; control chars dropped', () => {
  const xss = '<img src=x onerror=alert(1)>';
  assert.equal(sanitizeEvent(base({ note: xss })).value.note, xss, 'never escaped here — html`` escapes at render');
  const huge = 'a'.repeat(10 * 1024 * 1024);
  const t0 = Date.now();
  const r = sanitizeEvent(base({ note: huge }));
  assert.equal(r.value.note.length, LIMITS.note);
  assert.ok(Date.now() - t0 < 500, 'a 10 MB note is cheap to reject');
  assert.equal(sanitizeEvent(base({ note: 'a\u0000b\u0007c\nd\te' })).value.note, 'abc\nd\te');
  assert.equal(sanitizeEvent(base({ note: 42 })).value.note, '', 'non-strings → empty');
});

test('sanitizeEvent: __proto__ / constructor never survive or pollute', () => {
  const raw = JSON.parse('{"id":"evt_x","type":"feed","startTime":' + NOW + ',"babyId":"' + BABY + '","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"data":{"method":"bottle","amount":"4","unit":"oz","__proto__":{"polluted":1}}}');
  const r = sanitizeEvent(raw);
  assert.equal(r.ok, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(r.value, '__proto__'));
  assert.ok(!Object.prototype.hasOwnProperty.call(r.value.data, '__proto__'));
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.equal(r.value.data.amount, 4);
});

test('sanitizeEventData feed: bottle vs breast, amounts coerced/capped', () => {
  const b = sanitizeEventData('feed', { method: 'bottle', milk: 'formula', amount: '4.5', unit: 'ML', prepared: 6, sourceInventoryId: 'inv_1', junk: true });
  assert.deepEqual(b.value, { method: 'bottle', milk: 'formula', amount: 4.5, unit: 'mL', prepared: 6, sourceInventoryId: 'inv_1' });
  const d = sanitizeEventData('feed', { amount: NaN, sourceInventoryId: '<x>', prepared: -1 });
  assert.deepEqual(d.value, { method: 'bottle', milk: 'breastmilk', amount: null, unit: 'oz' }, 'defaults; NaN → null; bad source dropped');
  assert.equal(sanitizeEventData('feed', { amount: 1e9 }).value.amount, null, 'absurd amount → null');
  assert.equal(sanitizeEventData('feed', { amount: -3 }).value.amount, null);
  assert.equal(sanitizeEventData('feed', { amount: true }).value.amount, null, 'boolean is not a number');
  const br = sanitizeEventData('feed', { method: 'breast', left: '300', right: -5, lastSide: 'up', activeSide: 'right', activeSince: NOW });
  assert.deepEqual(br.value, { method: 'breast', left: 300, right: 0, lastSide: 'left', activeSide: 'right', activeSince: NOW });
  assert.equal(sanitizeEventData('feed', { method: 'breast', left: 1e12 }).value.left, LIMITS.sideSec, 'side seconds capped');
  assert.equal(sanitizeEventData('feed', { method: 'breast', activeSide: 'left', activeSince: 'x' }).value.activeSince, null);
  assert.equal(sanitizeEventData('feed', { method: 'breast', activeSince: NOW }).value.activeSince, null, 'no active side → no activeSince');
});

test('sanitizeEventData pump / sleep / diaper / milestone', () => {
  assert.deepEqual(sanitizeEventData('pump', { amount: 3, unit: 'oz', storedTo: 'freezer', inventoryId: 'inv_9' }).value,
    { amount: 3, unit: 'oz', storedTo: 'freezer', inventoryId: 'inv_9' });
  assert.equal(sanitizeEventData('pump', { storedTo: 'garage' }).value.storedTo, null);
  assert.deepEqual(sanitizeEventData('sleep', { kind: 'night' }).value, { kind: 'night' });
  assert.equal(sanitizeEventData('sleep', {}, { startTime: new Date(2026, 9, 15, 21).getTime() }).value.kind, 'night', 'kind auto-classified from start');
  assert.equal(sanitizeEventData('sleep', {}, { startTime: new Date(2026, 9, 15, 13).getTime() }).value.kind, 'nap');
  assert.equal(sanitizeEventData('sleep', {}).value.kind, 'nap');
  assert.equal(sanitizeEventData('diaper', { kind: 'purple' }).ok, false, 'diaper kind is required');
  assert.deepEqual(sanitizeEventData('diaper', { kind: 'dirty', color: 'yellow'.repeat(20), consistency: 'seedy' }).value,
    { kind: 'dirty', color: 'yellow'.repeat(20).slice(0, LIMITS.short), consistency: 'seedy' });
  const m = sanitizeEventData('milestone', { key: 'first-smile', title: 't'.repeat(500), photoIds: ['pho_1', 'pho_1', '<x>', 5, 'pho_2'] });
  assert.deepEqual(m.value, { key: 'first-smile', title: 't'.repeat(LIMITS.title), photoIds: ['pho_1', 'pho_2'] });
  assert.equal(sanitizeEventData('milestone', { key: 'Bad Key!' }).value.key, null);
  assert.equal(sanitizeEventData('milestone', { photoIds: Array.from({ length: 50 }, (_, i) => `pho_${i}`) }).value.photoIds.length, LIMITS.photoIds);
  assert.equal(sanitizeEventData('telemetry', {}).ok, false);
  assert.equal(sanitizeEventData('feed', 'not an object').value.method, 'bottle', 'non-object data → defaults');
});

test('applyEventPatch: shallow top level, one-level data merge, strictly newer updatedAt', () => {
  const e = sanitizeEvent({ id: 'evt_f', type: 'feed', startTime: NOW - 60000, endTime: NOW, babyId: BABY, createdAt: NOW, updatedAt: NOW, data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' } }).value;
  const u = applyEventPatch(e, { note: 'sleepy', data: { amount: 3.5 } }, NOW);
  assert.equal(u.note, 'sleepy');
  assert.deepEqual(u.data, { method: 'bottle', milk: 'formula', amount: 3.5, unit: 'oz' });
  assert.equal(u.updatedAt, NOW + 1, 'same-millisecond edit is still newer');
  assert.equal(u.createdAt, e.createdAt);
  assert.equal(applyEventPatch(e, {}, NOW + 5000).updatedAt, NOW + 5000);
  assert.notEqual(u, e);
  assert.equal(e.note, '', 'input not mutated');
});

test('applyEventPatch: type/id/createdAt immutable; invalid edits throw', () => {
  const e = sanitizeEvent(base({ createdAt: NOW, updatedAt: NOW })).value;
  assert.throws(() => applyEventPatch(e, { type: 'pump' }), TypeError);
  assert.equal(applyEventPatch(e, { id: 'evt_other', createdAt: 1, deviceId: DEV }, NOW).id, 'evt_1', 'id ignored');
  assert.equal(applyEventPatch(e, { createdAt: 1 }, NOW).createdAt, NOW);
  assert.throws(() => applyEventPatch(e, { endTime: e.startTime - 1 }), RangeError);
  assert.throws(() => applyEventPatch(e, { data: { kind: 'purple' } }), RangeError);
  assert.throws(() => applyEventPatch(e, { babyId: null }), RangeError, 'a diaper can\'t lose its baby');
  assert.equal(applyEventPatch(e, { babyId: 'baby_twin' }, NOW).babyId, 'baby_twin', '"this was the other twin"');
  const pumpEv = sanitizeEvent({ id: 'evt_p', type: 'pump', startTime: NOW, data: {} }).value;
  assert.equal(applyEventPatch(pumpEv, { babyId: BABY }, NOW).babyId, null, 'pump stays parent-level');
});

test('applyEventPatch: an event that never had a baby stays editable', () => {
  const orphan = sanitizeEvent(base({ babyId: undefined, createdAt: NOW, updatedAt: NOW })).value;
  assert.equal(orphan.babyId, null);
  const u = applyEventPatch(orphan, { note: 'fixed' }, NOW);
  assert.equal(u.note, 'fixed');
  assert.equal(u.babyId, null);
  assert.equal(applyEventPatch(orphan, { babyId: BABY }, NOW).babyId, BABY, 'and can be assigned');
});

test('matchesBaby: undefined = all, id = that baby + parent-level, null = parent-level', () => {
  const mine = { babyId: BABY };
  const twin = { babyId: 'baby_twin' };
  const parent = { babyId: null };
  const legacy = {};
  assert.deepEqual([mine, twin, parent, legacy].map(e => matchesBaby(e, undefined)), [true, true, true, true]);
  assert.deepEqual([mine, twin, parent, legacy].map(e => matchesBaby(e, BABY)), [true, false, true, true]);
  assert.deepEqual([mine, twin, parent, legacy].map(e => matchesBaby(e, null)), [false, false, true, true]);
});

test('compareNewestFirst: startTime desc, then createdAt desc, then id — stable', () => {
  const a = { id: 'evt_a', startTime: 2, createdAt: 1 };
  const b = { id: 'evt_b', startTime: 2, createdAt: 2 };
  const c = { id: 'evt_c', startTime: 3, createdAt: 0 };
  const d = { id: 'evt_d', startTime: 2, createdAt: 2 };
  assert.deepEqual([a, b, c, d].sort(compareNewestFirst).map(e => e.id), ['evt_c', 'evt_d', 'evt_b', 'evt_a']);
});

test('error classes carry context for the UI', () => {
  const running = { id: 'evt_r', type: 'sleep', babyId: BABY };
  const err = new RunningActivityError(running);
  assert.equal(err.name, 'RunningActivityError');
  assert.equal(err.running, running);
  assert.match(err.message, /sleep is already running for this baby/);
  assert.match(new RunningActivityError({ type: 'pump', babyId: null }).message, /^A pump is already running$/);
  const nf = new NotFoundError('evt_x');
  assert.deepEqual([nf.name, nf.id], ['NotFoundError', 'evt_x']);
});
