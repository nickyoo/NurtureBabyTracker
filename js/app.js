// Nurture — Master Application Orchestrator
import { db, newId } from './db.js';
import { sound } from './audio.js';
import { timer, normalizePumpDuration } from './timer.js';
import { inventory, InventoryManager, THAWED_LOCATION, FROZEN_LOCATIONS, shouldShowThawTile } from './inventory.js';
import { reminders } from './reminders.js';
import { TrendsManager } from './trends.js';
import { ExportManager } from './export.js';
import { OnboardingController } from './onboarding.js';

/**
 * Inline SVG replacements for decorative emoji in UI copy. Nick asked for a
 * clean, plain-English look ("vibe code feeling" out). The icon set under
 * icons/ is untouched; these only replace emoji characters in rendered text.
 */
const ICON_SVG_BOTTLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9.5" y="2.5" width="5" height="2.6" rx="1"/><path d="M10.5 5.1h3v2.3l2 2.8V21a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V10.2l2-2.8z"/></svg>';
const ICON_SVG_DROPLET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3.5 4.4 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2.5-6.6 6-11z"/></svg>';
const ICON_SVG_SNOWFLAKE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="21.5"/><line x1="3.9" y1="7.5" x2="20.1" y2="16.5"/><line x1="20.1" y1="7.5" x2="3.9" y2="16.5"/></svg>';
const ICON_SVG_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>';

/**
 * Pure merge for editing a logged session (pump or feed).
 * `edits` may contain: outputQty, startTime, notes, feedType ('formula'|'breastmilk'),
 * durationMin. Returns a new session object; never mutates the original.
 * Auto-generated feed notes ("Formula Bottle Feed" / "Breast Milk Bottle Feed")
 * follow a feedType change; user-written notes are left alone.
 */
export function applySessionEdits(original, edits = {}) {
  const updated = { ...original };

  if (edits.outputQty !== undefined) {
    updated.outputQty = Math.round(edits.outputQty * 10) / 10;
  }
  if (edits.startTime !== undefined) {
    updated.startTime = edits.startTime;
  }
  if (edits.notes !== undefined) {
    updated.notes = edits.notes;
  }
  if (updated.type === 'feed' && edits.feedType !== undefined) {
    const autoNotes = {
      formula: 'Formula Bottle Feed',
      breastmilk: 'Breast Milk Bottle Feed',
    };
    const wasAuto = Object.values(autoNotes).includes(original.notes);
    updated.feedType = edits.feedType;
    if (wasAuto) {
      updated.notes = autoNotes[edits.feedType] || original.notes;
    }
  }
  if (updated.type === 'pump' && edits.durationMin !== undefined) {
    const durationSec = Math.max(0, Math.round(edits.durationMin * 60));
    updated.durationSec = durationSec;
    updated.endTime = updated.startTime + durationSec * 1000;
  }
  updated.updatedAt = Date.now();
  return updated;
}

// ---------------------------------------------------------------------------
// FEED-FLOW PURE HELPERS (exported for unit tests — no DOM, no side effects)
// ---------------------------------------------------------------------------

/**
 * Prefill for the merged feed flow when the user picks a thawed stash item
 * as the bottle-ready source. Thawed stash is always breast milk; amounts
 * stay canonical oz inside the flow.
 */
export function buildFeedFlowPrefill(item) {
  if (!item || item.status !== 'active' || item.location !== THAWED_LOCATION) return null;
  const oz = item.unit === 'mL' ? item.quantity / 29.5735 : item.quantity;
  return {
    type: 'breastmilk',
    amountOz: Math.round(oz * 10) / 10,
    sourceInventoryId: item.id,
  };
}

// Resolve the live feed-timer start from the feed flow's draft state.
// The live timer is a first-class path in the feed flow: starting a feed
// starts the CDC safety countdown (1h formula / 2h breast milk) that answers
// "is this bottle still good." Defaults keep the timer usable even when the
// draft type/amount was never picked.
export function resolveFeedTimerStart(flow) {
  const f = flow || {};
  const type = f.type === 'breastmilk' ? 'breastmilk' : 'formula';
  const amountOz = typeof f.amountOz === 'number' && f.amountOz > 0 ? f.amountOz : 4.0;
  return {
    type,
    amountOz,
    sourceInventoryId: f.sourceInventoryId || null,
  };
}

// CDC safety window for a started bottle, in seconds. Formula is only good
// for 1 hour once feeding begins; breast milk for 2 hours.
export function safetyWindowSec(feedType) {
  return feedType === 'formula' ? 3600 : 7200;
}

// Feeding pace in oz per minute, rounded to 2 decimals. 0 when unmeasurable.
export function paceOzPerMin(eatenOz, durationSec) {
  if (!durationSec || durationSec <= 0 || !eatenOz || eatenOz <= 0) return 0;
  return Math.round((eatenOz / (durationSec / 60)) * 100) / 100;
}

// Wall-clock formatter: 65 -> "01:05", 3665 -> "1:01:05".
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const secs = s % 60;
  const mins = Math.floor(s / 60);
  const hrs = Math.floor(mins / 60);
  const mm = String(mins % 60).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Human safety-countdown label: 4500 -> "1h 15m", 900 -> "15m", <=0 -> "expired".
