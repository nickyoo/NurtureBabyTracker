// Step forward/back inside a sheet (feed flow) and onboarding: outgoing to -32, incoming from +32, height animates, no jump.
import { launch, freshApp, chromium, BASE_URL, shot } from './lib.mjs';
const samp = (page, ms, scope) => page.evaluate(([ms, scope]) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const tick = () => {
    const t = Math.round(performance.now() - t0);
    const root = document.querySelector(scope);
    const steps = root ? [...root.querySelectorAll(scope.includes('sheet') ? '.sheet-step' : '.ob-step, [data-step]')] : [];
    const vp = root && root.querySelector('.sheet-viewport');
    const sh = root && root.querySelector('.sheet');
    out.push(`${String(t).padStart(4)} ${sh ? `sheetY=${Math.round(sh.getBoundingClientRect().y)} ` : ''}${vp ? `vpH=${Math.round(vp.getBoundingClientRect().height)} ` : ''}` + steps.map(s => { const cs = getComputedStyle(s); const r = s.getBoundingClientRect(); return `[${[...s.classList].filter(c => c.startsWith('is')).join(',')}] x=${Math.round(r.x)} op=${(+cs.opacity).toFixed(2)}`; }).join(' '));
    if (t < ms) requestAnimationFrame(tick); else res(out);
  };
  requestAnimationFrame(tick);
}), [ms, scope]);
const dedupe = (a) => a.filter((l, i) => i === 0 || l.slice(5) !== a[i - 1].slice(5));
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('.ql[data-card="feed"]'); await page.waitForTimeout(700);
let p = samp(page, 700, '.sheet-layer:last-child'); await page.waitForTimeout(20);
await page.click('.sheet-layer:last-child button:has-text("Log finished bottle")');
console.log('--- feed: Log finished bottle (forward)\n' + dedupe(await p).join('\n'));
await shot(page, 'step-fwd-end');
const btns = await page.$$eval('.sheet-layer:last-child .sheet-step:not(.is-leaving) button', bs => bs.map(b => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ')));
console.log('buttons now:', btns.join(' | '));
const back = await page.$('.sheet-layer:last-child .sheet-step:not(.is-leaving) button:has-text("Back"), .sheet-layer:last-child [data-action="back"]');
if (back) { p = samp(page, 700, '.sheet-layer:last-child'); await page.waitForTimeout(20); await back.click(); console.log('--- back\n' + dedupe(await p).join('\n')); }
else console.log('NO BACK BUTTON in step 2');
await context.close();
// onboarding steps
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const pg = await ctx2.newPage(); await pg.goto(BASE_URL + '/'); await pg.waitForSelector('[data-view="onboarding"]'); await pg.waitForTimeout(500);
await pg.fill('input[data-field="name"], input[name="name"], #obName', 'Robin').catch(e => console.log('fill fail', e.message.slice(0, 80)));
p = samp(pg, 700, '[data-view="onboarding"]'); await pg.waitForTimeout(20);
await pg.click('[data-view="onboarding"] [data-action="next"]');
console.log('--- onboarding next\n' + dedupe(await p).join('\n').slice(0, 3000));
p = samp(pg, 700, '[data-view="onboarding"]'); await pg.waitForTimeout(20);
await pg.click('[data-view="onboarding"] [data-action="back"]');
console.log('--- onboarding back\n' + dedupe(await p).join('\n').slice(0, 3000));
await ctx2.close(); await browser.close();
