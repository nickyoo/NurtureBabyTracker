// Browser tests: app shell, navigation, install banner, and the Pump tab.
// Run: npm run test:e2e
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, withApp, goTab, seed, dbRead, openOverlays, eventually, HOUR } from './harness.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

const TABS = ['pump', 'history', 'inventory', 'settings'];
const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains('open'), id);
// Unit/theme switches await IndexedDB before they repaint — always wait for the repaint, never assume it.
const waitUnit = (page, unit) => page.waitForFunction((u) => document.getElementById('unitToggleBtn').textContent.trim() === u, unit);
const hiddenLeaks = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[hidden]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.className || e.tagName));

// ===================================================================== SHELL ===
describe('navigation & header', () => {
  test('each tab shows exactly its own pane and highlights its nav button', async () => {
    await withApp(h, async (page) => {
      for (const tab of [...TABS, 'pump']) {
        await goTab(page, tab);
        const s = await page.evaluate(() => ({
          panes: [...document.querySelectorAll('.tab-pane.active')].map((p) => p.id),
          nav: [...document.querySelectorAll('.nav-item.active')].map((b) => b.dataset.tab),
        }));
        assert.deepEqual(s.panes, [`tab-${tab}`]);
        assert.deepEqual(s.nav, [tab]);
        assert.ok(await page.isVisible(`#tab-${tab}`), `${tab} pane should be visible`);
      }
    });
  });

  for (const tab of TABS) {
    test(`Quick Feed button opens the feed flow from the ${tab} tab (and ✕ closes it)`, async () => {
      await withApp(h, async (page) => {
        await goTab(page, tab);
        await page.click('#quickFeedFab');
        await page.waitForSelector('#feedFlowOverlay.open');
        assert.ok(await page.isVisible('#ffStepType.active'), 'should land on the type step');
        await page.click('#ffCloseBtn');
        assert.deepEqual(await openOverlays(page), []);
      });
    });
  }

  test('header unit toggle flips oz↔mL everywhere, the Settings select follows, and it persists', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { qty: 4 });
      await page.click('#unitToggleBtn');
      await waitUnit(page, 'mL');
      await goTab(page, 'inventory');
      assert.match(await page.textContent('#stashTotalVolume'), /^\d+ mL$/);
      await goTab(page, 'settings');
      assert.equal(await page.inputValue('#settingUnitSelect'), 'mL', 'Settings → Display Units must show the unit the header chip just set');
      await page.selectOption('#settingUnitSelect', 'oz');
      await waitUnit(page, 'oz');
      await page.click('#unitToggleBtn');
      await waitUnit(page, 'mL');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.equal((await page.textContent('#unitToggleBtn')).trim(), 'mL', 'unit choice survives a reload');
    });
  });

  test('theme chip cycles auto → light → dark → auto and the Settings select follows', async () => {
    await withApp(h, async (page) => {
      const read = () => page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        label: document.getElementById('themeClockLabel').textContent,
        select: document.getElementById('settingThemeSelect').value,
      }));
      const click = async (label) => {
        await page.click('#themeClockChip');
        await page.waitForFunction((l) => document.getElementById('themeClockLabel').textContent.startsWith(l), label);
        return read();
      };
      let s = await read();
      assert.equal(s.theme, null, 'auto at 10am is the light theme');
      assert.equal(s.select, 'auto');
      s = await click('Light');
      assert.deepEqual([s.theme, s.select, s.label], [null, 'light', 'Light']);
      s = await click('Night');
      assert.deepEqual([s.theme, s.select, s.label], ['dark', 'dark', 'Night']);
      s = await click('Day');
      assert.deepEqual([s.theme, s.select], [null, 'auto']);
      await goTab(page, 'settings');
      await page.selectOption('#settingThemeSelect', 'dark');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    });
  });

  test('auto theme switches to night after 7pm on its own', async () => {
    await withApp(h, async (page) => {
      assert.equal(await page.getAttribute('html', 'data-theme'), null);
      await page.clock.fastForward(9.5 * HOUR); // 10:00 → 19:30
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    });
  });

  test('the top reminder button jumps to the Pump tab and starts the timer', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      assert.match(await page.textContent('#reminderActionBtn'), /Start First/);
      await page.click('#reminderActionBtn');
      await page.waitForSelector('#tab-pump.active');
      assert.match(await page.textContent('#timerStatusText'), /in Progress/);
    });
  });

  test('the arcade back link points somewhere that exists', async () => {
    await withApp(h, async (page) => {
      const href = await page.getAttribute('#arcade-back', 'href');
      assert.ok(href && href !== '#', 'needs a real href');
      const res = await page.request.get(await page.evaluate(() => document.getElementById('arcade-back').href));
      assert.equal(res.status(), 200);
    });
  });

  test('every link on every tab goes somewhere real (in-page anchors resolve, same-origin links return 200)', async () => {
    await withApp(h, async (page) => {
      for (let i = 0; i < 7; i++) await seed.pouch(page, { location: 'freezer', agoMs: (10 + i) * 24 * HOUR });
      for (const tab of TABS) {
        await goTab(page, tab);
        const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), abs: a.href })));
        for (const l of links) {
          if (l.href.startsWith('#')) {
            assert.ok(await page.evaluate((id) => !!document.getElementById(id), l.href.slice(1)), `${tab}: anchor ${l.href} has no target`);
          } else if (l.abs.startsWith(h.url)) {
            assert.equal((await page.request.get(l.abs)).status(), 200, `${tab}: ${l.href} is a dead link`);
          }
        }
      }
      // the "+N more" link specifically (it's the one generated link)
      await goTab(page, 'inventory');
      assert.ok(await page.isVisible('#thawMoreLine a'), 'with 7 frozen pouches the "+1 more" link should render');
      await page.click('#thawMoreLine a');
      assert.ok(await page.evaluate(() => location.hash === '#inventoryListContainer'));
    });
  });
});

