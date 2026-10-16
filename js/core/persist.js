// Data-loss protection (ARCHITECTURE §10b).
//
// Local-only means WE must prevent loss: Safari deletes script-writable
// storage (IndexedDB) for sites not used in 7 days of browser use, and with
// no server there is nothing to restore from. Three defences live here:
//  - ask the browser to make our storage persistent (and remember the answer),
//  - report how much we store (Settings → Data),
//  - decide when the weekly "Save a backup to Files" nudge is due.
// Nothing here talks to a network: navigator.storage is a local API.

import { transaction, STORES } from './db.js';
import { get as getSetting, set as setSetting, load as loadSettings, all as allSettings } from './settings.js';

/** The nudge returns when the last backup is older than this. */
export const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** …and only once there's at least this much history worth losing. */
export const MIN_DATA_SPAN_MS = 24 * 60 * 60 * 1000;
// A lastBackupAt further in the future than this is a skewed clock, not a
// backup — treat it as missing so the nudge can't be silenced forever.
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

function storageManager() {
  return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
}

/**
 * Is the weekly backup nudge due? PURE.
 * Due when `lastBackupAt` is null (or older than 7 days, or implausibly in
 * the future) AND there is at least one day of data.
 * @param {{ lastBackupAt?: number|null }|null} settings the settings values (settings.all())
 * @param {boolean|number|null} hasData `true` = there's ≥ 1 day of data; or
 *   the epoch ms of the OLDEST record (due once it's ≥ 24h before `now`);
 *   false/null = nothing worth backing up yet
 * @param {number} [now]
 * @returns {boolean}
 */
export function backupDue(settings, hasData, now = Date.now()) {
  let enoughData;
  if (typeof hasData === 'number') enoughData = Number.isFinite(hasData) && now - hasData >= MIN_DATA_SPAN_MS;
  else enoughData = hasData === true;
  if (!enoughData) return false;
  const last = settings && typeof settings.lastBackupAt === 'number' && Number.isFinite(settings.lastBackupAt)
    ? settings.lastBackupAt : null;
  if (last === null || last > now + FUTURE_SKEW_MS) return true;
  return now - last >= BACKUP_INTERVAL_MS;
}

/**
 * Epoch ms of the oldest logged event (by startTime), or null when there are
 * none — feed it to backupDue() as `hasData`.
 * @returns {Promise<number|null>}
 */
export function dataSince() {
  return transaction(STORES.events, 'readonly', (s, ctx) => {
    ctx.done(null);
    const req = s.events.index('startTime').openCursor(null, 'next');
    req.onsuccess = () => {
      const cur = req.result;
      if (cur && Number.isFinite(cur.value.startTime)) ctx.done(cur.value.startTime);
    };
  });
}

/**
 * Convenience for Today's nudge card: backupDue() from the live settings and
 * events.
 * @param {number} [now]
 * @returns {Promise<boolean>}
 */
export async function isBackupDue(now = Date.now()) {
  await loadSettings();
  return backupDue(allSettings(), await dataSince(), now);
}

/**
 * Record a successful backup (core/backup.js calls this after a completed
 * share or download).
 * @param {number} [now]
 * @returns {Promise<number>} the stored timestamp
 */
export function markBackedUp(now = Date.now()) {
  return setSetting('lastBackupAt', now);
}

/**
 * Ask the browser to keep our storage even under pressure (call after
 * onboarding and on the first meaningful log). If it's already persistent
 * we don't ask again. The answer is stored as settings.persistGranted.
 * Resolves true/false, or null where the API doesn't exist (nothing stored).
 * @returns {Promise<boolean|null>}
 */
export async function requestPersistence() {
  const sm = storageManager();
  if (!sm || typeof sm.persist !== 'function') return null;
  let granted = false;
  try {
    granted = (typeof sm.persisted === 'function' && await sm.persisted()) || !!(await sm.persist());
  } catch {
    granted = false;
  }
  await loadSettings();
  if (getSetting('persistGranted') !== granted) await setSetting('persistGranted', granted);
  return granted;
}

/**
 * How much this device is storing and whether the browser promised not to
 * evict it (Settings → Data). Fields are null where unsupported.
 * @returns {Promise<{ usage: number|null, quota: number|null, persisted: boolean|null }>}
 */
export async function estimate() {
  const sm = storageManager();
  let usage = null;
  let quota = null;
  let persisted = null;
  try {
    if (sm && typeof sm.estimate === 'function') {
      const e = await sm.estimate();
      usage = Number.isFinite(e && e.usage) ? e.usage : null;
      quota = Number.isFinite(e && e.quota) ? e.quota : null;
    }
  } catch { /* unsupported */ }
  try { if (sm && typeof sm.persisted === 'function') persisted = !!(await sm.persisted()); } catch { /* unsupported */ }
  return { usage, quota, persisted };
}

/** The persist API as one object. */
export const persist = Object.freeze({ requestPersistence, estimate, backupDue, isBackupDue, dataSince, markBackedUp });
