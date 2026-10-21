// QA round 1, data/backup/onboarding fixes — the PURE halves. The IndexedDB
// halves (settings.removeBaby, onboarding restore with a typed name, …) run
// in Chromium: tests/e2e/data.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStaleRunning, stopStaleRunning, mergeBackup, describeImport, isPristineProfile, clampExpiryToWindows,
  STALE_RUNNING_LIMITS, STALE_RUNNING_NOTE, validateBackup,
} from '../js/core/backup.js';
import { settings, removeBaby } from '../js/core/settings.js';
import { DEFAULT_STORAGE_WINDOWS } from '../js/domain/inventory.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-15T12:00:00').getTime();
const ev = (over) => ({ id: 'evt_a', type: 'sleep', startTime: NOW - HOUR, endTime: null, babyId: 'baby_a', data: { kind: 'nap' }, note: '', createdAt: NOW - HOUR, updatedAt: NOW - HOUR, ...over });

test('DI-12: a running timer is stale past its type\'s limit (sleep 16 h, feed/pump 24 h)', () => {
  assert.equal(STALE_RUNNING_LIMITS.sleep, 16 * HOUR);
  assert.equal(isStaleRunning(ev({ startTime: NOW - 15 * HOUR }), NOW), false, 'a long night is still a night');
  assert.equal(isStaleRunning(ev({ startTime: NOW - 17 * HOUR }), NOW), true);
  assert.equal(isStaleRunning(ev({ type: 'feed', startTime: NOW - 20 * HOUR, data: {} }), NOW), false);
  assert.equal(isStaleRunning(ev({ type: 'pump', startTime: NOW - 25 * HOUR, data: {} }), NOW), true);
  assert.equal(isStaleRunning(ev({ startTime: NOW - 300 * DAY, endTime: NOW - 300 * DAY + HOUR }), NOW), false, 'finished entries are never touched');
});

test('DI-12: a stale timer is finished at its start, with a note, and a live breast side is closed', () => {
  const sleep = stopStaleRunning(ev({ startTime: NOW - 300 * DAY }));
  assert.equal(sleep.endTime, sleep.startTime, 'no made-up duration');
  assert.equal(sleep.note, STALE_RUNNING_NOTE);
  assert.ok(!/session|user/i.test(STALE_RUNNING_NOTE), 'copy voice');
  const breast = stopStaleRunning(ev({ type: 'feed', startTime: NOW - 3 * DAY, note: 'cluster feeding', data: { method: 'breast', left: 300, right: 0, activeSide: 'right', activeSince: NOW - 3 * DAY } }));
  assert.deepEqual([breast.data.activeSide, breast.data.activeSince, breast.data.left], [null, null, 300]);
  assert.equal(breast.note, `cluster feeding\n${STALE_RUNNING_NOTE}`, 'the parent\'s note is kept');
  assert.equal(stopStaleRunning(breast).note, breast.note, 'never noted twice');
});

test('DI-12: mergeBackup stops a 300-day-old running sleep and a 17 h one, keeps a 2 h one running', () => {
  const { toPut, stats } = mergeBackup({ events: [], babies: [{ id: 'baby_a', name: 'A' }] }, {
    babies: [{ id: 'baby_a', name: 'A' }],
    events: [
      ev({ id: 'evt_old', startTime: NOW - 300 * DAY }),
      ev({ id: 'evt_17h', type: 'pump', startTime: NOW - 17 * HOUR, babyId: null, data: {} }),
      ev({ id: 'evt_now', type: 'feed', startTime: NOW - 2 * HOUR, data: { method: 'bottle' } }),
    ],
  }, { now: NOW });
  const by = Object.fromEntries(toPut.events.map(e => [e.id, e]));
  assert.equal(stats.events.stoppedStale, 1);
  assert.equal(by.evt_old.endTime, by.evt_old.startTime);
  assert.equal(by.evt_17h.endTime, null, 'a 17 h pump is under the 24 h limit');
  assert.equal(by.evt_now.endTime, null);
});

