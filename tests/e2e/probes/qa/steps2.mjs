// Feed sheet "Start bottle" morph (#5) and the pump flow's steps.
import { launch, freshApp, shot } from './lib.mjs';
const samp = (page, ms) => page.evaluate((ms) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const tick = () => {
    const t = Math.round(performance.now() - t0);
    const L = [...document.querySelectorAll('.sheet-layer')];
    out.push(`${String(t).padStart(4)} layers=${L.length} ` + L.map(l => { const sh = l.querySelector('.sheet'); const vp = l.querySelector('.sheet-viewport'); return `{${l.dataset.state} y=${Math.round(sh.getBoundingClientRect().y)} vpH=${Math.round(vp.getBoundingClientRect().height)} steps=${[...l.querySelectorAll('.sheet-step')].map(s => `[${[...s.classList].filter(c => c.startsWith('is')).join(',')}]x${Math.round(s.getBoundingClientRect().x)}op${(+getComputedStyle(s).opacity).toFixed(2)}`).join(' ')}}`; }).join(' ') + ` pills=${document.querySelectorAll('#livePills .lpill').length}`);
    if (t < ms) requestAnimationFrame(tick); else res(out);
  };
  requestAnimationFrame(tick);
}), ms);
const dedupe = (a) => a.filter((l, i) => i === 0 || l.slice(5) !== a[i - 1].slice(5));
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('.ql[data-card="feed"]'); await page.waitForTimeout(700);
let p = samp(page, 1200); await page.waitForTimeout(20);
await page.click('.sheet-layer:last-child button:has-text("Start bottle")');
console.log('--- Start bottle\n' + dedupe(await p).join('\n'));
await shot(page, 'start-bottle-after');
console.log('buttons:', (await page.$$eval('.sheet-layer:last-child .sheet-step:not(.is-leaving) button', bs => bs.map(b => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ')))).join(' | '));
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
// pump card
await page.click('.ql[data-card="pump"]'); await page.waitForTimeout(700);
console.log('pump buttons:', (await page.$$eval('.sheet-layer:last-child .sheet-step button', bs => bs.map(b => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ')))).join(' | '));
await shot(page, 'pump-sheet');
await context.close(); await browser.close();
