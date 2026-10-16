import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const A = await open();
const r = await A.evaluate(async () => {
  const { NOW } = P; const DAY = 864e5;
  await P.seed({ inventory: [{ id: 'inv_s', pumpedAt: NOW - DAY, quantity: '4', unit: 'oz', location: 'freezer', expiresAt: NOW + 100 * DAY, status: 'active', notes: '', createdAt: NOW - DAY }] });
  await P.mods(); await P.migrate.runMigration();
  const before = await P.stash.summary();
  const after = await P.stash.update('inv_s', { notes: 'top shelf' });
  return { summaryBefore: before.totalOz, quantityAfterNotesEdit: after.quantity, summaryAfter: (await P.stash.summary()).totalOz };
});
console.log(JSON.stringify(r));
console.log(r.quantityAfterNotesEdit === 4 ? 'PASS' : 'FAIL: editing only the note zeroed the pouch');
await browser.close();
