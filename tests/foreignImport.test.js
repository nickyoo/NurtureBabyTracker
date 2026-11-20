// core/foreignImport.js — other trackers' exports → candidate Nurture
// backups. The candidates still go through validateBackup (the trust
// boundary) before anything is merged; these tests assert both halves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseTime, parseAmount, isNurtureBackupText, convertForeignText, describeConversion } from '../js/core/foreignImport.js';
import { validateBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-20T12:00:00Z').getTime();
const TZ = 'America/Chicago';

const NARA_HEADER = '"Type","Profile Name","Start Date/time","Start Date/time (Epoch)","Created By Caregiver","Note","Time Zone","[Pump] Duration (Seconds)","[Pump] End Date/time (Epoch)","[Pump] Left Volume","[Pump] Left Volume Unit","[Pump] Right Volume","[Pump] Right Volume Unit","[Pump] Total Volume","[Pump] Total Volume Unit","[Bottle Feed] Type","[Bottle Feed] Breast Milk Volume","[Bottle Feed] Breast Milk Volume Unit","[Bottle Feed] Formula Name","[Bottle Feed] Formula Volume","[Bottle Feed] Formula Volume Unit","[Diaper] Type","[Diaper] Dirty Color","[Sleep] Duration (Seconds)","[Sleep] End Date/time (Epoch)","[Profile] Birth Date","_activityKey"';
const naraRow = cells => cells.map(c => `"${c}"`).join(',');
const NARA = [
  NARA_HEADER,
  naraRow(['Profile', 'Sienna', '', '', '', '', 'America/Chicago', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '2026-08-14', 'p-1']),
  naraRow(['Pump', '', '2026-11-19 18:41:00', '1795135260000', 'Savannah', '', 'America/Chicago', '1200', '1795136460000', '', '', '', '', '4.5', 'FLOZ', '', '', '', '', '', '', '', '', '', '', '', 't-aaa']),
  naraRow(['Pump', '', '2026-11-18 10:00:00', '1795039200000', 'Savannah', '', 'America/Chicago', '1200', '1795040400000', '2', 'FLOZ', '3', 'FLOZ', '', '', '', '', '', '', '', '', '', '', '', '', '', 't-bbb']),
  naraRow(['Bottle Feed', '', '2026-09-11 00:15:50', '1789103750000', 'Nick', '', 'America/Chicago', '', '', '', '', '', '', '', '', 'Formula', '', '', 'Bobbie Organic', '2', 'FLOZ', '', '', '', '', '', 't-ccc']),
  naraRow(['Bottle Feed', '', '2026-09-10 09:00:00', '1789047600000', 'Nick', 'sleepy', 'America/Chicago', '', '', '', '', '', '', '', '', 'Breast Milk', '3', 'FLOZ', '', '', '', '', '', '', '', '', 't-ddd']),
  naraRow(['Diaper', '', '2026-09-09 05:48:42', '1788950922000', 'Nick', '', 'America/Chicago', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Dirty Wet', 'Yellow', '', '', '', 't-eee']),
  naraRow(['Sleep', '', '2026-09-05 10:23:49', '1788621829000', 'Nick', '', 'America/Chicago', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '1958', '1788623786836', '', 't-fff']),
  naraRow(['Growth', '', '2026-09-06 10:00:00', '1788706800000', 'Nick', '', 'America/Chicago', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 't-ggg']),
].join('\n');

test('nara: converts every mappable row, reports the rest', () => {
  const conv = convertForeignText(NARA, { now: NOW, fallbackTimeZone: TZ });
  assert.equal(conv.ok, true);
  assert.equal(conv.source, 'nara');
  assert.deepEqual(conv.report.converted, { feed: 2, pump: 2, sleep: 1, diaper: 1 });
  assert.equal(conv.report.skipped.length, 1);
  assert.match(conv.report.skipped[0].reason, /Growth/);
  const baby = conv.backup.settings.babies[0];
  assert.equal(baby.name, 'Sienna');
  assert.equal(baby.birthDate, '2026-08-14');

  const pumps = conv.backup.events.filter(e => e.type === 'pump');
  assert.equal(pumps[0].data.amount, 5);            // L 2 + R 3, no total logged
  assert.equal(pumps[0].babyId, null);              // pumps are parent-level
  const totalPump = pumps.find(p => p.id === 'nara_t-aaa');
  assert.equal(totalPump.data.amount, 4.5);
  assert.equal(totalPump.endTime - totalPump.startTime, 1200 * 1000);

  const formula = conv.backup.events.find(e => e.id === 'nara_t-ccc');
  assert.equal(formula.data.milk, 'formula');
  assert.equal(formula.data.amount, 2);
  assert.match(formula.note, /Bobbie Organic/);     // brand survives in the note

  const diaper = conv.backup.events.find(e => e.type === 'diaper');
  assert.equal(diaper.data.kind, 'both');
  assert.equal(diaper.data.color, 'Yellow');

  const v = validateBackup(conv.backup, { now: NOW });
  assert.equal(v.ok, true);
  assert.deepEqual(v.stats.events, { accepted: 6, rejected: 0 });
});

test('nara: converting twice yields identical ids (re-import is a no-op)', () => {
  const a = convertForeignText(NARA, { now: NOW, fallbackTimeZone: TZ });
  const b = convertForeignText(NARA, { now: NOW, fallbackTimeZone: TZ });
  assert.deepEqual(a.backup.events.map(e => e.id), b.backup.events.map(e => e.id));
});

const HUCKLEBERRY = [
  'Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes',
  'Sleep,2026-11-10 22:00,2026-11-11 06:30,8:30,,,,Night stretch',
  'Feed,2026-11-11 07:00,,,00:07R,Breast,00:06L,',
  'Feed,2026-11-11 09:00,,,Formula,Bottle,140ml,',
  'Diaper,2026-11-11 10:00,,Green,,,"Poo",',
  'Pump,2026-11-11 11:00,2026-11-11 11:20,,100ml,,120ml,',
  'Growth,2026-11-11 12:00,,,,,,',
].join('\n');

test('huckleberry: condition columns are read per type', () => {
  const conv = convertForeignText(HUCKLEBERRY, { now: NOW, fallbackTimeZone: TZ });
  assert.equal(conv.ok, true);
  assert.equal(conv.source, 'huckleberry');
  assert.deepEqual(conv.report.converted, { feed: 2, pump: 1, sleep: 1, diaper: 1 });
  assert.equal(conv.report.skipped.length, 1);

  const breast = conv.backup.events.find(e => e.data.method === 'breast');
  assert.equal(breast.data.right, 7 * 60);
  assert.equal(breast.data.left, 6 * 60);
  assert.equal(breast.data.lastSide, 'right');

  const bottle = conv.backup.events.find(e => e.data.method === 'bottle');
  assert.equal(bottle.data.milk, 'formula');
  assert.equal(bottle.data.amount, 140);
  assert.equal(bottle.data.unit, 'mL');

  const diaper = conv.backup.events.find(e => e.type === 'diaper');
  assert.equal(diaper.data.kind, 'dirty');
  assert.equal(diaper.data.color, 'Green');

  const pump = conv.backup.events.find(e => e.type === 'pump');
  assert.equal(pump.data.amount, 220);
  assert.equal(pump.data.unit, 'mL');

  // Wall-clock times are read in the fallback zone: 22:00 CST = 04:00 UTC.
  const sleep = conv.backup.events.find(e => e.type === 'sleep');
  assert.equal(sleep.startTime, Date.parse('2026-11-11T04:00:00Z'));

  const v = validateBackup(conv.backup, { now: NOW });
  assert.equal(v.ok, true);
  assert.deepEqual(v.stats.events, { accepted: 5, rejected: 0 });
});

const GENERIC = [
  'Type,Start Time,End Time,Amount,Unit,Note',
  'Bottle,2026-11-01 08:00,,4,oz,morning bottle',
  'Pump,2026-11-01 09:00,2026-11-01 09:20,5.5,oz,',
  'Diaper,2026-11-01 10:00,,,,"wet one"',
].join('\n');

test('generic csv: synonym headers and plain type words', () => {
  const conv = convertForeignText(GENERIC, { now: NOW, fallbackTimeZone: TZ });
  assert.equal(conv.ok, true);
  assert.equal(conv.source, 'generic');
  // The diaper row only says "wet one" in its note — no detail column — so
  // it is reported, not guessed.
  assert.deepEqual(conv.report.converted, { feed: 1, pump: 1, sleep: 0, diaper: 0 });
  assert.equal(conv.report.skipped.length, 1);
  const v = validateBackup(conv.backup, { now: NOW });
  assert.equal(v.ok, true);
  assert.deepEqual(v.stats.events, { accepted: 2, rejected: 0 });
});

test('generic json: a record list converts through the same pipeline', () => {
  const json = JSON.stringify([
    { type: 'Sleep', start: '2026-11-02 20:00', end: '2026-11-03 06:00' },
    { type: 'Diaper', start: '2026-11-03 07:00', detail: 'Wet' },
  ]);
  const conv = convertForeignText(json, { now: NOW, fallbackTimeZone: TZ });
  assert.equal(conv.ok, true);
  assert.deepEqual(conv.report.converted, { feed: 0, pump: 0, sleep: 1, diaper: 1 });
});

test('edges: empty, garbage, and growth-only files fail out loud', () => {
  assert.equal(convertForeignText('', { now: NOW }).ok, false);
  assert.equal(convertForeignText('not a file at all', { now: NOW }).ok, false);
  const growthOnly = 'Type,Start\nGrowth,2026-11-01 08:00';
  const conv = convertForeignText(growthOnly, { now: NOW, fallbackTimeZone: TZ });
  assert.equal(conv.ok, false);
  assert.equal(conv.report.skipped.length, 1);
});

test('isNurtureBackupText recognises v2 and v1 backups only', () => {
  assert.equal(isNurtureBackupText(JSON.stringify({ app: 'nurture', schema: 2, events: [] })), true);
  assert.equal(isNurtureBackupText(JSON.stringify({ version: 1, sessions: [] })), true);
  assert.equal(isNurtureBackupText(JSON.stringify([{ type: 'Sleep' }])), false);
  assert.equal(isNurtureBackupText('Type,Start\nSleep,x'), false);
});

test('parseTime: epochs, offsets, and zoned wall-clock', () => {
  assert.equal(parseTime('1795135260000', TZ), 1795135260000);
  assert.equal(parseTime('1795135260', TZ), 1795135260000);
  assert.equal(parseTime('2026-11-19T18:41:00Z', TZ), Date.parse('2026-11-19T18:41:00Z'));
  assert.equal(parseTime('2026-11-19 18:41:00', TZ), Date.parse('2026-11-20T00:41:00Z')); // CST = UTC-6
  assert.equal(parseTime('', TZ), null);
  assert.equal(parseTime('whenever', TZ), null);
});

test('parseAmount and parseCSV basics', () => {
  assert.deepEqual(parseAmount('140ml'), { amount: 140, unit: 'mL' });
  assert.deepEqual(parseAmount('4.5 oz'), { amount: 4.5, unit: 'oz' });
  assert.deepEqual(parseAmount('2.5'), { amount: 2.5, unit: null });
  assert.equal(parseAmount('a lot'), null);
  const csv = parseCSV('a;b\n"x,y";"say ""hi"""');
  assert.deepEqual(csv.headers, ['a', 'b']);
  assert.deepEqual(csv.rows, [{ a: 'x,y', b: 'say "hi"' }]);
});

test('describeConversion reads like a sentence', () => {
  const conv = convertForeignText(NARA, { now: NOW, fallbackTimeZone: TZ });
  assert.equal(describeConversion(conv.report), '2 feeds, 2 pumps, 1 sleep, 1 diaper');
});
