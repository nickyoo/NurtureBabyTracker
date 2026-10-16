import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
export async function setup(port) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const open = async () => {
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('pageerror:', e.message));
    await page.goto(`http://127.0.0.1:${port}/tests/e2e/probes/mig/mig.html`);
    await page.waitForFunction(() => window.__ready === true);
    return page;
  };
  return { browser, ctx, open };
}
