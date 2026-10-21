import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8147);
const page = await open();
const r = await page.evaluate(async () => {
  const { NOW } = P; const M = 6e4, H = 36e5;
  await P.seed({
    sessions: [{ id: 'sess_a', type: 'feed', feedType: 'formula', startTime: NOW - H, endTime: NOW - H, durationSec: 0, outputQty: 120, unit: 'mL', createdAt: NOW - H }],
    settings: [['babyName', 'Clara'], ['units', 'mL']],
    ls: {
      savannah_active_pump_timer: JSON.stringify({ active: true, startedAt: NOW - 7 * M, storeDestination: 'none' }),
      nurture_bottle_timer: JSON.stringify({ startTs: NOW - 3 * M, feedType: 'formula', preparedOz: 4 }),
    },
  });
  await P.mods();
  const reps = await Promise.all([P.migrate.runMigration(), P.migrate.runMigration(), P.migrate.runMigration()]);
  const evs = await P.events.query({});
  return { reps: reps.map(x => [x.skipped, x.events, x.liveTimers]), ids: evs.map(e => e.id), babies: P.settings.get('babies').map(b => b.name), running: evs.filter(e => e.endTime === null).length };
});
console.log(JSON.stringify(r));
await browser.close();
