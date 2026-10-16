import { setup } from './drive.mjs';
const { browser, open } = await setup(process.argv[2] || 8173);
const A = await open();
await A.evaluate(() => P.seed({ keepOpen: true, settings: [['babyName', 'Clara']], sessions: [{ id: 'sess_1', type: 'feed', feedType: 'formula', startTime: P.NOW - 3600e3, endTime: P.NOW - 3600e3, durationSec: 0, outputQty: 4, unit: 'oz', createdAt: P.NOW - 3600e3 }] }));
const B = await open();
const r = await B.evaluate(async () => {
  await P.mods();
  let blocked = 0;
  P.db.onDbBlocked(() => { blocked += 1; });
  P._mig = P.migrate.runMigration().then(v => ({ ok: v }), e => ({ err: `${e.name}: ${e.message}` }));
  const first = await Promise.race([P._mig, new Promise(r => setTimeout(() => r('still pending after 1.5s'), 1500))]);
  return { blocked, first };
});
console.log('while v1 tab holds connection:', JSON.stringify(r));
await A.evaluate(() => { P._v1.close(); });
const r2 = await B.evaluate(async () => Promise.race([P._mig, new Promise(r => setTimeout(() => r('still pending 3s after v1 closed'), 3000))]));
console.log('after v1 tab closed its connection:', JSON.stringify(r2));
await browser.close();
