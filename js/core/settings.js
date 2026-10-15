// Settings + profile + tracker visibility (ARCHITECTURE §6).
//
// Values live in the `settings` store as { key, value, updatedAt } and are
// cached in memory after `load()`, so `get()` is synchronous and views can
// render without awaiting. app.js must `await settings.load()` (directly or
// via migrate.runMigration) before mounting views; before that, get() returns
// defaults.
//
// Every known key has a sanitizer. set() throws on a bad value (a UI bug we
// want to see); reads and imports fall back to the default instead, so a
// corrupt or hostile stored value can never reach the UI as-is.

import { transaction, getAll, STORES, newId } from './db.js';
import { DEFAULT_STORAGE_WINDOWS } from '../domain/inventory.js';
import { toFiniteNumber } from './units.js';

/** Trackers that Settings → Customize can hide (hidden ≠ deleted). */
export const TRACKER_KEYS = Object.freeze(['bottle', 'formula', 'breastfeeding', 'pump', 'stash', 'sleep', 'diaper', 'memories']);
/** Cards on Today, in their default order. */
export const TODAY_CARDS = Object.freeze(['feed', 'sleep', 'diaper', 'pump', 'stash']);

/** §6 defaults. Treat as read-only; get() hands out copies. */
export const DEFAULTS = deepFreeze({
  profile: { babyName: '', birthDate: null, photoId: null, parentName: '' },
  units: 'oz',
  theme: 'auto',
  trackers: Object.fromEntries(TRACKER_KEYS.map(k => [k, true])),
  todayOrder: [...TODAY_CARDS],
  pumpGoalOz: 24,
  pumpIntervalMinutes: 180,
  storageWindows: { ...DEFAULT_STORAGE_WINDOWS },
  sound: 'night-off',
  deviceId: null,
  onboarded: false,
  migratedV2: false,
  iconDataUrl: null, // §10: 180×180 PNG of the baby photo for apple-touch-icon
});

/** Keys a backup may carry. deviceId / migratedV2 are per-install state;
 * iconDataUrl is per-device and derived from the photo. */
export const EXPORTABLE_KEYS = Object.freeze(['profile', 'units', 'theme', 'trackers', 'todayOrder', 'pumpGoalOz', 'pumpIntervalMinutes', 'storageWindows', 'sound', 'onboarded']);

const STORAGE_WINDOW_RANGES = Object.freeze({
  roomTempHours: [1, 24],
  fridgeDays: [1, 14],
  freezerMonths: [1, 24],
  deepFreezerMonths: [1, 24],
  thawedBottleHours: [1, 72],
  startedBottleHours: [1, 24],
});

const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const own = (o, k) => (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = error => ({ ok: false, error });
const pass = value => ({ ok: true, value });

/**
 * Plain-text cleanup for user strings: drops control characters (keeps
 * newlines/tabs) and caps the length. Never escapes — rendering does that.
 * @param {unknown} v
 * @param {number} max
 * @returns {string}
 */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // Slice first so a 10 MB string costs nothing more than the cap.
  // eslint-disable-next-line no-control-regex
  return v.slice(0, max * 2).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

/**
 * Validate one setting. Pure.
 * @param {string} key
 * @param {unknown} value
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
export function sanitizeSetting(key, value) {
  switch (key) {
    case 'profile': {
      if (!isPlainObject(value)) return fail('profile must be an object');
      const birth = own(value, 'birthDate');
      const photo = own(value, 'photoId');
      return pass({
        babyName: cleanText(own(value, 'babyName'), 100),
        birthDate: typeof birth === 'string' && isValidDateString(birth) ? birth : null,
        photoId: typeof photo === 'string' && ID_RE.test(photo) ? photo : null,
        parentName: cleanText(own(value, 'parentName'), 100),
      });
    }
    case 'units': return value === 'oz' || value === 'mL' ? pass(value) : fail('units must be oz or mL');
    case 'theme': return ['auto', 'light', 'dark'].includes(value) ? pass(value) : fail('theme must be auto, light or dark');
    case 'sound': return ['on', 'off', 'night-off'].includes(value) ? pass(value) : fail('sound must be on, off or night-off');
    case 'trackers': {
      if (!isPlainObject(value)) return fail('trackers must be an object');
      return pass(Object.fromEntries(TRACKER_KEYS.map(k => [k, typeof own(value, k) === 'boolean' ? own(value, k) : true])));
    }
    case 'todayOrder': {
      if (!Array.isArray(value)) return fail('todayOrder must be an array');
      const seen = [];
      for (const v of value.slice(0, 50)) if (TODAY_CARDS.includes(v) && !seen.includes(v)) seen.push(v);
      for (const c of TODAY_CARDS) if (!seen.includes(c)) seen.push(c);
      return pass(seen);
    }
    case 'pumpGoalOz': {
      const n = toFiniteNumber(value);
      return n !== null && n >= 1 && n <= 200 ? pass(Math.round(n * 10) / 10) : fail('pumpGoalOz must be 1–200');
    }
    case 'pumpIntervalMinutes': {
      const n = toFiniteNumber(value);
      return n !== null && n >= 30 && n <= 720 ? pass(Math.round(n)) : fail('pumpIntervalMinutes must be 30–720');
    }
    case 'storageWindows': {
      if (!isPlainObject(value)) return fail('storageWindows must be an object');
      const out = {};
      for (const [k, [lo, hi]] of Object.entries(STORAGE_WINDOW_RANGES)) {
        const n = toFiniteNumber(own(value, k));
        out[k] = n !== null && n >= lo && n <= hi ? n : DEFAULT_STORAGE_WINDOWS[k];
      }
      return pass(out);
    }
    case 'deviceId': return typeof value === 'string' && /^dev_[A-Za-z0-9_-]{6,80}$/.test(value) ? pass(value) : fail('bad deviceId');
    case 'onboarded':
    case 'migratedV2': return typeof value === 'boolean' ? pass(value) : fail(`${key} must be boolean`);
    case 'iconDataUrl':
      return value === null || (typeof value === 'string' && value.length <= 400_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))
        ? pass(value) : fail('iconDataUrl must be a PNG data URL');
    default:
      if (typeof key !== 'string' || !KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) return fail(`bad setting key: ${key}`);
      return pass(value);
  }
}

/**
 * 'YYYY-MM-DD' that is a real calendar date.
 * @param {string} s
 * @returns {boolean}
 */
export function isValidDateString(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ------------------------------------------------------------------ state

const cache = new Map();
const listeners = new Set();
let loadPromise = null;

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

function emit(change) {
  for (const fn of [...listeners]) {
    try { fn(change); } catch (err) { console.error('settings listener failed', err); }
  }
}

/**
 * Load every stored setting into memory (idempotent) and make sure this
 * install has a deviceId. Resolves with all().
 * @returns {Promise<object>}
 */
export function load() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const records = await getAll(STORES.settings);
      cache.clear();
      for (const r of records) if (r && typeof r.key === 'string') cache.set(r.key, r.value);
      await ensureDeviceId();
      return all();
    })();
    loadPromise.catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

