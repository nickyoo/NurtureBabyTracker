// Export (JSON v2, CSV) / import (validate + merge) / share.
//
// Import is a TRUST BOUNDARY (AUDIT §6.5): a backup file can come from
// anyone. validateBackup() is pure and rebuilds every record from known keys
// only — unknown types are rejected, numbers coerced, strings capped and
// stripped of control characters, ids pattern-checked (so a hostile id can't
// become a key or a selector), and __proto__/constructor/prototype keys never
// survive because nothing is ever copied key-by-key from the input. Strings
// stay plain text; the html`` template escapes them at render time.
// Import merges by id with newest updatedAt winning, instead of v1's
// wipe-and-replace. Nothing here makes a network request: sharing uses the
// OS share sheet (navigator.share) or a local download.
//
// Babies: partner sync is "share a backup that merges into the partner's
// log" (AUDIT §0). Each phone created its own default baby with its own
// random id, so a naive merge would show Clara twice. planBabyMerge() matches
// the file's babies to this phone's by id, then by name, then (one baby on
// each side, one of them unnamed) by being the only child — and remaps the
// incoming events onto the local baby.

import { transaction, getAll, STORES } from './db.js';
import { sanitizeEvent, notifyEvents, EVENT_TYPES, ID_RE, matchesBaby, FUTURE_SKEW_MS } from './store.js';
import { sanitizeInventoryItem, notifyStash } from './stash.js';
import {
  sanitizeSetting, EXPORTABLE_KEYS, MAX_BABIES, DEFAULTS, get as getSetting, load as loadSettings,
  reload as reloadSettings, deviceId as getDeviceId,
} from './settings.js';
import { sessionToEvent, mapV1Settings } from './migrate.js';
import { notifyPhotosBulk } from './photos.js';
import { markBackedUp } from './persist.js';
import { inventoryUpdatedAt, calculateExpiration, DEFAULT_STORAGE_WINDOWS, THAWED_LOCATION } from '../domain/inventory.js';
import { breastSideTotals } from '../domain/safety.js';
import { convertQty, normalizeUnit, roundForUnit, toFiniteNumber } from './units.js';
import { dayKey } from './time.js';

/** `app` marker in every v2 backup file. */
export const BACKUP_APP = 'nurture';
/** Backup format version written by this build (files with a higher one are refused). */
export const BACKUP_SCHEMA = 2;
/** Refuse files bigger than this before reading them into memory. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** Per-collection record caps (years of heavy use fit comfortably). */
export const MAX_RECORDS = Object.freeze({ events: 200000, inventory: 50000, photos: 5000 });
/** Max base64 length of one photo (~15 MB of JPEG). */
export const MAX_PHOTO_BASE64 = 20 * 1024 * 1024;
/** Baby id given to a v1 file's child when the caller has no local baby to
 * use. Deterministic, so importing the same v1 file twice is idempotent. */
export const V1_IMPORT_BABY_ID = 'baby_v1import';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** An incoming timer that has been "running" longer than this is a timer
 * someone forgot to stop, not a live activity: it is imported stopped (DI-12). */
export const STALE_RUNNING_MS = 24 * 60 * 60 * 1000;
/** Per-type limits for STALE_RUNNING_MS: no nap or night runs 16 hours, no
 * feed or pump runs a day. Types not listed use STALE_RUNNING_MS. */
export const STALE_RUNNING_LIMITS = Object.freeze({ sleep: 16 * 60 * 60 * 1000, feed: STALE_RUNNING_MS, pump: STALE_RUNNING_MS });
/** Note added to a timer imported stopped because it was still running in
 * the file long past any real feed, pump or sleep (DI-12). */
export const STALE_RUNNING_NOTE = 'The timer was still running in the backup, so it was stopped when it was imported.';

/**
 * Is this running event a forgotten timer (running longer than its type's
 * limit)? Pure.
 * @param {object} e
 * @param {number} [now]
 * @returns {boolean}
 */
export function isStaleRunning(e, now = Date.now()) {
  if (!e || e.endTime !== null || !Number.isFinite(e.startTime)) return false;
  return now - e.startTime > (STALE_RUNNING_LIMITS[e.type] ?? STALE_RUNNING_MS);
}

/**
 * The finished copy of a forgotten timer (DI-12): ends where it started (no
 * made-up duration), a running breast side is closed without crediting it
 * days, and the note says what happened. Pure.
 * @param {object} e a running event
 * @returns {object}
 */
export function stopStaleRunning(e) {
  const out = { ...e, endTime: e.startTime };
  if (e.data && (e.data.activeSide || e.data.activeSince != null)) {
    out.data = { ...e.data, activeSide: null, activeSince: null };
  }
  const note = typeof e.note === 'string' ? e.note.trim() : '';
  if (!note.includes(STALE_RUNNING_NOTE)) out.note = note ? `${note}\n${STALE_RUNNING_NOTE}`.slice(0, 2000) : STALE_RUNNING_NOTE;
  return out;
}
/** Settings-store key of the copy of this phone's data kept by the last
 * Replace import (DI-01): written in the same transaction as the replace, so
 * Replace can always be undone — whatever happened to the downloaded copy. */
export const SAFETY_COPY_KEY = 'safetyCopy';

/** User-facing import/export failure. `message` is safe to show. */
export class BackupError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

