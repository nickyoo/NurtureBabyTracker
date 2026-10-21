// Soft chimes (Web Audio, synthesized locally — no audio files, no network)
// + haptics. Ported from v1 js/audio.js.
//
// v1 chimed on every tap, day and night. For a baby-sleep app the default is
// now 'night-off' (silent 19:00–08:00, AUDIT §4); Settings can pick 'on' or
// 'off'. Haptics stay available because they're silent.

import { get as getSetting } from './settings.js';

/** Quiet hours for sound: 'night-off' is silent from 19:00… */
export const QUIET_START_HOUR = 19;
/** …until 08:00 (exclusive) local time. */
export const QUIET_END_HOUR = 8;

/**
 * Is `date` inside quiet hours (local time)?
 * @param {Date|number} [date]
 * @returns {boolean}
 */
export function isQuietHours(date = new Date()) {
  const h = new Date(date).getHours();
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/**
 * Should a chime play for this sound setting at this time? Pure.
 * Unknown modes behave like the default ('night-off').
 * @param {'on'|'off'|'night-off'|string} mode
 * @param {Date|number} [date]
 * @returns {boolean}
 */
export function isSoundAllowed(mode, date = new Date()) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return !isQuietHours(date);
}

const CHIMES = Object.freeze({
  complete: [523.25, 659.25, 783.99], // C5 E5 G5 — gentle major triad
  alert: [659.25, 587.33, 659.25],    // E5 D5 E5 — soft reminder
  tick: [880],
  milestone: [523.25, 659.25, 783.99, 1046.5],
});

class SoundManager {
  constructor() {
    this.ctx = null;
    this._unlocked = false;
  }

  _context() {
    if (!this.ctx) {
      const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Unlock audio on iOS Safari (must run inside a user gesture). */
  unlock() {
    if (this._unlocked) return;
    const ctx = this._context();
    if (!ctx) return;
    const node = ctx.createBufferSource();
    node.buffer = ctx.createBuffer(1, 1, 22050);
    node.connect(ctx.destination);
    node.start(0);
    this._unlocked = true;
  }

  /**
   * Play a chime if the sound setting allows it right now.
   * @param {'complete'|'alert'|'tick'|'milestone'} [type]
   * @returns {boolean} whether it played
   */
  playChime(type = 'complete') {
    if (!isSoundAllowed(getSetting('sound'), new Date())) return false;
    const ctx = this._context();
    if (!ctx) return false;
    const freqs = CHIMES[type] || CHIMES.complete;
    const gap = type === 'milestone' ? 0.12 : 0.14;
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const t = now + i * gap;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      // Soft attack, gentle decay — never startling.
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
    return true;
  }

  /** v1 name kept for ported call sites. */
  playMilestoneChime() {
    return this.playChime('milestone');
  }

  /**
   * Haptic tap (where supported; iOS Safari has no vibrate API).
   * @param {number|number[]} [pattern]
   * @returns {boolean}
   */
  vibrate(pattern = [40]) {
    return vibrate(pattern);
  }
}

/**
 * Haptic feedback helper; silently no-ops where unsupported.
 * @param {number|number[]} [pattern]
 * @returns {boolean} whether the browser accepted it
 */
export function vibrate(pattern = [40]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return navigator.vibrate(pattern);
  } catch { /* ignore */ }
  return false;
}

/** Shared instance. */
export const sound = new SoundManager();

/**
 * Unlock audio on the first tap anywhere (iOS needs a gesture). Called once
 * at import in the browser; exported so app.js can call it explicitly too.
 * @param {Document} [doc]
 */
export function installAudioUnlock(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.addEventListener !== 'function') return;
  for (const evt of ['pointerdown', 'touchstart', 'keydown']) {
    doc.addEventListener(evt, () => sound.unlock(), { once: true, passive: true, capture: true });
  }
}

installAudioUnlock();
