// Browser tests: first-run onboarding, install prompt, offline/PWA, and layout on real phone sizes.
// Run: npm run test:e2e
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startHarness, withApp, openApp, goTab, seed, dbRead, openOverlays, eventually, ROOT, ready,
  PHONE, SMALL_PHONE, TABLET, HOUR,
} from './harness.js';
import { OVERLAYS, waitOverlayOpen } from './overlays.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const slideIndex = (page) => page.evaluate(() => nurtureApp.onboarding.index);
const slideCount = (page) => page.evaluate(() => nurtureApp.onboarding.slides.length);
// The active slide must be right AND stay right while the carousel animates. (The scroll handler used to
// read half-scrolled positions as "the person swiped back", so the dot flickered and quick taps were lost.)
const holdsAt = async (page, expected, ms = 600) => {
  const until = Date.now() + ms;
  do {
    assert.equal(await slideIndex(page), expected, 'the active slide bounced while the carousel was animating');
    await page.waitForTimeout(30);
  } while (Date.now() < until);
};
const obVisible = async (page) => (await openOverlays(page)).includes('onboardingModal');
const settingsReady = (page) => page.waitForFunction(async () => (await (await import('/js/db.js')).db.getSetting('onboarding_completed')) === true);
const fakeInstallPrompt = (page, outcome = 'accepted') => page.evaluate((o) => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; };
  e.userChoice = Promise.resolve({ outcome: o });
  window.dispatchEvent(e);
}, outcome);

