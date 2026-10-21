// core/reminders.js (pure calculateSchedule), core/audio.js (quiet hours)
// and core/persist.js (backupDue) — the decision logic behind nudges and
// chimes, with an injectable clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSchedule, DUE_SOON_MINUTES } from '../js/core/reminders.js';
import { isQuietHours, isSoundAllowed, QUIET_START_HOUR, QUIET_END_HOUR, vibrate, sound } from '../js/core/audio.js';
import { backupDue, BACKUP_INTERVAL_MS, MIN_DATA_SPAN_MS } from '../js/core/persist.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 15, 12, 0).getTime();
const pumpAt = (start, end = start + 20 * MIN) => ({ id: 'evt_p', type: 'pump', startTime: start, endTime: end, data: { amount: 4, unit: 'oz' } });

// ------------------------------------------------------- calculateSchedule

test('calculateSchedule: none when nothing logged', () => {
  const s = calculateSchedule(null, 180, NOW);
  assert.deepEqual([s.status, s.hasSession, s.isOverdue, s.intervalMinutes], ['none', false, false, 180]);
  assert.equal(calculateSchedule({ startTime: 'x' }, 180, NOW).status, 'none');
});

test('calculateSchedule: running pump → "Pumping now"', () => {
  const s = calculateSchedule(pumpAt(NOW - 5 * MIN, null), 180, NOW);
  assert.deepEqual([s.status, s.label, s.isOverdue, s.lastTime], ['running', 'Pumping now', false, NOW - 5 * MIN]);
});

test('calculateSchedule: upcoming / due-soon / overdue from the last pump END', () => {
  const up = calculateSchedule(pumpAt(NOW - 60 * MIN, NOW - 40 * MIN), 180, NOW, { hour12: true });
  assert.equal(up.status, 'upcoming');
  assert.equal(up.lastTime, NOW - 40 * MIN, 'due is measured from when pumping ended');
  assert.equal(up.nextDueTime, NOW + 140 * MIN);
  assert.equal(up.diffMins, 140);
  assert.equal(up.label, 'Next pump in 2h 20m · 2:20 PM');

  const soon = calculateSchedule(pumpAt(NOW - 190 * MIN, NOW - 170 * MIN), 180, NOW, { hour12: false });
  assert.deepEqual([soon.status, soon.diffMins, soon.label], ['due-soon', 10, 'Pump due at 12:10']);
  const edge = calculateSchedule(pumpAt(NOW - 185 * MIN, NOW - (180 - DUE_SOON_MINUTES) * MIN), 180, NOW);
  assert.equal(edge.status, 'upcoming', `exactly ${DUE_SOON_MINUTES}m left is not yet "soon"`);

  const over = calculateSchedule(pumpAt(NOW - 5 * HOUR, NOW - 4 * HOUR - 50 * MIN), 180, NOW);
  assert.deepEqual([over.status, over.isOverdue, over.label], ['overdue', true, 'Pump overdue by 1h 50m']);
  const justDue = calculateSchedule(pumpAt(NOW - 200 * MIN, NOW - 180 * MIN), 180, NOW);
  assert.deepEqual([justDue.status, justDue.label], ['overdue', 'Pump overdue by 1m'], 'at the due instant: overdue, never "0m"');
});

test('calculateSchedule: floors toward less time left; falls back to startTime; bad interval → 180', () => {
  const s = calculateSchedule(pumpAt(NOW - 30 * 1000, NOW - 30 * 1000), 60, NOW);
  assert.equal(s.diffMins, 59, '59m30s left reads 59, never promises 60');
  const noEnd = calculateSchedule({ type: 'pump', startTime: NOW - HOUR, endTime: undefined }, 120, NOW);
  assert.equal(noEnd.lastTime, NOW - HOUR);
  for (const bad of [0, -5, NaN, '120', undefined]) assert.equal(calculateSchedule(pumpAt(NOW), bad, NOW).intervalMinutes, 180, String(bad));
});

// ------------------------------------------------------------------- audio

test('quiet hours: 19:00 → 08:00 local', () => {
  assert.deepEqual([QUIET_START_HOUR, QUIET_END_HOUR], [19, 8]);
  const h = (hh, mm = 0) => new Date(2026, 9, 15, hh, mm);
  assert.equal(isQuietHours(h(18, 59)), false);
  assert.equal(isQuietHours(h(19, 0)), true);
  assert.equal(isQuietHours(h(23, 30)), true);
  assert.equal(isQuietHours(h(3)), true);
  assert.equal(isQuietHours(h(7, 59)), true);
  assert.equal(isQuietHours(h(8, 0)), false);
  assert.equal(isQuietHours(h(12).getTime()), false, 'accepts epoch ms');
});

test('isSoundAllowed: on / off / night-off (default for unknown)', () => {
  const day = new Date(2026, 9, 15, 12);
  const night = new Date(2026, 9, 15, 22);
  assert.deepEqual([isSoundAllowed('on', day), isSoundAllowed('on', night)], [true, true]);
  assert.deepEqual([isSoundAllowed('off', day), isSoundAllowed('off', night)], [false, false]);
  assert.deepEqual([isSoundAllowed('night-off', day), isSoundAllowed('night-off', night)], [true, false]);
  assert.deepEqual([isSoundAllowed(undefined, night), isSoundAllowed('loud', night)], [false, false], 'unknown behaves like the calm default');
});

test('audio is inert without a browser (Node): no throw, nothing played', () => {
  assert.equal(vibrate([10]), false);
  assert.equal(sound.playChime('alert'), false);
  assert.doesNotThrow(() => sound.unlock());
});

// ---------------------------------------------------------------- persist

test('backupDue: needs ≥ 1 day of data', () => {
  assert.equal(MIN_DATA_SPAN_MS, DAY);
  assert.equal(backupDue({ lastBackupAt: null }, false, NOW), false);
  assert.equal(backupDue({ lastBackupAt: null }, null, NOW), false);
  assert.equal(backupDue({ lastBackupAt: null }, true, NOW), true);
  assert.equal(backupDue({ lastBackupAt: null }, NOW - 23 * HOUR, NOW), false, 'oldest record < 24h old');
  assert.equal(backupDue({ lastBackupAt: null }, NOW - DAY, NOW), true, 'exactly a day');
  assert.equal(backupDue({ lastBackupAt: null }, NaN, NOW), false);
  assert.equal(backupDue({ lastBackupAt: null }, 'yes', NOW), false, 'only true or a timestamp count');
});

test('backupDue: null or older than 7 days → due; recent → quiet', () => {
  assert.equal(BACKUP_INTERVAL_MS, 7 * DAY);
  assert.equal(backupDue({ lastBackupAt: NOW - 6 * DAY }, true, NOW), false);
  assert.equal(backupDue({ lastBackupAt: NOW - 7 * DAY }, true, NOW), true);
  assert.equal(backupDue({ lastBackupAt: NOW - 30 * DAY }, true, NOW), true);
  assert.equal(backupDue({}, true, NOW), true, 'never backed up');
  assert.equal(backupDue(null, true, NOW), true);
  assert.equal(backupDue({ lastBackupAt: 'yesterday' }, true, NOW), true, 'garbage = never');
});

test('backupDue: a far-future lastBackupAt (clock skew) can\'t silence the nudge forever', () => {
  assert.equal(backupDue({ lastBackupAt: NOW + 2 * HOUR }, true, NOW), false, 'small skew tolerated');
  assert.equal(backupDue({ lastBackupAt: NOW + 30 * DAY }, true, NOW), true);
});
