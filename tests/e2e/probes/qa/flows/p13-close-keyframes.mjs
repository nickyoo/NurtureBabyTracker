// #6: what does the running bottle sheet actually animate on close? (keyframes + per-frame transform)
import * as L from './lib.mjs';
const { log, settle, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 500);
await page.click(`${TOP} [data-start]`); await page.waitForSelector(`${TOP} [data-finish]`); await settle(page, 700);
const capture = () => page.evaluate(() => new Promise((res) => {
  const out = []; const t0 = performance.now(); const seen = new Set();
  const f = () => {
    for (const a of document.getAnimations()) {
      const tg = a.effect && a.effect.target; const key = tg && (tg.className || '').toString().slice(0, 40);
      if (tg && !seen.has(a)) { seen.add(a); out.push({ t: Math.round(performance.now() - t0), target: key, kind: a.constructor.name, name: a.animationName || a.transitionProperty || '', kf: a.effect.getKeyframes ? JSON.stringify(a.effect.getKeyframes().map((k) => ({ transform: k.transform, opacity: k.opacity, clipPath: k.clipPath }))) : '' }); }
    }
    const sh = document.querySelector('.sheet-layer .sheet');
    if (sh) out.push({ t: Math.round(performance.now() - t0), sheetTransform: getComputedStyle(sh).transform, sheetOpacity: getComputedStyle(sh).opacity, top: Math.round(sh.getBoundingClientRect().top) });
    if (performance.now() - t0 < 600) requestAnimationFrame(f); else res(out);
  };
  requestAnimationFrame(f);
}));
let p = capture();
await page.keyboard.press('Escape');
let out = await p;
const kf = out.filter((o) => o.target); const fr = out.filter((o) => o.sheetTransform).filter((_, i) => i % 4 === 0);
log('animations started during close:'); for (const k of kf) log(' ', JSON.stringify(k));
log('sheet per frame:'); for (const f of fr) log(' ', JSON.stringify(f));
// Reopen from the pill, then close again
await settle(page, 800);
const pr = await page.$eval('#livePills .lpill', (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; });
log('pill rect', JSON.stringify(pr));
await page.click('#livePills .lpill .lpill-open'); await L.openTop(page, '.sheet-feed'); await settle(page, 800);
p = capture(); await page.keyboard.press('Escape'); out = await p;
log('FROM PILL — animations during close:'); for (const k of out.filter((o) => o.target)) log(' ', JSON.stringify(k));
log('FROM PILL — sheet per frame:'); for (const f of out.filter((o) => o.sheetTransform).filter((_, i) => i % 4 === 0)) log(' ', JSON.stringify(f));
await L.close();
