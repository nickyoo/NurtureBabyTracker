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
    eq([s.profile.babyName, s.profile.parentName, s.profile.birthDate], ['Clara', 'Nick', null]);
    ok(!('dailyPumpingGoal' in s) && !('preferredUnit' in s) && !('reminderIntervalHours' in s), 'junk keys not surfaced');
  });

  await test('live timers became running events; keys removed', async () => {
    const live = await events.running();
    eq(live.length, 2);
    const pump = live.find(e => e.type === 'pump');
    const feed = live.find(e => e.type === 'feed');
    eq([pump.startTime, pump.endTime, pump.data.amount, pump.data.unit, pump.data.storedTo], [NOW - 10 * MIN, null, null, 'mL', 'freezer']);
    eq([feed.startTime, feed.data.method, feed.data.milk, feed.data.prepared, feed.data.unit, feed.data.sourceInventoryId],
      [NOW - 5 * MIN, 'bottle', 'breastmilk', 118, 'mL', THAWED_ID]);
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
  await test('after reload: migration skipped, data intact, running pump survived', async () => {
    const r = await runMigration();
    eq(r.skipped, true);
    eq((await rawCounts()).events, 8);
    const live = await events.running();
    eq(live.map(e => e.type), ['pump']);
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
  await test('defaults + generated deviceId', async () => {
    const all = await settings.load();
    eq([all.units, all.theme, all.sound, all.pumpGoalOz, all.pumpIntervalMinutes, all.onboarded, all.migratedV2],
      ['oz', 'auto', 'night-off', 24, 180, false, false]);
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
    await settings.patch('profile', { babyName: 'Clara', birthDate: '2026-08-01' });
    eq(settings.get('profile').birthDate, '2026-08-01');
    eq(seen, ['units', 'trackers', 'profile']);
    await rejects(settings.set('units', 'cups'), e => e instanceof TypeError);
    await rejects(settings.set('__proto__', 1), e => e instanceof TypeError);
    const t = settings.get('trackers'); t.pump = true;
    eq(settings.get('trackers').pump, false, 'get() hands out copies');
    off();
  });
};

SUITES['settings-reload'] = async () => {
  const settings = await import('../../../js/core/settings.js');
  await test('settings + deviceId persist across reload', async () => {
    const all = await settings.load();
    eq(all.deviceId, localStorage.getItem('deviceIdSeen'));
    eq([all.units, all.trackers.pump, all.profile.babyName], ['mL', false, 'Clara']);
  });
};

SUITES.backup = async () => {
  const backup = await import('../../../js/core/backup.js');
  const { events } = await import('../../../js/core/store.js');
  const { stash } = await import('../../../js/core/stash.js');
  const photos = await import('../../../js/core/photos.js');
  const settings = await import('../../../js/core/settings.js');
  await settings.load();
  await settings.patch('profile', { babyName: 'Clara' });

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
    ok(!('deviceId' in data.settings) && !('migratedV2' in data.settings) && !('iconDataUrl' in data.settings), 'per-install keys not exported');
    eq(data.settings.profile.babyName, 'Clara');
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
    ok(lines.some(l => l.includes('"Feed"') && l.includes('"118"') && l.includes('"mL"')), '4 oz shown as 118 mL');
    ok(text.includes(`"'=HYPERLINK(""http://x"")"`), 'formula neutralised and quotes doubled');
    ok(text.includes('(in progress)'), 'running sleep marked');
  });

  await test('eraseAll + import(replace) restores everything incl. photos', async () => {
    await backup.eraseAll();
    eq((await events.query()).length, 0);
    eq((await stash.list({ filter: 'everything' })).length, 0);
    eq((await photos.usage()).count, 0);
    const res = await backup.importBackup(new File([json], 'b.json', { type: 'application/json' }), { mode: 'replace' });
    eq([res.format, res.stats.events.added, res.stats.inventory.added, res.stats.photos.added], ['v2', 4, 1, 1]);
    eq((await events.query()).length, 4);
    eq((await events.get(feed.id)).note, '=HYPERLINK("http://x")', 'stored as plain text');
    eq((await stash.get(pouch.id)).quantity, 120);
    const url = await photos.get(ph.id);
    eq((await loadImage(url)).naturalWidth, 400);
    eq(settings.get('profile').babyName, 'Clara');
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
    ok(res.warnings.length >= 1, 'bottles warning');
  });

  await test('bad files fail with a friendly BackupError', async () => {
    await rejects(backup.importBackup('{not json'), e => e.name === 'BackupError');
    await rejects(backup.importBackup('{"app":"nurture","schema":3}'), e => e.name === 'BackupError' && /newer/.test(e.message));
    await rejects(backup.importBackup('[1,2,3]'), e => e.name === 'BackupError');
    await rejects(backup.importBackup('{}', { mode: 'nuke' }), e => e.name === 'BackupError');
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