/**
 * Re-read the store (after migration / import / erase) and tell every
 * subscriber that anything may have changed ({ key: '*' }).
 * @returns {Promise<object>}
 */
export async function reload() {
  loadPromise = null;
  const values = await load();
  emit({ key: '*', value: undefined, prev: undefined });
  return values;
}

// Get-or-create in ONE readwrite transaction, so two tabs (or two callers
// racing on first boot) can't mint two different device ids.
async function ensureDeviceId() {
  if (sanitizeSetting('deviceId', cache.get('deviceId')).ok) return cache.get('deviceId');
  const id = await transaction(STORES.settings, 'readwrite', (s, ctx) => {
    const req = s.settings.get('deviceId');
    req.onsuccess = () => {
      const existing = req.result && req.result.value;
      if (sanitizeSetting('deviceId', existing).ok) { ctx.done(existing); return; }
      const fresh = newId('dev');
      s.settings.put({ key: 'deviceId', value: fresh, updatedAt: Date.now() });
      ctx.done(fresh);
    };
  });
  cache.set('deviceId', id);
  return id;
}

/**
 * This install's device id ('dev_<uuid>'), created once.
 * @returns {Promise<string>}
 */
export async function deviceId() {
  await load();
  return cache.get('deviceId');
}

/**
 * Current value (synchronous, from the cache). Known keys fall back to their
 * default when unset or invalid; unknown keys return undefined when unset.
 * Objects are copies — mutate freely, then set().
 * @param {string} key
 * @returns {any}
 */
export function get(key) {
  const known = Object.prototype.hasOwnProperty.call(DEFAULTS, key);
  if (cache.has(key)) {
    const res = sanitizeSetting(key, cache.get(key));
    if (res.ok) return clone(res.value);
  }
  return known ? clone(DEFAULTS[key]) : undefined;
}

/**
 * Every §6 setting (defaults filled in). Legacy v1 keys still sitting in the
 * store are not included.
 * @returns {object}
 */
export function all() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = get(k);
  return out;
}

/**
 * Persist a setting and notify subscribers. Throws TypeError on an invalid
 * value. Setting an equal value is a no-op (no write, no event).
 * @param {string} key
 * @param {any} value
 * @returns {Promise<any>} the stored (sanitized) value
 */
export async function set(key, value) {
  const res = sanitizeSetting(key, value);
  if (!res.ok) throw new TypeError(res.error);
  await load();
  const prev = get(key);
  if (cache.has(key) && JSON.stringify(prev) === JSON.stringify(res.value)) return clone(res.value);
  const stored = clone(res.value);
  await transaction(STORES.settings, 'readwrite', (s) => {
    s.settings.put({ key, value: stored, updatedAt: Date.now() });
  });
  cache.set(key, stored);
  emit({ key, value: clone(stored), prev });
  return clone(stored);
}

/**
 * Shallow-merge into an object setting: patch('profile', { babyName: 'Clara' }).
 * @param {string} key
 * @param {object} partial
 * @returns {Promise<any>}
 */
export async function patch(key, partial) {
  await load();
  const current = get(key);
  if (!isPlainObject(current)) throw new TypeError(`${key} is not an object setting`);
  return set(key, { ...current, ...(isPlainObject(partial) ? partial : {}) });
}

/**
 * Subscribe to changes: fn({ key, value, prev }). key '*' = reload (re-read
 * everything). Returns unsubscribe.
 * @param {(change: {key: string, value: any, prev: any}) => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The settings API as one object, for ctx injection (ARCHITECTURE §5.2). */
export const settings = Object.freeze({ load, reload, get, set, patch, all, subscribe, deviceId, DEFAULTS, TRACKER_KEYS, TODAY_CARDS });

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
