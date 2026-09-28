// Onboarding flow controller — the 4-step welcome/setup wizard.
// Takes the main App instance so it can read/write shared settings and
// trigger the shared post-onboarding render, without owning that state
// itself: this module only knows about the wizard's own steps and inputs.
import { db } from './db.js';
import { sound } from './audio.js';
import { reminders } from './reminders.js';

export class OnboardingController {
  constructor(app) {
    this.app = app;
    this.state = null;
  }

  showModal() {
    const modal = document.getElementById('onboardingModal');
    if (!modal) return;
    const settings = this.app.settings;
    this.state = {
      step: 1,
      parentName: settings.parentName || '',
      babyName: (settings.babyName && settings.babyName.toLowerCase() !== 'baby') ? settings.babyName : '',
      goal: Number(settings.dailyGoalOz) || 24,
      interval: Number(settings.reminderIntervalHours) || 3,
      unit: settings.units || 'oz'
    };

    const parentInput = document.getElementById('obParentNameInput');
    const babyInput = document.getElementById('obBabyNameInput');
    if (parentInput) parentInput.value = this.state.parentName;
    if (babyInput) babyInput.value = this.state.babyName;

    const goalInput = document.getElementById('obGoalInput');
    const unitTag = document.getElementById('obUnitTag');
    if (goalInput) goalInput.value = this.state.goal;
    if (unitTag) unitTag.textContent = this.state.unit;

    this.setStep(1);
    modal.style.display = 'flex';
  }

  hideModal() {
    const modal = document.getElementById('onboardingModal');
    if (modal) modal.style.display = 'none';
  }

  setStep(step) {
    if (!this.state) {
      const settings = this.app.settings;
      this.state = {
        step: 1,
        parentName: settings.parentName || '',
        babyName: settings.babyName || '',
        goal: 24,
        interval: 3,
        unit: 'oz'
      };
    }

    // Read current names from Step 1 inputs if present
    const parentInput = document.getElementById('obParentNameInput');
    const babyInput = document.getElementById('obBabyNameInput');
    if (parentInput && parentInput.value.trim()) {
      this.state.parentName = parentInput.value.trim();
    }
    if (babyInput && babyInput.value.trim()) {
      this.state.babyName = babyInput.value.trim();
    }

    // Dynamic greeting update when entering Step 4
    if (step === 4) {
      const p = (this.state.parentName || '').trim();
      const b = (this.state.babyName || '').trim();
      const finishTitle = document.getElementById('obFinishTitle');
      if (finishTitle) finishTitle.textContent = p ? `You're All Set, ${p}` : `You're All Set`;
      const finishSubtitle = document.getElementById('obFinishSubtitle');
      if (finishSubtitle) finishSubtitle.textContent = b ? `Ready to nurture ${b} with ease. Three quick tips:` : `Ready to nurture your little one with ease. Three quick tips:`;
    }

    this.state.step = step;
    for (let i = 1; i <= 4; i++) {
      const stepEl = document.getElementById(`onboardingStep${i}`);
      const dotEl = document.getElementById(`dotStep${i}`);
      if (stepEl) stepEl.style.display = (i === step) ? 'block' : 'none';
      if (dotEl) {
        if (i === step) dotEl.classList.add('active');
        else dotEl.classList.remove('active');
      }
    }
  }

