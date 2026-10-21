// Sample every animation frame while sheets open/close from each origin.
// Prints the top sheet's rect/transform/clip and scrim opacity over time.
import { launch, freshApp, startEvent, OUT } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const sampler = (page, ms) => page.evaluate((ms) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const tick = () => {
    const t = Math.round(performance.now() - t0);
    const layers = [...document.querySelectorAll('.sheet-layer')];
    const L = layers[layers.length - 1];
    const pill = document.querySelector('#livePills .lpill');
    const pr = pill && pill.getBoundingClientRect();
    if (L) {
      const s = L.querySelector('.sheet'); const r = s.getBoundingClientRect(); const cs = getComputedStyle(s);
      const hd = L.querySelector('.sheet-hd').getBoundingClientRect();
      out.push({ t, n: layers.length, st: L.dataset.state, cls: [...L.classList].filter(c => c !== 'sheet-layer').join(' '), y: Math.round(r.y), h: Math.round(r.height), hdY: Math.round(hd.y), op: (+cs.opacity).toFixed(2), tf: cs.transform === 'none' ? '-' : cs.transform.replace('matrix', 'm').slice(0, 44), clip: cs.clipPath === 'none' ? '-' : cs.clipPath.slice(0, 48), scrim: (+getComputedStyle(L.querySelector('.sheet-scrim')).opacity).toFixed(2), pill: pr ? `${Math.round(pr.y)} op${getComputedStyle(pill).opacity}` : '-' });
    } else out.push({ t, none: 1, pill: pr ? `${Math.round(pr.y)} op${getComputedStyle(pill).opacity}` : '-' });
    if (t < ms) requestAnimationFrame(tick); else res(out);
  };
  requestAnimationFrame(tick);
}), ms);

function summarize(name, rows) {
  const lines = [];
  let prev = '';
  for (const r of rows) {
    const k = JSON.stringify({ ...r, t: 0 });
    if (k !== prev) lines.push(`${String(r.t).padStart(4)} ${r.none ? `(no sheet) pill=${r.pill}` : `n${r.n} ${r.st} [${r.cls}] y=${r.y} h=${r.h} hdY=${r.hdY} op=${r.op} tf=${r.tf} clip=${r.clip} scrim=${r.scrim} pill=${r.pill}`}`);
    prev = k;
  }
  const txt = `\n=== ${name}\n${lines.join('\n')}`;
  console.log(txt.split('\n').slice(0, 60).join('\n'));
  return txt;
}

const browser = await launch();
const { context, page } = await freshApp(browser);
let log = '';
async function run(name, action, ms = 900) {
  const p = sampler(page, ms); await page.waitForTimeout(30); await action(); log += summarize(name, await p);
}
// A. card → sheet and back
await run('A open: Fed card', () => page.click('.ql[data-card="feed"]'));
await run('A close: Esc', () => page.keyboard.press('Escape'));
await page.waitForTimeout(400);
// B. + grow
await run('B open: +', () => page.click('#fab'));
await run('B close: × twin', () => page.click('.fab-x'));
await page.waitForTimeout(400);
// C. pill
await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 3);
await page.waitForTimeout(900);
await run('C open: pill body', () => page.click('#livePills .lpill-open'));
await run('C close: Esc (should shrink into pill, #6)', () => page.keyboard.press('Escape'));
await page.waitForTimeout(400);
await run('C2 close by scrim', async () => { await page.click('#livePills .lpill-open'); await page.waitForTimeout(700); await page.mouse.click(195, 40); }, 1500);
await page.waitForTimeout(400);
// D. Timeline row
await page.click('#tabBar :is(button,a):has-text("Timeline")'); await page.waitForTimeout(700);
await run('D open: timeline row', () => page.click('.row[data-event-id]:not(.is-live)'));
await run('D close', () => page.keyboard.press('Escape'));
writeFileSync(`${OUT}/motion-sheets.txt`, log);
console.log('errors', page.errors);
await context.close(); await browser.close();
