import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const A = await open();
const r = await A.evaluate(async () => {
  const { NOW } = P; const H = 36e5;
  const sessions = [1, 2, 3].map(i => ({ id: `sess_${i}`, type: 'feed', feedType: 'formula', startTime: NOW - i * H, endTime: NOW - i * H, durationSec: 0, outputQty: i, unit: 'oz', createdAt: NOW - i * H }));
  await P.seed({ sessions, settings: [['themeMode', 'dark'], ['babyName', 'Clara']] });
  await P.mods();
  await P.migrate.runMigration();
  // Simulate a half-finished earlier run: flag lost, user edits after it.
  await P.events.update('evt_sess_1', { note: 'edited in v2', data: { amount: 9 } });
  await P.events.remove('evt_sess_2');
  await P.settings.set('theme', 'light');
  await P.db.transaction('settings', 'readwrite', s => { s.settings.put({ key: 'migratedV2', value: false }); });
  const rep = await P.migrate.runMigration();
  const e1 = await P.events.get('evt_sess_1');
  const e2 = await P.events.get('evt_sess_2');
  return { rep, e1: [e1.note, e1.data.amount], e2resurrected: !!e2, theme: P.settings.get('theme'), babies: P.settings.get('babies').length, total: (await P.events.query({})).length };
});
console.log(JSON.stringify(r));
await browser.close();