// ================================================================ ONBOARDING ===
describe('first-run onboarding', () => {
  test('a brand-new visitor sees the welcome carousel; Continue / Back / dots / swiping all move between slides', async () => {
    await withApp(h, { onboarded: false }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.equal(await slideCount(page), 4);
      assert.equal(await page.locator('#onboardingDots .step-dot').count(), 4);
      assert.equal(await slideIndex(page), 0);

      await page.click('#obNextFromInstall');
      await holdsAt(page, 1);
      await page.click('#obBackFromWelcome');
      await holdsAt(page, 0);

      await page.locator('#onboardingDots .step-dot').nth(2).click();
      await holdsAt(page, 2);
      assert.ok(await page.evaluate(() => document.querySelectorAll('#onboardingDots .step-dot')[2].classList.contains('active')));

      await page.click('#obNextFromGoals');
      await holdsAt(page, 3);
      await page.click('#obBackFromFeatures');
      await holdsAt(page, 2);
      await page.click('#obBackFromGoals');
      await holdsAt(page, 1);

      // a real swipe = the track scrolls; dots and index must follow
      await page.evaluate(() => { const t = document.getElementById('onboardingTrack'); t.scrollTo({ left: t.clientWidth * 3, behavior: 'instant' }); });
      await page.waitForFunction(() => nurtureApp.onboarding.index === 3);
    });
  });

  test('Skip works from every slide, ends the tour and it never comes back on reload', async () => {
    await withApp(h, { onboarded: false }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      await page.click('#skipOnboardingBtn');
      assert.equal(await obVisible(page), false);
      await settingsReady(page);
      await page.reload(); await ready(page);
      assert.equal(await obVisible(page), false, 'should not reappear');
    });
    await withApp(h, async (page) => {
      for (let i = 0; i < 4; i++) {
        await goTab(page, 'settings'); await page.click('#replayTourBtn');
        await page.waitForSelector('#onboardingModal', { state: 'visible' });
        await page.locator('#onboardingDots .step-dot').nth(i).click();
        await page.click('#skipOnboardingBtn');
        assert.equal(await obVisible(page), false, `Skip on slide ${i}`);
      }
    });
  });

  test('finishing saves names, daily goal and pump interval — and they are still there after a reload', async () => {
    await withApp(h, { onboarded: false }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      await page.click('#obNextFromInstall');
      await page.fill('#obParentNameInput', 'Sav'); await page.fill('#obBabyNameInput', 'Clara');
      await page.click('#obNextFromWelcome');
      for (let i = 0; i < 6; i++) await page.click('#obGoalPlus');
      assert.equal(await page.inputValue('#obGoalInput'), '30');
      await page.click('#obIntervalChips .ob-chip[data-hours="2"]');
      await page.click('#obNextFromGoals');
      assert.match(await text(page, '#obFinishTitle'), /You're All Set, Sav/);
      await page.click('#obFinishBtn');
      assert.equal(await obVisible(page), false, 'modal closes immediately');
      await settingsReady(page);

      await page.reload(); await ready(page);
      assert.equal(await text(page, '#goalTargetValue'), '30', 'daily goal chosen in onboarding must stick');
      assert.equal(await text(page, '#appBrandName'), "Sav's.");
      assert.equal(await text(page, '#appBrandSubtitleText'), "Clara's Tracker");
      await goTab(page, 'settings');
      assert.equal(await page.inputValue('#settingIntervalSelect'), '120', 'the 2-hour pump interval must stick');
      assert.equal(await page.inputValue('#settingDailyGoalInput'), '30');
    });
  });

  test('the pump interval picked in onboarding actually drives the reminder schedule', async () => {
    await withApp(h, { onboarded: false }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      await page.locator('#onboardingDots .step-dot').nth(2).click();
      await page.click('#obIntervalChips .ob-chip[data-hours="2"]');
      await page.click('#obNextFromGoals'); await page.click('#obFinishBtn');
      await settingsReady(page);
      await seed.pump(page, { agoMs: 100 * 60000, durationMin: 15 }); // ended 85 minutes ago
      await page.waitForFunction(() => /Next pump in 35m/.test(document.getElementById('reminderLabel').textContent));
    });
  });

  test('already-installed app: the install slide is dropped, there is no dead Back button, and the last slide is reachable', async () => {
    await withApp(h, { onboarded: false, standalone: true }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.equal(await slideCount(page), 3);
      assert.equal(await page.isVisible('#obSlideInstall'), false);
      assert.equal(await page.isVisible('#obBackFromWelcome'), false, 'first slide must not offer Back');
      await page.click('#obNextFromWelcome'); await page.click('#obNextFromGoals');
      assert.ok(await page.isVisible('#obFinishBtn'));
      await page.click('#obFinishBtn');
      assert.equal(await obVisible(page), false);
    });
  });

  test('Replay Welcome Tour opens with the CURRENT settings, and skipping it changes nothing', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.fill('#settingDailyGoalInput', '30'); await page.press('#settingDailyGoalInput', 'Tab');
      await page.selectOption('#settingIntervalSelect', '240');
      await page.waitForTimeout(150);
      await page.click('#replayTourBtn');
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.equal(await slideIndex(page), 0, 'starts at the first slide');
      assert.equal(await page.inputValue('#obGoalInput'), '30');
      assert.equal(await page.getAttribute('#obIntervalChips .ob-chip.active', 'data-hours'), '4', 'the 4h chip should be highlighted');
      await page.click('#skipOnboardingBtn');
      await page.waitForTimeout(300);
      const s = await dbRead.settings(page);
      assert.equal(s.dailyGoalOz, 30);
      assert.equal(s.pumpIntervalMinutes, 240, 'skipping the tour must not reset the interval');
    });
  });

  test('replaying the tour in mL does not mislabel the goal as mL', async () => {
    await withApp(h, async (page) => {
      await page.click('#unitToggleBtn');
      await page.waitForFunction(() => document.getElementById('unitToggleBtn').textContent.trim() === 'mL');
      await goTab(page, 'settings'); await page.click('#replayTourBtn');
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.equal(await text(page, '#obUnitTag'), 'oz', 'the goal field is stored in ounces, so it must say so');
    });
  });

  test('install slide: iPhone / Android tabs switch the instructions', async () => {
    await withApp(h, { onboarded: false }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.ok(await page.isVisible('#guideIosCard'));
      await page.click('#tabInstallAndroid');
      assert.ok(await page.isVisible('#guideAndroidCard'));
      assert.equal(await page.isVisible('#guideIosCard'), false);
      await page.click('#tabInstallIos');
      assert.ok(await page.isVisible('#guideIosCard'));
    });
  });

  test('when the browser offers a real install prompt, the slide shows "Install Now" and it works', async () => {
    await withApp(h, { onboarded: false }, async (page) => {
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.equal(await page.isVisible('#obInstallNative'), false);
      await fakeInstallPrompt(page, 'accepted');
      assert.ok(await page.isVisible('#obInstallNative'));
      assert.equal(await page.isVisible('#obInstallManual'), false);
      await page.click('#obInstallNowBtn');
      await page.waitForFunction(() => window.__prompted === 1);
      await page.waitForFunction(() => nurtureApp.onboarding.index === 1);
    });
  });
});

