// Keyboard-only: focus order, visible focus ring, sheet trap + restore, + / quick log, pushed screens, toast Undo.
import { launch, freshApp, startEvent, shot } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 3);
await page.waitForTimeout(800);
const cur = () => page.evaluate(() => {
  const a = document.activeElement; if (!a || a === document.body) return { d: 'BODY' };
  const cs = getComputedStyle(a); const ring = (cs.boxShadow !== 'none' ? 'shadow' : '') + (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? 'outline' : '');
  const inSheet = !!a.closest('.sheet-layer'); const top = [...document.querySelectorAll('.sheet-layer')].pop();
  const r = a.getBoundingClientRect();
  return { d: `${a.tagName.toLowerCase()}${a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : ''} "${(a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45)}"`, ring, inTop: top ? top.contains(a) : null, onScreen: r.bottom > 0 && r.top < innerHeight, role: a.getAttribute('role') };
});
const tabs = async (n, shift = false) => { const out = []; for (let i = 0; i < n; i++) { await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab'); out.push(await cur()); } return out; };
// 1. Today order from the top
await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
const order = await tabs(22);
console.log('--- Today tab order'); order.forEach((o, i) => console.log(String(i + 1).padStart(2), o.d, o.ring ? '' : 'NO-RING', o.onScreen ? '' : 'OFFSCREEN'));
// 2. Card sheet via keyboard
await page.focus('.ql[data-card="diaper"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
console.log('--- diaper sheet: initial focus', JSON.stringify(await cur()));
const trap = await tabs(25); const leak = trap.filter(t => !t.inTop);
console.log('trap forward leaks:', leak.length, leak.slice(0, 3).map(l => l.d));
const trapB = await tabs(25, true); console.log('trap backward leaks:', trapB.filter(t => !t.inTop).length);
console.log('sheet stops:', [...new Set(trap.map(t => t.d))].join(' | '));
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
console.log('after Esc focus:', JSON.stringify(await cur()));
// 3. + via keyboard
await page.focus('#fab'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
console.log('--- quick log initial focus', JSON.stringify(await cur()));
const ql = await tabs(20); console.log('quick log stops:', [...new Set(ql.map(t => t.d + (t.inTop ? '' : ' [OUTSIDE]')))].join(' | '));
await page.keyboard.press('Escape'); await page.waitForTimeout(900);
console.log('after Esc focus:', JSON.stringify(await cur()));
// 4. Pill keyboard
await page.focus('#livePills .lpill-open'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
console.log('--- pill sheet initial focus', JSON.stringify(await cur()));
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
console.log('after Esc focus:', JSON.stringify(await cur()));
// 5. pushed screen
await page.focus('[data-action="settings"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
console.log('--- settings focus', JSON.stringify(await cur()));
const so = await tabs(6); console.log('settings first stops:', so.map(t => t.d).join(' | '));
await page.goBack(); await page.waitForTimeout(800);
console.log('after back focus:', JSON.stringify(await cur()));
// 6. Toast Undo reachable? one-tap diaper via keyboard
await page.focus('#fab'); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
await page.focus('[data-diaper="wet"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
console.log('--- after one-tap Wet focus', JSON.stringify(await cur()));
const after = await tabs(3); console.log('next tabs:', after.map(t => t.d).join(' | '));
const toastBtns = await page.$$eval('#toastRoot button', bs => bs.map(b => b.textContent.trim()));
console.log('toast buttons:', toastBtns);
await context.close(); await browser.close();
