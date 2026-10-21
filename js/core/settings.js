// Settings, babies, parent profile + tracker visibility (ARCHITECTURE §6).
//
// Values live in the `settings` store as { key, value, updatedAt } and are
// cached in memory after `load()`, so `get()` is synchronous and views can
// render without awaiting. app.js must `await settings.load()` (directly or
// via migrate.runMigration) before mounting views; before that, get() returns
// defaults (and an empty babies list).
//
// Every known key has a sanitizer. set() throws on a bad value (a UI bug we
// want to see); reads and imports fall back to the default instead, so a
// corrupt or hostile stored value can never reach the UI as-is.
//
// Babies: there is always at least one. load() creates a default (unnamed)
// baby once per install, exactly like deviceId, so every feed/sleep/diaper/
// milestone event always has a real babyId to point at (§3 "Multiple babies").
//
// Several tabs (e.g. the installed PWA window and a browser tab on Android)
// share one database but each has its own cache. So every write is a
// read-modify-write of the STORED value inside one readwrite transaction —
// never a rewrite from this tab's possibly stale cache — and every write is
// announced on a BroadcastChannel so the other tabs re-read the store.

import { transaction, getAll, STORES, newId } from './db.js';
import { DEFAULT_STORAGE_WINDOWS, MAX_STORAGE_WINDOWS } from '../domain/inventory.js';
import { toFiniteNumber } from './units.js';

/** Trackers that Settings → Customize can hide (hidden ≠ deleted). */
export const TRACKER_KEYS = Object.freeze(['bottle', 'formula', 'breastfeeding', 'pump', 'stash', 'sleep', 'diaper', 'memories']);
/** Cards on Today, in their default order. */
export const TODAY_CARDS = Object.freeze(['feed', 'sleep', 'diaper', 'pump', 'stash']);
/** 'baby_<uuid>' — the id format for babies (events reference it as babyId). */
export const BABY_ID_RE = /^baby_[A-Za-z0-9_-]{1,90}$/;
/** Twins, triplets, siblings… a family-sized cap so a hostile list stays small. */
export const MAX_BABIES = 12;
/** Max length of a baby's or parent's name. */
export const NAME_MAX = 100;

/** §6 defaults. Treat as read-only; get() hands out copies. */
export const DEFAULTS = deepFreeze({
  babies: [],            // load() guarantees ≥ 1 (generated once per install)
  activeBabyId: null,    // get() falls back to the first baby
  parentName: '',
  lastBackupAt: null,    // drives the weekly backup nudge (§10b)
  persistGranted: null,  // result of navigator.storage.persist()
  feedbackEmail: '',     // owner-configured mailto target (no tracking)
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
  iconBabyId: null,  // which baby's photo iconDataUrl was made from (per device)
  memoryCovers: {},  // { [babyId]: eventId } — the memory each baby's book shows on its cover
});

/** Keys a backup may carry. deviceId / migratedV2 / lastBackupAt /
 * persistGranted are per-install state; iconDataUrl is per-device and derived
 * from the photo; feedbackEmail is the app owner's, not the family's. */
export const EXPORTABLE_KEYS = Object.freeze([
  'babies', 'activeBabyId', 'parentName', 'units', 'theme', 'trackers', 'todayOrder',
  'pumpGoalOz', 'pumpIntervalMinutes', 'storageWindows', 'sound', 'onboarded', 'memoryCovers',
]);

// Upper bounds are shared with the stash import guard (domain/inventory.js),
// so an imported pouch can never claim a longer window than Settings allows.
const STORAGE_WINDOW_RANGES = Object.freeze(Object.fromEntries(
  Object.keys(DEFAULT_STORAGE_WINDOWS).map(k => [k, [1, MAX_STORAGE_WINDOWS[k]]]),
));

