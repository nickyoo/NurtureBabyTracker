// Screenshot every main screen in light and night for comparison with docs/design/final.
import { launch, freshApp, setTheme, startEvent, shot, OUT } from './lib.mjs';
const browser = await launch();
for (const theme of ['light', 'dark']) {
  const { context, page } = await freshApp(browser, { theme });
  await setTheme(page, theme);
  await startEvent(page, 'sleep', { kind: 'nap' }, 55);
  await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 12);
  await page.waitForTimeout(800);
  await shot(page, `today-${theme}`);
  await page.click('#tabBar [data-tab="timeline"], #tabBar a[href*="timeline"], #tabBar button:has-text("Timeline")');
  await page.waitForTimeout(800); await shot(page, `timeline-${theme}`);
  await page.click('#tabBar button:has-text("Stash"), #tabBar a:has-text("Stash")');
  await page.waitForTimeout(800); await shot(page, `stash-${theme}`);
  await page.click('#tabBar button:has-text("Memories"), #tabBar a:has-text("Memories")');
  await page.waitForTimeout(800); await shot(page, `memories-${theme}`);
  await page.click('#tabBar button:has-text("Today"), #tabBar a:has-text("Today")');
  await page.waitForTimeout(800);
  await page.click('#tabBar .fab, #tabBar [data-action="fab"], #tabBar button[aria-label*="Log"]');
  await page.waitForTimeout(900); await shot(page, `quicklog-${theme}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  console.log(theme, 'errors', page.errors);
  await context.close();
}
await browser.close();
console.log('out', OUT);