const own = (o, k) => (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------ base64 (pure)

/**
 * Uint8Array → base64 (chunked so big photos don't blow the call stack).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/**
 * base64 → Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ------------------------------------------------------- validation (pure)

function sanitizePhotoEntry(raw, now = Date.now()) {
  if (!isPlainObject(raw)) return null;
  const id = own(raw, 'id');
  const data = own(raw, 'data');
  const type = own(raw, 'type');
  if (typeof id !== 'string' || id.length > 100 || !ID_RE.test(id)) return null;
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_PHOTO_BASE64 || data.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const dim = k => {
    const n = toFiniteNumber(own(raw, k));
    return n !== null && n >= 1 && n <= 20000 ? Math.round(n) : null;
  };
  const width = dim('width');
  const height = dim('height');
  if (width === null || height === null) return null;
  const createdAt = toFiniteNumber(own(raw, 'createdAt'));
  return {
    id,
    type: PHOTO_TYPES.includes(type) ? type : 'image/jpeg',
    width,
    height,
    createdAt: createdAt !== null && createdAt >= Date.UTC(2000, 0, 1) && createdAt <= Date.UTC(2100, 0, 1)
      ? Math.min(createdAt, now + FUTURE_SKEW_MS) : Date.UTC(2000, 0, 1),
    data,
  };
}

// Duplicate ids inside one file keep the newest version; `stampOf` says what
// "newest" means for the record kind (v1 pouches have no updatedAt).
// `present`: the file carries a list for this collection; `malformed`: it
// carries something that isn't a list.
function collect(list, cap, sanitize, label, warnings, stampOf = r => r.updatedAt || 0) {
  const out = new Map();
  let rejected = 0;
  if (list === undefined || list === null) return { items: [], rejected, present: false, malformed: false };
  if (!Array.isArray(list)) {
    warnings.push(`${label} was not a list and was skipped`);
    return { items: [], rejected, present: false, malformed: true };
  }
  if (list.length > cap) {
    warnings.push(`Only the first ${cap} ${label} were read`);
    rejected += list.length - cap;
  }
  const n = Math.min(list.length, cap);
  for (let i = 0; i < n; i++) {
    const rec = sanitize(list[i]);
    if (!rec) { rejected += 1; continue; }
    const prev = out.get(rec.id);
    if (!prev || stampOf(rec) > stampOf(prev)) out.set(rec.id, rec);
  }
  return { items: [...out.values()], rejected, present: true, malformed: false };
}

/**
 * Detect the backup format.
 * @param {unknown} obj
 * @returns {'v2'|'v1'|'newer'|null}
 */
export function detectFormat(obj) {
  if (!isPlainObject(obj)) return null;
  const schema = toFiniteNumber(own(obj, 'schema'));
  if (own(obj, 'app') === BACKUP_APP && schema !== null) {
    if (schema === BACKUP_SCHEMA) return 'v2';
    if (schema > BACKUP_SCHEMA) return 'newer';
    return null;
  }
  if (toFiniteNumber(own(obj, 'version')) === 1
    && ['sessions', 'inventory', 'settings'].some(k => Array.isArray(own(obj, k)))) return 'v1';
  return null;
}

/**
 * Validate a parsed backup (pure). Accepts v2 files and v1 (version: 1)
 * backups, which are run through the same migration as the app's own data.
 * Never throws on hostile input; returns { ok: false, error } instead.
 *
 * Babies: a v2 file's `settings.babies` is validated like any setting; an
 * event without a babyId falls back to the file's first baby, else to
 * `defaultBabyId`. A v1 file's feeds go to `defaultBabyId` (or
 * V1_IMPORT_BABY_ID), and `settings.babies` names that baby from the v1
 * babyName.
 *
 * `collections` says, per collection, whether the file carries a list for
 * it (`present`) and whether it carries something that isn't a list
 * (`malformed`); `damaged` lists the collections that are malformed or had
 * entries of which none survived — replace-mode import refuses those files.
 * `photos` is null ("this file has no photos") unless the file carries a
 * photo list with at least one usable photo (or an empty list).
 * @param {unknown} input parsed JSON
 * @param {{ now?: number, deviceId?: string, defaultBabyId?: string }} [opts]
 * @returns {{ ok: false, error: string } | {
 *   ok: true, format: 'v1'|'v2',
 *   data: { events: object[], inventory: object[], settings: object, photos: object[]|null },
 *   stats: { events: {accepted:number, rejected:number}, inventory: {accepted:number, rejected:number}, photos: {accepted:number, rejected:number}, settings: {accepted:string[], rejected:string[]} },
 *   collections: { events: {present:boolean, malformed:boolean}, inventory: {present:boolean, malformed:boolean}, photos: {present:boolean, malformed:boolean} },
 *   damaged: Array<'events'|'inventory'|'photos'>,
 *   warnings: string[]
 * }}
 */
export function validateBackup(input, { now = Date.now(), deviceId, defaultBabyId } = {}) {
  const format = detectFormat(input);
  if (format === 'newer') return { ok: false, error: 'This backup is from a newer version of Nurture. Update the app, then try again.' };
  if (!format) return { ok: false, error: 'This file isn’t a Nurture backup.' };
  const warnings = [];

  let ev;
  const settings = {};
  const settingsStats = { accepted: [], rejected: [] };
  if (format === 'v2') {
    const s = own(input, 'settings');
    if (isPlainObject(s)) {
      for (const key of Object.keys(s)) {
        if (!EXPORTABLE_KEYS.includes(key)) { settingsStats.rejected.push(key.slice(0, 40)); continue; }
        const res = sanitizeSetting(key, s[key], { lenient: true });
        if (res.ok) { settings[key] = res.value; settingsStats.accepted.push(key); } else settingsStats.rejected.push(key);
      }
    }
    // activeBabyId must name one of the file's babies, or it's meaningless.
    if (settings.activeBabyId !== undefined && !(settings.babies || []).some(b => b.id === settings.activeBabyId)) {
      delete settings.activeBabyId;
      settingsStats.accepted = settingsStats.accepted.filter(k => k !== 'activeBabyId');
      settingsStats.rejected.push('activeBabyId');
    }
    const fallbackBaby = (settings.babies && settings.babies[0].id) || defaultBabyId;
    ev = collect(own(input, 'events'), MAX_RECORDS.events, raw => {
      const r = sanitizeEvent(raw, { now, defaultBabyId: fallbackBaby });
      return r.ok ? r.value : null;
    }, 'events', warnings);
  } else {
    const babyId = defaultBabyId || V1_IMPORT_BABY_ID;
    ev = collect(own(input, 'sessions'), MAX_RECORDS.events, raw => sessionToEvent(raw, { deviceId, now, babyId }), 'sessions', warnings);
    const mapped = Array.isArray(own(input, 'settings')) ? mapV1Settings(own(input, 'settings'), { babyId, now }) : {};
    if (!mapped.babies) {
      mapped.babies = [{ id: babyId, name: '', birthDate: null, photoId: null, createdAt: null }];
      mapped.activeBabyId = babyId;
    }
    for (const [key, value] of Object.entries(mapped)) {
      if (EXPORTABLE_KEYS.includes(key)) { settings[key] = value; settingsStats.accepted.push(key); }
    }
    const bottles = own(input, 'bottles');
    if (Array.isArray(bottles) && bottles.length) warnings.push('Old prepared-bottle records aren’t used any more and were skipped');
  }
  const inv = collect(own(input, 'inventory'), MAX_RECORDS.inventory, raw => sanitizeInventoryItem(raw, { now }), 'stash items', warnings, inventoryUpdatedAt);

  const ph = format === 'v2'
    ? collect(own(input, 'photos'), MAX_RECORDS.photos, raw => sanitizePhotoEntry(raw, now), 'photos', warnings)
    : { items: [], rejected: 0, present: false, malformed: false };
  // A photo list where nothing survived is "no photos", not "zero photos":
  // otherwise a damaged file would wipe the journal on replace.
  const photosUsable = ph.present && !(ph.items.length === 0 && ph.rejected > 0);

  const damaged = [];
  for (const [name, c] of [['events', ev], ['inventory', inv], ['photos', ph]]) {
    if (c.malformed || (c.items.length === 0 && c.rejected > 0)) damaged.push(name);
  }

  return {
    ok: true,
    format,
    data: { events: ev.items, inventory: inv.items, settings, photos: photosUsable ? ph.items : null },
    stats: {
      events: { accepted: ev.items.length, rejected: ev.rejected },
      inventory: { accepted: inv.items.length, rejected: inv.rejected },
      photos: { accepted: ph.items.length, rejected: ph.rejected },
      settings: settingsStats,
    },
    collections: {
      events: { present: ev.present, malformed: ev.malformed },
      inventory: { present: inv.present, malformed: inv.malformed },
      photos: { present: ph.present, malformed: ph.malformed },
    },
    damaged,
    warnings,
  };
}

const normName = n => (typeof n === 'string' ? n.trim().toLocaleLowerCase() : '');

/**
 * Match a file's babies to this device's (pure). Same id → same baby; else
 * same (non-empty, case-insensitive) name → same baby; else, when each side
 * has exactly one baby and one of them is unnamed → same baby. Matched local
 * babies get their EMPTY fields (name, birthDate, photoId) filled from the
 * file; local values always win otherwise. Unmatched incoming babies are
 * appended. `remap` maps incoming ids → local ids for the events.
 * `force` (the parent's answer to "Is Clara Rose the same baby as Clara?",
 * DI-04): incoming id → a local id (same baby) or null (a new baby).
 * @param {object[]} [local]
 * @param {object[]} [incoming]
 * @param {{ force?: Record<string, string|null>|null }} [opts]
 * @returns {{ babies: object[], remap: Map<string, string>, stats: { added: number, matched: number, addedBabies: Array<{id:string, name:string}> } }}
 */
export function planBabyMerge(local = [], incoming = [], { force = null } = {}) {
  const babies = (local || []).map(b => ({ ...b }));
  const remap = new Map();
  const claimed = new Set();
  const stats = { added: 0, matched: 0, addedBabies: [] };
  const inc = incoming || [];
  const onlyChildren = babies.length === 1 && inc.length === 1;
  const forced = id => (isPlainObject(force) && Object.prototype.hasOwnProperty.call(force, id) ? force[id] : undefined);
  for (const b of inc) {
    let target = babies.find(x => x.id === b.id);
    const want = forced(b.id);
    if (!target && typeof want === 'string') target = babies.find(x => x.id === want && !claimed.has(x.id));
    if (!target && want === null) {
      babies.push({ ...b });
      claimed.add(b.id);
      stats.added += 1;
      stats.addedBabies.push({ id: b.id, name: b.name || '' });
      continue;
    }
    if (!target && normName(b.name)) {
      target = babies.find(x => !claimed.has(x.id) && normName(x.name) === normName(b.name));
    }
    if (!target && onlyChildren && !claimed.has(babies[0].id) && (!normName(b.name) || !normName(babies[0].name))) {
      target = babies[0];
    }
    if (target) {
      claimed.add(target.id);
      if (target.id !== b.id) remap.set(b.id, target.id);
      for (const k of ['name', 'birthDate', 'photoId']) if (!target[k] && b[k]) target[k] = b[k];
      if (!target.createdAt && b.createdAt) target.createdAt = b.createdAt;
      stats.matched += 1;
    } else {
      babies.push({ ...b });
      claimed.add(b.id);
      stats.added += 1;
      stats.addedBabies.push({ id: b.id, name: b.name || '' });
    }
  }
  return { babies, remap, stats };
}

/**
 * Is this phone's profile just the untouched default baby (no name, birth
 * date or photo, no entries)? Then a restore adopts the file's babies instead
 * of keeping an empty extra "Baby" (DI-03). `ignoreDetails`: a name, birth
 * date or photo typed during onboarding doesn't count — before the first
 * entry, a restore on a new phone is the family's real profile (DI-03). Pure.
 * @param {object[]} babies
 * @param {object[]} events
 * @param {{ ignoreDetails?: boolean }} [opts]
 * @returns {boolean}
 */
export function isPristineProfile(babies = [], events = [], { ignoreDetails = false } = {}) {
  if (!Array.isArray(babies) || babies.length !== 1) return false;
  const b = babies[0] || {};
  if (!ignoreDetails && (b.name || b.birthDate || b.photoId)) return false;
  return !(events || []).some(e => e && e.babyId === b.id);
}

/**
 * The one question a partner merge may need answered (DI-04): this phone
 * has one named baby, the file one named baby, and they don't match by id or
 * name — the same child spelled differently ("Clara" / "Clara Rose"), or a
 * sibling? Pure. Returns null when there's nothing to ask.
 * @param {object[]} local
 * @param {object[]} incoming
 * @returns {{ local: {id:string, name:string}, incoming: {id:string, name:string} }|null}
 */
export function babyQuestion(local = [], incoming = []) {
  if (!Array.isArray(local) || !Array.isArray(incoming) || local.length !== 1 || incoming.length !== 1) return null;
  const [l] = local;
  const [i] = incoming;
  if (!l || !i || l.id === i.id || !normName(l.name) || !normName(i.name) || normName(l.name) === normName(i.name)) return null;
  return { local: { id: l.id, name: l.name }, incoming: { id: i.id, name: i.name } };
}

/**
 * A pouch's expiry under THIS phone's storage windows (DI-02): an imported
 * pouch keeps the earlier of the file's expiresAt and what this phone's rules
 * give it, so a partner's longer windows (or a doctored file) can't show
 * 10-day-old fridge milk as "4 days left". Thawed milk without a thaw time
 * keeps the file's (already bounded) value. Pure.
 * @param {object} item a sanitized pouch
 * @param {object} [windows] settings.storageWindows
 * @returns {object} the pouch (a copy when changed)
 */
export function clampExpiryToWindows(item, windows) {
  if (!item || !Number.isFinite(item.pumpedAt)) return item;
  const w = { ...DEFAULT_STORAGE_WINDOWS, ...(isPlainObject(windows) ? windows : {}) };
  let local;
  if (item.location === THAWED_LOCATION) {
    if (!Number.isFinite(item.thawedAt)) return item;
    local = item.thawedAt + w.thawedBottleHours * 60 * 60 * 1000;
  } else {
    local = calculateExpiration(item.pumpedAt, item.location, w);
  }
  if (!Number.isFinite(local) || !(local < item.expiresAt)) return item;
  return { ...item, expiresAt: local };
}

/**
 * Merge a file's memory covers into this phone's (FLOW-07, pure): baby ids
 * go through the merge's remap; a cover is added only for a baby that exists
 * here, that has no cover yet (local wins), and only if it points at a
 * memory of that baby that exists after the merge. Returns the new map, or
 * null when nothing changes.
 * @param {Record<string,string>} local
 * @param {Record<string,string>} incoming
 * @param {{ remap?: Map<string,string>, babyIds: Set<string>, events: Map<string, object> }} ctx
 * @returns {Record<string,string>|null}
 */
export function mergeCovers(local, incoming, { remap = new Map(), babyIds, events }) {
  const out = { ...(isPlainObject(local) ? local : {}) };
  let changed = false;
  for (const [bid, eid] of Object.entries(isPlainObject(incoming) ? incoming : {})) {
    const target = remap.get(bid) || bid;
    if (!babyIds.has(target) || out[target]) continue;
    const e = events.get(eid);
    if (!e || e.type !== 'milestone' || (e.babyId ?? null) !== target) continue;
    out[target] = eid;
    changed = true;
  }
  return changed ? out : null;
}

/**
 * Merge validated incoming records into existing ones (pure). By id; the
 * record with the newer updatedAt wins; on a tie the local copy is kept (no
 * pointless write). Photos are immutable: added if missing. Incoming events
 * are first moved onto the matching local baby (planBabyMerge); any babyId
 * still unknown afterwards gets a placeholder baby so its events stay
 * reachable. Keeps the one-running-per-type-per-baby rule: an incoming
 * running event that would make a second running activity in its slot is
 * stopped at its start time.
 * An incoming timer running longer than its type's limit (STALE_RUNNING_LIMITS:
 * a partner forgot to stop it) is imported stopped at its start, with a note
 * saying so (stoppedStale).
 * @param {{ events?: object[], inventory?: object[], photoIds?: string[], babies?: object[] }} existing
 * @param {{ events?: object[], inventory?: object[], photos?: object[]|null, babies?: object[] }} incoming
 * @param {{ now?: number, force?: Record<string, string|null>|null }} [opts] force: see planBabyMerge
 * @returns {{ toPut: { events: object[], inventory: object[], photos: object[], babies: object[]|null }, stats: object, remap: Map<string, string> }}
 */
export function mergeBackup(existing = {}, incoming = {}, { now = Date.now(), force = null } = {}) {
  const stats = {
    events: { added: 0, updated: 0, unchanged: 0, stoppedRunning: 0, stoppedStale: 0 },
    inventory: { added: 0, updated: 0, unchanged: 0 },
    photos: { added: 0, unchanged: 0 },
    babies: { added: 0, matched: 0, placeholders: 0, addedBabies: [] },
  };
  const toPut = { events: [], inventory: [], photos: [], babies: null };

  const localBabies = existing.babies || [];
  const plan = planBabyMerge(localBabies, incoming.babies || [], { force });
  stats.babies.added = plan.stats.added;
  stats.babies.matched = plan.stats.matched;
  stats.babies.addedBabies = plan.stats.addedBabies;

  const localEvents = new Map((existing.events || []).map(e => [e.id, e]));
  const slot = e => `${e.type}|${e.babyId ?? ''}`;
  const runningBySlot = new Map();
  for (const e of localEvents.values()) if (e.endTime === null) runningBySlot.set(slot(e), e.id);
  for (const raw of incoming.events || []) {
    const inc = raw.babyId && plan.remap.has(raw.babyId) ? { ...raw, babyId: plan.remap.get(raw.babyId) } : raw;
    const local = localEvents.get(inc.id);
    let candidate;
    if (!local) {
      candidate = inc;
      stats.events.added += 1;
    } else if ((inc.updatedAt || 0) > (local.updatedAt || 0)) {
      candidate = inc;
      stats.events.updated += 1;
    } else {
      stats.events.unchanged += 1;
      continue;
    }
    if (isStaleRunning(candidate, now)) {
      candidate = stopStaleRunning(candidate);
      stats.events.stoppedStale += 1;
    }
    if (local && local.endTime === null && runningBySlot.get(slot(local)) === local.id
      && (candidate.endTime !== null || slot(candidate) !== slot(local))) {
      runningBySlot.delete(slot(local)); // the newer copy finished or moved it
    }
    if (candidate.endTime === null) {
      const holder = runningBySlot.get(slot(candidate));
      if (holder !== undefined && holder !== candidate.id) {
        candidate = { ...candidate, endTime: candidate.startTime };
        stats.events.stoppedRunning += 1;
      } else {
        runningBySlot.set(slot(candidate), candidate.id);
      }
    }
    toPut.events.push(candidate);
  }

  // Placeholders for babies the events point at but nobody listed.
  const known = new Set(plan.babies.map(b => b.id));
  for (const e of toPut.events) {
    if (e.babyId && !known.has(e.babyId)) {
      known.add(e.babyId);
      plan.babies.push({ id: e.babyId, name: '', birthDate: null, photoId: null, createdAt: null });
      stats.babies.placeholders += 1;
    }
  }
  if (JSON.stringify(plan.babies) !== JSON.stringify(localBabies)) toPut.babies = plan.babies;

  const localInv = new Map((existing.inventory || []).map(i => [i.id, i]));
  for (const inc of incoming.inventory || []) {
    const local = localInv.get(inc.id);
    if (!local) { toPut.inventory.push(inc); stats.inventory.added += 1; }
    else if (inventoryUpdatedAt(inc) > inventoryUpdatedAt(local)) { toPut.inventory.push(inc); stats.inventory.updated += 1; }
    else stats.inventory.unchanged += 1;
  }

  const localPhotos = new Set(existing.photoIds || []);
  for (const p of incoming.photos || []) {
    if (localPhotos.has(p.id)) { stats.photos.unchanged += 1; continue; }
    localPhotos.add(p.id);
    toPut.photos.push(p);
    stats.photos.added += 1;
  }
  return { toPut, stats, remap: plan.remap };
}

// ------------------------------------------------------------- CSV (pure)

/**
 * One CSV cell: always quoted, quotes doubled, and text that a spreadsheet
 * would run as a formula (= + - @ tab CR) is prefixed with ' — a backup
 * note of `=HYPERLINK(...)` must not become a live formula in the
 * pediatrician's Excel.
 * @param {unknown} v
 * @returns {string}
 */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const TYPE_LABEL = { feed: 'Feed', pump: 'Pump', sleep: 'Sleep', diaper: 'Diaper', milestone: 'Milestone' };
const DIAPER_LABEL = { wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty', dry: 'Dry' };
const LOCATION_LABEL = { fridge: 'fridge', freezer: 'freezer', deepFreezer: 'deep freezer' };

function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function details(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'feed':
      if (d.method === 'breast') return 'Breastfeeding';
      return `Bottle · ${d.milk === 'formula' ? 'Formula' : 'Breast milk'}`;
    case 'pump': return d.storedTo ? `Stored to ${LOCATION_LABEL[d.storedTo] || d.storedTo}` : '';
    case 'sleep': return d.kind === 'night' ? 'Night' : 'Nap';
    case 'diaper': return [DIAPER_LABEL[d.kind] || '', d.color, d.consistency].filter(Boolean).join(' · ');
    case 'milestone': return d.title || '';
    default: return '';
  }
}

/**
 * CSV for a pediatrician / lactation consultant: every event type, oldest
 * first, local dates and 24h times, amounts converted to one unit, and the
 * baby's name (blank for the parent's pumps). Pure.
 * @param {object[]} events
 * @param {{ unit?: 'oz'|'mL', now?: number, babies?: Array<{id:string, name:string}> }} [opts]
 * @returns {string} CSV text (UTF-8 BOM so Excel reads accents/emoji)
 */
export function buildCsv(events, { unit = 'oz', now = Date.now(), babies = [] } = {}) {
  const u = normalizeUnit(unit);
  const names = new Map((babies || []).map(b => [b.id, b.name || 'Baby']));
  const header = ['Date', 'Start', 'End', 'Duration (min)', 'Baby', 'Type', 'Details', 'Amount', 'Unit', 'Left (min)', 'Right (min)', 'Note'];
  const rows = [header];
  const sorted = (events || []).filter(e => e && EVENT_TYPES.includes(e.type) && Number.isFinite(e.startTime))
    .slice().sort((a, b) => a.startTime - b.startTime);
  for (const e of sorted) {
    const d = e.data || {};
    const runningNow = e.endTime === null;
    const end = runningNow ? null : e.endTime;
    const durMin = end !== null && end > e.startTime ? Math.round((end - e.startTime) / 6000) / 10 : '';
    const amt = toFiniteNumber(d.amount);
    const hasAmount = (e.type === 'feed' || e.type === 'pump') && amt !== null;
    let left = '';
    let right = '';
    if (e.type === 'feed' && d.method === 'breast') {
      const t = breastSideTotals(d, runningNow ? now : (end ?? now));
      left = Math.round(t.left / 6) / 10;
      right = Math.round(t.right / 6) / 10;
    }
    const det = details(e);
    rows.push([
      dayKey(e.startTime),
      hhmm(e.startTime),
      end !== null ? hhmm(end) : '',
      durMin,
      e.babyId ? (names.get(e.babyId) || 'Baby') : '',
      TYPE_LABEL[e.type],
      runningNow ? `${det}${det ? ' ' : ''}(in progress)` : det,
      hasAmount ? roundForUnit(convertQty(amt, d.unit, u), u) : '',
      hasAmount ? u : '',
      left,
      right,
      e.note || '',
    ]);
  }
  return `﻿${rows.map(r => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// --------------------------------------------------------------- IO glue

function stamp(now = Date.now()) {
  return dayKey(now);
}

async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Build the v2 backup object from the database.
 * @param {{ includePhotos?: boolean, now?: number }} [opts]
 * @returns {Promise<object>}
 */
export async function exportBackup({ includePhotos = false, now = Date.now() } = {}) {
  await loadSettings();
  const [events, inventory] = await Promise.all([getAll(STORES.events), getAll(STORES.inventory)]);
  const settings = {};
  for (const k of EXPORTABLE_KEYS) settings[k] = getSetting(k);
  const out = { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: new Date(now).toISOString(), events, inventory, settings };
  if (includePhotos) {
    const photos = await getAll(STORES.photos);
    out.photos = [];
    for (const p of photos) {
      if (!(p.blob instanceof Blob)) continue;
      out.photos.push({ id: p.id, type: p.type || p.blob.type || 'image/jpeg', width: p.width, height: p.height, createdAt: p.createdAt, data: await blobToBase64(p.blob) });
    }
  }
  return out;
}

/**
 * The backup as a File ready to share or download.
 * @param {{ includePhotos?: boolean, now?: number, name?: string }} [opts]
 * @returns {Promise<File>}
 */
export async function exportBackupFile(opts = {}) {
  const data = await exportBackup(opts);
  // Indent only small backups: pretty base64 photos would just bloat the file.
  const json = JSON.stringify(data, null, data.photos ? 0 : 2);
  return new File([json], opts.name || `nurture-backup-${stamp(opts.now)}.json`, { type: 'application/json' });
}

/**
 * The pediatrician CSV as a File. `babyId` limits it to one child (plus the
 * parent's pumps); default is everyone.
 * @param {{ unit?: 'oz'|'mL', now?: number, babyId?: string }} [opts] unit defaults to Settings
 * @returns {Promise<File>}
 */
export async function exportCsvFile({ unit, now = Date.now(), babyId } = {}) {
  await loadSettings();
  const events = (await getAll(STORES.events)).filter(e => matchesBaby(e, babyId));
  const csv = buildCsv(events, { unit: unit || getSetting('units'), now, babies: getSetting('babies') });
  return new File([csv], `nurture-log-${stamp(now)}.csv`, { type: 'text/csv;charset=utf-8' });
}

/**
 * Share a file via the OS share sheet when the browser can share files,
 * otherwise download it. Must be called from a user gesture.
 * @param {File} file
 * @param {{ title?: string }} [opts]
 * @returns {Promise<'share'|'download'|'cancelled'>}
 */
export async function shareFile(file, { title = 'Nurture' } = {}) {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    let can = false;
    try { can = nav.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try {
        await nav.share({ files: [file], title });
        return 'share';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
        // NotAllowedError etc. — fall back to a plain download.
      }
    }
  }
  downloadFile(file);
  return 'download';
}

/**
 * Save a file locally via a temporary <a download> (no innerHTML).
 * @param {File} file
 */
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Export the JSON backup and share/download it ("Save a backup to Files").
 * A completed share or download stamps settings.lastBackupAt, which quiets
 * the weekly nudge (§10b); a cancelled share sheet doesn't.
 * @param {{ includePhotos?: boolean }} [opts]
 * @returns {Promise<'share'|'download'|'cancelled'>}
 */
export async function shareBackup(opts = {}) {
  const result = await shareFile(await exportBackupFile(opts), { title: 'Nurture backup' });
  if (result !== 'cancelled') await markBackedUp();
  return result;
}

/**
 * Export the CSV log and share/download it. (A CSV can't be re-imported, so
 * it doesn't count as a backup.)
 * @param {{ unit?: 'oz'|'mL', babyId?: string }} [opts]
 * @returns {Promise<'share'|'download'|'cancelled'>}
 */
export async function shareCsv(opts = {}) {
  return shareFile(await exportCsvFile(opts), { title: 'Nurture log' });
}

async function readInput(file) {
  if (file && typeof file === 'object' && typeof file.text === 'function' && typeof file.size === 'number') {
    if (file.size > MAX_IMPORT_BYTES) throw new BackupError('That file is too large to be a Nurture backup.');
    const text = await file.text();
    try { return JSON.parse(text); } catch { throw new BackupError('This file isn’t a Nurture backup (it isn’t valid JSON).'); }
  }
  if (typeof file === 'string') {
    if (file.length > MAX_IMPORT_BYTES) throw new BackupError('That file is too large to be a Nurture backup.');
    try { return JSON.parse(file); } catch { throw new BackupError('This file isn’t a Nurture backup (it isn’t valid JSON).'); }
  }
  return file; // already-parsed object
}

function photoRecord(p) {
  const bytes = base64ToBytes(p.data);
  const blob = new Blob([bytes], { type: p.type });
  return { id: p.id, blob, width: p.width, height: p.height, createdAt: p.createdAt, type: p.type, bytes: blob.size };
}

// Is there anything on this device a replace-import would destroy? Events,
// pouches and photos — and the family's own settings: a named baby (or one
// with a birth date / photo), a parent name, or any exported preference
// changed from its default (§10b covers those too). Settings must be loaded.
async function hasAnyData() {
  const profile = getSetting('babies').some(b => b.name || b.birthDate || b.photoId)
    || EXPORTABLE_KEYS.some(k => k !== 'babies' && k !== 'activeBabyId'
      && JSON.stringify(getSetting(k)) !== JSON.stringify(DEFAULTS[k]));
  if (profile) return true;
  return transaction([STORES.events, STORES.inventory, STORES.photos], 'readonly', (s, ctx) => {
    let total = 0;
    ctx.done(false);
    for (const n of [STORES.events, STORES.inventory, STORES.photos]) {
      const r = s[n].count();
      r.onsuccess = () => { total += r.result; ctx.done(total > 0); };
    }
  });
}

/**
 * Import a backup file. 'merge' (default) keeps everything here and adds or
 * updates by id (newest wins); babies are matched (planBabyMerge) and only
 * empty local details are filled in; other settings are left alone.
 * 'replace' (behind a confirm sheet) first saves a safety backup of this
 * device's data (§10b: downloaded by default; `safetyBackup` overrides how),
 * then swaps events, stash and settings for the file's. A store is replaced
 * only when the file carries a list for it, so a photo-less backup can't
 * wipe the photo journal (and when the file has no event list, our events
 * stay — and so do their babies, which the file's are merged into). A file
 * whose events/stash/photos are not a list, or whose entries were ALL
 * rejected, is refused before anything is touched. If the safety backup
 * can't be saved, nothing is replaced. The safety copy is ALSO kept on this
 * phone (SAFETY_COPY_KEY, written in the replace's own transaction), because
 * a download can silently fail (a cancelled iOS "Download?" prompt, a
 * standalone PWA): restoreSafetyCopy() undoes the replace (DI-01).
 * Merge refuses a file of which nothing at all could be read (DI-11).
 * Imported pouches get this phone's storage windows (clampExpiryToWindows,
 * DI-02); `storageWindows` overrides which windows (onboarding restore adopts
 * the file's). A merge onto an untouched default profile adopts the file's
 * babies and active baby (DI-03); memory covers are merged (FLOW-07).
 * Throws BackupError with a user-facing message.
 * @param {File|Blob|string|object} file
 * @param {{ mode?: 'merge'|'replace', safetyBackup?: ((file: File) => (void|Promise<void>))|null,
 *   keepSafetyCopy?: boolean, babyMatches?: Record<string, string|null>|null, storageWindows?: object|null,
 *   freshInstall?: boolean }} [opts] freshInstall: onboarding's restore — this phone's one baby, with no
 *   entries yet, gives way to the file's babies even if a name was typed (DI-03).
 * @returns {Promise<{ mode: string, format: string, stats: object, warnings: string[], safetyBackup: string|null, safetyKept: boolean, adoptedProfile: boolean }>}
 */
export async function importBackup(file, { mode = 'merge', safetyBackup = downloadFile, keepSafetyCopy = true, babyMatches = null, storageWindows = null, freshInstall = false } = {}) {
  if (mode !== 'merge' && mode !== 'replace') throw new BackupError(`Unknown import mode: ${mode}`);
  const parsed = await readInput(file);
  const deviceId = await getDeviceId(); // also loads settings
  const localBabies = getSetting('babies');
  const localActive = getSetting('activeBabyId');
  const v = validateBackup(parsed, { deviceId, defaultBabyId: localActive || undefined });
  if (!v.ok) throw new BackupError(v.error);
  const what = { events: 'log', inventory: 'stash', photos: 'photos' };
  if (mode === 'merge' && v.damaged.length
    && v.stats.events.accepted + v.stats.inventory.accepted + v.stats.photos.accepted === 0) {
    throw new BackupError(`This backup’s ${v.damaged.map(k => what[k]).join(' and ')} couldn’t be read, so nothing was merged. Try another backup file.`);
  }

  let photoRecords;
  try {
    photoRecords = (v.data.photos || []).map(photoRecord);
  } catch {
    throw new BackupError('The photos in this backup are damaged.');
  }

  const replace = mode === 'replace';
  if (replace && v.damaged.length) {
    throw new BackupError(`This backup’s ${v.damaged.map(k => what[k]).join(' and ')} couldn’t be read, so nothing was replaced. Try another backup file.`);
  }
  // replace: clear a store only when the file carries a list for it.
  const replaceEvents = replace && v.collections.events.present;
  const replaceInventory = replace && v.collections.inventory.present;
  const replacePhotos = replace && v.data.photos !== null;
  const incomingBabies = v.data.settings.babies || [];
  // replace: the file's babies replace ours — unless it lists none (ours
  // stay and its events land on them), or it has no event list (our events
  // stay, so their babies must too: the file's are merged in instead).
  // An untouched default baby (fresh install, onboarding restore) gives way
  // to the file's babies instead of staying as an empty extra "Baby".
  const localEvents = replaceEvents ? [] : await getAll(STORES.events);
  const pristine = incomingBabies.length > 0 && isPristineProfile(localBabies, localEvents, { ignoreDetails: freshInstall });
  const existingBabies = (replaceEvents && incomingBabies.length) || pristine ? [] : localBabies;
  // A photo or birth date picked during onboarding isn't thrown away when
  // the file's only baby has none.
  let adoptedBabies = incomingBabies;
  if (pristine && incomingBabies.length === 1) {
    const mine = localBabies[0] || {};
    const theirs = { ...incomingBabies[0] };
    for (const k of ['birthDate', 'photoId']) if (!theirs[k] && mine[k]) theirs[k] = mine[k];
    adoptedBabies = [theirs];
  }
  const existing = {
    events: localEvents,
    inventory: replaceInventory ? [] : await getAll(STORES.inventory),
    babies: existingBabies,
    photoIds: replacePhotos ? [] : (await getAll(STORES.photos)).map(p => p.id),
  };
  const windows = storageWindows || (replace && v.data.settings.storageWindows) || getSetting('storageWindows');
  const inventory = v.data.inventory.map(i => clampExpiryToWindows(i, windows));
  const { toPut, stats, remap } = mergeBackup(existing, { ...v.data, inventory, photos: v.data.photos || [], babies: adoptedBabies }, { force: babyMatches });
  const finalBabies = toPut.babies || existingBabies;
  if (finalBabies.length > MAX_BABIES) throw new BackupError(`This backup has more than ${MAX_BABIES} babies.`);
  const photosById = new Map(photoRecords.map(p => [p.id, p]));

  const settingsToPut = {};
  if (replace) {
    Object.assign(settingsToPut, v.data.settings);
    delete settingsToPut.babies;
    delete settingsToPut.activeBabyId;
    if (toPut.babies) settingsToPut.babies = toPut.babies;
    const wantActive = v.data.settings.activeBabyId || localActive;
    if (finalBabies.some(b => b.id === wantActive)) settingsToPut.activeBabyId = wantActive;
  } else {
    if (toPut.babies) settingsToPut.babies = toPut.babies;
    if (pristine) {
      const want = v.data.settings.activeBabyId;
      settingsToPut.activeBabyId = finalBabies.some(b => b.id === want) ? want : finalBabies[0].id;
      // The app icon made from the placeholder's photo follows that photo.
      const gone = localBabies[0] && localBabies[0].id;
      if (gone && getSetting('iconBabyId') === gone && !finalBabies.some(b => b.id === gone)) {
        const heir = finalBabies.find(b => b.photoId && b.photoId === localBabies[0].photoId);
        settingsToPut.iconBabyId = heir ? heir.id : null;
        if (!heir) settingsToPut.iconDataUrl = null;
      }
    }
    if (!getSetting('parentName') && v.data.settings.parentName) settingsToPut.parentName = v.data.settings.parentName;
    // Memory covers: the file's, for babies that have none here (FLOW-07).
    const finalEvents = new Map(existing.events.map(e => [e.id, e]));
    for (const e of toPut.events) finalEvents.set(e.id, e);
    const covers = mergeCovers(pristine ? {} : getSetting('memoryCovers'), v.data.settings.memoryCovers, {
      remap, babyIds: new Set(finalBabies.map(b => b.id)), events: finalEvents,
    });
    if (covers) settingsToPut.memoryCovers = covers;
  }

  // §10b: never destroy data that exists only on this phone without first
  // saving a copy of it. Done after validation, so a bad file costs nothing.
  let safetyName = null;
  let safetyRecord = null;
  const now = Date.now();
  if (replace && await hasAnyData()) {
    const safety = await exportBackupFile({ includePhotos: replacePhotos, name: `nurture-backup-before-import-${stamp()}.json` });
    if (typeof safetyBackup === 'function') {
      try {
        await safetyBackup(safety);
      } catch {
        throw new BackupError('Couldn’t save a safety copy of the current data, so nothing was replaced.');
      }
    }
    safetyName = safety.name;
    if (keepSafetyCopy) {
      safetyRecord = { key: SAFETY_COPY_KEY, value: { name: safety.name, createdAt: now, blob: new Blob([safety], { type: 'application/json' }) }, updatedAt: now };
    }
  }

  try {
    await transaction([STORES.events, STORES.inventory, STORES.photos, STORES.settings], 'readwrite', (s) => {
    if (replaceEvents) s.events.clear();
    if (replaceInventory) s.inventory.clear();
    if (replacePhotos) s.photos.clear();
    for (const e of toPut.events) s.events.put(e);
    for (const i of toPut.inventory) s.inventory.put(i);
    for (const p of toPut.photos) {
      const rec = photosById.get(p.id);
      if (rec) s.photos.put(rec);
    }
    for (const [key, value] of Object.entries(settingsToPut)) s.settings.put({ key, value, updatedAt: now });
    if (safetyRecord) s.settings.put(safetyRecord);
    });
  } catch (err) {
    // Nothing was written (one transaction). Out of space is the likely cause.
    if (err && err.name === 'QuotaExceededError') throw new BackupError('This phone is out of space for Nurture, so nothing was changed. Free some space, then try again.');
    throw err;
  }

  notifyEvents({ op: 'bulk' });
  notifyStash({ op: 'bulk' });
  if (toPut.photos.length || replacePhotos) notifyPhotosBulk();
  if (Object.keys(settingsToPut).length) await reloadSettings();

  return {
    mode,
    format: v.format,
    stats: { ...stats, rejected: { events: v.stats.events.rejected, inventory: v.stats.inventory.rejected, photos: v.stats.photos.rejected }, settings: Object.keys(settingsToPut) },
    warnings: v.warnings,
    safetyBackup: safetyName,
    safetyKept: !!safetyRecord,
    // This phone's untouched placeholder baby gave way to the file's (DI-03).
    adoptedProfile: !replace && pristine,
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-line summary of an import (shown as a toast by Settings and by
 * onboarding's restore), from importBackup's result. Pure. It only claims
 * what happened: the safety copy is mentioned only when it was kept on this
 * phone (DI-01); a baby the merge added is named, with where to switch to it
 * (DI-04); skipped entries and timers that were stopped are counted (DI-11,
 * DI-12).
 * @param {object} res importBackup's result
 * @param {{ restore?: boolean }} [opts] restore: onboarding's "Welcome back"
 * @returns {string}
 */
export function describeImport(res, { restore = false } = {}) {
  const r = res || {};
  const s = r.stats || {};
  if (r.mode === 'replace') {
    return r.safetyKept ? 'Replaced with the backup. What was here is kept on this phone.' : 'Replaced with the backup.';
  }
  const ev = s.events ? (s.events.added || 0) + (s.events.updated || 0) : 0;
  const inv = s.inventory ? (s.inventory.added || 0) + (s.inventory.updated || 0) : 0;
  const ph = s.photos ? s.photos.added || 0 : 0;
  const parts = [];
  if (ev) parts.push(plural(ev, 'entry', 'entries'));
  if (inv) parts.push(plural(inv, 'pouch', 'pouches'));
  if (ph) parts.push(plural(ph, 'photo'));
  let msg;
  if (restore) msg = parts.length ? `Welcome back · ${parts.join(', ')} restored` : 'Welcome back · that file had nothing new';
  else msg = parts.length ? `Merged · ${parts.join(', ')} added` : 'Already up to date · nothing new in that file';
  const tail = [];
  const rej = s.rejected || {};
  const skipped = (rej.events || 0) + (rej.inventory || 0);
  if (skipped) tail.push(`${plural(skipped, 'entry', 'entries')} skipped`);
  const stale = s.events ? s.events.stoppedStale || 0 : 0;
  if (stale) tail.push(`${plural(stale, 'old timer')} stopped`);
  if (tail.length) msg += ` · ${tail.join(', ')}`;
  if (!restore && !r.adoptedProfile && s.babies) {
    const named = (s.babies.addedBabies || []).map(b => b.name).filter(Boolean);
    const unnamed = (s.babies.added || 0) - named.length + (s.babies.placeholders || 0);
    const who = [...named];
    if (unnamed > 0) who.push(unnamed === 1 ? 'an unnamed baby' : `${unnamed} unnamed babies`);
    if (who.length) {
      const list = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}` : who[0];
      msg += `. Added ${list} as ${who.length === 1 && !(unnamed > 1) ? 'a new baby' : 'new babies'}. Switch babies from the name on Today.`;
    }
  }
  return msg;
}