// ======================================================= INSTALL PROMPT (banner) ===
describe('install banner with a native install prompt', () => {
  test('accepting it hides the banner for good', async () => {
    await withApp(h, async (page) => {
      await fakeInstallPrompt(page, 'accepted');
      await page.click('#installBannerCta');
      await page.waitForFunction(() => window.__prompted === 1);
      await page.waitForFunction(() => document.getElementById('installBanner').hidden === true);
      assert.equal(await page.isVisible('#installBanner'), false, 'banner must actually leave the screen');
    });
  });

  test('declining it falls back to the manual how-to guide', async () => {
    await withApp(h, async (page) => {
      await fakeInstallPrompt(page, 'dismissed');
      await page.click('#installBannerCta');
      await page.waitForSelector('#installGuideModal.open');
    });
  });

  test('once the app reports it was installed, the banner goes away', async () => {
    await withApp(h, async (page) => {
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
      assert.equal(await page.isVisible('#installBanner'), false);
    });
  });
});

// =================================================================== OFFLINE / PWA ===
describe('offline & installability', () => {
  test('the service worker caches the whole app shell and the app opens with no network', async () => {
    const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const listed = [...swSource.match(/ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/'\.(\/[^']*)'/g)].map((m) => m[1]);
    assert.ok(listed.length > 20, 'could not read the asset list from sw.js');

    // The worker's own font fetches bypass our network stub, so they hit the real (or absent) network.
    // Chromium reports those as URL-less "Failed to load resource" lines; any OTHER failing request still shows up by URL.
    const FONT_NOISE = [/fonts\.(googleapis|gstatic)\.com/, /Failed to load resource/];
    await withApp(h, { sw: true, clock: false, ignore: FONT_NOISE }, async (page) => {
      // The APP must register its worker by itself (we don't do it for it).
      await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length > 0, null, { timeout: 8000 })
        .catch(() => assert.fail('the app never registered its service worker, so offline mode cannot work'));
      // If ANY listed file 404s, cache.addAll() rejects, install fails, and the worker never activates.
      const activated = await page.evaluate(() => Promise.race([
        navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]));
      assert.ok(activated, 'service worker registered but never activated — a pre-cached file probably 404s');

      const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const cache = await caches.open(names[0]);
        return (await cache.keys()).map((r) => new URL(r.url).pathname);
      });
      for (const asset of listed) {
        assert.ok(cached.includes(asset), `service worker did not cache ${asset}`);
      }

      await page.context().setOffline(true);
      await page.reload();
      await ready(page);
      assert.ok(await page.isVisible('.bottom-nav'), 'the app must render with the network off');
      await goTab(page, 'settings');
      await page.context().setOffline(false);
    });
  });

  test('the manifest is installable: standalone, a start page that exists, and icons that load', async () => {
    await withApp(h, async (page) => {
      const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
      const res = await page.request.get(h.url + manifestHref);
      assert.equal(res.status(), 200);
      const m = await res.json();
      assert.equal(m.display, 'standalone');
      assert.equal((await page.request.get(new URL(m.start_url, h.url + manifestHref).href)).status(), 200, 'start_url');
      for (const icon of m.icons) {
        assert.equal((await page.request.get(new URL(icon.src, h.url + manifestHref).href)).status(), 200, `icon ${icon.src}`);
      }
      assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), 'needs 192 and 512 icons');
    });
  });
});