test('DI-02: an imported pouch gets this phone\'s windows (fridge 4 days, thawed 24 h), never the file\'s', () => {
  const fridge = clampExpiryToWindows({ id: 'inv_a', location: 'fridge', pumpedAt: NOW - 10 * DAY, expiresAt: Date.UTC(2100, 0, 1) }, DEFAULT_STORAGE_WINDOWS);
  assert.ok(fridge.expiresAt < NOW, '10-day-old fridge milk is expired');
  const thawed = clampExpiryToWindows({ id: 'inv_b', location: 'thawed', pumpedAt: NOW - 20 * DAY, thawedAt: NOW - 60 * HOUR, expiresAt: NOW + 12 * HOUR }, DEFAULT_STORAGE_WINDOWS);
  assert.equal(thawed.expiresAt, NOW - 60 * HOUR + DEFAULT_STORAGE_WINDOWS.thawedBottleHours * HOUR);
  assert.ok(thawed.expiresAt < NOW, 'thawed 60 h ago → expired');
  const earlier = { id: 'inv_c', location: 'fridge', pumpedAt: NOW - DAY, expiresAt: NOW + HOUR };
  assert.equal(clampExpiryToWindows(earlier, DEFAULT_STORAGE_WINDOWS), earlier, 'a shorter expiry in the file is kept (the safer one)');
  // And through validateBackup + the import path (sanitize, then clamp).
  const v = validateBackup({ app: 'nurture', schema: 2, inventory: [{ id: 'inv_d', location: 'fridge', pumpedAt: NOW - 10 * DAY, quantity: 4, unit: 'oz', status: 'active', expiresAt: Date.UTC(2100, 0, 1) }] }, { now: NOW });
  assert.ok(clampExpiryToWindows(v.data.inventory[0], DEFAULT_STORAGE_WINDOWS).expiresAt < NOW);
});

test('DI-03: a profile with only the onboarding details (no entries) counts as a placeholder on a fresh install', () => {
  const typed = [{ id: 'baby_x', name: 'Avery', birthDate: '2026-09-01', photoId: 'pho_1' }];
  assert.equal(isPristineProfile(typed, []), false, 'a named baby is kept by an ordinary merge');
  assert.equal(isPristineProfile(typed, [], { ignoreDetails: true }), true, 'onboarding restore: the file is the real profile');
  assert.equal(isPristineProfile(typed, [{ babyId: 'baby_x' }], { ignoreDetails: true }), false, 'never once there are entries');
  assert.equal(isPristineProfile([...typed, { id: 'baby_y' }], [], { ignoreDetails: true }), false, 'never with two babies');
  assert.equal(isPristineProfile(typed, [{ babyId: null, type: 'pump' }], { ignoreDetails: true }), true, 'the parent\'s pumps are not the baby\'s entries');
});

test('describeImport: replace only claims a copy that was kept (DI-01)', () => {
  assert.equal(describeImport({ mode: 'replace', safetyKept: true }), 'Replaced with the backup. What was here is kept on this phone.');
  assert.equal(describeImport({ mode: 'replace', safetyKept: false }), 'Replaced with the backup.');
  assert.ok(!/saved first/.test(describeImport({ mode: 'replace', safetyKept: false })));
});

test('describeImport: a new baby is named with where to switch; skipped entries and stopped timers counted (DI-04, DI-11, DI-12)', () => {
  const base = { events: { added: 2, updated: 0, stoppedStale: 0 }, inventory: { added: 0, updated: 0 }, photos: { added: 0 }, rejected: { events: 0, inventory: 0 } };
  assert.equal(describeImport({ mode: 'merge', stats: { ...base, babies: { added: 0, matched: 1, placeholders: 0, addedBabies: [] } } }), 'Merged · 2 entries added');
  assert.equal(
    describeImport({ mode: 'merge', stats: { ...base, babies: { added: 1, matched: 0, placeholders: 0, addedBabies: [{ id: 'baby_r', name: 'Clara Rose' }] } } }),
    'Merged · 2 entries added. Added Clara Rose as a new baby. Switch babies from the name on Today.',
  );
  assert.equal(
    describeImport({ mode: 'merge', stats: { ...base, babies: { added: 2, matched: 0, placeholders: 1, addedBabies: [{ id: 'baby_r', name: 'Rose' }, { id: 'baby_q', name: '' }] } } }),
    'Merged · 2 entries added. Added Rose and 2 unnamed babies as new babies. Switch babies from the name on Today.',
  );
  assert.equal(
    describeImport({ mode: 'merge', stats: { ...base, events: { added: 1, updated: 0, stoppedStale: 1 }, rejected: { events: 3, inventory: 0 } } }),
    'Merged · 1 entry added · 3 entries skipped, 1 old timer stopped',
  );
  assert.equal(describeImport({ mode: 'merge', stats: { ...base, events: { added: 0, updated: 0 } } }), 'Already up to date · nothing new in that file');
  assert.equal(describeImport({ mode: 'merge', adoptedProfile: true, stats: { ...base, babies: { added: 2, addedBabies: [{ name: 'Ava' }, { name: 'Ben' }] } } }), 'Merged · 2 entries added', 'a placeholder giving way is not "new babies"');
  assert.equal(describeImport({ mode: 'merge', stats: base }, { restore: true }), 'Welcome back · 2 entries restored');
  for (const s of ['session', 'user']) assert.ok(!describeImport({ mode: 'merge', stats: { ...base, babies: { added: 1, addedBabies: [{ name: 'X' }] } } }).toLowerCase().includes(s));
});

test('settings.removeBaby is part of the settings API (implementation runs against IndexedDB in tests/e2e/data.mjs)', () => {
  assert.equal(typeof removeBaby, 'function');
  assert.equal(settings.removeBaby, removeBaby);
});
