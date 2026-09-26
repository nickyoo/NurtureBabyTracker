// Pumping Timer Module for Nurture
import { db, newId } from './db.js';
import { sound } from './audio.js';
import { InventoryManager } from './inventory.js';

// Renamed from the pre-release key; the legacy key is migrated once on load.
const TIMER_STORAGE_KEY = 'nurture_active_pump_timer';
const LEGACY_TIMER_STORAGE_KEY = 'savannah_active_pump_timer';

/**
 * Validate a pump-duration entry in whole minutes. Returns the rounded
 * positive minute count, or null when the value is not usable. Shared by
 * the quick-duration chips and the typed number field.
 */
export function normalizePumpDuration(v) {
  const n = Math.round(parseFloat(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Pure builder for a pump session record. Duration is given in minutes;
 * startTime is epoch ms. Shared by the live timer and manual entry.
 */
export function buildPumpSession({ quantity, durationMin, unit = 'oz', startTime = Date.now(), notes = '' }) {
  const durationSec = Math.max(1, Math.round(durationMin * 60));
  const endTime = startTime + durationSec * 1000;
  return {
    id: newId('pump'),
    type: 'pump',
    startTime,
    endTime,
    durationSec,
    outputQty: quantity,
    unit,
    notes: notes || '',
    createdAt: endTime
  };
}

class TimerEngine {
  constructor() {
    this.active = false;
    this.type = 'pump';
    this.startedAt = null;
    this.timerInterval = null;

    this.pumpSeconds = 0;
    this.pumpOutputOz = 3.5;
    this.pumpOutputMl = 100;
    this.storeDestination = 'fridge'; // 'fridge' | 'freezer' | 'deepFreezer' | 'none'

    this.callbacks = {
      onTick: null,
      onStateChange: null,
      onSaved: null
    };

    this.restoreActiveTimer();
  }

  setCallbacks(cbs) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  // Restore running timer state across app restarts or screen locks
  restoreActiveTimer() {
    try {
      let raw = localStorage.getItem(TIMER_STORAGE_KEY);
      if (!raw) {
        // One-time migration from the pre-release storage key
        raw = localStorage.getItem(LEGACY_TIMER_STORAGE_KEY);
        if (raw) {
          localStorage.setItem(TIMER_STORAGE_KEY, raw);
          localStorage.removeItem(LEGACY_TIMER_STORAGE_KEY);
        }
      }
      if (raw) {
        const state = JSON.parse(raw);
        if (state && state.active && state.startedAt) {
          this.active = true;
          this.startedAt = state.startedAt;
          this.pumpOutputOz = state.pumpOutputOz || 3.5;
          this.pumpOutputMl = state.pumpOutputMl || 100;
          this.storeDestination = state.storeDestination || 'fridge';

          this._recalcElapsedFromWallClock();
          this.startTicking();
        }
      }
    } catch (e) {
      console.error('Failed to restore active timer:', e);
    }
  }

  _persistState() {
    if (!this.active) {
      localStorage.removeItem(TIMER_STORAGE_KEY);
      localStorage.removeItem(LEGACY_TIMER_STORAGE_KEY);
      return;
    }
    const state = {
      active: this.active,
      type: 'pump',
      startedAt: this.startedAt,
      pumpOutputOz: this.pumpOutputOz,
      pumpOutputMl: this.pumpOutputMl,
      storeDestination: this.storeDestination
    };
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  }

  _recalcElapsedFromWallClock() {
    if (!this.active) return;
    const now = Date.now();
    this.pumpSeconds = Math.floor((now - this.startedAt) / 1000);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.startedAt = Date.now();
    this.pumpSeconds = 0;

    sound.playChime('tick');
    sound.vibrate([40]);
    this._persistState();
    this.startTicking();

    if (this.callbacks.onStateChange) this.callbacks.onStateChange();
  }

  startTicking() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this._recalcElapsedFromWallClock();
      if (this.callbacks.onTick) {
        this.callbacks.onTick(this.getDisplayData());
      }
    }, 1000);
  }

  getDisplayData() {
    return {
      active: this.active,
      type: 'pump',
      activeSeconds: this.pumpSeconds,
      formattedTotal: this.formatTime(this.pumpSeconds),
      pumpSeconds: this.pumpSeconds,
      formattedPump: this.formatTime(this.pumpSeconds),
      pumpOutputOz: this.pumpOutputOz,
      pumpOutputMl: this.pumpOutputMl,
      storeDestination: this.storeDestination
    };
  }

  formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      const remMins = mins % 60;
      return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  setPumpOutput(val, unit = 'oz') {
    const num = Math.max(0.1, parseFloat(val) || 0);
    if (unit === 'oz') {
      this.pumpOutputOz = Math.round(num * 100) / 100;
      this.pumpOutputMl = Math.round(this.pumpOutputOz * 29.5735);
    } else {
      this.pumpOutputMl = Math.round(num);
      this.pumpOutputOz = Math.round((this.pumpOutputMl / 29.5735) * 100) / 100;
    }
    this._persistState();
    if (this.callbacks.onTick) this.callbacks.onTick(this.getDisplayData());
  }

  adjustPumpOutput(delta, unit = 'oz') {
    if (unit === 'oz') {
      this.pumpOutputOz = Math.max(0.25, Math.round((this.pumpOutputOz + delta) * 100) / 100);
      this.pumpOutputMl = Math.round(this.pumpOutputOz * 29.5735);
    } else {
      this.pumpOutputMl = Math.max(10, Math.round(this.pumpOutputMl + delta));
      this.pumpOutputOz = Math.round((this.pumpOutputMl / 29.5735) * 4) / 4;
    }
    this._persistState();
    if (this.callbacks.onTick) this.callbacks.onTick(this.getDisplayData());
  }

  setStoreDestination(dest) {
    this.storeDestination = dest;
    this._persistState();
  }

  async stopAndSave(options = {}) {
    if (!this.active) return null;
    this._recalcElapsedFromWallClock();

    const sessionRecord = buildPumpSession({
      quantity: options.quantity !== undefined ? options.quantity : this.pumpOutputOz,
      durationMin: this.pumpSeconds / 60,
      unit: options.units || 'oz',
      startTime: this.startedAt,
      notes: options.notes || ''
    });

    // Auto add to inventory stash if requested
    const storeDest = options.storeDestination || this.storeDestination;
    if (storeDest && storeDest !== 'none' && sessionRecord.outputQty > 0) {
      await this._autoAddToInventory(sessionRecord, storeDest, options.storageWindows);
    }

    await db.addSession(sessionRecord);

    sound.playChime('complete');
    sound.vibrate([100, 50, 150]);

    this.active = false;
    this.startedAt = null;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this._persistState();

    if (this.callbacks.onSaved) this.callbacks.onSaved(sessionRecord);
    if (this.callbacks.onStateChange) this.callbacks.onStateChange();

    return sessionRecord;
  }

  /**
   * Log a pump session directly, without running the timer.
   * startTime is epoch ms; quantity is in the given unit.
   */
  async logManualPump({ quantity, durationMin, unit = 'oz', startTime = Date.now(), notes = '', storeDestination = null, storageWindows = null }) {
    const sessionRecord = buildPumpSession({ quantity, durationMin, unit, startTime, notes });

    const storeDest = storeDestination || this.storeDestination;
    if (storeDest && storeDest !== 'none' && quantity > 0) {
      await this._autoAddToInventory(sessionRecord, storeDest, storageWindows);
    }

    await db.addSession(sessionRecord);

    sound.playChime('complete');
    sound.vibrate([100, 50, 150]);

    if (this.callbacks.onSaved) this.callbacks.onSaved(sessionRecord);
    if (this.callbacks.onStateChange) this.callbacks.onStateChange();

    return sessionRecord;
  }

  cancel() {
    this.active = false;
    this.startedAt = null;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this._persistState();
    if (this.callbacks.onStateChange) this.callbacks.onStateChange();
  }

  async _autoAddToInventory(pumpSession, location, customWindows = null) {
    const windows = customWindows || {
      roomTempHours: 4,
      fridgeDays: 4,
      freezerMonths: 6,
      deepFreezerMonths: 12
    };

    // Single source of truth for expiry math lives in InventoryManager
    const expiresAt = InventoryManager.calculateExpiration(pumpSession.endTime, location, windows);

    const item = {
      id: newId('inv'),
      pumpedAt: pumpSession.endTime,
      quantity: pumpSession.outputQty,
      unit: pumpSession.unit || 'oz',
      location,
      expiresAt,
      status: 'active',
      notes: `Pumped session (${this.formatTime(pumpSession.durationSec)})`,
      createdAt: Date.now()
    };

    await db.addInventoryItem(item);
  }
}

export const timer = new TimerEngine();
