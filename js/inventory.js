// Fridge / Freezer Inventory with First-In First-Out (FIFO) Engine
import { db, newId } from './db.js';
import { sound } from './audio.js';

// Thawed stash lives in the fridge physically, so it gets its own location
// value distinct from the frozen sources it came from.
export const THAWED_LOCATION = 'thawed';
export const FROZEN_LOCATIONS = ['freezer', 'deepFreezer'];

/**
 * Pure transition for thawing a frozen stash item (frozen → thawed).
 * Returns a NEW item object; never mutates the input. The thawed item keeps
 * its identity (id, quantity, pumpedAt) but lives at location 'thawed' with a
 * fresh thawed-milk expiry clock (default 24h per CDC, configurable via
 * storageWindows.thawedBottleHours). Returns null when the item isn't a
 * thawable frozen pouch.
 */
export function buildThawUpdate(item, storageWindows = {}, nowTs = Date.now()) {
  if (!item || item.status !== 'active') return null;
  if (!FROZEN_LOCATIONS.includes(item.location)) return null;
  const thawedHours = (storageWindows && storageWindows.thawedBottleHours) || 24;
  return {
    ...item,
    location: THAWED_LOCATION,
    thawedAt: nowTs,
    expiresAt: nowTs + thawedHours * 60 * 60 * 1000,
  };
}

/**
 * Pure stash aggregation. `items` are raw inventory records (quantity may be
 * in item.unit). Thawed items are fridge-resident, so they count into
 * fridgeOz. Returns rounded oz totals.
 */
export function summarizeStash(items = []) {
  let totalOz = 0;
  let fridgeOz = 0;
  let freezerOz = 0;
  let deepFreezerOz = 0;

  for (const item of items) {
    const oz = item.unit === 'mL' ? (item.quantity / 29.5735) : item.quantity;
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
    totalBags: items.length
  };
}

export class InventoryManager {
  constructor() {
    this.currentFilter = 'all'; // 'all' | 'fridge' | 'freezer' | 'deepFreezer' | 'archived'
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  notify() {
    this.listeners.forEach(fn => fn());
  }

  // Calculate expiration date based on storage location and settings
  static calculateExpiration(pumpedAt, location, storageWindows) {
    const windows = storageWindows || {
      roomTempHours: 4,
      fridgeDays: 4,
      freezerMonths: 6,
      deepFreezerMonths: 12
    };

    const pumpDate = new Date(pumpedAt);
    let expiresAt = pumpDate.getTime();

    if (location === 'room') {
      expiresAt = pumpDate.getTime() + (windows.roomTempHours || 4) * 60 * 60 * 1000;
    } else if (location === 'fridge') {
      expiresAt = pumpDate.getTime() + (windows.fridgeDays || 4) * 24 * 60 * 60 * 1000;
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

  // Determine freshness urgency badge:
  // Green: > 48 hours left
  // Yellow: 12 - 48 hours left (use soon)
  // Red: < 12 hours left (today / urgent)
  // Expired: <= 0 (archive)
  static getUrgency(expiresAt) {
    const now = Date.now();
    const diffMs = expiresAt - now;

    if (diffMs <= 0) {
      return { level: 'expired', label: 'Expired', badgeClass: 'badge-expired', percent: 100 };
    }

    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 12) {
      const hrs = Math.max(1, Math.round(diffHours));
      return { 
        level: 'red', 
        label: `Expires in ${hrs}h (Today!)`, 
        badgeClass: 'badge-red',
        hoursLeft: diffHours 
      };
    } else if (diffHours < 48) {
      return { 
        level: 'yellow', 
        label: diffDays >= 1 ? `Expires in ${diffDays}d (Use Soon)` : `Expires in ${Math.round(diffHours)}h`, 
        badgeClass: 'badge-yellow',
        hoursLeft: diffHours 
      };
    } else if (diffDays < 30) {
      return { 
        level: 'green', 
        label: `${diffDays} days left`, 
        badgeClass: 'badge-green',
        hoursLeft: diffHours 
      };
    } else {
      const months = Math.round(diffDays / 30);
      return { 
        level: 'green', 
        label: `${months} months left`, 
        badgeClass: 'badge-green',
        hoursLeft: diffHours 
      };
    }
  }

  async getFilteredItems() {
    const includeArchived = this.currentFilter === 'archived';
    const all = await db.getInventory(includeArchived);

    if (this.currentFilter === 'archived') {
      return all.filter(i => i.status === 'used' || i.status === 'discarded' || i.status === 'expired');
    }

    if (this.currentFilter === 'all') {
      return all.filter(i => i.status === 'active');
    }

    if (this.currentFilter === 'fridge') {
      return all.filter(i => i.status === 'active' && (i.location === 'fridge' || i.location === THAWED_LOCATION));
    }

    return all.filter(i => i.status === 'active' && i.location === this.currentFilter);
  }

  async getStashSummary() {
    const items = await db.getInventory(false);
    return summarizeStash(items);
  }

  async addItem({ pumpedAt, quantity, unit, location, notes, storageWindows }) {
    const expiresAt = InventoryManager.calculateExpiration(pumpedAt, location, storageWindows);
    const item = {
      id: newId('inv'),
      pumpedAt,
      quantity,
      unit: unit || 'oz',
      location,
      expiresAt,
      status: 'active',
      notes: notes || '',
      createdAt: Date.now()
    };
    await db.addInventoryItem(item);
    sound.playChime('tick');
    this.notify();
    return item;
  }

  async markUsed(id) {
    const item = await db.get('inventory', id);
    if (item) {
      item.status = 'used';
      item.usedAt = Date.now();
      await db.put('inventory', item);
      sound.playChime('tick');
      this.notify();
    }
  }

  async markDiscarded(id) {
    const item = await db.get('inventory', id);
    if (item) {
      item.status = 'discarded';
      item.discardedAt = Date.now();
      await db.put('inventory', item);
      this.notify();
    }
  }

  // Frozen stash eligible for thawing (FIFO: oldest pumped first)
  async getFrozenItems() {
    const all = await db.getInventory(false);
    return all
      .filter(i => i.status === 'active' && FROZEN_LOCATIONS.includes(i.location))
      .sort((a, b) => a.pumpedAt - b.pumpedAt);
  }

  // Thawed stash ready to feed from (most urgent expiry first)
  async getThawedItems() {
    const all = await db.getInventory(false);
    return all
      .filter(i => i.status === 'active' && i.location === THAWED_LOCATION)
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }

  // Thaw a frozen pouch into the thawed stash: frozen → thawed.
  // The old bottle-tracker flow is gone; thawed milk now lives as inventory
  // at location 'thawed' and shows up as a bottle-ready source in the feed
  // flow, with the normal bottle safety timers (1h formula / 2h breast milk)
  // applying once feeding starts.
  async thawItem(inventoryId) {
    const item = await db.get('inventory', inventoryId);
    const settings = await db.getAllSettings();
    const thawed = buildThawUpdate(item, settings.storageWindows || {}, Date.now());
    if (!thawed) return null;
    await db.put('inventory', thawed);
    sound.playChime('complete');
    this.notify();
    return thawed;
  }
}

// The main-page Thaw-from-Stash tile only earns its place when there is
// actually frozen milk to thaw. Empty stash -> the section stays hidden
// (thawed pouches still surface via the feed-flow source chips and the
// urgents strip).
export function shouldShowThawTile(frozenCount) {
  const n = Number(frozenCount);
  return Number.isFinite(n) && n > 0;
}

export const inventory = new InventoryManager();
