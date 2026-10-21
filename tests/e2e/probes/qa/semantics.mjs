// DESIGN §11 ARIA patterns: segmented radiogroup + arrows, stepper spinbutton, day pager tablist,
// nav aria-current, switches, strip/split role=img, toast buttons, nested sheet Esc + focus restore, drag-to-dismiss.
import { launch, freshApp, startEvent, shot, activeDesc } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
const p = (...a) => console.log(...a);

// nav
p('nav:', JSON.stringify(await page.$$eval('#tabBar button, #tabBar a', (bs) => bs.map((b) => `${b.textContent.trim() || b.getAttribute('aria-label')}${b.getAttribute('aria-current') ? '[current=' + b.getAttribute('aria-current') + ']' : ''}${b.getAttribute('aria-selected') ? '[sel]' : ''}${b.getAttribute('role') ? '[role=' + b.getAttribute('role') + ']' : ''}`))));

// feed sheet: segmented + stepper
await page.click('.ql[data-card="feed"]'); await page.waitForTimeout(700);
const seg = await page.evaluate(() => [...document.querySelectorAll('.sheet-layer:last-child [role="radiogroup"]')].map((g) => ({ label: g.getAttribute('aria-label') || g.getAttribute('aria-labelledby'), radios: [...g.querySelectorAll('[role="radio"], input[type="radio"]')].map((r) => `${(r.getAttribute('aria-label') || r.textContent || r.value).trim()}:${r.getAttribute('aria-checked') ?? r.checked}:tabindex=${r.getAttribute('tabindex')}`) })));
p('radiogroups in feed sheet:', JSON.stringify(seg));
const first = await page.$('.sheet-layer:last-child [role="radiogroup"] [role="radio"][aria-checked="true"], .sheet-layer:last-child [role="radiogroup"] input:checked');
if (first) { await first.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); p('after ArrowRight focus:', await activeDesc(page), 'checked now:', await page.evaluate(() => [...document.querySelectorAll('.sheet-layer:last-child [role="radiogroup"]')][0].querySelector('[aria-checked="true"], input:checked')?.textContent?.trim())); }
const spin = await page.evaluate(() => [...document.querySelectorAll('.sheet-layer:last-child [role="spinbutton"]')].map((s) => `${s.tagName} now=${s.getAttribute('aria-valuenow')} min=${s.getAttribute('aria-valuemin')} max=${s.getAttribute('aria-valuemax')} text=${s.getAttribute('aria-valuetext')} label=${s.getAttribute('aria-label')}`));
p('spinbuttons:', JSON.stringify(spin));
const sp = await page.$('.sheet-layer:last-child [role="spinbutton"]');
if (sp) { await sp.focus(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(200); p('after ArrowUp on spinbutton:', await sp.getAttribute('aria-valuetext'), await sp.getAttribute('aria-valuenow')); }
const amt = await page.evaluate(() => { const i = document.querySelector('.sheet-layer:last-child .fd-value-input'); if (!i) return null; const r = i.getBoundingClientRect(); const lab = i.closest('label, .fd-value, [class*="hero"]'); const lr = lab && lab.getBoundingClientRect(); return { input: `${Math.round(r.width)}x${Math.round(r.height)}`, wrapper: lab ? `${lab.tagName}.${lab.className} ${Math.round(lr.width)}x${Math.round(lr.height)}` : null }; });
p('amount input + wrapper:', JSON.stringify(amt));
// nested: time chip -> picker -> Esc -> Esc
await page.click('.sheet-layer:last-child .time-chip'); await page.waitForTimeout(700);
p('layers after time chip:', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page));
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
p('after Esc 1: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page));
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
p('after Esc 2: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page));

// drag-to-dismiss with touch-like pointer drag on the grabber
await page.click('.ql[data-card="diaper"]'); await page.waitForTimeout(700);
const g = await page.$eval('.sheet-layer:last-child .sheet', (s) => { const r = s.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 12, h: r.height }; });
await page.mouse.move(g.x, g.y); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(g.x, g.y + i * 15); await page.waitForTimeout(16); }
const mid = await page.evaluate(() => { const L = document.querySelector('.sheet-layer:last-child'); return { y: Math.round(L.querySelector('.sheet').getBoundingClientRect().y), scrim: (+getComputedStyle(L.querySelector('.sheet-scrim')).opacity).toFixed(2) }; });
p('mid-drag (150px down):', JSON.stringify(mid), 'start y', Math.round(g.y - 12));
for (let i = 11; i <= 20; i++) { await page.mouse.move(g.x, g.y + i * 15); await page.waitForTimeout(16); }
await page.mouse.up(); await page.waitForTimeout(800);
p('after release 300px:', await page.$$eval('.sheet-layer', (l) => l.length), 'layers; focus', await activeDesc(page));

// timeline: pager + strip
await page.click('#tabBar button:has-text("Timeline")'); await page.waitForTimeout(800);
p('pager:', JSON.stringify(await page.evaluate(() => { const tl = document.querySelector('[data-view="timeline"] [role="tablist"]'); return tl ? { tabs: [...tl.querySelectorAll('[role="tab"]')].length, selected: [...tl.querySelectorAll('[aria-selected="true"]')].map((t) => t.getAttribute('aria-label') || t.textContent.trim().replace(/\s+/g, ' ')), roving: [...tl.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('tabindex')).join(',') } : 'NO TABLIST'; })));
const selTab = await page.$('[data-view="timeline"] [role="tab"][aria-selected="true"]');
if (selTab) { await selTab.focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500); p('pager ArrowLeft → focus', await activeDesc(page)); }
p('imgs:', JSON.stringify(await page.$$eval('[role="img"]', (is) => is.map((i) => (i.getAttribute('aria-label') || 'NO LABEL').slice(0, 80)))));
// settings switches
await page.click('#tabBar button:has-text("Today")'); await page.waitForTimeout(600);
await page.click('[data-action="settings"]'); await page.waitForTimeout(800);
p('switches:', JSON.stringify(await page.$$eval('[role="switch"]', (s) => s.map((x) => { const r = x.getBoundingClientRect(); return `${(x.getAttribute('aria-label') || x.textContent).trim().replace(/\s+/g, ' ').slice(0, 30)} checked=${x.getAttribute('aria-checked')} ${Math.round(r.width)}x${Math.round(r.height)}`; }))));
await page.goBack(); await page.waitForTimeout(700);
// toast buttons size
await page.click('#fab'); await page.waitForTimeout(700); await page.click('[data-diaper="wet"]'); await page.waitForTimeout(1300);
p('toast:', JSON.stringify(await page.$$eval('#toastRoot button', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return `${b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`; }))));
await shot(page, 'toast-wet');
p('errors', page.errors);
await context.close(); await browser.close();
