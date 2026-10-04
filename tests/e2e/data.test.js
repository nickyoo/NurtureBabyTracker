// Browser tests: History, Stash, Settings (incl. backup/restore/reset) and data-safety.
// Run: npm run test:e2e
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, withApp, openApp, goTab, seed, dbRead, eventually, HOUR, DAY } from './harness.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).classList.contains('open'), id);
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const count = (page, sel) => page.locator(sel).count();
const readDownload = async (dl) => {
  const chunks = [];
  for await (const c of await dl.createReadStream()) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};
const waitReady = (page) => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');

// ===================================================================== HISTORY ===
describe('history tab', () => {
  test('the Today accordion folds and unfolds', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'history');
      const open = () => page.evaluate(() => document.getElementById('accordionPumpsList').classList.contains('open'));
      assert.equal(await open(), true);
      await page.click('.accordion-header');
      await eventually(async () => assert.equal(await open(), false));
      assert.equal(await page.evaluate(() => document.getElementById('accordionChevron').classList.contains('open')), false);
      await page.click('.accordion-header');
      await eventually(async () => assert.equal(await open(), true));
    });
  });

  test('filters: All / Pumps / Feeds show the right rows, the active chip moves, empty filters say so', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 5 }); await seed.pump(page, { qty: 6, agoMs: 4 * HOUR });
      await seed.feed(page, { qty: 3 });
      await goTab(page, 'history');
      const rows = (n) => eventually(async () => assert.equal(await count(page, '#activitySessionsContainer .session-item-tile'), n));
      await rows(3);
      await page.click('.activity-filter-chip[data-filter="pumps"]');
      await rows(2);
      assert.equal(await page.locator('.activity-filter-chip.active').getAttribute('data-filter'), 'pumps');
      await page.click('.activity-filter-chip[data-filter="feeds"]');
      await rows(1);
      await page.click('.activity-filter-chip[data-filter="all"]');
      await rows(3);
    });
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 5 });
      await goTab(page, 'history');
      await page.click('.activity-filter-chip[data-filter="feeds"]');
      await eventually(async () => assert.match(await text(page, '#activitySessionsContainer'), /No feeds recorded/));
    });
  });

  test('"Show Previous Days" reveals older days and "Hide" puts them away', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 5 });
      await seed.pump(page, { qty: 6, agoMs: 26 * HOUR });
      await goTab(page, 'history');
      const headers = () => page.$$eval('.session-group-header span:first-child', (e) => e.map((x) => x.textContent.trim()));
      assert.deepEqual(await headers(), ['Today']);
      await page.click('[data-action="toggle-older-history"]');
      await eventually(async () => assert.deepEqual(await headers(), ['Today', 'Yesterday']));
      assert.match(await text(page, '[data-action="toggle-older-history"]'), /Hide Previous Days/);
      await page.click('[data-action="toggle-older-history"]');
      await eventually(async () => assert.deepEqual(await headers(), ['Today']));
    });
  });

  test('Edit a feed: modal is prefilled, saving persists and re-renders, switching type keeps the label honest', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4, feedType: 'formula' });
      await goTab(page, 'history');
      await page.click('#activitySessionsContainer [data-action="edit-session"]');
      await page.waitForSelector('#editSessionModal.open');
      assert.equal(await text(page, '#editSessionTitle'), 'Edit Feed Entry');
      assert.ok(await page.isVisible('#editFeedTypeGroup'));
      assert.equal(await page.isVisible('#editDurationGroup'), false, 'feeds have no duration field');
      assert.equal(await page.inputValue('#editSessionQty'), '4');
      assert.equal(await page.inputValue('#editSessionTime'), '2026-10-04T09:00');
      assert.ok(await page.evaluate(() => document.getElementById('editFeedTypeFormula').classList.contains('active')));

      await page.click('#editFeedTypeBreastmilk');
      await page.fill('#editSessionQty', '5.5');
      await page.click('#saveEditSessionBtn');
      await page.waitForFunction(() => !document.getElementById('editSessionModal').classList.contains('open'));

      const [s] = await dbRead.sessions(page);
      assert.deepEqual([s.feedType, s.outputQty], ['breastmilk', 5.5]);
      assert.ok(s.updatedAt, 'stamped as edited');
      await eventually(async () => {
        const row = await text(page, '#activitySessionsContainer .session-item-tile');
        assert.match(row, /5\.5 oz/);
        assert.match(row, /Breast Milk/);
        assert.doesNotMatch(row, /Formula/, `row still mentions the OLD type: "${row}"`);
      });
    });
  });

  test('Edit a feed: a note you wrote survives a type change, and a note you type now beats the auto label', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4, feedType: 'formula', notes: 'night feed' });
      await seed.feed(page, { qty: 3, feedType: 'formula', agoMs: 3 * HOUR }); // auto label
      await goTab(page, 'history');
      const edit = async (index) => {
        await page.locator('#activitySessionsContainer [data-action="edit-session"]').nth(index).click();
        await page.waitForSelector('#editSessionModal.open');
      };
      await edit(0); // newest = 'night feed'
      await page.click('#editFeedTypeBreastmilk'); await page.click('#saveEditSessionBtn');
      await page.waitForFunction(() => !document.getElementById('editSessionModal').classList.contains('open'));
      await edit(1); // older = auto label; switch type AND type our own note
      await page.click('#editFeedTypeBreastmilk'); await page.fill('#editSessionNotes', 'pumped at work');
      await page.click('#saveEditSessionBtn');
      await page.waitForFunction(() => !document.getElementById('editSessionModal').classList.contains('open'));
      const sessions = await dbRead.sessions(page);
      assert.equal(sessions[0].notes, 'night feed');
      assert.equal(sessions[1].notes, 'pumped at work', 'a note typed during the edit must not be overwritten by the auto label');
    });
  });

  test('Edit a pump: shows duration, saves duration/end time, and Cancel throws changes away', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 5, durationMin: 15 });
      await goTab(page, 'history');
      await page.click('#activitySessionsContainer [data-action="edit-session"]');
      await page.waitForSelector('#editSessionModal.open');
      assert.equal(await text(page, '#editSessionTitle'), 'Edit Pump Entry');
      assert.equal(await page.isVisible('#editFeedTypeGroup'), false);
      assert.equal(await page.inputValue('#editSessionDuration'), '15');

      await page.fill('#editSessionQty', '9'); await page.click('#closeEditSessionBtn');
      assert.equal((await dbRead.sessions(page))[0].outputQty, 5, 'Cancel discards edits');

      await page.click('#activitySessionsContainer [data-action="edit-session"]'); await page.waitForSelector('#editSessionModal.open');
      await page.fill('#editSessionDuration', '20'); await page.click('#saveEditSessionBtn');
      await page.waitForFunction(() => !document.getElementById('editSessionModal').classList.contains('open'));
      const [s] = await dbRead.sessions(page);
      assert.equal(s.durationSec, 1200);
      assert.equal(s.endTime, s.startTime + 1200 * 1000);
    });
  });

  test('Edit validates: an empty/zero amount or missing time warns and keeps the modal open', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4 });
      await goTab(page, 'history');
      await page.click('#activitySessionsContainer [data-action="edit-session"]'); await page.waitForSelector('#editSessionModal.open');
      await page.fill('#editSessionQty', '0'); await page.click('#saveEditSessionBtn');
      await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /valid quantity/i));
      assert.ok(await isOpen(page, 'editSessionModal'));
      await page.fill('#editSessionQty', '4'); await page.fill('#editSessionTime', ''); await page.click('#saveEditSessionBtn');
      await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /valid date/i));
      assert.ok(await isOpen(page, 'editSessionModal'));
      assert.equal((await dbRead.sessions(page))[0].outputQty, 4, 'nothing saved');
    });
  });

  test('the edit modal can always be left: Cancel, tapping outside, Escape', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4 });
      await goTab(page, 'history');
      for (const exit of [() => page.click('#closeEditSessionBtn'), () => page.mouse.click(5, 5), () => page.keyboard.press('Escape')]) {
        await page.click('#activitySessionsContainer [data-action="edit-session"]'); await page.waitForSelector('#editSessionModal.open');
        await exit();
        assert.equal(await isOpen(page, 'editSessionModal'), false);
      }
    });
  });

  test('Delete asks first: declining keeps the entry, accepting removes it everywhere', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4 }); await seed.pump(page, { qty: 5 });
      await goTab(page, 'history');
      page.answerDialogs(false);
      await page.locator('#activitySessionsContainer [data-action="delete-session"]').first().click();
      await eventually(async () => assert.equal(page.probe.dialogs.length, 1));
      assert.equal((await dbRead.sessions(page)).length, 2);
      page.answerDialogs(true);
      await page.locator('#activitySessionsContainer [data-action="delete-session"]').first().click();
      await page.waitForFunction(() => document.querySelectorAll('#activitySessionsContainer .session-item-tile').length === 1);
      assert.equal((await dbRead.sessions(page)).length, 1);
    });
  });

  test('Today\'s Feeds rows open the editor when tapped', async () => {
    await withApp(h, async (page) => {
      await seed.feed(page, { qty: 4 });
      await page.click('#feedsTrackerRows .feeds-tracker-row');
      await page.waitForSelector('#editSessionModal.open');
    });
  });

  test('CSV export downloads a well-formed file (quotes escaped); with nothing logged it says so instead', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 5, notes: 'say "hi", ok' }); await seed.feed(page, { qty: 3, feedType: 'breastmilk' });
      await goTab(page, 'history');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsvBtn')]);
      assert.match(dl.suggestedFilename(), /^nurture_feeding_log_2026-10-04\.csv$/);
      const csv = await readDownload(dl);
      const lines = csv.trim().split('\r\n');
      assert.equal(lines[0], 'Date,Start Time,End Time,Type,Side,Duration (Min),Output Volume,Unit,Notes');
      assert.equal(lines.length, 3);
      assert.ok(csv.includes('"say ""hi"", ok"'), 'embedded quotes are doubled and the field stays one cell');
      assert.ok(csv.includes('"Feed (Breast Milk)"'));
    });
    await withApp(h, async (page) => {
      await goTab(page, 'history');
      await page.click('#exportCsvBtn');
      await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /No sessions/i));
      assert.equal(page.probe.downloads, 0);
    });
  });

  test('the supply chart draws 7 labelled days and a weekly average', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 7 });
      await goTab(page, 'history');
      const labels = await page.$$eval('#chartSvgWrap svg text', (t) => t.map((x) => x.textContent.trim()));
      for (const d of ['Today', 'Yest.']) assert.ok(labels.includes(d), `chart should label ${d}`);
      assert.equal(await page.locator('#chartSvgWrap svg circle').count(), 7);
      assert.equal(await text(page, '#metricWeekAvg'), '1 oz/d');
    });
  });
});