// ============================================================ INSTALL BANNER ===
describe('install banner & guide', () => {
  test('shows in a normal browser tab', async () => {
    await withApp(h, async (page) => {
      assert.ok(await page.isVisible('#installBanner'));
    });
  });

  test('Dismiss actually hides it, and it stays hidden after a reload', async () => {
    await withApp(h, async (page) => {
      await page.click('#installBannerDismiss');
      assert.equal(await page.isVisible('#installBanner'), false, 'banner must disappear when dismissed');
      assert.deepEqual(await hiddenLeaks(page), [], 'elements with [hidden] must not be displayed');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.equal(await page.isVisible('#installBanner'), false, 'dismissal must be remembered');
    });
  });

  test('is not shown when the app is already installed (standalone)', async () => {
    await withApp(h, { standalone: true }, async (page) => {
      assert.equal(await page.isVisible('#installBanner'), false, 'installed users should not be asked to install');
      assert.deepEqual(await hiddenLeaks(page), []);
    });
  });

  test('Install opens the manual guide; its tabs switch; every way out works', async () => {
    await withApp(h, async (page) => {
      const open = async () => { await page.click('#installBannerCta'); await page.waitForSelector('#installGuideModal.open'); };
      await open();
      assert.ok(await page.isVisible('#guideIosCard2'));
      await page.click('#tabGuideAndroid');
      assert.ok(await page.isVisible('#guideAndroidCard2'));
      assert.equal(await page.isVisible('#guideIosCard2'), false);
      await page.click('#tabGuideIos');
      assert.ok(await page.isVisible('#guideIosCard2'));

      await page.click('#installGuideCloseBtn');
      assert.equal(await isOpen(page, 'installGuideModal'), false, '"Got it" closes it');

      await open(); await page.mouse.click(5, 5);
      assert.equal(await isOpen(page, 'installGuideModal'), false, 'tapping outside closes it');

      await open(); await page.keyboard.press('Escape');
      assert.equal(await isOpen(page, 'installGuideModal'), false, 'Escape closes it');
    });
  });

  test('Settings → Save to Home Screen opens the same guide', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.click('#settingsInstallBtn');
      await page.waitForSelector('#installGuideModal.open');
      await page.click('#installGuideCloseBtn');
    });
  });
});

