// core/settings.js — the PURE half: per-key sanitizers (§6), babies,
// text cleanup. Load/set/subscribe against IndexedDB are covered in
// tests/e2e/core.mjs. get() before load() is pure too (defaults).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSetting, sanitizeBaby, cleanText, isValidDateString, makeBaby, get, all,
  DEFAULTS, EXPORTABLE_KEYS, TRACKER_KEYS, TODAY_CARDS, BABY_ID_RE, MAX_BABIES, NAME_MAX,
} from '../js/core/settings.js';
import { DEFAULT_STORAGE_WINDOWS } from '../js/domain/inventory.js';

const T = new Date('2026-10-15T12:00:00').getTime();
const ok = (key, value, opts) => {
  const r = sanitizeSetting(key, value, opts);
  assert.equal(r.ok, true, `${key}=${JSON.stringify(value)} should pass: ${r.error}`);
  return r.value;
};
const bad = (key, value, opts) => assert.equal(sanitizeSetting(key, value, opts).ok, false, `${key}=${JSON.stringify(value)} should fail`);

test('§6 defaults: every key present; babies/profile replaced', () => {
  assert.deepEqual(Object.keys(DEFAULTS).sort(), [
    'activeBabyId', 'babies', 'deviceId', 'feedbackEmail', 'iconDataUrl', 'lastBackupAt', 'migratedV2', 'onboarded',
    'parentName', 'persistGranted', 'pumpGoalOz', 'pumpIntervalMinutes', 'sound', 'storageWindows', 'theme', 'todayOrder', 'trackers', 'units',
  ].sort());
  assert.ok(!('profile' in DEFAULTS), 'v1-era profile object is gone');
  assert.equal(DEFAULTS.units, 'oz');
  assert.equal(DEFAULTS.theme, 'auto');
  assert.equal(DEFAULTS.sound, 'night-off');
  assert.equal(DEFAULTS.pumpGoalOz, 24);
  assert.equal(DEFAULTS.pumpIntervalMinutes, 180);
  assert.deepEqual([...DEFAULTS.todayOrder], ['feed', 'sleep', 'diaper', 'pump', 'stash']);
  assert.deepEqual(Object.keys(DEFAULTS.trackers), ['bottle', 'formula', 'breastfeeding', 'pump', 'stash', 'sleep', 'diaper', 'memories']);
  assert.ok(Object.values(DEFAULTS.trackers).every(v => v === true));
  assert.deepEqual({ ...DEFAULTS.storageWindows }, { ...DEFAULT_STORAGE_WINDOWS });
  assert.deepEqual([DEFAULTS.lastBackupAt, DEFAULTS.persistGranted, DEFAULTS.feedbackEmail, DEFAULTS.onboarded, DEFAULTS.migratedV2], [null, null, '', false, false]);
  assert.ok(Object.isFrozen(DEFAULTS) && Object.isFrozen(DEFAULTS.trackers), 'deep-frozen');
});

test('get()/all() before load(): defaults, copies, unknown keys undefined', () => {
  assert.equal(get('units'), 'oz');
  const t = get('trackers');
  t.pump = false;
  assert.equal(get('trackers').pump, true, 'get() hands out copies');
  assert.equal(get('nonsense'), undefined);
  assert.equal(get('activeBabyId'), null, 'no babies before load()');
  assert.deepEqual(get('babies'), []);
  assert.equal(Object.keys(all()).length, Object.keys(DEFAULTS).length);
});

test('exportable keys exclude per-install state', () => {
  for (const k of ['deviceId', 'migratedV2', 'lastBackupAt', 'persistGranted', 'iconDataUrl', 'feedbackEmail']) {
    assert.ok(!EXPORTABLE_KEYS.includes(k), `${k} must not travel in a backup`);
  }
  for (const k of ['babies', 'activeBabyId', 'parentName', 'units', 'trackers', 'storageWindows']) assert.ok(EXPORTABLE_KEYS.includes(k));
});

