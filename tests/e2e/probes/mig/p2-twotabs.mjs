// Two v2 tabs boot at the same time on a v1 database. Tab B's settings load
// happens before tab A's migration commits (forced ordering here; in real life
// a race when two tabs restore together after the update).
import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const A = await open();
const B = await open();
await A.evaluate(() => P.seed({ settings: [['babyName', 'Clara'], ['themeMode', 'dark'], ['dailyGoalOz', 30], ['onboarding_completed', true], ['parentName', 'Nick']],
  sessions: [{ id: 'sess_1', type: 'feed', feedType: 'formula', startTime: P.NOW - 3600e3, endTime: P.NOW - 3600e3, durationSec: 0, outputQty: 4, unit: 'oz', notes: '', createdAt: P.NOW - 3600e3 }] }));
await A.evaluate(() => P.mods());
await B.evaluate(() => P.mods());
// Tab B: runMigration's first step (settings load via deviceId) has run...
await B.evaluate(() => P.settings.load());
// ...then tab A runs the whole migration.
const a = await A.evaluate(async () => ({ report: await P.migrate.runMigration(), babies: P.settings.get('babies'), theme: P.settings.get('theme'), onboarded: P.settings.get('onboarded'), goal: P.settings.get('pumpGoalOz') }));
// Tab B now finishes its own runMigration (skipped: A set migratedV2).
const b = await B.evaluate(async () => ({ report: await P.migrate.runMigration(), babies: P.settings.get('babies'), theme: P.settings.get('theme'), onboarded: P.settings.get('onboarded'), goal: P.settings.get('pumpGoalOz'), migratedV2: P.settings.get('migratedV2') }));
// Parent adds a twin in tab B (any babies write from B does the same).
const afterTwin = await B.evaluate(async () => { await P.settings.addBaby({ name: 'Theo' }); return null; });
const stored = await A.evaluate(async () => (await P.rawDump()).settings.find(r => r.key === 'babies').value.map(b => b.name));
console.log(JSON.stringify({ tabA: a, tabB: b, storedBabyNamesAfterTwinAddedInTabB: stored }, null, 2));
const fail = [];
if (b.theme !== 'dark') fail.push(`tab B theme=${b.theme} (expected dark)`);
if (b.onboarded !== true) fail.push(`tab B onboarded=${b.onboarded} (expected true -> B would show onboarding again)`);
if (b.goal !== 30) fail.push(`tab B pumpGoalOz=${b.goal} (expected 30)`);
if (!stored.includes('Clara')) fail.push(`baby name "Clara" lost from DB: ${JSON.stringify(stored)}`);
console.log(fail.length ? `FAIL\n  ${fail.join('\n  ')}` : 'PASS');
await browser.close();
