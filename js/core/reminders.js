// Pump schedule from events: a pure core (calculateSchedule) + a small
// subscription that re-evaluates on a timer and whenever events or settings
// change. Ported from v1 js/reminders.js, which read sessions and fired a
// chime from inside a status poll.
//
// The schedule only runs while the pump tracker is visible (Settings →
// Customize): a family that hid pumping should never be nagged about it.

import { duration, clock, MINUTE } from './time.js';
import { last, running, subscribe as subscribeEvents } from './store.js';
import { get as getSetting, load as loadSettings, subscribe as subscribeSettings } from './settings.js';
import { sound, vibrate } from './audio.js';

/** Minutes before due that count as "due soon". */
export const DUE_SOON_MINUTES = 15;

/**
 * Pure pump schedule.
 * status: 'none' (never pumped) · 'running' (pumping now) · 'upcoming' ·
 * 'due-soon' (≤15 min) · 'overdue'. Due = last pump's end (or start) +
 * interval.
 * @param {object|null} lastPumpEvent most recent pump event (running or finished)
 * @param {number} intervalMinutes
 * @param {number} [now]
 * @param {{ hour12?: boolean }} [opts]
 * @returns {{ status: 'none'|'running'|'upcoming'|'due-soon'|'overdue', hasSession: boolean, intervalMinutes: number, lastTime?: number, nextDueTime?: number, diffMins?: number, isOverdue: boolean, label: string }}
 */
export function calculateSchedule(lastPumpEvent, intervalMinutes, now = Date.now(), opts = {}) {
  const interval = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 180;
  if (!lastPumpEvent || !Number.isFinite(lastPumpEvent.startTime)) {
    return { status: 'none', hasSession: false, intervalMinutes: interval, isOverdue: false, label: 'No pumps logged yet' };
  }
  if (lastPumpEvent.endTime === null) {
    return {
      status: 'running', hasSession: true, intervalMinutes: interval, isOverdue: false,
      lastTime: lastPumpEvent.startTime, label: 'Pumping now',
    };
  }
  const lastTime = Number.isFinite(lastPumpEvent.endTime) ? lastPumpEvent.endTime : lastPumpEvent.startTime;
  const nextDueTime = lastTime + interval * MINUTE;
  // Floor toward "less time left" so the label never promises more time
  // than there is.
  const diffMins = Math.floor((nextDueTime - now) / MINUTE);
  const at = clock(nextDueTime, { hour12: opts.hour12, meridiem: true });
  let status;
  let label;
  if (now >= nextDueTime) {
    status = 'overdue';
    label = `Pump overdue by ${duration(Math.max(MINUTE, now - nextDueTime))}`;
  } else if (diffMins < DUE_SOON_MINUTES) {
    status = 'due-soon';
    label = `Pump due at ${at}`;
  } else {
    status = 'upcoming';
    label = `Next pump in ${duration(nextDueTime - now)} · ${at}`;
  }
  return { status, hasSession: true, intervalMinutes: interval, lastTime, nextDueTime, diffMins, isOverdue: status === 'overdue', label };
}

/**
 * Current schedule from the stores (async). status 'off' when the pump
 * tracker is hidden.
 * @param {number} [now]
 * @returns {Promise<ReturnType<typeof calculateSchedule> | { status: 'off', hasSession: false, isOverdue: false, label: string }>}
 */
export async function currentSchedule(now = Date.now()) {
  await loadSettings();
  const trackers = getSetting('trackers');
  if (trackers && trackers.pump === false) return { status: 'off', hasSession: false, isOverdue: false, label: '' };
  const [live] = await running('pump');
  const lastPump = live || await last('pump');
  return calculateSchedule(lastPump, getSetting('pumpIntervalMinutes'), now);
}

/**
 * Watch the schedule: fn(info) now, every `intervalMs`, and on any event or
 * settings change. Plays one gentle alert (respecting the sound setting) the
 * moment it turns overdue while the app is open, and shows a local
 * notification if the user already granted permission. Returns unsubscribe.
 * @param {(info: object) => void} fn
 * @param {{ intervalMs?: number, alert?: boolean }} [opts]
 * @returns {() => void}
 */
export function subscribe(fn, { intervalMs = 15000, alert = true } = {}) {
  let stopped = false;
  let wasOverdue = null;
  let pending = false;
  const tick = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      const info = await currentSchedule(Date.now());
      if (stopped) return;
      // wasOverdue starts null so opening the app while already overdue
      // doesn't chime at the user; only the transition does.
      if (alert && info.isOverdue && wasOverdue === false) {
        sound.playChime('alert');
        vibrate([150, 100, 150]);
        notify('Pump reminder', 'Your scheduled pump is due.');
      }
      wasOverdue = !!info.isOverdue;
      fn(info);
    } catch (err) {
      console.error('reminders tick failed', err);
    } finally {
      pending = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  const offEvents = subscribeEvents(change => {
    if (change.op === 'bulk' || (change.event && change.event.type === 'pump')) tick();
  });
  const offSettings = subscribeSettings(change => {
    if (['*', 'pumpIntervalMinutes', 'trackers'].includes(change.key)) tick();
  });
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    offEvents();
    offSettings();
  };
}

/**
 * Best-effort local notification (no push server — nothing leaves the
 * device). Only fires if permission was already granted.
 * @param {string} title
 * @param {string} body
 * @returns {Promise<boolean>}
 */
export async function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const opts = { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: 'pump-reminder' };
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } else {
      // eslint-disable-next-line no-new
      new Notification(title, opts);
    }
    return true;
  } catch (err) {
    console.warn('Local notification failed', err);
    return false;
  }
}

/**
 * Ask for notification permission (call from a user gesture).
 * @returns {Promise<{ supported: boolean, permission: string }>}
 */
export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return { supported: false, permission: 'unsupported' };
  try {
    return { supported: true, permission: await Notification.requestPermission() };
  } catch {
    return { supported: true, permission: Notification.permission };
  }
}
