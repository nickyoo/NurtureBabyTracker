// Populated Stash + Memories (light + night) for comparison with frames 5/6, plus a11y audit on them.
import { launch, freshApp, setTheme, shot, mod } from './lib.mjs';
import { auditFn } from './audit-lib.mjs';
const browser = await launch();
const pr = (theme, label, r) => { const lines = []; for (const [k, v] of Object.entries(r)) if (v.length) lines.push(`   ${k} (${v.length}):\n      ${[...new Set(v)].slice(0, 10).join('\n      ')}`); console.log(`[${theme}] ${label}${lines.length ? '\n' + lines.join('\n') : '  clean'}`); };
for (const theme of ['light', 'dark']) {
  const { context, page } = await freshApp(browser, { theme });
  await setTheme(page, theme);
  await page.evaluate(async ([s, st]) => {
    const { stash } = await import(s); const { events } = await import(st);
    const D = 86400000, now = Date.now();
    await stash.add({ pumpedAt: now - 1.1 * D, quantity: 5.5, unit: 'oz', location: 'fridge' });
    await stash.add({ pumpedAt: now - 0.2 * D, quantity: 3.5, unit: 'oz', location: 'fridge' });
    for (let i = 0; i < 8; i++) await stash.add({ pumpedAt: now - (48 - i * 3) * D, quantity: 4 + (i % 3) * 0.5, unit: 'oz', location: 'freezer' });
    await events.add({ type: 'milestone', startTime: now - 11 * D, data: { key: null, title: 'First smile', photoIds: [] } });
    await events.add({ type: 'milestone', startTime: now - 4 * D, data: { key: null, title: 'Held head up', photoIds: [] } });
  }, [mod('/js/core/stash.js'), mod('/js/core/store.js')]);
  await page.waitForTimeout(500);
  await page.click('#tabBar button:has-text("Stash")'); await page.waitForTimeout(900);
  await shot(page, `pop-stash-${theme}`);
  pr(theme, 'Stash populated', await page.evaluate(auditFn));
  await page.click('#tabBar button:has-text("Memories")'); await page.waitForTimeout(900);
  await shot(page, `pop-memories-${theme}`);
  pr(theme, 'Memories populated', await page.evaluate(auditFn));
  await page.click('#tabBar button:has-text("Today")'); await page.waitForTimeout(900);
  const sleepCard = await page.$eval('.ql[data-card="sleep"]', (e) => ({ icon: !!e.querySelector('svg use, svg'), html: e.innerHTML.replace(/\s+/g, ' ').slice(0, 300) }));
  console.log('sleep card idle', JSON.stringify(sleepCard));
  await context.close();
}
await browser.close();