export function fmtSafetyWindow(remainingSec) {
  if (remainingSec <= 0) return 'expired';
  const mins = Math.ceil(remainingSec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Clamp + snap to step, without float dust (4.0 not 4.0000000004).
export function clampAmount(v, min, max, step) {
  const num = parseFloat(v);
  const safe = Number.isNaN(num) ? min : num;
  const clamped = Math.min(max, Math.max(min, safe));
  const stepped = Math.round(clamped / step) * step;
  const decimals = step >= 1 ? 0 : 1;
  const factor = 10 ** decimals;
  return Math.round(stepped * factor) / factor;
}

// Express gesture: first vertical move locks the side (ny in 0..1, top = 0).
export function resolveLockedType(ny) {
  return ny < 0.5 ? 'formula' : 'breastmilk';
}

// Sticky type lock: flipping requires pushing clearly past center
// (62% / 38% hysteresis) so mid-gesture drift can't accidentally flip.
export function shouldFlipType(current, ny) {
  if (current === 'formula') return ny > 0.62;
  return ny < 0.38;
}

// Preset chips per unit system.
export function feedPresets(unit) {
  return unit === 'mL' ? [60, 120, 180, 240] : [2, 4, 6, 8];
}

// Pure bottle-timer state: elapsed + safety countdown from wall clock, so the
// live feed survives backgrounding — the UI just re-renders from timestamps.
export function getBottleTimerStatus(startTs, feedType, nowTs) {
  const elapsedSec = Math.max(0, Math.floor((nowTs - startTs) / 1000));
  const windowSec = safetyWindowSec(feedType);
  const safetyRemainingSec = windowSec - elapsedSec;
  return {
    elapsedSec,
    windowSec,
    safetyRemainingSec,
    expired: safetyRemainingSec <= 0
  };
}

export class App {
  constructor() {
    this.currentTab = 'pump';
    this.pumpsAccordionOpen = true;
    this.showOlderHistory = false;
    this.activityFilter = 'all'; // 'all' | 'pumps' | 'feeds'
    this.settings = {
      parentName: '',
      babyName: '',
      units: 'oz',
      themeMode: 'auto', // 'auto' | 'light' | 'dark'
      dailyGoalOz: 24.0,
      pumpIntervalMinutes: 180,
      soundEnabled: true,
      storageWindows: {
        roomTempHours: 4,
        fridgeDays: 4,
        freezerMonths: 6,
        deepFreezerMonths: 12,
        thawedBottleHours: 24,
        startedBottleHours: 2
      }
    };
    this.onboarding = new OnboardingController(this);
  }

  async init() {
    // 1. Load settings & initialize defaults
    await this.loadSettings();

    // 2. Clock-based Theme Engine (8am Light, 7pm Dark)
    this.initThemeEngine();

    // 3. Service Worker
    this.registerServiceWorker();

    // 4. Bind Navigation & Global Events
    this.bindNavigation();
    this.bindGlobalModals();
    this.bindGlobalActions();

    // 5. Initialize Core Subsystems
    await this.initTimerUI();
    await this.initReminders();
    await this.renderTodayDashboard();
    await this.renderInventory();
    await this.initSettingsUI();

    // 6. Quick Food Tracker Subsystem & Activity Filters
    this.initFeedFlow();
    this.initBottleTimer();
    this.initActivityFilter();

    // 7. Onboarding & First Launch check
    this.onboarding.initEvents();
    await this.checkFirstLaunch();

    // 8. Live refresh loops for countdowns and theme clock checks
    setInterval(() => {
      this.checkClockTheme();
      if (this.currentTab === 'pump') this.updateBottleFillLevel();
      if (this.currentTab === 'inventory') this.renderInventory();
    }, 20000);
  }

  // --- CLOCK-BASED THEME ENGINE ---
  initThemeEngine() {
    this.checkClockTheme();
  }

  checkClockTheme() {
    const mode = this.settings.themeMode || 'auto';
    const now = new Date();
    const hour = now.getHours();

    let isDark = false;
    let label = 'Day';

    if (mode === 'dark') {
      isDark = true;
      label = 'Night';
    } else if (mode === 'light') {
      isDark = false;
      label = 'Light';
    } else {
      // Auto Clock: Past 7pm (19:00) until 8am is Dark; Past 8am (08:00) until 7pm is Light
      if (hour >= 19 || hour < 8) {
        isDark = true;
        label = 'Night (7pm)';
      } else {
        isDark = false;
        label = 'Day (8am)';
      }
    }

    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', '#0b0f17');
    } else {
      document.documentElement.removeAttribute('data-theme');
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) metaTheme.setAttribute('content', '#fff7f9');
    }

    const chipLabel = document.getElementById('themeClockLabel');
    const chipIcon = document.getElementById('themeClockIcon');
    if (chipLabel) chipLabel.textContent = label;
    if (chipIcon) {
      chipIcon.innerHTML = isDark
        ? `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`
        : `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
    }
  }

  async setThemeMode(mode) {
    this.settings.themeMode = mode;
    await db.setSetting('themeMode', mode);
    this.checkClockTheme();
  }

  // --- SETTINGS MANAGEMENT ---
  async loadSettings() {
    const saved = await db.getAllSettings();
    if (saved.parentName) this.settings.parentName = saved.parentName;
    if (saved.babyName) this.settings.babyName = saved.babyName;
    if (saved.units) this.settings.units = saved.units;
    if (saved.themeMode) this.settings.themeMode = saved.themeMode;
    if (saved.dailyGoalOz !== undefined) this.settings.dailyGoalOz = saved.dailyGoalOz;
    if (saved.pumpIntervalMinutes) this.settings.pumpIntervalMinutes = saved.pumpIntervalMinutes;
    if (saved.soundEnabled !== undefined) this.settings.soundEnabled = saved.soundEnabled;
    if (saved.storageWindows) this.settings.storageWindows = saved.storageWindows;

    sound.setEnabled(this.settings.soundEnabled);
    this.updateUnitLabels();
    this.updateNamesUI();
  }

  formatPossessive(name) {
    if (!name) return '';
    const trimmed = String(name).trim();
    if (!trimmed) return '';
    if (trimmed.endsWith('s') || trimmed.endsWith('S')) {
      return `${trimmed}'`;
    }
    return `${trimmed}'s`;
  }

  updateNamesUI() {
    const parent = (this.settings.parentName || '').trim();
    // Treat the legacy 'Baby' placeholder as unset
    const rawBaby = (this.settings.babyName || '').trim();
    const baby = rawBaby.toLowerCase() === 'baby' ? '' : rawBaby;
    const parentPossessive = parent ? this.formatPossessive(parent) : 'Nurture';
    const babyPossessive = baby ? this.formatPossessive(baby) : '';

    // Brand header
    const brandNameEl = document.getElementById('appBrandName');
    if (brandNameEl) {
      brandNameEl.innerHTML = `${parentPossessive}<span>.</span>`;
    }

    const brandSubtitleEl = document.getElementById('appBrandSubtitleText');
    if (brandSubtitleEl) {
      brandSubtitleEl.textContent = babyPossessive ? `${babyPossessive} Tracker` : 'Baby Tracker';
    }

    // Document title
    document.title = parent ? `${parentPossessive} Baby Tracker` : 'Nurture — Baby Tracker';

    // Settings title
    const settingsTitle = document.getElementById('settingsPreferencesTitle');
    if (settingsTitle) {
      settingsTitle.textContent = parent ? `${parentPossessive} Preferences` : 'My Preferences';
    }

    // Settings inputs
    const pInput = document.getElementById('settingParentNameInput');
    if (pInput && document.activeElement !== pInput) {
      pInput.value = parent;
    }
    const bInput = document.getElementById('settingBabyNameInput');
    if (bInput && document.activeElement !== bInput) {
      bInput.value = baby;
    }
  }

  async setUnit(unit) {
    this.settings.units = unit;
    await db.setSetting('units', unit);
    this.updateUnitLabels();
    this.renderTodayDashboard();
    this.renderInventory();
    this.updateTimerDisplay(timer.getDisplayData());
  }

  async adjustDailyGoal(deltaOz) {
    const isMl = this.settings.units === 'mL';
    let newGoal = this.settings.dailyGoalOz + (isMl ? (deltaOz * 30 / 29.5735) : deltaOz);
    newGoal = Math.max(4, Math.round(newGoal * 2) / 2);
    this.settings.dailyGoalOz = newGoal;
    await db.setSetting('dailyGoalOz', newGoal);
    sound.playChime('tick');
    this.updateBottleFillLevel();
  }

  updateUnitLabels() {
    const unit = this.settings.units;
    document.querySelectorAll('.unit-label-current').forEach(el => {
      el.textContent = unit;
    });
    const toggleBtn = document.getElementById('unitToggleBtn');
    if (toggleBtn) {
      toggleBtn.textContent = unit === 'oz' ? 'oz' : 'mL';
    }
  }

  // --- SERVICE WORKER REGISTRATION ---
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
          console.log('Nurture Service Worker registered:', reg.scope);
        }).catch((err) => {
          console.warn('Service Worker registration failed:', err);
        });
      });
    }
  }

  // --- NAVIGATION (4 TABS) ---
  bindNavigation() {
    const navButtons = document.querySelectorAll('.nav-item');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.switchTab(tab);
      });
    });

    const unitToggle = document.getElementById('unitToggleBtn');
    if (unitToggle) {
      unitToggle.addEventListener('click', () => {
        const newUnit = this.settings.units === 'oz' ? 'mL' : 'oz';
        this.setUnit(newUnit);
      });
    }

    const themeChip = document.getElementById('themeClockChip');
    if (themeChip) {
      themeChip.addEventListener('click', () => {
        const nextMode = this.settings.themeMode === 'auto' ? 'light' : (this.settings.themeMode === 'light' ? 'dark' : 'auto');
        this.setThemeMode(nextMode);
        const sel = document.getElementById('settingThemeSelect');
        if (sel) sel.value = nextMode;
      });
    }
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    const quickFeedBtn = document.getElementById('navQuickFeedBtn');
    if (quickFeedBtn) quickFeedBtn.classList.toggle('active', tabName === 'feed');

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });

    if (tabName === 'pump' || tabName === 'feed') this.renderTodayDashboard();
    if (tabName === 'inventory') this.renderInventory();
    if (tabName === 'settings') this.renderSettingsForm();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- GLOBAL DELEGATED ACTION DISPATCH ---
  // Every dynamically-rendered row (session entries, inventory tiles, thaw
  // rows, thawed-source chips) and a handful of static buttons carry a
  // data-action (+ data-id / data-delta / data-tab as needed) instead of an
  // inline onclick="" string. One listener here replaces what used to be
  // ~18 separate onclick="window.nurtureApp...." attributes.
  bindGlobalActions() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const id = el.dataset.id;
      switch (el.dataset.action) {
        case 'edit-session': this.openEditSession(id); break;
        case 'delete-session': this.deleteSession(id); break;
        case 'toggle-older-history': this.toggleOlderHistory(); break;
        case 'toggle-pumps-accordion': this.togglePumpsAccordion(); break;
        case 'thaw-item': this.thawItem(id); break;
        case 'mark-used': this.markUsedItem(id); break;
        case 'discard-item': this.discardItem(id); break;
        case 'open-feed-flow': this.openFeedFlow(); break;
        case 'open-manual-pump': this.openManualPump(); break;
        case 'pick-thawed-source': this.pickThawedSource(id); break;
        case 'switch-tab': this.switchTab(el.dataset.tab); break;
        case 'adjust-goal': this.adjustDailyGoal(parseFloat(el.dataset.delta)); break;
        case 'save-storage-windows': this.saveStorageWindowSettings(); break;
        default: break;
      }
    });
  }

  // --- ONBOARDING & FIRST LAUNCH CHECK ---
  async checkFirstLaunch() {
    // Check if reset was explicitly requested via URL (e.g. ?reset=true)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('reset') === 'true') {
      await db.resetAllData();
      localStorage.removeItem('onboarding_completed');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const completedSetting = await db.getSetting('onboarding_completed', false);
    const completedLocal = localStorage.getItem('onboarding_completed') === 'true';
    if (!completedSetting && !completedLocal) {
      this.onboarding.showModal();
    }
  }

  // --- ONBOARDING FLOW LOGIC (js/onboarding.js — this.onboarding) ---

  // --- TOP REMINDER BANNER ---
  async initReminders() {
    const banner = document.getElementById('reminderBanner');
    const labelEl = document.getElementById('reminderLabel');
    const actionBtn = document.getElementById('reminderActionBtn');

    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        this.switchTab('pump');
        if (!timer.active) {
          timer.start();
        }
      });
    }

    reminders.setCallbacks({
      onStatusUpdate: (info) => {
        if (!banner || !labelEl) return;
        banner.className = 'reminder-banner';
        if (info.isOverdue) {
          banner.classList.add('state-overdue');
          labelEl.textContent = info.label;
          if (actionBtn) {
            actionBtn.textContent = 'Pump Now';
            actionBtn.style.display = 'block';
          }
        } else if (info.status === 'due-soon') {
          banner.classList.add('state-due-soon');
          labelEl.textContent = info.label;
          if (actionBtn) {
            actionBtn.textContent = 'Start';
            actionBtn.style.display = 'block';
          }
        } else if (info.hasSession) {
          banner.classList.add('state-upcoming');
          labelEl.textContent = info.label;
          if (actionBtn) {
            actionBtn.textContent = 'Pump';
            actionBtn.style.display = 'block';
          }
        } else {
          labelEl.textContent = info.message;
          if (actionBtn) {
            actionBtn.textContent = 'Start First';
            actionBtn.style.display = 'block';
          }
        }
        // Mirror the pump schedule into the Today goal tile + urgent strip
        const nextPumpEl = document.getElementById('nextPumpLabel');
        if (nextPumpEl) {
          nextPumpEl.textContent = info.hasSession ? info.label : info.message;
          nextPumpEl.className = 'goal-next-pump status-' + (info.hasSession ? info.status : 'none');
        }
        this.renderTodayUrgent();
      }
    });

    reminders.start();
  }

  // --- TIMER SUBSYSTEM ---
  async initTimerUI() {
    const mainTimerBtn = document.getElementById('mainTimerBtn');
    if (mainTimerBtn) {
      mainTimerBtn.addEventListener('click', async () => {
        if (!timer.active) {
          timer.start();
        } else {
          await timer.stopAndSave({
            units: this.settings.units,
            storageWindows: this.settings.storageWindows
          });
          await this.renderTodayDashboard();
          await this.renderInventory();
          await reminders.updateStatus();
        }
      });
    }

    const cancelTimerBtn = document.getElementById('cancelTimerBtn');
    if (cancelTimerBtn) {
      cancelTimerBtn.addEventListener('click', () => {
        if (confirm('Discard current timer without saving?')) {
          timer.cancel();
        }
      });
    }

    const pumpMinusBtn = document.getElementById('pumpMinusBtn');
    const pumpPlusBtn = document.getElementById('pumpPlusBtn');
    if (pumpMinusBtn) {
      pumpMinusBtn.addEventListener('click', () => {
        timer.adjustPumpOutput(this.settings.units === 'oz' ? -0.5 : -15, this.settings.units);
      });
    }
    if (pumpPlusBtn) {
      pumpPlusBtn.addEventListener('click', () => {
        timer.adjustPumpOutput(this.settings.units === 'oz' ? 0.5 : 15, this.settings.units);
      });
    }

    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseFloat(btn.dataset.delta);
        timer.adjustPumpOutput(delta, this.settings.units);
      });
    });

    const stashDestSelect = document.getElementById('stashDestSelect');
    if (stashDestSelect) {
      stashDestSelect.addEventListener('change', (e) => {
        timer.setStoreDestination(e.target.value);
      });
    }

    // Direct Click-to-Type for Pump Output Number
    const stepperValDisplay = document.getElementById('stepperValDisplay');
    const stepperPumpVal = document.getElementById('stepperPumpVal');
    const stepperPumpInput = document.getElementById('stepperPumpInput');

    if (stepperValDisplay && stepperPumpVal && stepperPumpInput) {
      const showPumpInput = () => {
        stepperPumpVal.style.display = 'none';
        stepperPumpInput.style.display = 'block';
        stepperPumpInput.value = this.settings.units === 'oz' ? timer.pumpOutputOz : timer.pumpOutputMl;
        stepperPumpInput.focus();
        stepperPumpInput.select();
      };

      const commitPumpInput = () => {
        if (stepperPumpInput.style.display !== 'none') {
          const val = parseFloat(stepperPumpInput.value);
          if (!isNaN(val) && val > 0) {
            timer.setPumpOutput(val, this.settings.units);
          }
          stepperPumpInput.style.display = 'none';
          stepperPumpVal.style.display = 'block';
        }
      };

      stepperValDisplay.addEventListener('click', (e) => {
        if (e.target !== stepperPumpInput) {
          showPumpInput();
        }
      });

      stepperPumpInput.addEventListener('blur', commitPumpInput);
      stepperPumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitPumpInput();
          stepperPumpInput.blur();
        } else if (e.key === 'Escape') {
          stepperPumpInput.style.display = 'none';
          stepperPumpVal.style.display = 'block';
        }
      });
    }

    // Direct Click-to-Type for Daily Goal
    const goalFractionDisplay = document.getElementById('goalFractionDisplay');
    const goalTargetValue = document.getElementById('goalTargetValue');
    const goalTargetInput = document.getElementById('goalTargetInput');

    if (goalFractionDisplay && goalTargetValue && goalTargetInput) {
      const showGoalInput = () => {
        goalTargetValue.style.display = 'none';
        goalTargetInput.style.display = 'inline-block';
        goalTargetInput.value = this.settings.units === 'oz' 
          ? this.settings.dailyGoalOz 
          : Math.round(this.settings.dailyGoalOz * 29.5735);
        goalTargetInput.focus();
        goalTargetInput.select();
      };

      const commitGoalInput = async () => {
        if (goalTargetInput.style.display !== 'none') {
          const val = parseFloat(goalTargetInput.value);
          if (!isNaN(val) && val > 0) {
            const goalInOz = this.settings.units === 'mL' ? (val / 29.5735) : val;
            this.settings.dailyGoalOz = Math.round(goalInOz * 10) / 10;
            await db.setSetting('dailyGoalOz', this.settings.dailyGoalOz);
            sound.playChime('tick');
            this.updateBottleFillLevel();
          }
          goalTargetInput.style.display = 'none';
          goalTargetValue.style.display = 'inline';
        }
      };

      goalTargetValue.addEventListener('click', (e) => {
        e.stopPropagation();
        showGoalInput();
      });

      goalTargetInput.addEventListener('blur', commitGoalInput);
      goalTargetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitGoalInput();
          goalTargetInput.blur();
        } else if (e.key === 'Escape') {
          goalTargetInput.style.display = 'none';
          goalTargetValue.style.display = 'inline';
        }
      });
    }

    timer.setCallbacks({
      onTick: (data) => this.updateTimerDisplay(data),
      onStateChange: () => this.updateTimerDisplay(timer.getDisplayData()),
      onSaved: () => {
        this.updateTimerDisplay(timer.getDisplayData());
      }
    });

    this.updateTimerDisplay(timer.getDisplayData());
  }

  updateTimerDisplay(data) {
    const digitsEl = document.getElementById('timerDigits');
    const heroTile = document.getElementById('timerHeroTile');
    const statusText = document.getElementById('timerStatusText');
    const actionBtn = document.getElementById('mainTimerBtn');
    const cancelBtn = document.getElementById('cancelTimerBtn');

    digitsEl.textContent = data.formattedTotal;
    cancelBtn.style.display = data.active ? 'inline-block' : 'none';

    if (heroTile) {
      heroTile.classList.toggle('active', data.active);
    }

    if (data.active) {
      actionBtn.className = 'main-timer-action-btn stop-btn';
      actionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        <span>Finish & Save (${this.settings.units === 'oz' ? data.pumpOutputOz.toFixed(1) + ' oz' : data.pumpOutputMl + ' mL'})</span>
      `;
      statusText.textContent = 'Pumping Session in Progress';
    } else {
      actionBtn.className = 'main-timer-action-btn start-btn';
      actionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Start Pumping</span>
      `;
      statusText.textContent = 'Ready for Next Pump';
    }

    const pumpValEl = document.getElementById('stepperPumpVal');
    if (pumpValEl) {
      pumpValEl.textContent = this.settings.units === 'oz'
        ? data.pumpOutputOz.toFixed(1)
        : data.pumpOutputMl;
    }
  }

  // --- MERGED PUMPS DASHBOARD (GOAL BOTTLE + ACCORDION + TRENDS) ---
  async renderTodayDashboard() {
    await this.updateBottleFillLevel();
    await this.renderPumpTracker();
    await this.renderFeedsTracker();
    await this.renderThawSection();
    await this.renderPumpsAccordion();
    await this.renderTrendsChart();
    await this.renderTodayUrgent();
  }

  // --- TRACK PUMPING (quick duration logging under the pump goal) ---
  // Shows today's pump session count; tapping opens the Log Pump modal,
  // where the duration chips (10 / 15 / 20 min) or the typed number field
  // fill in the session length. The hero pump timer below remains the live
  // path: its elapsed time flows into the logged session on finish.
  async renderPumpTracker() {
    const numEl = document.getElementById('pumpTrackerNum');
    const subEl = document.getElementById('pumpTrackerSub');
    if (!numEl) return;
    const sessions = await db.getSessions();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const count = sessions.filter(s => s.type === 'pump' && s.startTime >= startOfToday).length;
    numEl.textContent = String(count);
    if (subEl) subEl.textContent = count === 1 ? '1 session today' : `${count} sessions today`;
  }

  // 1. Animated Bottle Fill Calculation & SVG Rendering
  async updateBottleFillLevel() {
    const aggregates = await TrendsManager.getDailyAggregates(7);
    const todayData = aggregates.days[aggregates.days.length - 1];
    const unit = this.settings.units;
    const isMl = unit === 'mL';

    let todayPumpedOz = todayData ? todayData.pumpVolume : 0;
    if (isMl) {
      // If unit is mL, pumpVolume in aggregate was already converted to current unit
      todayPumpedOz = todayData ? todayData.pumpVolume / 29.5735 : 0;
    }

    const goalOz = this.settings.dailyGoalOz || 24.0;
    const percent = Math.min(100, Math.round((todayPumpedOz / goalOz) * 100));

    // Display units
    const displayToday = isMl ? Math.round(todayPumpedOz * 29.5735) : (Math.round(todayPumpedOz * 10) / 10);
    const displayGoal = isMl ? Math.round(goalOz * 29.5735) : (Math.round(goalOz * 10) / 10);

    // Update Fraction Text
    const goalCurrentEl = document.getElementById('goalCurrentValue');
    const goalTargetEl = document.getElementById('goalTargetValue');
    if (goalCurrentEl && goalTargetEl) {
      goalCurrentEl.textContent = displayToday;
      goalTargetEl.textContent = displayGoal;
    }

    // Update Percentage Pill
    const badgeEl = document.getElementById('goalBadgePill');
    const tileEl = document.getElementById('goalBottleTile');
    const isComplete = percent >= 100;

    if (badgeEl) {
      badgeEl.textContent = isComplete ? 'Goal Achieved!' : `${percent}% Goal`;
      badgeEl.className = `goal-badge-pill ${isComplete ? 'celebration' : ''}`;
    }
    if (tileEl) {
      tileEl.classList.toggle('goal-reached', isComplete);
    }

    const subtextEl = document.getElementById('goalSubtext');
    if (subtextEl) {
      const remaining = Math.max(0, displayGoal - displayToday);
      const parentName = (this.settings.parentName || '').trim() || 'You';
      subtextEl.textContent = isComplete
        ? `${parentName} crushed today's goal!`
        : `${remaining} ${unit} remaining to hit daily goal`;
    }

    // Animate Bottle SVG Height
    // Bottle cavity inside SVG is Y: 36 to Y: 154 (height: 118px)
    const maxHeight = 114;
    const fillHeight = Math.max(0, Math.min(maxHeight, Math.round((percent / 100) * maxHeight)));
    const liquidY = 154 - fillHeight;

    const liquidRect = document.getElementById('bottleMilkLiquid');
    const wavePath = document.getElementById('liquidWaveSurface');

    if (liquidRect) {
      liquidRect.setAttribute('y', liquidY);
      liquidRect.setAttribute('height', fillHeight);
    }
    if (wavePath) {
      wavePath.setAttribute('transform', `translate(0, ${liquidY - 4})`);
      wavePath.style.display = fillHeight > 4 ? 'block' : 'none';
    }
  }

  // 2. Expandable Activity History Accordion (Pumps & Feeds)
  async renderPumpsAccordion() {
    const headerTitle = document.getElementById('accordionTodayHeader');
    const contentWrap = document.getElementById('activitySessionsContainer') || document.getElementById('accordionPumpsList');
    const accordionTile = document.getElementById('accordionPumpsList');
    const chevronIcon = document.getElementById('accordionChevron');

    const sessions = await db.getSessions();
    const unit = this.settings.units;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // Calculate today's totals for header
    const todayPumps = sessions.filter(s => s.type === 'pump' && s.startTime >= startOfToday);
    const todayFeeds = sessions.filter(s => s.type === 'feed' && s.startTime >= startOfToday);
    const todayPumpVolume = todayPumps.reduce((acc, s) => acc + (s.outputQty || 0), 0);
    const todayFeedVolume = todayFeeds.reduce((acc, s) => acc + (s.outputQty || 0), 0);

    if (headerTitle) {
      if (todayPumps.length > 0 || todayFeeds.length > 0) {
        headerTitle.innerHTML = `Today: <strong>${todayPumps.length} pumps</strong> (${Math.round(todayPumpVolume * 10) / 10} ${unit}) • <strong>${todayFeeds.length} feeds</strong> (${Math.round(todayFeedVolume * 10) / 10} ${unit})`;
      } else {
        headerTitle.innerHTML = `Today's Activity: <strong>0 sessions</strong>`;
      }
    }

    if (chevronIcon) {
      chevronIcon.classList.toggle('open', this.pumpsAccordionOpen);
    }

    if (accordionTile) {
      accordionTile.classList.toggle('open', this.pumpsAccordionOpen);
    }

    if (contentWrap) {
      // Filter according to this.activityFilter
      let filteredSessions = sessions;
      if (this.activityFilter === 'pumps') {
        filteredSessions = sessions.filter(s => s.type === 'pump');
      } else if (this.activityFilter === 'feeds') {
        filteredSessions = sessions.filter(s => s.type === 'feed');
      }

      const groups = TrendsManager.groupSessionsByDay(filteredSessions);
      const todayGroup = groups.find(g => g.title === 'Today');

      if (!filteredSessions || filteredSessions.length === 0) {
        contentWrap.innerHTML = `
          <div class="empty-state-msg">
            No ${this.activityFilter === 'all' ? 'activity' : this.activityFilter} recorded yet today.
          </div>
        `;
        return;
      }

      // Display groups: always show Today; show older if this.showOlderHistory is true
      const displayedGroups = this.showOlderHistory ? groups : (todayGroup ? [todayGroup] : []);

      let html = '';
      if (displayedGroups.length === 0) {
        html += `
          <div class="empty-state-msg">
            No ${this.activityFilter === 'all' ? 'activity' : this.activityFilter} recorded today.
          </div>
        `;
      } else {
        html += displayedGroups.map(group => {
          const groupPumps = group.sessions.filter(s => s.type === 'pump');
          const groupFeeds = group.sessions.filter(s => s.type === 'feed');
          const pVol = groupPumps.reduce((a, s) => a + (s.outputQty || 0), 0);
          const fVol = groupFeeds.reduce((a, s) => a + (s.outputQty || 0), 0);

          let summaryTag = '';
          if (pVol > 0 && fVol > 0) {
            summaryTag = `${Math.round(pVol * 10) / 10} pumped • ${Math.round(fVol * 10) / 10} fed`;
          } else if (pVol > 0) {
            summaryTag = `${Math.round(pVol * 10) / 10} ${unit} pumped`;
          } else if (fVol > 0) {
            summaryTag = `${Math.round(fVol * 10) / 10} ${unit} fed`;
          }

          return `
            <div class="session-group-header">
              <span>${group.title}</span>
              <span>${summaryTag}</span>
            </div>
            ${group.sessions.map(s => {
              const timeStr = new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              
              if (s.type === 'feed') {
                const isFormula = s.feedType === 'formula';
                return `
                  <div class="session-item-tile">
                    <div class="session-item-left">
                      <div class="session-item-icon ${isFormula ? 'formula-feed-icon' : 'breastmilk-feed-icon'}">
                        ${isFormula ? ICON_SVG_BOTTLE : ICON_SVG_DROPLET}
                      </div>
                      <div class="session-details">
                        <div class="session-primary-title">
                          <span>${s.outputQty} ${s.unit || unit}</span>
                          <span class="session-badge-tag ${isFormula ? 'formula' : 'breastmilk'}">${isFormula ? 'Formula' : 'Breast Milk'}</span>
                        </div>
                        <div class="session-sub-title">${timeStr} • ${s.notes || (isFormula ? 'Formula Feeding' : 'Breast Milk Feeding')}</div>
                      </div>
                    </div>
                    <div class="session-item-right has-actions">
                      <button class="session-action-btn" data-action="edit-session" data-id="${s.id}">Edit</button>
                      <button class="session-action-btn" data-action="delete-session" data-id="${s.id}">Delete</button>
                    </div>
                  </div>
                `;
              } else {
                const durationMin = Math.max(1, Math.round((s.durationSec || 0) / 60));
                return `
                  <div class="session-item-tile">
                    <div class="session-item-left">
                      <div class="session-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                        </svg>
                      </div>
                      <div class="session-details">
                        <div class="session-primary-title">
                          <span>${s.outputQty} ${s.unit || unit}</span>
                          <span class="session-badge-tag breastmilk">Pump</span>
                        </div>
                        <div class="session-sub-title">${timeStr} • ${durationMin} min duration</div>
                        ${s.notes ? `<div class="note-italic-muted">"${s.notes}"</div>` : ''}
                      </div>
                    </div>
                    <div class="session-item-right has-actions">
                      <button class="session-action-btn" data-action="edit-session" data-id="${s.id}">Edit</button>
                      <button class="session-action-btn" data-action="delete-session" data-id="${s.id}">Delete</button>
                    </div>
                  </div>
                `;
              }
            }).join('')}
          `;
        }).join('');
      }

      // Button to toggle older history
      const hasOlder = groups.some(g => g.title !== 'Today');
      if (hasOlder) {
        html += `
          <button class="btn-secondary btn-history-toggle" data-action="toggle-older-history">
            ${this.showOlderHistory ? 'Hide Previous Days' : 'Show Previous Days (' + (groups.length - 1) + ' days)'}
          </button>
        `;
      }

      contentWrap.innerHTML = html;
    }
  }

  togglePumpsAccordion() {
    this.pumpsAccordionOpen = !this.pumpsAccordionOpen;
    this.renderPumpsAccordion();
  }

  toggleOlderHistory() {
    this.showOlderHistory = !this.showOlderHistory;
    this.renderPumpsAccordion();
  }

  async deleteSession(id) {
    if (confirm('Delete this activity entry?')) {
      await db.delete('sessions', id);
      await this.renderTodayDashboard();
      await reminders.updateStatus();
      await this.updateQuickFoodTally();
    }
  }

  async deletePumpSession(id) {
    return this.deleteSession(id);
  }

  // --- EDIT ACTIVITY SESSION (tracker entries) ---
  _setEditFeedTypePills(feedType) {
    this._editFeedType = feedType;
    document.getElementById('editFeedTypeFormula').classList.toggle('active', feedType === 'formula');
    document.getElementById('editFeedTypeBreastmilk').classList.toggle('active', feedType === 'breastmilk');
  }

  async openEditSession(id) {
    const sessions = await db.getSessions();
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    this._editingSessionId = id;
    const isFeed = s.type === 'feed';

    document.getElementById('editSessionTitle').textContent = isFeed ? 'Edit Feed Entry' : 'Edit Pump Entry';
    document.getElementById('editFeedTypeGroup').style.display = isFeed ? '' : 'none';
    document.getElementById('editDurationGroup').style.display = isFeed ? 'none' : '';
    if (isFeed) this._setEditFeedTypePills(s.feedType === 'formula' ? 'formula' : 'breastmilk');

    document.getElementById('editSessionUnitLabel').textContent = s.unit || this.settings.units;
    document.getElementById('editSessionQty').value = s.outputQty ?? '';
    document.getElementById('editSessionDuration').value = Math.max(1, Math.round((s.durationSec || 0) / 60));
    const d = new Date(s.startTime);
    document.getElementById('editSessionTime').value =
      new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('editSessionNotes').value = s.notes || '';
    document.getElementById('editSessionModal').classList.add('open');
  }

  closeEditSession() {
    document.getElementById('editSessionModal').classList.remove('open');
    this._editingSessionId = null;
  }

  async saveEditSession() {
    const sessions = await db.getSessions();
    const original = sessions.find(x => x.id === this._editingSessionId);
    if (!original) { this.closeEditSession(); return; }

    const qty = parseFloat(document.getElementById('editSessionQty').value);
    if (!qty || qty <= 0) { alert('Please enter a valid quantity.'); return; }

    const timeVal = document.getElementById('editSessionTime').value;
    const startTime = timeVal ? new Date(timeVal).getTime() : original.startTime;
    if (!timeVal || isNaN(startTime)) { alert('Please enter a valid date and time.'); return; }

    const edits = {
      outputQty: qty,
      startTime,
      notes: document.getElementById('editSessionNotes').value.trim(),
    };
    if (original.type === 'feed') {
      edits.feedType = this._editFeedType || original.feedType;
    } else {
      edits.durationMin = parseFloat(document.getElementById('editSessionDuration').value) || 0;
    }

    await db.put('sessions', applySessionEdits(original, edits));
    this.closeEditSession();
    await this.renderTodayDashboard();
    await reminders.updateStatus();
    await this.updateQuickFoodTally();
  }

  // --- MANUAL PUMP ENTRY (log duration + amount, no timer) ---
  openManualPump() {
    document.getElementById('manualPumpUnitLabel').textContent = this.settings.units;
    document.getElementById('manualPumpQty').value = '';
    document.getElementById('manualPumpDuration').value = '';
    document.getElementById('manualPumpNotes').value = '';
    document.getElementById('manualPumpDest').value = timer.storeDestination || 'fridge';
    const now = new Date();
    document.getElementById('manualPumpTime').value =
      new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('manualPumpModal').classList.add('open');
  }

  closeManualPump() {
    document.getElementById('manualPumpModal').classList.remove('open');
  }

  async saveManualPump() {
    const qty = parseFloat(document.getElementById('manualPumpQty').value);
    if (!qty || qty <= 0) { alert('Please enter a valid amount.'); return; }
    const durationMin = normalizePumpDuration(document.getElementById('manualPumpDuration').value);
    if (durationMin === null) { alert('Please enter a valid duration.'); return; }

    const timeVal = document.getElementById('manualPumpTime').value;
    const startTime = timeVal ? new Date(timeVal).getTime() : Date.now();
    if (isNaN(startTime)) { alert('Please enter a valid date and time.'); return; }

    await timer.logManualPump({
      quantity: qty,
      durationMin,
      unit: this.settings.units,
      startTime,
      notes: document.getElementById('manualPumpNotes').value.trim(),
      storeDestination: document.getElementById('manualPumpDest').value
    });

    this.closeManualPump();
    await this.renderTodayDashboard();
    await reminders.updateStatus();
    await this.updateQuickFoodTally();
  }

  // 3. Render 7-day Supply Trends Chart
  async renderTrendsChart() {
    const chartWrap = document.getElementById('chartSvgWrap');
    if (!chartWrap) return;
    const aggregates = await TrendsManager.getDailyAggregates(7);
    chartWrap.innerHTML = TrendsManager.renderSvgChart(aggregates.days, this.settings.units, 340, 150);

    const totalVolumeWeek = aggregates.days.reduce((acc, d) => acc + d.pumpVolume, 0);
    const avgDailyWeek = Math.round((totalVolumeWeek / 7) * 10) / 10;
    const unit = this.settings.units;

    const avgEl = document.getElementById('metricWeekAvg');
    if (avgEl) avgEl.textContent = `${avgDailyWeek} ${unit}/d`;
  }

  // --- INVENTORY SUBSYSTEM (FIFO) ---
  async renderInventory() {
    const listContainer = document.getElementById('inventoryListContainer');
    if (!listContainer) return;

    const summary = await inventory.getStashSummary();
    const unit = this.settings.units;
    const isMl = unit === 'mL';
    const totalDisplay = isMl ? Math.round(summary.totalOz * 29.5735) : summary.totalOz;
    const fridgeDisplay = isMl ? Math.round(summary.fridgeOz * 29.5735) : summary.fridgeOz;
    const freezerDisplay = isMl ? Math.round((summary.freezerOz + summary.deepFreezerOz) * 29.5735) : Math.round((summary.freezerOz + summary.deepFreezerOz) * 10) / 10;

    const totEl = document.getElementById('stashTotalVolume');
    const frEl = document.getElementById('stashFridgeVolume');
    const fzEl = document.getElementById('stashFreezerVolume');
    if (totEl) totEl.textContent = `${totalDisplay} ${unit}`;
    if (frEl) frEl.textContent = `${fridgeDisplay} ${unit}`;
    if (fzEl) fzEl.textContent = `${freezerDisplay} ${unit}`;

    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.filter === inventory.currentFilter);
      pill.onclick = () => {
        inventory.currentFilter = pill.dataset.filter;
        this.renderInventory();
      };
    });

    const items = await inventory.getFilteredItems();

    if (!items || items.length === 0) {
      listContainer.innerHTML = `
        <div class="card-tile empty-stash-msg">
          <div class="empty-stash-title">No milk stored in this view</div>
          <div class="empty-stash-sub">Tap "Add Stored Milk Pouch" to record a pouch.</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = items.map((item, index) => {
      const isFifoFirst = (index === 0 && item.status === 'active' && inventory.currentFilter !== 'archived');
      const urgency = InventoryManager.getUrgency(item.expiresAt);
      const pumpDateStr = new Date(item.pumpedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const pumpTimeStr = new Date(item.pumpedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

      const locLabels = {
        fridge: 'Refrigerator',
        freezer: 'Freezer',
        deepFreezer: 'Deep Chest',
        room: 'Room Temp',
        [THAWED_LOCATION]: 'Thawed (Fridge)'
      };

      const locName = locLabels[item.location] || item.location;

      let displayQty = item.quantity;
      let displayUnit = item.unit || 'oz';
      if (this.settings.units === 'mL' && displayUnit === 'oz') {
        displayQty = Math.round(item.quantity * 29.5735);
        displayUnit = 'mL';
      } else if (this.settings.units === 'oz' && displayUnit === 'mL') {
        displayQty = Math.round((item.quantity / 29.5735) * 10) / 10;
        displayUnit = 'oz';
      }

      return `
        <div class="inventory-tile ${isFifoFirst ? 'fifo-first' : ''}" data-id="${item.id}">
          ${isFifoFirst ? `
            <div class="fifo-badge">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Use Next (FIFO)
            </div>
          ` : ''}
          <div class="inv-card-top">
            <div class="inv-qty-title">
              ${displayQty} <span class="inv-qty-unit">${displayUnit}</span>
            </div>
            <div class="inv-countdown-pill ${urgency.badgeClass}">
              ${urgency.label}
            </div>
          </div>

          <div class="inv-dates-row">
            <div><span>Pumped:</span> ${pumpDateStr} (${pumpTimeStr})</div>
            <div class="inv-location-tag">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="2" width="18" height="20" rx="2" ry="2"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              ${locName}
            </div>
          </div>

          ${item.notes ? `<div class="note-italic-secondary">"${item.notes}"</div>` : ''}

          ${item.status === 'active' ? `
            <div class="inv-card-actions">
              ${FROZEN_LOCATIONS.includes(item.location) ? `
              <button class="inv-action-btn thaw-btn" data-action="thaw-item" data-id="${item.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 2h6M10 2v3a2 2 0 0 1-2 2H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1a2 2 0 0 1-2-2V2"/>
                </svg>
                Thaw
              </button>
              ` : ''}
              <button class="inv-action-btn" data-action="mark-used" data-id="${item.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Used
              </button>
              <button class="inv-action-btn" data-action="discard-item" data-id="${item.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Discard
              </button>
            </div>
          ` : `
            <div class="inv-status-label">
              Status: ${item.status}
            </div>
          `}
        </div>
      `;
    }).join('');
  }

  async markUsedItem(id) {
    await inventory.markUsed(id);
    this.renderInventory();
  }

  async discardItem(id) {
    if (confirm('Archive / Discard this item?')) {
      await inventory.markDiscarded(id);
      this.renderInventory();
    }
  }

  // --- THAW FROM STASH (main page section) ---
  async thawItem(id) {
    if (!confirm('Thaw this pouch? It moves from your frozen stash into the thawed stash, ready for the next feed.')) return;
    const thawed = await inventory.thawItem(id);
    if (!thawed) {
      alert('That pouch could not be thawed.');
      return;
    }
    await this.renderTodayDashboard();
    await this.renderInventory();
    this._ffRenderThawedSources();
  }

  // --- TODAY'S FEEDS TRACKER (under the pump goal; rows quick-edit) ---
  async renderFeedsTracker() {
    const wrap = document.getElementById('feedsTrackerRows');
    const countEl = document.getElementById('feedsTrackerCount');
    if (!wrap) return;

    const sessions = await db.getSessions();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const feeds = sessions.filter(s => s.type === 'feed' && s.startTime >= startOfToday);
    const unit = this.settings.units;
    const totalVol = feeds.reduce((acc, s) => acc + (s.outputQty || 0), 0);

    if (countEl) {
      countEl.textContent = feeds.length
        ? `\u2022 ${feeds.length} feed${feeds.length === 1 ? '' : 's'} \u2022 ${Math.round(totalVol * 10) / 10} ${unit}`
        : '';
    }

    if (feeds.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-msg">
          No feeds logged yet today \u2014 tap Log feed to start.
        </div>`;
      return;
    }

    wrap.innerHTML = feeds.map(s => {
      const isFormula = s.feedType === 'formula';
      const timeStr = new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `
        <div class="session-item-tile feeds-tracker-row" role="button" tabindex="0"
             title="Tap to quick-edit" data-action="edit-session" data-id="${s.id}">
          <div class="session-item-left">
            <div class="session-item-icon ${isFormula ? 'formula-feed-icon' : 'breastmilk-feed-icon'}">
              ${isFormula ? ICON_SVG_BOTTLE : ICON_SVG_DROPLET}
            </div>
            <div class="session-details">
              <div class="session-primary-title">
                <span>${s.outputQty} ${s.unit || unit}</span>
                <span class="session-badge-tag ${isFormula ? 'formula' : 'breastmilk'}">${isFormula ? 'Formula' : 'Breast Milk'}</span>
              </div>
              <div class="session-sub-title">${timeStr}${s.notes ? ` \u2022 ${this._escapeHtml(s.notes)}` : ''}</div>
            </div>
          </div>
          <div class="session-item-right is-hint">Edit \u203A</div>
        </div>`;
    }).join('');
  }

  // --- THAW-FROM-STASH SECTION (main page) ---
  // Hidden entirely when there is no frozen stash to thaw — the tile only
  // earns its place once it is actually used.
  async renderThawSection() {
    const tile = document.getElementById('thawTile');
    const frozenWrap = document.getElementById('thawFrozenRows');
    const readyWrap = document.getElementById('thawReadyRows');
    const moreEl = document.getElementById('thawMoreLine');
    if (!frozenWrap || !readyWrap) return;

    const unit = this.settings.units;
    const frozen = await inventory.getFrozenItems();
    const thawed = await inventory.getThawedItems();
    if (tile) tile.hidden = !shouldShowThawTile(frozen.length);
    const MAX_FROZEN = 6;
    const shown = frozen.slice(0, MAX_FROZEN);

    frozenWrap.innerHTML = shown.length === 0
      ? `<div class="thaw-empty">Nothing frozen in the stash.</div>`
      : shown.map(item => {
          const disp = this._displayQty(item, unit);
          const locName = item.location === 'deepFreezer' ? 'Deep chest' : 'Freezer';
          const pumped = new Date(item.pumpedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
          return `
            <div class="session-item-tile thaw-row">
              <div class="session-item-left">
                <div class="session-item-icon thaw-icon">${ICON_SVG_SNOWFLAKE}</div>
                <div class="session-details">
                  <div class="session-primary-title"><span>${disp.qty} ${disp.qtyUnit}</span>
                    <span class="session-badge-tag">${locName}</span></div>
                  <div class="session-sub-title">Pumped ${pumped}${item.notes ? ` \u2022 ${this._escapeHtml(item.notes)}` : ''}</div>
                </div>
              </div>
              <button class="inv-action-btn thaw-btn thaw-action-btn"
                      data-action="thaw-item" data-id="${item.id}">Thaw</button>
            </div>`;
        }).join('');

    if (moreEl) {
      if (frozen.length > MAX_FROZEN) {
        moreEl.hidden = false;
        moreEl.innerHTML = `<button class="btn-ghost btn-more-stash" data-action="switch-tab" data-tab="inventory">+ ${frozen.length - MAX_FROZEN} more in Stash \u2192</button>`;
      } else {
        moreEl.hidden = true;
      }
    }

    readyWrap.innerHTML = thawed.length === 0
      ? `<div class="thaw-empty">No thawed milk yet \u2014 thaw a pouch above and it will wait here, ready for the next feed.</div>`
      : thawed.map(item => {
          const disp = this._displayQty(item, unit);
          const urgency = InventoryManager.getUrgency(item.expiresAt);
          const sub = urgency.level === 'expired'
            ? 'Expired \u2014 discard'
            : `Use within ${this._escapeHtml(urgency.label)}`;
          return `
            <div class="session-item-tile thaw-row">
              <div class="session-item-left">
                <div class="session-item-icon breastmilk-feed-icon">${ICON_SVG_DROPLET}</div>
                <div class="session-details">
                  <div class="session-primary-title"><span>${disp.qty} ${disp.qtyUnit}</span>
                    <span class="session-badge-tag breastmilk">Thawed</span></div>
                  <div class="session-sub-title">${sub}</div>
                </div>
              </div>
              <button class="inv-action-btn thaw-action-btn"
                      data-action="open-feed-flow">Feed</button>
            </div>`;
        }).join('');
  }

  // --- THAWED STASH AS A BOTTLE-READY SOURCE IN THE MERGED FEED FLOW ---
  async _ffRenderThawedSources() {
    const block = document.getElementById('ffThawedBlock');
    const list = document.getElementById('ffThawedSources');
    if (!block || !list) return;
    this._thawedSources = await inventory.getThawedItems();
    if (this._thawedSources.length === 0) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    list.innerHTML = this._thawedSources.map(item => {
      const prefill = buildFeedFlowPrefill(item);
      if (!prefill) return '';
      const urgency = InventoryManager.getUrgency(item.expiresAt);
      const tone = urgency.level === 'expired' ? 'badge-expired' : urgency.badgeClass;
      return `
        <button type="button" class="ff-thawed-chip" data-action="pick-thawed-source" data-id="${item.id}">
          <span class="ff-thawed-qty">${this._ffAmtStr(prefill.amountOz)} breast milk</span>
          <span class="inv-countdown-pill ${tone}">${this._escapeHtml(urgency.label)}</span>
        </button>`;
    }).join('');
  }

  pickThawedSource(id) {
    const item = (this._thawedSources || []).find(i => i.id === id);
    const prefill = buildFeedFlowPrefill(item);
    if (!prefill) return;
    this.feedFlow.type = prefill.type;
    this.feedFlow.amountOz = prefill.amountOz;
    this.feedFlow.sourceInventoryId = prefill.sourceInventoryId;
    const mBtn = document.getElementById('ffTypeBreastmilk');
    if (mBtn) mBtn.classList.add('is-selected');
    const fBtn = document.getElementById('ffTypeFormula');
    if (fBtn) fBtn.classList.remove('is-selected');
    this._ffSyncUnits();
    this._ffShowStep('amount');
    sound.playChime('tick');
  }

  // From the merged feed flow's amount step: close the sheet and hand the
  // prefilled type/amount/source to the live bottle timer. The timer still
  // enforces the per-type CDC safety window (1h formula / 2h breast milk).
  _ffStartTimer() {
    const start = resolveFeedTimerStart(this.feedFlow || {});
    this.closeFeedFlow();
    this.openBottleSetup(start);
  }

  // Consume a thawed source pouch after its feed is logged. Full use marks
  // the pouch used; partial use leaves the remainder thawed for next time.
  async _consumeThawedSource(sourceId, usedOz) {
    if (!sourceId) return;
    const item = await db.get('inventory', sourceId);
    if (!item || item.status !== 'active' || item.location !== THAWED_LOCATION) return;
    const itemOz = item.unit === 'mL' ? item.quantity / 29.5735 : item.quantity;
    const used = Math.max(0, usedOz || 0);
    if (used >= itemOz - 0.05) {
      await inventory.markUsed(sourceId);
    } else {
      const remainingOz = Math.round((itemOz - used) * 10) / 10;
      item.quantity = item.unit === 'mL' ? Math.round(remainingOz * 29.5735) : remainingOz;
      await db.put('inventory', item);
      inventory.notify();
    }
    await this.renderTodayDashboard();
    await this.renderInventory();
  }

  // Small display helpers shared by the new Today sections.
  _escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  _displayQty(item, unit) {
    let qty = item.quantity;
    let qtyUnit = item.unit || 'oz';
    if (unit === 'mL' && qtyUnit === 'oz') {
      qty = Math.round(qty * 29.5735);
      qtyUnit = 'mL';
    } else if (unit === 'oz' && qtyUnit === 'mL') {
      qty = Math.round((qty / 29.5735) * 10) / 10;
      qtyUnit = 'oz';
    } else {
      qty = Math.round(qty * 10) / 10;
    }
    return { qty, qtyUnit };
  }

  // --- SETTINGS SUBSYSTEM ---
  async initSettingsUI() {
    const parentNameInput = document.getElementById('settingParentNameInput');
    if (parentNameInput) {
      parentNameInput.value = this.settings.parentName || '';
      const saveParent = async () => {
        const val = parentNameInput.value.trim() || '';
        parentNameInput.value = val;
        this.settings.parentName = val;
        await db.setSetting('parentName', val);
        this.updateNamesUI();
        this.updateBottleFillLevel();
      };
      parentNameInput.addEventListener('change', saveParent);
      parentNameInput.addEventListener('blur', saveParent);
    }

    const babyNameInput = document.getElementById('settingBabyNameInput');
    if (babyNameInput) {
      babyNameInput.value = this.settings.babyName || '';
      const saveBaby = async () => {
        const val = babyNameInput.value.trim() || '';
        babyNameInput.value = val;
        this.settings.babyName = val;
        await db.setSetting('babyName', val);
        this.updateNamesUI();
      };
      babyNameInput.addEventListener('change', saveBaby);
      babyNameInput.addEventListener('blur', saveBaby);
    }

    const unitSelect = document.getElementById('settingUnitSelect');
    if (unitSelect) {
      unitSelect.value = this.settings.units;
      unitSelect.addEventListener('change', (e) => this.setUnit(e.target.value));
    }

    const themeSelect = document.getElementById('settingThemeSelect');
    if (themeSelect) {
      themeSelect.value = this.settings.themeMode || 'auto';
      themeSelect.addEventListener('change', async (e) => {
        await this.setThemeMode(e.target.value);
      });
    }

    const soundToggle = document.getElementById('soundToggle');
    if (soundToggle) {
      soundToggle.checked = this.settings.soundEnabled;
      soundToggle.addEventListener('change', async (e) => {
        this.settings.soundEnabled = e.target.checked;
        sound.setEnabled(e.target.checked);
        await db.setSetting('soundEnabled', e.target.checked);
        if (e.target.checked) sound.playChime('complete');
      });
    }

    const goalInput = document.getElementById('settingDailyGoalInput');
    if (goalInput) {
      goalInput.value = this.settings.dailyGoalOz;
      goalInput.addEventListener('change', async (e) => {
        const val = parseFloat(e.target.value) || 24.0;
        this.settings.dailyGoalOz = val;
        await db.setSetting('dailyGoalOz', val);
        this.updateBottleFillLevel();
      });
    }

    const intervalSelect = document.getElementById('settingIntervalSelect');
    if (intervalSelect) {
      intervalSelect.value = this.settings.pumpIntervalMinutes;
      intervalSelect.addEventListener('change', async (e) => {
        const val = parseInt(e.target.value, 10);
        this.settings.pumpIntervalMinutes = val;
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
        const pName = this.settings.parentName || 'you';
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
        this.onboarding.showModal();
      });
    }
  }

  renderSettingsForm() {
    const pInput = document.getElementById('settingParentNameInput');
    const bInput = document.getElementById('settingBabyNameInput');
    if (pInput && document.activeElement !== pInput) pInput.value = this.settings.parentName || '';
    if (bInput && document.activeElement !== bInput) bInput.value = this.settings.babyName || '';

    const windows = this.settings.storageWindows || {};
    const winFridge = document.getElementById('settingWinFridge');
    const winFreezer = document.getElementById('settingWinFreezer');
    const winDeepFreezer = document.getElementById('settingWinDeepFreezer');
    const winThawed = document.getElementById('settingWinThawed');
    const winStarted = document.getElementById('settingWinStarted');
    const goalInput = document.getElementById('settingDailyGoalInput');

    if (goalInput) goalInput.value = this.settings.dailyGoalOz;
    if (winFridge) winFridge.value = windows.fridgeDays || 4;
    if (winFreezer) winFreezer.value = windows.freezerMonths || 6;
    if (winDeepFreezer) winDeepFreezer.value = windows.deepFreezerMonths || 12;
    if (winThawed) winThawed.value = windows.thawedBottleHours || 24;
    if (winStarted) winStarted.value = windows.startedBottleHours || 2;
  }

  async saveStorageWindowSettings() {
    const windows = {
      roomTempHours: 4,
      fridgeDays: parseInt(document.getElementById('settingWinFridge').value, 10) || 4,
      freezerMonths: parseInt(document.getElementById('settingWinFreezer').value, 10) || 6,
      deepFreezerMonths: parseInt(document.getElementById('settingWinDeepFreezer').value, 10) || 12,
      thawedBottleHours: parseInt(document.getElementById('settingWinThawed').value, 10) || 24,
      startedBottleHours: parseInt(document.getElementById('settingWinStarted').value, 10) || 2
    };

    this.settings.storageWindows = windows;
    await db.setSetting('storageWindows', windows);
    sound.playChime('tick');
    alert('Storage expiration rules saved.');
    this.renderInventory();
  }

  // --- MODAL DIALOGS ---
  bindGlobalModals() {
    const addMilkBtn = document.getElementById('openAddMilkModalBtn');
    const addMilkModal = document.getElementById('addMilkModal');
    const closeAddMilkBtn = document.getElementById('closeAddMilkBtn');
    const saveNewMilkBtn = document.getElementById('saveNewMilkBtn');

    if (addMilkBtn && addMilkModal) {
      addMilkBtn.addEventListener('click', () => {
        const now = new Date();
        const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('modalPumpedAt').value = localIso;
        document.getElementById('modalMilkQty').value = this.settings.units === 'oz' ? 4.0 : 120;
        addMilkModal.classList.add('open');
      });

      closeAddMilkBtn.addEventListener('click', () => addMilkModal.classList.remove('open'));

      saveNewMilkBtn.addEventListener('click', async () => {
        const pumpedAtVal = document.getElementById('modalPumpedAt').value;
        const qtyVal = parseFloat(document.getElementById('modalMilkQty').value);
        const locVal = document.getElementById('modalMilkLoc').value;
        const notesVal = document.getElementById('modalMilkNotes').value;

        if (!qtyVal || qtyVal <= 0) {
          alert('Please enter a valid milk volume.');
          return;
        }

        const pumpedAt = pumpedAtVal ? new Date(pumpedAtVal).getTime() : Date.now();

        await inventory.addItem({
          pumpedAt,
          quantity: qtyVal,
          unit: this.settings.units,
          location: locVal,
          notes: notesVal,
          storageWindows: this.settings.storageWindows
        });

        addMilkModal.classList.remove('open');
        this.renderInventory();
      });
    }

    // Edit activity session modal (tracker entries)
    const editSessionModal = document.getElementById('editSessionModal');
    if (editSessionModal) {
      document.getElementById('closeEditSessionBtn').addEventListener('click', () => this.closeEditSession());
      document.getElementById('saveEditSessionBtn').addEventListener('click', () => this.saveEditSession());
      document.getElementById('editFeedTypeFormula').addEventListener('click', () => this._setEditFeedTypePills('formula'));
      document.getElementById('editFeedTypeBreastmilk').addEventListener('click', () => this._setEditFeedTypePills('breastmilk'));
      editSessionModal.addEventListener('click', (e) => {
        if (e.target === editSessionModal) this.closeEditSession();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && editSessionModal.classList.contains('open')) this.closeEditSession();
      });
    }

    // Manual pump entry modal (log duration + amount, no timer)
    const manualPumpBtn = document.getElementById('manualPumpBtn');
    if (manualPumpBtn) {
      manualPumpBtn.addEventListener('click', () => this.openManualPump());
    }
    const manualPumpModal = document.getElementById('manualPumpModal');
    if (manualPumpModal) {
      document.getElementById('closeManualPumpBtn').addEventListener('click', () => this.closeManualPump());
      document.getElementById('saveManualPumpBtn').addEventListener('click', () => this.saveManualPump());
      // Quick-duration chips (10 / 15 / 20 min) fill the typed duration field.
      manualPumpModal.querySelectorAll('#manualPumpDurationChips .chip-btn').forEach(chip => {
        chip.addEventListener('click', () => {
          const minutes = normalizePumpDuration(chip.dataset.min);
          if (minutes !== null) {
            document.getElementById('manualPumpDuration').value = String(minutes);
            sound.playChime('tick');
          }
        });
      });
      manualPumpModal.addEventListener('click', (e) => {
        if (e.target === manualPumpModal) this.closeManualPump();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && manualPumpModal.classList.contains('open')) this.closeManualPump();
      });
    }
  }

  // --- FEED FLOW SUBSYSTEM (guided bottom sheet + express press-and-hold) ---
  // Amounts are stored canonically in oz; display converts to the user's unit.
  _ffIsMl() {
    return this.settings.units === 'mL';
  }

  _ffToDisplay(oz) {
    return this._ffIsMl() ? Math.round(oz * 29.5735) : Math.round(oz * 10) / 10;
  }

  _ffToOz(displayVal) {
    return this._ffIsMl() ? displayVal / 29.5735 : displayVal;
  }

  _ffMaxDisplay() {
    return this._ffIsMl() ? 300 : 10;
  }

  _ffStepDisplay() {
    return this._ffIsMl() ? 5 : 0.1;
  }

  _ffAmtStr(oz) {
    const disp = this._ffToDisplay(oz);
    return this._ffIsMl() ? `${disp} mL` : `${disp.toFixed(1)} oz`;
  }

  initFeedFlow() {
    this.feedFlow = { step: 'type', type: null, amountOz: 4.0 };
    this._express = null;

    // Center button: quick tap -> guided flow, press-and-hold (~320ms) -> express
    const fab = document.getElementById('navQuickFeedBtn');
    if (fab) {
      let holdTimer = null;
      let holdFired = false;
      let downPos = null;
      fab.addEventListener('contextmenu', e => e.preventDefault());
      fab.addEventListener('pointerdown', e => {
        holdFired = false;
        downPos = { x: e.clientX, y: e.clientY };
        holdTimer = setTimeout(() => {
          holdFired = true;
          this._openExpressFeed();
        }, 320);
      });
      const cancelHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      };
      fab.addEventListener('pointermove', e => {
        if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 12) cancelHold();
      });
      fab.addEventListener('pointerup', () => {
        const wasHold = holdFired;
        cancelHold();
        downPos = null;
        if (!wasHold) this.switchTab('feed');
      });
      fab.addEventListener('pointercancel', () => { cancelHold(); downPos = null; });
    }

    const logBtn = document.getElementById('logFeedBtn');
    if (logBtn) logBtn.addEventListener('click', () => this.openFeedFlow());

    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.closeFeedFlow();
      });
    }
    const closeBtn = document.getElementById('ffCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeFeedFlow());
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) this.closeFeedFlow();
    });

    const fFormula = document.getElementById('ffTypeFormula');
    if (fFormula) fFormula.addEventListener('click', () => this._ffPickType('formula'));
    const fMilk = document.getElementById('ffTypeBreastmilk');
    if (fMilk) fMilk.addEventListener('click', () => this._ffPickType('breastmilk'));

    const slider = document.getElementById('ffAmountSlider');
    if (slider) slider.addEventListener('input', () => this._ffSetAmount(this._ffToOz(parseFloat(slider.value))));
    const hero = document.getElementById('ffAmountHero');
    if (hero) {
      hero.addEventListener('click', () => {
        this._amountInlineEdit('ffAmountInput', 'ffAmountValue',
          () => this._ffToDisplay(this.feedFlow.amountOz),
          v => this._ffSetAmount(this._ffToOz(v)));
      });
    }
    const backToType = document.getElementById('ffBackToType');
    if (backToType) backToType.addEventListener('click', () => this._ffShowStep('type'));
    const amountNext = document.getElementById('ffAmountNext');
    if (amountNext) amountNext.addEventListener('click', () => this._ffShowReview());

    const startTimerBtn = document.getElementById('ffStartTimerBtn');
    if (startTimerBtn) startTimerBtn.addEventListener('click', () => this._ffStartTimer());

    const backToAmount = document.getElementById('ffBackToAmount');
    if (backToAmount) backToAmount.addEventListener('click', () => this._ffShowStep('amount'));
    const confirmLog = document.getElementById('ffConfirmLog');
    if (confirmLog) confirmLog.addEventListener('click', () => this._ffConfirmLog());

    const doneBtn = document.getElementById('ffDoneBtn');
    if (doneBtn) doneBtn.addEventListener('click', () => this.closeFeedFlow());
  }

  openFeedFlow() {
    this.feedFlow = { step: 'type', type: null, amountOz: 4.0, sourceInventoryId: null };
    const fBtn = document.getElementById('ffTypeFormula');
    if (fBtn) fBtn.classList.remove('is-selected');
    const mBtn = document.getElementById('ffTypeBreastmilk');
    if (mBtn) mBtn.classList.remove('is-selected');
    this._ffSyncUnits();
    this._ffShowStep('type');
    this._ffRenderThawedSources();
    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) overlay.classList.add('open');
  }

  closeFeedFlow() {
    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) overlay.classList.remove('open');
    const pad = document.getElementById('ffExpressPad');
    if (pad) pad.hidden = true;
    this._express = null;
  }

  _ffShowStep(step) {
    this.feedFlow.step = step;
    const map = {
      type: 'ffStepType',
      amount: 'ffStepAmount',
      review: 'ffStepReview',
      success: 'ffStepSuccess'
    };
    Object.keys(map).forEach(key => {
      const el = document.getElementById(map[key]);
      if (el) el.classList.toggle('active', key === step);
    });
    const pad = document.getElementById('ffExpressPad');
    if (pad) pad.hidden = step !== 'express';
  }

  _ffPickType(type) {
    this.feedFlow.type = type;
    const fBtn = document.getElementById('ffTypeFormula');
    if (fBtn) fBtn.classList.toggle('is-selected', type === 'formula');
    const mBtn = document.getElementById('ffTypeBreastmilk');
    if (mBtn) mBtn.classList.toggle('is-selected', type === 'breastmilk');
    sound.playChime('tick');
    sound.vibrate([30]);
    // One tap locks the type in, then glide to the amount step
    setTimeout(() => {
      if (this.feedFlow.step === 'type') this._ffShowStep('amount');
    }, 220);
  }

  _ffSyncUnits() {
    const unit = this.settings.units;
    const unitEl = document.getElementById('ffAmountUnit');
    if (unitEl) unitEl.textContent = unit;
    this._ffBuildPresets('ffPresetRow', v => this._ffSetAmount(this._ffToOz(v)));
    this._ffRenderAmount();
  }

  _ffBuildPresets(rowId, onPick) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const unit = this.settings.units;
    row.innerHTML = '';
    feedPresets(unit).forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ff-preset-chip';
      b.dataset.val = String(p);
      b.textContent = `${p} ${unit}`;
      b.addEventListener('click', () => onPick(p));
      row.appendChild(b);
    });
  }

  _ffSetAmount(oz) {
    this.feedFlow.amountOz = clampAmount(oz, 0, 10, 0.1);
    this._ffRenderAmount();
    sound.vibrate([15]);
  }

  _ffRenderAmount() {
    const disp = this._ffToDisplay(this.feedFlow.amountOz);
    const valEl = document.getElementById('ffAmountValue');
    if (valEl) valEl.textContent = this._ffIsMl() ? String(disp) : disp.toFixed(1);
    const slider = document.getElementById('ffAmountSlider');
    if (slider) {
      slider.min = '0';
      slider.max = String(this._ffMaxDisplay());
      slider.step = String(this._ffStepDisplay());
      slider.value = String(disp);
    }
    const tol = this._ffIsMl() ? 1 : 0.05;
    document.querySelectorAll('#ffPresetRow .ff-preset-chip').forEach(chip => {
      chip.classList.toggle('active', Math.abs(parseFloat(chip.dataset.val) - disp) < tol);
    });
  }

  // Tap-the-number inline editor shared by feed flow + bottle timer.
  _amountInlineEdit(inputId, valueId, getDisplay, commit) {
    const input = document.getElementById(inputId);
    const valEl = document.getElementById(valueId);
    if (!input || !valEl) return;
    input.hidden = false;
    valEl.style.display = 'none';
    input.value = String(getDisplay());
    input.focus();
    input.select();
    let settled = false;
    const done = save => {
      if (settled) return;
      settled = true;
      if (save) commit(parseFloat(input.value));
      input.hidden = true;
      valEl.style.display = '';
    };
    input.onkeydown = e => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(true);
  }

  _ffShowReview() {
    const type = this.feedFlow.type || 'formula';
    const typeEl = document.getElementById('ffReviewType');
    if (typeEl) typeEl.textContent = type === 'formula' ? 'Formula' : 'Breast milk';
    const amtEl = document.getElementById('ffReviewAmount');
    if (amtEl) amtEl.textContent = this._ffAmtStr(this.feedFlow.amountOz);
    const timeEl = document.getElementById('ffReviewTime');
    if (timeEl) {
      timeEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    this._ffShowStep('review');
  }

  async _ffConfirmLog() {
    const type = this.feedFlow.type || 'formula';
    const qty = this._ffToDisplay(this.feedFlow.amountOz);
    await this.trackFood(type, qty);
    await this._consumeThawedSource(this.feedFlow.sourceInventoryId, this.feedFlow.amountOz);
    const line = document.getElementById('ffSuccessLine');
    if (line) {
      line.textContent = `${this._ffAmtStr(this.feedFlow.amountOz)} ${type === 'formula' ? 'Formula' : 'Breast milk'} logged ✓`;
    }
    await this.updateQuickFoodTally();
    this._ffShowStep('success');
  }

  // --- Express mode: press-and-hold the center button, slide without lifting.
  // Up/down picks formula vs breast milk (sticky lock), left/right sets ounces.
  _openExpressFeed() {
    this.feedFlow = { step: 'express', type: null, amountOz: 0, sourceInventoryId: null };
    this._express = { lockedType: null, moved: false };
    this._ffShowStep('express');
    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) overlay.classList.add('open');
    const pad = document.getElementById('ffExpressPad');
    if (!pad) return;
    sound.vibrate([40]);
    this._ffRenderExpressHud();

    const onMove = e => {
      const ex = this._express;
      if (!ex) return;
      const rect = pad.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      // Ignore jitter right around the touch point before a real move
      if (!ex.moved && Math.abs(nx - 0.5) < 0.06 && Math.abs(ny - 0.5) < 0.06) return;
      ex.moved = true;
      if (!ex.lockedType) {
        ex.lockedType = resolveLockedType(ny);
      } else if (shouldFlipType(ex.lockedType, ny)) {
        ex.lockedType = ex.lockedType === 'formula' ? 'breastmilk' : 'formula';
        sound.vibrate([25]);
      }
      this.feedFlow.type = ex.lockedType;
      this.feedFlow.amountOz = clampAmount(nx * 10, 0, 10, 0.1);
      this._ffRenderExpressHud();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const ex = this._express;
      this._express = null;
      if (!ex) return;
      // Lift at 0 oz (or no type) cancels — nothing logged
      if (this.feedFlow.amountOz <= 0 || !this.feedFlow.type) {
        this.closeFeedFlow();
        return;
      }
      this._ffShowReview();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  _ffRenderExpressHud() {
    const type = this.feedFlow.type;
    const typeEl = document.getElementById('ffLiveType');
    if (typeEl) typeEl.textContent = type === 'breastmilk' ? 'Breast milk' : 'Formula';
    const roEl = document.getElementById('ffLiveReadout');
    if (roEl) roEl.textContent = this._ffAmtStr(this.feedFlow.amountOz);
  }

  // --- Session logging primitive shared by feed flow + bottle timer ---
  async trackFood(feedType, volume, durationSec = 0, notes = null) {
    const now = Date.now();
    const unit = this.settings.units;
    const session = {
      id: newId('sess'),
      type: 'feed',
      feedType,
      startTime: now,
      endTime: now,
      durationSec,
      outputQty: volume,
      unit,
      notes: notes !== null && notes !== undefined
        ? notes
        : (feedType === 'formula' ? 'Formula Feeding' : 'Breast Milk Feeding'),
      createdAt: now
    };
    await db.addSession(session);
    sound.playChime('complete');
    sound.vibrate([100, 50, 100]);
    await this.renderTodayDashboard();
    await reminders.updateStatus();
    await this.updateQuickFoodTally();
    this.showFeedToast(feedType, volume);
    return session;
  }

  showFeedToast(feedType, volume) {
    const toast = document.getElementById('feedToast');
    if (!toast) return;

    const iconEl = document.getElementById('feedToastIcon');
    const titleEl = document.getElementById('feedToastTitle');
    const descEl = document.getElementById('feedToastDesc');

    const isFormula = feedType === 'formula';
    if (iconEl) iconEl.textContent = '✓';
    if (titleEl) titleEl.textContent = 'Feed Logged! ✓';
    if (descEl) {
      descEl.textContent = `${volume} ${this.settings.units} ${isFormula ? 'Formula' : 'Breast Milk'} recorded`;
    }

    toast.classList.add('show');
    clearTimeout(this._feedToastTimer);
    this._feedToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2600);
  }

  // Today's feed tally, shown on the feed-flow success step.
  async updateQuickFoodTally() {
    const sessions = await db.getSessions();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const todayFeeds = sessions.filter(s => s.type === 'feed' && s.startTime >= startOfToday);
    const totalVol = todayFeeds.reduce((acc, s) => acc + (s.outputQty || 0), 0);
    const unit = this.settings.units;
    const text = `${todayFeeds.length} feed${todayFeeds.length === 1 ? '' : 's'} • ${Math.round(totalVol * 10) / 10} ${unit} today`;
    const tallyEl = document.getElementById('ffSuccessTally');
    if (tallyEl) tallyEl.textContent = text;
    return text;
  }

  // --- BOTTLE TIMER SUBSYSTEM (live feed + per-type CDC safety countdown) ---
  // Survives backgrounding: the start timestamp persists in localStorage and
  // the display is recomputed from the wall clock on every tick / reload.
  initBottleTimer() {
    this.bottle = {
      active: false,
      startTs: null,
      feedType: 'formula',
      preparedOz: 4.0,
      eatenOz: 4.0,
      elapsedSec: 0,
      tickId: null,
      sourceInventoryId: null // thawed-stash pouch feeding from, if any
    };

    const overlay = document.getElementById('bottleOverlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        // Backdrop must not dismiss a live feed
        if (e.target === overlay && !this.bottle.active) this.closeBottleSheet();
      });
    }
    const closeBtn = document.getElementById('btCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (!this.bottle.active) this.closeBottleSheet();
      });
    }
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open') && !this.bottle.active) {
        this.closeBottleSheet();
      }
    });

    const tFormula = document.getElementById('btTypeFormula');
    if (tFormula) tFormula.addEventListener('click', () => this._btPickType('formula'));
    const tMilk = document.getElementById('btTypeBreastmilk');
    if (tMilk) tMilk.addEventListener('click', () => this._btPickType('breastmilk'));

    const slider = document.getElementById('btAmountSlider');
    if (slider) slider.addEventListener('input', () => this._btSetPrepared(this._ffToOz(parseFloat(slider.value))));
    const hero = document.getElementById('btAmountHero');
    if (hero) {
      hero.addEventListener('click', () => {
        this._amountInlineEdit('btAmountInput', 'btAmountValue',
          () => this._ffToDisplay(this.bottle.preparedOz),
          v => this._btSetPrepared(this._ffToOz(v)));
      });
    }
    const startTimerBtn = document.getElementById('btStartBtn');
    if (startTimerBtn) startTimerBtn.addEventListener('click', () => this.startBottleTimer());

    const stopBtn = document.getElementById('btStopBtn');
    if (stopBtn) stopBtn.addEventListener('click', () => this._btStopToReview());
    const cancelBtn = document.getElementById('btCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelBottleTimer());

    const eatenSlider = document.getElementById('btEatenSlider');
    if (eatenSlider) eatenSlider.addEventListener('input', () => this._btSetEaten(this._ffToOz(parseFloat(eatenSlider.value))));
    const eatenHero = document.getElementById('btEatenHero');
    if (eatenHero) {
      eatenHero.addEventListener('click', () => {
        this._amountInlineEdit('btEatenInput', 'btEatenValue',
          () => this._ffToDisplay(this.bottle.eatenOz),
          v => this._btSetEaten(this._ffToOz(v)));
      });
    }
    const backToLive = document.getElementById('btBackToLive');
    if (backToLive) {
      backToLive.addEventListener('click', () => {
        this._btShowStep('live');
        this._btStartTick();
      });
    }
    const logBtn = document.getElementById('btLogBtn');
    if (logBtn) logBtn.addEventListener('click', () => this._btConfirmLog());

    // Resume a live feed across reloads / backgrounding
    this._btRestore();
  }

  // The bottle-timer sheet is the "start bottle" half of the merged feed
  // action: it can be opened fresh or prefilled from the feed flow
  // (type, amount, and optional thawed-stash source).
  openBottleSetup(prefill = {}) {
    this.bottle.feedType = prefill.type === 'breastmilk' ? 'breastmilk' : 'formula';
    this.bottle.preparedOz = clampAmount(prefill.amountOz || 4.0, 0.5, 10, 0.1);
    this.bottle.sourceInventoryId = prefill.sourceInventoryId || null;
    this._btPickType(this.bottle.feedType);
    this._btBuildPresets();
    this._btRenderSetup();
    this._btShowStep('setup');
    const title = document.getElementById('btTitle');
    if (title) title.textContent = 'Start bottle';
    const overlay = document.getElementById('bottleOverlay');
    if (overlay) overlay.classList.add('open');
  }

  closeBottleSheet() {
    const overlay = document.getElementById('bottleOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  _btPickType(type) {
    this.bottle.feedType = type;
    const fBtn = document.getElementById('btTypeFormula');
    if (fBtn) fBtn.classList.toggle('is-selected', type === 'formula');
    const mBtn = document.getElementById('btTypeBreastmilk');
    if (mBtn) mBtn.classList.toggle('is-selected', type === 'breastmilk');
    sound.playChime('tick');
  }

  _btBuildPresets() {
    this._ffBuildPresets('btPresetRow', v => this._btSetPrepared(this._ffToOz(v)));
  }

  _btSetPrepared(oz) {
    this.bottle.preparedOz = clampAmount(oz, 0.5, 10, 0.1);
    this._btRenderSetup();
  }

  _btRenderSetup() {
    const disp = this._ffToDisplay(this.bottle.preparedOz);
    const valEl = document.getElementById('btAmountValue');
    if (valEl) valEl.textContent = this._ffIsMl() ? String(disp) : disp.toFixed(1);
    const unitEl = document.getElementById('btAmountUnit');
    if (unitEl) unitEl.textContent = this.settings.units;
    const slider = document.getElementById('btAmountSlider');
    if (slider) {
      slider.min = '0';
      slider.max = String(this._ffMaxDisplay());
      slider.step = String(this._ffStepDisplay());
      slider.value = String(disp);
    }
    const tol = this._ffIsMl() ? 1 : 0.05;
    document.querySelectorAll('#btPresetRow .ff-preset-chip').forEach(chip => {
      chip.classList.toggle('active', Math.abs(parseFloat(chip.dataset.val) - disp) < tol);
    });
  }

  startBottleTimer() {
    if (this.bottle.preparedOz <= 0 || this.bottle.active) return;
    this.bottle.active = true;
    this.bottle.startTs = Date.now();
    this.bottle.elapsedSec = 0;
    this.bottle.eatenOz = this.bottle.preparedOz;
    try {
      localStorage.setItem('nurture_bottle_timer', JSON.stringify({
        startTs: this.bottle.startTs,
        feedType: this.bottle.feedType,
        preparedOz: this.bottle.preparedOz
      }));
    } catch (e) {
      console.warn('Bottle timer persist failed:', e);
    }
    sound.playChime('tick');
    sound.vibrate([60]);
    const title = document.getElementById('btTitle');
    if (title) title.textContent = 'Live feed';
    this._btShowStep('live');
    this._btStartTick();
  }

  _btStartTick() {
    this._btStopTick();
    this._btTick();
    this.bottle.tickId = setInterval(() => this._btTick(), 1000);
  }

  _btStopTick() {
    if (this.bottle.tickId) {
      clearInterval(this.bottle.tickId);
      this.bottle.tickId = null;
    }
  }

  _btTick() {
    if (!this.bottle.active || !this.bottle.startTs) return;
    const st = getBottleTimerStatus(this.bottle.startTs, this.bottle.feedType, Date.now());
    this.bottle.elapsedSec = st.elapsedSec;

    const elapsedEl = document.getElementById('btElapsed');
    if (elapsedEl) elapsedEl.textContent = fmtClock(st.elapsedSec);

    const safetyEl = document.getElementById('btSafety');
    if (safetyEl) {
      if (st.expired) {
        safetyEl.textContent = "⏰ Time's up — start a fresh bottle";
        safetyEl.classList.add('is-expired');
      } else {
        safetyEl.textContent = `Good for ${fmtSafetyWindow(st.safetyRemainingSec)}`;
        safetyEl.classList.remove('is-expired');
      }
    }

    const fill = document.getElementById('btProgressFill');
    if (fill) {
      const pct = Math.max(0, Math.min(100, (st.safetyRemainingSec / st.windowSec) * 100));
      fill.style.width = `${pct}%`;
    }

    const meta = document.getElementById('btLiveMeta');
    if (meta) {
      const started = new Date(this.bottle.startTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      meta.textContent = `${this._ffAmtStr(this.bottle.preparedOz)} ${this.bottle.feedType === 'formula' ? 'Formula' : 'Breast milk'} • started ${started}`;
    }
  }

  _btShowStep(step) {
    const map = { setup: 'btStepSetup', live: 'btStepLive', review: 'btStepReview' };
    Object.keys(map).forEach(key => {
      const el = document.getElementById(map[key]);
      if (el) el.classList.toggle('active', key === step);
    });
  }

  _btStopToReview() {
    this._btStopTick();
    this._btTick(); // freeze final elapsed time
    this.bottle.eatenOz = this.bottle.preparedOz; // default: full bottle
    this._btRenderReview();
    const title = document.getElementById('btTitle');
    if (title) title.textContent = 'Review feed';
    this._btShowStep('review');
  }

  _btSetEaten(oz) {
    this.bottle.eatenOz = clampAmount(oz, 0, this.bottle.preparedOz, 0.1);
    this._btRenderReview();
  }

  _btRenderReview() {
    const disp = this._ffToDisplay(this.bottle.eatenOz);
    const valEl = document.getElementById('btEatenValue');
    if (valEl) valEl.textContent = this._ffIsMl() ? String(disp) : disp.toFixed(1);
    const unitEl = document.getElementById('btEatenUnit');
    if (unitEl) unitEl.textContent = this.settings.units;
    const slider = document.getElementById('btEatenSlider');
    if (slider) {
      slider.min = '0';
      slider.max = String(this._ffToDisplay(this.bottle.preparedOz));
      slider.step = String(this._ffStepDisplay());
      slider.value = String(disp);
    }
    const paceEl = document.getElementById('btPaceLine');
    if (paceEl) {
      const pace = paceOzPerMin(this.bottle.eatenOz, this.bottle.elapsedSec);
      const mins = Math.max(1, Math.round(this.bottle.elapsedSec / 60));
      paceEl.textContent = `Pace: ${pace} oz/min over ~${mins} min`;
    }
  }

  async _btConfirmLog() {
    const eatenOz = this.bottle.eatenOz !== undefined ? this.bottle.eatenOz : this.bottle.preparedOz;
    const qty = this._ffToDisplay(eatenOz);
    const note = `Bottle feed (${this._ffAmtStr(this.bottle.preparedOz)} prepared)`;
    await this.trackFood(this.bottle.feedType, qty, this.bottle.elapsedSec, note);
    await this._consumeThawedSource(this.bottle.sourceInventoryId, this.bottle.eatenOz);
    this._btClear();
    this.closeBottleSheet();
  }

  cancelBottleTimer() {
    if (!this.bottle.active) {
      this.closeBottleSheet();
      return;
    }
    if (!confirm('Cancel this bottle feed? Nothing will be logged.')) return;
    this._btClear();
    this.closeBottleSheet();
  }

  _btClear() {
    this._btStopTick();
    this.bottle.active = false;
    this.bottle.startTs = null;
    this.bottle.sourceInventoryId = null;
    try {
      localStorage.removeItem('nurture_bottle_timer');
    } catch (e) {
      console.warn('Bottle timer clear failed:', e);
    }
  }


  _btRestore() {
    try {
      const raw = localStorage.getItem('nurture_bottle_timer');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || !s.startTs || !s.feedType) return;
      this.bottle.active = true;
      this.bottle.startTs = s.startTs;
      this.bottle.feedType = s.feedType === 'breastmilk' ? 'breastmilk' : 'formula';
      this.bottle.preparedOz = s.preparedOz || 4.0;
      this.bottle.eatenOz = this.bottle.preparedOz;
      const title = document.getElementById('btTitle');
      if (title) title.textContent = 'Live feed';
      this._btShowStep('live');
      const overlay = document.getElementById('bottleOverlay');
      if (overlay) overlay.classList.add('open');
      this._btStartTick();
      } catch (e) {
      console.warn('Bottle timer restore failed:', e);
    }
  }

  // --- URGENT STRIPS (split by relevance: pump-overdue on the Pump tab;
  // thawed-milk-expiring / low-stash on the Feed tab, since those are what
  // you'd act on from that screen) ---
  async renderTodayUrgent() {
    const pumpCard = document.getElementById('pumpUrgentCard');
    const pumpRows = document.getElementById('pumpUrgentRows');
    const feedCard = document.getElementById('feedUrgentCard');
    const feedRows = document.getElementById('feedUrgentRows');
    if (!pumpCard || !pumpRows || !feedCard || !feedRows) return;

    const pumpItems = [];
    const feedItems = [];

    try {
      const sched = await reminders.calculateSchedule();
      if (sched.hasSession && (sched.status === 'overdue' || sched.status === 'due-soon')) {
        pumpItems.push({
          tone: sched.status === 'overdue' ? 'tone-overdue' : 'tone-warn',
          icon: ICON_SVG_CLOCK,
          text: sched.label
        });
      }
    } catch (e) {
      console.warn('Urgent strip: schedule check failed:', e);
    }

    try {
      const thawed = await inventory.getThawedItems();
      const urgent = thawed
        .map(i => ({ item: i, u: InventoryManager.getUrgency(i.expiresAt) }))
        .find(({ u }) => u.level === 'expired' || u.level === 'red' || u.level === 'yellow');
      if (urgent) {
        const disp = this._displayQty(urgent.item, this.settings.units);
        feedItems.push({
          tone: (urgent.u.level === 'expired' || urgent.u.level === 'red') ? 'tone-overdue' : 'tone-warn',
          icon: ICON_SVG_SNOWFLAKE,
          text: `Thawed milk: ${disp.qty} ${disp.qtyUnit} — ${urgent.u.label}`
        });
      }
    } catch (e) {
      console.warn('Urgent strip: thawed check failed:', e);
    }

    try {
      const summary = await inventory.getStashSummary();
      if (summary.totalOz < 12) {
        const disp = this._ffIsMl() ? Math.round(summary.totalOz * 29.5735) : summary.totalOz;
        feedItems.push({
          tone: 'tone-warn',
          icon: ICON_SVG_SNOWFLAKE,
          text: `Low stash: ${disp} ${this.settings.units} left`
        });
      }
    } catch (e) {
      console.warn('Urgent strip: stash check failed:', e);
    }

    const paint = (card, rows, items) => {
      if (items.length === 0) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      rows.innerHTML = items.map(i => `
        <div class="today-urgent-row ${i.tone}">
          <span class="today-urgent-icon" aria-hidden="true">${i.icon}</span>
          <span class="today-urgent-text">${i.text}</span>
        </div>`).join('');
    };
    paint(pumpCard, pumpRows, pumpItems);
    paint(feedCard, feedRows, feedItems);
  }
  initActivityFilter() {
    const filterChips = document.querySelectorAll('.activity-filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activityFilter = chip.dataset.filter || 'all';
        this.renderPumpsAccordion();
      });
    });
  }
}

const app = new App();
window.nurtureApp = app;

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
