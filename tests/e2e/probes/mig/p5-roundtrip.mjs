import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const A = await open();
const r = await A.evaluate(async () => {
  const { NOW } = P; const DAY = 864e5, HOUR = 36e5;
  const inventory = [
    { id: 'inv_a', pumpedAt: NOW - 2 * DAY, quantity: 4, unit: 'oz', location: 'fridge', expiresAt: NOW + 2 * DAY, status: 'active', notes: '', createdAt: NOW - 2 * DAY },
    { id: 'inv_thawed', pumpedAt: NOW - 30 * DAY, quantity: 5, unit: 'oz', location: 'thawed', thawedAt: NOW - HOUR, expiresAt: NOW + 23 * HOUR, status: 'active', createdAt: NOW - 30 * DAY },
    { id: 'inv_old', pumpedAt: NOW - 400 * DAY, quantity: 3, unit: 'oz', location: 'deepFreezer', expiresAt: NOW - 35 * DAY, status: 'active', notes: 'from last year' },
  ];
  await P.seed({ inventory, sessions: [{ id: 'sess_1', type: 'feed', feedType: 'formula', startTime: NOW - HOUR, endTime: NOW - HOUR, durationSec: 0, outputQty: NaN, unit: 'oz', createdAt: NOW - HOUR }], settings: [['babyName', 'Clara']] });
  await P.mods(); await P.migrate.runMigration();
  const { backup } = await import('../../../../js/core/backup.js');
  const data = await backup.exportBackup();
  const json = JSON.stringify(data);
  const res = await backup.importBackup(json, { mode: 'replace', safetyBackup: () => {} });
  const dump = await P.rawDump();
  return { exportedInv: data.inventory.length, afterInv: dump.inventory.map(i => i.id), stats: res.stats, events: dump.events.map(e => [e.id, e.note, e.data.amount]) };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
