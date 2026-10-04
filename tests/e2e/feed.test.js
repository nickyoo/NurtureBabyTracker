// Browser tests: the feed flow (guided + express gesture + thawed source) and the bottle timer.
// Run: npm run test:e2e
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, withApp, goTab, seed, dbRead, openOverlays, HOUR } from './harness.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains('open'), id);
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const waitUnit = (page, unit) => page.waitForFunction((u) => document.getElementById('unitToggleBtn').textContent.trim() === u, unit);
const lsKey = (page) => page.evaluate(() => localStorage.getItem('nurture_bottle_timer'));

async function openFlow(page) {
  await page.click('#quickFeedFab');
  await page.waitForSelector('#feedFlowOverlay.open');
}
async function toAmount(page, type = 'formula') {
  await page.click(type === 'formula' ? '#ffTypeFormula' : '#ffTypeBreastmilk');
  await page.waitForSelector('#ffStepAmount.active');
}
async function toReview(page, { type = 'formula', preset = 4 } = {}) {
  await toAmount(page, type);
  await page.click(`#ffPresetRow .ff-preset-chip[data-val="${preset}"]`);
  await page.click('#ffAmountNext');
  await page.waitForSelector('#ffStepReview.active');
}
async function toSuccess(page, opts) {
  await toReview(page, opts);
  await page.click('#ffConfirmLog');
  await page.waitForSelector('#ffStepSuccess.active');
}
/** Hold the Quick Feed button, optionally slide to (nx,ny) inside the express pad, optionally lift. */
async function express(page, { nx, ny, hold = 450, lift = true } = {}) {
  const fab = await page.locator('#quickFeedFab').boundingBox();
  await page.mouse.move(fab.x + fab.width / 2, fab.y + fab.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(hold);
  await page.waitForSelector('#ffExpressPad', { state: 'visible' });
  if (nx !== undefined) {
    const pad = await page.locator('#ffExpressPad').boundingBox();
    await page.mouse.move(pad.x + pad.width * nx, pad.y + pad.height * ny, { steps: 8 });
  }
  if (lift) await page.mouse.up();
}
async function startBottle(page, { type = 'formula', preset = 4 } = {}) {
  await openFlow(page);
  await toAmount(page, type);
  await page.click(`#ffPresetRow .ff-preset-chip[data-val="${preset}"]`);
  await page.click('#ffStartTimerBtn');
  await page.waitForSelector('#btStepSetup.active');
  await page.click('#btStartBtn');
  await page.waitForSelector('#btStepLive.active');
}

// ============================================================ GUIDED FLOW ===
describe('feed flow — guided', () => {
  test('type → amount → review → log → success → Done, and the feed shows up everywhere', async () => {
    await withApp(h, async (page) => {
      await openFlow(page);
      await toReview(page, { type: 'formula', preset: 6 });
      assert.equal(await text(page, '#ffReviewType'), 'Formula');
      assert.equal(await text(page, '#ffReviewAmount'), '6.0 oz');
      assert.notEqual(await text(page, '#ffReviewTime'), '—');

      await page.click('#ffConfirmLog');
      await page.waitForSelector('#ffStepSuccess.active');
      assert.equal(await text(page, '#ffSuccessLine'), '6.0 oz Formula logged ✓');
      assert.equal(await text(page, '#ffSuccessTally'), '1 feed • 6 oz today');
      assert.ok(await page.evaluate(() => document.getElementById('feedToast').classList.contains('show')), 'toast shows');

      await page.click('#ffDoneBtn');
      assert.deepEqual(await openOverlays(page), []);

      const [s] = await dbRead.sessions(page);
      assert.deepEqual([s.type, s.feedType, s.outputQty, s.unit], ['feed', 'formula', 6, 'oz']);
      assert.equal(await page.locator('#feedsTrackerRows .feeds-tracker-row').count(), 1);
      assert.match(await text(page, '#feedsTrackerCount'), /1 feed.*6 oz/);
      await goTab(page, 'history');
      assert.equal(await page.locator('#activitySessionsContainer .session-item-tile').count(), 1);
    });
  });

  test('amount: slider, preset chips, tap-to-type (Enter / blur / Escape), and clamping', async () => {
    await withApp(h, async (page) => {
      await openFlow(page); await toAmount(page);
      const val = () => text(page, '#ffAmountValue');
      assert.equal(await val(), '4.0');

      await page.fill('#ffAmountSlider', '7.5');
      assert.equal(await val(), '7.5');

      await page.click('#ffPresetRow .ff-preset-chip[data-val="2"]');
      assert.equal(await val(), '2.0');
      assert.ok(await page.evaluate(() => document.querySelector('#ffPresetRow .ff-preset-chip[data-val="2"]').classList.contains('active')));

      await page.click('#ffAmountHero');
      await page.fill('#ffAmountInput', '3.3'); await page.keyboard.press('Enter');
      assert.equal(await val(), '3.3');

      await page.click('#ffAmountHero');
      await page.fill('#ffAmountInput', '99'); await page.keyboard.press('Enter');
      assert.equal(await val(), '10.0', 'clamped to the max');

      await page.click('#ffAmountHero');
      await page.fill('#ffAmountInput', '1'); await page.keyboard.press('Escape');
      assert.equal(await val(), '10.0', 'Escape keeps the old value');

      await page.click('#ffAmountHero');
      await page.fill('#ffAmountInput', '5'); await page.click('#ffStepAmount .ff-step-hint');
      assert.equal(await val(), '5.0', 'tapping away commits');
    });
  });

  test('Back links return to the previous step and remember the choice', async () => {
    await withApp(h, async (page) => {
      await openFlow(page);
      await toReview(page, { type: 'breastmilk', preset: 6 });
      await page.click('#ffBackToAmount');
      await page.waitForSelector('#ffStepAmount.active');
      assert.equal(await text(page, '#ffAmountValue'), '6.0');
      await page.click('#ffBackToType');
      await page.waitForSelector('#ffStepType.active');
      assert.ok(await page.evaluate(() => document.getElementById('ffTypeBreastmilk').classList.contains('is-selected')));
    });
  });

  for (const step of ['type', 'amount', 'review', 'success']) {
    test(`can always get out — on the "${step}" step: ✕, tapping outside, and Escape all close it`, async () => {
      await withApp(h, async (page) => {
        const reach = async () => {
          await openFlow(page);
          if (step === 'amount') await toAmount(page);
          if (step === 'review') await toReview(page);
          if (step === 'success') await toSuccess(page);
          await page.waitForSelector(`#ffStep${step[0].toUpperCase()}${step.slice(1)}.active`);
        };
        const exits = {
          '✕ button': () => page.click('#ffCloseBtn'),
          'tap outside': () => page.mouse.click(5, 5),
          'Escape': () => page.keyboard.press('Escape'),
        };
        for (const [name, doExit] of Object.entries(exits)) {
          await reach();
          await doExit();
          assert.equal(await isOpen(page, 'feedFlowOverlay'), false, `${name} on "${step}" step`);
        }
      });
    });
  }

  test('closing before the final "Log feed" saves nothing', async () => {
    await withApp(h, async (page) => {
      await openFlow(page); await toReview(page);
      await page.click('#ffCloseBtn');
      assert.equal((await dbRead.sessions(page)).length, 0);
    });
  });

  test('re-opening starts from scratch (no leftover type/amount from last time)', async () => {
    await withApp(h, async (page) => {
      await openFlow(page); await toReview(page, { type: 'breastmilk', preset: 8 });
      await page.click('#ffCloseBtn');
      await openFlow(page);
      assert.ok(await page.isVisible('#ffStepType.active'));
      assert.equal(await page.locator('#ffStepType .ff-type-btn.is-selected').count(), 0);
      await toAmount(page, 'formula');
      assert.equal(await text(page, '#ffAmountValue'), '4.0');
    });
  });

  test('mL mode: presets are in mL and the logged feed is stored in mL', async () => {
    await withApp(h, async (page) => {
      await page.click('#unitToggleBtn'); await waitUnit(page, 'mL');
      await openFlow(page); await toAmount(page);
      const labels = await page.$$eval('#ffPresetRow .ff-preset-chip', (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(labels, ['60 mL', '120 mL', '180 mL', '240 mL']);
      await page.click('#ffPresetRow .ff-preset-chip[data-val="120"]');
      await page.click('#ffAmountNext'); await page.waitForSelector('#ffStepReview.active');
      assert.match(await text(page, '#ffReviewAmount'), /^\d+ mL$/);
      await page.click('#ffConfirmLog'); await page.waitForSelector('#ffStepSuccess.active');
      const [s] = await dbRead.sessions(page);
      assert.equal(s.unit, 'mL');
      assert.ok(Math.abs(s.outputQty - 120) <= 2, `logged ${s.outputQty} mL after tapping 120`);
    });
  });
});

// =========================================================== THAWED SOURCE ===
describe('feed flow — thawed stash as the source', () => {
  test('a thawed pouch is offered, prefills type + amount, and is used up when fully fed', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'thawed', qty: 3 });
      await openFlow(page);
      await page.waitForSelector('#ffThawedBlock', { state: 'visible' }); // rendered just after the sheet opens
      assert.match(await text(page, '#ffThawedSources .ff-thawed-chip'), /3\.0 oz breast milk/);
      await page.click('#ffThawedSources .ff-thawed-chip');
      await page.waitForSelector('#ffStepAmount.active');
      assert.equal(await text(page, '#ffAmountValue'), '3.0');
      assert.ok(await page.evaluate(() => document.getElementById('ffTypeBreastmilk').classList.contains('is-selected')));
      await page.click('#ffAmountNext'); await page.waitForSelector('#ffStepReview.active');
      assert.equal(await text(page, '#ffReviewType'), 'Breast milk');
      await page.click('#ffConfirmLog'); await page.waitForSelector('#ffStepSuccess.active');
      const [item] = await dbRead.inventory(page);
      assert.equal(item.status, 'used');
    });
  });

  test('feeding less than the pouch leaves the remainder thawed for next time', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'thawed', qty: 4 });
      await openFlow(page);
      await page.click('#ffThawedSources .ff-thawed-chip');
      await page.waitForSelector('#ffStepAmount.active');
      await page.click('#ffPresetRow .ff-preset-chip[data-val="2"]');
      await page.click('#ffAmountNext'); await page.waitForSelector('#ffStepReview.active');
      await page.click('#ffConfirmLog'); await page.waitForSelector('#ffStepSuccess.active');
      const [item] = await dbRead.inventory(page);
      assert.deepEqual([item.status, item.location, item.quantity], ['active', 'thawed', 2]);
      await page.click('#ffDoneBtn');
      await openFlow(page);
      await page.waitForFunction(() => /2\.0 oz/.test(document.querySelector('#ffThawedSources .ff-thawed-chip')?.textContent || ''));
    });
  });

  test('with nothing thawed, the thawed block stays hidden', async () => {
    await withApp(h, async (page) => {
      await openFlow(page);
      assert.equal(await page.isVisible('#ffThawedBlock'), false);
    });
  });
});