/**
 * Remove a baby (a sibling added by mistake, a test name, a duplicate from a
 * partner merge — FLOW-05, DI-03, DI-04): deletes that baby's entries (never
 * the parent's own pumps, which have no baby) and the photos only they used,
 * drops their memory cover (and the app icon made from their photo), and
 * moves Today to another baby. Never the last baby. A safety copy is kept on
 * this phone (SAFETY_COPY_KEY) in the same transaction, so
 * restoreSafetyCopy() undoes it; `safetyBackup` also hands that copy out
 * (downloaded by default, null for none).
 * The baby list, active baby, covers and icon are read from the STORE inside
 * the write transaction (another tab may have changed them), so nothing is
 * rebuilt from this tab's cache.
 * Throws BackupError: code 'missing' (no such baby), 'last' (the only baby).
 * @param {string} id
 * @param {{ safetyBackup?: ((file: File) => (void|Promise<void>))|null, keepSafetyCopy?: boolean }} [opts]
 * @returns {Promise<{ name: string, entries: number, photos: number, safetyKept: boolean }>}
 */
export async function removeBaby(id, { safetyBackup = downloadFile, keepSafetyCopy = true } = {}) {
  await loadSettings();
  const cached = getSetting('babies');
  const refuse = (code) => {
    const err = new BackupError(code === 'last' ? 'The only baby can’t be removed.' : 'That baby isn’t here anymore.');
    err.code = code;
    return err;
  };
  if (!cached.some(b => b.id === id)) throw refuse('missing');
  if (cached.length < 2) throw refuse('last');

  const photoIdsOf = e => (e && e.data && Array.isArray(e.data.photoIds) ? e.data.photoIds : []);
  const now = Date.now();
  let safetyRecord = null;
  if (keepSafetyCopy || typeof safetyBackup === 'function') {
    // Photos go into the copy only when some will be deleted (a photo-less
    // copy leaves the photo journal alone when it is put back).
    const target = cached.find(b => b.id === id);
    const needPhotos = !!target.photoId || (await getAll(STORES.events)).some(e => e.babyId === id && photoIdsOf(e).length > 0);
    const safety = await exportBackupFile({ includePhotos: needPhotos, name: `nurture-backup-before-removing-${stamp()}.json` });
    if (typeof safetyBackup === 'function') {
      try { await safetyBackup(safety); } catch { throw new BackupError('Couldn’t save a safety copy first, so nothing was removed.'); }
    }
    if (keepSafetyCopy) safetyRecord = { key: SAFETY_COPY_KEY, value: { name: safety.name, createdAt: now, blob: new Blob([safety], { type: 'application/json' }) }, updatedAt: now };
  }

  let result;
  try {
    result = await transaction([STORES.events, STORES.photos, STORES.settings], 'readwrite', (s, ctx) => {
      const keys = ['babies', 'activeBabyId', 'memoryCovers', 'iconBabyId'];
      const reqs = Object.fromEntries(keys.map(k => [k, s.settings.get(k)]));
      const evReq = s.events.getAll();
      evReq.onsuccess = () => {
        const raw = k => (reqs[k].result ? reqs[k].result.value : undefined);
        const babiesRes = sanitizeSetting('babies', raw('babies'), { lenient: true });
        const list = babiesRes.ok ? babiesRes.value : [];
        const baby = list.find(b => b.id === id);
        if (!baby) { ctx.fail(refuse('missing')); return; }
        if (list.length < 2) { ctx.fail(refuse('last')); return; }
        const all = evReq.result || [];
        const theirs = all.filter(e => e.babyId === id);
        const keep = new Set();
        for (const e of all) if (e.babyId !== id) photoIdsOf(e).forEach(p => keep.add(p));
        for (const b of list) if (b.id !== id && b.photoId) keep.add(b.photoId);
        const photoIds = [...new Set([baby.photoId, ...theirs.flatMap(photoIdsOf)])].filter(p => p && !keep.has(p));
        const rest = list.filter(b => b.id !== id);
        const coversRes = sanitizeSetting('memoryCovers', raw('memoryCovers'), { lenient: true });
        const covers = coversRes.ok ? coversRes.value : {};
        const put = (key, value) => s.settings.put({ key, value, updatedAt: now });
        put('babies', rest);
        if (Object.prototype.hasOwnProperty.call(covers, id)) { delete covers[id]; put('memoryCovers', covers); }
        const active = raw('activeBabyId');
        if (active === id || !rest.some(b => b.id === active)) put('activeBabyId', rest[0].id);
        if (raw('iconBabyId') === id) { put('iconBabyId', null); put('iconDataUrl', null); }
        for (const e of theirs) s.events.delete(e.id);
        for (const p of photoIds) s.photos.delete(p);
        if (safetyRecord) s.settings.put(safetyRecord);
        ctx.done({ name: baby.name || '', entries: theirs.length, photos: photoIds.length });
      };
    });
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') throw new BackupError('This phone is out of space for Nurture, so nothing was removed. Free some space, then try again.');
    throw err;
  }
  notifyEvents({ op: 'bulk' });
  if (result.photos) notifyPhotosBulk();
  await reloadSettings();
  return { ...result, safetyKept: !!safetyRecord };
}

