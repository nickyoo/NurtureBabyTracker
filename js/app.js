// Nurture — Master Application Orchestrator
import { db } from './db.js';
import { sound } from './audio.js';
import { timer } from './timer.js';
import { THAWED_LOCATION } from './inventory.js';
import { reminders } from './reminders.js';
import { OnboardingController } from './onboarding.js';
import { SettingsView } from './settingsView.js';
import { PumpTimerView } from './pumpTimerView.js';
import { InventoryView } from './inventoryView.js';
import { DashboardView } from './dashboardView.js';
import { FeedFlowController } from './feedFlow.js';
import { InstallPromptController } from './installPrompt.js';

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
    this.settingsView = new SettingsView(this);
    this.pumpTimerView = new PumpTimerView(this);
    this.inventoryView = new InventoryView(this);
    this.dashboardView = new DashboardView(this);
    this.feedFlow = new FeedFlowController(this);
    this.installPrompt = new InstallPromptController(this);
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
    this.inventoryView.initEvents();
    this.dashboardView.initEditSessionModal();
    this.bindGlobalActions();

    // 5. Initialize Core Subsystems
    await this.pumpTimerView.initEvents();
    await this.initReminders();
    await this.renderTodayDashboard();
    await this.renderInventory();
    await this.settingsView.initEvents();

    // 6. Quick Food Tracker Subsystem & Activity Filters
    this.feedFlow.initFeedFlow();
    this.feedFlow.initBottleTimer();
    this.initActivityFilter();

    // 7. Onboarding & First Launch check
    this.onboarding.initEvents();
    await this.checkFirstLaunch();

    // 8. Install-to-home-screen banner + guide modal
    this.installPrompt.initEvents();

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
    this.pumpTimerView.updateDisplay(timer.getDisplayData());
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

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });

    // Pump/History/Stash all show data that can change from any other tab
    // (a feed logged on Pump affects History's accordion and Stash's thaw
    // tile, etc.), so refresh both cross-cutting renders on any of the three.
    if (tabName === 'pump' || tabName === 'history' || tabName === 'inventory') {
      this.renderTodayDashboard();
      this.renderInventory();
    }
    if (tabName === 'settings') this.settingsView.renderForm();

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
        case 'edit-session': this.dashboardView.openEditSession(id); break;
        case 'delete-session': this.dashboardView.deleteSession(id); break;
        case 'toggle-older-history': this.dashboardView.toggleOlderHistory(); break;
        case 'toggle-pumps-accordion': this.dashboardView.toggleAccordion(); break;
        case 'thaw-item': this.inventoryView.thawItem(id); break;
        case 'mark-used': this.inventoryView.markUsedItem(id); break;
        case 'discard-item': this.inventoryView.discardItem(id); break;
        case 'open-feed-flow': this.feedFlow.openFeedFlow(); break;
        case 'open-manual-pump': this.pumpTimerView.openManualPump(); break;
        case 'pick-thawed-source': this.feedFlow.pickThawedSource(id); break;
        case 'switch-tab': this.switchTab(el.dataset.tab); break;
        case 'adjust-goal': this.adjustDailyGoal(parseFloat(el.dataset.delta)); break;
        case 'save-storage-windows': this.settingsView.saveStorageWindows(); break;
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

  // --- TIMER SUBSYSTEM (js/pumpTimerView.js — this.pumpTimerView) ---

  // --- MERGED PUMPS DASHBOARD (js/dashboardView.js — this.dashboardView) ---
  // Thin facade: many controllers call these two as a stable cross-cutting
  // refresh point after any session/settings change.
  renderTodayDashboard() {
    return this.dashboardView.renderAll();
  }

  updateBottleFillLevel() {
    return this.dashboardView.updateBottleFillLevel();
  }

  // --- INVENTORY SUBSYSTEM (js/inventoryView.js — this.inventoryView) ---
  // Thin facade: many controllers (settings, pump timer, feed flow, dashboard)
  // call app.renderInventory() as a stable cross-cutting refresh point.
  renderInventory() {
    return this.inventoryView.render();
  }

  // --- TODAY'S FEEDS TRACKER + THAW-FROM-STASH (js/dashboardView.js) ---
  renderFeedsTracker() {
    return this.dashboardView.renderFeedsTracker();
  }

  renderThawSection() {
    return this.dashboardView.renderThawSection();
  }

  // --- SETTINGS SUBSYSTEM (js/settingsView.js — this.settingsView) ---
  // --- MODAL DIALOGS: Add Milk (js/inventoryView.js), Edit Session (js/dashboardView.js) ---

  // --- FEED FLOW + BOTTLE TIMER (js/feedFlow.js — this.feedFlow) ---
  // Thin facade: called from many places (dashboard, pump timer, inventory).
  updateQuickFoodTally() {
    return this.feedFlow.updateQuickFoodTally();
  }

  // --- URGENT STRIPS + ACTIVITY FILTER (js/dashboardView.js) ---
  renderTodayUrgent() {
    return this.dashboardView.renderTodayUrgent();
  }

  initActivityFilter() {
    return this.dashboardView.initActivityFilter();
  }
}

const app = new App();
window.nurtureApp = app;

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
