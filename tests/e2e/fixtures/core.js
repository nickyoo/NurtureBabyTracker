// Browser-side tests for the v2 data layer against REAL IndexedDB.
// Driven by tests/e2e/core.mjs: each suite runs in a fresh browser context
// (empty IndexedDB + localStorage). Results land on window.__results.

const params = new URLSearchParams(location.search);
const suite = params.get('suite') || 'store';
const results = [];
const out = document.getElementById('out');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MIN = 60 * 1000;

function fail(msg) { throw new Error(msg); }
function ok(cond, msg) { if (!cond) fail(msg || 'assertion failed'); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${msg || 'not equal'}\n  actual:   ${a}\n  expected: ${e}`);
}
async function rejects(promise, check, msg) {
  try { await promise; } catch (err) {
    if (check && !check(err)) fail(`${msg || 'wrong error'}: ${err && err.name} ${err && err.message}`);
    return err;
  }
  fail(`${msg || 'expected rejection'}`);
  return null;
}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: String((err && err.stack) || err) });
  }
  out.textContent = results.map(r => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n${r.error}`}`).join('\n');
}

// ---------------------------------------------------------------- v1 seed

const NOW = Date.now();
const T1 = NOW - 2 * DAY;          // a pump two days ago
const T2 = NOW - DAY;              // an mL feed yesterday
const THAWED_ID = 'inv_thawed-1';

function rawOpen(version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('NurtureDB', version);
    if (upgrade) req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}
function rawTx(db, stores, mode, body) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    body(tx, v => { result = v; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Exactly the v1 schema from js/db.js (DB_VERSION 1).
function v1Schema(db) {
  const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
  sessions.createIndex('type', 'type', { unique: false });
  sessions.createIndex('startTime', 'startTime', { unique: false });
  sessions.createIndex('createdAt', 'createdAt', { unique: false });
  const inv = db.createObjectStore('inventory', { keyPath: 'id' });
  inv.createIndex('status', 'status', { unique: false });
  inv.createIndex('expiresAt', 'expiresAt', { unique: false });
  inv.createIndex('pumpedAt', 'pumpedAt', { unique: false });
  inv.createIndex('location', 'location', { unique: false });
  const bottles = db.createObjectStore('bottles', { keyPath: 'id' });
  bottles.createIndex('status', 'status', { unique: false });
  bottles.createIndex('expiresAt', 'expiresAt', { unique: false });
  db.createObjectStore('settings', { keyPath: 'key' });
}

const V1_SESSIONS = [
  { id: 'pump_aaa', type: 'pump', startTime: T1, endTime: T1 + 20 * MIN, durationSec: 1200, outputQty: 4.5, unit: 'oz', notes: 'morning', createdAt: T1 + 20 * MIN },
  // The v1.6 NaN bug: NaN stored as the amount.
  { id: 'pump_nan', type: 'pump', startTime: T1 + 3 * HOUR, endTime: T1 + 3 * HOUR + 15 * MIN, durationSec: 900, outputQty: NaN, unit: 'mL', notes: '', createdAt: T1 + 3 * HOUR },
  { id: 'pump_null', type: 'pump', startTime: T1 + 6 * HOUR, endTime: T1 + 6 * HOUR + 10 * MIN, durationSec: 600, outputQty: null, unit: 'oz', notes: 'left side only', createdAt: T1 + 6 * HOUR },
  // Bottle-timer feed in mL: stamped when logged, 15 min long, auto note.
  { id: 'sess_bbb', type: 'feed', feedType: 'breastmilk', startTime: T2, endTime: T2, durationSec: 900, outputQty: 120, unit: 'mL', notes: 'Bottle feed (120 mL prepared)', createdAt: T2 },
  { id: 'sess_ccc', type: 'feed', feedType: 'formula', startTime: T2 + 2 * HOUR, endTime: T2 + 2 * HOUR, durationSec: 0, outputQty: 4, unit: 'oz', notes: 'Formula Feeding', createdAt: T2 + 2 * HOUR },
  { id: 'sess_ddd', type: 'feed', feedType: 'breastmilk', startTime: T2 + 4 * HOUR, endTime: T2 + 4 * HOUR, durationSec: 0, outputQty: 3, unit: 'oz', notes: '<img src=x onerror=alert(1)>', createdAt: T2 + 4 * HOUR },
  { id: 'bot_zzz', type: 'bottle', startTime: T2, outputQty: 2 }, // not a session type v2 knows
];

const V1_INVENTORY = [
  { id: 'inv_frozen-1', pumpedAt: NOW - 30 * DAY, quantity: 5, unit: 'oz', location: 'freezer', expiresAt: NOW + 150 * DAY, status: 'active', notes: 'Pumped session (20:00)', createdAt: NOW - 30 * DAY },
  { id: THAWED_ID, pumpedAt: NOW - 40 * DAY, quantity: 4, unit: 'oz', location: 'thawed', thawedAt: NOW - 2 * HOUR, expiresAt: NOW + 22 * HOUR, status: 'active', notes: '', createdAt: NOW - 40 * DAY },
  { id: 'inv_fridge-old', pumpedAt: NOW - 6 * DAY, quantity: 90, unit: 'mL', location: 'fridge', expiresAt: NOW - 2 * DAY, status: 'active', notes: '', createdAt: NOW - 6 * DAY },
  { id: 'inv_used-1', pumpedAt: NOW - 10 * DAY, quantity: 3, unit: 'oz', location: 'fridge', expiresAt: NOW - 6 * DAY, status: 'used', usedAt: NOW - 8 * DAY, notes: '', createdAt: NOW - 10 * DAY },
];

const V1_SETTINGS = [
  ['dailyGoalOz', 26], ['pumpIntervalMinutes', 120], ['units', 'mL'], ['themeMode', 'dark'], ['soundEnabled', false],
  ['storageWindows', { roomTempHours: 4, fridgeDays: 3, freezerMonths: 6, deepFreezerMonths: 12, thawedBottleHours: 24, startedBottleHours: 2 }],
  ['parentName', 'Nick'], ['babyName', 'Clara'], ['onboarding_completed', true],
  // Junk keys v1 onboarding wrote by mistake (AUDIT F3) — must be ignored.
  ['dailyPumpingGoal', 30], ['reminderIntervalHours', 2], ['preferredUnit', 'oz'],
];

async function seedV1() {
  const db = await rawOpen(1, v1Schema);
  await rawTx(db, ['sessions', 'inventory', 'bottles', 'settings'], 'readwrite', (tx) => {
    for (const s of V1_SESSIONS) tx.objectStore('sessions').put(s);
    for (const i of V1_INVENTORY) tx.objectStore('inventory').put(i);
    tx.objectStore('bottles').put({ id: 'bot_legacy', status: 'unstarted', expiresAt: NOW + HOUR });
    for (const [key, value] of V1_SETTINGS) tx.objectStore('settings').put({ key, value, updatedAt: NOW - DAY });
  });
  db.close(); // or the v2 upgrade would be blocked by this very page
  localStorage.setItem('nurture_active_pump_timer', JSON.stringify({
    active: true, type: 'pump', startedAt: NOW - 10 * MIN, pumpOutputOz: 3.5, pumpOutputMl: 100, storeDestination: 'freezer',
  }));
  localStorage.setItem('nurture_bottle_timer', JSON.stringify({
    startTs: NOW - 5 * MIN, feedType: 'breastmilk', preparedOz: 4, sourceInventoryId: THAWED_ID,
  }));
  localStorage.setItem('nurture_ui_tab', 'today'); // unrelated key must survive migration
}

async function rawCounts() {
  const db = await rawOpen(2);
  const counts = await rawTx(db, ['sessions', 'inventory', 'bottles', 'events'], 'readonly', (tx, done) => {
    const c = {};
    for (const n of ['sessions', 'inventory', 'bottles', 'events']) {
      const r = tx.objectStore(n).count();
      r.onsuccess = () => { c[n] = r.result; done(c); };
    }
  });
  db.close();
  return counts;
}

async function setRawSetting(key, value) {
  // Use the module's own connection: a second raw connection would also work,
  // but this keeps the test honest about what the app sees.
  const { transaction } = await import('../../../js/core/db.js');
  await transaction('settings', 'readwrite', (s) => { s.settings.put({ key, value, updatedAt: Date.now() }); });
}

// ----------------------------------------------------------------- suites

const SUITES = {};

SUITES.migration = async () => {
  await seedV1();
  const { runMigration, MISSING_AMOUNT_NOTE } = await import('../../../js/core/migrate.js');
  const { events } = await import('../../../js/core/store.js');
  const settings = await import('../../../js/core/settings.js');
  const { stash } = await import('../../../js/core/stash.js');

  const bulk = [];
  events.subscribe(c => bulk.push(c.op));

  let report;
  await test('runMigration migrates v1 sessions + live timers', async () => {
    report = await runMigration();
    eq(report.skipped, false, 'first run not skipped');
    eq(report.events, 6, '6 migratable sessions (unknown type skipped)');
    eq([report.rejected, report.rejectedIds], [1, ['bot_zzz']], 'the skipped session is reported, not silently lost');
    eq(report.liveTimers, 2, 'pump + bottle live timers');
    ok(bulk.includes('bulk'), 'events bus announced a bulk change');
  });

  await test('v1 data is never deleted', async () => {
    const c = await rawCounts();
    eq(c.sessions, V1_SESSIONS.length, 'sessions kept (read-only legacy)');
    eq(c.bottles, 1, 'bottles kept');
    eq(c.inventory, V1_INVENTORY.length, 'inventory untouched');
    eq(c.events, 8, '6 sessions + 2 running');
  });

  const all = await events.query();
  const byFrom = id => all.find(e => e.migratedFrom === id);

  await test('every record migrated exactly once with deterministic ids', async () => {
    for (const s of V1_SESSIONS.filter(x => x.type !== 'bottle')) {
      const matches = all.filter(e => e.migratedFrom === s.id);
      eq(matches.length, 1, `exactly one event for ${s.id}`);
      eq(matches[0].id, `evt_${s.id}`, 'deterministic id');
    }
    const devId = await settings.deviceId();
    ok(/^dev_/.test(devId), 'deviceId generated');
    ok(all.every(e => e.deviceId === devId), 'events stamped with this device');
  });

  await test('one default baby named from v1 babyName; feeds on it, pumps parent-level', async () => {
    const babies = settings.get('babies');
    eq(babies.length, 1, 'load() created an unnamed default first; migration named it instead of adding another');
    eq(babies[0].name, 'Clara');
    ok(/^baby_/.test(babies[0].id), 'baby_ id');
    eq(settings.get('activeBabyId'), babies[0].id);
    eq(report.babyId, babies[0].id);
    for (const e of all) {
      if (e.type === 'pump') eq(e.babyId, null, `${e.id} pump is parent-level`);
      else eq(e.babyId, babies[0].id, `${e.id} belongs to Clara`);
    }
  });

  await test('pump maps directly; NaN/null amounts become null + note', async () => {
    const p = byFrom('pump_aaa');
    eq([p.type, p.startTime, p.endTime, p.data.amount, p.data.unit, p.data.storedTo, p.note],
      ['pump', T1, T1 + 20 * MIN, 4.5, 'oz', null, 'morning']);
    const n = byFrom('pump_nan');
    eq([n.data.amount, n.data.unit, n.note], [null, 'mL', MISSING_AMOUNT_NOTE]);
    const z = byFrom('pump_null');
    eq(z.data.amount, null);
    ok(z.note.startsWith('left side only') && z.note.includes(MISSING_AMOUNT_NOTE), 'user note kept + missing-amount note');
  });

  await test('mL feed keeps its unit; auto notes dropped; timing = logged at end', async () => {
    const f = byFrom('sess_bbb');
    eq([f.type, f.data.method, f.data.milk, f.data.amount, f.data.unit, f.data.prepared, f.note],
      ['feed', 'bottle', 'breastmilk', 120, 'mL', 120, '']);
    eq([f.startTime, f.endTime], [T2 - 900 * 1000, T2]);
    const g = byFrom('sess_ccc');
    eq([g.data.milk, g.data.amount, g.data.unit, g.note, g.startTime, g.endTime], ['formula', 4, 'oz', '', T2 + 2 * HOUR, T2 + 2 * HOUR]);
  });

  await test('hostile v1 note is kept verbatim as plain text', async () => {
    eq(byFrom('sess_ddd').note, '<img src=x onerror=alert(1)>');
    ok(!document.querySelector('img'), 'nothing was rendered');
  });

  await test('v1 settings mapped; junk keys ignored; never-clobber', async () => {
    const s = settings.all();
    eq([s.pumpGoalOz, s.pumpIntervalMinutes, s.units, s.theme, s.sound, s.onboarded, s.migratedV2],
      [26, 120, 'mL', 'dark', 'off', true, true]);
    eq(s.storageWindows.fridgeDays, 3);
    eq([s.parentName, s.babies[0].birthDate, s.lastBackupAt, s.persistGranted], ['Nick', null, null, null]);
    ok(!('profile' in s), 'no v1-era profile object');
    ok(!('dailyPumpingGoal' in s) && !('preferredUnit' in s) && !('reminderIntervalHours' in s), 'junk keys not surfaced');
  });

  await test('live timers became running events; keys removed', async () => {
    const live = await events.running();
    eq(live.length, 2);
    const pump = live.find(e => e.type === 'pump');
    const feed = live.find(e => e.type === 'feed');
    eq([pump.startTime, pump.endTime, pump.data.amount, pump.data.unit, pump.data.storedTo, pump.babyId], [NOW - 10 * MIN, null, null, 'mL', 'freezer', null]);
    eq([feed.startTime, feed.data.method, feed.data.milk, feed.data.prepared, feed.data.unit, feed.data.sourceInventoryId, feed.babyId],
      [NOW - 5 * MIN, 'bottle', 'breastmilk', 118, 'mL', THAWED_ID, settings.get('activeBabyId')]);
    eq([localStorage.getItem('nurture_active_pump_timer'), localStorage.getItem('nurture_bottle_timer')], [null, null]);
    eq(localStorage.getItem('nurture_ui_tab'), 'today', 'unrelated keys untouched');
  });

  await test('re-running is a no-op (flag) and idempotent even without the flag', async () => {
    const again = await runMigration();
    eq([again.skipped, again.events, again.liveTimers], [true, 0, 0]);
    await setRawSetting('migratedV2', false);
    // A stale live-timer key reappearing must not duplicate the running pump.
    localStorage.setItem('nurture_active_pump_timer', JSON.stringify({ active: true, startedAt: NOW - 10 * MIN, storeDestination: 'freezer' }));
    const forced = await runMigration();
    eq([forced.skipped, forced.events, forced.liveTimers], [false, 0, 0]);
    eq((await rawCounts()).events, 8, 'still 8 events');
    eq(localStorage.getItem('nurture_active_pump_timer'), null);
  });

  await test('migrated stash: expired pouch swept deliberately, thawed pouch usable', async () => {
    const usable = await stash.list();
    eq(usable.map(i => i.id).sort(), ['inv_frozen-1', THAWED_ID].sort());
    const old = await stash.get('inv_fridge-old');
    eq(old.status, 'expired', 'sweep persisted expired status');
    eq((await stash.thawed()).map(i => i.id), [THAWED_ID]);
    eq((await stash.useNext()).id, THAWED_ID, 'thawed milk is used next');
  });

  await test('finishing the migrated live bottle consumes its thawed pouch once', async () => {
    const [feed] = await events.running('feed');
    const done = await events.stop(feed.id, { data: { amount: 100 } });
    eq([done.endTime !== null, done.data.amount, done.data.prepared], [true, 100, 118]);
    const pouch = await stash.consumeForFeed(done);
    eq(pouch.status, 'used', '118 mL poured ≈ the whole 4 oz pouch');
    const again = await stash.consumeForFeed(done);
    eq(again.status, 'used');
    eq((await stash.get(THAWED_ID)).consumedBy, [done.id]);
  });
};

// Same context, after a page reload: nothing duplicated, running pump survives.
SUITES['migration-reload'] = async () => {
  const { runMigration } = await import('../../../js/core/migrate.js');
  const { events } = await import('../../../js/core/store.js');
  const settings = await import('../../../js/core/settings.js');
  await test('after reload: migration skipped, data intact, running pump survived', async () => {
    const r = await runMigration();
    eq(r.skipped, true);
    eq((await rawCounts()).events, 8);
    const live = await events.running();
    eq(live.map(e => e.type), ['pump']);
    eq(settings.get('babies').map(b => b.name), ['Clara'], 'still exactly one baby');
  });
};

SUITES.store = async () => {
  const { events, RunningActivityError, NotFoundError } = await import('../../../js/core/store.js');
  const settings = await import('../../../js/core/settings.js');
  await settings.load();
  const changes = [];
  const unsubscribe = events.subscribe(c => changes.push(c));

  await test('add fills id/createdAt/updatedAt/deviceId; instant endTime', async () => {
    const t = Date.now() - HOUR;
    const e = await events.add({ type: 'diaper', startTime: t, data: { kind: 'wet', color: 'yellow' }, note: 'ok' });
    ok(/^evt_/.test(e.id), 'evt_ id');
    eq([e.type, e.startTime, e.endTime, e.note, e.data], ['diaper', t, t, 'ok', { kind: 'wet', color: 'yellow' }]);
    ok(e.createdAt > 0 && e.updatedAt === e.createdAt, 'timestamps');
    eq(e.deviceId, await settings.deviceId());
    eq(changes.at(-1).op, 'add');
    eq(await events.get(e.id), e, 'round-trips through IndexedDB');
  });

  await test('add rejects unknown types and end-before-start', async () => {
    await rejects(events.add({ type: 'breastfeed', data: {} }), e => e instanceof RangeError);
    await rejects(events.add({ type: 'sleep', startTime: Date.now(), endTime: Date.now() - HOUR }), e => e instanceof RangeError);
    await rejects(events.add({ type: 'diaper', data: { kind: 'purple' } }), e => e instanceof RangeError);
  });

  await test('add strips hostile/unknown keys and cannot pollute prototypes', async () => {
    const input = JSON.parse('{"type":"feed","data":{"method":"bottle","milk":"formula","amount":"4.5","unit":"oz","__proto__":{"polluted":true},"evil":1},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    const e = await events.add(input);
    eq(Object.keys(e.data).sort(), ['amount', 'method', 'milk', 'unit']);
    eq(e.data.amount, 4.5, 'numeric string coerced');
    ok(({}).polluted === undefined && Object.prototype.polluted === undefined, 'Object.prototype untouched');
  });

  await test('update: shallow top level, deep data merge, type immutable', async () => {
    const e = await events.add({ type: 'feed', data: { method: 'bottle', milk: 'breastmilk', amount: 3, unit: 'oz' } });
    const u = await events.update(e.id, { note: 'sleepy', data: { amount: 3.5 } });
    eq([u.note, u.data.milk, u.data.amount, u.data.unit], ['sleepy', 'breastmilk', 3.5, 'oz']);
    ok(u.updatedAt > e.updatedAt, 'updatedAt strictly increases');
    eq(u.createdAt, e.createdAt);
    eq(changes.at(-1).op, 'update');
    eq(changes.at(-1).prev.data.amount, 3, 'change carries prev');
    await rejects(events.update(e.id, { type: 'pump' }), err => err instanceof TypeError);
    await rejects(events.update('evt_missing', { note: 'x' }), err => err instanceof NotFoundError);
  });

  await test('remove → restore round-trips the exact record (undo)', async () => {
    const e = await events.add({ type: 'diaper', data: { kind: 'both' } });
    const removed = await events.remove(e.id);
    eq(removed, e);
    eq(await events.get(e.id), null);
    eq(changes.at(-1).op, 'remove');
    eq(await events.remove(e.id), null, 'removing twice is harmless');
    const back = await events.restore(removed);
    eq(back, e);
    eq(await events.get(e.id), e);
    eq([changes.at(-1).op, changes.at(-1).restored], ['add', true]);
  });

  await test('start: one running per type, enforced atomically', async () => {
    const sleep = await events.start('sleep', {}, { startTime: Date.now() - 30 * MIN });
    eq(sleep.endTime, null);
    ok(['nap', 'night'].includes(sleep.data.kind), 'kind auto-classified');
    const err = await rejects(events.start('sleep'), e => e instanceof RunningActivityError);
    eq(err.running.id, sleep.id, 'error carries the running event');
    const pump = await events.start('pump', { unit: 'mL' });
    eq(pump.endTime, null, 'a different type can run at the same time');
    const results2 = await Promise.allSettled([events.start('feed', { method: 'bottle', milk: 'formula' }), events.start('feed', { method: 'bottle', milk: 'formula' })]);
    eq(results2.filter(r => r.status === 'fulfilled').length, 1, 'double-tap starts exactly one');
    eq((await events.running('feed')).length, 1);
  });

  await test('running() is oldest-first; query/last filter correctly', async () => {
    const live = await events.running();
    ok(live.length === 3, `3 running, got ${live.length}`);
    for (let i = 1; i < live.length; i++) ok(live[i - 1].startTime <= live[i].startTime, 'oldest first');
    const finishedFeeds = await events.query({ type: 'feed', running: false });
    ok(finishedFeeds.every(e => e.endTime !== null && e.type === 'feed'), 'running:false');
    const lastFeed = await events.last('feed');
    ok(lastFeed && lastFeed.endTime !== null, 'last() skips the running feed');
    const lastFormula = await events.last('feed', e => e.data.milk === 'formula');
    eq(lastFormula.data.milk, 'formula');
    eq(await events.last('milestone'), null);
  });

  await test('stop: sets endTime, merges patch, double-stop is a no-op', async () => {
    const [pump] = await events.running('pump');
    const before = changes.length;
    const stopped = await events.stop(pump.id, { data: { amount: 120, storedTo: 'fridge' } });
    ok(stopped.endTime >= stopped.startTime, 'endTime set');
    eq([stopped.data.amount, stopped.data.unit, stopped.data.storedTo], [120, 'mL', 'fridge']);
    eq(changes.length, before + 1);
    const again = await events.stop(pump.id, { data: { amount: 999 } });
    eq(again, stopped, 'second stop returns the finished event unchanged');
    eq(changes.length, before + 1, 'and emits nothing');
    const [sleep] = await events.running('sleep');
    const end = sleep.startTime + 20 * MIN;
    const s2 = await events.stop(sleep.id, { endTime: end, data: { kind: 'nap' } });
    eq([s2.endTime, s2.data.kind], [end, 'nap']);
    const early = await events.start('sleep', {}, { startTime: Date.now() });
    const clamped = await events.stop(early.id, { endTime: early.startTime - HOUR });
    eq(clamped.endTime, early.startTime, 'endTime never before startTime');
  });

  await test('breastfeeding: stop banks the active side', async () => {
    const [bottle] = await events.running('feed');
    await events.remove(bottle.id);
    const t0 = Date.now() - 5 * MIN;
    const bf = await events.start('feed', { method: 'breast', left: 120, right: 0, lastSide: 'left', activeSide: 'right', activeSince: Date.now() - 60 * 1000 }, { startTime: t0 });
    const done = await events.stop(bf.id);
    eq([done.data.method, done.data.activeSide, done.data.lastSide, done.data.left], ['breast', null, 'right', 120]);
    ok(done.data.right >= 60 && done.data.right < 70, `right side banked (${done.data.right}s)`);
  });

  await test('restore refuses a second running event of a type', async () => {
    const a = await events.start('sleep');
    const removed = await events.remove(a.id);
    const b = await events.start('sleep');
    await rejects(events.restore(removed), e => e instanceof RunningActivityError);
    await events.stop(b.id);
    eq((await events.restore(removed)).id, a.id, 'fine once the other stopped');
    await events.stop(a.id);
  });

  await test('query: from/to window, types, overlap, limit, newest first', async () => {
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const day = base.getTime() - 3 * DAY;
    const night = await events.add({ type: 'sleep', startTime: day - 2 * HOUR, endTime: day + 6 * HOUR, data: { kind: 'night' } });
    const d1 = await events.add({ type: 'diaper', startTime: day + HOUR, data: { kind: 'wet' } });
    const f1 = await events.add({ type: 'feed', startTime: day + 2 * HOUR, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
    const inDay = await events.query({ from: day, to: day + DAY });
    eq(inDay.map(e => e.id), [f1.id, d1.id], 'startTime window, newest first');
    const withOverlap = await events.query({ from: day, to: day + DAY, overlap: true });
    ok(withOverlap.some(e => e.id === night.id), 'overlap includes the night that started the evening before');
    eq((await events.query({ from: day, to: day + DAY, types: ['diaper'] })).map(e => e.id), [d1.id]);
    eq((await events.query({ type: 'feed', from: day, to: day + DAY })).map(e => e.id), [f1.id]);
    eq((await events.query({ limit: 2 })).length, 2);
  });

  await test('babyId: defaults to the active baby; pumps are parent-level; unknown babies refused', async () => {
    const active = settings.get('activeBabyId');
    ok(/^baby_/.test(active), 'a default baby exists');
    const d = await events.add({ type: 'diaper', data: { kind: 'wet' } });
    eq(d.babyId, active);
    const p = await events.add({ type: 'pump', babyId: active, data: { amount: 3, unit: 'oz' } });
    eq(p.babyId, null, 'pump babyId forced to null');
    await rejects(events.add({ type: 'diaper', babyId: 'baby_nobody', data: { kind: 'wet' } }), e => e instanceof RangeError);
    await rejects(events.add({ type: 'diaper', babyId: '<img src=x>', data: { kind: 'wet' } }), e => e instanceof RangeError);
  });

  await test('twins: one running activity per type PER BABY; query/running/last filter by baby', async () => {
    const a = settings.get('activeBabyId');
    const twin = await settings.addBaby({ name: 'Max', birthDate: '2026-08-01' });
    ok(/^baby_/.test(twin.id) && twin.id !== a);
    const napA = await events.start('sleep', { kind: 'nap' });
    const napB = await events.start('sleep', { kind: 'nap' }, { babyId: twin.id });
    eq([napA.babyId, napB.babyId], [a, twin.id], 'twins nap at the same time');
    await rejects(events.start('sleep', {}, { babyId: twin.id }), e => e instanceof RunningActivityError && e.running.id === napB.id);
    const pump = await events.start('pump', { unit: 'oz' });
    await rejects(events.start('pump', { unit: 'oz' }, { babyId: twin.id }), e => e instanceof RunningActivityError, 'one running pump, whoever is active');
    const feedB = await events.add({ type: 'feed', babyId: twin.id, data: { method: 'bottle', milk: 'formula', amount: 2, unit: 'oz' } });

    const forB = await events.query({ babyId: twin.id });
    ok(forB.every(e => e.babyId === twin.id || e.babyId === null), 'only Max + parent-level');
    ok(forB.some(e => e.id === pump.id) && forB.some(e => e.id === feedB.id) && !forB.some(e => e.id === napA.id), 'pump shows for every baby; the other twin does not');
    const parentOnly = await events.query({ babyId: null });
    ok(parentOnly.length > 0 && parentOnly.every(e => e.babyId === null), 'babyId null → parent-level only');
    eq((await events.running('sleep', { babyId: twin.id })).map(e => e.id), [napB.id]);
    eq((await events.running(undefined, { babyId: twin.id })).map(e => e.id).sort(), [napB.id, pump.id].sort());
    eq((await events.last('feed', null, { babyId: twin.id })).id, feedB.id);
    ok((await events.last('feed', null, { babyId: a })).babyId === a, 'last() per baby');

    // Moving a running nap onto a baby who is already napping is refused…
    await rejects(events.update(napA.id, { babyId: twin.id }), e => e instanceof RunningActivityError);
    // …moving a finished event is fine.
    const moved = await events.update(feedB.id, { babyId: a });
    eq(moved.babyId, a);
    await rejects(events.update(feedB.id, { babyId: 'baby_ghost' }), e => e instanceof RangeError);
    await events.stop(napA.id);
    await events.stop(napB.id);
    await events.stop(pump.id, { data: { amount: 1 } });
  });

  await test('unsubscribe stops notifications', async () => {
    unsubscribe();
    const n = changes.length;
    await events.add({ type: 'diaper', data: { kind: 'dry' } });
    eq(changes.length, n);
  });
};

SUITES.stash = async () => {
  const { stash, StashNotFoundError } = await import('../../../js/core/stash.js');
  const { events } = await import('../../../js/core/store.js');
  const ops = [];
  stash.subscribe(c => ops.push(c.op));

  await test('add computes CDC expiry; rejects NaN / bad location', async () => {
    const pumpedAt = Date.now() - HOUR;
    const p = await stash.add({ pumpedAt, quantity: 4, unit: 'oz', location: 'fridge', notes: '<b>bag</b>' });
    eq([p.status, p.location, p.expiresAt, p.notes], ['active', 'fridge', pumpedAt + 4 * DAY, '<b>bag</b>']);
    ok(/^inv_/.test(p.id) && /^dev_/.test(p.deviceId) && p.updatedAt > 0, 'ids + timestamps');
    eq(ops.at(-1), 'add');
    await rejects(stash.add({ quantity: NaN, location: 'fridge' }), e => e instanceof RangeError);
    await rejects(stash.add({ quantity: 4, location: 'thawed' }), e => e instanceof RangeError);
  });

  let frozenId;
  await test('thaw: frozen → thawed with a fresh 24h clock; only once', async () => {
    const f = await stash.add({ pumpedAt: Date.now() - 20 * DAY, quantity: 120, unit: 'mL', location: 'freezer' });
    frozenId = f.id;
    eq((await stash.frozen()).map(i => i.id), [f.id]);
    const t = await stash.thaw(f.id);
    eq(t.location, 'thawed');
    ok(Math.abs(t.expiresAt - (Date.now() + 24 * HOUR)) < 5000, '24h thawed window');
    eq(await stash.thaw(f.id), null, 'already thawed');
    eq((await stash.thawed()).map(i => i.id), [f.id]);
    eq((await stash.frozen()).length, 0);
    await rejects(stash.update(f.id, { location: 'freezer' }), e => e instanceof RangeError, 'never refreeze');
    await rejects(stash.thaw('inv_nope'), e => e instanceof StashNotFoundError);
  });

  await test('consume: partial leaves remainder; consumeForFeed is once-only', async () => {
    const part = await stash.consume(frozenId, 1, 'oz');
    eq(part.quantity, 90, '120 mL − 1 oz ≈ 90 mL');
    const feed = await events.add({ type: 'feed', data: { method: 'bottle', milk: 'breastmilk', amount: 3.5, unit: 'oz', sourceInventoryId: frozenId } });
    const used = await stash.consumeForFeed(feed);
    eq(used.status, 'used');
    const again = await stash.consumeForFeed(feed);
    eq([again.status, again.quantity], ['used', 90]);
    eq(await stash.consumeForFeed({ id: 'evt_x', data: {} }), null, 'no source → null');
  });

  await test('markUsed / discard / restore snapshot (undo)', async () => {
    const p = await stash.add({ quantity: 5, location: 'freezer' });
    const before = await stash.get(p.id);
    const used = await stash.markUsed(p.id);
    eq(used.status, 'used');
    ok(used.usedAt > 0);
    await stash.restore(before);
    eq((await stash.get(p.id)).status, 'active');
    const gone = await stash.discard(p.id);
    eq(gone.status, 'discarded');
    eq((await stash.markUsed(p.id)).status, 'discarded', 'archived pouches stay archived');
    await stash.restore(before);
    const removed = await stash.remove(p.id);
    eq(await stash.get(p.id), null);
    await stash.restore(removed);
    eq((await stash.get(p.id)).id, p.id);
    await rejects(stash.restore({ id: '<img src=x>' }), e => e instanceof RangeError);
  });

  await test('expiry sweep is deliberate and race-free', async () => {
    const room = await stash.add({ pumpedAt: Date.now() - 5 * HOUR, quantity: 2, location: 'room' });
    ok(room.expiresAt < Date.now(), 'room milk 5h old is already past 4h');
    const raw = await stash.get(room.id);
    eq(raw.status, 'active', 'get() is a pure read');
    const list = await stash.list();
    ok(!list.some(i => i.id === room.id), 'list never offers expired milk');
    eq((await stash.get(room.id)).status, 'expired', 'sweep persisted it');
    eq((await stash.list({ filter: 'expired' })).map(i => i.id), [room.id]);
    // Race a thaw against a sweep: whatever the order, the thaw sticks.
    const fz = await stash.add({ pumpedAt: Date.now() - DAY, quantity: 3, location: 'freezer' });
    const [thawedItem] = await Promise.all([stash.thaw(fz.id), stash.sweepExpired(), stash.list(), stash.sweepExpired()]);
    eq(thawedItem.location, 'thawed');
    const final = await stash.get(fz.id);
    eq([final.location, final.status], ['thawed', 'active']);
  });

  await test('summary in oz (thawed counts as fridge) + everStored; useNext', async () => {
    const s = await stash.summary();
    ok(s.everStored === true && s.totalBags >= 2, 'summary shape');
    ok(Math.abs(s.fridgeOz - (4 + 3)) < 0.05, `fridge 4 oz + thawed 3 oz (got ${s.fridgeOz})`);
    const next = await stash.useNext();
    eq(next.location, 'thawed', 'thawed milk first');
  });

  await test('update recomputes expiry when location changes', async () => {
    const p = await stash.add({ pumpedAt: Date.now() - DAY, quantity: 4, location: 'fridge' });
    const moved = await stash.update(p.id, { location: 'freezer' });
    const expected = new Date(p.pumpedAt); expected.setMonth(expected.getMonth() + 6);
    eq(moved.expiresAt, expected.getTime());
    eq(ops.at(-1), 'update');
  });
};

async function makeImageBlob(w, h, type = 'image/png') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2040ff';
  ctx.fillRect(0, 0, w, h);
  // A red square dead centre: a correct centre-crop keeps it in the middle.
  const s = Math.min(w, h) / 4;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(w / 2 - s / 2, h / 2 - s / 2, s, s);
  return new Promise(r => c.toBlob(r, type));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

SUITES.photos = async () => {
  const photos = await import('../../../js/core/photos.js');
  const settings = await import('../../../js/core/settings.js');
  let id;
  await test('add downscales to ≤1600px long edge as JPEG', async () => {
    const res = await photos.add(await makeImageBlob(3000, 2000));
    id = res.id;
    ok(/^pho_/.test(id));
    eq([res.width, res.height], [1600, 1067]);
    const rec = await photos.getRecord(id);
    eq([rec.blob.type, rec.width, rec.height], ['image/jpeg', 1600, 1067]);
    ok(rec.blob.size > 0 && rec.blob.size < 1_000_000, `reasonable size (${rec.blob.size})`);
  });

  await test('small photos are not upscaled', async () => {
    const res = await photos.add(await makeImageBlob(100, 50));
    eq([res.width, res.height], [100, 50]);
    await photos.delete(res.id);
  });

  let url;
  await test('get() returns a cached blob: URL that renders', async () => {
    url = await photos.get(id);
    ok(url.startsWith('blob:'));
    eq(await photos.get(id), url, 'cached');
    const img = await loadImage(url);
    eq([img.naturalWidth, img.naturalHeight], [1600, 1067]);
    eq(await photos.get('pho_missing'), null);
    eq(await photos.get('<img src=x>'), null);
  });

  await test('makeIconDataUrl → square centre-cropped PNG', async () => {
    const dataUrl = await photos.makeIconDataUrl(id, 180);
    ok(dataUrl.startsWith('data:image/png;base64,'));
    const img = await loadImage(dataUrl);
    eq([img.naturalWidth, img.naturalHeight], [180, 180]);
    const c = document.createElement('canvas');
    c.width = 180; c.height = 180;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(90, 90, 1, 1).data;
    ok(r > 200 && g < 60 && b < 60, `centre is red (${r},${g},${b})`);
    const [r2, , b2] = ctx.getImageData(5, 90, 1, 1).data;
    ok(b2 > 200 && r2 < 80, 'edge is blue');
    await settings.set('iconDataUrl', dataUrl);
    eq(settings.get('iconDataUrl'), dataUrl, 'persistable as settings.iconDataUrl');
    const fav = await photos.makeIconDataUrl(id, 64);
    eq((await loadImage(fav)).naturalWidth, 64);
  });

  await test('usage + delete revokes the URL', async () => {
    eq((await photos.usage()).count, 1);
    eq(await photos.delete(id), true);
    eq(await photos.get(id), null);
    await rejects(loadImage(url), null, 'revoked URL no longer loads');
    eq(await photos.delete(id), false);
  });

  await test('non-images are rejected with PhotoDecodeError', async () => {
    await rejects(photos.add(new Blob(['not an image'], { type: 'image/jpeg' })), e => e.name === 'PhotoDecodeError');
    await rejects(photos.add(new Blob([], { type: 'image/png' })), e => e.name === 'PhotoDecodeError');
    await rejects(photos.add('nope'), e => e instanceof TypeError);
  });
};

SUITES.settings = async () => {
  const settings = await import('../../../js/core/settings.js');
  await test('defaults + generated deviceId + one default baby', async () => {
    const all = await settings.load();
    eq([all.units, all.theme, all.sound, all.pumpGoalOz, all.pumpIntervalMinutes, all.onboarded, all.migratedV2],
      ['oz', 'auto', 'night-off', 24, 180, false, false]);
    eq([all.parentName, all.lastBackupAt, all.persistGranted, all.feedbackEmail], ['', null, null, '']);
    eq(all.babies.length, 1);
    eq([all.babies[0].name, all.babies[0].birthDate, all.babies[0].photoId], ['', null, null]);
    ok(/^baby_/.test(all.babies[0].id) && all.babies[0].createdAt > 0, 'baby id + createdAt');
    eq(all.activeBabyId, all.babies[0].id);
    ok(!('profile' in all));
    localStorage.setItem('babyIdSeen', all.babies[0].id);
    eq(all.todayOrder, ['feed', 'sleep', 'diaper', 'pump', 'stash']);
    ok(Object.values(all.trackers).every(v => v === true) && Object.keys(all.trackers).length === 8, 'all trackers on');
    ok(/^dev_/.test(all.deviceId));
    window.__deviceId = all.deviceId;
    localStorage.setItem('deviceIdSeen', all.deviceId);
  });

  await test('set/get/patch/subscribe; invalid values throw', async () => {
    const seen = [];
    const off = settings.subscribe(c => seen.push(c.key));
    await settings.set('units', 'mL');
    eq(settings.get('units'), 'mL');
    await settings.set('units', 'mL'); // no-op
    await settings.patch('trackers', { pump: false });
    eq(settings.get('trackers').pump, false);
    eq(settings.get('trackers').sleep, true);
    const first = settings.activeBaby();
    const clara = await settings.updateBaby(first.id, { name: '  Clara ', birthDate: '2026-08-01' });
    eq([clara.id, clara.name, clara.birthDate], [first.id, 'Clara', '2026-08-01']);
    await settings.set('parentName', 'Nick');
    eq(seen, ['units', 'trackers', 'babies', 'parentName']);
    await rejects(settings.set('units', 'cups'), e => e instanceof TypeError);
    await rejects(settings.set('__proto__', 1), e => e instanceof TypeError);
    await rejects(settings.set('feedbackEmail', 'x@y.com?bcc=evil@z.com'), e => e instanceof TypeError);
    await settings.set('feedbackEmail', 'hello@example.com');
    await rejects(settings.updateBaby(first.id, { birthDate: '2026-02-31' }), e => e instanceof TypeError);
    await rejects(settings.updateBaby('baby_nope', { name: 'x' }), e => e instanceof TypeError);
    const t = settings.get('trackers'); t.pump = true;
    eq(settings.get('trackers').pump, false, 'get() hands out copies');
    const b = settings.get('babies'); b[0].name = 'mutated';
    eq(settings.get('babies')[0].name, 'Clara', 'babies are copies too');
    off();
  });

  await test('babies: add twins concurrently (no lost update), switch active, refuse unknown active id', async () => {
    const [max, ivy] = await Promise.all([settings.addBaby({ name: 'Max' }), settings.addBaby({ name: 'Ivy' })]);
    eq(settings.get('babies').map(x => x.name), ['Clara', 'Max', 'Ivy']);
    await settings.setActiveBaby(max.id);
    eq([settings.get('activeBabyId'), settings.activeBaby().name], [max.id, 'Max']);
    await rejects(settings.setActiveBaby('baby_ghost'), e => e instanceof TypeError);
    await rejects(settings.addBaby({ name: 5 }), e => e instanceof TypeError);
    eq(settings.get('activeBabyId'), max.id);
    ok(ivy.id !== max.id);
  });
};

SUITES['settings-reload'] = async () => {
  const settings = await import('../../../js/core/settings.js');
  await test('settings + deviceId + babies persist across reload', async () => {
    const all = await settings.load();
    eq(all.deviceId, localStorage.getItem('deviceIdSeen'));
    eq([all.units, all.trackers.pump, all.parentName, all.feedbackEmail], ['mL', false, 'Nick', 'hello@example.com']);
    eq(all.babies.map(b => b.name), ['Clara', 'Max', 'Ivy']);
    eq(all.babies[0].id, localStorage.getItem('babyIdSeen'), 'default baby kept its id (no second default minted)');
    eq(settings.activeBaby().name, 'Max');
  });
};

SUITES.backup = async () => {
  const backup = await import('../../../js/core/backup.js');
  const { events } = await import('../../../js/core/store.js');
  const { stash } = await import('../../../js/core/stash.js');
  const photos = await import('../../../js/core/photos.js');
  const settings = await import('../../../js/core/settings.js');
  await settings.load();
  const claraId = settings.get('activeBabyId');
  await settings.updateBaby(claraId, { name: 'Clara' });

  const feed = await events.add({ type: 'feed', startTime: Date.now() - HOUR, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, note: '=HYPERLINK("http://x")' });
  await events.add({ type: 'diaper', data: { kind: 'dirty' } });
  await events.start('sleep');
  const pouch = await stash.add({ quantity: 120, unit: 'mL', location: 'freezer' });
  const ph = await photos.add(await makeImageBlob(400, 300));
  await events.add({ type: 'milestone', data: { key: 'first-smile', title: 'First smile', photoIds: [ph.id] } });

  let json;
  await test('exportBackup: v2 envelope, whitelisted settings, optional photos', async () => {
    const data = await backup.exportBackup({ includePhotos: true });
    eq([data.app, data.schema, data.events.length, data.inventory.length, data.photos.length], ['nurture', 2, 4, 1, 1]);
    for (const k of ['deviceId', 'migratedV2', 'iconDataUrl', 'lastBackupAt', 'persistGranted', 'feedbackEmail']) ok(!(k in data.settings), `${k} not exported`);
    eq(data.settings.babies.map(b => [b.id, b.name]), [[claraId, 'Clara']]);
    eq(data.settings.activeBabyId, claraId);
    ok(data.events.filter(e => e.type !== 'pump').every(e => e.babyId === claraId), 'events carry babyId');
    ok(typeof data.photos[0].data === 'string' && data.photos[0].data.length > 100, 'base64 photo');
    const noPhotos = await backup.exportBackup();
    ok(!('photos' in noPhotos), 'photos only when asked');
    json = JSON.stringify(data);
    const v = backup.validateBackup(JSON.parse(json));
    ok(v.ok && v.stats.events.rejected === 0 && v.stats.inventory.rejected === 0, 'own export validates cleanly');
  });

  await test('CSV export: all types, units, formula-injection guarded', async () => {
    const file = await backup.exportCsvFile({ unit: 'mL' });
    ok(file.name.endsWith('.csv'));
    const text = await file.text();
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    eq(lines.length, 5, 'header + 4 events');
    ok(lines[0].includes('"Baby"'), 'Baby column');
    ok(lines.some(l => l.includes('"Feed"') && l.includes('"118"') && l.includes('"mL"') && l.includes('"Clara"')), '4 oz shown as 118 mL, for Clara');
    ok(text.includes(`"'=HYPERLINK(""http://x"")"`), 'formula neutralised and quotes doubled');
    ok(text.includes('(in progress)'), 'running sleep marked');
  });

  await test('shareBackup downloads (no share sheet here) and stamps lastBackupAt', async () => {
    eq(settings.get('lastBackupAt'), null);
    const before = Date.now();
    eq(await backup.shareBackup(), 'download');
    ok(settings.get('lastBackupAt') >= before, 'lastBackupAt recorded');
    eq(backup.backup.share, backup.shareBackup, 'backup.share() is the §10b entry point');
  });

  await test('replace refuses to run if the safety backup cannot be saved', async () => {
    const err = await rejects(backup.importBackup(json, { mode: 'replace', safetyBackup: () => { throw new Error('disk full'); } }), e => e.name === 'BackupError');
    ok(/safety copy/.test(err.message));
    eq((await events.query()).length, 4, 'nothing replaced');
  });

  await test('replace downloads a safety backup of the current data first', async () => {
    const extra = await events.add({ type: 'diaper', data: { kind: 'wet' }, note: 'only on this phone' });
    const res = await backup.importBackup(json, { mode: 'replace' });
    ok(/^nurture-backup-before-import-\d{4}-\d{2}-\d{2}\.json$/.test(res.safetyBackup), `safety file name (${res.safetyBackup})`);
    eq(await events.get(extra.id), null, 'replaced');
    window.__safetyEventId = extra.id; // core.mjs checks the downloaded file holds it
  });

  await test('eraseAll + import(replace) restores everything incl. photos and babies', async () => {
    await backup.eraseAll();
    eq((await events.query()).length, 0);
    eq((await stash.list({ filter: 'everything' })).length, 0);
    eq((await photos.usage()).count, 0);
    ok(settings.get('activeBabyId') !== claraId, 'erase minted a fresh default baby');
    let called = false;
    const res = await backup.importBackup(new File([json], 'b.json', { type: 'application/json' }), { mode: 'replace', safetyBackup: () => { called = true; } });
    eq(called, false, 'nothing to protect on an empty device');
    eq(res.safetyBackup, null);
    eq([res.format, res.stats.events.added, res.stats.inventory.added, res.stats.photos.added], ['v2', 4, 1, 1]);
    eq((await events.query()).length, 4);
    eq((await events.get(feed.id)).note, '=HYPERLINK("http://x")', 'stored as plain text');
    eq((await stash.get(pouch.id)).quantity, 120);
    const url = await photos.get(ph.id);
    eq((await loadImage(url)).naturalWidth, 400);
    eq(settings.get('babies').map(b => [b.id, b.name]), [[claraId, 'Clara']], 'babies replaced by the file\'s');
    eq(settings.get('activeBabyId'), claraId);
    eq((await events.running()).length, 1, 'running sleep came back running');
  });

  await test('merge import: idempotent, newest updatedAt wins, ties keep local', async () => {
    const again = await backup.importBackup(json, { mode: 'merge' });
    eq([again.stats.events.added, again.stats.events.updated, again.stats.events.unchanged], [0, 0, 4]);
    const data = JSON.parse(json);
    const f = data.events.find(e => e.id === feed.id);
    f.note = 'edited on the other phone';
    f.updatedAt += 10_000;
    const local = data.events.find(e => e.type === 'diaper');
    local.note = 'older edit';
    const merged = await backup.importBackup(data, { mode: 'merge' });
    eq([merged.stats.events.updated, merged.stats.events.unchanged], [1, 3]);
    eq((await events.get(feed.id)).note, 'edited on the other phone');
    eq((await events.get(local.id)).note, '', 'tie keeps local');
  });

  await test('partner merge: the other phone\'s Clara is OUR Clara; a new twin is added; orphans get a placeholder', async () => {
    const t = Date.now() - 2 * HOUR;
    const other = {
      app: 'nurture', schema: 2, exportedAt: new Date().toISOString(),
      settings: { babies: [{ id: 'baby_otherphone1', name: 'clara ', birthDate: '2026-07-30', photoId: null, createdAt: t }, { id: 'baby_otherphone2', name: 'Max', birthDate: '2026-07-30', photoId: null, createdAt: t }], activeBabyId: 'baby_otherphone1', units: 'mL' },
      events: [
        { id: 'evt_p1', type: 'diaper', startTime: t, babyId: 'baby_otherphone1', data: { kind: 'wet' }, createdAt: t, updatedAt: t },
        { id: 'evt_p2', type: 'sleep', startTime: t, endTime: null, babyId: 'baby_otherphone1', data: { kind: 'nap' }, createdAt: t, updatedAt: t },
        { id: 'evt_p3', type: 'feed', startTime: t, babyId: 'baby_otherphone2', data: { method: 'bottle', milk: 'formula', amount: 90, unit: 'mL' }, createdAt: t, updatedAt: t },
        { id: 'evt_p4', type: 'diaper', startTime: t, babyId: 'baby_unlisted9', data: { kind: 'dirty' }, createdAt: t, updatedAt: t },
        { id: 'evt_p5', type: 'pump', startTime: t, babyId: 'baby_otherphone1', data: { amount: 4, unit: 'oz' }, createdAt: t, updatedAt: t },
      ],
    };
    const res = await backup.importBackup(JSON.stringify(other), { mode: 'merge' });
    eq([res.stats.babies.matched, res.stats.babies.added, res.stats.babies.placeholders], [1, 1, 1]);
    const babies = settings.get('babies');
    eq(babies.map(b => b.name), ['Clara', 'Max', '']);
    eq(babies[0].id, claraId, 'local id kept');
    eq(babies[0].birthDate, '2026-07-30', 'empty local field filled from the partner');
    eq((await events.get('evt_p1')).babyId, claraId, 'remapped onto our Clara');
    const p2 = await events.get('evt_p2');
    eq([p2.babyId, p2.endTime === p2.startTime], [claraId, true], 'Clara already napping here → incoming running nap stopped');
    eq((await events.get('evt_p3')).babyId, babies[1].id);
    eq((await events.get('evt_p4')).babyId, 'baby_unlisted9');
    eq((await events.get('evt_p5')).babyId, null, 'pump stays parent-level');
    eq(settings.get('units'), 'oz', 'merge leaves preferences alone');
    eq(settings.get('activeBabyId'), claraId, 'merge leaves the active baby alone');
    const again = await backup.importBackup(JSON.stringify(other), { mode: 'merge' });
    eq([again.stats.events.added, again.stats.events.updated, again.stats.babies.added], [0, 0, 0], 'idempotent');
    eq(settings.get('babies').length, 3);
  });

  await test('hostile import is neutralised', async () => {
    const hostile = `{"app":"nurture","schema":2,
      "__proto__":{"polluted":true},
      "events":[
        {"id":"evt_h1","type":"diaper","startTime":${Date.now()},"note":"<img src=x onerror=alert(1)>","data":{"kind":"wet","__proto__":{"polluted":true}},"constructor":{"prototype":{"polluted":true}}},
        {"id":"evt_h2","type":"telemetry","startTime":${Date.now()},"data":{}},
        {"id":"<script>","type":"diaper","startTime":${Date.now()},"data":{"kind":"wet"}},
        {"id":"evt_h3","type":"feed","startTime":"nope","data":{}},
        {"id":"evt_h4","type":"pump","startTime":${Date.now()},"data":{"amount":"1e400","unit":"mL"}},
        {"id":"evt_h5","type":"sleep","startTime":${Date.now()},"endTime":null,"data":{"kind":"night"}}
      ],
      "inventory":[{"id":"inv_h","pumpedAt":${Date.now()},"quantity":"4","location":"fridge","status":"active","notes":"${'x'.repeat(5000)}"}],
      "settings":{"units":"cups","theme":"dark","__proto__":{"polluted":true},"deviceId":"dev_attacker1"}}`;
    const res = await backup.importBackup(hostile, { mode: 'merge' });
    eq(res.stats.rejected.events, 3, 'unknown type, bad id, bad time rejected');
    ok(({}).polluted === undefined, 'no prototype pollution');
    eq((await events.get('evt_h1')).note, '<img src=x onerror=alert(1)>', 'kept as inert text');
    eq((await events.get('evt_h4')).data.amount, null, 'absurd number → null');
    const h5 = await events.get('evt_h5');
    eq(h5.endTime, h5.startTime, 'second running sleep was stopped, not duplicated');
    eq((await stash.get('inv_h')).notes.length, 2000, 'notes capped');
    eq(settings.get('units'), 'oz', 'merge leaves settings alone');
    ok(settings.get('deviceId') !== 'dev_attacker1', 'deviceId never imported');
  });

  await test('v1 backups import through the migration', async () => {
    const v1 = { version: 1, exportedAt: new Date().toISOString(), sessions: V1_SESSIONS.slice(0, 4), inventory: [V1_INVENTORY[0]], bottles: [{ id: 'b' }], settings: V1_SETTINGS.map(([key, value]) => ({ key, value })) };
    // NaN doesn't survive JSON (it becomes null) — exactly what a real v1 file has.
    const res = await backup.importBackup(JSON.stringify(v1), { mode: 'merge' });
    eq([res.format, res.stats.events.added, res.stats.inventory.added], ['v1', 4, 1]);
    eq((await events.get('evt_pump_nan')).data.amount, null);
    eq((await events.get('evt_pump_nan')).babyId, null);
    eq((await events.get('evt_sess_bbb')).babyId, claraId, 'v1 feeds land on the active baby');
    eq(settings.get('babies').length, 3, 'no extra baby for a v1 file');
    ok(res.warnings.length >= 1, 'bottles warning');
  });

  await test('bad files fail with a friendly BackupError', async () => {
    await rejects(backup.importBackup('{not json'), e => e.name === 'BackupError');
    await rejects(backup.importBackup('{"app":"nurture","schema":3}'), e => e.name === 'BackupError' && /newer/.test(e.message));
    await rejects(backup.importBackup('[1,2,3]'), e => e.name === 'BackupError');
    await rejects(backup.importBackup('{}', { mode: 'nuke' }), e => e.name === 'BackupError');
  });
};

SUITES.persist = async () => {
  const persist = await import('../../../js/core/persist.js');
  const settings = await import('../../../js/core/settings.js');
  const { events } = await import('../../../js/core/store.js');
  const ics = await import('../../../js/core/ics.js');
  await settings.load();

  await test('requestPersistence records the browser\'s answer', async () => {
    const granted = await persist.requestPersistence();
    ok(typeof granted === 'boolean', `boolean answer (${granted})`);
    eq(settings.get('persistGranted'), granted);
  });

  await test('estimate reports usage/quota', async () => {
    const e = await persist.estimate();
    ok(Number.isFinite(e.usage) && Number.isFinite(e.quota) && e.quota > 0, JSON.stringify(e));
    ok(typeof e.persisted === 'boolean');
  });

  await test('backup nudge: not with no data, due after a day of data, quiet after a backup', async () => {
    eq(await persist.dataSince(), null);
    eq(await persist.isBackupDue(), false, 'nothing to lose yet');
    await events.add({ type: 'diaper', startTime: Date.now() - 2 * HOUR, data: { kind: 'wet' } });
    eq(await persist.isBackupDue(), false, 'less than a day of data');
    const old = Date.now() - 2 * DAY;
    await events.add({ type: 'diaper', startTime: old, data: { kind: 'dirty' } });
    eq(await persist.dataSince(), old);
    eq(await persist.isBackupDue(), true);
    await persist.markBackedUp();
    eq(await persist.isBackupDue(), false);
    eq(await persist.isBackupDue(Date.now() + 8 * DAY), true, 'due again a week later');
  });

  await test('shareIcs downloads a calendar file (no share sheet here)', async () => {
    await events.add({ type: 'pump', startTime: Date.now() - HOUR, endTime: Date.now() - 40 * MIN, data: { amount: 3, unit: 'oz' } });
    eq(await ics.shareIcs({ days: 2 }), 'download');
    await rejects(ics.shareIcs({ intervalMinutes: 0 }), e => e instanceof RangeError);
  });
};

// ------------------------------------------------- regressions (round 1)

// Data-layer invariants that only show up against real IndexedDB.
SUITES['data-invariants'] = async () => {
  const { events } = await import('../../../js/core/store.js');
  const { stash } = await import('../../../js/core/stash.js');
  const settings = await import('../../../js/core/settings.js');
  const { rangeTotals } = await import('../../../js/domain/trends.js');
  await settings.load();

  await test('a breastfeed finished with update({ endTime }) stops counting at its end', async () => {
    const start = Date.now() - 20 * MIN;
    const ev = await events.start('feed', { method: 'breast', activeSide: 'left', activeSince: start }, { startTime: start });
    await events.update(ev.id, { endTime: start + 15 * MIN });
    const s = await events.get(ev.id);
    eq([s.data.activeSide, s.data.activeSince, s.data.left, s.data.lastSide], [null, null, 15 * 60, 'left']);
    eq(rangeTotals([s], start - HOUR, start + HOUR, { now: Date.now() + DAY }).feed.breastSec, 15 * 60, 'a day later: still 15 min');
  });

  await test('a past breastfeed added (or restored) with a live side is banked at its end', async () => {
    const start = Date.now() - 2 * HOUR;
    const ev = await events.add({ type: 'feed', startTime: start, endTime: start + 10 * MIN, data: { method: 'breast', left: 600, activeSide: 'right', activeSince: start + 5 * MIN } });
    eq([ev.data.activeSide, ev.data.left, ev.data.right], [null, 600, 300]);
    eq(rangeTotals([await events.get(ev.id)], start - HOUR, start + HOUR, { now: Date.now() }).feed.breastSec, 900);
    const removed = await events.remove(ev.id);
    const restored = await events.restore({ ...removed, data: { ...removed.data, activeSide: 'left', activeSince: start } });
    eq(restored.data.activeSide, null, 'undo of a stale record banks too');
  });

  await test('stash reads with a future `now` never persist expiry early', async () => {
    const p = await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: Date.now() });
    const later = Date.now() + 10 * DAY;
    ok(!(await stash.list({ now: later })).some(x => x.id === p.id), 'the preview filters by its own now');
    await stash.summary({ now: later });
    eq(await stash.useNext({ now: later }), null);
    await stash.sweepExpired(later);
    eq((await stash.get(p.id)).status, 'active', 'nothing written');
    ok((await stash.list()).some(x => x.id === p.id), 'still usable today');
  });

  await test('a pouch swept to expired comes back when corrected to where it is still good', async () => {
    const p = await stash.add({ quantity: 4, unit: 'oz', location: 'room', pumpedAt: Date.now() - 5 * HOUR });
    await stash.list(); // sweeps it
    eq((await stash.get(p.id)).status, 'expired');
    const fixed = await stash.update(p.id, { location: 'freezer' });
    eq(fixed.status, 'active');
    ok(fixed.expiresAt > Date.now(), 'freezer expiry ahead');
    ok((await stash.frozen()).some(x => x.id === p.id), 'listed as frozen');
    eq((await stash.thaw(p.id)).location, 'thawed', 'and thawable');
  });

  await test('concurrent settings.patch calls on one key keep every change', async () => {
    await Promise.all([settings.patch('trackers', { pump: false }), settings.patch('trackers', { sleep: false })]);
    await Promise.all([settings.patch('storageWindows', { fridgeDays: 3 }), settings.patch('storageWindows', { roomTempHours: 6 })]);
    const mem = [settings.get('trackers').pump, settings.get('trackers').sleep, settings.get('storageWindows').fridgeDays, settings.get('storageWindows').roomTempHours];
    await settings.reload();
    const disk = [settings.get('trackers').pump, settings.get('trackers').sleep, settings.get('storageWindows').fridgeDays, settings.get('storageWindows').roomTempHours];
    eq([mem, disk], [[false, false, 3, 6], [false, false, 3, 6]]);
  });

  await test('baby edits and patches build on the STORED value, not this tab\'s cache', async () => {
    const [baby] = settings.get('babies');
    // Another tab (whose message never reaches us) renamed the baby and hid diapers.
    await setRawSetting('babies', [{ ...baby, name: 'Clara Rose', birthDate: '2026-08-01' }]);
    await setRawSetting('trackers', { ...settings.get('trackers'), diaper: false });
    eq(settings.get('babies')[0].name, '', 'this tab\'s cache is stale');
    await settings.addBaby({ name: 'Theo' });
    await settings.patch('trackers', { memories: false });
    await settings.updateBaby(baby.id, { photoId: 'pho_1' });
    await settings.reload();
    eq(settings.get('babies').map(b => [b.name, b.birthDate, b.photoId]), [['Clara Rose', '2026-08-01', 'pho_1'], ['Theo', null, null]]);
    eq([settings.get('trackers').diaper, settings.get('trackers').memories, settings.get('trackers').pump], [false, false, false]);
  });
};

// Import is a trust boundary (AUDIT §6.5): replace must never destroy data
// because of a damaged file, and nothing in a file may claim the future.
SUITES['import-guards'] = async () => {
  const backup = await import('../../../js/core/backup.js');
  const { events } = await import('../../../js/core/store.js');
  const { stash } = await import('../../../js/core/stash.js');
  const photos = await import('../../../js/core/photos.js');
  const settings = await import('../../../js/core/settings.js');
  await settings.load();
  const file = over => JSON.stringify({ app: 'nurture', schema: 2, ...over });
  const counts = async () => [(await photos.usage()).count, (await events.query()).length, (await stash.list({ filter: 'everything' })).length];

  await photos.add(await makeImageBlob(40, 30));
  for (let i = 0; i < 3; i++) await events.add({ type: 'diaper', data: { kind: 'wet' }, startTime: Date.now() - (i + 1) * HOUR });
  await stash.add({ quantity: 4, unit: 'oz', location: 'freezer' });

  await test('replace refuses a file whose photos / events / stash are damaged — before the safety copy, touching nothing', async () => {
    const damaged = [
      { events: [], inventory: [], photos: 5 },
      { events: [], inventory: [], photos: [{ id: 'pho_x', data: 'not base64!!', width: 1, height: 1 }] },
      { events: 'oops', inventory: {} },
      { events: [{ id: 'evt_x', type: 'telemetry', startTime: Date.now() }], inventory: [] },
    ];
    for (const bad of damaged) {
      let safetyCalls = 0;
      const err = await rejects(backup.importBackup(file(bad), { mode: 'replace', safetyBackup: () => { safetyCalls += 1; } }), e => e.name === 'BackupError', JSON.stringify(bad));
      ok(/nothing was replaced/.test(err.message), err.message);
      eq(safetyCalls, 0, 'refused before the safety copy');
      eq(await counts(), [1, 3, 1], `nothing touched by ${JSON.stringify(bad).slice(0, 60)}`);
    }
  });

  await test('replace keeps every store the file carries no list for', async () => {
    const res = await backup.importBackup(file({ settings: { units: 'mL' } }), { mode: 'replace', safetyBackup: () => {} });
    eq(await counts(), [1, 3, 1], 'events, stash and photos kept');
    eq(settings.get('units'), 'mL', 'settings replaced');
    ok(res.safetyBackup, 'safety copy still taken');
  });

  await test('imported spoiled milk with a far-future expiry is never offered', async () => {
    const res = await backup.importBackup(file({ inventory: [{ id: 'inv_evil', pumpedAt: Date.now() - 30 * DAY, quantity: 5, unit: 'oz', location: 'fridge', expiresAt: Date.UTC(2099, 0, 1), status: 'active' }] }), { mode: 'merge' });
    eq(res.stats.inventory.added, 1);
    ok(!(await stash.list()).some(x => x.id === 'inv_evil'), 'not in the usable list');
    const next = await stash.useNext();
    ok(!next || next.id !== 'inv_evil', 'not the next feed');
    eq((await stash.get('inv_evil')).status, 'expired', 'swept as expired');
  });

  await test('imported far-future events are rejected, far-future stamps replaced: timers still start, real edits stay newest', async () => {
    const babyId = settings.get('activeBabyId');
    const local = await events.add({ type: 'feed', data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' }, startTime: Date.now() - HOUR });
    const hostile = file({ events: [
      { id: 'evt_future', type: 'sleep', startTime: Date.UTC(2090, 0, 1), endTime: null, babyId, updatedAt: Date.UTC(2099, 0, 1) },
      { ...local, note: 'from the file', updatedAt: Date.UTC(2099, 0, 1) },
    ] });
    const res = await backup.importBackup(hostile, { mode: 'merge' });
    eq(res.stats.rejected.events, 1, 'the 2090 sleep');
    eq(await events.get('evt_future'), null);
    const nap = await events.start('sleep');
    await events.stop(nap.id);
    eq((await events.last('sleep')).id, nap.id);
    const imported = await events.get(local.id);
    eq([imported.note, imported.updatedAt], ['', local.updatedAt], 'the file\'s 2099 stamp doesn\'t beat the local copy');
    const edited = await events.update(local.id, { note: 'my real edit' });
    ok(edited.updatedAt > imported.updatedAt && edited.updatedAt <= Date.now(), 'edit stamped with the real clock');
    await backup.importBackup(hostile, { mode: 'merge' });
    eq((await events.get(local.id)).note, 'my real edit', 're-importing the file no longer overwrites the edit');
  });

  await test('replace with only the family\'s settings to lose still saves a safety copy first', async () => {
    await backup.eraseAll();
    eq(await counts(), [0, 0, 0]);
    await settings.updateBaby(settings.get('activeBabyId'), { name: 'Clara', birthDate: '2026-08-01' });
    await settings.set('parentName', 'Sam');
    await settings.patch('storageWindows', { fridgeDays: 3 });
    let saved = null;
    const res = await backup.importBackup(file({ events: [], inventory: [], settings: { babies: [{ id: 'baby_other1', name: 'Max' }], parentName: 'Eve' } }), { mode: 'replace', safetyBackup: (f) => { saved = f; } });
    ok(saved && res.safetyBackup === saved.name, 'safety copy saved');
    const data = JSON.parse(await saved.text());
    eq(data.settings.babies.map(b => [b.name, b.birthDate]), [['Clara', '2026-08-01']]);
    eq([data.settings.parentName, data.settings.storageWindows.fridgeDays], ['Sam', 3]);
    eq([settings.get('babies').map(b => b.name), settings.get('parentName')], [['Max'], 'Eve'], 'then replaced');
    await backup.eraseAll();
    let called = false;
    const fresh = await backup.importBackup(file({ events: [], settings: { parentName: 'Eve' } }), { mode: 'replace', safetyBackup: () => { called = true; } });
    eq([called, fresh.safetyBackup], [false, null], 'a fresh device has nothing to protect');
  });
};

// ------------------------------------------------- regressions (round 2)

// v1's edit modal accepts any date and v1 kept + showed such records, so the
// migration must keep them too (moved to end now, flagged) and report what
// it truly could not migrate.
SUITES['migration-v1-edits'] = async () => {
  const sessions = [
    { id: 'sess_ok', type: 'feed', feedType: 'formula', startTime: NOW - 2 * HOUR, endTime: NOW - 2 * HOUR, durationSec: 0, outputQty: 4, unit: 'oz', notes: 'Formula Feeding', createdAt: NOW - 2 * HOUR },
    { id: 'sess_wrongday', type: 'feed', feedType: 'breastmilk', startTime: NOW + 3 * DAY, endTime: NOW - 5 * HOUR, durationSec: 0, outputQty: 5, unit: 'oz', notes: 'first bottle from daddy', createdAt: NOW - 5 * HOUR, updatedAt: NOW - 4 * HOUR },
    { id: 'pump_typo', type: 'pump', startTime: Date.UTC(2062, 0, 5, 9), endTime: Date.UTC(2062, 0, 5, 9, 20), durationSec: 1200, outputQty: 6, unit: 'oz', notes: '', createdAt: NOW - 6 * HOUR, updatedAt: NOW - 6 * HOUR },
    { id: 'sess_bigdur', type: 'feed', feedType: 'formula', startTime: NOW - DAY, endTime: NOW - DAY, durationSec: 1e12, outputQty: 4, unit: 'oz', notes: 'night feed', createdAt: NOW - DAY },
    { id: 'sess_nostart', type: 'feed', feedType: 'formula', outputQty: 2, unit: 'oz', notes: '' },
  ];
  const db = await rawOpen(1, v1Schema);
  await rawTx(db, ['sessions', 'settings'], 'readwrite', (tx) => {
    for (const x of sessions) tx.objectStore('sessions').put(x);
    tx.objectStore('settings').put({ key: 'babyName', value: 'Clara', updatedAt: NOW - DAY });
  });
  db.close();
  const { runMigration, CHECK_TIME_NOTE } = await import('../../../js/core/migrate.js');
  const { events } = await import('../../../js/core/store.js');

  await test('future-dated and absurd-length v1 sessions are migrated, moved to end now and flagged; the rest is reported', async () => {
    const before = Date.now();
    const report = await runMigration();
    eq([report.events, report.rejected, report.rejectedIds], [4, 1, ['sess_nostart']]);
    const all = await events.query();
    eq(all.map(e => e.migratedFrom).sort(), ['pump_typo', 'sess_bigdur', 'sess_ok', 'sess_wrongday']);
    const by = id => all.find(e => e.migratedFrom === id);
    const wrong = by('sess_wrongday');
    ok(wrong.endTime >= before && wrong.endTime <= Date.now(), 'the wrong-day feed ends now');
    eq([wrong.data.amount, wrong.note], [5, `first bottle from daddy — ${CHECK_TIME_NOTE}`]);
    const typo = by('pump_typo');
    eq([typo.endTime - typo.startTime, typo.data.amount, typo.note, typo.babyId], [20 * MIN, 6, CHECK_TIME_NOTE, null]);
    ok(typo.endTime <= Date.now(), 'the 2062 pump is not in the future');
    const big = by('sess_bigdur');
    eq([big.endTime - big.startTime, big.note], [DAY, `night feed — ${CHECK_TIME_NOTE}`]);
    eq((await events.last('feed')).migratedFrom, 'sess_wrongday', 'shows as the latest feed, where the parent can fix it');
  });
};

SUITES['data-invariants-r2'] = async () => {
  const { events } = await import('../../../js/core/store.js');
  const { stash } = await import('../../../js/core/stash.js');
  const backup = await import('../../../js/core/backup.js');
  const settings = await import('../../../js/core/settings.js');
  await settings.load();
  const file = over => JSON.stringify({ app: 'nurture', schema: 2, ...over });

  await test('stash.add/update refuse a pumpedAt that Undo and import would refuse; nothing is stored', async () => {
    for (const pumpedAt of [Date.now() + 3 * DAY, 0, Date.UTC(2062, 0, 1)]) {
      await rejects(stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt }), e => e instanceof RangeError, `pumpedAt ${pumpedAt}`);
    }
    await rejects(stash.add({ quantity: 1e6, unit: 'oz', location: 'freezer' }), e => e instanceof RangeError, 'absurd quantity');
    eq((await stash.list({ filter: 'everything' })).length, 0, 'nothing stored');
    const p = await stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: Date.now() - HOUR });
    await rejects(stash.update(p.id, { pumpedAt: Date.now() + 3 * DAY }), e => e instanceof RangeError, 'update');
    await rejects(stash.update(p.id, { expiresAt: Date.UTC(2099, 0, 1) }), e => e instanceof RangeError, 'expiry past the longest window');
    eq((await stash.get(p.id)).pumpedAt, p.pumpedAt, 'unchanged');
  });

  await test('every pouch the app stores survives Undo (remove/markUsed → restore) and its own backup', async () => {
    const skewed = await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: Date.now() + 20 * HOUR, notes: 'partner phone clock' });
    const byKey = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
    const removed = await stash.remove(skewed.id);
    eq(byKey(await stash.restore(removed)), byKey(skewed), 'remove → Undo');
    const before = await stash.get(skewed.id);
    await stash.markUsed(skewed.id);
    eq((await stash.restore(before)).status, 'active', 'markUsed → Undo');
    const thawed = await stash.thaw((await stash.list({ filter: 'frozen' }))[0].id);
    eq(byKey(await stash.restore(await stash.remove(thawed.id))), byKey(thawed), 'thawed pouch: remove → Undo');
    const json = JSON.stringify(await backup.exportBackup());
    const ids = (await stash.list({ filter: 'everything' })).map(i => i.id).sort();
    const res = await backup.importBackup(json, { mode: 'replace', safetyBackup: () => {} });
    eq([res.stats.rejected.inventory, res.warnings], [0, []], 'nothing dropped');
    eq((await stash.list({ filter: 'everything' })).map(i => i.id).sort(), ids, 'every pouch restored');
  });

  await test('a breastfeed started with the §3 shape (activeSide only) records its time', async () => {
    const start = Date.now() - 10 * MIN;
    const ev = await events.start('feed', { method: 'breast', left: 0, right: 0, lastSide: 'left', activeSide: 'left' }, { startTime: start });
    eq([ev.data.activeSide, ev.data.activeSince], ['left', start], 'the live side counts from the start');
    const done = await events.stop(ev.id);
    ok(done.data.left >= 600 && done.data.left < 620, `left = ${done.data.left}`);
    eq([done.data.right, done.data.activeSide], [0, null]);
  });

  await test('switching sides with update({ data: { activeSide } }) credits each side its own time', async () => {
    const start = Date.now() - 10 * MIN;
    const ev = await events.start('feed', { method: 'breast', activeSide: 'left', activeSince: start }, { startTime: start });
    const switched = await events.update(ev.id, { data: { activeSide: 'right' } });
    ok(switched.data.left >= 600 && switched.data.left < 620, `left banked: ${switched.data.left}`);
    eq(switched.data.activeSide, 'right');
    const done = await events.stop(ev.id);
    ok(done.data.left >= 600 && done.data.left < 620 && done.data.right < 20, `stopped: ${JSON.stringify(done.data)}`);
  });

  await test('an imported "thawed an hour ago" pouch of years-old milk is never offered as the next feed', async () => {
    const res = await backup.importBackup(file({ inventory: [{ id: 'inv_ancient', pumpedAt: Date.UTC(2021, 0, 1), quantity: 4, unit: 'oz', location: 'thawed', thawedAt: Date.now() - HOUR, expiresAt: Date.now() + 2 * DAY, status: 'active' }] }), { mode: 'merge' });
    eq(res.stats.inventory.added, 1, 'kept as a record');
    const next = await stash.useNext();
    ok(!next || next.id !== 'inv_ancient', `not the next feed (${next && next.id})`);
    ok(!(await stash.thawed()).some(x => x.id === 'inv_ancient'), 'not listed as thawed milk');
    eq((await stash.get('inv_ancient')).status, 'expired', 'swept as expired');
  });

  await test('a 120 KB backup full of huge numeric-looking strings imports in well under a second', async () => {
    const huge = `${'1'.repeat(30000)}x`;
    const good = { id: 'evt_good', type: 'diaper', startTime: Date.now() - HOUR, data: { kind: 'wet' } };
    const text = file({ events: [good, ...Array.from({ length: 4 }, (_, i) => ({ id: `evt_${i}`, type: 'diaper', startTime: huge, data: { kind: 'wet' } }))] });
    ok(text.length > 120000, `${text.length} bytes`);
    let t0 = performance.now();
    const res = await backup.importBackup(new File([text], 'b.json', { type: 'application/json' }), { mode: 'merge' });
    let ms = performance.now() - t0;
    ok(ms < 1000, `records: ${ms.toFixed(0)} ms`);
    eq([res.stats.events.added, res.stats.rejected.events], [1, 4]);
    t0 = performance.now();
    await rejects(backup.importBackup(new File([JSON.stringify({ app: 'nurture', schema: `${'1'.repeat(120000)}x` })], 'c.json'), { mode: 'merge' }), e => e.name === 'BackupError');
    ms = performance.now() - t0;
    ok(ms < 1000, `schema: ${ms.toFixed(0)} ms`);
  });
};

// Helpers for the two-tab scenarios in core.mjs: each page is one "tab" of
// the same origin (same IndexedDB). Nothing runs on its own here.
SUITES.tabs = async () => {
  window.TABS = {
    async seedV1Settings(pairs) {
      const db = await rawOpen(1, v1Schema);
      await rawTx(db, ['settings'], 'readwrite', (tx) => {
        for (const [key, value] of pairs) tx.objectStore('settings').put({ key, value, updatedAt: NOW - DAY });
      });
      db.close();
    },
    // broadcast: false = a browser without BroadcastChannel (Safari < 15.4),
    // so only the transactional writes keep this tab correct.
    async mods({ broadcast = true } = {}) {
      if (!broadcast) window.BroadcastChannel = undefined;
      TABS.migrate = await import('../../../js/core/migrate.js');
      TABS.settings = await import('../../../js/core/settings.js');
    },
    async rawSetting(key) {
      const { get } = await import('../../../js/core/db.js');
      const rec = await get('settings', key);
      return rec ? rec.value : undefined;
    },
  };
  results.push({ name: 'tab helpers ready', ok: true });
};

// Final-QA fixes against real IndexedDB (DI-01/02/03/04/11/12, FLOW-07).
SUITES['qa-fixes'] = async () => {
  const backup = await import('../../../js/core/backup.js');
  const { events } = await import('../../../js/core/store.js');
  const { stash } = await import('../../../js/core/stash.js');
  const settings = await import('../../../js/core/settings.js');
  await settings.load();
  const file = over => JSON.stringify({ app: 'nurture', schema: 2, ...over });
  const t = Date.now() - 2 * HOUR;

  await test('DI-03: onboarding-style restore of a twins backup adopts the file\'s babies + active baby (no phantom "Baby")', async () => {
    const defaultId = settings.get('activeBabyId');
    eq(settings.get('babies').length, 1);
    const twins = file({
      settings: { babies: [{ id: 'baby_ava', name: 'Ava', birthDate: '2026-09-01' }, { id: 'baby_ben', name: 'Ben', birthDate: '2026-09-01' }], activeBabyId: 'baby_ava' },
      events: [
        { id: 'evt_t1', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ava', data: { kind: 'wet' }, createdAt: t, updatedAt: t },
        { id: 'evt_t2', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ben', data: { kind: 'dirty' }, createdAt: t, updatedAt: t },
      ],
    });
    const res = await backup.importBackup(twins, { mode: 'merge' });
    eq(res.stats.events.added, 2);
    eq(settings.get('babies').map(b => b.name), ['Ava', 'Ben'], 'the untouched default baby gave way');
    ok(!settings.get('babies').some(b => b.id === defaultId), 'no phantom baby');
    eq(settings.get('activeBabyId'), 'baby_ava', 'the file\'s active baby');
  });

  await test('DI-04: babyMatches answers "Is Clara Rose the same baby as Ava?" — same baby or a new one, named in stats', async () => {
    const partner = (id, name) => file({
      settings: { babies: [{ id, name, birthDate: '2026-09-01' }], activeBabyId: id },
      events: [{ id: `evt_${id}`, type: 'diaper', startTime: t, endTime: t, babyId: id, data: { kind: 'wet' }, createdAt: t, updatedAt: t }],
    });
    // Two local babies now: no question (twins never guessed).
    eq(await backup.previewBabyQuestion(partner('baby_rose', 'Ava Rose')), null);
    await settings.set('babies', settings.get('babies').slice(0, 1));
    const q = await backup.previewBabyQuestion(partner('baby_rose', 'Ava Rose'));
    eq(q, { local: { id: 'baby_ava', name: 'Ava' }, incoming: { id: 'baby_rose', name: 'Ava Rose' } });
    const same = await backup.importBackup(partner('baby_rose', 'Ava Rose'), { mode: 'merge', babyMatches: { baby_rose: 'baby_ava' } });
    eq([same.stats.babies.added, (await events.get('evt_baby_rose')).babyId], [0, 'baby_ava'], 'same baby: entries land on Ava');
    const sib = await backup.importBackup(partner('baby_sib', 'Ava Lee'), { mode: 'merge', babyMatches: { baby_sib: null } });
    eq(sib.stats.babies.addedBabies, [{ id: 'baby_sib', name: 'Ava Lee' }], 'new baby is named in the result');
    eq(settings.get('babies').map(b => b.name), ['Ava', 'Ava Lee']);
  });

  await test('FLOW-07: merge brings the file\'s memory cover for a baby with none here', async () => {
    const mem = { id: 'evt_mem1', type: 'milestone', startTime: t, endTime: t, babyId: 'baby_ava', note: 'First smile', data: { title: 'First smile' }, createdAt: t, updatedAt: t };
    eq(settings.get('memoryCovers'), {});
    const res = await backup.importBackup(file({ settings: { babies: [{ id: 'baby_ava', name: 'Ava' }], memoryCovers: { baby_ava: 'evt_mem1', baby_ghost: 'evt_mem1' } }, events: [mem] }), { mode: 'merge' });
    eq(settings.get('memoryCovers'), { baby_ava: 'evt_mem1' }, 'cover adopted; unknown baby ignored');
    ok(res.stats.settings.includes('memoryCovers'), 'listed in stats.settings');
    await backup.importBackup(file({ settings: { babies: [{ id: 'baby_ava', name: 'Ava' }], memoryCovers: { baby_ava: 'evt_other' } }, events: [{ ...mem, id: 'evt_other' }] }), { mode: 'merge' });
    eq(settings.get('memoryCovers'), { baby_ava: 'evt_mem1' }, 'local cover wins');
  });

  await test('DI-02: an imported 10-day-old fridge pouch and a 60 h thawed pouch are expired under this phone\'s windows', async () => {
    await backup.importBackup(file({
      inventory: [
        { id: 'inv_ancient', location: 'fridge', pumpedAt: Date.now() - 10 * DAY, quantity: 4, unit: 'oz', status: 'active', expiresAt: Date.UTC(2100, 0, 1) },
        { id: 'inv_thawtrick', location: 'thawed', pumpedAt: Date.now() - 20 * DAY, thawedAt: Date.now() - 60 * HOUR, quantity: 4, unit: 'oz', status: 'active', expiresAt: Date.UTC(2100, 0, 1) },
        { id: 'inv_fine', location: 'fridge', pumpedAt: Date.now() - DAY, quantity: 4, unit: 'oz', status: 'active', expiresAt: Date.now() + 3 * DAY },
      ],
    }), { mode: 'merge' });
    ok((await stash.get('inv_ancient')).expiresAt < Date.now(), 'fridge 4 days here → expired');
    ok((await stash.get('inv_thawtrick')).expiresAt < Date.now(), 'thawed 24 h here → expired');
    ok((await stash.get('inv_fine')).expiresAt > Date.now(), 'a good pouch stays good');
    const next = await stash.useNext();
    ok(!next || !['inv_ancient', 'inv_thawtrick'].includes(next.id), 'never offered as Use next');
  });

  await test('DI-12: a merged 300-day-old running sleep comes in stopped', async () => {
    const res = await backup.importBackup(file({ events: [{ id: 'evt_x6', type: 'sleep', startTime: Date.now() - 300 * DAY, endTime: null, babyId: 'baby_ava', data: { kind: 'nap' }, createdAt: t, updatedAt: t }] }), { mode: 'merge' });
    const e = await events.get('evt_x6');
    eq([e.endTime === e.startTime, res.stats.events.stoppedStale], [true, 1]);
    ok(!(await events.running()).some(r => r.id === 'evt_x6'), 'no 7200-hour pill');
  });

  await test('DI-11: merging an unreadable file is refused, not "Already up to date"', async () => {
    const before = (await events.query()).length;
    for (const bad of [{ events: { a: 1 }, inventory: 'x', photos: 5 }, { events: [[[[1]]]] }]) {
      const err = await rejects(backup.importBackup(file(bad), { mode: 'merge' }), e => e.name === 'BackupError', JSON.stringify(bad));
      ok(/couldn’t be read, so nothing was merged/.test(err.message), err.message);
    }
    eq((await events.query()).length, before, 'nothing touched');
    const partly = await backup.importBackup(file({ events: [{ id: 'evt_ok1', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ava', data: { kind: 'wet' } }, { id: 'evt_bad', type: 'telemetry', startTime: t }] }), { mode: 'merge' });
    eq([partly.stats.events.added, partly.stats.rejected.events], [1, 1], 'a partly readable file merges and counts what it skipped');
  });

  await test('DI-01: Replace keeps a copy of this phone in IndexedDB even when the download never lands, and can undo', async () => {
    const before = (await events.query()).map(e => e.id).sort();
    const babiesBefore = settings.get('babies').map(b => b.id);
    ok(before.length > 3);
    eq(await backup.getSafetyCopy(), null);
    // The download "succeeds" (a.click) but nothing is saved: modelled by a no-op.
    const res = await backup.importBackup(file({ events: [{ id: 'evt_only', type: 'diaper', startTime: t, endTime: t, data: { kind: 'wet' } }], inventory: [], settings: { babies: [{ id: 'baby_z', name: 'Zed' }] } }), { mode: 'replace', safetyBackup: () => {} });
    eq([res.safetyKept, (await events.query()).length], [true, 1], 'replaced, and the copy was kept');
    const copy = await backup.getSafetyCopy();
    ok(copy && copy.blob.size > 100 && /before-import/.test(copy.name), 'copy kept on this phone');
    const exported = await backup.exportBackup();
    ok(!('safetyCopy' in exported.settings), 'the kept copy never goes into a backup');
    await backup.restoreSafetyCopy();
    eq((await events.query()).map(e => e.id).sort(), before, 'Undo puts every entry back');
    ok(babiesBefore.every(id => settings.get('babies').some(b => b.id === id)) && !settings.get('babies').some(b => b.id === 'baby_z'), 'and the babies');
    eq(await backup.getSafetyCopy(), null, 'the copy is forgotten after use');
    await rejects(backup.restoreSafetyCopy(), e => e.name === 'BackupError');
  });
};

// ------------------------------------------------------------------- run

(async () => {
  try {
    if (!SUITES[suite]) throw new Error(`unknown suite ${suite}`);
    await SUITES[suite]();
  } catch (err) {
    results.push({ name: `suite ${suite} crashed`, ok: false, error: String((err && err.stack) || err) });
  }
  window.__results = results;
  window.__done = true;
})();
