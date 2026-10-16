import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const port = process.argv[2];
const tests = process.argv.slice(3);
const browser = await chromium.launch();
for (const t of tests) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', r => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) net.push(r.url()); });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(`http://127.0.0.1:${port}/tests/e2e/probes/r1-import/import-probe.html?t=${t}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  console.log(JSON.stringify({ ...(await page.evaluate(() => window.__R)), offOriginRequests: net }));
  await ctx.close();
}
await browser.close();