/**
 * Before a merge: does the parent need to say whether the file's baby is
 * this phone's baby (babyQuestion, DI-04)? Reads and validates the file
 * without writing anything. Null when there's nothing to ask (or the file
 * is unreadable — importBackup then says why).
 * @param {File|Blob|string|object} file
 * @returns {Promise<{ local: {id:string, name:string}, incoming: {id:string, name:string} }|null>}
 */
export async function previewBabyQuestion(file) {
  let parsed;
  try { parsed = await readInput(file); } catch { return null; }
  await loadSettings();
  const v = validateBackup(parsed, { defaultBabyId: getSetting('activeBabyId') || undefined });
  if (!v.ok) return null;
  return babyQuestion(getSetting('babies'), v.data.settings.babies || []);
}

/**
 * The copy of this phone's data kept by the last Replace import, or null.
 * @returns {Promise<{ name: string, createdAt: number, blob: Blob }|null>}
 */
export async function getSafetyCopy() {
  const rec = await transaction(STORES.settings, 'readonly', (s, ctx) => {
    const g = s.settings.get(SAFETY_COPY_KEY);
    g.onsuccess = () => ctx.done(g.result || null);
  });
  const v = rec && rec.value;
  return v && v.blob instanceof Blob ? { name: String(v.name || ''), createdAt: Number(v.createdAt) || 0, blob: v.blob } : null;
}