// ======================================================================= STASH ===
describe('stash tab', () => {
  test('empty state explains what to do, and the totals are zero', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'inventory');
      assert.match(await text(page, '#inventoryListContainer'), /Add Stored Milk Pouch/);
      assert.equal(await text(page, '#stashTotalVolume'), '0 oz');
      assert.equal(await page.isVisible('#thawTile'), false, 'thaw tile only appears when there is frozen milk');
    });
  });

  test('Add pouch: validates, saves with the right place/expiry, updates totals — and Cancel discards', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'inventory');
      await page.click('#openAddMilkModalBtn'); await page.waitForSelector('#addMilkModal.open');
      assert.equal(await page.inputValue('#modalMilkQty'), '4');
      assert.equal(await page.inputValue('#modalPumpedAt'), '2026-10-04T10:00');

      await page.fill('#modalMilkQty', '0'); await page.click('#saveNewMilkBtn');
      await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /valid milk volume/i));
      assert.ok(await isOpen(page, 'addMilkModal'));

      await page.fill('#modalMilkQty', '3.5'); await page.selectOption('#modalMilkLoc', 'deepFreezer');
      await page.fill('#modalMilkNotes', 'bag 1'); await page.click('#saveNewMilkBtn');
      await page.waitForFunction(() => !document.getElementById('addMilkModal').classList.contains('open'));
      const tile = await text(page, '#inventoryListContainer .inventory-tile');
      assert.match(tile, /3\.5 oz/); assert.match(tile, /Deep Chest/); assert.match(tile, /bag 1/); assert.match(tile, /12 months left/);
      assert.equal(await text(page, '#stashTotalVolume'), '3.5 oz');
      assert.equal(await text(page, '#stashFreezerVolume'), '3.5 oz');

      await page.click('#openAddMilkModalBtn'); await page.waitForSelector('#addMilkModal.open');
      await page.fill('#modalMilkQty', '9'); await page.click('#closeAddMilkBtn');
      assert.equal(await count(page, '#inventoryListContainer .inventory-tile'), 1, 'Cancel adds nothing');
    });
  });

  test('the Add-pouch modal can be left the same ways as every other sheet: Cancel, tapping outside, Escape', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'inventory');
      for (const [name, exit] of [['Cancel', () => page.click('#closeAddMilkBtn')], ['tap outside', () => page.mouse.click(5, 5)], ['Escape', () => page.keyboard.press('Escape')]]) {
        await page.click('#openAddMilkModalBtn'); await page.waitForSelector('#addMilkModal.open');
        await exit();
        assert.equal(await isOpen(page, 'addMilkModal'), false, name);
      }
    });
  });

  test('FIFO: oldest pouch first, and only it carries the "Use Next" badge', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { qty: 2, agoMs: 5 * HOUR, notes: 'newer' });
      await seed.pouch(page, { qty: 3, agoMs: 30 * HOUR, notes: 'older' });
      await goTab(page, 'inventory');
      const tiles = await page.$$eval('#inventoryListContainer .inventory-tile', (els) => els.map((e) => ({ note: e.textContent.includes('older') ? 'older' : 'newer', fifo: e.classList.contains('fifo-first') })));
      assert.deepEqual(tiles, [{ note: 'older', fifo: true }, { note: 'newer', fifo: false }]);
      assert.equal(await count(page, '.fifo-badge'), 1);
    });
  });

  test('filter pills: each shows its own pouches (thawed counts as fridge) and Archived shows used ones', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'fridge' }); await seed.pouch(page, { location: 'thawed' });
      await seed.pouch(page, { location: 'freezer' }); await seed.pouch(page, { location: 'deepFreezer' });
      await seed.pouch(page, { location: 'fridge', status: 'used' });
      await goTab(page, 'inventory');
      const expect = { all: 4, fridge: 2, freezer: 1, deepFreezer: 1, archived: 1 };
      for (const [filter, n] of Object.entries(expect)) {
        await page.click(`.filter-pill[data-filter="${filter}"]`);
        await page.waitForFunction((f) => document.querySelector('.filter-pill.active')?.dataset.filter === f, filter);
        await eventually(async () => assert.equal(await count(page, '#inventoryListContainer .inventory-tile'), n, `${filter} filter`));
      }
      assert.match(await text(page, '#inventoryListContainer'), /Status: used/);
    });
  });

  test('"Used" moves a pouch to Archived and shrinks the totals', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { qty: 4 }); await seed.pouch(page, { qty: 2, agoMs: 2 * HOUR });
      await goTab(page, 'inventory');
      assert.equal(await text(page, '#stashTotalVolume'), '6 oz');
      await page.locator('[data-action="mark-used"]').first().click();
      await page.waitForFunction(() => document.getElementById('stashTotalVolume').textContent.trim() === '2 oz');
      await page.click('.filter-pill[data-filter="archived"]');
      await eventually(async () => assert.match(await text(page, '#inventoryListContainer'), /Status: used/));
    });
  });

  test('Discard asks first: declining keeps the pouch, accepting archives it', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { qty: 4 });
      await goTab(page, 'inventory');
      page.answerDialogs(false);
      await page.click('[data-action="discard-item"]');
      assert.equal((await dbRead.inventory(page))[0].status, 'active');
      page.answerDialogs(true);
      await page.click('[data-action="discard-item"]');
      await page.waitForFunction(() => document.querySelectorAll('#inventoryListContainer .inventory-tile').length === 0);
      assert.equal((await dbRead.inventory(page))[0].status, 'discarded');
    });
  });

  test('only frozen pouches offer Thaw; thawing moves one to "Thawed & ready" with a Feed button', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'fridge', qty: 4 }); await seed.pouch(page, { location: 'freezer', qty: 5 });
      await goTab(page, 'inventory');
      assert.equal(await count(page, '#inventoryListContainer [data-action="thaw-item"]'), 1);
      assert.ok(await page.isVisible('#thawTile'));
      assert.match(await text(page, '#thawReadyRows'), /No thawed milk yet/);

      page.answerDialogs(false);
      await page.click('#thawFrozenRows [data-action="thaw-item"]');
      assert.equal(await count(page, '#thawReadyRows .thaw-row'), 0, 'declined');

      page.answerDialogs(true);
      await page.click('#thawFrozenRows [data-action="thaw-item"]');
      await page.waitForFunction(() => document.querySelectorAll('#thawReadyRows .thaw-row').length === 1);
      assert.equal(await page.isVisible('#thawTile'), false, 'no frozen stash left → tile hides itself');
      const locs = (await dbRead.inventory(page)).map((i) => i.location).sort();
      assert.deepEqual(locs, ['fridge', 'thawed']);
    });
  });

  test('a thawed pouch\'s "Feed" button opens the feed flow with that pouch on offer', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'thawed', qty: 3 });
      await seed.pouch(page, { location: 'freezer', qty: 5 }); // keeps the tile visible
      await goTab(page, 'inventory');
      await page.click('#thawReadyRows [data-action="open-feed-flow"]');
      await page.waitForSelector('#feedFlowOverlay.open');
      await page.waitForFunction(() => document.querySelectorAll('#ffThawedSources .ff-thawed-chip').length === 1);
    });
  });

  test('more than 6 frozen pouches: the tile shows 6 and a working "+N more" link', async () => {
    await withApp(h, async (page) => {
      for (let i = 0; i < 8; i++) await seed.pouch(page, { location: 'freezer', agoMs: (10 + i) * DAY });
      await goTab(page, 'inventory');
      assert.equal(await count(page, '#thawFrozenRows .thaw-row'), 6);
      assert.match(await text(page, '#thawMoreLine'), /\+ 2 more/);
      await page.click('#thawMoreLine a');
      assert.equal(await page.evaluate(() => location.hash), '#inventoryListContainer');
    });
  });

  test('summary tiles split fridge vs freezers and the urgent strip warns on a low stash', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'fridge', qty: 4 }); await seed.pouch(page, { location: 'freezer', qty: 3 }); await seed.pouch(page, { location: 'deepFreezer', qty: 2 });
      await goTab(page, 'inventory');
      assert.deepEqual([await text(page, '#stashTotalVolume'), await text(page, '#stashFridgeVolume'), await text(page, '#stashFreezerVolume')], ['9 oz', '4 oz', '5 oz']);
      assert.match(await text(page, '#stashUrgentRows'), /Low stash: 9 oz left/);
      await seed.pouch(page, { location: 'fridge', qty: 4 });
      assert.equal(await page.isVisible('#stashUrgentCard'), false, '13 oz is not low');
    });
  });

  test('an expired pouch drops out of the live list and shows up in Archived as expired', async () => {
    await withApp(h, async (page) => {
      await seed.pouch(page, { location: 'fridge', agoMs: 6 * DAY });
      await goTab(page, 'inventory');
      assert.equal(await count(page, '#inventoryListContainer .inventory-tile'), 0);
      await page.click('.filter-pill[data-filter="archived"]');
      await eventually(async () => assert.match(await text(page, '#inventoryListContainer'), /Status: expired/));
    });
  });
});

