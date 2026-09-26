// Bottle Tracker Module
// Handles two distinct biological safety clocks:
// 1. Thawed, not started: ~24 hours in fridge (NEVER REFREEZE)
// 2. Started: 1–2 hours once baby's lips touch the nipple
import { db, newId } from './db.js';
import { sound } from './audio.js';

export class BottleManager {
  constructor() {
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  notify() {
    this.listeners.forEach(fn => fn());
  }

  // Calculate live status and countdown for a bottle
  static getBottleStatus(bottle) {
    const now = Date.now();
    const remainingMs = bottle.expiresAt - now;

    if (remainingMs <= 0 || bottle.status === 'expired') {
      return {
        state: 'expired',
        label: 'Expired — Discard Leftovers',
        badgeClass: 'badge-expired',
        percent: 0,
        formattedRemaining: '0m'
      };
    }

    const totalDurationMs = (bottle.durationLimitMinutes || 120) * 60 * 1000;
    const progressPercent = Math.max(0, Math.min(100, Math.round((remainingMs / totalDurationMs) * 100)));

    const remainingMins = Math.floor(remainingMs / (1000 * 60));
    const hours = Math.floor(remainingMins / 60);
    const mins = remainingMins % 60;

    let timeStr = '';
    if (hours > 0) {
      timeStr = `${hours}h ${mins}m`;
    } else {
      timeStr = `${mins}m`;
    }

    // Color codes
    let badgeClass = 'badge-green';
    let state = bottle.status; // 'unstarted' or 'inProgress'

    if (bottle.status === 'inProgress') {
      // Started bottle: 2 hour clock
      if (remainingMins < 15) {
        badgeClass = 'badge-red';
      } else if (remainingMins < 45) {
        badgeClass = 'badge-yellow';
      }
    } else {
      // Unstarted thawed bottle: 24 hour clock
      if (remainingMins < 120) { // < 2 hours
        badgeClass = 'badge-red';
      } else if (remainingMins < 360) { // < 6 hours
        badgeClass = 'badge-yellow';
      }
    }

    return {
      state,
      label: bottle.status === 'inProgress' ? `Use within ${timeStr}` : `${timeStr} left (Unstarted)`,
      badgeClass,
      percent: progressPercent,
      formattedRemaining: timeStr,
      remainingMinutes: remainingMins
    };
  }

  async getActiveBottles() {
    return db.getBottles(false);
  }

  async createBottle({ name, quantity, unit, isThawed, storageWindows }) {
    const windows = storageWindows || { thawedBottleHours: 24, startedBottleHours: 2 };
    const thawedHours = windows.thawedBottleHours || 24;
    const now = Date.now();

    const bottle = {
      id: newId('bot'),
      name: name || (isThawed ? 'Thawed Breast Milk' : 'Prepared Bottle'),
      quantity: quantity || 3.0,
      unit: unit || 'oz',
      preparedAt: now,
      startedAt: null,
      durationLimitMinutes: thawedHours * 60,
      expiresAt: now + thawedHours * 60 * 60 * 1000,
      status: 'unstarted'
    };

    await db.addBottle(bottle);
    sound.playChime('tick');
    this.notify();
    return bottle;
  }

  // Baby took first sip: switch to 1–2 hour countdown
  async startFeedingFromBottle(bottleId, storageWindows) {
    const bottle = await db.get('bottles', bottleId);
    if (!bottle) return null;

    const windows = storageWindows || { startedBottleHours: 2 };
    const limitMinutes = (windows.startedBottleHours || 2) * 60;
    const now = Date.now();

    bottle.status = 'inProgress';
    bottle.startedAt = now;
    bottle.durationLimitMinutes = limitMinutes;
    bottle.expiresAt = now + limitMinutes * 60 * 1000;

    await db.put('bottles', bottle);
    sound.playChime('tick');
    sound.vibrate([60, 40, 60]);
    this.notify();
    return bottle;
  }

  async finishBottle(bottleId) {
    const bottle = await db.get('bottles', bottleId);
    if (bottle) {
      bottle.status = 'consumed';
      bottle.finishedAt = Date.now();
      await db.put('bottles', bottle);
      sound.playChime('complete');
      this.notify();
    }
  }

  async discardBottle(bottleId) {
    const bottle = await db.get('bottles', bottleId);
    if (bottle) {
      bottle.status = 'discarded';
      bottle.discardedAt = Date.now();
      await db.put('bottles', bottle);
      this.notify();
    }
  }
}

export const bottles = new BottleManager();
