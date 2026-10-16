// Migration probe helpers. Everything is exposed on window.P for the driver.
const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;
const NOW = Date.now();
function rawOpen(version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open('NurtureDB', version) : indexedDB.open('NurtureDB');
    if (upgrade) req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.log('raw open blocked');
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
function v1Schema(db) {
  const s = db.createObjectStore('sessions', { keyPath: 'id' });
  s.createIndex('type', 'type'); s.createIndex('startTime', 'startTime'); s.createIndex('createdAt', 'createdAt');
  const i = db.createObjectStore('inventory', { keyPath: 'id' });
  i.createIndex('status', 'status'); i.createIndex('expiresAt', 'expiresAt'); i.createIndex('pumpedAt', 'pumpedAt'); i.createIndex('location', 'location');
  const b = db.createObjectStore('bottles', { keyPath: 'id' });
  b.createIndex('status', 'status'); b.createIndex('expiresAt', 'expiresAt');
  db.createObjectStore('settings', { keyPath: 'key' });
}
const P = {
  NOW,
  async seed({ sessions = [], inventory = [], settings = [], ls = {}, keepOpen = false } = {}) {
    const db = await rawOpen(1, v1Schema);
    await rawTx(db, ['sessions', 'inventory', 'settings'], 'readwrite', (tx) => {
      for (const s of sessions) tx.objectStore('sessions').put(s);
      for (const i of inventory) tx.objectStore('inventory').put(i);
      for (const [key, value] of settings) tx.objectStore('settings').put({ key, value, updatedAt: NOW - DAY });
    });
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    if (keepOpen) { P._v1 = db; return 'kept open (no onversionchange, like v1)'; }
    db.close();
    return 'seeded';
  },
  async rawDump() {
    const db = await rawOpen();
    const names = [...db.objectStoreNames];
    const out = await rawTx(db, names, 'readonly', (tx, done) => {
      const o = {};
      for (const n of names) { const r = tx.objectStore(n).getAll(); r.onsuccess = () => { o[n] = r.result; done(o); }; }
    });
    db.close();
    return out;
  },
  async mods() {
    P.migrate = await import('../../../../js/core/migrate.js');
    P.settings = (await import('../../../../js/core/settings.js')).settings;
    P.stash = (await import('../../../../js/core/stash.js')).stash;
    P.events = (await import('../../../../js/core/store.js')).events;
    P.db = await import('../../../../js/core/db.js');
    P.trends = await import('../../../../js/domain/trends.js');
    return 'ok';
  },
};
window.P = P;
window.__ready = true;
