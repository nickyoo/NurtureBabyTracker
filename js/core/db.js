// IndexedDB v2 wrapper — the ONLY module that talks to IndexedDB directly.
// Everything else goes through core/store.js, core/stash.js, core/photos.js
// and core/settings.js (ARCHITECTURE §2–§4).
//
// Why callbacks instead of awaiting inside transactions: an IDB transaction
// auto-commits as soon as it has no pending requests at the end of a task.
// Older Safari builds committed across promise microtasks too, so a
// read-modify-write written with `await` between the read and the write could
// commit in the middle and race another writer. `transaction()` below keeps
// each read-modify-write inside request callbacks, so it is atomic everywhere.

/** Same database as v1, so the upgrade happens in place (§3). */
export const DB_NAME = 'NurtureDB';
/** v1 was 1. Opening at 2 runs upgradeSchema(); v1 code can no longer open it. */
export const DB_VERSION = 2;

/** Store names, so callers never hand-type them. */
export const STORES = Object.freeze({
  events: 'events',
  inventory: 'inventory',
  photos: 'photos',
  settings: 'settings',
  sessions: 'sessions', // v1, read-only legacy (kept one release for rollback)
  bottles: 'bottles',   // v1, unused legacy
});

/**
 * Collision-safe ID generator. Prefers crypto.randomUUID(); falls back to a
 * timestamp + random suffix where it is unavailable (insecure contexts).
 * @param {string} prefix e.g. 'evt', 'inv', 'pho', 'dev'
 * @returns {string}
 */
export function newId(prefix) {
  const suffix = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10));
  return `${prefix}_${suffix}`;
}

/**
 * Schema upgrade, run inside the versionchange transaction. Idempotent
 * (ensure-style), so it is correct from any old version, including 0. It only ever CREATES stores/indexes — it never
 * deletes or rewrites a v1 store, so a v1 → v2 upgrade cannot lose data.
 * The v1 sessions → v2 events copy happens later in core/migrate.js, in a
 * normal transaction that also flips settings.migratedV2 (exactly-once).
 * @param {IDBDatabase} db
 * @param {IDBTransaction} tx the versionchange transaction
 */
export function upgradeSchema(db, tx) {
  const ensureStore = (name, opts) => (db.objectStoreNames.contains(name)
    ? tx.objectStore(name)
    : db.createObjectStore(name, opts));
  const ensureIndex = (store, name, keyPath) => {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
  };

  // v1 stores — created on a fresh install too, so migrate.js can always read
  // them and the v1 shape stays documented in one place.
  const sessions = ensureStore(STORES.sessions, { keyPath: 'id' });
  ensureIndex(sessions, 'type', 'type');
  ensureIndex(sessions, 'startTime', 'startTime');
  ensureIndex(sessions, 'createdAt', 'createdAt');

  const inventory = ensureStore(STORES.inventory, { keyPath: 'id' });
  ensureIndex(inventory, 'status', 'status');
  ensureIndex(inventory, 'expiresAt', 'expiresAt');
  ensureIndex(inventory, 'pumpedAt', 'pumpedAt');
  ensureIndex(inventory, 'location', 'location');

  const bottles = ensureStore(STORES.bottles, { keyPath: 'id' });
  ensureIndex(bottles, 'status', 'status');
  ensureIndex(bottles, 'expiresAt', 'expiresAt');

  ensureStore(STORES.settings, { keyPath: 'key' });

  // v2 stores. Note: `endTime: null` (running) is not a valid IDB key, so
  // running events are absent from the endTime index — store.js finds them
  // through the `type` index instead.
  const events = ensureStore(STORES.events, { keyPath: 'id' });
  ensureIndex(events, 'type', 'type');
  ensureIndex(events, 'startTime', 'startTime');
  ensureIndex(events, 'type_startTime', ['type', 'startTime']);
  ensureIndex(events, 'endTime', 'endTime');

  const photos = ensureStore(STORES.photos, { keyPath: 'id' });
  ensureIndex(photos, 'createdAt', 'createdAt');
}

let dbPromise = null;
const blockedListeners = new Set();

