// Dead-click hunter: on each main screen, tap every visible thing that looks tappable and
// report the ones where nothing observable happens (no DOM/text change, sheet, view, toast, download, focus move).
import * as L from './lib.mjs';
const { log, settle } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page, { photo: true });
await page.evaluate(async ([u, s, now]) => {
  const { events } = await import(u); const { stash } = await import(s);
  const at = (h) => now - h * 3600000;
  await events.add({ type: 'feed', startTime: at(2), endTime: at(1.8), data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
  await events.add({ type: 'feed', startTime: at(4), endTime: at(3.7), data: { method: 'breast', left: 600, right: 480, lastSide: 'right' } });
  await events.add({ type: 'sleep', startTime: at(6), endTime: at(5), data: { kind: 'nap' } });
  await events.add({ type: 'diaper', startTime: at(1), data: { kind: 'wet' } });
  await events.add({ type: 'pump', startTime: at(3), endTime: at(2.75), data: { amount: 5, unit: 'oz', storedTo: null } });
  await events.add({ type: 'milestone', startTime: at(26), data: { title: 'First bath', photoIds: [] } });
  await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', pumpedAt: now - 20 * 86400000 });
  await stash.add({ quantity: 3, unit: 'oz', location: 'fridge', pumpedAt: now - 86400000 });
}, [L.mod('/js/core/store.js'), L.mod('/js/core/stash.js'), NOW]);
let downloads = 0; page.on('download', () => { downloads += 1; });
let popups = 0; page.context().on('page', () => { popups += 1; });
await page.evaluate(() => { window.__print = 0; window.print = () => { window.__print += 1; }; });
const goView = async (v) => {
  await page.keyboard.press('Escape').catch(() => {});
  for (let k = 0; k < 3 && !(await page.isVisible('#tabBar [data-tab="today"]')); k++) { await page.goBack().catch(() => {}); await settle(page, 600); }
  if (!(await page.isVisible('#tabBar [data-tab="today"]'))) { await page.reload(); await page.waitForSelector('[data-view]'); await settle(page, 1200); await page.evaluate(() => { window.__print = 0; window.print = () => { window.__print += 1; }; }); }
  if (v === 'settings') { await L.tab(page, 'today'); await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 700); }
  else if (v === 'report') { await L.tab(page, 'timeline'); await L.clickView(page, 'timeline', '[data-action="report"]'); await settle(page, 800); }
  else await L.tab(page, v);
};
const CAND = 'button, a[href], [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="link"], label[for], .ql, [data-action], [data-event-id], [data-pouch], [data-open]';
const candidates = (v) => page.evaluate(([v, CAND]) => {
  const list = [...document.querySelectorAll(`#viewport > [data-view="${v}"]`)].filter((x) => !x.classList.contains('is-leaving-right') && !x.classList.contains('is-fading-out'));
  const root = list[list.length - 1]; if (!root) return [];
  const els = [...root.querySelectorAll(CAND)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && e.getAttribute('aria-disabled') !== 'true' && !e.disabled && !e.closest('[inert]'));
  // de-dupe nested (keep outermost interactive)
  const top = els.filter((e) => !els.some((o) => o !== e && o.contains(e) && o.matches('button,a[href],.ql,[data-event-id]')));
  return top.map((e, i) => { e.setAttribute('data-qa-i', String(i)); return `${i}|${e.tagName.toLowerCase()}${e.dataset.action ? `[action=${e.dataset.action}${e.dataset.arg ? ':' + e.dataset.arg : ''}]` : ''}|${(e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)}`; });
}, [v, CAND]);
const SKIP = /erase|Erase|backup|Save a backup|CSV|Import|Calendar|Print|Share CSV|Send feedback|Remove photo|Discard|Delete/;
for (const v of ['today', 'timeline', 'stash', 'memories', 'settings', 'report']) {
  await goView(v);
  const list = await candidates(v);
  log(`\n== ${v}: ${list.length} candidates`);
  for (const item of list) {
    const [i, , label] = item.split('|');
    if (SKIP.test(label)) continue;
    await goView(v);
    await candidates(v);
    const sel = `[data-qa-i="${i}"]`;
    const before = await page.evaluate(([v, sel]) => {
      window.__mut = 0;
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      window.__mo && window.__mo.disconnect();
      window.__mo = new MutationObserver((ms) => { for (const m of ms) { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (t && t.closest && t.closest('[data-qa-i]') && t.closest('[data-qa-i]') === el && m.type === 'attributes' && /class|style/.test(m.attributeName)) continue; window.__mut += 1; } });
      window.__mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-checked', 'aria-pressed', 'aria-expanded', 'aria-selected', 'hidden', 'data-state', 'open'] });
      return { focus: document.activeElement && document.activeElement.outerHTML.slice(0, 60), layers: document.querySelectorAll('.sheet-layer').length, hist: history.length, scroll: [...document.querySelectorAll('#viewport > .view')].map((s) => s.scrollTop).join(',') };
    }, [v, sel]);
    if (!before) { log('  (gone)', item); continue; }
    await settle(page, 150);
    const dl0 = downloads, pp0 = popups;
    await page.click(sel, { timeout: 2500 }).catch((e) => log('  click err', item, e.message.split('\n')[0].slice(0, 80)));
    await settle(page, 900);
    const after = await page.evaluate(() => ({ mut: window.__mut, focus: document.activeElement && document.activeElement.outerHTML.slice(0, 60), layers: document.querySelectorAll('.sheet-layer').length, toast: document.querySelectorAll('#toastRoot .toast').length, print: window.__print, url: location.href }));
    const changed = after.mut > 0 || after.layers !== before.layers || after.toast > 0 || downloads > dl0 || popups > pp0;
    if (!changed) log(`  DEAD? ${item}  (focus before=${before.focus} after=${after.focus})`);
    // reset
    for (let k = 0; k < 3 && (await page.$('.sheet-layer')); k++) { await page.keyboard.press('Escape'); await settle(page, 450); }
    await L.dismissToast(page);
  }
}
log('errors', L.errors);
await L.close();
