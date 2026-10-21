// Two already-migrated v2 tabs open at once (e.g. installed PWA window + a browser tab on Android).
import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const A = await open();
await A.evaluate(async () => { await P.seed({ settings: [['babyName', 'Clara']] }); await P.mods(); await P.migrate.runMigration(); });
const B = await open();
await B.evaluate(async () => { await P.mods(); await P.migrate.runMigration(); });
// Tab A: parent sets the birth date and renames.
await A.evaluate(async () => { const id = P.settings.get('activeBabyId'); await P.settings.updateBaby(id, { name: 'Clara Rose', birthDate: '2026-08-01' }); });
// Tab B (still open, cache from boot): adds a twin.
await B.evaluate(async () => { await P.settings.addBaby({ name: 'Theo' }); });
const stored = await A.evaluate(async () => (await P.rawDump()).settings.find(r => r.key === 'babies').value);
console.log(JSON.stringify(stored.map(b => ({ name: b.name, birthDate: b.birthDate })), null, 2));
console.log(stored[0].name === 'Clara Rose' && stored[0].birthDate === '2026-08-01' ? 'PASS' : 'FAIL: tab A edit (name + birthDate) silently overwritten by tab B stale cache');
await browser.close();
