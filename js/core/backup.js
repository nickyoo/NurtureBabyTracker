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
import { inventoryUpdatedAt } from '../domain/inventory.js';
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
 * @param {object[]} [local]
 * @param {object[]} [incoming]
 * @returns {{ babies: object[], remap: Map<string, string>, stats: { added: number, matched: number } }}
 */
export function planBabyMerge(local = [], incoming = []) {
  const babies = (local || []).map(b => ({ ...b }));
  const remap = new Map();
  const claimed = new Set();
  const stats = { added: 0, matched: 0 };
  const inc = incoming || [];
  const onlyChildren = babies.length === 1 && inc.length === 1;
  for (const b of inc) {
    let target = babies.find(x => x.id === b.id);
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
    }
  }
  return { babies, remap, stats };
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
 * @param {{ events?: object[], inventory?: object[], photoIds?: string[], babies?: object[] }} existing
 * @param {{ events?: object[], inventory?: object[], photos?: object[]|null, babies?: object[] }} incoming
 * @returns {{ toPut: { events: object[], inventory: object[], photos: object[], babies: object[]|null }, stats: object }}
 */
export function mergeBackup(existing = {}, incoming = {}) {
  const stats = {
    events: { added: 0, updated: 0, unchanged: 0, stoppedRunning: 0 },
    inventory: { added: 0, updated: 0, unchanged: 0 },
    photos: { added: 0, unchanged: 0 },
    babies: { added: 0, matched: 0, placeholders: 0 },
  };
  const toPut = { events: [], inventory: [], photos: [], babies: null };

  const localBabies = existing.babies || [];
  const plan = planBabyMerge(localBabies, incoming.babies || []);
  stats.babies.added = plan.stats.added;
  stats.babies.matched = plan.stats.matched;

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
  return { toPut, stats };
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
 * can't be saved, nothing is replaced.
 * Throws BackupError with a user-facing message.
 * @param {File|Blob|string|object} file
 * @param {{ mode?: 'merge'|'replace', safetyBackup?: (file: File) => (void|Promise<void>) }} [opts]
 * @returns {Promise<{ mode: string, format: string, stats: object, warnings: string[], safetyBackup: string|null }>}
 */
export async function importBackup(file, { mode = 'merge', safetyBackup = downloadFile } = {}) {
  if (mode !== 'merge' && mode !== 'replace') throw new BackupError(`Unknown import mode: ${mode}`);
  const parsed = await readInput(file);
  const deviceId = await getDeviceId(); // also loads settings
  const localBabies = getSetting('babies');
  const localActive = getSetting('activeBabyId');
  const v = validateBackup(parsed, { deviceId, defaultBabyId: localActive || undefined });
  if (!v.ok) throw new BackupError(v.error);

  let photoRecords;
  try {
    photoRecords = (v.data.photos || []).map(photoRecord);
  } catch {
    throw new BackupError('The photos in this backup are damaged.');
  }

  const replace = mode === 'replace';
  if (replace && v.damaged.length) {
    const what = { events: 'log', inventory: 'stash', photos: 'photos' };
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
  const existingBabies = replaceEvents && incomingBabies.length ? [] : localBabies;
  const existing = {
    events: replaceEvents ? [] : await getAll(STORES.events),
    inventory: replaceInventory ? [] : await getAll(STORES.inventory),
    babies: existingBabies,
    photoIds: replacePhotos ? [] : (await getAll(STORES.photos)).map(p => p.id),
  };
  const { toPut, stats } = mergeBackup(existing, { ...v.data, photos: v.data.photos || [], babies: incomingBabies });
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
    if (!getSetting('parentName') && v.data.settings.parentName) settingsToPut.parentName = v.data.settings.parentName;
  }

  // §10b: never destroy data that exists only on this phone without first
  // saving a copy of it. Done after validation, so a bad file costs nothing.
  let safetyName = null;
  if (replace && await hasAnyData()) {
    const safety = await exportBackupFile({ includePhotos: replacePhotos, name: `nurture-backup-before-import-${stamp()}.json` });
    try {
      await safetyBackup(safety);
    } catch {
      throw new BackupError('Couldn’t save a safety copy of the current data, so nothing was replaced.');
    }
    safetyName = safety.name;
  }

  const now = Date.now();
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
  });

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
  };
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
  exportBackup, exportBackupFile, exportCsvFile, buildCsv, validateBackup, mergeBackup, planBabyMerge, importBackup,
  share: shareBackup, shareBackup, shareCsv, shareFile, downloadFile, eraseAll,
});