// ================================================================ PUMP TIMER ===
describe('pump timer', () => {
  test('Start → ticks → Finish & Save logs one session (duration + stash) and resets the tile', async () => {
    await withApp(h, async (page) => {
      await page.click('#mainTimerBtn');
      assert.match(await page.textContent('#timerStatusText'), /in Progress/);
      assert.ok(await page.isVisible('#cancelTimerBtn'), 'Discard Timer appears while running');
      await page.clock.fastForward(125 * 1000);
      await page.waitForFunction(() => /^02:0[5-9]$/.test(document.getElementById('timerDigits').textContent));
      await page.click('.chip-btn[data-delta="1.0"]'); // 3.5 → 4.5
      assert.match(await page.textContent('#mainTimerBtn'), /Finish & Save \(4\.5 oz\)/);
      await page.click('#mainTimerBtn');
      await page.waitForFunction(() => /Start Pumping/.test(document.getElementById('mainTimerBtn').textContent));

      const sessions = await dbRead.sessions(page);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].type, 'pump');
      assert.equal(sessions[0].outputQty, 4.5);
      assert.equal(sessions[0].unit, 'oz');
      assert.ok(sessions[0].durationSec >= 125 && sessions[0].durationSec < 135, `duration ${sessions[0].durationSec}`);
      const stash = await dbRead.inventory(page);
      assert.equal(stash.length, 1, 'auto-saved to the stash');
      assert.equal(stash[0].location, 'fridge');
      assert.equal(stash[0].quantity, 4.5);

      assert.equal(await page.isVisible('#cancelTimerBtn'), false);
      assert.equal((await page.textContent('#timerDigits')).trim(), '00:00');
      assert.equal((await page.textContent('#pumpTrackerNum')).trim(), '1');
    });
  });

  test('"Don\'t store in stash" saves the session but creates no pouch', async () => {
    await withApp(h, async (page) => {
      await page.selectOption('#stashDestSelect', 'none');
      await page.click('#mainTimerBtn');
      await page.click('#mainTimerBtn');
      await page.waitForFunction(() => /Start Pumping/.test(document.getElementById('mainTimerBtn').textContent));
      assert.equal((await dbRead.sessions(page)).length, 1);
      assert.equal((await dbRead.inventory(page)).length, 0);
    });
  });

  test('a running timer survives a reload', async () => {
    await withApp(h, async (page) => {
      await page.click('#mainTimerBtn');
      await page.clock.fastForward(90 * 1000);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.match(await page.textContent('#timerStatusText'), /in Progress/);
      assert.match(await page.textContent('#timerDigits'), /^01:/);
    });
  });

  test('Discard Timer: cancelling the prompt keeps it, confirming throws it away (nothing saved)', async () => {
    await withApp(h, async (page) => {
      await page.click('#mainTimerBtn');
      page.answerDialogs(false);
      await page.click('#cancelTimerBtn');
      assert.match(await page.textContent('#timerStatusText'), /in Progress/, 'declined → still running');
      page.answerDialogs(true);
      await page.click('#cancelTimerBtn');
      await page.waitForFunction(() => /Ready/.test(document.getElementById('timerStatusText').textContent));
      assert.equal((await dbRead.sessions(page)).length, 0);
    });
  });

  test('output stepper: − + and chips change the amount; it never goes to zero or NaN', async () => {
    await withApp(h, async (page) => {
      const val = async () => (await page.textContent('#stepperPumpVal')).trim();
      assert.equal(await val(), '3.5');
      await page.click('#pumpPlusBtn'); assert.equal(await val(), '4.0');
      await page.click('#pumpMinusBtn'); await page.click('#pumpMinusBtn'); assert.equal(await val(), '3.0');
      for (const [d, want] of [['0.5', '3.5'], ['1.0', '4.5'], ['2.0', '6.5'], ['3.0', '9.5']]) {
        await page.click(`.chip-btn[data-delta="${d}"]`);
        assert.equal(await val(), want, `chip +${d}`);
      }
      for (let i = 0; i < 30; i++) await page.click('#pumpMinusBtn');
      const floor = parseFloat(await val());
      assert.ok(floor > 0 && floor < 1, `floor should stay positive, got ${floor}`);
    });
  });

  test('output stepper: tap the number to type — Enter and blur commit, Escape and junk are ignored', async () => {
    await withApp(h, async (page) => {
      const val = async () => (await page.textContent('#stepperPumpVal')).trim();
      await page.click('#stepperValDisplay');
      assert.ok(await page.isVisible('#stepperPumpInput'));
      await page.fill('#stepperPumpInput', '6.5'); await page.keyboard.press('Enter');
      assert.equal(await val(), '6.5');
      assert.ok(await page.isVisible('#stepperPumpVal'), 'number display comes back');

      await page.click('#stepperValDisplay'); await page.fill('#stepperPumpInput', '9'); await page.keyboard.press('Escape');
      assert.equal(await val(), '6.5', 'Escape cancels');

      await page.click('#stepperValDisplay'); await page.fill('#stepperPumpInput', ''); await page.keyboard.press('Enter');
      assert.equal(await val(), '6.5', 'empty is ignored, display restored');

      await page.click('#stepperValDisplay'); await page.fill('#stepperPumpInput', '7.2'); await page.click('#timerDigits');
      assert.equal(await val(), '7.2', 'tapping elsewhere commits');
    });
  });
});