// ============================================================ EXPRESS PAD ===
describe('feed flow — express gesture (press & hold, slide, lift)', () => {
  test('slide down-right = breast milk ~7 oz; lifting goes to review with exactly that', async () => {
    await withApp(h, async (page) => {
      await express(page, { nx: 0.7, ny: 0.85, lift: false });
      assert.equal(await text(page, '#ffLiveType'), 'Breast milk');
      assert.equal(await text(page, '#ffLiveReadout'), '7.0 oz');
      await page.mouse.up();
      await page.waitForSelector('#ffStepReview.active');
      assert.equal(await text(page, '#ffReviewType'), 'Breast milk');
      assert.equal(await text(page, '#ffReviewAmount'), '7.0 oz');
      await page.click('#ffConfirmLog'); await page.waitForSelector('#ffStepSuccess.active');
      const [s] = await dbRead.sessions(page);
      assert.deepEqual([s.feedType, s.outputQty], ['breastmilk', 7]);
    });
  });

  test('the type is sticky: small drift across the middle does not flip it, a clear push does', async () => {
    await withApp(h, async (page) => {
      await express(page, { nx: 0.5, ny: 0.2, lift: false });
      assert.equal(await text(page, '#ffLiveType'), 'Formula');
      const pad = await page.locator('#ffExpressPad').boundingBox();
      await page.mouse.move(pad.x + pad.width * 0.5, pad.y + pad.height * 0.55, { steps: 5 });
      assert.equal(await text(page, '#ffLiveType'), 'Formula', 'drift to 55% must not flip');
      await page.mouse.move(pad.x + pad.width * 0.5, pad.y + pad.height * 0.9, { steps: 5 });
      assert.equal(await text(page, '#ffLiveType'), 'Breast milk', 'push to 90% flips');
      await page.mouse.up();
      await page.waitForSelector('#ffStepReview.active');
    });
  });

  test('lifting without sliding cancels cleanly — nothing logged, nothing left open', async () => {
    await withApp(h, async (page) => {
      await express(page); // hold 450ms, lift in place
      await page.waitForFunction(() => !document.getElementById('feedFlowOverlay').classList.contains('open'));
      assert.deepEqual(await openOverlays(page), []);
      assert.equal((await dbRead.sessions(page)).length, 0);
      // and the button still works afterwards
      await page.click('#quickFeedFab'); await page.waitForSelector('#feedFlowOverlay.open');
    });
  });

  test('sliding to 0 oz and lifting cancels (you can back out of a gesture)', async () => {
    await withApp(h, async (page) => {
      await express(page, { nx: 0.0, ny: 0.8 });
      await page.waitForFunction(() => !document.getElementById('feedFlowOverlay').classList.contains('open'));
      assert.equal((await dbRead.sessions(page)).length, 0);
    });
  });

  test('"Adjust amount" after a gesture shows the amount and type that will actually be logged', async () => {
    await withApp(h, async (page) => {
      // Make the guided flow remember a *different* choice first — the stale-UI trap.
      await openFlow(page); await toAmount(page, 'formula');
      await page.click('#ffPresetRow .ff-preset-chip[data-val="6"]');
      await page.click('#ffCloseBtn');

      await express(page, { nx: 0.7, ny: 0.85 });
      await page.waitForSelector('#ffStepReview.active');
      const reviewed = await text(page, '#ffReviewAmount');
      await page.click('#ffBackToAmount');
      await page.waitForSelector('#ffStepAmount.active');

      assert.equal(`${await text(page, '#ffAmountValue')} oz`, reviewed, 'screen must match what review said');
      assert.equal(parseFloat(await page.inputValue('#ffAmountSlider')), parseFloat(reviewed), 'slider too');
      assert.deepEqual(
        await page.evaluate(() => [...document.querySelectorAll('#ffStepType .ff-type-btn.is-selected')].map((b) => b.id)),
        ['ffTypeBreastmilk'], 'the highlighted type must be the one the gesture chose');

      await page.click('#ffAmountNext'); await page.waitForSelector('#ffStepReview.active');
      assert.equal(await text(page, '#ffReviewAmount'), reviewed, 'continuing must not change it');
    });
  });

  test('after a gesture as the very first action, "Adjust amount" still has working preset chips', async () => {
    await withApp(h, async (page) => {
      await express(page, { nx: 0.3, ny: 0.2 });
      await page.waitForSelector('#ffStepReview.active');
      await page.click('#ffBackToAmount');
      assert.equal(await page.locator('#ffPresetRow .ff-preset-chip').count(), 4, 'presets must be there');
      assert.equal(await text(page, '#ffAmountValue'), '3.0');
    });
  });
});

