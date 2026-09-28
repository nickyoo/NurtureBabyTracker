// PWA install-prompt controller — banner on the Pump tab, Settings entry point,
// and the manual iOS/Android install-guide modal. Captures the native
// beforeinstallprompt event where the browser supports it (Chrome/Android) and
// falls back to the manual instructional modal everywhere else (iOS Safari).
const DISMISS_KEY = 'nurture_install_banner_dismissed';

export class InstallPromptController {
  constructor(app) {
    this.app = app;
    this.deferredPrompt = null;
  }

  isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  initEvents() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.updateBannerVisibility();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.hideBanner();
    });

    const banner = document.getElementById('installBanner');
    const cta = document.getElementById('installBannerCta');
    const dismiss = document.getElementById('installBannerDismiss');
    const settingsBtn = document.getElementById('settingsInstallBtn');
    const modal = document.getElementById('installGuideModal');
    const closeBtn = document.getElementById('installGuideCloseBtn');

    if (cta) {
      cta.addEventListener('click', async () => {
        if (this.deferredPrompt) {
          this.deferredPrompt.prompt();
          const { outcome } = await this.deferredPrompt.userChoice;
          this.deferredPrompt = null;
          if (outcome === 'accepted') {
            this.hideBanner();
            return;
          }
        }
        this.showGuideModal();
      });
    }

    if (dismiss) {
      dismiss.addEventListener('click', () => {
        localStorage.setItem(DISMISS_KEY, '1');
        this.hideBanner();
      });
    }

    if (settingsBtn) settingsBtn.addEventListener('click', () => this.showGuideModal());

    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('open');
      });
    }

    const tabIos = document.getElementById('tabGuideIos');
    const tabAndroid = document.getElementById('tabGuideAndroid');
    const cardIos = document.getElementById('guideIosCard2');
    const cardAndroid = document.getElementById('guideAndroidCard2');
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

    this.updateBannerVisibility();
  }

  showGuideModal() {
    const modal = document.getElementById('installGuideModal');
    if (modal) modal.classList.add('open');
  }

  hideBanner() {
    const banner = document.getElementById('installBanner');
    if (banner) banner.hidden = true;
  }

  updateBannerVisibility() {
    const banner = document.getElementById('installBanner');
    if (!banner) return;
    const dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    banner.hidden = this.isStandalone() || dismissed;
  }
}