// ==================================================================== mL MODE ===
describe('mL mode', () => {
  test('timed pump: the number on the Finish button is what gets saved, in the unit shown', async () => {
    await withApp(h, async (page) => {
      await page.click('#unitToggleBtn'); // → mL
      await waitUnit(page, 'mL');
      await page.click('#mainTimerBtn');
      const label = (await page.textContent('#mainTimerBtn')).replace(/\s+/g, ' ');
      const shown = Number(/\((\d+) mL\)/.exec(label)?.[1]);
      assert.ok(shown >= 50, `expected a realistic mL amount on the button, got "${label}"`);
      await page.click('#mainTimerBtn');
      await page.waitForFunction(() => /Start Pumping/.test(document.getElementById('mainTimerBtn').textContent));
      const [s] = await dbRead.sessions(page);
      assert.equal(s.unit, 'mL');
      assert.equal(s.outputQty, shown, 'saved quantity must equal what the button promised');
      const [item] = await dbRead.inventory(page);
      assert.equal(item.unit, 'mL');
      assert.equal(item.quantity, shown, 'stash pouch gets the same amount');
    });
  });

  test('the +0.5/+1/+2/+3 chips scale to mL instead of adding a few drops', async () => {
    await withApp(h, async (page) => {
      await page.click('#unitToggleBtn');
      await waitUnit(page, 'mL');
      const val = async () => Number((await page.textContent('#stepperPumpVal')).trim());
      const start = await val();
      await page.click('.chip-btn[data-delta="1.0"]');
      const after = await val();
      assert.ok(after - start >= 20, `"+1.0" should add about an ounce of mL, added ${after - start}`);
    });
  });

  test('chip labels show the unit-correct amounts', async () => {
    await withApp(h, async (page) => {
      const labels = () => page.$$eval('.chip-btn[data-delta]', (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(await labels(), ['+0.5', '+1.0', '+2.0', '+3.0']);
      await page.click('#unitToggleBtn');
      await waitUnit(page, 'mL');
      const ml = (await labels()).map((t) => Number(t.replace('+', '')));
      assert.ok(ml.every((n, i) => i === 0 || n > ml[i - 1]) && ml[0] >= 10, `mL chip labels look wrong: ${ml}`);
    });
  });
});

// ============================================================== MANUAL PUMP ===
describe('log a pump manually', () => {
  const open = async (page) => { await page.click('#manualPumpBtn'); await page.waitForSelector('#manualPumpModal.open'); };

  test('validates, saves the session + stash pouch, and updates the tracker', async () => {
    await withApp(h, async (page) => {
      await open(page);
      assert.equal(await page.inputValue('#manualPumpTime'), '2026-10-04T10:00', 'time defaults to now');

      await page.click('#saveManualPumpBtn');
      assert.match(page.probe.dialogs.at(-1).message, /valid amount/i);
      assert.ok(await isOpen(page, 'manualPumpModal'), 'stays open after a validation error');

      await page.fill('#manualPumpQty', '4.5');
      await page.click('#saveManualPumpBtn');
      assert.match(page.probe.dialogs.at(-1).message, /valid duration/i);

      await page.fill('#manualPumpDuration', '18');
      await page.fill('#manualPumpNotes', 'left side');
      await page.selectOption('#manualPumpDest', 'freezer');
      await page.click('#saveManualPumpBtn');
      await page.waitForFunction(() => !document.getElementById('manualPumpModal').classList.contains('open'));

      const [s] = await dbRead.sessions(page);
      assert.deepEqual([s.type, s.outputQty, s.durationSec, s.notes], ['pump', 4.5, 18 * 60, 'left side']);
      const [item] = await dbRead.inventory(page);
      assert.deepEqual([item.location, item.quantity], ['freezer', 4.5]);
      assert.equal((await page.textContent('#pumpTrackerNum')).trim(), '1');
      assert.match(await page.textContent('#pumpTrackerSub'), /1 session today/);
    });
  });

  test('the 10 / 15 / 20 minute chips fill the field and do NOT disturb the pump stepper', async () => {
    await withApp(h, async (page) => {
      const stepper = async () => (await page.textContent('#stepperPumpVal')).trim();
      const before = await stepper();
      await open(page);
      for (const m of ['10', '15', '20']) {
        await page.click(`#manualPumpDurationChips .chip-btn[data-min="${m}"]`);
        assert.equal(await page.inputValue('#manualPumpDuration'), m);
      }
      await page.click('#closeManualPumpBtn');
      assert.equal(await stepper(), before, 'the timer tile behind the modal must be untouched');
      await page.click('#pumpPlusBtn');
      assert.notEqual(await stepper(), 'NaN', '"+" must still work');
      assert.equal(parseFloat(await stepper()), parseFloat(before) + 0.5);
    });
  });

  test('every way out works: Cancel, tapping outside, Escape — and reopening starts clean', async () => {
    await withApp(h, async (page) => {
      await open(page); await page.fill('#manualPumpQty', '7');
      await page.click('#closeManualPumpBtn');
      assert.equal(await isOpen(page, 'manualPumpModal'), false);
      await open(page);
      assert.equal(await page.inputValue('#manualPumpQty'), '', 'fields reset on reopen');
      await page.mouse.click(5, 5);
      assert.equal(await isOpen(page, 'manualPumpModal'), false, 'tap outside');
      await open(page); await page.keyboard.press('Escape');
      assert.equal(await isOpen(page, 'manualPumpModal'), false, 'Escape');
      assert.equal((await dbRead.sessions(page)).length, 0, 'nothing was saved');
    });
  });

  test('the "Track pumping" big button opens the same modal', async () => {
    await withApp(h, async (page) => {
      await page.click('#pumpTrackerQuickBtn');
      await page.waitForSelector('#manualPumpModal.open');
    });
  });
});

// ======================================================================= GOAL ===
describe('daily goal', () => {
  const target = async (page) => (await page.textContent('#goalTargetValue')).trim();

  test('± buttons, tap-to-type, Escape — and the choice survives a reload', async () => {
    await withApp(h, async (page) => {
      assert.equal(await target(page), '24');
      await page.click('[data-action="adjust-goal"][data-delta="1"]');
      await page.waitForFunction(() => document.getElementById('goalTargetValue').textContent.trim() === '25');
      for (let i = 0; i < 3; i++) await page.click('[data-action="adjust-goal"][data-delta="-1"]');
      await page.waitForFunction(() => document.getElementById('goalTargetValue').textContent.trim() === '22');

      await page.click('#goalTargetValue');
      assert.ok(await page.isVisible('#goalTargetInput'));
      await page.fill('#goalTargetInput', '30'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('goalTargetValue').textContent.trim() === '30');

      await page.click('#goalTargetValue'); await page.fill('#goalTargetInput', '99'); await page.keyboard.press('Escape');
      assert.equal(await target(page), '30', 'Escape cancels');

      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.equal(await target(page), '30');
    });
  });

  test('the − button stops at 4 instead of going to zero or negative', async () => {
    await withApp(h, async (page) => {
      for (let i = 0; i < 30; i++) await page.click('[data-action="adjust-goal"][data-delta="-1"]');
      await page.waitForFunction(() => document.getElementById('goalTargetValue').textContent.trim() === '4');
    });
  });

  test('progress pill and bottle respond to logged pumps; hitting the goal celebrates', async () => {
    await withApp(h, async (page) => {
      assert.match(await page.textContent('#goalBadgePill'), /^0% Goal/);
      await seed.pump(page, { qty: 12, agoMs: 2 * HOUR });
      assert.match(await page.textContent('#goalBadgePill'), /^50% Goal/);
      assert.match(await page.textContent('#goalSubtext'), /12 oz remaining/);
      await seed.pump(page, { qty: 12, agoMs: 1 * HOUR });
      assert.match(await page.textContent('#goalBadgePill'), /Goal Achieved/);
      assert.ok(await page.evaluate(() => document.getElementById('goalBottleTile').classList.contains('goal-reached')));
    });
  });
});

// ============================================================== SCHEDULE ===
describe('pump schedule banner', () => {
  test('follows the interval setting: upcoming → overdue', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { agoMs: 100 * 60000, durationMin: 15 }); // ended 85 min ago
      assert.match(await page.textContent('#reminderLabel'), /Next pump in 1h 35m/);
      assert.ok(await page.evaluate(() => document.getElementById('reminderBanner').classList.contains('state-upcoming')));
      await goTab(page, 'settings');
      await page.selectOption('#settingIntervalSelect', '120');
      await page.waitForFunction(() => /Next pump in 35m/.test(document.getElementById('reminderLabel').textContent));
      await page.clock.fastForward(60 * 60000); // an hour later: 25 min overdue
      await page.waitForFunction(() => /overdue/i.test(document.getElementById('reminderLabel').textContent));
      assert.ok(await page.evaluate(() => document.getElementById('reminderBanner').classList.contains('state-overdue')));
      assert.match(await page.textContent('#reminderActionBtn'), /Pump Now/);
    });
  });
});

