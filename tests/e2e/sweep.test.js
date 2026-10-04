// The "no dead clicks, no traps" sweep.
//
// It finds every control a person could tap — on every tab, plus everything inside every
// sheet — clicks each one in its own fresh app with the clock frozen, and requires that
// SOMETHING real happened: the screen visibly changed, or a dialog / download / file picker /
// sound / navigation fired. Then, if the click opened a sheet, it proves a finger can get
// back out (a close button or a tap outside — Escape doesn't exist on a phone).
//
// "Visibly changed" is measured from layout (text, position, display), NOT from DOM attributes:
// setting `hidden` on an element whose CSS says `display:flex` changes the DOM and changes
// nothing on screen — that is exactly how the install banner's Dismiss button went dead.
//
// New buttons are picked up automatically; nothing to register.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness, openApp, goTab, seed, openOverlays, layoutSignature, fxCounts, fxDelta, settle,
  HOUR, DAY,
} from './harness.js';
import { OVERLAYS, waitOverlayOpen } from './overlays.js';

const h = await startHarness();
after(async () => { await h.stop(); });

// Controls that legitimately do nothing visible. Keep this list EMPTY unless there is a real reason.
const INERT_OK = {
  // 'label text': 'why it is fine',
};

/** Runs inside the page: finds tappable things and describes them. */
function installSweep() {
  const CONTROL = 'button, a[href], [data-action], [role="button"], label.btn-secondary, summary';
  const NOT_TAPS = 'select, input, textarea, option, .switch, .slider';
  const visible = (e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const describe = (e) => (e.getAttribute('aria-label') || e.textContent || e.title || e.id || e.className || e.tagName)
    .toString().replace(/\s+/g, ' ').trim().slice(0, 48);
  // count DOM changes so Node can tell when the app has finished repainting (page timers are frozen/faked here)
  window.__mut = 0;
  new MutationObserver(() => { window.__mut++; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  window.__sweep = {
    describe,
    list(scope) {
      const root = document.querySelector(scope);
      if (!root) return [];
      const cands = [...root.querySelectorAll('*')].filter((e) => {
        if (!visible(e) || e.closest('svg') || e.closest('.switch') || e.matches(NOT_TAPS)) return false;
        // the control that represents the CURRENT selection is inert by design (active tab, active filter…)
        if (e.classList.contains('active') || e.classList.contains('is-selected')) return false;
        if (e.matches(CONTROL)) return true;
        // looks tappable (pointer cursor) → it had better BE tappable
        return getComputedStyle(e).cursor === 'pointer' && !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer');
      });
      const outer = cands.filter((e) => !cands.some((o) => o !== e && o.contains(e)));
      // identical siblings (a "Delete" on every row) — two of each is plenty
      const seen = new Map();
      return outer.filter((e) => {
        const key = [e.tagName, e.dataset.action || '', e.className, describe(e)].join('|');
        const n = (seen.get(key) || 0) + 1; seen.set(key, n);
        return n <= 2;
      });
    },
  };
}

async function freshSeeded() {
  const page = await openApp(h, { clock: 'paused', reducedMotion: 'reduce' });
  await page.evaluate(installSweep);
  await seed.bulk(page, {
    pumps: [{ qty: 4.5, agoMs: 5 * HOUR, notes: 'morning' }, { qty: 5, agoMs: 2 * HOUR }, { qty: 6, agoMs: 26 * HOUR }],
    feeds: [{ qty: 4, feedType: 'formula', agoMs: 3 * HOUR }, { qty: 3, feedType: 'breastmilk', agoMs: HOUR }],
    pouches: [
      { location: 'fridge', qty: 4 }, { location: 'thawed', qty: 3 }, { location: 'fridge', status: 'used' },
      ...Array.from({ length: 7 }, (_, i) => ({ location: i % 2 ? 'deepFreezer' : 'freezer', agoMs: (10 + i) * DAY })),
    ],
  });
  return page;
}

/** Wait until the app has stopped repainting (IndexedDB-backed renders land a beat after a click). */
async function waitQuiet(page) {
  let last = -1, stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    const n = await page.evaluate(() => window.__mut);
    stable = n === last ? stable + 1 : 0;
    last = n;
    await page.waitForTimeout(80);
  }
}

async function listControls(page, scope) {
  return page.evaluate((s) => window.__sweep.list(s).map((e, index) => ({ index, label: window.__sweep.describe(e) })), scope);
}

async function snapshot(page) { return { sig: await layoutSignature(page), fx: await fxCounts(page) }; }

async function clickAndObserve(page, el) {
  await el.scrollIntoViewIfNeeded();
  await el.hover({ timeout: 3000 }).catch(() => {}); // hover first so :hover styling isn't mistaken for an effect
  const before = await snapshot(page);
  try {
    await el.click({ timeout: 3000 });
  } catch (e) {
    return { clickError: e.message.split('\n').filter((l) => l.trim()).slice(0, 4).join(' | ') };
  }
  await settle(page, 400);
  await page.waitForTimeout(350); // real time for IndexedDB-backed repaints
  let after;
  try { after = await snapshot(page); } catch { return { effect: true, how: 'page navigated' }; }
  const sideEffects = fxDelta(before.fx, after.fx);
  const changed = before.sig !== after.sig;
  return { effect: changed || Object.keys(sideEffects).length > 0, changed, sideEffects };
}

/** After a click opened a sheet: can a finger get out? (close/cancel/done button, then tap outside.) */
async function leaveWithATouch(page, id) {
  const exits = await page.evaluate((i) => {
    const root = document.getElementById(i);
    return [...root.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect(); const label = ((b.getAttribute('aria-label') || '') + ' ' + b.textContent).toLowerCase();
      return r.width > 0 && r.height > 0 && /close|cancel|done|got it|skip|✕|×/.test(label);
    }).map((b) => b.id).filter(Boolean);
  }, id);
  const closed = async () => !(await openOverlays(page)).includes(id);
  for (const exitId of exits) {
    await page.click('#' + exitId, { timeout: 3000 }).catch(() => {});
    await settle(page, 300);
    if (await closed()) return { how: `button #${exitId}` };
  }
  await page.mouse.click(5, 5);
  await settle(page, 300);
  if (await closed()) return { how: 'tap outside' };
  return null;
}

async function checkControl(page, scope, target) {
  const handle = await page.evaluateHandle(({ scope, index }) => window.__sweep.list(scope)[index], { scope, index: target.index });
  const el = handle.asElement();
  assert.ok(el, `the control "${target.label}" was there during discovery but not now (the page is not deterministic)`);
  assert.equal(await page.evaluate((e) => window.__sweep.describe(e), el), target.label, 'sweep drifted onto a different control');

  const r = await clickAndObserve(page, el);
  assert.ok(!r.clickError, `"${target.label}" could not be clicked (covered by something? off-screen?): ${r.clickError}`);
  if (!r.effect && !INERT_OK[target.label]) {
    assert.fail(`"${target.label}" — clicking it did NOTHING you could see or hear (no layout change, dialog, download, file picker, sound or navigation)`);
  }
  const open = await openOverlays(page).catch(() => []);
  for (const id of open) {
    const out = await leaveWithATouch(page, id);
    assert.ok(out, `"${target.label}" opened #${id}, and a finger can't get out of it (no working close button, tapping outside does nothing) — UI TRAP`);
  }
}

// ---------------------------------------------------------------- discovery ---
const LEVEL1 = [
  { where: 'header & nav', scopes: ['.app-header', '#reminderBanner', '.bottom-nav'], tab: 'pump' },
  { where: 'Pump tab', scopes: ['#tab-pump'], tab: 'pump' },
  { where: 'History tab', scopes: ['#tab-history'], tab: 'history' },
  { where: 'Stash tab', scopes: ['#tab-inventory'], tab: 'inventory' },
  { where: 'Settings tab', scopes: ['#tab-settings'], tab: 'settings' },
];

const targets = [];
{
  const page = await freshSeeded();
  try {
    for (const group of LEVEL1) {
      await goTab(page, group.tab); await waitQuiet(page);
      for (const scope of group.scopes) {
        for (const c of await listControls(page, scope)) targets.push({ ...c, scope, tab: group.tab, where: group.where });
      }
    }
    assert.ok(targets.length > 40, `discovery only found ${targets.length} controls — the sweep itself is broken`);
  } finally { await page.context().close(); }

  for (const o of OVERLAYS) {
    const p = await freshSeeded();
    try {
      await o.open(p); await waitOverlayOpen(p, o.id); await waitQuiet(p);
      for (const c of await listControls(p, '#' + o.id)) targets.push({ ...c, scope: '#' + o.id, overlay: o, where: `inside ${o.id}` });
    } finally { await p.context().close(); }
  }
}

// -------------------------------------------------------------------- tests ---
describe('click sweep: every control does something, every sheet can be left', { concurrency: 3 }, () => {
  for (const t of targets) {
    test(`${t.where} › ${t.label}`, { timeout: 60000 }, async () => {
      const page = await freshSeeded();
      try {
        if (t.overlay) { await t.overlay.open(page); await waitOverlayOpen(page, t.overlay.id); }
        else await goTab(page, t.tab);
        await waitQuiet(page);
        await checkControl(page, t.scope, t);
      } finally { await page.context().close(); }
    });
  }
});