// ======================================================================= LAYOUT ===
describe('every sheet can be left on every screen size', () => {
  for (const [label, viewport] of [['small phone 320×568', SMALL_PHONE], ['phone 390×844', PHONE], ['tablet 768×1024', TABLET]]) {
    test(`${label}: the close button of every modal is on screen, unobstructed and works; Save/Start buttons are reachable`, async () => {
      await withApp(h, { viewport }, async (page) => {
        await seed.feed(page, { qty: 3 });
        for (const o of OVERLAYS) {
          await o.open(page);
          await waitOverlayOpen(page, o.id);
          await page.locator(o.exit).click({ trial: true }); // visible, enabled, not covered, scrolled into view
          if (o.primary) await page.locator(o.primary).click({ trial: true });
          await page.click(o.exit);
          assert.ok(!(await openOverlays(page)).includes(o.id), `${o.id} should close at ${label}`);
        }
      });
    });
  }

  test('nothing is pushed off the side at 320px wide, even with long notes and long names', async () => {
    await withApp(h, { viewport: SMALL_PHONE }, async (page) => {
      const long = 'W'.repeat(70);
      await seed.pump(page, { qty: 4, notes: long }); await seed.feed(page, { qty: 3, notes: long });
      await seed.pouch(page, { qty: 4, notes: long, location: 'freezer' });
      await goTab(page, 'settings');
      await page.fill('#settingParentNameInput', 'Wilhelmina-Alexandra'); await page.fill('#settingBabyNameInput', 'Maximiliana-Josephine');
      await page.click('#settingsPreferencesTitle');
      await page.waitForTimeout(200);
      for (const tab of ['pump', 'history', 'inventory', 'settings']) {
        await goTab(page, tab);
        const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
        assert.ok(o.scroll <= o.view, `${tab}: page is ${o.scroll}px wide in a ${o.view}px window (sideways scrolling)`);
      }
    });
  });

  test('the header keeps its one-row layout for normal names, and stacks the chips underneath (never off-screen) for names too long to share the row', async () => {
    const stacked = (page) => page.evaluate(() => document.querySelector('.app-header').classList.contains('is-stacked'));
    for (const [width, viewport] of [[320, SMALL_PHONE], [360, { width: 360, height: 740 }], [390, PHONE]]) {
      await withApp(h, { viewport }, async (page) => {
        assert.equal(await stacked(page), false, `${width}px: the default header must stay on one row, exactly as designed`);
        await goTab(page, 'settings');
        if (width >= 360) {
          await page.fill('#settingParentNameInput', 'Savannah'); await page.fill('#settingBabyNameInput', 'Clara');
          await page.click('#settingsPreferencesTitle');
          await eventually(async () => assert.match(await text(page, '#appBrandName'), /^Savannah's\./));
          assert.equal(await stacked(page), false, `${width}px: ordinary names must not trigger the stacked header`);
        }
        await page.fill('#settingParentNameInput', 'Wilhelmina-Alexandra'); await page.fill('#settingBabyNameInput', 'Maximiliana-Josephine');
        await page.click('#settingsPreferencesTitle');
        await eventually(async () => assert.match(await text(page, '#appBrandName'), /^Wilhelmina-Alexandra's\./));
        await eventually(async () => {
          const chips = await page.evaluate(() => ['#arcade-back', '#themeClockChip', '#unitToggleBtn'].map((sel) => {
            const b = document.querySelector(sel).getBoundingClientRect();
            return { sel, left: Math.round(b.left), right: Math.round(b.right) };
          }));
          for (const c of chips) assert.ok(c.left >= 0 && c.right <= width, `${width}px: ${c.sel} spans ${c.left}–${c.right}, which is off the screen`);
        });
      });
    }
  });

  test('the last control on every tab is not hidden behind the bottom nav (320×568)', async () => {
    await withApp(h, { viewport: SMALL_PHONE }, async (page) => {
      await seed.feed(page, { qty: 3 }); await seed.pump(page, { qty: 4 }); await seed.pouch(page, { qty: 4, location: 'freezer' });
      for (const tab of ['pump', 'history', 'inventory', 'settings']) {
        await goTab(page, tab);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(250);
        const r = await page.evaluate((t) => {
          const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
          const els = [...document.querySelectorAll(`#tab-${t} button, #tab-${t} a[href], #tab-${t} [data-action]`)]
            .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
          const last = els[els.length - 1];
          return { bottom: last.getBoundingClientRect().bottom, navTop: nav.top, what: last.id || last.className };
        }, tab);
        assert.ok(r.bottom <= r.navTop + 1, `${tab}: "${r.what}" ends at ${r.bottom} but the nav starts at ${r.navTop}`);
      }
    });
  });
});
