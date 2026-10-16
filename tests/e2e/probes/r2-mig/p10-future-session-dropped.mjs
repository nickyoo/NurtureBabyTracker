// A v1 session whose time the parent edited to a later day (v1's edit modal
// accepts any datetime-local) is silently dropped by the migration.
import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8147);
const page = await open();
const r = await page.evaluate(async () => {
  const { NOW } = P; const H = 36e5, D = 24 * H;
  const sessions = [
    { id: 'sess_ok', type: 'feed', feedType: 'formula', startTime: NOW - 2 * H, endTime: NOW - 2 * H, durationSec: 0, outputQty: 4, unit: 'oz', notes: 'Formula Feeding', createdAt: NOW - 2 * H },
    // v1 applySessionEdits: startTime moved to 3 days ahead (wrong day picked), endTime unchanged
    { id: 'sess_wrongday', type: 'feed', feedType: 'breastmilk', startTime: NOW + 3 * D, endTime: NOW - 5 * H, durationSec: 0, outputQty: 5, unit: 'oz', notes: 'first bottle from daddy', createdAt: NOW - 5 * H, updatedAt: NOW - 4 * H },
    // v1 pump edited with a year typo (2062): real 6 oz of output
    { id: 'pump_typo', type: 'pump', startTime: Date.UTC(2062, 0, 5, 9), endTime: Date.UTC(2062, 0, 5, 9, 20), durationSec: 1200, outputQty: 6, unit: 'oz', notes: '', createdAt: NOW - 6 * H, updatedAt: NOW - 6 * H },
  ];
  await P.seed({ sessions, settings: [['babyName', 'Clara'], ['onboarding_completed', true]] });
  await P.mods();
  const rep = await P.migrate.runMigration();
  const evs = await P.events.query({});
  const dump = await P.rawDump();
  return {
    report: rep,
    v1Sessions: dump.sessions.length,
    v2Events: evs.map(e => e.migratedFrom),
    lost: sessions.map(s => s.id).filter(id => !evs.some(e => e.migratedFrom === id)),
  };
});
console.log(JSON.stringify(r, null, 1));
console.log(r.lost.length ? `FAIL: ${r.lost.length} v1 session(s) silently dropped by migration: ${r.lost.join(', ')} (report.events=${r.report.events}, no rejected count)` : 'PASS');
await browser.close();
