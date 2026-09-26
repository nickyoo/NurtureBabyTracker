// Pump Schedule & Reminder Engine
import { db } from './db.js';
import { sound } from './audio.js';

export class ReminderManager {
  constructor() {
    this.intervalId = null;
    this.lastState = null;
    this.hasAlerted = false;
    this.callbacks = {
      onStatusUpdate: null,
      onStartPumpAction: null
    };
  }

  setCallbacks(cbs) {
    this.callbacks = { ...this.callbacks, ...cbs };
  }

  start() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.updateStatus();
    this.intervalId = setInterval(() => {
      this.updateStatus();
    }, 15000); // Check every 15s
  }

  async calculateSchedule() {
    const settings = await db.getAllSettings();
    const intervalMinutes = settings.pumpIntervalMinutes || 180; // default 3 hours
    const lastPump = await db.getLastPumpSession();

    if (!lastPump) {
      return {
        hasSession: false,
        intervalMinutes,
        status: 'none',
        message: 'No pump sessions logged yet. Tap to start your schedule!'
      };
    }

    const lastTime = lastPump.endTime || lastPump.startTime;
    const nextDueTime = lastTime + intervalMinutes * 60 * 1000;
    const now = Date.now();
    const diffMs = nextDueTime - now;
    const diffMins = Math.round(diffMs / (1000 * 60));

    const nextDueDate = new Date(nextDueTime);
    const timeStr = nextDueDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    let status = 'upcoming';
    let label = '';
    let isOverdue = false;

    if (diffMins < 0) {
      // Overdue
      isOverdue = true;
      status = 'overdue';
      const overdueMins = Math.abs(diffMins);
      const overdueHours = Math.floor(overdueMins / 60);
      const remMins = overdueMins % 60;
      const durationStr = overdueHours > 0 ? `${overdueHours}h ${remMins}m` : `${remMins}m`;
      label = `Pump overdue by ${durationStr}!`;
    } else if (diffMins <= 15) {
      // Due soon
      status = 'due-soon';
      label = `Pump due soon (${diffMins}m) — at ${timeStr}`;
    } else {
      // Normal countdown
      status = 'upcoming';
      const dueHours = Math.floor(diffMins / 60);
      const remMins = diffMins % 60;
      const durationStr = dueHours > 0 ? `${dueHours}h ${remMins}m` : `${remMins}m`;
      label = `Next pump in ${durationStr} (${timeStr})`;
    }

    return {
      hasSession: true,
      lastTime,
      nextDueTime,
      intervalMinutes,
      diffMins,
      isOverdue,
      status,
      timeStr,
      label
    };
  }

  async updateStatus() {
    const info = await this.calculateSchedule();

    // Trigger gentle alert chime if just became overdue while app is open
    if (info.isOverdue && !this.hasAlerted) {
      sound.playChime('alert');
      sound.vibrate([150, 100, 150]);
      this.hasAlerted = true;
      this.triggerLocalNotification('Pump Reminder', 'Your scheduled pumping session is now due!');
    } else if (!info.isOverdue) {
      this.hasAlerted = false;
    }

    this.lastState = info;
    if (this.callbacks.onStatusUpdate) {
      this.callbacks.onStatusUpdate(info);
    }
  }

  // Best-effort Web Notification API trigger
  async triggerLocalNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.ready;
          reg.showNotification(title, {
            body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            vibrate: [200, 100, 200],
            tag: 'pump-reminder'
          });
        } else {
          new Notification(title, {
            body,
            icon: './icons/icon-192.png'
          });
        }
      } catch (e) {
        console.warn('Local notification failed:', e);
      }
    }
  }

  static async requestNotificationPermission() {
    if (!('Notification' in window)) {
      return { supported: false, permission: 'unsupported' };
    }
    try {
      const permission = await Notification.requestPermission();
      return { supported: true, permission };
    } catch (e) {
      return { supported: true, permission: Notification.permission };
    }
  }
}

export const reminders = new ReminderManager();
