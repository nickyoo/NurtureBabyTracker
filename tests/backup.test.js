// core/backup.js — the pure trust boundary: validateBackup (schema, hostile
// input), planBabyMerge / mergeBackup (newest wins, ties, babies), CSV.
// Export/import/share against IndexedDB + downloads: tests/e2e/core.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBackup, mergeBackup, planBabyMerge, detectFormat, buildCsv, csvCell, bytesToBase64, base64ToBytes,
  BACKUP_APP, BACKUP_SCHEMA, MAX_RECORDS, V1_IMPORT_BABY_ID, BackupError,
} from '../js/core/backup.js';
import { LIMITS } from '../js/core/store.js';
import { pickUseNext, latestThawAt } from '../js/domain/inventory.js';

const HOUR = 3600 * 1000;
const NOW = new Date('2026-10-15T12:00:00').getTime();
const CLARA = 'baby_clara1';
const MAX = 'baby_max1';
const XSS = '<img src=x onerror=alert(1)>';

const babies = [{ id: CLARA, name: 'Clara', birthDate: '2026-08-01', photoId: null, createdAt: NOW - 1000 }];
const feed = (over = {}) => ({ id: 'evt_f1', type: 'feed', startTime: NOW - HOUR, endTime: NOW - HOUR + 600000, note: '', data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, babyId: CLARA, createdAt: NOW - HOUR, updatedAt: NOW - HOUR, ...over });
const pouch = (over = {}) => ({ id: 'inv_1', pumpedAt: NOW - 24 * HOUR, quantity: 120, unit: 'mL', location: 'freezer', expiresAt: NOW + 100 * 24 * HOUR, status: 'active', notes: '', createdAt: NOW - 24 * HOUR, ...over });
const v2 = (over = {}) => ({ app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: new Date(NOW).toISOString(), events: [feed()], inventory: [pouch()], settings: { babies, activeBabyId: CLARA, units: 'mL' }, ...over });

// ------------------------------------------------------------ format ----

test('detectFormat: v2, v1, newer, junk', () => {
  assert.equal(detectFormat(v2()), 'v2');
  assert.equal(detectFormat({ app: 'nurture', schema: '2' }), 'v2', 'numeric string schema');
  assert.equal(detectFormat({ app: 'nurture', schema: 3 }), 'newer');
  assert.equal(detectFormat({ app: 'nurture', schema: 1 }), null);
  assert.equal(detectFormat({ app: 'other', schema: 2 }), null);
  assert.equal(detectFormat({ version: 1, sessions: [] }), 'v1');
  assert.equal(detectFormat({ version: 1 }), null, 'v1 needs at least one collection');
  for (const junk of [null, undefined, 42, 'nurture', [], [v2()], {}]) assert.equal(detectFormat(junk), null);
});

test('validateBackup: friendly errors, never throws on hostile input', () => {
  assert.match(validateBackup({ app: 'nurture', schema: 9 }).error, /newer version/);
  assert.match(validateBackup({ hello: 'world' }).error, /isn’t a Nurture backup/);
  for (const junk of [null, undefined, 0, '', 'x'.repeat(1e6), [], [[]], () => {}, Symbol('x'), new Date()]) {
    assert.equal(validateBackup(junk).ok, false);
  }
  const weird = validateBackup({ app: 'nurture', schema: 2, events: 'lots', inventory: { length: 1e9 }, photos: 5 });
  assert.equal(weird.ok, true, 'non-list collections are skipped, not fatal');
  // A non-list photos field is "no photos" (null), never "zero photos" (a
  // replace import would wipe the journal) — and all three are damaged.
  assert.deepEqual([weird.data.events, weird.data.inventory, weird.data.photos], [[], [], null]);
  assert.deepEqual(weird.damaged, ['events', 'inventory', 'photos']);
  assert.ok(weird.warnings.length >= 2);
});

