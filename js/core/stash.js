// Milk stash (inventory) API + change bus. Wraps the pure FIFO / CDC expiry
// engine in domain/inventory.js with IndexedDB (ARCHITECTURE §4).
//
// Auto-expiry, done deliberately: v1's getInventory() re-put every expired
// pouch from inside the READ path, in separate transactions from the read —
// so a thaw landing in between could be overwritten by the stale "expired"
// copy. Here, sweepExpired() is its own readwrite transaction that re-reads
// each active pouch under a cursor and flips it only if it is STILL active and
// past expiry; every other mutation is also a single read-modify-write
// transaction. And reads compute effectiveStatus() themselves, so even a read
// that happens before a sweep never offers expired milk.

import { transaction, getAll, get as dbGet, newId, STORES } from './db.js';
import { get as getSetting, load as loadSettings, deviceId as getDeviceId, cleanText } from './settings.js';
import { ID_RE, FUTURE_SKEW_MS } from './store.js';
import {
  buildThawUpdate, summarizeStash, filterInventory, pickUseNext, buildInventoryItem,
  applyInventoryPatch, consumeUpdate, effectiveStatus, maxExpiresAt, LOCATIONS, STATUSES,
} from '../domain/inventory.js';
import { normalizeUnit, toFiniteNumber } from './units.js';

/** Thrown when a pouch id doesn't exist. */
export class StashNotFoundError extends Error {
  /** @param {string} id */
  constructor(id) {
    super(`No stash pouch with id ${id}`);
    this.name = 'StashNotFoundError';
    this.id = id;
  }
}

const listeners = new Set();

/**
 * Emit a change (core-internal; backup uses { op: 'bulk' }).
 * @param {{op: string, item?: object, prev?: object}} change
 */
export function notifyStash(change) {
  for (const fn of [...listeners]) {
    try { fn(change); } catch (err) { console.error('stash listener failed', err); }
  }
}

/**
 * Subscribe: fn({ op: 'add'|'update'|'remove'|'bulk', item, prev }).
 * @param {(change: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function windows() {
  await loadSettings();
  return getSetting('storageWindows');
}

// One read-modify-write on a single pouch, atomically. `fn(prev)` returns the
// next record, or null for "no change". Resolves { prev, next } (next null
// when unchanged).
function mutate(id, fn) {
  return transaction(STORES.inventory, 'readwrite', (s, ctx) => {
    const g = s.inventory.get(id);
    g.onsuccess = () => {
      const prev = g.result;
      if (!prev) { ctx.fail(new StashNotFoundError(id)); return; }
      let next;
      try { next = fn(prev); } catch (err) { ctx.fail(err); return; }
      if (next) s.inventory.put(next);
      ctx.done({ prev, next: next || null });
    };
  });
}

async function mutateAndEmit(id, fn) {
  const { prev, next } = await mutate(id, fn);
  if (!next) return prev;
  notifyStash({ op: 'update', item: next, prev });
  return next;
}

/**
 * Persist status 'expired' on every active pouch past its expiry, in ONE
 * transaction (see header). Emits an update per pouch flipped. Doesn't bump
 * updatedAt: expiry is derived from expiresAt, so it shouldn't win a merge
 * against a real edit from another device. `now` can only be earlier than
 * the real clock: persisting "expired" ahead of time would throw away milk
 * that is still good.
 * @param {number} [at]
 * @returns {Promise<object[]>} the pouches that just expired
 */
export async function sweepExpired(at = Date.now()) {
  const now = Math.min(Number.isFinite(at) ? at : Date.now(), Date.now());
  const changed = await transaction(STORES.inventory, 'readwrite', (s, ctx) => {
    const flipped = [];
    ctx.done(flipped);
    const req = s.inventory.index('status').openCursor(IDBKeyRange.only('active'));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const item = cur.value;
      if (item.status === 'active' && Number.isFinite(item.expiresAt) && item.expiresAt <= now) {
        const next = { ...item, status: 'expired' };
        cur.update(next);
        flipped.push({ prev: item, next });
      }
      cur.continue();
    };
  });
  for (const { prev, next } of changed) notifyStash({ op: 'update', item: next, prev });
  return changed.map(c => c.next);
}

// Reads persist expiry with the REAL clock only. A caller's `now` (a
// preview, a fast device clock) is used just to filter in memory —
// effectiveStatus() already hides anything expired as of that time.
async function readAll() {
  await sweepExpired(Date.now());
  return getAll(STORES.inventory);
}

/**
 * One pouch by id, or null.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function get(id) {
  return (await dbGet(STORES.inventory, id)) || null;
}

/**
 * Pouches for a filter (see domain/inventory.js FILTERS): 'all' (usable,
 * FIFO), 'fridge', 'freezer', 'deepFreezer', 'room', 'frozen', 'thawed',
 * 'archived', 'expired', 'everything'.
 * @param {{ filter?: string, now?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function list({ filter = 'all', now = Date.now() } = {}) {
  return filterInventory(await readAll(), filter, now);
}

/**
 * Totals of usable milk, in oz (convert for display with units.js).
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{totalOz:number, fridgeOz:number, freezerOz:number, deepFreezerOz:number, totalBags:number, everStored:boolean}>}
 */