// ================================================================ KEYBOARD ===
describe('keyboard access', () => {
  test('Quick Feed opens with Enter and with Space', async () => {
    await withApp(h, async (page) => {
      for (const key of ['Enter', 'Space']) {
        await page.focus('#quickFeedFab');
        await page.keyboard.press(key);
        assert.ok(await isOpen(page, 'feedFlowOverlay'), `${key} should open the feed flow`);
        await page.click('#ffCloseBtn');
      }
    });
  });

  test('a mouse tap still opens exactly one feed flow (no double-trigger from the keyboard fix)', async () => {
    await withApp(h, async (page) => {
      await page.click('#quickFeedFab');
      await page.waitForSelector('#feedFlowOverlay.open');
      assert.equal(await page.locator('#feedFlowOverlay.open').count(), 1);
      assert.equal(await page.evaluate(() => nurtureApp.feedFlow.feedFlow.step), 'type');
    });
  });

  test('feed rows that claim role=button react to Enter and Space', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4 });
      for (const key of ['Enter', 'Space']) {
        await page.focus('.feeds-tracker-row');
        await page.keyboard.press(key);
        await eventually(async () => assert.ok(await isOpen(page, 'editSessionModal'), `${key} should open the editor`));
        await page.click('#closeEditSessionBtn');
      }
    });
  });

  test('the History accordion header is keyboard reachable and toggles with Enter', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'history');
      assert.ok(await page.evaluate(() => document.querySelector('.accordion-header').tabIndex >= 0), 'header must be focusable');
      await page.focus('.accordion-header');
      const open = () => page.evaluate(() => document.getElementById('accordionPumpsList').classList.contains('open'));
      assert.equal(await open(), true);
      await page.keyboard.press('Enter');
      await eventually(async () => assert.equal(await open(), false));
      await page.keyboard.press('Enter');
      await eventually(async () => assert.equal(await open(), true));
    });
  });
});
