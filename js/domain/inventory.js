// Milk-stash FIFO + CDC expiry engine (pure — no DB, no DOM, no clock
// reads except injectable `now` defaults).
//
// Moved here from js/inventory.js with its exports kept identical
// (THAWED_LOCATION, FROZEN_LOCATIONS, buildThawUpdate, summarizeStash,
// InventoryManager.calculateExpiration/getUrgency, shouldShowThawTile) so the
// v1 tests port 1:1. core/stash.js wraps this with IndexedDB + a change bus.

import { convertQty, normalizeUnit, roundForUnit, toFiniteNumber } from '../core/units.js';

/** Thawed stash lives in the fridge physically, so it gets its own location
 * value distinct from the frozen sources it came from. */
export const THAWED_LOCATION = 'thawed';
/** Locations whose pouches can be thawed. */
export const FROZEN_LOCATIONS = ['freezer', 'deepFreezer'];

/** Every location a pouch can be in. */
export const LOCATIONS = Object.freeze(['room', 'fridge', 'freezer', 'deepFreezer', THAWED_LOCATION]);
/** Locations a NEW pouch can be stored to (thawed only comes from thaw()). */
export const STORE_LOCATIONS = Object.freeze(['room', 'fridge', 'freezer', 'deepFreezer']);
/** Pouch lifecycle. */
export const STATUSES = Object.freeze(['active', 'used', 'discarded', 'expired']);

/** CDC storage guidance (v1 shape, ARCHITECTURE §6 storageWindows default). */
export const DEFAULT_STORAGE_WINDOWS = Object.freeze({
  roomTempHours: 4,
  fridgeDays: 4,
  freezerMonths: 6,
  deepFreezerMonths: 12,
  thawedBottleHours: 24,
  startedBottleHours: 2,
});

const HOUR_MS = 60 * 60 * 1000;

/**
 * Pure transition for thawing a frozen stash item (frozen → thawed).
 * Returns a NEW item object; never mutates the input. The thawed item keeps
 * its identity (id, quantity, pumpedAt) but lives at location 'thawed' with a
 * fresh thawed-milk expiry clock (default 24h per CDC, configurable via
 * storageWindows.thawedBottleHours). Returns null when the item isn't a
 * thawable frozen pouch.
 * @param {object} item
 * @param {object} [storageWindows]
 * @param {number} [nowTs]
 * @returns {object|null}
 */
export function buildThawUpdate(item, storageWindows = {}, nowTs = Date.now()) {
  if (!item || item.status !== 'active') return null;
  if (!FROZEN_LOCATIONS.includes(item.location)) return null;
  const thawedHours = (storageWindows && storageWindows.thawedBottleHours) || 24;
  return {
    ...item,
    location: THAWED_LOCATION,
    thawedAt: nowTs,
    expiresAt: nowTs + thawedHours * HOUR_MS,
  };
}

/**
 * Pure stash aggregation. `items` are raw inventory records (quantity may be
 * in item.unit). Thawed items are fridge-resident, so they count into
 * fridgeOz. Returns rounded oz totals. NaN quantities count as 0.
 * @param {object[]} [items]
 * @returns {{totalOz:number, fridgeOz:number, freezerOz:number, deepFreezerOz:number, totalBags:number}}
 */
export function summarizeStash(items = []) {
  let totalOz = 0;
  let fridgeOz = 0;
  let freezerOz = 0;
  let deepFreezerOz = 0;

  for (const item of items) {
    const oz = convertQty(item.quantity, item.unit, 'oz');
    totalOz += oz;
    if (item.location === 'fridge' || item.location === THAWED_LOCATION) fridgeOz += oz;
    else if (item.location === 'freezer') freezerOz += oz;
    else if (item.location === 'deepFreezer') deepFreezerOz += oz;
  }

  return {
    totalOz: Math.round(totalOz * 10) / 10,
    fridgeOz: Math.round(fridgeOz * 10) / 10,
    freezerOz: Math.round(freezerOz * 10) / 10,
    deepFreezerOz: Math.round(deepFreezerOz * 10) / 10,
    totalBags: items.length,
  };
}

/**
 * Expiry timestamp for a pouch pumped at `pumpedAt` and stored at `location`.
 * Month-based windows use calendar months (setMonth), as in v1. Unknown
 * locations return `pumpedAt` unchanged (i.e. treat as expired-on-arrival
 * rather than guessing a window).
 * @param {number} pumpedAt
 * @param {string} location
 * @param {object} [storageWindows]
 * @returns {number}
 */
