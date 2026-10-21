// Run the a11y audit on every reachable screen and sheet, light and night.
import { launch, freshApp, setTheme, startEvent, shot, mod } from './lib.mjs';
import { auditFn } from './audit-lib.mjs';
const browser = await launch();
const only = process.argv[2];
for (const theme of ['light', 'dark']) {
  const { context, page } = await freshApp(browser, { theme });
  await setTheme(page, theme);
  // seed stash + memory so those screens have content
  await page.evaluate(async ([s]) => { const m = await import(s); const st = m.stash || m.default || m; const fn = st.add || st.addPouch; if (fn) { try { await fn({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: Date.now() - 40 * 86400000 }); await fn({ quantity: 5.5, unit: 'oz', location: 'fridge', pumpedAt: Date.now() - 86400000 }); } catch (e) { console.log('stash seed', e.message); } } else console.log('stash exports', Object.keys(m)); }, [mod('/js/core/stash.js')]);
  await startEvent(page, 'sleep', { kind: 'nap' }, 40);
  await page.waitForTimeout(800);
  const audit = async (label) => { if (only && !label.includes(only)) return; const r = await page.evaluate(auditFn); const lines = []; for (const [k, v] of Object.entries(r)) if (v.length) lines.push(`   ${k} (${v.length}):\n      ${[...new Set(v)].slice(0, 12).join('\n      ')}`); console.log(`[${theme}] ${label}${lines.length ? '\n' + lines.join('\n') : '  clean'}`); };
  const tab = async (t) => { await page.click(`#tabBar :is(button,a):has-text("${t}")`); await page.waitForTimeout(700); };
  await audit('Today');
  await tab('Timeline'); await audit('Timeline');
  await tab('Stash'); await audit('Stash'); await shot(page, `audit-stash-${theme}`);
  await tab('Memories'); await audit('Memories');
  await tab('Today');
  for (const card of ['feed', 'sleep', 'diaper', 'pump']) { await page.click(`.ql[data-card="${card}"]`); await page.waitForTimeout(700); await audit(`sheet:${card} card`); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
  await page.click('#fab'); await page.waitForTimeout(800); await audit('sheet:quick log'); 
  await page.click('.sheet-quicklog [data-when]'); await page.waitForTimeout(700); await audit('sheet:time picker'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.click('.sheet-quicklog [data-key="breastfeed"], .sheet-quicklog [data-key="breast"]').catch(() => {}); await page.waitForTimeout(800); await audit('sheet:breastfeed'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  if (await page.$('.sheet-layer')) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
  console.log('   pills now:', await page.$$eval('#livePills .lpill', ps => ps.map(p => p.getAttribute('aria-label'))));
  if (!(await page.$('#livePills .lpill-open'))) { await startEvent(page, 'sleep', { kind: 'nap' }, 40); await page.waitForTimeout(800); }
  await page.click('#livePills .lpill-open'); await page.waitForTimeout(700); await audit('sheet:pill (sleep)'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await tab('Timeline'); await page.click('.row[data-event-id]:not(.is-live)'); await page.waitForTimeout(700); await audit('sheet:event detail'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await tab('Stash'); const pouch = await page.$('#viewport section:not([hidden]) [data-id], #viewport section:not([hidden]) .row'); if (pouch) { await pouch.click(); await page.waitForTimeout(700); await audit('sheet:pouch'); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
  await tab('Today');
  await page.click('[data-action="settings"]'); await page.waitForTimeout(700); await audit('Settings'); await shot(page, `audit-settings-${theme}`);
  const rows = await page.$$eval('#viewport section:not([hidden]):last-of-type button.set-row, #viewport section:last-of-type [data-page]', bs => bs.map(b => b.getAttribute('data-page') || b.getAttribute('data-action')).filter(Boolean));
  console.log('settings rows:', rows.join(','));
  for (const r of [...new Set(rows)]) {
    const el = await page.$(`#viewport section:last-of-type [data-page="${r}"], #viewport section:last-of-type [data-action="${r}"]`);
    if (!el) continue;
    const before = await page.evaluate(() => document.querySelectorAll('#viewport > section').length + ':' + document.querySelectorAll('.sheet-layer').length);
    await el.click().catch(() => {}); await page.waitForTimeout(800);
    const after = await page.evaluate(() => document.querySelectorAll('#viewport > section').length + ':' + document.querySelectorAll('.sheet-layer').length);
    if (after !== before) { await audit(`Settings › ${r}`); await page.goBack(); await page.waitForTimeout(700); }
  }
  console.log('errors', page.errors);
  await context.close();
}
await browser.close();
