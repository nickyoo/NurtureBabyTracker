// Reduced motion (system media + in-app toggle): every transition must be opacity-only.
// For each moment, sample every frame and report any non-identity transform / clip-path / size change on moving surfaces.
import { launch, freshApp, startEvent } from './lib.mjs';

const watch = (page, ms) => page.evaluate((ms) => new Promise((res) => {
  const bad = new Map(); const t0 = performance.now(); let maxT = 0; const opSeen = new Set();
  const sel = '.sheet-layer .sheet, .sheet-layer .sheet-step, .sheet-viewport, .fab-x, #fab, #viewport > section, #livePills .lpill, #toastRoot > *, .is-inserting, .row.is-new, .lpill-well, #app';
  const tick = () => {
    const t = performance.now() - t0;
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      const key = (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').slice(0, 3).join('.');
      const tf = cs.transform;
      const ident = tf === 'none' || tf === 'matrix(1, 0, 0, 1, 0, 0)';
      if (!ident) bad.set(key + ' transform', tf.slice(0, 50));
      if (cs.clipPath !== 'none' && !/inset\(0px/.test(cs.clipPath)) bad.set(key + ' clip', cs.clipPath.slice(0, 50));
      if (cs.translate !== 'none' && cs.translate !== '0px') bad.set(key + ' translate', cs.translate);
      if (cs.scale !== 'none' && cs.scale !== '1') bad.set(key + ' scale', cs.scale);
      if (+cs.opacity < 1 && +cs.opacity > 0) { opSeen.add(key); maxT = Math.max(maxT, t); }
    }
    if (t < ms) requestAnimationFrame(tick); else res({ bad: [...bad].map(([k, v]) => `${k}: ${v}`), fades: [...opSeen].slice(0, 6), lastFadeMs: Math.round(maxT) });
  };
  requestAnimationFrame(tick);
}), ms);

const browser = await launch();
for (const mode of ['media', 'in-app']) {
  const { context, page } = await freshApp(browser, { reduced: mode === 'media' });
  if (mode === 'in-app') {
    await page.click('[data-action="settings"]'); await page.waitForTimeout(600);
    const sw = await page.$('[data-action="motion"]');
    if (!sw) { console.log('no motion switch on settings root'); }
    else { await sw.click(); await page.waitForTimeout(400); console.log('data-motion =', await page.evaluate(() => document.documentElement.dataset.motion), 'aria-checked', await sw.getAttribute('aria-checked')); }
    await page.goBack(); await page.waitForTimeout(600);
  }
  const run = async (name, fn, ms = 700) => { const p = watch(page, ms); await page.waitForTimeout(20); await fn(); const r = await p; console.log(`[${mode}] ${r.bad.length ? 'BAD' : 'ok '} ${name}  lastFade@${r.lastFadeMs}ms ${r.bad.length ? '\n      ' + r.bad.join('\n      ') : ''}`); };
  await run('open card sheet', () => page.click('.ql[data-card="feed"]'));
  const stepBtn = await page.$('.sheet-layer:last-child .sheet-step button.btn-primary, .sheet-layer:last-child [data-action="start-timer"]');
  const labels = await page.$$eval('.sheet-layer:last-child button', bs => bs.map(b => b.textContent.trim().replace(/\s+/g, ' ')).slice(0, 20));
  console.log('   feed sheet buttons:', labels.join(' | '));
  await run('close card sheet', () => page.keyboard.press('Escape'));
  await page.waitForTimeout(300);
  await run('open + quick log', () => page.click('#fab'));
  await run('close quick log', () => page.click('.fab-x'));
  await page.waitForTimeout(300);
  await run('tab → Timeline', () => page.click('#tabBar :is(button,a):has-text("Timeline")'));
  await run('tab → Today', () => page.click('#tabBar :is(button,a):has-text("Today")'));
  await run('push settings', () => page.click('[data-action="settings"]'));
  await run('pop settings', () => page.goBack());
  await run('pill appears', () => startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 2), 900);
  await run('open pill sheet', () => page.click('#livePills .lpill-open'));
  await run('close pill sheet', () => page.keyboard.press('Escape'));
  await page.waitForTimeout(300);
  await run('one-tap Wet (quick log close + row + toast)', async () => { await page.click('#fab'); await page.waitForTimeout(400); await page.click('[data-diaper="wet"]'); }, 1800);
  await page.waitForTimeout(300);
  await run('pill Finish', () => page.click('#livePills .lpill button:has-text("Finish")'), 1500);
  console.log('errors', page.errors);
  await context.close();
}
await browser.close();
