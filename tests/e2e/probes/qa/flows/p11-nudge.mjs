// Backup nudge card at 390 / 360 / 320 widths: does "Not now" wrap? Do both actions work?
import * as L from './lib.mjs';
const { log, settle, shot } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
for (const width of [390, 360, 320]) {
  const { page, context } = await L.fresh({ time: NOW, width });
  await L.onboard(page, { name: 'Robin' });
  await page.evaluate(async ([u, now]) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: now - 9 * 86400000, data: { kind: 'wet' } }); }, [L.mod('/js/core/store.js'), NOW]);
  await page.reload(); await page.waitForSelector('[data-view="today"] [data-note="backup"]', { timeout: 8000 }).catch(() => log('no nudge'));
  await settle(page, 600);
  const m = await page.evaluate(() => {
    const b = document.querySelector('[data-action="snooze-backup"]'); const s = document.querySelector('[data-note="backup"] [data-action="backup"]');
    if (!b) return null;
    const r = b.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(b).lineHeight) || 20;
    const range = document.createRange(); range.selectNodeContents(b); const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
    return { notNow: [Math.round(r.width), Math.round(r.height)], textLines: lines, save: [Math.round(s.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height)] };
  });
  log(`width ${width}:`, JSON.stringify(m));
  await page.evaluate(() => document.querySelector('[data-note="backup"]').scrollIntoView({ block: 'center' }));
  await page.locator('[data-note="backup"]').screenshot({ path: `${L.SHOTS}p11-nudge-${width}.png` });
  if (width === 320) {
    await page.click('[data-action="snooze-backup"]'); await settle(page, 700);
    log('after Not now: nudge present?', !!(await page.$('[data-note="backup"]')));
  }
  await context.close();
}
log('errors', L.errors);
await L.close();
