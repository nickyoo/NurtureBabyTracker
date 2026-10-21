// Two tabs boot simultaneously (no forced ordering) — how often is one tab left with a stale settings cache?
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const port = process.argv[2] || 8173;
const N = Number(process.argv[3] || 10);
const browser = await chromium.launch();
let stale = 0; const details = [];
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext();
  const url = `http://127.0.0.1:${port}/tests/e2e/probes/mig/mig.html`;
  const A = await ctx.newPage(); await A.goto(url); await A.waitForFunction(() => window.__ready);
  await A.evaluate(() => P.seed({ settings: [['babyName', 'Clara'], ['themeMode', 'dark'], ['onboarding_completed', true]] }));
  const B = await ctx.newPage(); await B.goto(url); await B.waitForFunction(() => window.__ready);
  await Promise.all([A.evaluate(() => P.mods()), B.evaluate(() => P.mods())]);
  // Fire both boots in the same tick-ish.
  await Promise.all([A.evaluate(() => { window.__m = P.migrate.runMigration(); }), B.evaluate(() => { window.__m = P.migrate.runMigration(); })]);
  const read = p => p.evaluate(async () => { const r = await window.__m; return { skipped: r.skipped, name: P.settings.get('babies')[0]?.name, nBabies: P.settings.get('babies').length, theme: P.settings.get('theme'), onboarded: P.settings.get('onboarded') }; });
  const [a, b] = await Promise.all([read(A), read(B)]);
  const bad = [a, b].some(x => x.name !== 'Clara' || x.theme !== 'dark' || x.onboarded !== true || x.nBabies !== 1);
  if (bad) stale += 1;
  details.push({ a, b });
  await ctx.close();
}
console.log(JSON.stringify(details.slice(0, 4), null, 1));
console.log(`${stale}/${N} runs left a tab with a stale/wrong settings view`);
await browser.close();