export async function summary({ now = Date.now() } = {}) {
  const all = await readAll();
  // everStored lets the UI skip "Low stash" nags for families that never
  // stored milk (AUDIT F12).
  return { ...summarizeStash(filterInventory(all, 'all', now)), everStored: all.length > 0 };
}

/**
 * Frozen pouches eligible for thawing, oldest pumped first (FIFO).
 * @returns {Promise<object[]>}
 */
export function frozen() {
  return list({ filter: 'frozen' });
}

/**
 * Thawed pouches ready to feed from, soonest expiry first.
 * @returns {Promise<object[]>}
 */
export function thawed() {
  return list({ filter: 'thawed' });
}

/**
 * The pouch to use next (thawed → fridge/room → frozen FIFO), or null.
 * @param {{ now?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function useNext({ now = Date.now() } = {}) {
  return pickUseNext(await readAll(), now);
}

/**
 * Store a new pouch. Expiry comes from the location + Settings storage
 * windows. Throws RangeError on a non-positive quantity or bad location.
 * @param {{pumpedAt?: number, quantity: number, unit?: 'oz'|'mL', location: 'room'|'fridge'|'freezer'|'deepFreezer', notes?: string}} input
 * @returns {Promise<object>}
 */
export async function add(input) {
  const now = Date.now();
  const item = buildInventoryItem(input || {}, await windows(), { now, id: newId('inv'), deviceId: await getDeviceId() });
  await transaction(STORES.inventory, 'readwrite', (s) => { s.inventory.add(item); });
  notifyStash({ op: 'add', item });
  return item;
}

/**
 * Store a finished pump's milk as a pouch (pumpedAt = the pump's end).
 * Link it back with events.update(pump.id, { data: { inventoryId, storedTo } }).
 * @param {object} pumpEvent a finished `pump` event with an amount
 * @param {'room'|'fridge'|'freezer'|'deepFreezer'} location
 * @returns {Promise<object>}
 */
export function addFromPump(pumpEvent, location) {
  const d = (pumpEvent && pumpEvent.data) || {};
  return add({
    pumpedAt: pumpEvent.endTime ?? pumpEvent.startTime,
    quantity: d.amount,
    unit: d.unit,
    location,
    notes: '',
  });
}

/**
 * Edit a pouch (quantity, unit, location, pumpedAt, notes, expiresAt).
 * Thawed pouches can't be moved (refreezing is unsafe).
 * @param {string} id
 * @param {object} patch
 * @returns {Promise<object>}
 */
export async function update(id, patch) {
  const w = await windows();
  return mutateAndEmit(id, prev => applyInventoryPatch(prev, patch, w, Date.now()));
}

/**
 * Thaw a frozen pouch (frozen → thawed, fresh 24h clock by default). Returns
 * the thawed pouch, or null if it isn't an active frozen pouch (already
 * thawed, used, expired …).
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function thaw(id) {
  const w = await windows();
  const now = Date.now();
  const { prev, next } = await mutate(id, p => {
    if (effectiveStatus(p, now) !== 'active') return null;
    const t = buildThawUpdate(p, w, now);
    return t ? { ...t, updatedAt: now } : null;
  });
  if (!next) return null;
  notifyStash({ op: 'update', item: next, prev });
  return next;
}

/**
 * Mark a pouch used (active or expired → used). No-op if already archived.
 * @param {string} id
 * @returns {Promise<object>}
 */
export function markUsed(id) {
  const now = Date.now();
  return mutateAndEmit(id, p => (p.status === 'active' || p.status === 'expired'
    ? { ...p, status: 'used', usedAt: now, updatedAt: now } : null));
}

/**
 * Discard a pouch (active or expired → discarded).
 * @param {string} id
 * @returns {Promise<object>}
 */
export function discard(id) {
  const now = Date.now();
  return mutateAndEmit(id, p => (p.status === 'active' || p.status === 'expired'
    ? { ...p, status: 'discarded', discardedAt: now, updatedAt: now } : null));
}

/**
 * Take `amount` (in `unit`) out of a pouch after a feed: all of it → used;
 * part → the remainder stays. Returns the pouch (unchanged if nothing to do).
 * @param {string} id
 * @param {number} amount
 * @param {'oz'|'mL'} unit
 * @returns {Promise<object>}
 */
export function consume(id, amount, unit) {
  return mutateAndEmit(id, p => consumeUpdate(p, amount, unit, Date.now()));
}

/**
 * Consume the thawed source of a finished bottle feed exactly once: uses
 * data.prepared (what was poured) or data.amount, and records the feed id on
 * the pouch (`consumedBy`) so a double-tap or retry can't take milk twice.
 * Resolves null when the feed has no source.
 * @param {object} feedEvent
 * @returns {Promise<object|null>}
 */
