// Timeline DayPager: tap an empty past day, a day with entries, and swipe/arrow paging. What does the parent see?
import * as L from './lib.mjs';
const { log, settle } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await page.evaluate(async ([u, now]) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: now - 86400000, data: { kind: 'wet' } }); await events.add({ type: 'diaper', startTime: now - 3600000, data: { kind: 'dirty' } }); }, [L.mod('/js/core/store.js'), NOW]);
await L.tab(page, 'timeline');
const days = await page.$$eval('[data-view="timeline"] [data-day]', (d) => d.map((x) => `${x.dataset.day}:${x.getAttribute('aria-selected')}:${x.getAttribute('aria-disabled')}:${x.innerText.replace(/\n/g, ' ')}`));
log('days', JSON.stringify(days));
for (const label of ['Fr', 'Mo']) {
  await page.click(`[data-view="timeline"] [data-day]:has-text("${label}")`); await settle(page, 900);
  log(`tap ${label}:`, JSON.stringify((await L.viewText(page, 'timeline')).slice(0, 300)), 'selected', JSON.stringify(await page.$$eval('[data-view="timeline"] [data-day][aria-selected="true"]', (d) => d.map((x) => x.innerText.replace(/\n/g, ' ')))));
  await L.shot2(page, `q10-day-${label}`);
}
log('errors', L.errors);
await L.close();
