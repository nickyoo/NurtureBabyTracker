// v1 pump pouches come in 0.25 oz steps (timer.adjustPumpOutput ±0.25) and
// can be stored as strings by v1 importBackup. Editing ONLY the note (or the
// location) of such a v1 pouch in v2 silently rewrites its quantity.
import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8147);
const page = await open();
const r = await page.evaluate(async () => {
  const { NOW } = P; const D = 864e5;
  const inventory = [
    { id: 'inv_q', pumpedAt: NOW - D, quantity: 3.75, unit: 'oz', location: 'fridge', expiresAt: NOW + 3 * D, status: 'active', notes: 'Pumped session (20:00)', createdAt: NOW - D },
    { id: 'inv_q2', pumpedAt: NOW - D, quantity: 4.25, unit: 'oz', location: 'fridge', expiresAt: NOW + 3 * D, status: 'active', notes: '', createdAt: NOW - D },
    { id: 'inv_s', pumpedAt: NOW - D, quantity: '4', unit: 'oz', location: 'freezer', expiresAt: NOW + 100 * D, status: 'active', notes: '', createdAt: NOW - D },
  ];
  await P.seed({ inventory });
  await P.mods(); await P.migrate.runMigration();
  const before = (await P.stash.summary()).totalOz;
  const a = await P.stash.update('inv_q', { notes: 'top shelf' });
  const b = await P.stash.update('inv_q2', { location: 'freezer' });
  const c = await P.stash.update('inv_s', { notes: 'label says 4oz' });
  const after = (await P.stash.summary()).totalOz;
  return { before, after, inv_q: [3.75, a.quantity], inv_q2: [4.25, b.quantity], inv_s: ['4', c.quantity] };
});
console.log(JSON.stringify(r));
const bad = [r.inv_q, r.inv_q2, r.inv_s].filter(([was, now]) => Number(was) !== now);
console.log(bad.length ? `FAIL: editing note/location changed quantity: ${bad.map(([a, b]) => `${a} -> ${b}`).join(', ')}; stash total ${r.before} -> ${r.after} oz` : 'PASS');
await browser.close();