/**
 * Register a callback for when the v2 upgrade is blocked by another open tab
 * still holding a v1 connection (the UI can say "close other Nurture tabs").
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onDbBlocked(fn) {
  blockedListeners.add(fn);
  return () => blockedListeners.delete(fn);
}

/**
 * Open (once) and return the v2 database. Safe to call from anywhere in core.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => upgradeSchema(request.result, request.transaction);
    request.onblocked = () => {
      for (const fn of blockedListeners) {
        try { fn(); } catch (e) { console.error(e); }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab is upgrading past us: let it, and reopen lazily next call
      // (which will then fail loudly with VersionError → user reloads).
      db.onversionchange = () => { db.close(); dbPromise = null; };
      // The browser can close the connection under storage pressure.
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  // Don't cache a failed open forever (e.g. transient blocked/aborted upgrade).
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/**
 * Close the cached connection (tests / erase-all). The next call reopens.
 * @returns {Promise<void>}
 */
export async function closeDB() {
  if (!dbPromise) return;
  try { (await dbPromise).close(); } catch { /* already closed */ }
  dbPromise = null;
}

/**
 * Run `body` inside ONE transaction and resolve after it commits.
 * `body(stores, ctx)` issues requests synchronously or from request
 * callbacks; it reports its result with `ctx.done(value)` and can abort with
 * `ctx.fail(error)` (the promise then rejects with that error and nothing
 * the body wrote is kept).
 * @template T
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(stores: Record<string, IDBObjectStore>, ctx: {done:(v:T)=>void, fail:(e:Error)=>void, tx: IDBTransaction}) => void} body
 * @returns {Promise<T>}
 */
export async function transaction(storeNames, mode, body) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = {};
    for (const n of names) stores[n] = tx.objectStore(n);
    let result;
    let failure = null;
    const ctx = {
      tx,
      done(v) { result = v; },
      fail(err) {
        failure = err || new Error('Transaction aborted');
        try { tx.abort(); } catch { /* already finished */ }
      },
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('Transaction aborted'));
    // A failed request aborts the transaction; remember its concrete error so
    // onabort rejects with something more useful than a bare AbortError.
    tx.onerror = (e) => {
      if (!failure) failure = (e && e.target && e.target.error) || tx.error;
    };
    try {
      body(stores, ctx);
    } catch (err) {
      ctx.fail(err);
    }
  });
}

/**
 * All records in a store (optionally via an index + key/range).
 * @param {string} store
 * @param {{ index?: string, query?: IDBValidKey|IDBKeyRange }} [opts]
 * @returns {Promise<any[]>}
 */
export function getAll(store, { index, query } = {}) {
  return transaction(store, 'readonly', (s, ctx) => {
    const source = index ? s[store].index(index) : s[store];
    const req = source.getAll(query);
    req.onsuccess = () => ctx.done(req.result || []);
  });
}

/**
 * One record by key, or undefined.
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<any>}
 */
export function get(store, key) {
  return transaction(store, 'readonly', (s, ctx) => {
    const req = s[store].get(key);
    req.onsuccess = () => ctx.done(req.result);
  });
}

/**
 * Put one record; resolves with the record after commit.
 * @param {string} store
 * @param {object} value
 * @returns {Promise<object>}
 */
export function put(store, value) {
  return transaction(store, 'readwrite', (s, ctx) => {
    s[store].put(value);
    ctx.done(value);
  });
}

/**
 * Put many records in one transaction (all or nothing).
 * @param {string} store
 * @param {object[]} values
 * @returns {Promise<number>} count written
 */
export function putMany(store, values) {
  return transaction(store, 'readwrite', (s, ctx) => {
    for (const v of values) s[store].put(v);
    ctx.done(values.length);
  });
}

/**
 * Delete one record by key.
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<void>}
 */
export function del(store, key) {
  return transaction(store, 'readwrite', (s) => { s[store].delete(key); });
}

/**
 * Clear one or more stores in a single transaction.
 * @param {string|string[]} stores
 * @returns {Promise<void>}
 */
export function clear(stores) {
  const names = Array.isArray(stores) ? stores : [stores];
  return transaction(names, 'readwrite', (s) => {
    for (const n of names) s[n].clear();
  });
}