// ===================================================================== SETTINGS ===
describe('settings', () => {
  test('names update the header, page title and settings heading — and survive a reload', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.fill('#settingParentNameInput', 'Sav'); await page.fill('#settingBabyNameInput', 'Clara');
      await page.click('#settingsPreferencesTitle'); // blur
      await page.waitForFunction(() => document.getElementById('appBrandSubtitleText').textContent === "Clara's Tracker");
      assert.equal(await text(page, '#appBrandName'), "Sav's.");
      assert.equal(await page.title(), "Sav's Baby Tracker");
      assert.equal(await text(page, '#settingsPreferencesTitle'), "Sav's Preferences");
      await page.reload(); await waitReady(page);
      assert.equal(await text(page, '#appBrandSubtitleText'), "Clara's Tracker");
    });
  });

  test('names ending in "s" get a bare apostrophe, and the placeholder name "Baby" counts as unset', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.fill('#settingParentNameInput', 'Chris'); await page.fill('#settingBabyNameInput', 'Baby');
      await page.click('#settingsPreferencesTitle');
      await page.waitForFunction(() => document.getElementById('appBrandName').textContent.startsWith("Chris'"));
      assert.equal(await text(page, '#appBrandSubtitleText'), 'Baby Tracker');
    });
  });

  test('unit, theme, interval and sound choices persist across a reload', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.selectOption('#settingUnitSelect', 'mL');
      await page.selectOption('#settingThemeSelect', 'dark');
      await page.selectOption('#settingIntervalSelect', '240');
      await page.click('.switch'); // sound off
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
      await page.waitForTimeout(150); // let the last IndexedDB writes land
      await page.reload(); await waitReady(page);
      await goTab(page, 'settings');
      assert.equal(await page.inputValue('#settingUnitSelect'), 'mL');
      assert.equal(await page.inputValue('#settingThemeSelect'), 'dark');
      assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
      assert.equal(await page.inputValue('#settingIntervalSelect'), '240');
      assert.equal(await page.isChecked('#soundToggle'), false);
    });
  });

  test('"Play Sample Chime" makes a sound — unless sound is switched off', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      const audio = () => page.evaluate(() => window.__fx.audio);
      const before = await audio();
      await page.click('#testChimeBtn');
      assert.ok((await audio()) > before, 'chime should play');
      await page.click('.switch'); // off
      const mid = await audio();
      await page.click('#testChimeBtn');
      assert.equal(await audio(), mid, 'silent when sound is off');
    });
  });

  test('"Enable Push Notifications" asks the browser and tells the person the outcome (not a silent click)', async () => {
    await withApp(h, async (page) => {
      await page.context().grantPermissions(['notifications']); // headless Chrome can't answer the real prompt
      await goTab(page, 'settings');
      await page.click('#requestNotifyBtn');
      await page.waitForFunction(() => window.__fx.notif > 0);
      await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /Notifications enabled/i));
    });
  });

  test('daily goal field in Settings updates the goal tile; blank falls back to 24', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.fill('#settingDailyGoalInput', '30'); await page.press('#settingDailyGoalInput', 'Tab');
      await page.waitForFunction(() => document.getElementById('goalTargetValue').textContent.trim() === '30');
      await page.fill('#settingDailyGoalInput', ''); await page.press('#settingDailyGoalInput', 'Tab');
      await page.waitForFunction(() => document.getElementById('goalTargetValue').textContent.trim() === '24');
    });
  });

  test('storage windows: saving confirms, applies to the next pouch, and blanks fall back to CDC defaults', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.fill('#settingWinFridge', '7');
      await page.click('[data-action="save-storage-windows"]');
      await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /saved/i));
      await goTab(page, 'inventory');
      await page.click('#openAddMilkModalBtn'); await page.waitForSelector('#addMilkModal.open');
      await page.selectOption('#modalMilkLoc', 'fridge'); await page.click('#saveNewMilkBtn');
      await page.waitForFunction(() => document.querySelectorAll('#inventoryListContainer .inventory-tile').length === 1);
      assert.match(await text(page, '#inventoryListContainer .inventory-tile'), /6 days left/, '7-day window ≈ 6 full days remaining');

      await goTab(page, 'settings');
      const dialogsBefore = page.probe.dialogs.length;
      await page.fill('#settingWinFridge', ''); await page.click('[data-action="save-storage-windows"]');
      await eventually(async () => assert.ok(page.probe.dialogs.length > dialogsBefore, 'save should finish (and confirm) first'));
      await page.reload(); await waitReady(page); await goTab(page, 'settings');
      assert.equal(await page.inputValue('#settingWinFridge'), '4');
    });
  });
});

