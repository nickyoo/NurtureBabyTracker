// Known gaps: #6 live sheet close → pill, #16 row icon → sheet header chip. Samples geometry per frame.
import * as L from './lib.mjs';
const { log, settle, shot, TOP } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
await page.evaluate(async ([u, now]) => { const { events } = await import(u); await events.add({ type: 'diaper', startTime: now - 20 * 60000, data: { kind: 'wet' } }); }, [L.mod('/js/core/store.js'), NOW]);
await settle(page, 600);
// #6
await L.tile(page, 'bottle'); await L.openTop(page, '.sheet-feed'); await settle(page, 500);
await page.click(`${TOP} [data-start]`); await page.waitForSelector(`${TOP} [data-finish]`); await settle(page, 700);
const sampler = (sel) => page.evaluate((sel) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const f = () => {
    const sheet = document.querySelector('.sheet-layer .sheet') || document.querySelector('.sheet-layer');
    const timer = document.querySelector(sel);
    const pill = document.querySelector('#livePills .lpill');
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    out.push({ t: Math.round(performance.now() - t0), sheet: r(sheet), timer: r(timer), pill: r(pill), pillOpacity: pill ? getComputedStyle(pill).opacity : null, anims: document.getAnimations().map((a) => (a.effect && a.effect.target ? (a.effect.target.className || a.effect.target.tagName).toString().slice(0, 30) : '?')).join(',') });
    if (performance.now() - t0 < 700) requestAnimationFrame(f); else res(out);
  };
  requestAnimationFrame(f);
}), sel);
const p = sampler('.sheet-layer [data-timer]');
await page.keyboard.press('Escape');
const frames = await p;
for (const fr of frames.filter((_, i) => i % 3 === 0)) log('#6', JSON.stringify(fr));
await settle(page, 500);
// #16
await L.dismissToast(page);
const p2 = page.evaluate(() => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const f = () => {
    const chip = document.querySelector('.sheet-layer .sheet-event .ev-chip, .sheet-layer [class*="chip"]');
    const b = chip && chip.getBoundingClientRect();
    out.push({ t: Math.round(performance.now() - t0), chip: chip ? [chip.className.slice(0, 30), Math.round(b.x), Math.round(b.y), Math.round(b.width)] : null, chipAnims: chip ? chip.getAnimations().length : 0, anims: document.getAnimations().map((a) => (a.effect && a.effect.target ? (a.effect.target.className || '').toString().slice(0, 25) : '?')).join(',') });
    if (performance.now() - t0 < 600) requestAnimationFrame(f); else res(out);
  };
  requestAnimationFrame(f);
}));
const rowChip = await page.evaluate(() => { const c = document.querySelector('[data-view="today"] [data-event-id] .row-chip, [data-view="today"] [data-event-id] [class*="chip"]'); const b = c.getBoundingClientRect(); return [c.className, Math.round(b.x), Math.round(b.y)]; });
log('#16 row chip at', JSON.stringify(rowChip));
await page.click('[data-view="today"] [data-event-id]');
const f2 = await p2;
for (const fr of f2.filter((_, i) => i % 3 === 0)) log('#16', JSON.stringify(fr));
await L.close();
