// Extra motion/a11y checks: nudge overflow at narrow widths, toast vs pills, toast replacement,
// focus after pill Finish, sleep-card icon at 390, 2-baby settings (remove baby?), feedback row.
import { launch, freshApp, startEvent, shot, mod, OUT } from './lib.mjs';
const browser = await launch();

// a) backup nudge at 320/340/360/390: does any action overflow the card?
for (const width of (process.env.SKIP_NUDGE ? [] : [320, 340, 360, 390])) {
  const context = await browser.newContext({ viewport: { width, height: 760 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(mod('/')); await page.waitForSelector('[data-action="start"]'); await page.click('[data-action="start"]'); await page.waitForSelector('[data-view="today"]');
  await page.evaluate(async ([s, st]) => { const { settings } = await import(s); await settings.set('theme', 'light'); const { events } = await import(st); await events.add({ type: 'diaper', startTime: Date.now() - 9 * 86400000, data: { kind: 'wet' } }); }, [mod('/js/core/settings.js'), mod('/js/core/store.js')]);
  await page.reload(); await page.waitForTimeout(1200);
  const card = await page.$('[data-note="backup"]');
  if (!card) { console.log(`nudge ${width}: none`); await context.close(); continue; }
  await card.scrollIntoViewIfNeeded();
  const m = await page.evaluate(() => {
    const c = document.querySelector('[data-note="backup"]').getBoundingClientRect();
    const out = { card: [Math.round(c.left), Math.round(c.right)], docScrollW: document.documentElement.scrollWidth, innerW: innerWidth };
    out.buttons = [...document.querySelectorAll('[data-note="backup"] button')].map((b) => { const r = b.getBoundingClientRect(); return `${b.textContent.trim()} [${Math.round(r.left)}..${Math.round(r.right)}] ${r.right > c.right + 0.5 ? 'OVERFLOWS card by ' + Math.round(r.right - c.right) + 'px' : 'inside'}`; });
    return out;
  });
  console.log(`nudge ${width}:`, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/nudge-${width}.png` });
  await context.close();
}

// b/c) toast with stacked pills + toast replacement + focus after Finish
{
  const { context, page } = await freshApp(browser);
  await startEvent(page, 'sleep', { kind: 'nap' }, 40);
  await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 6);
  await startEvent(page, 'pump', {}, 8);
  await page.waitForTimeout(1200);
  // finish the top pill via keyboard; where does focus land?
  const pills = await page.$$eval('#livePills .lpill', (ps) => ps.map((p) => `${p.dataset.kind}@${Math.round(p.getBoundingClientRect().top)}`));
  console.log('pills', pills.join(' '));
  await page.focus('#livePills .lpill:first-child .lpill-finish');
  const finishing = await page.$eval('#livePills .lpill:first-child', (p) => p.dataset.kind);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => { const a = document.activeElement; return { focus: a === document.body ? 'BODY' : `${a.tagName}.${a.className} "${(a.getAttribute('aria-label') || a.textContent).trim().slice(0, 40)}" connected=${a.isConnected}`, sheet: document.querySelectorAll('.sheet-layer').length, sheetTitle: (document.querySelector('.sheet-layer:last-child .sheet-title, .sheet-layer:last-child h2') || {}).textContent }; });
  console.log(`after keyboard Finish on ${finishing}:`, JSON.stringify(after));
  await shot(page, 'finish-kb-after');
  if (after.sheet) { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
  // toast geometry vs pills
  const geo = await page.evaluate(() => {
    const t = document.querySelector('#toastRoot .toast'); const ps = [...document.querySelectorAll('#livePills .lpill')];
    const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
    return { toast: t ? r(t) : null, pills: ps.map(r) };
  });
  console.log('toast vs pills', JSON.stringify(geo), geo.toast && geo.pills.some(([a, b]) => geo.toast[1] > a && geo.toast[0] < b) ? 'OVERLAP' : 'clear');
  // c) toast replacement: Finish another pill while the toast is up; sample old toast opacity per frame
  const rec = page.evaluate(() => new Promise((res) => { const out = []; const t0 = performance.now(); const tick = () => { const t = Math.round(performance.now() - t0); out.push(`${t}: ` + [...document.querySelectorAll('#toastRoot .toast')].map((x) => `"${x.textContent.trim().slice(0, 18)}" op${(+getComputedStyle(x).opacity).toFixed(2)}`).join(' | ')); if (t < 500) requestAnimationFrame(tick); else res(out); }; requestAnimationFrame(tick); }));
  await page.waitForTimeout(30);
  await page.locator('#livePills .lpill .lpill-finish').last().click();
  const frames = await rec; let prev = ''; for (const f of frames) { const k = f.replace(/^\d+: /, ''); if (k !== prev) console.log('   ', f); prev = k; }
  await context.close();
}

// d) sleep card icon at 390 while running
{
  const { context, page } = await freshApp(browser);
  await startEvent(page, 'sleep', { kind: 'nap' }, 40); await page.waitForTimeout(900);
  const c = await page.$eval('.ql[data-card="sleep"]', (e) => { const l = e.querySelector('.ql-label'); const svg = l.querySelector('svg'); return { tight: e.classList.contains('is-tight'), iconDisplay: svg ? getComputedStyle(svg).display : 'none', labelScroll: l.scrollWidth, labelClient: l.clientWidth, chipW: Math.round(e.querySelector('.live-chip').getBoundingClientRect().width), cardW: Math.round(e.getBoundingClientRect().width) }; });
  console.log('running sleep card', JSON.stringify(c));
  await page.locator('.ql[data-card="sleep"]').screenshot({ path: `${OUT}/sleep-card-running.png` });
  await context.close();
}

// f/g) two babies → Settings: remove baby? feedback row
{
  const { context, page } = await freshApp(browser);
  await page.evaluate(async (s) => { const { settings } = await import(s); if (settings.addBaby) await settings.addBaby({ name: 'Robin', birthDate: '2026-09-01' }); }, mod('/js/core/settings.js')).catch((e) => console.log('addBaby err', e.message));
  await page.click('[data-action="settings"]'); await page.waitForTimeout(800);
  const rows = await page.$$eval('[data-view="settings"] button, [data-view="settings"] a', (bs) => bs.map((b) => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)));
  console.log('settings rows:', rows.join(' | '));
  const babyRow = await page.$('[data-view="settings"] [data-action="baby"]');
  if (babyRow) { await babyRow.click(); await page.waitForTimeout(800); console.log('baby page buttons:', (await page.$$eval('[data-view="settings"]:last-of-type button, .view:last-of-type button', (bs) => bs.map((b) => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)))).join(' | ')); await shot(page, 'baby-page-2babies'); }
  await context.close();
}
await browser.close();