/** Forget the kept safety copy. */
export async function clearSafetyCopy() {
  await transaction(STORES.settings, 'readwrite', (s) => { s.settings.delete(SAFETY_COPY_KEY); });
}

/**
 * Undo the last Replace import: put back what was on this phone before it
 * (the kept safety copy), then forget the copy. Throws BackupError when
 * there is none.
 * @returns {Promise<object>} importBackup's result
 */
export async function restoreSafetyCopy() {
  const copy = await getSafetyCopy();
  if (!copy) throw new BackupError('There’s no earlier copy to put back.');
  const res = await importBackup(copy.blob, { mode: 'replace', safetyBackup: null, keepSafetyCopy: false });
  await clearSafetyCopy();
  return res;
}

/**
 * Erase ALL data on this device (events, stash, photos, settings, legacy v1
 * stores, and Nurture's localStorage keys). Not undoable — put it behind a
 * confirm sheet — then reload the page. Settings reload afterwards, which
 * mints a fresh deviceId and default baby, as on a new install.
 * @param {{ storage?: Storage }} [opts]
 * @returns {Promise<void>}
 */
export async function eraseAll({ storage } = {}) {
  const names = [STORES.events, STORES.inventory, STORES.photos, STORES.settings, STORES.sessions, STORES.bottles];
  await transaction(names, 'readwrite', (s) => { for (const n of names) s[n].clear(); });
  try {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (ls) {
      const keys = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && /^(nurture|savannah)_/.test(k)) keys.push(k);
      }
      keys.forEach(k => ls.removeItem(k));
    }
  } catch { /* storage blocked: nothing to clear */ }
  notifyEvents({ op: 'bulk' });
  notifyStash({ op: 'bulk' });
  notifyPhotosBulk();
  await reloadSettings();
}

/** The backup API as one object. `share` is ARCHITECTURE §10b's backup.share(). */
export const backup = Object.freeze({
  exportBackup, exportBackupFile, exportCsvFile, buildCsv, validateBackup, mergeBackup, planBabyMerge, importBackup, describeImport,
  getSafetyCopy, clearSafetyCopy, restoreSafetyCopy, babyQuestion, previewBabyQuestion, isPristineProfile, removeBaby,
  share: shareBackup, shareBackup, shareCsv, shareFile, downloadFile, eraseAll,
});
