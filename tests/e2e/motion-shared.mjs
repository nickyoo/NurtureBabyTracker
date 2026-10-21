// e2e: shared-element motion regressions from QA round 1 (AUDIT §3: nothing
// appears from or vanishes into thin air). Each block is a tester's repro
// turned into a check:
//
//  MAV-1 / FLOW-03 / DI-09 (#6)  dismissing a running-timer sheet shrinks it
//         back INTO its live pill (the rect grow in reverse) — from the pill,
//         and from + → Start bottle — instead of sliding off or collapsing
//         into the +; the numeral flies into the pill's time; the pill never
//         blinks. A sheet whose pill is gone leaves the ordinary way.
//  MAV-2 / FLOW-04 / DI-09 (#16) a Today row, a Timeline row and a Today
//         card's icon FLIP into the sheet's header icon (a visible copy, from
//         the tapped icon's rect to the header icon's), and back on close.
//  MAV-8  finishing from a pill while its row is off screen shrinks the pill
//         into the Today tab icon — it never slides off the left edge.
//  MAV-9  a sheet opening over an Undo toast sends it out with its exit; the
//         replaced toast never reappears as the sheet closes; a toast with
//         nothing replacing it rises back in once the sheet is gone.
//  …and under reduced motion: no flights, no clip collapse — opacity only.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/motion-shared.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const mod = (path) => `${BASE_URL}${path}`;

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];

async function freshPage({ reduced = false, seed = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light',
    reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-view="today"]');
  if (seed) {
    await page.evaluate(async (u) => {
      const { events } = await import(u);
      const m = 60000; const now = Date.now();
      await events.add({ type: 'diaper', startTime: now - 180 * m, data: { kind: 'wet' } });
      await events.add({ type: 'pump', startTime: now - 176 * m, endTime: now - 160 * m, data: { amount: 3.5, unit: 'oz', storedTo: 'fridge' } });
      await events.add({ type: 'feed', startTime: now - 130 * m, endTime: now - 112 * m, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } });
    }, mod('/js/core/store.js'));
  }
  await page.waitForTimeout(600);
  return { context, page };
}

const startEvent = (page, type, data, agoMin = 5) => page.evaluate(async ([u, t, d, ago]) => {
  const { events } = await import(u);
  return (await events.start(t, d, { startTime: Date.now() - ago * 60000 })).id;
}, [mod('/js/core/store.js'), type, data, agoMin]);
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 4000 }).then(() => true, () => false);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Record every frame for `ms` while `act` runs: the top sheet (rect, clip,
 * opacity, classes), the first live pill, any .sheet-flight copies.
 */
async function recordClose(page, act, ms = 700) {
  const rec = page.evaluate((ms) => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const tick = () => {
      const L = [...document.querySelectorAll('.sheet-layer')].pop();
      const pill = document.querySelector('#livePills .lpill');
      const s = L && L.querySelector('.sheet');
      out.push({
        t: performance.now() - t0,
        layer: L ? { cls: L.className, st: L.dataset.state, sheet: box(s), off: s.offsetHeight, clip: getComputedStyle(s).clipPath, op: Number(getComputedStyle(s).opacity) } : null,
        pill: pill ? { ...box(pill), op: Number(getComputedStyle(pill).opacity), time: box(pill.querySelector('.lpill-time')) } : null,
        flights: [...document.querySelectorAll('.sheet-flight')].map((f) => ({ cls: f.className, ...box(f), op: Number(getComputedStyle(f).opacity), vis: getComputedStyle(f).visibility })),
      });
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(out);
    };
    requestAnimationFrame(tick);
  }), ms);
  await page.waitForTimeout(20);
  await act();
  return rec;
}

/** inset(top right bottom left round …) → [t, r, b, l] (CSS shorthand collapsing undone) */
function insets(clip) {
  const m = /^inset\(([^r)]*)/.exec(clip || '');
  if (!m) return null;
  const v = m[1].trim().split(/\s+/).map(parseFloat);
  const [t, r = t, b = t, l = r] = v;
  return [t, r, b, l];
}