export function calculateExpiration(pumpedAt, location, storageWindows) {
  const windows = storageWindows || DEFAULT_STORAGE_WINDOWS;
  const pumpDate = new Date(pumpedAt);
  let expiresAt = pumpDate.getTime();

  if (location === 'room') {
    expiresAt = pumpDate.getTime() + (windows.roomTempHours || 4) * HOUR_MS;
  } else if (location === 'fridge') {
    expiresAt = pumpDate.getTime() + (windows.fridgeDays || 4) * 24 * HOUR_MS;
  } else if (location === 'freezer') {
    const d = new Date(pumpDate);
    d.setMonth(d.getMonth() + (windows.freezerMonths || 6));
    expiresAt = d.getTime();
  } else if (location === 'deepFreezer') {
    const d = new Date(pumpDate);
    d.setMonth(d.getMonth() + (windows.deepFreezerMonths || 12));
    expiresAt = d.getTime();
  }
  return expiresAt;
}

/**
 * Freshness urgency badge:
 *   green  > 48h left · yellow 12–48h (use soon) · red < 12h (today) ·
 *   expired <= 0.
 * @param {number} expiresAt
 * @param {number} [now]
 * @returns {{level:'expired'|'red'|'yellow'|'green', label:string, badgeClass:string, hoursLeft?:number, percent?:number}}
 */
export function getUrgency(expiresAt, now = Date.now()) {
  const diffMs = expiresAt - now;

  if (!(diffMs > 0)) {
    return { level: 'expired', label: 'Expired', badgeClass: 'badge-expired', percent: 100 };
  }

  const diffHours = diffMs / HOUR_MS;
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 12) {
    const hrs = Math.max(1, Math.round(diffHours));
    return { level: 'red', label: `Expires in ${hrs}h (Today!)`, badgeClass: 'badge-red', hoursLeft: diffHours };
  }
  if (diffHours < 48) {
    return {
      level: 'yellow',
      label: diffDays >= 1 ? `Expires in ${diffDays}d (Use Soon)` : `Expires in ${Math.round(diffHours)}h`,
      badgeClass: 'badge-yellow',
      hoursLeft: diffHours,
    };
  }
  if (diffDays < 30) {
    return { level: 'green', label: `${diffDays} days left`, badgeClass: 'badge-green', hoursLeft: diffHours };
  }
  const months = Math.round(diffDays / 30);
  return { level: 'green', label: `${months} months left`, badgeClass: 'badge-green', hoursLeft: diffHours };
}

/**
 * v1-compatible namespace: the static helpers the v1 tests call as
 * InventoryManager.calculateExpiration / InventoryManager.getUrgency.
 */
export class InventoryManager {
  /** @see calculateExpiration */
  static calculateExpiration(pumpedAt, location, storageWindows) {
    return calculateExpiration(pumpedAt, location, storageWindows);
  }

  /** @see getUrgency */
  static getUrgency(expiresAt, now = Date.now()) {
    return getUrgency(expiresAt, now);
  }
}

// The Thaw-from-Stash tile only earns its place while there is something to
// act on: frozen pouches to thaw, OR thawed milk waiting to be fed. (Keying it
// on frozen stock alone made the tile — and the pouch you'd just thawed into
// it — vanish the moment you thawed your last frozen pouch.)
/**
 * @param {unknown} frozenCount
 * @param {unknown} [thawedCount]
 * @returns {boolean}
 */
export function shouldShowThawTile(frozenCount, thawedCount = 0) {
  const has = v => { const n = Number(v); return Number.isFinite(n) && n > 0; };
  return has(frozenCount) || has(thawedCount);
}

// --------------------------------------------------------------- v2 helpers

/**
 * Status as of `now`: an 'active' pouch past its expiry reads 'expired' even
 * before the stash sweep has persisted that, so a stale read can never offer
 * expired milk as a feed source (AUDIT F9).
 * @param {object} item
 * @param {number} [now]
 * @returns {'active'|'used'|'discarded'|'expired'}
 */
export function effectiveStatus(item, now = Date.now()) {
  if (!item) return 'expired';
  if (item.status === 'active' && Number.isFinite(item.expiresAt) && item.expiresAt <= now) return 'expired';
  return STATUSES.includes(item.status) ? item.status : 'active';
}

/**
 * Is this pouch active and unexpired right now?
 * @param {object} item
 * @param {number} [now]
 * @returns {boolean}
 */
