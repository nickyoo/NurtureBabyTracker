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

import { transaction, getAll, STORES } from './db.js';
import { sanitizeEvent, notifyEvents, EVENT_TYPES, ID_RE } from './store.js';
import { sanitizeInventoryItem, notifyStash } from './stash.js';
import {
  sanitizeSetting, EXPORTABLE_KEYS, get as getSetting, load as loadSettings, reload as reloadSettings, deviceId as getDeviceId,
} from './settings.js';
import { sessionToEvent, mapV1Settings } from './migrate.js';
import { notifyPhotosBulk } from './photos.js';
import { inventoryUpdatedAt } from '../domain/inventory.js';
import { breastSideTotals } from '../domain/safety.js';
import { convertQty, normalizeUnit, roundForUnit, toFiniteNumber } from './units.js';
import { dayKey } from './time.js';

export const BACKUP_APP = 'nurture';
export const BACKUP_SCHEMA = 2;
/** Refuse files bigger than this before reading them into memory. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** Per-collection record caps (years of heavy use fit comfortably). */
export const MAX_RECORDS = Object.freeze({ events: 200000, inventory: 50000, photos: 5000 });
/** Max base64 length of one photo (~15 MB of JPEG). */
export const MAX_PHOTO_BASE64 = 20 * 1024 * 1024;
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

function sanitizePhotoEntry(raw) {
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
    createdAt: createdAt !== null && createdAt >= Date.UTC(2000, 0, 1) && createdAt <= Date.UTC(2100, 0, 1) ? createdAt : Date.UTC(2000, 0, 1),
    data,
  };
}