// ===================================================== BACKUP / RESTORE / RESET ===
describe('backup, restore and reset', () => {
  const backupFile = (obj) => ({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });

  async function seedSome(page) {
    await seed.pump(page, { qty: 5, notes: 'p1' }); await seed.feed(page, { qty: 3 }); await seed.pouch(page, { qty: 4, location: 'freezer' });
  }

  test('JSON backup downloads valid JSON that contains everything', async () => {
    await withApp(h, async (page) => {
      await seedSome(page);
      await goTab(page, 'settings');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
      assert.equal(dl.suggestedFilename(), 'nurture_backup_2026-10-04.json');
      const data = JSON.parse(await readDownload(dl));
      assert.equal(data.version, 1);
      assert.equal(data.sessions.length, 2);
      assert.equal(data.inventory.length, 1);
      assert.ok(Array.isArray(data.settings));
    });
  });

  test('round trip: back up → wipe → restore brings everything back', async () => {
    await withApp(h, async (page) => {
      await seedSome(page);
      await goTab(page, 'settings');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
      const backup = await readDownload(dl);

      await page.evaluate(async () => { await (await import('/js/db.js')).db.resetAllData(); });
      await page.reload(); await waitReady(page);
      assert.equal((await dbRead.sessions(page)).length, 0);

      await goTab(page, 'settings');
      await Promise.all([page.waitForEvent('load'), page.setInputFiles('#importFileInput', backupFile(backup))]);
      await waitReady(page);
      assert.match(page.probe.dialogs.find((d) => /restored/i.test(d.message))?.message ?? '', /restored/i);
      assert.equal((await dbRead.sessions(page)).length, 2);
      assert.equal((await dbRead.inventory(page)).length, 1);
    });
  });

  for (const [name, payload] of [
    ['not JSON at all', 'this is not json'],
    ['JSON with no version marker', { sessions: [] }],
    ['versioned but the records are malformed', { version: 1, sessions: [{ type: 'pump', startTime: 1 }], inventory: [], bottles: [], settings: [] }],
    ['versioned but the lists are the wrong type', { version: 1, sessions: 'oops', inventory: 7 }],
  ]) {
    test(`a bad backup (${name}) is refused with a message and your existing data is left untouched`, async () => {
      await withApp(h, async (page) => {
        await seedSome(page);
        await goTab(page, 'settings');
        await page.setInputFiles('#importFileInput', backupFile(payload));
        await eventually(async () => assert.match(page.probe.dialogs.at(-1)?.message ?? '', /Failed to restore/i), { timeout: 4000 });
        assert.equal((await dbRead.sessions(page)).length, 2, 'sessions must still be there');
        assert.equal((await dbRead.inventory(page)).length, 1, 'stash must still be there');
      });
    });
  }

  test('Reset: declining changes nothing; accepting wipes sessions, stash and settings', async () => {
    await withApp(h, async (page) => {
      await seedSome(page);
      await goTab(page, 'settings');
      page.answerDialogs(false);
      await page.click('#clearAllDataBtn');
      assert.equal((await dbRead.sessions(page)).length, 2);
      page.answerDialogs(true);
      await Promise.all([page.waitForEvent('load'), page.click('#clearAllDataBtn')]);
      await waitReady(page);
      assert.equal((await dbRead.sessions(page)).length, 0);
      assert.equal((await dbRead.inventory(page, true)).length, 0);
    });
  });

  test('?reset=true wipes the data, shows onboarding again and cleans the URL', async () => {
    await withApp(h, async (page) => {
      await seedSome(page);
      await page.goto(h.url + '?reset=true'); await waitReady(page);
      assert.equal((await dbRead.sessions(page)).length, 0);
      await page.waitForSelector('#onboardingModal', { state: 'visible' });
      assert.equal(new URL(page.url()).search, '');
    });
  });
});