test('enums: units / theme / sound', () => {
  assert.equal(ok('units', 'mL'), 'mL');
  bad('units', 'ml');
  bad('units', 'cups');
  for (const t of ['auto', 'light', 'dark']) ok('theme', t);
  bad('theme', 'sepia');
  for (const s of ['on', 'off', 'night-off']) ok('sound', s);
  bad('sound', true);
});

test('numbers: pumpGoalOz 1–200 (0.1), pumpIntervalMinutes 30–720 (whole)', () => {
  assert.equal(ok('pumpGoalOz', '26.44'), 26.4);
  bad('pumpGoalOz', 0);
  bad('pumpGoalOz', 201);
  bad('pumpGoalOz', NaN);
  bad('pumpGoalOz', true);
  assert.equal(ok('pumpIntervalMinutes', 150.6), 151);
  bad('pumpIntervalMinutes', 29);
  bad('pumpIntervalMinutes', 721);
  bad('pumpIntervalMinutes', '2h');
});

test('trackers / todayOrder repair instead of failing', () => {
  assert.deepEqual(ok('trackers', { pump: false, sleep: 'no', evil: true }), { ...DEFAULTS.trackers, pump: false });
  bad('trackers', ['pump']);
  assert.deepEqual(ok('todayOrder', ['stash', 'stash', 'evil', 'feed']), ['stash', 'feed', 'sleep', 'diaper', 'pump']);
  bad('todayOrder', 'feed');
  assert.deepEqual(TODAY_CARDS, ['feed', 'sleep', 'diaper', 'pump', 'stash']);
  assert.equal(TRACKER_KEYS.length, 8);
});

test('storageWindows: each window range-checked, defaults fill the gaps', () => {
  const v = ok('storageWindows', { fridgeDays: 3, freezerMonths: 999, roomTempHours: 'x', thawedBottleHours: 12 });
  assert.deepEqual(v, { ...DEFAULT_STORAGE_WINDOWS, fridgeDays: 3, thawedBottleHours: 12 });
  bad('storageWindows', null);
});

test('§10b/§10c keys: lastBackupAt, persistGranted, feedbackEmail', () => {
  assert.equal(ok('lastBackupAt', T), T);
  assert.equal(ok('lastBackupAt', null), null);
  bad('lastBackupAt', '2026-10-15');
  bad('lastBackupAt', 5);
  assert.equal(ok('persistGranted', true), true);
  assert.equal(ok('persistGranted', null), null);
  bad('persistGranted', 'yes');
  assert.equal(ok('feedbackEmail', ''), '');
  assert.equal(ok('feedbackEmail', 'hello@example.com'), 'hello@example.com');
  for (const e of ['x@y.com?bcc=evil@z.com', 'a b@c.com', 'x@y', '"><script>@x.com', 'x@y.com\r\nBcc: z@q.com', `${'a'.repeat(300)}@x.com`]) bad('feedbackEmail', e);
});

test('deviceId / booleans / iconDataUrl', () => {
  ok('deviceId', 'dev_0123456789ab');
  bad('deviceId', 'dev_<x>');
  bad('deviceId', 'attacker');
  ok('onboarded', true);
  bad('onboarded', 'true');
  ok('migratedV2', false);
  ok('iconDataUrl', 'data:image/png;base64,iVBORw0KGgo=');
  ok('iconDataUrl', null);
  bad('iconDataUrl', 'data:text/html;base64,PHNjcmlwdD4=');
  bad('iconDataUrl', 'javascript:alert(1)');
  bad('iconDataUrl', `data:image/png;base64,${'A'.repeat(500_000)}`);
});

test('unknown keys: allowed only with a sane name, never prototype keys', () => {
  ok('nurture.uiTab', 'today');
  for (const k of ['__proto__', 'constructor', 'prototype', '', '1abc', 'a b', 'x'.repeat(65)]) bad(k, 1);
});