export function isUsable(item, now = Date.now()) {
  return effectiveStatus(item, now) === 'active';
}

/**
 * FIFO order: oldest pumped first (ties: created first, then id, so the
 * order is stable across renders).
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function compareFifo(a, b) {
  return (a.pumpedAt - b.pumpedAt) || ((a.createdAt || 0) - (b.createdAt || 0)) || String(a.id).localeCompare(String(b.id));
}

/** Filter names accepted by filterInventory() / stash.list(). */
export const FILTERS = Object.freeze(['all', 'active', 'fridge', 'room', 'freezer', 'deepFreezer', 'frozen', 'thawed', 'archived', 'expired', 'everything']);

/**
 * Filter + sort pouches the way each Stash view needs them.
 *  - 'all' / 'active': usable pouches (FIFO)
 *  - 'fridge': usable fridge + thawed pouches · 'freezer' / 'deepFreezer' / 'room' / 'thawed'
 *  - 'frozen': usable freezer + deep-freezer pouches
 *  - 'archived': used, discarded or expired (newest first)
 *  - 'expired': expired only · 'everything': no filter (FIFO)
 * 'thawed' sorts by soonest expiry (that's the order you must use them in).
 * @param {object[]} items
 * @param {string} [filter]
 * @param {number} [now]
 * @returns {object[]}
 */
export function filterInventory(items, filter = 'all', now = Date.now()) {
  const list = (items || []).filter(Boolean);
  const usable = i => effectiveStatus(i, now) === 'active';
  let out;
  switch (filter) {
    case 'all':
    case 'active': out = list.filter(usable); break;
    case 'fridge': out = list.filter(i => usable(i) && (i.location === 'fridge' || i.location === THAWED_LOCATION)); break;
    case 'frozen': out = list.filter(i => usable(i) && FROZEN_LOCATIONS.includes(i.location)); break;
    case 'room':
    case 'freezer':
    case 'deepFreezer': out = list.filter(i => usable(i) && i.location === filter); break;
    case THAWED_LOCATION:
      return list.filter(i => usable(i) && i.location === THAWED_LOCATION)
        .sort((a, b) => (a.expiresAt - b.expiresAt) || compareFifo(a, b));
    case 'archived':
      return list.filter(i => effectiveStatus(i, now) !== 'active')
        .sort((a, b) => archivedAt(b) - archivedAt(a));
    case 'expired': out = list.filter(i => effectiveStatus(i, now) === 'expired'); break;
    case 'everything': out = list.slice(); break;
    default: throw new RangeError(`Unknown stash filter: ${filter}`);
  }
  return out.sort(compareFifo);
}

function archivedAt(i) {
  return i.usedAt || i.discardedAt || i.expiresAt || i.pumpedAt || 0;
}

/**
 * The "Use next" pouch: thawed milk first (soonest expiry — its 24h clock is
 * running), then fridge/room milk (soonest expiry), then frozen FIFO.
 * @param {object[]} items
 * @param {number} [now]
 * @returns {object|null}
 */
export function pickUseNext(items, now = Date.now()) {
  const usable = (items || []).filter(i => i && isUsable(i, now));
  const bySoonest = (a, b) => (a.expiresAt - b.expiresAt) || compareFifo(a, b);
  const thawed = usable.filter(i => i.location === THAWED_LOCATION).sort(bySoonest);
  if (thawed.length) return thawed[0];
  const fresh = usable.filter(i => i.location === 'fridge' || i.location === 'room').sort(bySoonest);
  if (fresh.length) return fresh[0];
  const frozen = usable.filter(i => FROZEN_LOCATIONS.includes(i.location)).sort(compareFifo);
  return frozen[0] || null;
}

/**
 * Build a NEW pouch record. Throws RangeError on a non-positive / non-finite
 * quantity or an unknown location, so a NaN pouch can't be stored.
 * @param {{pumpedAt?:number, quantity:unknown, unit?:string, location:string, notes?:string}} input
 * @param {object} [storageWindows]
 * @param {{ now?: number, id: string, deviceId?: string }} ctx
 * @returns {object}
 */