/** The last closing frame of the sheet, and checks that it landed on the pill. */
function landedOnPill(frames) {
  const closing = frames.filter((f) => f.layer && f.layer.st === 'closing');
  const last = closing[closing.length - 1];
  if (!last || !last.pill) return { ok: false, why: 'no closing frames / no pill' };
  const ins = insets(last.layer.clip);
  if (!ins) return { ok: false, why: `clip ${last.layer.clip}` };
  const visTop = last.layer.sheet.y + ins[0];
  const visH = last.layer.off - ins[0] - ins[2];
  const visL = last.layer.sheet.x + ins[3];
  const visW = last.layer.sheet.w - ins[1] - ins[3];
  const p = last.pill;
  const ok = Math.abs(visTop - p.y) < 6 && Math.abs(visH - p.h) < 4 && Math.abs(visL - p.x) < 4 && Math.abs(visW - p.w) < 4;
  return { ok, why: `visible ${visL.toFixed(0)},${visTop.toFixed(0)} ${visW.toFixed(0)}x${visH.toFixed(0)} vs pill ${p.x.toFixed(0)},${p.y.toFixed(0)} ${p.w.toFixed(0)}x${p.h.toFixed(0)}`, last, closing };
}

try {
  // ============================================ MAV-1 / FLOW-03 / DI-09 (#6)
  console.log('\nMAV-1 / DI-09 a running bottle\'s sheet shrinks back into its pill (Esc)');
  {
    const { context, page } = await freshPage();
    await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 3);
    await page.waitForSelector('#livePills .lpill');
    await settle(700);
    await page.click('#livePills .lpill-open');
    await page.waitForSelector('.sheet-layer.is-settled [data-pill-for]');
    const frames = await recordClose(page, () => page.keyboard.press('Escape'));
    const land = landedOnPill(frames);
    check('the closing sheet is the into-the-pill exit (is-to-pill)', land.closing && land.closing.every((f) => /is-to-pill/.test(f.layer.cls)), land.closing && land.closing[0] && land.closing[0].layer.cls);
    check('…its last frame is the pill\'s rect (clipped to the pill, sitting on it)', land.ok, land.why);
    check('…it never slides past the pill (no slide off the bottom)', land.closing && land.closing.every((f) => f.layer.sheet.y < f.pill.y + 12), JSON.stringify(land.closing && land.closing.map((f) => Math.round(f.layer.sheet.y))));
    check('…and fades onto it (opacity reaches ~0 as it lands)', land.last && land.last.layer.op < 0.2, String(land.last && land.last.layer.op));
    check('the pill is on screen throughout — it never blinks out', frames.every((f) => f.pill && f.pill.op > 0.95), JSON.stringify(frames.map((f) => f.pill && f.pill.op).filter((o) => o !== 1).slice(0, 5)));
    const numeral = frames.map((f) => f.flights.find((x) => /fd-timer/.test(x.cls))).filter(Boolean);
    check('the timer numeral flies (a visible copy)', numeral.length >= 5 && numeral.every((n) => n.vis === 'visible' && n.op > 0.5), `${numeral.length} frames`);
    const lastN = numeral[numeral.length - 1];
    const pt = frames[frames.length - 1].pill.time;
    check('…and lands centred on the pill\'s time, its height', !!lastN && Math.abs((lastN.x + lastN.w / 2) - (pt.x + pt.w / 2)) < 4 && Math.abs(lastN.y - pt.y) < 4 && Math.abs(lastN.h - pt.h) < 4, lastN && `${JSON.stringify(lastN)} vs ${JSON.stringify(pt)}`);
    check('no layer left behind', await waitNoLayers(page));
    check('no flight copy left behind', await page.evaluate(() => !document.querySelector('.sheet-flight')));
    await context.close();
  }

  console.log('\nFLOW-03 + → Bottle → Start bottle → Esc goes into the pill, not the +');
  {
    const { context, page } = await freshPage();
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer.is-settled [data-stagger]');
    await page.click('.sheet-layer [data-stagger]:has-text("Bottle")');
    await page.waitForSelector('.sheet-layer:last-child button:has-text("Start bottle")');
    await settle(450);
    await page.click('.sheet-layer:last-child button:has-text("Start bottle")');
    await page.waitForSelector('.sheet-layer [data-pill-for]');
    await page.waitForSelector('#livePills .lpill');
    await settle(700);
    const frames = await recordClose(page, () => page.keyboard.press('Escape'));
    const land = landedOnPill(frames);
    check('no + circle collapse in any closing frame', land.closing && land.closing.length > 3 && land.closing.every((f) => !/circle/.test(f.layer.clip)), land.closing && land.closing.map((f) => f.layer.clip.slice(0, 20)).join(' | '));
    check('…the sheet lands on the pill', land.ok, land.why);
    check('the pill never blinks', frames.every((f) => f.pill && f.pill.op > 0.95));
    check('…and the × still turns back into the +, which reappears', await waitNoLayers(page) && await page.evaluate(() => { const f = document.getElementById('fab'); return !f.classList.contains('is-under-sheet') && getComputedStyle(f).visibility !== 'hidden'; }));
    await context.close();
  }

  console.log('\nMAV-1 a nap\'s sheet (scrim tap) and a breastfeed\'s (no data-pill-for) go back into their pills');
  {
    const { context, page } = await freshPage();
    await startEvent(page, 'sleep', { kind: 'nap' }, 25);
    await page.waitForSelector('#livePills .lpill');
    await settle(700);
    await page.click('#livePills .lpill-open');
    await page.waitForSelector('.sheet-layer.is-settled');
    await settle(100);
    const frames = await recordClose(page, () => page.mouse.click(195, 30));
    const land = landedOnPill(frames);
    check('nap: scrim tap → into the pill', land.ok && land.closing.every((f) => /is-to-pill/.test(f.layer.cls)), land.why);
    check('nap: the numeral flies too', frames.some((f) => f.flights.some((x) => /nb-timer/.test(x.cls) && x.vis === 'visible')));
    await waitNoLayers(page);
    await page.evaluate(async (u) => { const { events } = await import(u); for (const e of await events.running()) await events.stop(e.id); }, mod('/js/core/store.js'));
    await settle(600);
    await startEvent(page, 'feed', { method: 'breast', left: 0, right: 0, activeSide: 'left', lastSide: 'left' }, 6);
    await page.waitForSelector('#livePills .lpill');
    await settle(700);
    await page.click('#livePills .lpill-open');
    await page.waitForSelector('.sheet-layer.is-settled [data-side]');
    const f2 = await recordClose(page, () => page.keyboard.press('Escape'));
    const l2 = landedOnPill(f2);
    check('breastfeed opened from its pill → back into that pill', l2.ok, l2.why);
    await context.close();
  }

  console.log('\nMAV-1 a sheet whose event has ended leaves the ordinary way');
  {
    const { context, page } = await freshPage();
    const id = await startEvent(page, 'sleep', { kind: 'nap' }, 25);
    await page.waitForSelector('#livePills .lpill');
    await settle(700);
    await page.click('#livePills .lpill-open');
    await page.waitForSelector('.sheet-layer.is-settled');
    await page.evaluate(async ([u, i]) => { const { events } = await import(u); await events.stop(i); }, [mod('/js/core/store.js'), id]);
    await settle(150);
    const frames = await recordClose(page, () => page.keyboard.press('Escape'), 500);
    const closing = frames.filter((f) => f.layer && f.layer.st === 'closing');
    check('no is-to-pill when the pill is gone (no target to land on)', closing.length > 0 && closing.every((f) => !/is-to-pill/.test(f.layer.cls)), closing[0] && closing[0].layer.cls);
    check('…and no numeral flight to nowhere', frames.every((f) => !f.flights.length));
    await waitNoLayers(page);
    await context.close();
  }

  // ============================================ MAV-2 / FLOW-04 / DI-09 (#16)
  const recordFlight = async (page, act, ms = 650) => {
    const rec = page.evaluate((ms) => new Promise((res) => {
      const out = []; const t0 = performance.now();
      const tick = () => {
        const f = document.querySelector('.sheet-flight');
        if (f) { const b = f.getBoundingClientRect(); out.push({ t: performance.now() - t0, x: b.left, y: b.top, w: b.width, h: b.height, vis: getComputedStyle(f).visibility, op: Number(getComputedStyle(f).opacity), cls: f.className }); }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(out);
      };
      requestAnimationFrame(tick);
    }), ms);
    await page.waitForTimeout(20);
    await act();
    return rec;
  };
  const rectOf = (page, sel) => page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const near = (a, b, tol = 5) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.w - b.w) < tol && Math.abs(a.h - b.h) < tol;
  const fmt = (r) => r && `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`;

  console.log('\nMAV-2 / FLOW-04 a row\'s icon chip flies into its sheet, and back');
  {
    const { context, page } = await freshPage();
    for (const [where, rowSel] of [['Today', '[data-view="today"] .row[data-event-id]'], ['Timeline', '[data-view="timeline"] .row[data-event-id]']]) {
      if (where === 'Timeline') { await page.click('#tabBar :is(button,a):has-text("Timeline")'); await settle(800); }
      const rowChipSel = `${rowSel} .chip-ic`;
      const from = await rectOf(page, rowChipSel);
      const fl = await recordFlight(page, () => page.click(rowSel));
      await page.waitForSelector('.sheet-layer[data-state="open"]');
      await settle(350);
      const rest = await page.evaluate(() => { const L = document.querySelector('.sheet-layer'); const c = L.querySelector('[data-sheet-icon]') || L.querySelector('.sheet-hd .chip-ic') || L.querySelector('.sheet-step .chip-ic'); const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vis: getComputedStyle(c).visibility }; });
      check(`${where}: a visible copy flies on open (not just riding up with the sheet)`, fl.length >= 6 && fl.every((f) => f.vis === 'visible' && f.op > 0.3), `${fl.length} frames ${JSON.stringify(fl[0])}`);
      check(`${where}: it starts on the row's chip`, fl[0] && near(fl[0], from, 6), `${fmt(fl[0])} vs ${fmt(from)}`);
      check(`${where}: it ends on the sheet's icon, which is then shown`, fl.length && near(fl[fl.length - 1], rest, 6) && rest.vis === 'visible', `${fmt(fl[fl.length - 1])} vs ${fmt(rest)}`);
      const back = await recordFlight(page, () => page.keyboard.press('Escape'));
      await waitNoLayers(page);
      const home = await rectOf(page, rowChipSel);
      check(`${where}: on close it flies back to the row's chip`, back.length >= 6 && near(back[0], rest, 6) && near(back[back.length - 1], home, 6), `${fmt(back[0])} → ${fmt(back[back.length - 1])} want ${fmt(home)}`);
      check(`${where}: …landing opaque (it swaps with the chip, no pop)`, back.length && back[back.length - 1].op > 0.9, String(back.length && back[back.length - 1].op));
      check(`${where}: the row's chip is visible again afterwards`, await page.$eval(rowChipSel, (c) => getComputedStyle(c).visibility === 'visible'));
    }
    await context.close();
  }

  console.log('\nMAV-2 a Today card\'s icon flies into its sheet\'s header');
  {
    const { context, page } = await freshPage();
    const from = await rectOf(page, '.ql[data-card="feed"] .ql-label .ic');
    const fl = await recordFlight(page, () => page.click('.ql[data-card="feed"]'));
    await page.waitForSelector('.sheet-layer[data-state="open"] .sheet-hd .chip-ic');
    await settle(350);
    const rest = await rectOf(page, '.sheet-layer .sheet-hd .chip-ic');
    check('card: a visible copy starts on the card\'s icon', fl.length >= 6 && fl[0].vis === 'visible' && near(fl[0], from, 6), `${fmt(fl[0])} vs ${fmt(from)}`);
    check('card: …and ends on the header icon', fl.length && near(fl[fl.length - 1], rest, 6), `${fmt(fl[fl.length - 1])} vs ${fmt(rest)}`);
    check('card: the header icon sits before the title', await page.evaluate(() => { const c = document.querySelector('.sheet-layer .sheet-hd .chip-ic'); return !!c && c.nextElementSibling && c.nextElementSibling.classList.contains('sheet-title'); }));
    const back = await recordFlight(page, () => page.keyboard.press('Escape'));
    await waitNoLayers(page);
    check('card: on close it flies back to the card\'s icon and fades into it', back.length >= 6 && near(back[back.length - 1], from, 6) && back[back.length - 1].op < 0.2, `${fmt(back[back.length - 1])} op ${back.length && back[back.length - 1].op}`);
    check('card: the card\'s icon never disappeared', await page.$eval('.ql[data-card="feed"] .ql-label .ic', (c) => getComputedStyle(c).visibility === 'visible'));
    await context.close();
  }

  console.log('\nMAV-2 the flying icon lands on the card\'s own symbol, never a body chip');
  {
    const { context, page } = await freshPage();
    // A nap that just ended, so the sleep sheet leads with its "Awake" sun chip.
    await page.evaluate(async (u) => {
      const { events } = await import(u);
      await events.add({ type: 'sleep', startTime: Date.now() - 70 * 60000, endTime: Date.now() - 20 * 60000, data: { kind: 'nap' } });
    }, mod('/js/core/store.js'));
    await settle(600);
    if (await page.$('.ql[data-card="sleep"]')) {
      const want = await page.$eval('.ql[data-card="sleep"] .ql-label .ic', (e) => (e.matches('svg') ? e : e.querySelector('svg') || e).innerHTML);
      await page.click('.ql[data-card="sleep"]');
      await page.waitForSelector('.sheet-layer[data-state="open"]');
      await settle(450);
      const awake = await page.$('.sheet-layer [data-awake] .chip-ic');
      check('Sleep card: (setup) the sheet shows its "Awake" sun chip', !!awake);
      const got = await page.evaluate(() => {
        const c = document.querySelector('.sheet-layer .sheet-hd .chip-ic');
        const svg = c && c.querySelector('svg');
        return { header: !!c, icon: svg ? svg.innerHTML : null, bodyChipHidden: [...document.querySelectorAll('.sheet-layer .sheet-step .chip-ic')].some((x) => getComputedStyle(x).visibility === 'hidden') };
      });
      check('Sleep card: the header gets the card\'s moon (not the "Awake" sun chip)', got.header && got.icon === want, JSON.stringify(got).slice(0, 160));
      check('Sleep card: no body chip was borrowed (none left hidden)', !got.bodyChipHidden);
      await page.keyboard.press('Escape');
      await waitNoLayers(page);
    } else {
      check('Sleep card present on Today', false);
    }
    await context.close();
  }

  // ============================================================== MAV-8
  console.log('\nMAV-8 Finish from another tab shrinks the pill into the Today tab');
  {
    const { context, page } = await freshPage();
    await startEvent(page, 'sleep', { kind: 'nap' }, 30);
    await page.waitForSelector('#livePills .lpill');
    await settle(700);
    await page.click('#tabBar :is(button,a):has-text("Stash")');
    await settle(800);
    const tab = await rectOf(page, '#tabBar [data-tab="today"]');
    const frames = await page.evaluate(() => new Promise((res) => {
      const out = []; const t0 = performance.now();
      const tick = () => {
        const p = document.querySelector('#livePills .lpill');
        if (p) { const b = p.getBoundingClientRect(); out.push({ x: b.left, y: b.top, w: b.width, h: b.height, op: Number(getComputedStyle(p).opacity) }); }
        if (performance.now() - t0 < 800) requestAnimationFrame(tick); else res(out);
      };
      requestAnimationFrame(tick);
      document.querySelector('#livePills .lpill .lpill-finish').click();
    }));
    const visible = frames.filter((f) => f.op > 0.05);
    check('the pill never slides off the left edge', frames.every((f) => f.x > -2), JSON.stringify(frames.map((f) => Math.round(f.x)).slice(0, 20)));
    check('it shrinks (scales down, not just translates)', visible.length > 3 && visible[visible.length - 1].w < 100, visible.length && fmt(visible[visible.length - 1]));
    const lastF = frames[frames.length - 1];
    check('…ending inside the Today tab', !!lastF && lastF.x + lastF.w / 2 > tab.x && lastF.x + lastF.w / 2 < tab.x + tab.w && lastF.y + lastF.h / 2 > tab.y - 8 && lastF.y + lastF.h / 2 < tab.y + tab.h, `${fmt(lastF)} tab ${fmt(tab)}`);
    check('the Today tab gets its one-shot dot', await page.$eval('#tabBar [data-tab="today"]', (t) => t.classList.contains('has-dot')));
    check('the pill is removed', await page.waitForFunction(() => !document.querySelector('#livePills .lpill'), null, { timeout: 2000 }).then(() => true, () => false));
    await context.close();
  }

  // ============================================================== MAV-9
  console.log('\nMAV-9 a replaced Undo toast doesn\'t reappear as the covering sheet closes');
  {
    const { context, page } = await freshPage();
    await page.click('#tabBar :is(button,a):has-text("Timeline")');
    await settle(800);
    const del = async () => {
      await page.click('[data-view="timeline"] .row[data-event-id]');
      await page.waitForSelector('.sheet-layer[data-state="open"] button:has-text("Delete")');
      await settle(400);
      await page.click('.sheet-layer:last-child button:has-text("Delete")');
    };
    await del();
    await page.waitForSelector('.toast[data-state="in"]');
    await settle(500);
    const oldMsg = await page.textContent('.toast .toast-msg');
    const rec = page.evaluate((msg) => new Promise((res) => {
      const out = []; const t0 = performance.now();
      const tick = () => {
        const old = [...document.querySelectorAll('#toastRoot .toast')].find((x) => x.querySelector('.toast-msg').textContent === msg);
        const L = document.querySelector('.sheet-layer');
        out.push({ t: performance.now() - t0, sheet: L ? L.dataset.state : '-', old: old ? Number(getComputedStyle(old).opacity) : null, vis: old ? getComputedStyle(old).visibility : null });
        if (performance.now() - t0 < 1800) requestAnimationFrame(tick); else res(out);
      };
      requestAnimationFrame(tick);
    }), oldMsg);
    await settle(30);
    await del();
    const frames = await rec;
    const seen = frames.filter((f) => f.old !== null && f.vis !== 'hidden');
    // From the moment the second sheet opens, the old toast only ever fades
    // (non-increasing opacity), and it is never visible once that sheet starts
    // closing (it used to reappear at full opacity as the sheet slid away).
    const i0 = seen.findIndex((f) => f.sheet === 'open');
    const after = i0 === -1 ? [] : seen.slice(i0);
    const monotonic = after.every((f, i) => i === 0 || f.old <= after[i - 1].old + 0.01);
    const firstClosing = frames.findIndex((f) => f.sheet === 'closing');
    const lateSeen = firstClosing === -1 ? [] : frames.slice(firstClosing).filter((f) => f.old !== null && f.vis !== 'hidden' && f.old > 0.02);
    check('…it only ever fades from then on (never comes back up)', i0 !== -1 && monotonic, JSON.stringify(after.map((f) => +f.old.toFixed(2))));
    check('…and is never seen while the sheet closes, nor after', firstClosing !== -1 && lateSeen.length === 0, JSON.stringify(lateSeen.slice(0, 4)));
    check('…and is gone at the end', frames[frames.length - 1].old === null);
    check('the new toast is showing', /deleted/.test(await page.textContent('.toast[data-state="in"] .toast-msg')) && (await page.textContent('.toast[data-state="in"] .toast-msg')) !== oldMsg);
    await context.close();
  }

  console.log('\nMAV-9 a toast covered by a sheet rises back once the sheet is gone');
  {
    const { context, page } = await freshPage({ seed: false });
    await page.evaluate(async (u) => { const { toast } = await import(u); toast({ message: 'Diaper logged', action: { label: 'Undo', run() {} }, duration: 0 }); }, mod('/js/ui/toast.js'));
    await page.waitForSelector('.toast[data-state="in"]');
    await settle(300);
    await page.evaluate(async (u) => { const { openSheet } = await import(u); openSheet({ title: 'Probe', render(b) { b.textContent = 'hello'; } }); }, mod('/js/ui/sheet.js'));
    await settle(500);
    const under = await page.$eval('.toast', (t) => ({ st: t.dataset.state, op: Number(getComputedStyle(t).opacity), hidden: t.getAttribute('aria-hidden') }));
    check('under an open sheet the toast is out (covered, aria-hidden)', under.st === 'covered' && under.op === 0 && under.hidden === 'true', JSON.stringify(under));
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await page.waitForSelector('.toast[data-state="in"]', { timeout: 2000 }).catch(() => {});
    await settle(400);
    const back = await page.$eval('.toast', (t) => ({ st: t.dataset.state, op: Number(getComputedStyle(t).opacity), hidden: t.getAttribute('aria-hidden') }));
    check('…and rises back in after it closes', back.st === 'in' && back.op > 0.95 && back.hidden === null, JSON.stringify(back));
    await context.close();
  }

  // ===================================================== reduced motion
  console.log('\nreduced motion: no flights, no clip collapse, opacity only');
  {
    const { context, page } = await freshPage({ reduced: true });
    const fl = await recordFlight(page, () => page.click('[data-view="today"] .row[data-event-id]'), 500);
    await page.waitForSelector('.sheet-layer[data-state="open"]');
    check('row → sheet: no icon flight', fl.length === 0);
    check('…and no injected header chip motion hook needed (layer is-reduced)', await page.$eval('.sheet-layer', (l) => l.classList.contains('is-reduced')));
    const back = await recordFlight(page, () => page.keyboard.press('Escape'), 400);
    await waitNoLayers(page);
    check('…nor on close', back.length === 0);
    await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 3);
    await page.waitForSelector('#livePills .lpill');
    await settle(400);
    await page.click('#livePills .lpill-open');
    await page.waitForSelector('.sheet-layer[data-state="open"]');
    await settle(300);
    const frames = await recordClose(page, () => page.keyboard.press('Escape'), 400);
    const closing = frames.filter((f) => f.layer && f.layer.st === 'closing');
    check('timer sheet: closes with the reduced fade (no is-to-pill, no transform, no clip)', closing.length > 0 && closing.every((f) => !/is-to-pill/.test(f.layer.cls) && /is-reduced/.test(f.layer.cls) && f.layer.clip === 'none'), closing[0] && JSON.stringify(closing[0].layer));
    check('timer sheet: no numeral flight', frames.every((f) => !f.flights.length));
    await waitNoLayers(page);
    // A replaced visible toast still fades (opacity), never blinks out.
    const ops = await page.evaluate(async (u) => {
      const { toast } = await import(u);
      toast({ message: 'One' });
      await new Promise((r) => setTimeout(r, 400));
      toast({ message: 'Two' });
      const out = [];
      const t0 = performance.now();
      await new Promise((res) => { const f = () => { const o = [...document.querySelectorAll('.toast')].find((x) => x.textContent.includes('One')); out.push(o ? Number(getComputedStyle(o).opacity) : null); if (performance.now() - t0 < 500) requestAnimationFrame(f); else res(); }; f(); });
      return out;
    }, mod('/js/ui/toast.js'));
    check('reduced: a replaced toast fades out (in-between opacities), then goes', ops.some((o) => o !== null && o > 0.05 && o < 0.95) && ops[ops.length - 1] === null, JSON.stringify(ops.slice(0, 12)));
    await context.close();
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  failures.push(`crashed: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nmotion-shared: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
