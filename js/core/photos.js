// Photo blobs: add (downscaled JPEG), get (cached object URL), delete, and
// the square PNG used as the iPhone home-screen icon (ARCHITECTURE §10).
//
// Photos never leave the device: they are decoded and re-encoded locally
// (which also strips EXIF/GPS metadata from camera photos), stored as Blobs
// in IndexedDB, and shown through blob: URLs (allowed by CSP img-src blob:).

import { transaction, getAll, get as dbGet, newId, STORES } from './db.js';
import { ID_RE } from './store.js';

/** Long-edge cap for stored photos (AUDIT §6.3). */
export const MAX_EDGE = 1600;
/** JPEG quality for stored photos. */
export const JPEG_QUALITY = 0.82;
/** Refuse absurd inputs before trying to decode them. */
export const MAX_INPUT_BYTES = 40 * 1024 * 1024;

/** Thrown when the browser can't decode the picked file (e.g. HEIC on Chrome). */
export class PhotoDecodeError extends Error {
  constructor(message = 'This photo format can’t be opened on this device') {
    super(message);
    this.name = 'PhotoDecodeError';
  }
}

/**
 * Size that fits within `max` on the long edge, keeping aspect ratio; never
 * upscales. Pure.
 * @param {number} width
 * @param {number} height
 * @param {number} [max]
 * @returns {{ width: number, height: number, scale: number }}
 */
export function fitWithin(width, height, max = MAX_EDGE) {
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/**
 * Source rect for a square crop. Default: centred, as large as possible.
 * `crop` (fractions of the image) lets a crop UI pick the square:
 * { x, y, size } where x/y are the square's top-left as a fraction of
 * width/height and size is a fraction of the SHORT edge. Pure.
 * @param {number} width
 * @param {number} height
 * @param {{x?: number, y?: number, size?: number}} [crop]
 * @returns {{ sx: number, sy: number, side: number }}
 */
export function squareCrop(width, height, crop) {
  const short = Math.min(width, height);
  const frac = crop && Number.isFinite(crop.size) ? Math.min(1, Math.max(0.05, crop.size)) : 1;
  const side = Math.max(1, Math.round(short * frac));
  const clamp = (v, max) => Math.min(Math.max(0, v), Math.max(0, max));
  const sx = crop && Number.isFinite(crop.x) ? clamp(Math.round(crop.x * width), width - side) : Math.round((width - side) / 2);
  const sy = crop && Number.isFinite(crop.y) ? clamp(Math.round(crop.y * height), height - side) : Math.round((height - side) / 2);
  return { sx, sy, side };
}

// ------------------------------------------------------------ canvas glue

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honour EXIF orientation so portrait phone photos aren't sideways.
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try { return await createImageBitmap(blob); } catch { /* fall through to <img> */ }
    }
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new PhotoDecodeError();
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new PhotoDecodeError();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceSize(src) {
  return { width: src.naturalWidth || src.width, height: src.naturalHeight || src.height };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext('2d');
    if (ctx) return { canvas: c, ctx };
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return { canvas: c, ctx: c.getContext('2d') };
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas encode failed'))), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ------------------------------------------------------------------- API

const urlCache = new Map(); // id → object URL
const listeners = new Set();

function emit(change) {
  for (const fn of [...listeners]) {
    try { fn(change); } catch (err) { console.error('photos listener failed', err); }
  }
}

/**
 * Subscribe: fn({ op: 'add'|'remove'|'bulk', id }). Returns unsubscribe.
 * @param {(change: {op: string, id?: string}) => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Core-internal: announce a bulk change (import / erase) and drop cached URLs.
 */
export function notifyPhotosBulk() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  emit({ op: 'bulk' });
}

/**
 * Downscale (≤1600px long edge) and store a picked photo as JPEG.
 * @param {Blob|File} file
 * @returns {Promise<{ id: string, width: number, height: number, createdAt: number, bytes: number }>}
 */
export async function add(file) {
  if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') throw new TypeError('photos.add needs a File or Blob');
  if (file.size === 0) throw new PhotoDecodeError('That photo is empty');
  if (file.size > MAX_INPUT_BYTES) throw new PhotoDecodeError('That photo is too large');
  const src = await decode(file);
  try {
    const { width: sw, height: sh } = sourceSize(src);
    const { width, height } = fitWithin(sw, sh, MAX_EDGE);
    const { canvas, ctx } = makeCanvas(width, height);
    // JPEG has no alpha: paint white first so transparent PNGs don't go black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    const record = { id: newId('pho'), blob, width, height, createdAt: Date.now(), type: 'image/jpeg', bytes: blob.size };
    await transaction(STORES.photos, 'readwrite', (s) => { s.photos.add(record); });
    emit({ op: 'add', id: record.id });
    return { id: record.id, width, height, createdAt: record.createdAt, bytes: blob.size };
  } finally {
    if (typeof src.close === 'function') src.close();
  }
}

/**
 * Object URL for a photo (cached per id; revoked on delete), or null.
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function get(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await dbGet(STORES.photos, id);
  if (!rec || !(rec.blob instanceof Blob)) return null;
  // Another caller may have raced us here; keep the first URL.
  if (urlCache.has(id)) return urlCache.get(id);
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

/**
 * The stored record ({ id, blob, width, height, createdAt, type }) or null.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getRecord(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return (await dbGet(STORES.photos, id)) || null;
}

/**
 * Delete a photo and revoke its cached URL. Resolves true if it existed.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function remove(id) {
  const existed = await transaction(STORES.photos, 'readwrite', (s, ctx) => {
    const g = s.photos.getKey(id);
    g.onsuccess = () => {
      if (g.result === undefined) { ctx.done(false); return; }
      s.photos.delete(id);
      ctx.done(true);
    };
  });
  const url = urlCache.get(id);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
  if (existed) emit({ op: 'remove', id });
  return existed;
}

/**
 * Square, centre-cropped PNG data URL of a stored photo — for
 * <link rel="apple-touch-icon"> (180) and the favicon (64). Persist it as
 * settings.iconDataUrl (§10).
 * @param {string} photoId
 * @param {number} [size]
 * @param {{ crop?: {x?: number, y?: number, size?: number} }} [opts]
 * @returns {Promise<string>}
 */
export async function makeIconDataUrl(photoId, size = 180, { crop } = {}) {
  const rec = await getRecord(photoId);
  if (!rec) throw new Error(`No photo ${photoId}`);
  const src = await decode(rec.blob);
  try {
    const { width, height } = sourceSize(src);
    const { sx, sy, side } = squareCrop(width, height, crop);
    const px = Math.max(16, Math.min(1024, Math.round(size) || 180));
    const { canvas, ctx } = makeCanvas(px, px);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, side, side, 0, 0, px, px);
    if (typeof canvas.toDataURL === 'function') return canvas.toDataURL('image/png');
    return blobToDataUrl(await canvasToBlob(canvas, 'image/png'));
  } finally {
    if (typeof src.close === 'function') src.close();
  }
}

/**
 * Storage used by photos, for Settings → Privacy/Storage.
 * @returns {Promise<{ count: number, bytes: number }>}
 */
export async function usage() {
  const all = await getAll(STORES.photos);
  return { count: all.length, bytes: all.reduce((n, r) => n + ((r.blob && r.blob.size) || 0), 0) };
}

// `photos.delete(id)` per ARCHITECTURE §2 — `delete` is fine as an export name.
export { remove as delete };

/** The photos API as one object, for ctx injection. `delete` is an alias of remove. */
export const photos = Object.freeze({ add, get, getRecord, remove, delete: remove, makeIconDataUrl, usage, subscribe });
