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

/**
 * What the onboarding screen's choices become in the app's settings. Pure, so it's unit-tested.
 * `goal` is whole ounces, `interval` is hours between pumps (the chips offer 2 – 4 in half hours).
 * Keys match App.loadSettings() and the reminder engine — onboarding used to save its choices
 * under three other names that nothing ever read, so every answer was silently lost on reload.
 */
export function buildOnboardingSettings({ goal, interval } = {}) {
  const dailyGoalOz = Number.isFinite(goal) && goal > 0 ? Math.round(goal) : 24;
  const hours = Number.isFinite(interval) && interval > 0 ? interval : 3;
  return { dailyGoalOz, pumpIntervalMinutes: Math.round(hours * 60) };
}

export class OnboardingController {
  constructor(app) {
    this.app = app;
    this.state = null;
    this.slides = [];
    this.index = 0;
    this._scrollRaf = null;
    this._autoScrollTarget = null; // slide our own smooth scroll is heading to (null = none)
    this._autoScrollTimer = null;
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
      interval: (Number(settings.pumpIntervalMinutes) || 180) / 60
    };

    const parentInput = document.getElementById('obParentNameInput');
    const babyInput = document.getElementById('obBabyNameInput');
    if (parentInput) parentInput.value = this.state.parentName;
    if (babyInput) babyInput.value = this.state.babyName;

    // The goal is stored in ounces whatever the display unit is, and the field is labelled "oz".
    const goalInput = document.getElementById('obGoalInput');
    if (goalInput) goalInput.value = this.state.goal;

    // Highlight the interval that's actually set (replaying the tour used to always show "Every 3h").
    document.querySelectorAll('#obIntervalChips .ob-chip').forEach((chip) => {
      chip.classList.toggle('active', parseFloat(chip.dataset.hours) === this.state.interval);
    });

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

    // While OUR smooth scroll animates, the track passes through in-between positions. The scroll
    // listener must not read those as "the person swiped back": it made the progress dot (and the
    // card height) flicker backwards on every Continue tap, and a quick second tap then re-targeted
    // the same slide. Ignore scroll events until we arrive (or a safety timeout, then resync).
    clearTimeout(this._autoScrollTimer);
    this._autoScrollTarget = opts.instant ? null : clamped;
    if (!opts.instant) {
      this._autoScrollTimer = setTimeout(() => {
        this._autoScrollTarget = null;
        this.syncIndexFromScroll();
      }, 800);
    }

    track.scrollTo({ left: clamped * width, behavior: opts.instant ? 'auto' : 'smooth' });
    this.setActiveIndex(clamped);
  }

  // Which slide is the track actually showing right now?
  syncIndexFromScroll() {
    const track = document.getElementById('onboardingTrack');
    if (!track || !this.slides.length) return;
    const width = track.clientWidth || 1;
    const nearest = Math.round(track.scrollLeft / width);
    this.setActiveIndex(Math.max(0, Math.min(nearest, this.slides.length - 1)));
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
        if (this._autoScrollTarget !== null) {
          // Our own animation: hand control back to swipes only once we've arrived.
          const width = track.clientWidth || 1;
          if (Math.abs(track.scrollLeft - this._autoScrollTarget * width) <= 2) {
            this._autoScrollTarget = null;
            clearTimeout(this._autoScrollTimer);
          }
          return;
        }
        this.syncIndexFromScroll();
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

      const { dailyGoalOz, pumpIntervalMinutes } = buildOnboardingSettings(this.state || {});

      await db.setSetting('parentName', pName);
      await db.setSetting('babyName', bName);
      await db.setSetting('dailyGoalOz', dailyGoalOz);
      await db.setSetting('pumpIntervalMinutes', pumpIntervalMinutes);
      await db.setSetting('onboarding_completed', true);
      localStorage.setItem('onboarding_completed', 'true');

      settings.parentName = pName;
      settings.babyName = bName;
      settings.dailyGoalOz = dailyGoalOz;
      settings.pumpIntervalMinutes = pumpIntervalMinutes;

      this.app.updateNamesUI();

      // (the goal tile itself is repainted by renderTodayDashboard() below, in the right unit)
      const settingsGoalInput = document.getElementById('settingDailyGoalInput');
      if (settingsGoalInput) settingsGoalInput.value = dailyGoalOz;
      const settingsIntervalSelect = document.getElementById('settingIntervalSelect');
      if (settingsIntervalSelect) settingsIntervalSelect.value = String(pumpIntervalMinutes);
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
      await reminders.updateStatus();
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