// ====================================================================== SAFETY ===
describe('data safety: nothing a person types can inject markup', () => {
  const PAYLOAD = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';

  test('notes containing HTML show as plain text in History, Stash, Today\'s Feeds and the editor', async () => {
    await withApp(h, async (page) => {
      await seed.pump(page, { qty: 4, notes: PAYLOAD });
      await seed.feed(page, { qty: 3, notes: PAYLOAD });
      await seed.pouch(page, { qty: 4, notes: PAYLOAD });
      for (const tab of ['history', 'inventory', 'pump', 'history']) await goTab(page, tab);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ fired: window.__xss || 0, imgs: document.querySelectorAll('img[src="x"]').length }));
      assert.deepEqual(r, { fired: 0, imgs: 0 }, 'a note must never become live markup');
      await goTab(page, 'history');
      assert.ok((await text(page, '#activitySessionsContainer')).includes('<img src=x'), 'the note should be visible, as text');
    });
  });

  test('a restored backup with hostile IDs cannot break out of an attribute', async () => {
    await withApp(h, async (page) => {
      const evil = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">';
      await seed.pump(page, { qty: 4, id: evil });
      await seed.pouch(page, { qty: 4, id: evil, location: 'freezer' });
      for (const tab of ['history', 'inventory', 'pump']) await goTab(page, tab);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ fired: window.__xss || 0, imgs: document.querySelectorAll('img[src="x"]').length }));
      assert.deepEqual(r, { fired: 0, imgs: 0 });
    });
  });

  test('a name containing HTML is shown as text in the header and survives a reload without running', async () => {
    await withApp(h, async (page) => {
      await goTab(page, 'settings');
      await page.fill('#settingParentNameInput', PAYLOAD); await page.fill('#settingBabyNameInput', PAYLOAD);
      await page.click('#settingsPreferencesTitle');
      await eventually(async () => assert.ok((await text(page, '#appBrandName')).includes('<img'), 'name should appear as literal text'));
      await page.waitForTimeout(150); // let the saves land
      await page.reload(); await waitReady(page);
      const r = await page.evaluate(() => ({ fired: window.__xss || 0, imgs: document.querySelectorAll('img[src="x"]').length }));
      assert.deepEqual(r, { fired: 0, imgs: 0 });
    });
  });

  test('a restored backup cannot smuggle markup in through the unit or name settings', async () => {
    await withApp(h, async (page) => {
      const evil = { version: 1, sessions: [], inventory: [], bottles: [],
        settings: [{ key: 'units', value: PAYLOAD }, { key: 'parentName', value: PAYLOAD }, { key: 'babyName', value: PAYLOAD }] };
      await seed.pump(page, { qty: 4 }); // so the unit appears in the History header too
      await goTab(page, 'settings');
      await Promise.all([page.waitForEvent('load'), page.setInputFiles('#importFileInput',
        { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(evil)) })]);
      await waitReady(page);
      for (const tab of ['history', 'inventory', 'pump', 'settings']) await goTab(page, tab);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ fired: window.__xss || 0, imgs: document.querySelectorAll('img[src="x"]').length }));
      assert.deepEqual(r, { fired: 0, imgs: 0 });
      assert.equal((await text(page, '#unitToggleBtn')), 'oz', 'an unknown unit falls back to oz');
    });
  });

  test('the app only ever reaches out to its font host (guards the "no tracking" promise against new third parties)', async () => {
    await withApp(h, async (page) => {
      for (const tab of ['history', 'inventory', 'settings', 'pump']) await goTab(page, tab);
      const allowed = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
      const unexpected = [...page.probe.thirdParty].filter((host) => !allowed.has(host));
      assert.deepEqual(unexpected, [], 'a new third-party host appeared — is it compatible with "No accounts, ads, or tracking"?');
    });
  });
});
