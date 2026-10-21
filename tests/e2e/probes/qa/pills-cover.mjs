// Does the two-pill stack cover content at the bottom of each scrolled tab?
import { launch, freshApp, startEvent, shot } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
// more rows so the list scrolls
await page.evaluate(async (u) => { const { events } = await import(u); const now = Date.now();
  for (let i = 0; i < 8; i++) await events.add({ type: 'diaper', startTime: now - (200 + i * 20) * 60000, data: { kind: 'wet' } }); }, 'http://127.0.0.1:8347/js/core/store.js');
for (const n of [0, 1, 2]) {
  if (n >= 1) await startEvent(page, n === 1 ? 'sleep' : 'feed', n === 1 ? { kind: 'nap' } : { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, n === 1 ? 50 : 10);
  for (const tab of ['Today', 'Timeline', 'Memories']) {
    await page.click(`#tabBar :is(button,a):has-text("${tab}")`); await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const sc = document.querySelector('#viewport [data-view]:not([hidden])') || document.scrollingElement;
      const scroller = [...document.querySelectorAll('#viewport *')].find(e => e.scrollHeight > e.clientHeight + 5 && getComputedStyle(e).overflowY !== 'visible' && e.offsetParent !== null) || document.scrollingElement;
      scroller.scrollTop = 1e6;
      const pills = [...document.querySelectorAll('#livePills > *')].filter(p => p.getBoundingClientRect().height > 0);
      const pillTop = pills.length ? Math.min(...pills.map(p => p.getBoundingClientRect().top)) : document.querySelector('#tabBar').getBoundingClientRect().top;
      const view = document.querySelector('#viewport section:not([hidden]), #viewport [data-view]');
      const all = [...view.querySelectorAll('button, a, p, li, h2, h3')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0);
      const lastBottom = Math.max(...all.map(e => e.getBoundingClientRect().bottom));
      const lastEl = all.find(e => e.getBoundingClientRect().bottom === lastBottom);
      return { pills: pills.length, pillTop: Math.round(pillTop), lastBottom: Math.round(lastBottom), last: (lastEl.textContent||'').trim().slice(0,40), scroller: scroller.tagName + '.' + scroller.className };
    });
    console.log(n, tab, JSON.stringify(r), r.lastBottom > r.pillTop ? 'COVERED' : 'ok');
    await page.waitForTimeout(300);
    await shot(page, `cover-${n}-${tab}`);
  }
}
await context.close(); await browser.close();