test('parentName: text only, cleaned and capped', () => {
  assert.equal(ok('parentName', '  Nick\u0000 '), 'Nick');
  assert.equal(ok('parentName', 'n'.repeat(500)).length, NAME_MAX);
  assert.equal(ok('parentName', '<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'plain text, escaped at render');
  bad('parentName', 42);
});

test('babies: strict app writes vs lenient reads/imports', () => {
  const clara = { id: 'baby_clara1', name: ' Clara ', birthDate: '2026-08-01', photoId: 'pho_1', createdAt: T };
  assert.deepEqual(ok('babies', [clara]), [{ id: 'baby_clara1', name: 'Clara', birthDate: '2026-08-01', photoId: 'pho_1', createdAt: T }]);
  bad('babies', []);
  bad('babies', 'Clara');
  bad('babies', [clara, clara], {}, 'duplicate ids');
  bad('babies', [{ ...clara, birthDate: '2026-02-31' }]);
  bad('babies', [{ ...clara, id: 'clara' }]);
  bad('babies', Array.from({ length: MAX_BABIES + 1 }, (_, i) => ({ id: `baby_${i}` })));
  // Lenient: drop/repair, never fail just because one field is off.
  const repaired = ok('babies', [{ ...clara, birthDate: 'soon', photoId: '<x>' }, clara, { id: '<script>' }, null], { lenient: true });
  assert.deepEqual(repaired, [{ id: 'baby_clara1', name: 'Clara', birthDate: null, photoId: null, createdAt: T }]);
  assert.equal(ok('babies', Array.from({ length: 50 }, (_, i) => ({ id: `baby_${i}` })), { lenient: true }).length, MAX_BABIES);
  bad('babies', [{ id: '<script>' }], { lenient: true });
});

test('activeBabyId: format-checked (membership is checked by set())', () => {
  ok('activeBabyId', 'baby_abc');
  bad('activeBabyId', 'abc');
  bad('activeBabyId', null);
  assert.ok(BABY_ID_RE.test('baby_0f8fad5b-d9cb-469f-a165-70867728950e'));
  assert.ok(!BABY_ID_RE.test('baby_'));
});

test('sanitizeBaby: builds a new object from known keys only', () => {
  const raw = JSON.parse('{"id":"baby_x1","name":"Ivy","__proto__":{"polluted":1},"evil":"<script>"}');
  const b = sanitizeBaby(raw);
  assert.deepEqual(Object.keys(b), ['id', 'name', 'birthDate', 'photoId', 'createdAt']);
  assert.equal(({}).polluted, undefined);
  assert.equal(sanitizeBaby({ id: 'baby_x', name: 5 }), null, 'strict: wrong type rejected');
  assert.equal(sanitizeBaby({ id: 'baby_x', name: 5 }, { lenient: true }).name, '', 'lenient: repaired');
  assert.equal(sanitizeBaby('baby_x'), null);
});

test('makeBaby: fresh id, cleaned name', () => {
  const b = makeBaby({ name: '  Max  ' }, T);
  assert.match(b.id, BABY_ID_RE);
  assert.deepEqual([b.name, b.birthDate, b.photoId, b.createdAt], ['Max', null, null, T]);
  assert.notEqual(makeBaby().id, makeBaby().id);
});

test('cleanText / isValidDateString', () => {
  assert.equal(cleanText('a\u0000b\u001Fc\u007F\nd', 100), 'abc\nd');
  assert.equal(cleanText('abcdef', 3), 'abc');
  assert.equal(cleanText(null, 5), '');
  assert.equal(cleanText({ toString: () => 'x' }, 5), '', 'objects are not strings');
  assert.equal(cleanText('\u0000\u0000ok', 3), 'ok', 'stripped characters don\'t count toward the cap…');
  assert.equal(cleanText('\u0000'.repeat(10) + 'ok', 5), '', '…within a 2× pre-slice that keeps a 10 MB string cheap');
  assert.ok(isValidDateString('2024-02-29'));
  assert.ok(!isValidDateString('2026-02-29'));
  assert.ok(!isValidDateString('2026-13-01'));
  assert.ok(!isValidDateString('1899-12-31'));
  assert.ok(!isValidDateString('2026-1-1'));
  assert.ok(!isValidDateString('2026-01-01T00:00'));
});