// =========================================================== BOTTLE TIMER ===
describe('bottle timer', () => {
  test('from the flow: prefilled setup → start → live countdown → stop → adjust → log', async () => {
    await withApp(h, async (page) => {
      await openFlow(page); await toAmount(page, 'breastmilk');
      await page.click('#ffPresetRow .ff-preset-chip[data-val="6"]');
      await page.click('#ffStartTimerBtn');
      await page.waitForSelector('#btStepSetup.active');
      assert.equal(await isOpen(page, 'feedFlowOverlay'), false, 'feed sheet hands over to the bottle sheet');
      assert.equal(await text(page, '#btTitle'), 'Start bottle');
      assert.equal(await text(page, '#btAmountValue'), '6.0');
      assert.ok(await page.evaluate(() => document.getElementById('btTypeBreastmilk').classList.contains('is-selected')));

      await page.click('#btStartBtn'); await page.waitForSelector('#btStepLive.active');
      assert.equal(await text(page, '#btTitle'), 'Live feed');
      assert.ok(await lsKey(page), 'live timer is persisted so it survives backgrounding');

      await page.clock.fastForward(10 * 60 * 1000);
      await page.waitForFunction(() => /^10:0\d$/.test(document.getElementById('btElapsed').textContent));
      assert.match(await text(page, '#btSafety'), /Good for 1h (49|50)m/, 'breast milk gets 2h');
      const pct = parseFloat(await page.evaluate(() => document.getElementById('btProgressFill').style.width));
      assert.ok(pct > 85 && pct < 95, `progress bar ~92%, got ${pct}`);

      await page.click('#btStopBtn'); await page.waitForSelector('#btStepReview.active');
      assert.equal(await text(page, '#btTitle'), 'Review feed');
      assert.match(await text(page, '#btPaceLine'), /^Pace: [\d.]+ oz\/min over ~10 min$/);
      assert.equal(await text(page, '#btEatenValue'), '6.0', 'defaults to the full bottle');
      await page.fill('#btEatenSlider', '4.5');
      assert.equal(await text(page, '#btEatenValue'), '4.5');

      await page.click('#btLogBtn');
      await page.waitForFunction(() => !document.getElementById('bottleOverlay').classList.contains('open'));
      assert.equal(await lsKey(page), null, 'persisted timer is cleared after logging');
      const [s] = await dbRead.sessions(page);
      assert.deepEqual([s.type, s.feedType, s.outputQty], ['feed', 'breastmilk', 4.5]);
      assert.ok(s.durationSec >= 600 && s.durationSec < 615, `duration ${s.durationSec}`);
      assert.equal(s.notes, 'Bottle feed (6.0 oz prepared)');
    });
  });

  test('formula expires after 1h, breast milk is still good at 1h', async () => {
    await withApp(h, async (page) => {
      await startBottle(page, { type: 'formula' });
      await page.clock.fastForward(61 * 60 * 1000);
      await page.waitForFunction(() => /Time's up/.test(document.getElementById('btSafety').textContent));
      assert.ok(await page.evaluate(() => document.getElementById('btSafety').classList.contains('is-expired')));
    });
    await withApp(h, async (page) => {
      await startBottle(page, { type: 'breastmilk' });
      await page.clock.fastForward(61 * 60 * 1000);
      await page.waitForFunction(() => /^1:0[12]:\d\d$/.test(document.getElementById('btElapsed').textContent));
      assert.match(await text(page, '#btSafety'), /Good for 5[89]m/, 'breast milk is still good at 61 minutes');
    });
  });

  test('a finished bottle from a thawed pouch uses the pouch up', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'thawed', qty: 3 });
      await openFlow(page);
      await page.click('#ffThawedSources .ff-thawed-chip'); await page.waitForSelector('#ffStepAmount.active');
      await page.click('#ffStartTimerBtn'); await page.waitForSelector('#btStepSetup.active');
      await page.click('#btStartBtn'); await page.waitForSelector('#btStepLive.active');
      await page.click('#btStopBtn'); await page.waitForSelector('#btStepReview.active');
      await page.click('#btLogBtn');
      await page.waitForFunction(() => !document.getElementById('bottleOverlay').classList.contains('open'));
      const [item] = await dbRead.inventory(page);
      assert.equal(item.status, 'used');
    });
  });

  test('setup step (timer not started): ✕, tapping outside and Escape all close it and leave nothing running', async () => {
    await withApp(h, async (page) => {
      const reach = async () => {
        await openFlow(page); await toAmount(page);
        await page.click('#ffStartTimerBtn'); await page.waitForSelector('#btStepSetup.active');
      };
      for (const exit of [() => page.click('#btCloseBtn'), () => page.mouse.click(5, 5), () => page.keyboard.press('Escape')]) {
        await reach(); await exit();
        assert.equal(await isOpen(page, 'bottleOverlay'), false);
        assert.equal(await lsKey(page), null);
      }
    });
  });

  test('live: Cancel asks first — declining keeps the feed running, accepting discards it', async () => {
    await withApp(h, async (page) => {
      await startBottle(page);
      page.answerDialogs(false);
      await page.click('#btCancelBtn');
      assert.equal(await isOpen(page, 'bottleOverlay'), true);
      assert.ok(await lsKey(page), 'still running');
      page.answerDialogs(true);
      await page.click('#btCancelBtn');
      assert.equal(await isOpen(page, 'bottleOverlay'), false);
      assert.equal(await lsKey(page), null);
      assert.equal((await dbRead.sessions(page)).length, 0, 'cancelled feed is not logged');
    });
  });

  test('live: the ✕ is never a dead control — if it is shown it must do something (close or ask)', async () => {
    await withApp(h, async (page) => {
      await startBottle(page);
      page.answerDialogs(false); // if it asks, say no, so we can observe without losing the feed
      const x = page.locator('#btCloseBtn');
      if (await x.isVisible()) {
        const dialogsBefore = page.probe.dialogs.length;
        await x.click();
        const closed = !(await isOpen(page, 'bottleOverlay'));
        const asked = page.probe.dialogs.length > dialogsBefore;
        assert.ok(closed || asked, 'tapping ✕ during a live feed did nothing at all');
      }
    });
  });

  test('live: tapping outside the sheet must NOT dismiss a running feed', async () => {
    await withApp(h, async (page) => {
      await startBottle(page);
      await page.mouse.click(5, 5);
      assert.equal(await isOpen(page, 'bottleOverlay'), true);
      await page.keyboard.press('Escape');
      assert.equal(await isOpen(page, 'bottleOverlay'), true);
    });
  });

  test('review → Back returns to the live timer and it keeps counting', async () => {
    await withApp(h, async (page) => {
      await startBottle(page);
      await page.clock.fastForward(30 * 1000);
      await page.click('#btStopBtn'); await page.waitForSelector('#btStepReview.active');
      await page.click('#btBackToLive'); await page.waitForSelector('#btStepLive.active');
      await page.clock.fastForward(30 * 1000);
      await page.waitForFunction(() => /^01:0\d$/.test(document.getElementById('btElapsed').textContent));
    });
  });

  test('a live feed survives a reload; a long-stale one comes back expired but can still be finished', async () => {
    await withApp(h, async (page) => {
      await startBottle(page, { type: 'formula' });
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.equal(await isOpen(page, 'bottleOverlay'), true, 'sheet re-opens');
      assert.equal(await text(page, '#btTitle'), 'Live feed');

      await page.evaluate(() => localStorage.setItem('nurture_bottle_timer',
        JSON.stringify({ startTs: Date.now() - 3 * 3600 * 1000, feedType: 'breastmilk', preparedOz: 4 })));
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.match(await text(page, '#btSafety'), /Time's up/);
      await page.click('#btStopBtn'); await page.waitForSelector('#btStepReview.active');
      await page.click('#btLogBtn');
      await page.waitForFunction(() => !document.getElementById('bottleOverlay').classList.contains('open'));
      assert.equal(await lsKey(page), null);
    });
  });

  test('a corrupt saved timer is ignored instead of breaking startup', async () => {
    // (the app logs a console warning about it — that is the intended handling, so allow it)
    await withApp(h, { allowProblems: true }, async (page) => {
      await page.evaluate(() => localStorage.setItem('nurture_bottle_timer', '{not json'));
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      assert.equal(await isOpen(page, 'bottleOverlay'), false);
    });
  });

  // A design question, not a bug: while a bottle is live the sheet covers the whole app
  // (including the bottom nav) for up to 2 hours. Tracked so it isn't forgotten.
  test.todo('while a feed is live, the rest of the app should stay reachable (minimise the sheet)');
});