const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// Deliberately narrow: this ends up in a mailto: href, so no '?', '&', '#',
// quotes, angle brackets or whitespace can ride along.
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MIN_TIME = Date.UTC(2000, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

const own = (o, k) => (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = n => typeof n === 'number' && Number.isFinite(n) && n >= MIN_TIME && n <= MAX_TIME;
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

/**
 * Validate one baby record ({ id, name, birthDate, photoId, createdAt }).
 * Builds a NEW object from known keys only. Strict (app writes) rejects any
 * present-but-invalid field; lenient (stored values, imports) replaces it
 * with its default so one bad field can't drop a whole child from the list.
 * @param {unknown} raw
 * @param {{ lenient?: boolean }} [opts]
 * @returns {{id:string, name:string, birthDate:string|null, photoId:string|null, createdAt:number|null}|null}
 */
export function sanitizeBaby(raw, { lenient = false } = {}) {
  if (!isPlainObject(raw)) return null;
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !BABY_ID_RE.test(id)) return null;
  const name = own(raw, 'name');
  const birth = own(raw, 'birthDate');
  const photo = own(raw, 'photoId');
  const created = toFiniteNumber(own(raw, 'createdAt'));
  const nameOk = name === undefined || typeof name === 'string';
  const birthOk = birth === undefined || birth === null || (typeof birth === 'string' && isValidDateString(birth));
  const photoOk = photo === undefined || photo === null || (typeof photo === 'string' && ID_RE.test(photo));
  const createdOk = own(raw, 'createdAt') === undefined || own(raw, 'createdAt') === null || isTime(created);
  if (!lenient && !(nameOk && birthOk && photoOk && createdOk)) return null;
  return {
    id,
    name: cleanText(name, NAME_MAX).trim(),
    birthDate: birthOk && typeof birth === 'string' ? birth : null,
    photoId: photoOk && typeof photo === 'string' ? photo : null,
    createdAt: isTime(created) ? created : null,
  };
}

/**
 * Validate one setting. Pure. `lenient` is for reads and imports: list-like
 * values drop bad entries instead of failing outright.
 * @param {string} key
 * @param {unknown} value
 * @param {{ lenient?: boolean }} [opts]
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
export function sanitizeSetting(key, value, { lenient = false } = {}) {
  switch (key) {
    case 'babies': {
      if (!Array.isArray(value)) return fail('babies must be a list');
      if (!lenient && value.length > MAX_BABIES) return fail(`at most ${MAX_BABIES} babies`);
      const out = [];
      const seen = new Set();
      for (const raw of value.slice(0, lenient ? 1000 : MAX_BABIES)) {
        const b = sanitizeBaby(raw, { lenient });
        if (!b) {
          if (!lenient) return fail('invalid baby');
          continue;
        }
        if (seen.has(b.id)) {
          if (!lenient) return fail('duplicate baby id');
          continue;
        }
        seen.add(b.id);
        out.push(b);
        if (out.length === MAX_BABIES) break;
      }
      return out.length ? pass(out) : fail('babies must list at least one baby');
    }
    case 'activeBabyId':
      return typeof value === 'string' && BABY_ID_RE.test(value) ? pass(value) : fail('bad activeBabyId');
    case 'parentName':
      return typeof value === 'string' ? pass(cleanText(value, NAME_MAX).trim()) : fail('parentName must be text');
    case 'lastBackupAt':
      return value === null || isTime(value) ? pass(value) : fail('lastBackupAt must be a timestamp or null');
    case 'persistGranted':
      return value === null || typeof value === 'boolean' ? pass(value) : fail('persistGranted must be boolean or null');
    case 'feedbackEmail':
      return value === '' || (typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value))
        ? pass(value) : fail('feedbackEmail must be an email address');
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
    case 'iconBabyId':
      return value === null || (typeof value === 'string' && BABY_ID_RE.test(value)) ? pass(value) : fail('bad iconBabyId');
    case 'memoryCovers': {
      // baby id → milestone event id. Lenient (imports) drops bad pairs.
      if (!isPlainObject(value)) return fail('memoryCovers must be an object');
      const out = {};
      let n = 0;
      for (const k of Object.keys(value)) {
        const v = value[k];
        const good = BABY_ID_RE.test(k) && typeof v === 'string' && ID_RE.test(v);
        if (!good) { if (!lenient) return fail('memoryCovers maps a baby id to a memory id'); continue; }
        if (++n > 1000) break;
        out[k] = v;
      }
      return pass(out);
    }
    default:
      if (typeof key !== 'string' || !KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) return fail(`bad setting key: ${key}`);
      return pass(value);
  }
}

/**
 * A fresh, unnamed baby record (onboarding fills in the name).
 * @param {{ name?: string, birthDate?: string|null, photoId?: string|null }} [fields]
 * @param {number} [now]
 * @returns {{id:string, name:string, birthDate:string|null, photoId:string|null, createdAt:number}}
 */
export function makeBaby({ name = '', birthDate = null, photoId = null } = {}, now = Date.now()) {
  return { id: newId('baby'), name: cleanText(name, NAME_MAX).trim(), birthDate, photoId, createdAt: now };
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

// --------------------------------------------------------- cross-tab sync

/** BroadcastChannel name other tabs listen on for "settings changed". */
export const SETTINGS_CHANNEL = 'nurture-settings';
let channel = null; // null = not tried yet, false = unavailable

function getChannel() {
  if (channel === null) {
    channel = false;
    try {
      if (typeof BroadcastChannel === 'function') {
        const ch = new BroadcastChannel(SETTINGS_CHANNEL);
        // Node has BroadcastChannel too; never let it keep a test process alive.
        if (typeof ch.unref === 'function') ch.unref();
        ch.onmessage = () => { refresh().catch(err => console.error('settings refresh failed', err)); };
        channel = ch;
      }
    } catch { channel = false; }
  }
  return channel || null;
}

// Tell the other tabs to re-read (a channel never delivers to its sender).
function broadcast(key) {
  const ch = getChannel();
  if (!ch) return;
  try { ch.postMessage({ key }); } catch { /* channel closed */ }
}

/**
 * Load every stored setting into memory (idempotent), and make sure this
 * install has a deviceId and at least one baby. Resolves with all().
 * @returns {Promise<object>}
 */
export function load() {
  if (!loadPromise) {
    getChannel(); // start listening for other tabs' writes
    loadPromise = (async () => {
      const records = await getAll(STORES.settings);
      cache.clear();
      for (const r of records) if (r && typeof r.key === 'string') cache.set(r.key, r.value);
      await ensureInstallState();
      return all();
    })();
    loadPromise.catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

// Re-read the store and tell this tab's subscribers ({ key: '*' }).
async function refresh() {
  loadPromise = null;
  const values = await load();
  emit({ key: '*', value: undefined, prev: undefined });
  return values;
}

/**
 * Re-read the store (after migration / import / erase) and tell every
 * subscriber that anything may have changed ({ key: '*' }). Other open tabs
 * are told to re-read too.
 * @returns {Promise<object>}
 */
export async function reload() {
  const values = await refresh();
  broadcast('*');
  return values;
}

// Get-or-create the per-install values (deviceId, the default baby) in ONE
// readwrite transaction, so two tabs (or two callers racing on first boot)
// can't mint two different device ids or two "first" babies.
async function ensureInstallState() {
  const haveDevice = sanitizeSetting('deviceId', cache.get('deviceId')).ok;
  const haveBabies = sanitizeSetting('babies', cache.get('babies'), { lenient: true }).ok;
  if (haveDevice && haveBabies) return;
  const now = Date.now();
  const written = await transaction(STORES.settings, 'readwrite', (s, ctx) => {
    const devReq = s.settings.get('deviceId');
    const babiesReq = s.settings.get('babies');
    babiesReq.onsuccess = () => {
      const out = {};
      const dev = devReq.result && devReq.result.value;
      if (sanitizeSetting('deviceId', dev).ok) out.deviceId = dev;
      else {
        out.deviceId = newId('dev');
        s.settings.put({ key: 'deviceId', value: out.deviceId, updatedAt: now });
      }
      const stored = babiesReq.result && babiesReq.result.value;
      if (sanitizeSetting('babies', stored, { lenient: true }).ok) out.babies = stored;
      else {
        const baby = makeBaby({}, now);
        out.babies = [baby];
        out.activeBabyId = baby.id;
        s.settings.put({ key: 'babies', value: out.babies, updatedAt: now });
        s.settings.put({ key: 'activeBabyId', value: baby.id, updatedAt: now });
      }
      ctx.done(out);
    };
  });
  for (const [k, v] of Object.entries(written)) cache.set(k, v);
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
 * `activeBabyId` always names a baby in `babies` (the first one when the
 * stored id is missing or stale). Objects are copies — mutate freely, then
 * set().
 * @param {string} key
 * @returns {any}
 */
export function get(key) {
  if (key === 'activeBabyId') {
    const list = get('babies');
    const stored = cache.get('activeBabyId');
    if (typeof stored === 'string' && list.some(b => b.id === stored)) return stored;
    return list.length ? list[0].id : null;
  }
  return readValue(key, cache.has(key), cache.get(key));
}

// What get() returns for a stored (or missing) raw value: the leniently
// sanitized value, else the default for a known key, else undefined. A copy.
function readValue(key, has, raw) {
  if (has) {
    const res = sanitizeSetting(key, raw, { lenient: true });
    if (res.ok) return clone(res.value);
  }
  return Object.prototype.hasOwnProperty.call(DEFAULTS, key) ? clone(DEFAULTS[key]) : undefined;
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
 * value (including an activeBabyId that isn't one of the babies). Setting an
 * equal value is a no-op (no write, no event).
 * @param {string} key
 * @param {any} value
 * @returns {Promise<any>} the stored (sanitized) value
 */
export async function set(key, value) {
  const res = sanitizeSetting(key, value);
  if (!res.ok) throw new TypeError(res.error);
  await load();
  if (key === 'activeBabyId' && !get('babies').some(b => b.id === res.value)) {
    throw new TypeError('activeBabyId must be one of the babies');
  }
  return writeSetting(key, () => res.value);
}

/**
 * Shallow-merge into an object setting: patch('trackers', { pump: false }).
 * The merge reads the STORED value inside the write transaction, so two
 * concurrent patches (or a patch from another tab) both survive.
 * @param {string} key
 * @param {object} partial
 * @returns {Promise<any>}
 */
export async function patch(key, partial) {
  const extra = isPlainObject(partial) ? { ...partial } : {};
  return writeSetting(key, (current) => {
    if (!isPlainObject(current)) throw new TypeError(`${key} is not an object setting`);
    return { ...current, ...extra };
  });
}

// Atomic read-modify-write of one key. `compute(current)` gets the value as
// it is stored right now (sanitized, default-filled — what get() would say
// in a fresh tab) and returns the next value; it may throw to abort. A value
// equal to what is stored is not rewritten and emits nothing (unless this
// tab's cache was stale). Resolves with the stored value.
async function writeSetting(key, compute) {
  await load();
  const now = Date.now();
  const { value, wrote } = await transaction(STORES.settings, 'readwrite', (s, ctx) => {
    const g = s.settings.get(key);
    g.onsuccess = () => {
      const rec = g.result;
      let res;
      try {
        res = sanitizeSetting(key, compute(readValue(key, !!rec, rec && rec.value)));
      } catch (err) { ctx.fail(err); return; }
      if (!res.ok) { ctx.fail(new TypeError(res.error)); return; }
      const same = !!rec && JSON.stringify(rec.value) === JSON.stringify(res.value);
      if (!same) s.settings.put({ key, value: res.value, updatedAt: now });
      ctx.done({ value: res.value, wrote: !same });
    };
  });
  const prev = get(key);
  cache.set(key, clone(value));
  if (wrote || JSON.stringify(prev) !== JSON.stringify(get(key))) emit({ key, value: clone(value), prev });
  if (wrote) broadcast(key);
  return clone(value);
}

// ----------------------------------------------------------------- babies

// Baby edits are read-modify-writes of the STORED list (writeSetting), so an
// edit from another tab is never overwritten by this tab's cache; the queue
// also keeps this tab's own edits in the order they were made.
let babyQueue = Promise.resolve();
function queueBabyEdit(fn) {
  const run = babyQueue.then(async () => { await load(); return fn(); });
  babyQueue = run.catch(() => {});
  return run;
}

const BABY_FIELDS = ['name', 'birthDate', 'photoId'];
function pickBabyFields(input) {
  const out = {};
  if (!isPlainObject(input)) return out;
  for (const k of BABY_FIELDS) if (own(input, k) !== undefined) out[k] = own(input, k);
  return out;
}

/**
 * All babies, oldest first (a copy).
 * @returns {Array<{id:string, name:string, birthDate:string|null, photoId:string|null, createdAt:number|null}>}
 */
export function babies() {
  return get('babies');
}

/**
 * The baby Today/Timeline/sheets are showing (or null before load()).
 * @returns {{id:string, name:string, birthDate:string|null, photoId:string|null, createdAt:number|null}|null}
 */
export function activeBaby() {
  const id = get('activeBabyId');
  return get('babies').find(b => b.id === id) || null;
}

/**
 * Add a baby (twins/siblings). Doesn't switch to it — call setActiveBaby().
 * Throws TypeError on an invalid field or when the family cap is reached.
 * @param {{ name?: string, birthDate?: string|null, photoId?: string|null }} [fields]
 * @returns {Promise<object>} the new baby
 */
export function addBaby(fields = {}) {
  return queueBabyEdit(async () => {
    const draft = { ...makeBaby({}, Date.now()), ...pickBabyFields(fields) };
    const baby = sanitizeBaby(draft);
    if (!baby) throw new TypeError('Invalid baby details');
    await writeSetting('babies', (list) => {
      if (list.length >= MAX_BABIES) throw new TypeError(`At most ${MAX_BABIES} babies`);
      return [...list, baby];
    });
    return clone(baby);
  });
}

/**
 * Edit a baby's name / birthDate / photoId. Throws TypeError for an unknown
 * id or an invalid field.
 * @param {string} id
 * @param {{ name?: string, birthDate?: string|null, photoId?: string|null }} fields
 * @returns {Promise<object>} the updated baby
 */
export function updateBaby(id, fields) {
  return queueBabyEdit(async () => {
    let next = null;
    await writeSetting('babies', (list) => {
      const i = list.findIndex(b => b.id === id);
      if (i === -1) throw new TypeError(`No baby with id ${String(id).slice(0, 100)}`);
      next = sanitizeBaby({ ...list[i], ...pickBabyFields(fields) });
      if (!next) throw new TypeError('Invalid baby details');
      const updated = list.slice();
      updated[i] = next;
      return updated;
    });
    return clone(next);
  });
}

/**
 * Switch the active baby.
 * @param {string} id
 * @returns {Promise<string>}
 */
export function setActiveBaby(id) {
  return set('activeBabyId', id);
}

/**
 * Remove a baby and everything that is only theirs: their entries (never the
 * parent's own pumps), the photos no one else uses, their memory cover, and
 * the app icon if it was made from their photo. Today moves to another baby.
 * A copy of what was here is kept on this phone first, in the same
 * transaction (backup.getSafetyCopy / backup.restoreSafetyCopy undo it); no
 * file is downloaded unless `safetyBackup` says how. Subscribers get a
 * { key: '*' } change, event and photo listeners a bulk change.
 * Throws RangeError for the last baby (there is always at least one),
 * TypeError for an unknown id. Queued with the other baby edits.
 * @param {string} id
 * @param {{ safetyBackup?: ((file: File) => (void|Promise<void>))|null }} [opts]
 * @returns {Promise<{ removedEvents: number, removedPhotos: number, name: string, safetyKept: boolean }>}
 */
export function removeBaby(id, { safetyBackup = null } = {}) {
  return queueBabyEdit(async () => {
    // backup.js imports this module; load it lazily so neither has to be
    // evaluated first.
    const backup = await import('./backup.js');
    try {
      const res = await backup.removeBaby(id, { safetyBackup, keepSafetyCopy: true });
      return { removedEvents: res.entries, removedPhotos: res.photos, name: res.name, safetyKept: res.safetyKept };
    } catch (err) {
      if (err && err.code === 'last') throw new RangeError(err.message);
      if (err && err.code === 'missing') throw new TypeError(`No baby with id ${String(id).slice(0, 100)}`);
      throw err;
    }
  });
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
export const settings = Object.freeze({
  load, reload, get, set, patch, all, subscribe, deviceId,
  babies, activeBaby, addBaby, updateBaby, removeBaby, setActiveBaby,
  DEFAULTS, TRACKER_KEYS, TODAY_CARDS,
});

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
