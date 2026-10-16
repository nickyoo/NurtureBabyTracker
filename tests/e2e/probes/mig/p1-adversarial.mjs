import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const page = await open();
const res = await page.evaluate(async () => {
  const { NOW } = P; const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;
  const T = NOW - 3 * DAY;
  const sessions = [
    { id: 'sess_nan', type: 'feed', feedType: 'formula', startTime: T, endTime: T, durationSec: 0, outputQty: NaN, unit: 'mL', notes: 'Formula Feeding', createdAt: T },
    { id: 'sess_str', type: 'feed', feedType: 'breastmilk', startTime: T + HOUR, endTime: T + HOUR, durationSec: '600', outputQty: '4.5', notes: 'Bottle feed (4.0 oz prepared)', createdAt: T + HOUR },
    { id: 'sess_neg', type: 'feed', feedType: 'formula', startTime: T + 2 * HOUR, endTime: T + 2 * HOUR, durationSec: -50, outputQty: -2, unit: 'oz', notes: 'spit up a lot', createdAt: T + 2 * HOUR },
    { id: 'pump_null', type: 'pump', startTime: T + 3 * HOUR, endTime: T + 3 * HOUR + 15 * MIN, durationSec: 900, outputQty: null, unit: 'mL', notes: '', createdAt: T + 3 * HOUR },
    { id: 'pump_ml', type: 'pump', startTime: T + 4 * HOUR, endTime: T + 4 * HOUR + 20 * MIN, durationSec: 1200, outputQty: 120, unit: 'mL', notes: 'left only', createdAt: T + 4 * HOUR },
    { id: 'sess_lower', type: 'feed', feedType: 'breastmilk', startTime: T + 5 * HOUR, endTime: T + 5 * HOUR, durationSec: 0, outputQty: 90, unit: 'ml', notes: 'Breast Milk Feeding', createdAt: T + 5 * HOUR },
    { id: 'sess_bigdur', type: 'feed', feedType: 'formula', startTime: T + 6 * HOUR, endTime: T + 6 * HOUR, durationSec: 1e12, outputQty: 4, unit: 'oz', notes: 'night feed', createdAt: T + 6 * HOUR },
    { id: 'sess_edited', type: 'feed', feedType: 'formula', startTime: T + 7 * HOUR, endTime: T + 9 * HOUR, durationSec: 900, outputQty: 5, unit: 'oz', notes: 'Formula Bottle Feed', createdAt: T + 9 * HOUR, updatedAt: T + 10 * HOUR },
  ];
  const inventory = [
    { id: 'inv_a', pumpedAt: NOW - 2 * DAY, quantity: 4, unit: 'oz', location: 'fridge', expiresAt: NOW + 2 * DAY, status: 'active', notes: '', createdAt: NOW - 2 * DAY },
    { id: 'inv_ml', pumpedAt: NOW - 1 * DAY, quantity: 150, unit: 'mL', location: 'freezer', expiresAt: NOW + 150 * DAY, status: 'active', notes: '', createdAt: NOW - DAY },
    { id: 'inv_nounit', pumpedAt: NOW - 1 * DAY, quantity: 3, location: 'deepFreezer', expiresAt: NOW + 300 * DAY, status: 'active', createdAt: NOW - DAY },
    { id: 'inv_thawed', pumpedAt: NOW - 30 * DAY, quantity: 5, unit: 'oz', location: 'thawed', thawedAt: NOW - HOUR, expiresAt: NOW + 23 * HOUR, status: 'active', notes: '', createdAt: NOW - 30 * DAY },
    { id: 'inv_expired', pumpedAt: NOW - 10 * DAY, quantity: 2, unit: 'oz', location: 'fridge', expiresAt: NOW - 6 * DAY, status: 'expired', notes: '', createdAt: NOW - 10 * DAY },
    { id: 'inv_expiring', pumpedAt: NOW - 5 * DAY, quantity: 2, unit: 'oz', location: 'fridge', expiresAt: NOW - DAY, status: 'active', notes: '', createdAt: NOW - 5 * DAY },
    { id: 'inv_used', pumpedAt: NOW - 10 * DAY, quantity: 3, unit: 'oz', location: 'fridge', expiresAt: NOW - 6 * DAY, status: 'used', usedAt: NOW - 8 * DAY, notes: '', createdAt: NOW - 10 * DAY },
    { id: 'inv_disc', pumpedAt: NOW - 10 * DAY, quantity: 3, unit: 'oz', location: 'room', expiresAt: NOW - 9 * DAY, status: 'discarded', discardedAt: NOW - 9 * DAY, notes: '', createdAt: NOW - 10 * DAY },
  ];
  const settings = [
    ['dailyGoalOz', 30], ['pumpIntervalMinutes', 150], ['units', 'mL'], ['themeMode', 'dark'], ['soundEnabled', false],
    ['storageWindows', { roomTempHours: 4, fridgeDays: 5, freezerMonths: 9, deepFreezerMonths: 12, thawedBottleHours: 24, startedBottleHours: 2 }],
    ['parentName', 'Nick'], ['babyName', 'Clara'], ['onboarding_completed', true],
    ['dailyPumpingGoal', 26], ['preferredUnit', 'oz'], ['reminderIntervalHours', 3], ['someJunk', { a: 1 }],
  ];
  const ls = {
    nurture_active_pump_timer: JSON.stringify({ active: true, type: 'pump', startedAt: NOW - 10 * MIN, pumpOutputOz: 3.5, pumpOutputMl: 100, storeDestination: 'freezer' }),
    savannah_active_pump_timer: JSON.stringify({ active: true, type: 'pump', startedAt: NOW - 99 * MIN, storeDestination: 'fridge' }),
    nurture_bottle_timer: JSON.stringify({ startTs: NOW - 5 * MIN, feedType: 'breastmilk', preparedOz: 4, sourceInventoryId: 'inv_thawed' }),
  };
  await P.seed({ sessions, inventory, settings, ls });
  await P.mods();
  const r1 = await P.migrate.runMigration();
  const r2 = await P.migrate.runMigration();
  const dump = await P.rawDump();
  const evs = dump.events;
  const missing = sessions.filter(s => !evs.some(e => e.migratedFrom === s.id)).map(s => s.id);
  const summary = await P.stash.summary();
  const list = await P.stash.list({ filter: 'everything' });
  return {
    r1, r2,
    eventCount: evs.length,
    missingSessions: missing,
    events: evs.map(e => ({ id: e.id, type: e.type, start: e.startTime - NOW, end: e.endTime === null ? null : e.endTime - NOW, note: e.note, data: e.data, babyId: e.babyId })),
    invBefore: inventory.length, invAfter: dump.inventory.length, invIds: list.map(i => `${i.id}:${i.status}`),
    summary,
    settings: P.settings.all(),
    lsKeys: Object.keys(localStorage),
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
