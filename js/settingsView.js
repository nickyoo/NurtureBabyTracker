// Settings tab controller — preferences form, storage-window rules, backup/reset.
// Takes the main App instance for shared settings state and the handful of
// cross-cutting renders (updateNamesUI, updateBottleFillLevel, renderInventory)
// a settings change needs to trigger.
import { db } from './db.js';
import { sound } from './audio.js';
import { reminders, ReminderManager } from './reminders.js';
import { ExportManager } from './export.js';

export class SettingsView {
  constructor(app) {
    this.app = app;
  }

  async initEvents() {
    const app = this.app;

    const parentNameInput = document.getElementById('settingParentNameInput');
    if (parentNameInput) {
      parentNameInput.value = app.settings.parentName || '';
      const saveParent = async () => {
        const val = parentNameInput.value.trim() || '';
        parentNameInput.value = val;
        app.settings.parentName = val;
        await db.setSetting('parentName', val);
        app.updateNamesUI();
        app.updateBottleFillLevel();
      };
      parentNameInput.addEventListener('change', saveParent);
      parentNameInput.addEventListener('blur', saveParent);
    }

    const babyNameInput = document.getElementById('settingBabyNameInput');
    if (babyNameInput) {
      babyNameInput.value = app.settings.babyName || '';
      const saveBaby = async () => {
        const val = babyNameInput.value.trim() || '';
        babyNameInput.value = val;
        app.settings.babyName = val;
        await db.setSetting('babyName', val);
        app.updateNamesUI();
      };
      babyNameInput.addEventListener('change', saveBaby);
      babyNameInput.addEventListener('blur', saveBaby);
    }

    const unitSelect = document.getElementById('settingUnitSelect');
    if (unitSelect) {
      unitSelect.value = app.settings.units;
      unitSelect.addEventListener('change', (e) => app.setUnit(e.target.value));
    }

    const themeSelect = document.getElementById('settingThemeSelect');
    if (themeSelect) {
      themeSelect.value = app.settings.themeMode || 'auto';
      themeSelect.addEventListener('change', async (e) => {
        await app.setThemeMode(e.target.value);
      });
    }

    const soundToggle = document.getElementById('soundToggle');
    if (soundToggle) {
      soundToggle.checked = app.settings.soundEnabled;
      soundToggle.addEventListener('change', async (e) => {
        app.settings.soundEnabled = e.target.checked;
        sound.setEnabled(e.target.checked);
        await db.setSetting('soundEnabled', e.target.checked);
        if (e.target.checked) sound.playChime('complete');
      });
    }

    const goalInput = document.getElementById('settingDailyGoalInput');
    if (goalInput) {
      goalInput.value = app.settings.dailyGoalOz;
      goalInput.addEventListener('change', async (e) => {
        const val = parseFloat(e.target.value) || 24.0;
        app.settings.dailyGoalOz = val;
        await db.setSetting('dailyGoalOz', val);
        app.updateBottleFillLevel();
      });
    }

    const intervalSelect = document.getElementById('settingIntervalSelect');
    if (intervalSelect) {
      intervalSelect.value = app.settings.pumpIntervalMinutes;
      intervalSelect.addEventListener('change', async (e) => {
        const val = parseInt(e.target.value, 10);
        app.settings.pumpIntervalMinutes = val;
        await db.setSetting('pumpIntervalMinutes', val);
        await reminders.updateStatus();
      });
    }

    const notifyBtn = document.getElementById('requestNotifyBtn');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', async () => {
        const res = await ReminderManager.requestNotificationPermission();
        if (res.permission === 'granted') {
          alert('Notifications enabled! We will ping you for due sessions when available.');
        } else if (res.permission === 'denied') {
          alert('Notifications were blocked. Please enable them in your browser/system settings if desired.');
        } else {
          alert('Notification permission status: ' + res.permission);
        }
      });
    }

    const testChimeBtn = document.getElementById('testChimeBtn');
    if (testChimeBtn) {
      testChimeBtn.addEventListener('click', () => {
        sound.playChime('complete');
      });
    }

    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        ExportManager.exportSessionsCsv();
      });
    }

    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        ExportManager.exportJsonBackup();
      });
    }

    const importFileInput = document.getElementById('importFileInput');
    if (importFileInput) {
      importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          try {
            await ExportManager.importJsonBackup(file);
            alert('Data restored successfully!');
            location.reload();
          } catch (err) {
            alert('Failed to restore backup: ' + err.message);
          }
        }
      });
    }

    const clearDataBtn = document.getElementById('clearAllDataBtn');
    if (clearDataBtn) {
      clearDataBtn.addEventListener('click', async () => {
        const pName = app.settings.parentName || 'you';
        if (confirm(`Are you sure you want to reset all saved info? This will wipe all test sessions, stash items, and bottle clocks so ${pName} can start completely fresh.`)) {
          await db.resetAllData();
          localStorage.removeItem('onboarding_completed');
          alert(`All data has been reset cleanly for ${pName}.`);
          location.reload();
        }
      });
    }

    const replayTourBtn = document.getElementById('replayTourBtn');
    if (replayTourBtn) {
      replayTourBtn.addEventListener('click', () => {
        app.onboarding.showModal();
      });
    }
  }

  renderForm() {
    const app = this.app;
    const pInput = document.getElementById('settingParentNameInput');
    const bInput = document.getElementById('settingBabyNameInput');
    if (pInput && document.activeElement !== pInput) pInput.value = app.settings.parentName || '';
    if (bInput && document.activeElement !== bInput) bInput.value = app.settings.babyName || '';

    const windows = app.settings.storageWindows || {};
    const winFridge = document.getElementById('settingWinFridge');
    const winFreezer = document.getElementById('settingWinFreezer');
    const winDeepFreezer = document.getElementById('settingWinDeepFreezer');
    const winThawed = document.getElementById('settingWinThawed');
    const winStarted = document.getElementById('settingWinStarted');
    const goalInput = document.getElementById('settingDailyGoalInput');

    if (goalInput) goalInput.value = app.settings.dailyGoalOz;
    if (winFridge) winFridge.value = windows.fridgeDays || 4;
    if (winFreezer) winFreezer.value = windows.freezerMonths || 6;
    if (winDeepFreezer) winDeepFreezer.value = windows.deepFreezerMonths || 12;
    if (winThawed) winThawed.value = windows.thawedBottleHours || 24;
    if (winStarted) winStarted.value = windows.startedBottleHours || 2;
  }

  async saveStorageWindows() {
    const windows = {
      roomTempHours: 4,
      fridgeDays: parseInt(document.getElementById('settingWinFridge').value, 10) || 4,
      freezerMonths: parseInt(document.getElementById('settingWinFreezer').value, 10) || 6,
      deepFreezerMonths: parseInt(document.getElementById('settingWinDeepFreezer').value, 10) || 12,
      thawedBottleHours: parseInt(document.getElementById('settingWinThawed').value, 10) || 24,
      startedBottleHours: parseInt(document.getElementById('settingWinStarted').value, 10) || 2
    };

    this.app.settings.storageWindows = windows;
    await db.setSetting('storageWindows', windows);
    sound.playChime('tick');
    alert('Storage expiration rules saved.');
    this.app.renderInventory();
  }
}