test('validateBackup: a clean v2 file round-trips with no rejections', () => {
  const v = validateBackup(JSON.parse(JSON.stringify(v2())), { now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.format, 'v2');
  assert.deepEqual(v.stats.events, { accepted: 1, rejected: 0 });
  assert.deepEqual(v.stats.inventory, { accepted: 1, rejected: 0 });
  assert.deepEqual(v.data.events[0], feed());
  assert.equal(v.data.inventory[0].quantity, 120);
  assert.deepEqual(v.data.settings, { babies, activeBabyId: CLARA, units: 'mL' });
  assert.equal(v.data.photos, null, 'no photos key → null (replace keeps local photos)');
});

test('validateBackup: unknown types / bad ids / bad times rejected and counted', () => {
  const events = [
    feed({ id: 'evt_ok' }),
    feed({ id: 'evt_t', type: 'telemetry' }),
    feed({ id: 'evt_bf', type: 'breastfeed' }),
    feed({ id: XSS }),
    feed({ id: 'evt_time', startTime: 'yesterday' }),
    feed({ id: 'evt_old', startTime: 1 }),
    null, 42, 'evt', [],
  ];
  const v = validateBackup(v2({ events }), { now: NOW });
  assert.deepEqual(v.stats.events, { accepted: 1, rejected: 9 });
  assert.equal(v.data.events[0].id, 'evt_ok');
});

test('validateBackup: hostile strings are inert, capped, stripped of control chars', () => {
  const big = 'A'.repeat(10 * 1024 * 1024);
  const events = [
    feed({ id: 'evt_xss', note: XSS }),
    feed({ id: 'evt_big', note: big }),
    feed({ id: 'evt_ms', type: 'milestone', data: { title: big, key: XSS, photoIds: [XSS, 'pho_1'] } }),
    feed({ id: 'evt_ctl', note: 'a\u0000b\u001bc' }),
    feed({ id: 'evt_diaper', type: 'diaper', data: { kind: 'dirty', color: big, consistency: XSS } }),
  ];
  const t0 = Date.now();
  const v = validateBackup(v2({ events, inventory: [pouch({ notes: big })], settings: { babies: [{ ...babies[0], name: big }], parentName: big } }), { now: NOW });
  assert.ok(Date.now() - t0 < 2000, 'megabyte strings are cheap to neutralise');
  const by = id => v.data.events.find(e => e.id === id);
  assert.equal(by('evt_xss').note, XSS, 'kept as plain text; html`` escapes on render');
  assert.equal(by('evt_big').note.length, LIMITS.note);
  assert.equal(by('evt_ms').data.title.length, LIMITS.title);
  assert.equal(by('evt_ms').data.key, null);
  assert.deepEqual(by('evt_ms').data.photoIds, ['pho_1']);
  assert.equal(by('evt_ctl').note, 'abc');
  assert.equal(by('evt_diaper').data.color.length, LIMITS.short);
  assert.equal(v.data.inventory[0].notes.length, 2000);
  assert.equal(v.data.settings.babies[0].name.length, 100);
  assert.equal(v.data.settings.parentName.length, 100);
});

test('validateBackup: __proto__ / constructor / prototype keys never survive', () => {
  const text = `{"app":"nurture","schema":2,"__proto__":{"polluted":"top"},
    "constructor":{"prototype":{"polluted":"ctor"}},
    "events":[{"id":"evt_p","type":"diaper","startTime":${NOW},"data":{"kind":"wet","__proto__":{"polluted":"data"}},"__proto__":{"polluted":"ev"},"prototype":{"x":1}}],
    "inventory":[{"id":"inv_p","pumpedAt":${NOW},"quantity":4,"location":"fridge","__proto__":{"polluted":"inv"}}],
    "settings":{"__proto__":{"polluted":"set"},"constructor":{"x":1},"trackers":{"__proto__":{"polluted":"trk"},"pump":false},"units":"oz"}}`;
  const v = validateBackup(JSON.parse(text), { now: NOW });
  assert.equal(v.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const e = v.data.events[0];
  for (const o of [e, e.data, v.data.inventory[0], v.data.settings, v.data.settings.trackers]) {
    assert.equal(Object.getPrototypeOf(o), Object.prototype);
    assert.ok(!Object.prototype.hasOwnProperty.call(o, '__proto__'));
    assert.ok(!Object.prototype.hasOwnProperty.call(o, 'constructor'));
    assert.ok(!Object.prototype.hasOwnProperty.call(o, 'prototype'));
  }
  assert.ok(v.stats.settings.rejected.includes('__proto__') && v.stats.settings.rejected.includes('constructor'));
  assert.equal(v.data.settings.trackers.pump, false);
});

test('validateBackup: wrong types coerced or rejected per field', () => {
  const events = [
    feed({ id: 'evt_str', startTime: String(NOW), data: { method: 'bottle', amount: '4.5', unit: 'ML', milk: 7 } }),
    feed({ id: 'evt_bool', data: { amount: true } }),
    feed({ id: 'evt_inf', data: { amount: '1e400' } }),
    feed({ id: 'evt_obj', data: { amount: { valueOf: () => 4 } } }),
    feed({ id: 'evt_neg', endTime: NOW - 10 * HOUR }), // end before start → clamped for imports
    feed({ id: 'evt_arr', data: ['bottle'] }),
  ];
  const v = validateBackup(v2({ events }), { now: NOW });
  const by = id => v.data.events.find(e => e.id === id);
  assert.deepEqual(by('evt_str').data, { method: 'bottle', milk: 'breastmilk', amount: 4.5, unit: 'mL' });
  assert.equal(by('evt_str').startTime, NOW);
  assert.equal(by('evt_bool').data.amount, null);
  assert.equal(by('evt_inf').data.amount, null);
  assert.equal(by('evt_obj').data.amount, null);
  assert.equal(by('evt_neg').endTime, by('evt_neg').startTime);
  assert.equal(by('evt_arr').data.method, 'bottle');
  const inv = validateBackup(v2({ inventory: [pouch({ quantity: '4', unit: 'cups' }), pouch({ id: 'inv_nan', quantity: 'NaN' }), pouch({ id: 'inv_loc', location: 'garage' }), pouch({ id: 'inv_status', status: 'hacked' })] }));
  assert.deepEqual(inv.data.inventory.map(i => [i.id, i.quantity, i.unit, i.status]), [['inv_1', 4, 'oz', 'active'], ['inv_status', 120, 'mL', 'active']]);
  assert.equal(inv.stats.inventory.rejected, 2);
});

test('validateBackup: settings whitelist — per-install keys never imported', () => {
  const v = validateBackup(v2({ settings: { units: 'cups', theme: 'dark', deviceId: 'dev_attacker1', migratedV2: false, lastBackupAt: NOW, persistGranted: true, iconDataUrl: 'data:image/png;base64,AAAA', feedbackEmail: 'evil@x.com', pumpGoalOz: '30' } }));
  assert.deepEqual(v.data.settings, { theme: 'dark', pumpGoalOz: 30 });
  assert.deepEqual(v.stats.settings.rejected.sort(), ['deviceId', 'feedbackEmail', 'iconDataUrl', 'lastBackupAt', 'migratedV2', 'persistGranted', 'units'].sort());
});

test('validateBackup: babyId handling (multiple babies)', () => {
  const events = [
    feed({ id: 'evt_none', babyId: undefined }),
    feed({ id: 'evt_bad', babyId: XSS }),
    feed({ id: 'evt_max', babyId: MAX }),
    { id: 'evt_pump', type: 'pump', startTime: NOW, babyId: CLARA, data: { amount: 3, unit: 'oz' } },
  ];
  const v = validateBackup(v2({ events }), { now: NOW });
  const by = id => v.data.events.find(e => e.id === id);
  assert.equal(by('evt_none').babyId, CLARA, 'missing → the file\'s first baby');
  assert.equal(by('evt_bad').babyId, CLARA, 'hostile → the file\'s first baby');
  assert.equal(by('evt_max').babyId, MAX, 'unknown-but-valid ids are kept (merge adds a placeholder)');
  assert.equal(by('evt_pump').babyId, null, 'pumps are parent-level');
  const noBabies = validateBackup(v2({ events: [feed({ babyId: undefined })], settings: {} }), { defaultBabyId: 'baby_local1' });
  assert.equal(noBabies.data.events[0].babyId, 'baby_local1', 'falls back to this device\'s baby');
  const stale = validateBackup(v2({ settings: { babies, activeBabyId: 'baby_ghost' } }));
  assert.ok(!('activeBabyId' in stale.data.settings), 'activeBabyId must name one of the file\'s babies');
  assert.ok(stale.stats.settings.rejected.includes('activeBabyId'));
});

test('validateBackup: v1 backups go through the migration', () => {
  const v1 = {
    version: 1, exportedAt: '2026-01-01T00:00:00Z',
    sessions: [
      { id: 'pump_a', type: 'pump', startTime: NOW - 5 * HOUR, endTime: NOW - 5 * HOUR + 1200000, durationSec: 1200, outputQty: 4, unit: 'oz', notes: '' },
      { id: 'pump_nan', type: 'pump', startTime: NOW - 4 * HOUR, endTime: NOW - 4 * HOUR + 60000, outputQty: null, unit: 'mL', notes: '' },
      { id: 'sess_f', type: 'feed', feedType: 'formula', startTime: NOW - 3 * HOUR, durationSec: 0, outputQty: 120, unit: 'mL', notes: 'Formula Feeding' },
      { id: 'bot_x', type: 'bottle', startTime: NOW },
    ],
    inventory: [pouch()],
    bottles: [{ id: 'bot_1' }],
    settings: [{ key: 'babyName', value: 'Clara' }, { key: 'units', value: 'mL' }, { key: 'dailyPumpingGoal', value: 99 }],
  };
  const v = validateBackup(JSON.parse(JSON.stringify(v1)), { now: NOW, defaultBabyId: CLARA });
  assert.equal(v.format, 'v1');
  assert.deepEqual(v.stats.events, { accepted: 3, rejected: 1 });
  const by = id => v.data.events.find(e => e.id === id);
  assert.equal(by('evt_pump_nan').data.amount, null);
  assert.equal(by('evt_pump_nan').babyId, null);
  assert.equal(by('evt_sess_f').babyId, CLARA);
  assert.equal(by('evt_sess_f').note, '');
  assert.deepEqual(v.data.settings.babies, [{ id: CLARA, name: 'Clara', birthDate: null, photoId: null, createdAt: NOW }]);
  assert.equal(v.data.settings.units, 'mL');
  assert.ok(!('dailyPumpingGoal' in v.data.settings));
  assert.equal(v.data.photos, null);
  assert.ok(v.warnings.some(w => /prepared-bottle/.test(w)));
  const anon = validateBackup({ version: 1, sessions: [v1.sessions[2]] }, { now: NOW });
  assert.equal(anon.data.events[0].babyId, V1_IMPORT_BABY_ID, 'deterministic baby when the caller has none');
  assert.deepEqual(anon.data.settings.babies.map(b => b.id), [V1_IMPORT_BABY_ID]);
});

test('validateBackup: in-file duplicates keep the newest; record caps enforced', () => {
  const v = validateBackup(v2({ events: [feed({ note: 'old', updatedAt: NOW - 10 }), feed({ note: 'new', updatedAt: NOW }), feed({ note: 'older', updatedAt: NOW - 20 })] }));
  assert.equal(v.data.events.length, 1);
  assert.equal(v.data.events[0].note, 'new');
  const invDup = validateBackup(v2({ inventory: [pouch({ status: 'used', usedAt: NOW }), pouch()] }));
  assert.equal(invDup.data.inventory[0].status, 'used', 'pouches without updatedAt compare by their latest timestamp');
  const many = Array.from({ length: MAX_RECORDS.inventory + 5 }, (_, i) => pouch({ id: `inv_${i}` }));
  const capped = validateBackup(v2({ inventory: many }));
  assert.equal(capped.data.inventory.length, MAX_RECORDS.inventory);
  assert.equal(capped.stats.inventory.rejected, 5);
  assert.ok(capped.warnings.some(w => /Only the first/.test(w)));
});

test('validateBackup: photos entries checked (id, base64, dimensions, type)', () => {
  const good = { id: 'pho_1', type: 'image/jpeg', width: 400, height: 300, createdAt: NOW, data: bytesToBase64(new Uint8Array([255, 216, 255, 224])) };
  const photos = [
    good,
    { ...good, id: 'pho_2', type: 'text/html' },
    { ...good, id: XSS },
    { ...good, id: 'pho_3', data: 'not base64!' },
    { ...good, id: 'pho_4', data: 'abc' }, // length not a multiple of 4
    { ...good, id: 'pho_5', width: 0 },
    { ...good, id: 'pho_6', height: 1e9 },
    { ...good, id: 'pho_7', data: '' },
  ];
  const v = validateBackup(v2({ photos }));
  assert.deepEqual(v.data.photos.map(p => [p.id, p.type]), [['pho_1', 'image/jpeg'], ['pho_2', 'image/jpeg']]);
  assert.deepEqual(v.stats.photos, { accepted: 2, rejected: 6 });
  assert.deepEqual(Object.keys(v.data.photos[0]).sort(), ['createdAt', 'data', 'height', 'id', 'type', 'width']);
});

test('base64 helpers round-trip large binary data', () => {
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
  const b64 = bytesToBase64(bytes);
  assert.equal(b64, Buffer.from(bytes).toString('base64'));
  assert.deepEqual(base64ToBytes(b64), bytes);
  assert.equal(bytesToBase64(new Uint8Array()), '');
});

// ------------------------------------------------------------- merge ----

test('mergeBackup: by id; newer updatedAt wins; tie keeps local (no write)', () => {
  const local = [feed({ id: 'evt_a', note: 'local', updatedAt: 100 }), feed({ id: 'evt_b', note: 'local', updatedAt: 200 }), feed({ id: 'evt_c', note: 'local', updatedAt: 300 })];
  const incoming = [feed({ id: 'evt_a', note: 'incoming', updatedAt: 150 }), feed({ id: 'evt_b', note: 'incoming', updatedAt: 200 }), feed({ id: 'evt_c', note: 'incoming', updatedAt: 250 }), feed({ id: 'evt_d', note: 'new' })];
  const { toPut, stats } = mergeBackup({ events: local, babies }, { events: incoming, babies });
  assert.deepEqual(toPut.events.map(e => [e.id, e.note]), [['evt_a', 'incoming'], ['evt_d', 'new']]);
  assert.deepEqual(stats.events, { added: 1, updated: 1, unchanged: 2, stoppedRunning: 0 });
  assert.equal(toPut.babies, null, 'same babies → nothing to write');
});

test('mergeBackup: missing updatedAt counts as 0 (never beats a real edit)', () => {
  const { toPut } = mergeBackup({ events: [feed({ updatedAt: 5 })], babies }, { events: [feed({ updatedAt: undefined, note: 'x' })], babies });
  assert.deepEqual(toPut.events, []);
});

test('mergeBackup: inventory newest wins, v1 pouches compared by their latest timestamp', () => {
  const local = [pouch({ id: 'inv_a', status: 'active' }), pouch({ id: 'inv_b', status: 'used', usedAt: NOW, updatedAt: NOW })];
  const incoming = [pouch({ id: 'inv_a', status: 'used', usedAt: NOW - 1000 }), pouch({ id: 'inv_b', status: 'active', updatedAt: NOW - 5 }), pouch({ id: 'inv_c' })];
  const { toPut, stats } = mergeBackup({ inventory: local }, { inventory: incoming });
  assert.deepEqual(toPut.inventory.map(i => [i.id, i.status]), [['inv_a', 'used'], ['inv_c', 'active']]);
  assert.deepEqual(stats.inventory, { added: 1, updated: 1, unchanged: 1 });
});

test('mergeBackup: photos are immutable — added if missing, never overwritten', () => {
  const { toPut, stats } = mergeBackup({ photoIds: ['pho_1'] }, { photos: [{ id: 'pho_1' }, { id: 'pho_2' }, { id: 'pho_2' }] });
  assert.deepEqual(toPut.photos.map(p => p.id), ['pho_2']);
  assert.deepEqual(stats.photos, { added: 1, unchanged: 2 });
});

test('mergeBackup: one running activity per type per baby survives a merge', () => {
  const localNap = feed({ id: 'evt_nap_local', type: 'sleep', endTime: null, data: { kind: 'nap' } });
  const incomingNap = feed({ id: 'evt_nap_in', type: 'sleep', startTime: NOW - 2 * HOUR, endTime: null, data: { kind: 'nap' } });
  const twinNap = feed({ id: 'evt_nap_max', type: 'sleep', endTime: null, babyId: MAX, data: { kind: 'nap' } });
  const both = [...babies, { id: MAX, name: 'Max', birthDate: null, photoId: null, createdAt: null }];
  const { toPut, stats } = mergeBackup({ events: [localNap], babies: both }, { events: [incomingNap, twinNap], babies: both });
  const nap = toPut.events.find(e => e.id === 'evt_nap_in');
  assert.equal(nap.endTime, nap.startTime, 'second running nap for Clara stopped at its start');
  assert.equal(toPut.events.find(e => e.id === 'evt_nap_max').endTime, null, 'Max can nap at the same time');
  assert.equal(stats.events.stoppedRunning, 1);
  // The newer copy of the local running nap FINISHED it on the other phone →
  // the slot frees up for an incoming running nap.
  const finished = { ...localNap, endTime: NOW, updatedAt: NOW + 1 };
  const freshNap = feed({ id: 'evt_nap_new', type: 'sleep', startTime: NOW - 60000, endTime: null, data: { kind: 'nap' } });
  const r2 = mergeBackup({ events: [localNap], babies }, { events: [finished, freshNap], babies });
  assert.equal(r2.toPut.events.find(e => e.id === 'evt_nap_new').endTime, null);
  assert.equal(r2.stats.events.stoppedRunning, 0);
});

test('planBabyMerge: id → name → only-child matching, local wins, gaps filled', () => {
  const local = [{ id: CLARA, name: 'Clara', birthDate: null, photoId: null, createdAt: 1 }];
  const sameId = planBabyMerge(local, [{ id: CLARA, name: 'Clara B', birthDate: '2026-08-01', photoId: 'pho_1', createdAt: 2 }]);
  assert.deepEqual(sameId.babies, [{ id: CLARA, name: 'Clara', birthDate: '2026-08-01', photoId: 'pho_1', createdAt: 1 }], 'local name wins; empty fields filled');
  assert.equal(sameId.remap.size, 0);

  const byName = planBabyMerge(local, [{ id: 'baby_other', name: ' CLARA ', birthDate: null }]);
  assert.deepEqual([byName.babies.length, byName.remap.get('baby_other')], [1, CLARA], 'case/space-insensitive name match');

  const onlyChild = planBabyMerge([{ id: 'baby_auto', name: '' }], [{ id: 'baby_theirs', name: 'Clara' }]);
  assert.deepEqual(onlyChild.babies.map(b => [b.id, b.name]), [['baby_auto', 'Clara']], 'one each, one unnamed → same child');
  assert.equal(onlyChild.remap.get('baby_theirs'), 'baby_auto');

  const differentKids = planBabyMerge(local, [{ id: 'baby_x', name: 'Max' }]);
  assert.deepEqual(differentKids.babies.map(b => b.name), ['Clara', 'Max'], 'both named, different → sibling added');
  assert.deepEqual(differentKids.stats, { added: 1, matched: 0 });

  const twins = planBabyMerge([{ id: 'baby_a', name: 'Ava' }, { id: 'baby_b', name: 'Bea' }], [{ id: 'baby_1', name: 'bea' }, { id: 'baby_2', name: 'ava' }]);
  assert.deepEqual([twins.remap.get('baby_1'), twins.remap.get('baby_2'), twins.babies.length], ['baby_b', 'baby_a', 2]);

  const dupNames = planBabyMerge([{ id: 'baby_a', name: 'Sam' }], [{ id: 'baby_1', name: 'Sam' }, { id: 'baby_2', name: 'Sam' }]);
  assert.equal(dupNames.babies.length, 2, 'a local baby is claimed once');
  assert.deepEqual(planBabyMerge(undefined, undefined).babies, []);
});

test('mergeBackup: events remapped to the local baby; orphan ids get a placeholder baby', () => {
  const local = [{ id: CLARA, name: 'Clara', birthDate: null, photoId: null, createdAt: 1 }];
  const incomingBabies = [{ id: 'baby_theirs', name: 'clara', birthDate: '2026-08-01', photoId: null, createdAt: 2 }];
  const events = [feed({ id: 'evt_1', babyId: 'baby_theirs' }), feed({ id: 'evt_2', babyId: 'baby_orphan' }), { id: 'evt_p', type: 'pump', startTime: NOW, endTime: NOW, babyId: null, data: {} }];
  const { toPut, stats } = mergeBackup({ events: [], babies: local }, { events, babies: incomingBabies });
  assert.deepEqual(toPut.events.map(e => [e.id, e.babyId]), [['evt_1', CLARA], ['evt_2', 'baby_orphan'], ['evt_p', null]]);
  assert.deepEqual(toPut.babies.map(b => [b.id, b.name, b.birthDate]), [[CLARA, 'Clara', '2026-08-01'], ['baby_orphan', '', null]]);
  assert.deepEqual(stats.babies, { added: 0, matched: 1, placeholders: 1 });
});

test('mergeBackup is pure: inputs are not mutated', () => {
  const existing = { events: [feed({ updatedAt: 1 })], babies: [{ id: 'baby_auto', name: '' }] };
  const incoming = { events: [feed({ updatedAt: 2, babyId: 'baby_t' })], babies: [{ id: 'baby_t', name: 'Clara' }] };
  const snapshot = JSON.stringify([existing, incoming]);
  mergeBackup(existing, incoming);
  assert.equal(JSON.stringify([existing, incoming]), snapshot);
  assert.deepEqual(mergeBackup().toPut, { events: [], inventory: [], photos: [], babies: null });
});

// --------------------------------------------------------------- CSV ----

test('csvCell: quotes doubled, formula injection neutralised', () => {
  assert.equal(csvCell('plain'), '"plain"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  for (const lead of ['+', '-', '@', '\t', '\r']) assert.ok(csvCell(`${lead}1`).startsWith(`"'`), JSON.stringify(lead));
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(4.5), '"4.5"');
  assert.equal(csvCell('a,b\nc'), '"a,b\nc"', 'commas/newlines safe inside quotes');
  assert.equal(csvCell(XSS), `"${XSS}"`, 'a CSV is not HTML — kept verbatim');
});

test('buildCsv: every type, oldest first, local times, one unit, baby names', () => {
  const at = (h, m = 0) => new Date(2026, 9, 14, h, m).getTime();
  const events = [
    { id: 'e4', type: 'diaper', startTime: at(10), endTime: at(10), note: '', data: { kind: 'both', color: 'yellow' }, babyId: CLARA },
    { id: 'e1', type: 'pump', startTime: at(7), endTime: at(7, 20), note: 'am', data: { amount: 4, unit: 'oz', storedTo: 'deepFreezer' }, babyId: null },
    { id: 'e2', type: 'feed', startTime: at(8), endTime: at(8, 15), note: '', data: { method: 'bottle', milk: 'formula', amount: 120, unit: 'mL' }, babyId: CLARA },
    { id: 'e3', type: 'feed', startTime: at(9), endTime: at(9, 20), note: '', data: { method: 'breast', left: 600, right: 330, lastSide: 'right', activeSide: null }, babyId: MAX },
    { id: 'e5', type: 'sleep', startTime: at(11), endTime: null, note: '', data: { kind: 'nap' }, babyId: CLARA },
    { id: 'e6', type: 'milestone', startTime: at(12), endTime: at(12), note: '=1+1', data: { title: 'First smile', photoIds: [] }, babyId: CLARA },
    { id: 'e7', type: 'pump', startTime: at(13), endTime: at(13, 10), note: '', data: { amount: null, unit: 'oz' }, babyId: null },
    { id: 'bad', type: 'telemetry', startTime: at(1) },
    null,
  ];
  const csv = buildCsv(events, { unit: 'oz', now: at(11, 30), babies: [{ id: CLARA, name: 'Clara' }, { id: MAX, name: '' }] });
  assert.ok(csv.startsWith('﻿'), 'BOM so Excel reads UTF-8');
  assert.ok(csv.endsWith('\r\n'));
  const rows = csv.slice(1).trim().split('\r\n');
  assert.equal(rows.length, 8, 'header + 7 events (junk skipped)');
  assert.equal(rows[0], '"Date","Start","End","Duration (min)","Baby","Type","Details","Amount","Unit","Left (min)","Right (min)","Note"');
  assert.equal(rows[1], '"2026-10-14","07:00","07:20","20","","Pump","Stored to deep freezer","4","oz","","","am"');
  assert.equal(rows[2], '"2026-10-14","08:00","08:15","15","Clara","Feed","Bottle · Formula","4.1","oz","","",""');
  assert.equal(rows[3], '"2026-10-14","09:00","09:20","20","Baby","Feed","Breastfeeding","","","10","5.5",""');
  assert.equal(rows[4], '"2026-10-14","10:00","10:00","","Clara","Diaper","Wet + dirty · yellow","","","","",""');
  assert.equal(rows[5], '"2026-10-14","11:00","","","Clara","Sleep","Nap (in progress)","","","","",""');
  assert.equal(rows[6], `"2026-10-14","12:00","12:00","","Clara","Milestone","First smile","","","","","'=1+1"`);
  assert.equal(rows[7], '"2026-10-14","13:00","13:10","10","","Pump","","","","","",""', 'missing amount → blank, not 0');
  const ml = buildCsv([events[1]], { unit: 'mL' });
  assert.ok(ml.includes('"118","mL"'));
  assert.equal(buildCsv([]).slice(1).trim().split('\r\n').length, 1, 'header only');
});

test('BackupError is a friendly, named error', () => {
  const e = new BackupError('nope');
  assert.ok(e instanceof Error);
  assert.deepEqual([e.name, e.message], ['BackupError', 'nope']);
});

// ---------------------------------------------------- regressions (R1) ---

const DAY = 24 * HOUR;
const goodPhoto = (over = {}) => ({ id: 'pho_1', type: 'image/jpeg', width: 4, height: 3, createdAt: NOW, data: bytesToBase64(new Uint8Array([255, 216, 255, 224])), ...over });

test('regression: a malformed or fully-rejected collection is "damaged"; such photos are null (replace keeps the journal)', () => {
  const malformed = validateBackup(v2({ photos: 5 }), { now: NOW });
  assert.equal(malformed.data.photos, null, 'photos: 5');
  assert.deepEqual(malformed.collections.photos, { present: false, malformed: true });
  assert.deepEqual(malformed.damaged, ['photos']);
  const allBad = validateBackup(v2({ photos: [goodPhoto({ data: '!!' }), goodPhoto({ id: XSS })] }), { now: NOW });
  assert.equal(allBad.data.photos, null, 'every photo rejected');
  assert.deepEqual(allBad.damaged, ['photos']);
  const events = validateBackup(v2({ events: 'oops', inventory: {} }), { now: NOW });
  assert.deepEqual(events.damaged, ['events', 'inventory']);
  assert.deepEqual([events.collections.events, events.collections.inventory], [{ present: false, malformed: true }, { present: false, malformed: true }]);
  const rejected = validateBackup(v2({ events: [{ id: 'evt_x', type: 'telemetry', startTime: NOW }], inventory: [pouch({ location: 'garage' })] }), { now: NOW });
  assert.deepEqual(rejected.damaged, ['events', 'inventory'], 'entries present, none usable');
  // Healthy files: nothing damaged; an explicit empty list is a real (empty) list.
  const clean = validateBackup(v2({ photos: [goodPhoto()] }), { now: NOW });
  assert.deepEqual([clean.damaged, clean.data.photos.length], [[], 1]);
  const empty = validateBackup(v2({ events: [], inventory: [], photos: [] }), { now: NOW });
  assert.deepEqual([empty.damaged, empty.data.photos, empty.collections.events.present], [[], [], true]);
  const absent = validateBackup({ app: BACKUP_APP, schema: BACKUP_SCHEMA, settings: { babies } }, { now: NOW });
  assert.deepEqual([absent.damaged, absent.data.photos, absent.collections.events.present, absent.collections.inventory.present], [[], null, false, false]);
  const partial = validateBackup(v2({ events: [feed(), { id: 'evt_x', type: 'telemetry', startTime: NOW }] }), { now: NOW });
  assert.deepEqual(partial.damaged, [], 'some entries usable → not damaged (just warned)');
});

test('regression: an imported pouch can never expire later than the longest allowed storage window', () => {
  const spoiled = pouch({ id: 'inv_evil', pumpedAt: NOW - 30 * DAY, location: 'fridge', expiresAt: Date.UTC(2099, 0, 1), status: 'active' });
  const v = validateBackup(v2({ inventory: [spoiled] }), { now: NOW });
  const p = v.data.inventory[0];
  assert.equal(p.expiresAt, spoiled.pumpedAt + 14 * DAY, 'capped at fridge max (14 d)');
  assert.ok(p.expiresAt < NOW, '30-day-old fridge milk reads expired');
  const room = validateBackup(v2({ inventory: [pouch({ location: 'room', pumpedAt: NOW - HOUR, expiresAt: NOW + 30 * DAY })] }), { now: NOW }).data.inventory[0];
  assert.equal(room.expiresAt, NOW - HOUR + 24 * HOUR, 'room max 24 h');
  const thawed = validateBackup(v2({ inventory: [pouch({ location: 'thawed', pumpedAt: NOW - 90 * DAY, thawedAt: NOW - HOUR, expiresAt: NOW + 30 * DAY })] }), { now: NOW }).data.inventory[0];
  assert.equal(thawed.expiresAt, NOW - HOUR + 72 * HOUR, 'thawed max = thawedAt + 72 h');
  // A legit freezer pouch (6-month window) is untouched.
  const ok = validateBackup(v2(), { now: NOW }).data.inventory[0];
  assert.equal(ok.expiresAt, pouch().expiresAt);
});

test('regression: future timestamps in a file are rejected (start) or replaced (stamps) for events, pouches and photos', () => {
  const latest = NOW + 24 * HOUR;
  const v = validateBackup(v2({
    events: [
      { id: 'evt_future', type: 'sleep', startTime: Date.UTC(2090, 0, 1), endTime: null, babyId: CLARA, updatedAt: Date.UTC(2099, 0, 1) },
      feed({ id: 'evt_copy', note: 'overwritten', updatedAt: Date.UTC(2099, 0, 1), createdAt: Date.UTC(2099, 0, 1) }),
    ],
    inventory: [
      pouch({ id: 'inv_future', pumpedAt: Date.UTC(2090, 0, 1), expiresAt: Date.UTC(2091, 0, 1) }),
      pouch({ id: 'inv_thawfuture', location: 'thawed', thawedAt: Date.UTC(2099, 0, 1), expiresAt: Date.UTC(2099, 0, 1) }),
      pouch({ id: 'inv_stamp', status: 'used', updatedAt: Date.UTC(2099, 0, 1), createdAt: Date.UTC(2099, 0, 1), usedAt: Date.UTC(2099, 0, 1) }),
    ],
    photos: [goodPhoto({ createdAt: Date.UTC(2099, 0, 1) })],
  }), { now: NOW });
  assert.deepEqual(v.data.events.map(e => e.id), ['evt_copy'], 'running sleep in 2090 rejected');
  const copy = v.data.events[0];
  assert.deepEqual([copy.createdAt, copy.updatedAt], [copy.startTime, copy.endTime], 'far-future stamps replaced by the event\'s own times');
  assert.deepEqual(v.data.inventory.map(i => i.id), ['inv_stamp'], 'pouches pumped / thawed in the future rejected');
  const st = v.data.inventory[0];
  assert.deepEqual([st.createdAt, 'updatedAt' in st, 'usedAt' in st], [st.pumpedAt, false, false], 'far-future stamps fall back / dropped');
  assert.equal(v.data.photos[0].createdAt, latest);
  // Deterministic: re-validating the same file days later gives the same stamps,
  // so the copy can't keep winning newest-wins merges against real edits.
  const again = validateBackup(v2({ events: [feed({ id: 'evt_copy', updatedAt: Date.UTC(2099, 0, 1), createdAt: Date.UTC(2099, 0, 1) })] }), { now: NOW + 5 * DAY });
  assert.equal(again.data.events[0].updatedAt, copy.updatedAt);
  const edited = { ...feed({ id: 'evt_copy' }), note: 'my real edit', updatedAt: NOW };
  const { stats } = mergeBackup({ events: [edited], babies }, { events: again.data.events, babies });
  assert.deepEqual([stats.events.updated, stats.events.unchanged], [0, 1], 'the real edit wins');
});

// ---------------------------------------------------- regressions (R2) ---

test('regression (R2): a thawed pouch can\'t carry a fresh thawedAt on years-old milk', () => {
  const pumpedAt = Date.UTC(2021, 0, 1);
  const ancient = pouch({ id: 'inv_ancient', pumpedAt, quantity: 4, unit: 'oz', location: 'thawed', thawedAt: NOW - HOUR, expiresAt: NOW + 2 * DAY, createdAt: pumpedAt });
  const v = validateBackup(v2({ inventory: [ancient] }), { now: NOW });
  const p = v.data.inventory[0];
  assert.equal(p.id, 'inv_ancient', 'kept: it is still the family\'s record');
  assert.ok(!('thawedAt' in p), 'a thaw after the longest frozen window ran out is not a real thaw');
  assert.ok(p.expiresAt <= latestThawAt(pumpedAt) + 72 * HOUR, 'never outlives pumped + longest frozen + longest thawed window');
  assert.ok(p.expiresAt < NOW, 'reads expired');
  assert.equal(pickUseNext([p], NOW), null, 'never offered as the next feed');
  // A thaw before the milk was pumped is dropped too; a real thaw is kept.
  const backwards = validateBackup(v2({ inventory: [pouch({ location: 'thawed', pumpedAt: NOW - 10 * DAY, thawedAt: NOW - 20 * DAY, expiresAt: NOW + HOUR })] }), { now: NOW }).data.inventory[0];
  assert.ok(!('thawedAt' in backwards));
  const real = validateBackup(v2({ inventory: [pouch({ location: 'thawed', pumpedAt: NOW - 90 * DAY, thawedAt: NOW - HOUR, expiresAt: NOW + 23 * HOUR })] }), { now: NOW }).data.inventory[0];
  assert.deepEqual([real.thawedAt, real.expiresAt], [NOW - HOUR, NOW + 23 * HOUR]);
});

test('regression (R2): numbers in a file are parsed in linear time (a 100 KB file can\'t freeze the import)', () => {
  const long = `${'1'.repeat(40000)}x`;
  let t0 = performance.now();
  const bad = validateBackup({ app: BACKUP_APP, schema: long, events: [] }, { now: NOW });
  assert.equal(bad.ok, false);
  assert.ok(performance.now() - t0 < 200, `schema: ${(performance.now() - t0).toFixed(0)} ms`);
  t0 = performance.now();
  const v = validateBackup(v2({
    events: Array.from({ length: 5 }, (_, i) => feed({ id: `evt_${i}`, startTime: `${'1'.repeat(20000)}x` })),
    inventory: Array.from({ length: 5 }, (_, i) => pouch({ id: `inv_${i}`, quantity: `${'9'.repeat(20000)}x` })),
  }), { now: NOW });
  assert.ok(performance.now() - t0 < 200, `records: ${(performance.now() - t0).toFixed(0)} ms`);
  assert.deepEqual([v.stats.events.rejected, v.stats.inventory.rejected], [5, 5]);
});
