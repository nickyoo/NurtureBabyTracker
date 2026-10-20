// Rapid taps / Esc / Back: no orphaned scrims, inert app, hidden +, stuck views.
import { launch, freshApp, startEvent, shot } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
const state = () => page.evaluate(() => ({
  layers: [...document.querySelectorAll('.sheet-layer')].map(l => l.dataset.state + (l.className.includes('sheet-') ? ':' + l.className.match(/sheet-[a-z]+/g).join('/') : '')),
  appInert: document.getElementById('app').inert,
  hasSheet: document.documentElement.classList.contains('has-sheet'),
  behind: document.getElementById('app').classList.contains('is-behind-sheet'),
  fab: (() => { const f = document.getElementById('fab'); const cs = getComputedStyle(f); return `${[...f.classList].join(' ')} vis=${cs.visibility} op=${cs.opacity}`; })(),
  views: [...document.querySelectorAll('#viewport > section')].filter(s => !s.hidden && getComputedStyle(s).visibility !== 'hidden').map(s => `${s.dataset.view}[${[...s.classList].filter(c => c.startsWith('is-')).join(',')}] op${getComputedStyle(s).opacity}`),
  hist: history.length,
  focus: document.activeElement === document.body ? 'BODY' : (document.activeElement.getAttribute('aria-label') || document.activeElement.className || document.activeElement.tagName),
}));
async function scenario(name, fn) {
  await fn();
  await page.waitForTimeout(1500);
  const s = await state();
  const bad = s.layers.length || s.appInert || s.hasSheet || s.behind || s.views.length !== 1 || /under-sheet|origin/.test(s.fab) || s.focus === 'BODY';
  console.log(`${bad ? 'BAD ' : 'ok  '} ${name}\n     ${JSON.stringify(s)}`);
  if (bad) await shot(page, `rapid-${name.replace(/\W+/g, '-')}`);
}
await scenario('+ then Esc x3 fast', async () => { await page.click('#fab'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); });
await scenario('+ Esc + Esc + Esc (interleaved fast)', async () => { for (let i = 0; i < 3; i++) { await page.click('#fab', { force: true }); await page.waitForTimeout(60); await page.keyboard.press('Escape'); await page.waitForTimeout(60); } });
await scenario('double tap +', async () => { await page.click('#fab'); await page.click('#fab', { force: true }).catch(() => {}); await page.waitForTimeout(800); await page.keyboard.press('Escape'); });
await scenario('quick log → Bottle tile → Esc Esc immediately', async () => { await page.click('#fab'); await page.waitForTimeout(500); await page.click('.sheet-quicklog [data-key="bottle"]'); await page.waitForTimeout(80); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); });
await scenario('card sheet then history back during enter', async () => { await page.click('.ql[data-card="diaper"]'); await page.waitForTimeout(80); await page.goBack(); });
await scenario('card sheet then back + Esc fast', async () => { await page.click('.ql[data-card="feed"]'); await page.waitForTimeout(500); await page.goBack(); await page.keyboard.press('Escape'); });
await page.click('#tabBar :is(button,a):has-text("Today")').catch(() => {}); await page.waitForTimeout(500);
await scenario('rapid tabs Timeline/Stash/Memories/Today', async () => { for (const t of ['Timeline', 'Stash', 'Memories', 'Today', 'Stash', 'Timeline']) { await page.click(`#tabBar :is(button,a):has-text("${t}")`); await page.waitForTimeout(40); } });
await scenario('push settings then back immediately', async () => { await page.click('#tabBar :is(button,a):has-text("Today")'); await page.waitForTimeout(500); await page.click('[data-action="settings"]'); await page.waitForTimeout(60); await page.goBack(); });
await scenario('timeline row → delete → confirm? → back x3', async () => {
  await page.click('#tabBar :is(button,a):has-text("Timeline")'); await page.waitForTimeout(500);
  await page.click('.row[data-event-id]'); await page.waitForTimeout(500);
  const del = await page.$('.sheet-layer:last-child button:has-text("Delete")');
  if (del) { await del.click(); await page.waitForTimeout(100); }
  await page.goBack(); await page.waitForTimeout(50); await page.keyboard.press('Escape');
});
await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 3); await page.waitForTimeout(800);
await scenario('pill tap then Esc during grow', async () => { await page.click('#livePills .lpill-open'); await page.waitForTimeout(90); await page.keyboard.press('Escape'); });
await scenario('pill Finish double-tap then Esc', async () => { await page.click('#livePills .lpill button:has-text("Finish")'); await page.click('#livePills .lpill button:has-text("Finish")', { force: true, timeout: 500 }).catch(() => {}); await page.waitForTimeout(150); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); });
console.log('errors', page.errors);
await context.close(); await browser.close();
