// core/db.js — id generation and the schema upgrade, against a tiny fake of
// the IndexedDB schema API (the real upgrade of a seeded v1 database runs in
// Chromium: tests/e2e/core.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, upgradeSchema, DB_NAME, DB_VERSION, STORES } from '../js/core/db.js';

test('DB stays "NurtureDB", now version 2', () => {
  assert.equal(DB_NAME, 'NurtureDB');
  assert.equal(DB_VERSION, 2);
  assert.deepEqual(Object.keys(STORES).sort(), ['bottles', 'events', 'inventory', 'photos', 'sessions', 'settings']);
});

test('newId: prefixed, unique, safe characters (ported v1 case)', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => newId('evt')));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^evt_[A-Za-z0-9-]+$/);
  const saved = globalThis.crypto;
  try {
    // Insecure contexts have no crypto.randomUUID: the fallback must still be unique.
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const fallback = new Set(Array.from({ length: 2000 }, () => newId('inv')));
    assert.equal(fallback.size, 2000);
    for (const id of fallback) assert.match(id, /^inv_[a-z0-9]+$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true });
  }
});

// Minimal fake: object stores with index names; records which calls happen.
function fakeDb(existing = {}) {
  const calls = [];
  const stores = new Map();
  const makeStore = (name, opts, indexes = []) => {
    const set = new Set(indexes);
    const store = {
      name, opts,
      indexNames: { contains: n => set.has(n) },
      createIndex(n, keyPath, o) { calls.push(['createIndex', name, n, keyPath, o.unique]); set.add(n); },
      deleteIndex() { calls.push(['deleteIndex', name]); },
      clear() { calls.push(['clear', name]); },
      indexes: set,
    };
    stores.set(name, store);
    return store;
  };
  for (const [name, idx] of Object.entries(existing)) makeStore(name, { keyPath: name === 'settings' ? 'key' : 'id' }, idx);
  const db = {
    objectStoreNames: { contains: n => stores.has(n) },
    createObjectStore(name, opts) { calls.push(['createObjectStore', name, opts.keyPath]); return makeStore(name, opts); },
    deleteObjectStore(name) { calls.push(['deleteObjectStore', name]); },
  };
  const tx = { objectStore: n => stores.get(n) };
  return { db, tx, calls, stores };
}

const V1 = {
  sessions: ['type', 'startTime', 'createdAt'],
  inventory: ['status', 'expiresAt', 'pumpedAt', 'location'],
  bottles: ['status', 'expiresAt'],
  settings: [],
};

test('upgradeSchema v1 → v2: only ADDS events + photos; never deletes or clears v1 stores', () => {
  const { db, tx, calls, stores } = fakeDb(V1);
  upgradeSchema(db, tx);
  assert.ok(!calls.some(c => c[0] === 'deleteObjectStore' || c[0] === 'deleteIndex' || c[0] === 'clear'), 'nothing destructive');
  assert.deepEqual(calls.filter(c => c[0] === 'createObjectStore').map(c => c[1]), ['events', 'photos']);
  assert.deepEqual([...stores.get('events').indexes].sort(), ['endTime', 'startTime', 'type', 'type_startTime']);
  assert.ok(calls.some(c => c[0] === 'createIndex' && c[2] === 'type_startTime' && JSON.stringify(c[3]) === '["type","startTime"]'), 'compound index');
  assert.deepEqual([...stores.get('photos').indexes], ['createdAt']);
  assert.ok(calls.filter(c => c[0] === 'createIndex').every(c => c[4] === false), 'no unique indexes');
});

test('upgradeSchema on a fresh install creates every store (v1 legacy ones too)', () => {
  const { db, tx, calls, stores } = fakeDb();
  upgradeSchema(db, tx);
  assert.deepEqual(calls.filter(c => c[0] === 'createObjectStore').map(c => [c[1], c[2]]),
    [['sessions', 'id'], ['inventory', 'id'], ['bottles', 'id'], ['settings', 'key'], ['events', 'id'], ['photos', 'id']]);
  assert.deepEqual([...stores.get('inventory').indexes], V1.inventory, 'inventory keeps the v1 indexes (§3: unchanged shape)');
});

test('upgradeSchema is idempotent (re-running on v2 creates nothing)', () => {
  const { db, tx, stores } = fakeDb(V1);
  upgradeSchema(db, tx);
  const again = fakeDb(Object.fromEntries([...stores].map(([n, s]) => [n, [...s.indexes]])));
  upgradeSchema(again.db, again.tx);
  assert.deepEqual(again.calls, []);
});