function collect(list, cap, sanitize, label, warnings) {
  const out = new Map();
  let rejected = 0;
  if (list === undefined || list === null) return { items: [], rejected };
  if (!Array.isArray(list)) {
    warnings.push(`${label} was not a list and was skipped`);
    return { items: [], rejected };
  }
  if (list.length > cap) {
    warnings.push(`Only the first ${cap} ${label} were read`);
    rejected += list.length - cap;
  }
  const n = Math.min(list.length, cap);
  for (let i = 0; i < n; i++) {
    const rec = sanitize(list[i]);
    if (!rec) { rejected += 1; continue; }
    // Duplicate ids inside one file: keep the newest version.
    const prev = out.get(rec.id);
    if (!prev || (rec.updatedAt || 0) > (prev.updatedAt || 0)) out.set(rec.id, rec);
  }
  return { items: [...out.values()], rejected };
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
 * @param {unknown} input parsed JSON
 * @param {{ now?: number, deviceId?: string }} [opts]
 * @returns {{ ok: false, error: string } | {
 *   ok: true, format: 'v1'|'v2',
 *   data: { events: object[], inventory: object[], settings: object, photos: object[]|null },
 *   stats: { events: {accepted:number, rejected:number}, inventory: {accepted:number, rejected:number}, photos: {accepted:number, rejected:number}, settings: {accepted:string[], rejected:string[]} },
 *   warnings: string[]
 * }}
 */
export function validateBackup(input, { now = Date.now(), deviceId } = {}) {
  const format = detectFormat(input);
  if (format === 'newer') return { ok: false, error: 'This backup is from a newer version of Nurture. Update the app, then try again.' };
  if (!format) return { ok: false, error: 'This file isn’t a Nurture backup.' };
  const warnings = [];

  let ev;
  let settings = {};
  const settingsStats = { accepted: [], rejected: [] };
  if (format === 'v2') {
    ev = collect(own(input, 'events'), MAX_RECORDS.events, raw => {
      const r = sanitizeEvent(raw, { now });
      return r.ok ? r.value : null;
    }, 'events', warnings);
    const s = own(input, 'settings');
    if (isPlainObject(s)) {
      for (const key of Object.keys(s)) {
        if (!EXPORTABLE_KEYS.includes(key)) { settingsStats.rejected.push(key.slice(0, 40)); continue; }
        const res = sanitizeSetting(key, s[key]);
        if (res.ok) { settings[key] = res.value; settingsStats.accepted.push(key); } else settingsStats.rejected.push(key);
      }
    }
  } else {
    ev = collect(own(input, 'sessions'), MAX_RECORDS.events, raw => sessionToEvent(raw, { deviceId, now }), 'sessions', warnings);
    const mapped = Array.isArray(own(input, 'settings')) ? mapV1Settings(own(input, 'settings')) : {};
    for (const [key, value] of Object.entries(mapped)) {
      if (EXPORTABLE_KEYS.includes(key)) { settings[key] = value; settingsStats.accepted.push(key); }
    }
    const bottles = own(input, 'bottles');
    if (Array.isArray(bottles) && bottles.length) warnings.push('Old prepared-bottle records aren’t used any more and were skipped');
  }
  const inv = collect(own(input, 'inventory'), MAX_RECORDS.inventory, sanitizeInventoryItem, 'stash items', warnings);

  const rawPhotos = own(input, 'photos');
  const ph = format === 'v2' && rawPhotos !== undefined && rawPhotos !== null
    ? collect(rawPhotos, MAX_RECORDS.photos, sanitizePhotoEntry, 'photos', warnings)
    : null;

  return {
    ok: true,
    format,
    data: { events: ev.items, inventory: inv.items, settings, photos: ph ? ph.items : null },
    stats: {
      events: { accepted: ev.items.length, rejected: ev.rejected },
      inventory: { accepted: inv.items.length, rejected: inv.rejected },
      photos: { accepted: ph ? ph.items.length : 0, rejected: ph ? ph.rejected : 0 },
      settings: settingsStats,
    },
    warnings,
  };
}

/**
 * Merge validated incoming records into existing ones (pure). By id; the
 * record with the newer updatedAt wins; on a tie the local copy is kept (no
 * pointless write). Photos are immutable: added if missing. Keeps the
 * one-running-per-type rule: an incoming running event that would make a
 * second running activity of its type is stopped at its start time.
 * @param {{ events?: object[], inventory?: object[], photoIds?: string[] }} existing
 * @param {{ events?: object[], inventory?: object[], photos?: object[]|null }} incoming
 * @returns {{ toPut: { events: object[], inventory: object[], photos: object[] }, stats: object }}
 */
export function mergeBackup(existing = {}, incoming = {}) {
  const stats = {
    events: { added: 0, updated: 0, unchanged: 0, stoppedRunning: 0 },
    inventory: { added: 0, updated: 0, unchanged: 0 },
    photos: { added: 0, unchanged: 0 },
  };
  const toPut = { events: [], inventory: [], photos: [] };

  const localEvents = new Map((existing.events || []).map(e => [e.id, e]));
  const runningByType = new Map();
  for (const e of localEvents.values()) if (e.endTime === null) runningByType.set(e.type, e.id);
  for (const inc of incoming.events || []) {
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
    if (local && local.endTime === null && runningByType.get(local.type) === local.id && candidate.endTime !== null) {
      runningByType.delete(local.type); // the newer copy finished it
    }
    if (candidate.endTime === null) {
      const holder = runningByType.get(candidate.type);
      if (holder !== undefined && holder !== candidate.id) {
        candidate = { ...candidate, endTime: candidate.startTime };
        stats.events.stoppedRunning += 1;
      } else {
        runningByType.set(candidate.type, candidate.id);
      }
    }
    toPut.events.push(candidate);
  }

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
 * first, local dates and 24h times, amounts converted to one unit. Pure.
 * @param {object[]} events
 * @param {{ unit?: 'oz'|'mL', now?: number }} [opts]
 * @returns {string} CSV text (UTF-8 BOM so Excel reads accents/emoji)
 */
export function buildCsv(events, { unit = 'oz', now = Date.now() } = {}) {
  const u = normalizeUnit(unit);
  const header = ['Date', 'Start', 'End', 'Duration (min)', 'Type', 'Details', 'Amount', 'Unit', 'Left (min)', 'Right (min)', 'Note'];
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
 * @param {{ includePhotos?: boolean, now?: number }} [opts]
 * @returns {Promise<File>}
 */
export async function exportBackupFile(opts = {}) {
  const data = await exportBackup(opts);
  // Indent only small backups: pretty base64 photos would just bloat the file.
  const json = JSON.stringify(data, null, data.photos ? 0 : 2);
  return new File([json], `nurture-backup-${stamp(opts.now)}.json`, { type: 'application/json' });
}

/**
 * The pediatrician CSV as a File.
 * @param {{ unit?: 'oz'|'mL', now?: number }} [opts] unit defaults to Settings
 * @returns {Promise<File>}
 */
export async function exportCsvFile({ unit, now = Date.now() } = {}) {
  await loadSettings();
  const events = await getAll(STORES.events);
  const csv = buildCsv(events, { unit: unit || getSetting('units'), now });
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
 * Export the JSON backup and share/download it.
 * @param {{ includePhotos?: boolean }} [opts]
 * @returns {Promise<'share'|'download'|'cancelled'>}
 */
export async function shareBackup(opts = {}) {
  return shareFile(await exportBackupFile(opts), { title: 'Nurture backup' });
}

/**
 * Export the CSV log and share/download it.
 * @param {{ unit?: 'oz'|'mL' }} [opts]
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

/**
 * Import a backup file. 'merge' (default) keeps everything here and adds or
 * updates by id (newest wins); settings are left alone except empty profile
 * fields. 'replace' (behind a confirm sheet) swaps events, stash and
 * settings for the file's — photos are replaced only when the file carries
 * photos, so a photo-less backup can't wipe the photo journal. Throws
 * BackupError with a user-facing message.
 * @param {File|Blob|string|object} file
 * @param {{ mode?: 'merge'|'replace' }} [opts]
 * @returns {Promise<{ mode: string, format: string, stats: object, warnings: string[] }>}
 */
export async function importBackup(file, { mode = 'merge' } = {}) {
  if (mode !== 'merge' && mode !== 'replace') throw new BackupError(`Unknown import mode: ${mode}`);
  const parsed = await readInput(file);
  const deviceId = await getDeviceId();
  const v = validateBackup(parsed, { deviceId });
  if (!v.ok) throw new BackupError(v.error);

  let photoRecords;
  try {
    photoRecords = (v.data.photos || []).map(photoRecord);
  } catch {
    throw new BackupError('The photos in this backup are damaged.');
  }

  const replace = mode === 'replace';
  const replacePhotos = replace && v.data.photos !== null;
  const existing = replace
    ? { events: [], inventory: [], photoIds: replacePhotos ? [] : (await getAll(STORES.photos)).map(p => p.id) }
    : {
      events: await getAll(STORES.events),
      inventory: await getAll(STORES.inventory),
      photoIds: (await getAll(STORES.photos)).map(p => p.id),
    };
  const { toPut, stats } = mergeBackup(existing, { ...v.data, photos: v.data.photos || [] });
  const photosById = new Map(photoRecords.map(p => [p.id, p]));

  // Settings: replace → the file's exportable settings; merge → only fill
  // profile fields that are still empty here.
  await loadSettings();
  const settingsToPut = {};
  if (replace) {
    Object.assign(settingsToPut, v.data.settings);
  } else if (v.data.settings.profile) {
    const local = getSetting('profile');
    const inc = v.data.settings.profile;
    const merged = { ...local };
    let changed = false;
    for (const k of ['babyName', 'parentName', 'birthDate']) {
      if (!local[k] && inc[k]) { merged[k] = inc[k]; changed = true; }
    }
    if (changed) settingsToPut.profile = merged;
  }

  const now = Date.now();
  await transaction([STORES.events, STORES.inventory, STORES.photos, STORES.settings], 'readwrite', (s) => {
    if (replace) {
      s.events.clear();
      s.inventory.clear();
      if (replacePhotos) s.photos.clear();
    }
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
  };
}

/**
 * Erase ALL data on this device (events, stash, photos, settings, legacy v1
 * stores, and Nurture's localStorage keys). Not undoable — put it behind a
 * confirm sheet — then reload the page.
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

/**
 * How much this device is storing, and whether the browser promised not to
 * evict it (Settings → Privacy).
 * @returns {Promise<{ usage: number|null, quota: number|null, persisted: boolean|null }>}
 */
export async function storageInfo() {
  const sm = typeof navigator !== 'undefined' ? navigator.storage : null;
  let usage = null; let quota = null; let persisted = null;
  try { if (sm && sm.estimate) ({ usage = null, quota = null } = await sm.estimate()); } catch { /* unsupported */ }
  try { if (sm && sm.persisted) persisted = await sm.persisted(); } catch { /* unsupported */ }
  return { usage, quota, persisted };
}

/**
 * Ask the browser to keep this data even under storage pressure (a local
 * permission; no network). Resolves whether it's persisted.
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  try {
    const sm = typeof navigator !== 'undefined' ? navigator.storage : null;
    if (sm && sm.persist) return await sm.persist();
  } catch { /* unsupported */ }
  return false;
}

/** The backup API as one object. */
export const backup = Object.freeze({
  exportBackup, exportBackupFile, exportCsvFile, buildCsv, validateBackup, mergeBackup, importBackup,
  shareBackup, shareCsv, shareFile, downloadFile, eraseAll, storageInfo, requestPersistence,
});