  async finish() {
    // 1. Immediately hide the modal so user is never stuck
    this.hideModal();

    // 2. Clean URL query string if ?reset=true was used
    if (window.location.search.includes('reset')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const settings = this.app.settings;
    try {
      const parentInput = document.getElementById('obParentNameInput');
      const babyInput = document.getElementById('obBabyNameInput');
      const pName = (parentInput && parentInput.value.trim()) || (this.state && this.state.parentName) || settings.parentName || '';
      const bName = (babyInput && babyInput.value.trim()) || (this.state && this.state.babyName) || settings.babyName || '';

      const goalInput = document.getElementById('obGoalInput');
      if (goalInput) {
        const val = parseFloat(goalInput.value);
        if (!isNaN(val) && val > 0) {
          this.state.goal = Math.round(val);
        }
      }

      const goalVal = (this.state && this.state.goal) || 24;
      const intervalVal = (this.state && this.state.interval) || 3;
      const unitVal = (this.state && this.state.unit) || 'oz';

      await db.setSetting('parentName', pName);
      await db.setSetting('babyName', bName);
      await db.setSetting('dailyPumpingGoal', goalVal);
      await db.setSetting('reminderIntervalHours', intervalVal);
      await db.setSetting('preferredUnit', unitVal);
      await db.setSetting('onboarding_completed', true);
      localStorage.setItem('onboarding_completed', 'true');

      settings.parentName = pName;
      settings.babyName = bName;
      settings.dailyGoalOz = goalVal;
      settings.reminderIntervalHours = intervalVal;
      settings.units = unitVal;

      this.app.updateNamesUI();

      const goalDisplayEl = document.getElementById('goalTargetValue');
      if (goalDisplayEl) goalDisplayEl.textContent = goalVal;
      const settingsGoalInput = document.getElementById('settingDailyGoalInput');
      if (settingsGoalInput) settingsGoalInput.value = goalVal;
      const settingsIntervalInput = document.getElementById('settingReminderInterval');
      if (settingsIntervalInput) settingsIntervalInput.value = intervalVal;
    } catch (e) {
      console.warn('Failed to save onboarding settings', e);
    }

    try {
      if (typeof sound.playMilestoneChime === 'function') {
        sound.playMilestoneChime();
      } else if (typeof sound.playChime === 'function') {
        sound.playChime('complete');
      }
    } catch (e) {
      // Ignore audio error
    }

    try {
      await this.app.renderTodayDashboard();
      reminders.init();
    } catch (e) {
      console.warn('Post-onboarding render warning', e);
    }
  }

  initEvents() {
    const next1 = document.getElementById('onboardingNextBtn1');
    if (next1) next1.onclick = () => this.setStep(2);

    const goalMinus = document.getElementById('obGoalMinus');
    const goalPlus = document.getElementById('obGoalPlus');
    const goalInput = document.getElementById('obGoalInput');
    if (goalMinus && goalInput) {
      goalMinus.onclick = () => {
        let v = parseInt(goalInput.value) || 24;
        if (v > 5) {
          goalInput.value = v - 1;
          this.state.goal = v - 1;
        }
      };
    }
    if (goalPlus && goalInput) {
      goalPlus.onclick = () => {
        let v = parseInt(goalInput.value) || 24;
        if (v < 120) {
          goalInput.value = v + 1;
          this.state.goal = v + 1;
        }
      };
    }

    const chipsWrap = document.getElementById('obIntervalChips');
    if (chipsWrap) {
      chipsWrap.querySelectorAll('.ob-chip').forEach(chip => {
        chip.onclick = () => {
          chipsWrap.querySelectorAll('.ob-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          if (this.state) {
            this.state.interval = parseFloat(chip.getAttribute('data-hours')) || 3;
          }
        };
      });
    }

    const back2 = document.getElementById('onboardingBackBtn2');
    if (back2) back2.onclick = () => this.setStep(1);
    const next2 = document.getElementById('onboardingNextBtn2');
    if (next2) next2.onclick = () => this.setStep(3);

    // Step 3 platform tabs (iPhone vs Android)
    const tabIos = document.getElementById('tabInstallIos');
    const tabAndroid = document.getElementById('tabInstallAndroid');
    const cardIos = document.getElementById('guideIosCard');
    const cardAndroid = document.getElementById('guideAndroidCard');
    if (tabIos && tabAndroid && cardIos && cardAndroid) {
      tabIos.onclick = () => {
        tabIos.classList.add('active');
        tabAndroid.classList.remove('active');
        cardIos.style.display = 'flex';
        cardAndroid.style.display = 'none';
      };
      tabAndroid.onclick = () => {
        tabAndroid.classList.add('active');
        tabIos.classList.remove('active');
        cardAndroid.style.display = 'flex';
        cardIos.style.display = 'none';
      };
    }

    const back3 = document.getElementById('onboardingBackBtn3');
    if (back3) back3.onclick = () => this.setStep(2);
    const next3 = document.getElementById('onboardingNextBtn3');
    if (next3) next3.onclick = () => this.setStep(4);

    const back4 = document.getElementById('onboardingBackBtn4');
    if (back4) back4.onclick = () => this.setStep(3);
    const finishBtn = document.getElementById('onboardingFinishBtn');
    if (finishBtn) finishBtn.onclick = () => this.finish();

    const skipBtn = document.getElementById('skipOnboardingBtn');
    if (skipBtn) skipBtn.onclick = () => this.finish();
  }
}