export async function consumeForFeed(feedEvent) {
  const d = (feedEvent && feedEvent.data) || {};
  const id = d.sourceInventoryId;
  if (!id) return null;
  const amount = toFiniteNumber(d.prepared) ?? toFiniteNumber(d.amount);
  return mutateAndEmit(id, p => {
    const seen = Array.isArray(p.consumedBy) ? p.consumedBy : [];
    if (seen.includes(feedEvent.id)) return null;
    const next = consumeUpdate(p, amount, normalizeUnit(d.unit), Date.now());
    return next ? { ...next, consumedBy: [...seen, feedEvent.id].slice(-20) } : null;
  });
}

/**
 * Hard-delete a pouch (logged by mistake). Resolves the removed pouch for
 * Undo → restore(), or null.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function remove(id) {
  const removed = await transaction(STORES.inventory, 'readwrite', (s, ctx) => {
    const g = s.inventory.get(id);
    g.onsuccess = () => {
      if (!g.result) { ctx.done(null); return; }
      s.inventory.delete(id);
      ctx.done(g.result);
    };
  });
  if (removed) notifyStash({ op: 'remove', item: removed });
  return removed;
}

/**
 * Undo: put back a snapshot taken before thaw/markUsed/discard/update/remove
 * (`const before = await stash.get(id)`). Validated, so only a pouch-shaped
 * record can be written.
 * @param {object} snapshot
 * @returns {Promise<object>}
 */
export async function restore(snapshot) {
  const item = sanitizeInventoryItem(snapshot);
  if (!item) throw new RangeError('Not a stash pouch');
  const prev = await transaction(STORES.inventory, 'readwrite', (s, ctx) => {
    const g = s.inventory.get(item.id);
    g.onsuccess = () => { s.inventory.put(item); ctx.done(g.result || null); };
  });
  notifyStash(prev ? { op: 'update', item, prev } : { op: 'add', item, restored: true });
  return item;
}

const own = (o, k) => (o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/**
 * Validate + normalise a pouch record (pure; shared with backup import and
 * undo). Returns a NEW object with known keys only, or null if unusable.
 * Trust boundary (AUDIT §6.5): a pouch pumped or thawed more than
 * FUTURE_SKEW_MS after `now` is rejected; a createdAt that far ahead falls
 * back to pumpedAt and a usedAt/discardedAt/updatedAt is dropped (merge then
 * dates it by its own lifecycle stamps, so a far-future updatedAt can't win
 * every merge); and its expiresAt can never be later than the longest
 * storage window Settings allows (maxExpiresAt), so spoiled milk can't be
 * imported as usable.
 * @param {unknown} raw
 * @param {{ now?: number }} [opts]
 * @returns {object|null}
 */
export function sanitizeInventoryItem(raw, { now = Date.now() } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const latest = now + FUTURE_SKEW_MS;
  const time = k => {
    const n = toFiniteNumber(own(raw, k));
    return n !== null && n >= Date.UTC(2000, 0, 1) && n <= Date.UTC(2100, 0, 1) ? n : null;
  };
  const pastTime = k => {
    const t = time(k);
    return t !== null && t <= latest ? t : null;
  };
  const pumpedAt = time('pumpedAt');
  const thawedAt = time('thawedAt');
  const quantity = toFiniteNumber(own(raw, 'quantity'));
  const location = own(raw, 'location');
  if (pumpedAt === null || pumpedAt > latest || (thawedAt !== null && thawedAt > latest)) return null;
  if (quantity === null || quantity < 0 || quantity > 10000 || !LOCATIONS.includes(location)) return null;
  const status = STATUSES.includes(own(raw, 'status')) ? own(raw, 'status') : 'active';
  const item = {
    id,
    pumpedAt,
    quantity,
    unit: normalizeUnit(own(raw, 'unit')),
    location,
    expiresAt: Math.min(time('expiresAt') ?? pumpedAt, maxExpiresAt({ pumpedAt, location, thawedAt })),
    status,
    notes: cleanText(own(raw, 'notes'), 2000),
    createdAt: pastTime('createdAt') ?? pumpedAt,
  };
  if (thawedAt !== null) item.thawedAt = thawedAt;
  for (const k of ['usedAt', 'discardedAt', 'updatedAt']) {
    const t = pastTime(k);
    if (t !== null) item[k] = t;
  }
  const dev = own(raw, 'deviceId');
  if (typeof dev === 'string' && /^dev_[A-Za-z0-9_-]{6,80}$/.test(dev)) item.deviceId = dev;
  const consumed = own(raw, 'consumedBy');
  if (Array.isArray(consumed)) {
    const ids = consumed.filter(x => typeof x === 'string' && ID_RE.test(x)).slice(-20);
    if (ids.length) item.consumedBy = ids;
  }
  return item;
}

/** The stash API as one object, for ctx injection (ARCHITECTURE §4). */
export const stash = Object.freeze({
  add, addFromPump, update, thaw, markUsed, discard, consume, consumeForFeed, remove, restore,
  get, list, summary, frozen, thawed, useNext, sweepExpired, subscribe,
});
