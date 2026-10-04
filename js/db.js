// IndexedDB Storage Layer for Nurture PWA
const DB_NAME = 'NurtureDB';
const DB_VERSION = 1;

// Collision-safe ID generator. Prefers crypto.randomUUID(); falls back to a
// timestamp + random suffix on contexts where it is unavailable (e.g. file://).
export function newId(prefix) {
  const suffix = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  return `${prefix}_${suffix}`;
}

// The record field IndexedDB uses as each store's primary key.
const STORE_KEYS = { sessions: 'id', inventory: 'id', bottles: 'id', settings: 'key' };

/**
 * Check a parsed backup file BEFORE anything is changed. Throws a human-readable Error if it
 * isn't something importBackup can safely apply. (A restore replaces everything, so a file that
 * only fails halfway through must never get the chance to start.)
 */
export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.version) {
    throw new Error('Invalid backup file format.');
  }
  for (const [store, keyField] of Object.entries(STORE_KEYS)) {
    const list = data[store];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new Error(`Backup is damaged: "${store}" should be a list.`);
    list.forEach((record, i) => {
      const key = record && typeof record === 'object' ? record[keyField] : undefined;
      if ((typeof key !== 'string' && typeof key !== 'number') || key === '') {
        throw new Error(`Backup is damaged: ${store} entry ${i + 1} has no "${keyField}".`);
      }
    });
  }
  return true;
}

class Database {
  constructor() {
    this.db = null;
    this.ready = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Sessions store (feeding & pumping logs)
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('type', 'type', { unique: false });
          sessionStore.createIndex('startTime', 'startTime', { unique: false });
          sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 2. Inventory store (stored milk in fridge / freezer)
        if (!db.objectStoreNames.contains('inventory')) {
          const invStore = db.createObjectStore('inventory', { keyPath: 'id' });
          invStore.createIndex('status', 'status', { unique: false });
          invStore.createIndex('expiresAt', 'expiresAt', { unique: false });
          invStore.createIndex('pumpedAt', 'pumpedAt', { unique: false });
          invStore.createIndex('location', 'location', { unique: false });
        }

        // 3. Bottles store (prepared bottles, thawed vs started)
        if (!db.objectStoreNames.contains('bottles')) {
          const bottleStore = db.createObjectStore('bottles', { keyPath: 'id' });
          bottleStore.createIndex('status', 'status', { unique: false });
          bottleStore.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        // 4. Settings store (key-value)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async _tx(storeName, mode = 'readonly') {
    await this.ready;
    const tx = this.db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    return { tx, store };
  }

  // --- Generic Store Operations ---
  async getAll(storeName) {
    const { store } = await this._tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async get(storeName, key) {
    const { store } = await this._tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(storeName, item) {
    const { store } = await this._tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(storeName, key) {
    const { store } = await this._tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(storeName) {
    const { store } = await this._tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Settings API ---
  async getSetting(key, defaultValue = null) {
    try {
      const record = await this.get('settings', key);
      return record !== undefined && record !== null ? record.value : defaultValue;
    } catch (e) {
      console.warn('Failed to read setting', key, e);
      return defaultValue;
    }
  }

  async setSetting(key, value) {
    return this.put('settings', { key, value, updatedAt: Date.now() });
  }

  async getAllSettings() {
    const records = await this.getAll('settings');
    const map = {};
    for (const r of records) {
      map[r.key] = r.value;
    }
    return map;
  }

  // --- Sessions API ---
  async getSessions() {
    const sessions = await this.getAll('sessions');
    // Sort descending by startTime (newest first)
    return sessions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  }

  async getLastFeedSession() {
    const sessions = await this.getSessions();
    return sessions.find(s => s.type === 'feed') || null;
  }

  async getLastPumpSession() {
    const sessions = await this.getSessions();
    return sessions.find(s => s.type === 'pump') || null;
  }

  async addSession(session) {
    if (!session.id) session.id = newId('sess');
    if (!session.createdAt) session.createdAt = Date.now();
    return this.put('sessions', session);
  }

  // --- Inventory API ---
  async getInventory(includeArchived = false) {
    const items = await this.getAll('inventory');
    const now = Date.now();

    // Auto-update status if expired and still active
    const processed = [];
    for (const item of items) {
      if (item.status === 'active' && item.expiresAt <= now) {
        item.status = 'expired';
        await this.put('inventory', item);
      }
      processed.push(item);
    }

    const filtered = includeArchived 
      ? processed 
      : processed.filter(i => i.status === 'active');

    // FIFO sorting: Oldest pumpedAt first!
    return filtered.sort((a, b) => a.pumpedAt - b.pumpedAt);
  }

  async addInventoryItem(item) {
    if (!item.id) item.id = newId('inv');
    if (!item.createdAt) item.createdAt = Date.now();
    if (!item.status) item.status = 'active';
    return this.put('inventory', item);
  }

  // --- Bottles API ---
  async getBottles(includeArchived = false) {
    const bottles = await this.getAll('bottles');
    const now = Date.now();

    const processed = [];
    for (const b of bottles) {
      if ((b.status === 'unstarted' || b.status === 'inProgress') && b.expiresAt <= now) {
        b.status = 'expired';
        await this.put('bottles', b);
      }
      processed.push(b);
    }

    const filtered = includeArchived
      ? processed
      : processed.filter(b => b.status === 'unstarted' || b.status === 'inProgress');

    // Sort by expiration ascending (most urgent first)
    return filtered.sort((a, b) => a.expiresAt - b.expiresAt);
  }

  async addBottle(bottle) {
    if (!bottle.id) bottle.id = newId('bot');
    if (!bottle.status) bottle.status = 'unstarted';
    return this.put('bottles', bottle);
  }

  // --- Backup & Restore ---
  async exportBackup() {
    const sessions = await this.getAll('sessions');
    const inventory = await this.getAll('inventory');
    const bottles = await this.getAll('bottles');
    const settings = await this.getAll('settings');
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      inventory,
      bottles,
      settings
    };
  }

  // All-or-nothing: the clear + every write happen in ONE transaction, so if anything fails the
  // browser rolls the whole thing back and the person's existing data is untouched. (It used to
  // clear each store first and write afterwards, so a bad file wiped everything and then errored.)
  async importBackup(data) {
    validateBackup(data);
    await this.ready;
    const stores = Object.keys(STORE_KEYS);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('Restore failed; your existing data is untouched.'));
      tx.onabort = () => reject(tx.error || new Error('Restore was cancelled; your existing data is untouched.'));
      try {
        for (const name of stores) {
          const store = tx.objectStore(name);
          store.clear();
          for (const record of data[name] || []) store.put(record);
        }
      } catch (err) {
        try { tx.abort(); } catch { /* already finished */ }
        reject(err);
      }
    });
  }

  async resetAllData() {
    await this.clear('sessions');
    await this.clear('inventory');
    await this.clear('bottles');
    await this.clear('settings');
    // Set standard fresh defaults (under the same keys App.loadSettings() reads back)
    await this.setSetting('dailyGoalOz', 24);
    await this.setSetting('units', 'oz');
    await this.setSetting('pumpIntervalMinutes', 180);
    await this.setSetting('themeMode', 'auto');
    await this.setSetting('parentName', '');
    await this.setSetting('babyName', '');
    await this.setSetting('onboarding_completed', false);
    return true;
  }
}

export const db = new Database();
