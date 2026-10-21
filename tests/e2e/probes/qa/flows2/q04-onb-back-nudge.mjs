// (a) Android Back during onboarding; (b) backup nudge geometry at 320/360/390; (c) feedback row.
import * as L from './lib.mjs';
const { log, settle } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
{ // (a)
  const { page, context } = await L.fresh({ time: NOW });
  await page.goto(`${L.BASE}/`);
  await page.waitForSelector('[data-view="onboarding"] .ob-step');
  await page.fill('[data-field="name"]', 'Robin');
  await page.click('.ob-step:not(.is-leaving) [data-action="next"]'); await settle(page, 800);
  const stepBefore = await page.evaluate(() => document.querySelector('.ob-step:not(.is-leaving)').dataset.step);
  const visibleBack = await page.$$eval('[data-view="onboarding"] [data-action="back"]', (b) => b.filter((x) => x.offsetParent).map((x) => x.innerText.trim()));
  log('(a) on step', stepBefore, 'in-page buttons:', JSON.stringify(visibleBack), 'history.length', await page.evaluate(() => history.length), 'state', JSON.stringify(await page.evaluate(() => history.state)));
  await L.shot2(page, 'q04-onb-step2-before-back');
  await page.goBack({ timeout: 3000 }).catch((e) => log('goBack err', e.message.slice(0, 60)));
  await settle(page, 700);
  log('(a) after system Back url =', page.url());
  await context.close();
}
for (const width of [320, 360, 390]) { // (b)
  const { page, context } = await L.fresh({ time: NOW, width });
  await L.onboard(page);
  await page.evaluate(async ([u, now]) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: now - 9 * 86400000, data: { kind: 'wet' } }); }, [L.mod('/js/core/store.js'), NOW]);
  await page.reload(); await page.waitForSelector('[data-view="today"] [data-note="backup"]', { timeout: 8000 });
  await settle(page, 700);
  await page.evaluate(() => document.querySelector('[data-note="backup"]').scrollIntoView({ block: 'center' }));
  const g = await page.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; const n = document.querySelector('[data-note="backup"]'); return { card: r(n), save: r(n.querySelector('[data-action="backup"]')), notNow: r(n.querySelector('[data-action="snooze-backup"]')), docW: document.documentElement.scrollWidth, vw: innerWidth }; });
  log(`(b) width ${width}`, JSON.stringify(g), 'saveOverflowsCard', g.save[2] > g.card[2], 'notNowOnOwnRow', g.notNow[1] >= g.save[3]);
  await L.shot2(page, `q04-nudge-${width}`);
  if (width === 390) { // (c)
    await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 800);
    const fb = await page.$$eval('[data-view="settings"] a[href^="mailto"]', (a) => a.map((x) => [x.innerText.replace(/\s+/g, ' ').trim(), x.getAttribute('href')]));
    log('(c) feedback links', JSON.stringify(fb), 'feedbackEmail setting:', JSON.stringify(await L.getSetting(page, 'feedbackEmail')));
  }
  await context.close();
}
await L.close();