export function buildInventoryItem(input, storageWindows, { now = Date.now(), id, deviceId } = {}) {
  const quantity = toFiniteNumber(input && input.quantity);
  if (quantity === null || quantity <= 0) throw new RangeError('Pouch quantity must be a positive number');
  const location = input.location;
  if (!STORE_LOCATIONS.includes(location)) throw new RangeError(`Unknown stash location: ${location}`);
  const pumpedAt = toFiniteNumber(input.pumpedAt) ?? now;
  const unit = normalizeUnit(input.unit);
  const item = {
    id,
    pumpedAt,
    quantity: roundForUnit(quantity, unit),
    unit,
    location,
    expiresAt: calculateExpiration(pumpedAt, location, storageWindows),
    status: 'active',
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 2000) : '',
    createdAt: now,
    updatedAt: now,
  };
  if (deviceId) item.deviceId = deviceId;
  return item;
}

/**
 * Apply an edit to a pouch (quantity, unit, location, pumpedAt, notes,
 * expiresAt). Expiry is recomputed when pumpedAt/location change unless an
 * explicit expiresAt is given. Thawed milk can't be moved: refreezing thawed
 * milk is unsafe and moving it to "fridge" would silently restart a 4-day
 * clock on milk that has 24h.
 * @param {object} item
 * @param {object} patch
 * @param {object} [storageWindows]
 * @param {number} [now]
 * @returns {object}
 */
export function applyInventoryPatch(item, patch, storageWindows, now = Date.now()) {
  const next = { ...item };
  const p = patch || {};
  if ('quantity' in p) {
    const q = toFiniteNumber(p.quantity);
    if (q === null || q <= 0) throw new RangeError('Pouch quantity must be a positive number');
    next.quantity = q;
  }
  if ('unit' in p) next.unit = normalizeUnit(p.unit);
  if ('notes' in p) next.notes = typeof p.notes === 'string' ? p.notes.slice(0, 2000) : '';
  let reExpire = false;
  if ('pumpedAt' in p) {
    const t = toFiniteNumber(p.pumpedAt);
    if (t === null) throw new RangeError('pumpedAt must be a timestamp');
    next.pumpedAt = t;
    reExpire = true;
  }
  if ('location' in p && p.location !== item.location) {
    if (item.location === THAWED_LOCATION) throw new RangeError('Thawed milk cannot be moved or refrozen');
    if (!STORE_LOCATIONS.includes(p.location)) throw new RangeError(`Unknown stash location: ${p.location}`);
    next.location = p.location;
    reExpire = true;
  }
  if ('expiresAt' in p) {
    const t = toFiniteNumber(p.expiresAt);
    if (t === null) throw new RangeError('expiresAt must be a timestamp');
    next.expiresAt = t;
  } else if (reExpire && next.location !== THAWED_LOCATION) {
    next.expiresAt = calculateExpiration(next.pumpedAt, next.location, storageWindows);
  }
  next.quantity = roundForUnit(next.quantity, next.unit);
  next.updatedAt = now;
  return next;
}

/**
 * Consume `amount` (in `amountUnit`) from a pouch after a feed. Using all of
 * it (within 0.1 oz ≈ 3 mL) marks it used; a partial use leaves the remainder
 * in the pouch, rounded in the pouch's own unit. The tolerance absorbs
 * oz↔mL rounding: a "120 mL" pouch fed as "4 oz" (118.3 mL) must not leave a
 * 2 mL ghost pouch that someone has to discard by hand. Returns null when
 * nothing changes (unusable pouch, missing/zero amount).
 * @param {object} item
 * @param {unknown} amount
 * @param {unknown} amountUnit
 * @param {number} [now]
 * @returns {object|null}
 */
export function consumeUpdate(item, amount, amountUnit, now = Date.now()) {
  if (!item || !isUsable(item, now)) return null;
  const n = toFiniteNumber(amount);
  if (n === null || n <= 0) return null;
  const unit = normalizeUnit(item.unit);
  const used = convertQty(n, amountUnit, unit);
  const tolerance = convertQty(0.1, 'oz', unit);
  if (used >= item.quantity - tolerance) {
    return { ...item, status: 'used', usedAt: now, updatedAt: now };
  }
  return { ...item, quantity: roundForUnit(item.quantity - used, unit), updatedAt: now };
}

/**
 * Best "last changed" time for merge (v1 pouches have no updatedAt).
 * @param {object} item
 * @returns {number}
 */
export function inventoryUpdatedAt(item) {
  if (!item) return 0;
  if (Number.isFinite(item.updatedAt)) return item.updatedAt;
  return Math.max(0, ...[item.createdAt, item.thawedAt, item.usedAt, item.discardedAt, item.pumpedAt].filter(Number.isFinite));
}
