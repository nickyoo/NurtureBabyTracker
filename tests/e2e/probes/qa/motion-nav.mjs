// Tab switch, pushed screen, toast, live pill appear/finish, new row insert.
import { launch, freshApp, startEvent, OUT } from './lib.mjs';
import { writeFileSync } from 'node:fs';

// sample all .view sections + pills + toast + any .is-inserting rows
const sampler = (page, ms) => page.evaluate((ms) => new Promise((res) => {
  const out = []; const t0 = performance.now();
  const d = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} op${(+cs.opacity).toFixed(2)}${cs.transform !== 'none' ? ' tf' + cs.transform.replace('matrix', '').slice(0, 40) : ''}${cs.display === 'none' ? ' NONE' : ''}${cs.visibility === 'hidden' ? ' HID' : ''}`; };
  const tick = () => {
    const t = Math.round(performance.now() - t0);
    const row = { t };
    row.views = [...document.querySelectorAll('#viewport > section')].map(s => `${s.dataset.view || s.className.split(' ')[1]}[${[...s.classList].filter(c => c.startsWith('is-')).join(',')}${s.hidden ? ',hidden' : ''}] ${d(s)}`).join(' | ');
    row.pills = [...document.querySelectorAll('#livePills .lpill')].map(p => `${p.dataset.kind}:${p.dataset.state} ${d(p)}`).join(' | ');
    row.toast = [...document.querySelectorAll('#toastRoot > *')].map(x => `${(x.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)} ${d(x)}`).join(' | ');
    row.rows = [...document.querySelectorAll('.is-inserting, .row.is-new, .is-removing')].map(x => `${x.className.slice(0, 40)} ${d(x)}`).join(' | ');
    out.push(row);
    if (t < ms) requestAnimationFrame(tick); else res(out);
  };
  requestAnimationFrame(tick);
}), ms);

function summarize(name, rows) {
  const lines = []; let prev = '';
  for (const r of rows) { const k = JSON.stringify({ ...r, t: 0 }); if (k !== prev) lines.push(`${String(r.t).padStart(4)} V: ${r.views}\n      P: ${r.pills}\n      T: ${r.toast}\n      R: ${r.rows}`); prev = k; }
  const txt = `\n=== ${name}\n${lines.join('\n')}`; console.log(txt.split('\n').slice(0, 70).join('\n')); return txt;
}
const browser = await launch();
const { context, page } = await freshApp(browser);
let log = '';
async function run(name, action, ms = 800) { const p = sampler(page, ms); await page.waitForTimeout(30); await action(); log += summarize(name, await p); }

await run('tab Today→Timeline', () => page.click('#tabBar :is(button,a):has-text("Timeline")'));
await run('tab Timeline→Today', () => page.click('#tabBar :is(button,a):has-text("Today")'));
await run('push Settings (avatar)', () => page.click('[data-action="settings"]'));
await page.waitForTimeout(300);
await run('pop Settings (Back)', () => page.goBack());
await page.waitForTimeout(300);
await run('pill appears (background start)', () => startEvent(page, 'sleep', { kind: 'nap' }, 30), 700);
await page.waitForTimeout(500);
await run('pill End nap', () => page.click('#livePills .lpill button:has-text("End nap"), #livePills .lpill [data-action="finish"]'), 1500);
await page.waitForTimeout(800);
await run('quick-log one-tap Wet', async () => { await page.click('#fab'); await page.waitForTimeout(600); await page.click('[data-diaper="wet"]'); }, 2200);
writeFileSync(`${OUT}/motion-nav.txt`, log);
console.log('errors', page.errors);
await context.close(); await browser.close();
