// Onboarding flow controller — a one-page swipeable carousel. All slides
// live in the DOM at once, side by side in #onboardingTrack; this module
// scrolls that track and keeps the dots + card height in sync, rather than
// toggling display on separate full-page steps.
import { db } from './db.js';
import { sound } from './audio.js';
import { reminders } from './reminders.js';

// Save-to-home-screen leads, since installing is the highest-leverage thing
// a new visitor can do before they wander off. It's dropped from the
// carousel entirely (see showModal) when the app is already installed.
const SLIDE_IDS = ['obSlideInstall', 'obSlideWelcome', 'obSlideGoals', 'obSlideFeatures'];

export class OnboardingController {
  constructor(app) {
    this.app = app;
    this.state = null;
    this.slides = [];
    this.index = 0;
    this._scrollRaf = null;
  }

  showModal() {
    const modal = document.getElementById('onboardingModal');
    const track = document.getElementById('onboardingTrack');
    if (!modal || !track) return;

    const settings = this.app.settings;
    this.state = {
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

    // Nothing for the install slide to ask of someone already running the
    // installed app — drop it, and drop the now-meaningless Back button
    // on whichever slide ends up first.
    const installSlide = document.getElementById('obSlideInstall');
    const alreadyInstalled = !!(this.app.installPrompt && this.app.installPrompt.isStandalone());
    if (installSlide) installSlide.hidden = alreadyInstalled;
    const welcomeBack = document.getElementById('obBackFromWelcome');
    if (welcomeBack) welcomeBack.style.display = alreadyInstalled ? 'none' : '';

    this.slides = SLIDE_IDS.map((id) => document.getElementById(id)).filter((el) => el && !el.hidden);

    this.syncInstallSlide();
    this.renderDots();
    this.bindTrackScroll(track);

    modal.style.display = 'flex';
    this.goToSlide(0, { instant: true });
  }

  hideModal() {
    const modal = document.getElementById('onboardingModal');
    if (modal) modal.style.display = 'none';
  }

  renderDots() {
    const dotsWrap = document.getElementById('onboardingDots');
    if (!dotsWrap) return;
    dotsWrap.innerHTML = '';
    this.slides.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'step-dot' + (i === 0 ? ' active' : '');
      dot.dataset.index = String(i);
      dot.addEventListener('click', () => this.goToSlide(i));
      dotsWrap.appendChild(dot);
    });
  }

  updateDots(index) {
    const dotsWrap = document.getElementById('onboardingDots');
    if (!dotsWrap) return;
    dotsWrap.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
  }

  resizeViewport(index) {
    const viewport = document.getElementById('onboardingViewport');
    const slide = this.slides[index];
    if (!viewport || !slide) return;
    viewport.style.height = slide.scrollHeight + 'px';
  }

  // Dynamic greeting: re-read the names live rather than trusting whatever
  // was in this.state when the user first left the Welcome slide.
  refreshFinishGreeting() {
    const parentInput = document.getElementById('obParentNameInput');
    const babyInput = document.getElementById('obBabyNameInput');
    const p = (parentInput && parentInput.value.trim()) || '';
    const b = (babyInput && babyInput.value.trim()) || '';
    const finishTitle = document.getElementById('obFinishTitle');
    if (finishTitle) finishTitle.textContent = p ? `You're All Set, ${p}` : `You're All Set`;
    const finishSubtitle = document.getElementById('obFinishSubtitle');
    if (finishSubtitle) finishSubtitle.textContent = b ? `Ready to nurture ${b} with ease. Three quick tips:` : `Ready to nurture your little one with ease. Three quick tips:`;
  }

  setActiveIndex(index) {
    this.index = index;
    this.updateDots(index);
    this.resizeViewport(index);
    const slide = this.slides[index];
    if (slide && slide.id === 'obSlideFeatures') this.refreshFinishGreeting();
  }

  goToSlide(index, opts = {}) {
    const track = document.getElementById('onboardingTrack');
    if (!track || !this.slides.length) return;
    const clamped = Math.max(0, Math.min(index, this.slides.length - 1));
    const width = track.clientWidth;
    track.scrollTo({ left: clamped * width, behavior: opts.instant ? 'auto' : 'smooth' });
    this.setActiveIndex(clamped);
  }

  // Keeps dots + card height live while the user is mid-swipe, not just
  // when a swipe settles — the "dynamic" part of the carousel.
  bindTrackScroll(track) {
    if (track._onboardingScrollBound) return;
    track._onboardingScrollBound = true;
    track.addEventListener('scroll', () => {
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => {
        this._scrollRaf = null;
        const width = track.clientWidth || 1;
        const nearest = Math.round(track.scrollLeft / width);
        const clamped = Math.max(0, Math.min(nearest, this.slides.length - 1));
        this.setActiveIndex(clamped);
      });
    }, { passive: true });
  }

  // Reflects the real browser install prompt becoming available on the
  // install slide. Called on open, and again if `beforeinstallprompt`
  // fires late — after the modal is already showing.
  syncInstallSlide() {
    const native = document.getElementById('obInstallNative');
    const manual = document.getElementById('obInstallManual');
    if (!native || !manual) return;
    const hasNative = !!(this.app.installPrompt && this.app.installPrompt.deferredPrompt);
    native.hidden = !hasNative;
    manual.hidden = hasNative;
    if (this.slides.length) this.resizeViewport(this.index);
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
    const nextFromInstall = document.getElementById('obNextFromInstall');
    if (nextFromInstall) nextFromInstall.onclick = () => this.goToSlide(this.index + 1);

    const installNowBtn = document.getElementById('obInstallNowBtn');
    if (installNowBtn) {
      installNowBtn.onclick = async () => {
        const ip = this.app.installPrompt;
        if (!ip || !ip.deferredPrompt) return;
        ip.deferredPrompt.prompt();
        const { outcome } = await ip.deferredPrompt.userChoice;
        ip.deferredPrompt = null;
        ip.updateBannerVisibility();
        this.syncInstallSlide();
        if (outcome === 'accepted') this.goToSlide(this.index + 1);
      };
    }

    // Install slide's iOS/Android tabs
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
        this.resizeViewport(this.index);
      };
      tabAndroid.onclick = () => {
        tabAndroid.classList.add('active');
        tabIos.classList.remove('active');
        cardAndroid.style.display = 'flex';
        cardIos.style.display = 'none';
        this.resizeViewport(this.index);
      };
    }

    const backFromWelcome = document.getElementById('obBackFromWelcome');
    if (backFromWelcome) backFromWelcome.onclick = () => this.goToSlide(this.index - 1);
    const nextFromWelcome = document.getElementById('obNextFromWelcome');
    if (nextFromWelcome) nextFromWelcome.onclick = () => this.goToSlide(this.index + 1);

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

    const backFromGoals = document.getElementById('obBackFromGoals');
    if (backFromGoals) backFromGoals.onclick = () => this.goToSlide(this.index - 1);
    const nextFromGoals = document.getElementById('obNextFromGoals');
    if (nextFromGoals) nextFromGoals.onclick = () => this.goToSlide(this.index + 1);

    const backFromFeatures = document.getElementById('obBackFromFeatures');
    if (backFromFeatures) backFromFeatures.onclick = () => this.goToSlide(this.index - 1);
    const finishBtn = document.getElementById('obFinishBtn');
    if (finishBtn) finishBtn.onclick = () => this.finish();

    const skipBtn = document.getElementById('skipOnboardingBtn');
    if (skipBtn) skipBtn.onclick = () => this.finish();

    window.addEventListener('resize', () => {
      if (this.slides.length) this.goToSlide(this.index, { instant: true });
    });
  }
}
