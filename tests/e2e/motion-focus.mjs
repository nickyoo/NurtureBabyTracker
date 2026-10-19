// e2e: motion + focus regressions from review round 1 of the UI foundation
// (R1-01 … R1-06). Each block is the reviewer's repro turned into a check:
//
//  R1-01  a surface closed DURING its enter transition still plays its exit
//         (transitioncancel is not completion): sheet, quick log, toast,
//         pushed screen.
//  R1-02  a double-tap on the + leaves the quick-log sheet open (the × twin
//         and the scrim ignore the tail of the opening tap).
//  R1-03  reduced motion keeps the × in place of the + (system setting and
//         the in-app setting).
//  R1-04  tapping the live pill grows its sheet out of the pill's rect (#6).
//  R1-05  finishing from a live pill never drops focus to <body>.
//  R1-06  a pushed screen takes focus; popping returns it to the opener.
//
// …and from review round 2:
//
//  R2-01  double-tapping a live pill's Finish doesn't hit the Undo toast that
//         rises into the pill's slot (the activity stays finished).
//  R2-02  double-tapping a live pill doesn't hit the primary button of the
//         sheet that just grew in under the finger (the activity keeps running).
//  R2-03  a sheet opened from a quick-log tile puts the + twin exactly on the
//         +'s resting spot, and the + stays hidden until the last sheet using
//         it as origin has closed.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/motion-focus.mjs

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

async function freshPage(opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    hasTouch: !!opts.touch,
    isMobile: !!opts.touch,
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
  await page.click('[data-action="start"]');
  await page.waitForSelector('[data-view="today"]');
  await page.waitForTimeout(500);
  return { context, page };
}

const layers = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet-layer')].map((l) => l.getAttribute('data-state')));
const waitNoLayers = (page) => page.waitForFunction(() => document.querySelectorAll('.sheet-layer').length === 0, null, { timeout: 3000 }).then(() => true, () => false);
const activeDesc = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return 'BODY';
  return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}${a.className ? `.${String(a.className).trim().split(/\s+/).join('.')}` : ''}${a.dataset.view ? `[view=${a.dataset.view}]` : ''}${a.dataset.action ? `[action=${a.dataset.action}]` : ''}`;
});
const startEvent = (page, type, data, agoMin = 5) => page.evaluate(async ([u, t, d, ago]) => {
  const { events } = await import(u);
  return (await events.start(t, d, { startTime: Date.now() - ago * 60000 })).id;
}, [mod('/js/core/store.js'), type, data, agoMin]);

try {
  // ======================================================== R1-01
  console.log('\nR1-01 early close keeps the exit animation');
  {
    const { context, page } = await freshPage();
    // A plain sheet, Esc 100 ms into its 420 ms rise.
    await page.evaluate(async (u) => { const { openSheet } = await import(u); openSheet({ title: 'Probe', render(b) { b.textContent = 'hello'; } }); }, mod('/js/ui/sheet.js'));
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    check('sheet closed mid-enter is still sliding out ~120 ms later', (await layers(page)).join() === 'closing', `layers=${await layers(page)}`);
    check('…and is removed once the exit ends', await waitNoLayers(page));

    // The quick log (grow from the +), Esc 150 ms after opening.
    await page.click('#fab');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    check('quick log closed mid-grow still collapses (layer present ~120 ms later)', (await layers(page)).join() === 'closing', `layers=${await layers(page)}`);
    check('…then removed, focus back on the +', await waitNoLayers(page) && await activeDesc(page) === 'button#fab.fab');

    // Toast dismissed 60 ms after it appeared.
    const toastLeft = await page.evaluate(async (u) => {
      const { toast } = await import(u);
      const h = toast({ message: 'Deleted', action: { label: 'Undo', run() {} } });
      await new Promise((r) => setTimeout(r, 60));
      h.dismiss();
      await new Promise((r) => setTimeout(r, 60));
      const during = document.querySelector('.toast') ? document.querySelector('.toast').getAttribute('data-state') : 'gone';
      await h.done;
      return { during, after: document.querySelectorAll('.toast').length };
    }, mod('/js/ui/toast.js'));
    check('toast dismissed mid-enter is still fading 60 ms later', toastLeft.during === 'leaving', JSON.stringify(toastLeft));
    check('…and removed afterwards', toastLeft.after === 0);

    // Settings pushed, popped by Back 80 ms later.
    await page.click('[data-view="today"] [data-action="settings"]');
    await page.waitForTimeout(80);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => document.querySelector('[data-view="settings"].is-leaving-right'), null, { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(100);
    check('screen popped mid-push still slides out (present ~100 ms after the pop)', await page.evaluate(() => !!document.querySelector('[data-view="settings"].is-leaving-right')));
    await page.waitForFunction(() => !document.querySelector('[data-view="settings"]'), null, { timeout: 3000 }).catch(() => {});
    check('…and is removed once the slide ends', await page.evaluate(() => !document.querySelector('[data-view="settings"]')));
    await context.close();
  }

  // ======================================================== R1-02
  console.log('\nR1-02 double-tap on the + leaves the sheet open');
  {
    const { context, page } = await freshPage({ touch: true });
    const box = await (await page.$('#fab')).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(200);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(700);
    check('touch double-tap: quick log still open', (await layers(page)).join() === 'open', `layers=${await layers(page)}`);
    check('…and the app stays inert under it', await page.evaluate(() => document.getElementById('app').inert === true));
    // A deliberate tap on the × after the enter has settled still closes.
    await page.touchscreen.tap(cx, cy);
    check('a later tap on the × closes it', await waitNoLayers(page));
    // A scrim tap during the open is ignored too.
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(100);
    await page.touchscreen.tap(195, 40);
    await page.waitForTimeout(600);
    check('scrim tap 100 ms after opening is ignored', (await layers(page)).join() === 'open', `layers=${await layers(page)}`);
    await page.touchscreen.tap(195, 40);
    check('a later scrim tap dismisses', await waitNoLayers(page));
    await context.close();

    const { context: c2, page: p2 } = await freshPage();
    await p2.dblclick('#fab');
    await p2.waitForTimeout(700);
    check('mouse dblclick: quick log still open', (await layers(p2)).join() === 'open', `layers=${await layers(p2)}`);
    await p2.keyboard.press('Escape');
    check('Esc still closes immediately-ish', await waitNoLayers(p2));
    await c2.close();
  }

  // ======================================================== R1-03
  console.log('\nR1-03 reduced motion keeps the ×');
  for (const how of ['system', 'setting']) {
    const { context, page } = await freshPage({ reduced: how === 'system' });
    if (how === 'setting') {
      await page.evaluate(async (u) => { const { settings } = await import(u); await settings.set('reduceMotion', true); }, mod('/js/core/settings.js'));
      await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduce');
    }
    const fabBox = await (await page.$('#fab')).boundingBox();
    await page.click('#fab');
    await page.waitForSelector('.sheet-layer[data-state="open"]');
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => {
      const l = document.querySelector('.sheet-layer');
      const x = l.querySelector('.fab-x');
      const r = x ? x.getBoundingClientRect() : null;
      const cs = x ? getComputedStyle(x) : null;
      const vp = l.querySelector('.sheet-viewport');
      return {
        cls: l.className,
        hasX: !!x,
        rect: r && { x: r.x, y: r.y, w: r.width },
        visible: !!cs && cs.visibility === 'visible' && Number(cs.opacity) > 0.9,
        iconTransform: x ? getComputedStyle(x.querySelector('.ic')).transform : '',
        pad: parseFloat(getComputedStyle(vp).paddingBottom),
        contentBottom: vp.getBoundingClientRect().bottom - parseFloat(getComputedStyle(vp).paddingBottom),
        hit: x ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === x || x.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) : false,
      };
    });
    check(`${how}: reduced sheet (no grow) still has the × twin`, st.cls.includes('is-reduced') && !st.cls.includes('is-grow') && st.hasX, st.cls);
    check(`${how}: the × sits exactly where the + was, visible and on top`, st.rect && Math.abs(st.rect.x - fabBox.x) < 1 && Math.abs(st.rect.y - fabBox.y) < 1 && st.visible && st.hit, JSON.stringify(st));
    check(`${how}: the × shows the × glyph (45° static), not a +`, /matrix\(0\.70/.test(st.iconTransform), st.iconTransform);
    check(`${how}: content ends above the × (fab padding)`, st.rect && st.contentBottom <= st.rect.y, `content bottom=${st.contentBottom} × top=${st.rect && st.rect.y}`);
    await page.click('.fab-x');
    check(`${how}: tapping the × closes it, focus back on +`, await waitNoLayers(page) && await activeDesc(page) === 'button#fab.fab');
    await context.close();
  }

  // ======================================================== R1-04
  console.log('\nR1-04 live pill grows its sheet out of the pill');
  {
    const { context, page } = await freshPage();
    await startEvent(page, 'sleep', { kind: 'nap' }, 20);
    await page.waitForSelector('.lpill');
    await page.waitForTimeout(600);
    const r = await page.evaluate(async () => {
      const pillEl = document.querySelector('.lpill');
      const pill = pillEl.getBoundingClientRect();
      document.querySelector('.lpill-open').click();
      const layer = document.querySelector('.sheet-layer');
      const sheet = layer.querySelector('.sheet');
      const frames = [];
      const t0 = performance.now();
      await new Promise((res) => {
        const f = () => {
          const b = sheet.getBoundingClientRect();
          frames.push({ t: performance.now() - t0, top: b.top, clip: getComputedStyle(sheet).clipPath });
          if (performance.now() - t0 < 700) requestAnimationFrame(f); else res();
        };
        f();
      });
      return { pill: { top: pill.top, left: pill.left, w: pill.width, h: pill.height }, cls: layer.className, frames, rest: sheet.getBoundingClientRect().top };
    });
    const first = r.frames[0];
    // inset(top right bottom left round …), with CSS's shorthand collapsing
    const im = /^inset\(([^r)]*)/.exec(first.clip);
    const iv = im ? im[1].trim().split(/\s+/).map(parseFloat) : [];
    const [iT, iR = iT, iB = iT, iL = iR] = iv;
    const m = iv.length ? [null, iT, iR, iB, iL] : [];
    const visibleH = m.length ? (await page.evaluate(() => document.querySelector('.sheet-layer .sheet').offsetHeight)) - iB : NaN;
    check('pill origin → rect-grow sheet (is-rect)', r.cls.includes('is-rect'), r.cls);
    check('first frame: the sheet sits on the pill (top ≈ pill top)', Math.abs(first.top - r.pill.top) < 4, `first top=${first.top.toFixed(1)} pill top=${r.pill.top.toFixed(1)}`);
    check('first frame: clipped to the pill\'s box (left/right inset = pill margins, height = pill height)', m.length > 0 && Math.abs(parseFloat(m[4]) - r.pill.left) < 2 && Math.abs(parseFloat(m[2]) - (390 - r.pill.left - r.pill.w)) < 2 && Math.abs(visibleH - r.pill.h) < 2, `clip=${first.clip} visibleH=${visibleH}`);
    check('it is not the generic rise from the screen bottom', !r.frames.some((f) => f.top > r.pill.top + 8));
    const settled = await page.evaluate(() => { const l = document.querySelector('.sheet-layer'); return { settled: l.classList.contains('is-settled'), clip: getComputedStyle(l.querySelector('.sheet')).clipPath }; });
    check('ends at rest, unclipped (is-settled, clip-path none)', settled.settled && settled.clip === 'none' && Math.abs(r.frames[r.frames.length - 1].top - r.rest) < 1, JSON.stringify(settled));
    await page.keyboard.press('Escape');
    check('Esc closes it and focus returns to the pill', await waitNoLayers(page) && /lpill-open/.test(await activeDesc(page)));
    // Same root cause for the + (#3): the circle must START at the +, not at
    // the CSS fallback geometry.
    const g = await page.evaluate(() => {
      const fab = document.getElementById('fab').getBoundingClientRect();
      document.getElementById('fab').click();
      const s = document.querySelector('.sheet-layer .sheet');
      const sr = s.getBoundingClientRect();
      return { clip: getComputedStyle(s).clipPath, cx: fab.left + fab.width / 2 - sr.left, cy: fab.top + fab.height / 2 - sr.top, r: fab.width / 2 };
    });
    // (Chromium may print the just-started value as calc(0% + Rpx))
    const gm = /circle\((?:calc\(0% \+ )?([\d.]+)px\)? at ([-\d.]+)px ([-\d.]+)px\)/.exec(g.clip);
    check('quick log first frame: a circle the size of the +, centred on it', !!gm && Math.abs(parseFloat(gm[1]) - g.r) < 1 && Math.abs(parseFloat(gm[2]) - g.cx) < 1 && Math.abs(parseFloat(gm[3]) - g.cy) < 1, `${g.clip} want r=${g.r} at ${g.cx} ${g.cy}`);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await waitNoLayers(page);
    await context.close();

    const { context: c2, page: p2 } = await freshPage({ reduced: true });
    await startEvent(p2, 'sleep', { kind: 'nap' }, 20);
    await p2.waitForSelector('.lpill');
    await p2.waitForTimeout(300);
    await p2.click('.lpill-open');
    await p2.waitForSelector('.sheet-layer[data-state="open"]');
    check('reduced motion: pill sheet fades instead (is-reduced, no is-rect)', await p2.evaluate(() => { const l = document.querySelector('.sheet-layer'); return l.classList.contains('is-reduced') && !l.classList.contains('is-rect'); }));
    await p2.keyboard.press('Escape');
    await waitNoLayers(p2);
    await c2.close();
  }

  // ======================================================== R1-05
  console.log('\nR1-05 finishing from a live pill keeps focus');
  {
    const { context, page } = await freshPage();
    await startEvent(page, 'feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' });
    await page.waitForSelector('.lpill');
    await page.waitForTimeout(500);
    await page.focus('.lpill-finish');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.sheet-layer[data-state="open"] [data-finish]');
    await page.waitForTimeout(450);
    await page.focus('.sheet-layer [data-finish]');
    await page.keyboard.press('Enter');
    await waitNoLayers(page);
    await page.waitForFunction(() => document.querySelectorAll('.lpill').length === 0, null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const a1 = await activeDesc(page);
    check('feed finished from its sheet: focus is not on <body>', a1 !== 'BODY', a1);
    check('…it lands on the + (no other pill)', a1 === 'button#fab.fab', a1);

    // Two pills: the sleep pill's Finish (no sheet) hands focus to the other pill.
    await startEvent(page, 'pump', {}, 3);
    await startEvent(page, 'sleep', { kind: 'nap' }, 10);
    await page.waitForFunction(() => document.querySelectorAll('.lpill').length === 2);
    await page.waitForTimeout(500);
    await page.focus('.lpill[data-kind="sleep"] .lpill-finish');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.lpill[data-kind="sleep"]:not([inert])'), null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
    const a2 = await page.evaluate(() => { const a = document.activeElement; return a && a.closest('.lpill') ? a.closest('.lpill').dataset.kind : (a === document.body ? 'BODY' : a.id || a.className); });
    check('sleep Finish (no sheet) with another pill: focus moves to that pill', a2 === 'pump', a2);
    // Last pill finished by keyboard → the +.
    await page.focus('.lpill[data-kind="pump"] .lpill-finish');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    if (await page.$('.sheet-layer [data-finish]')) {
      await page.focus('.sheet-layer [data-finish]');
      await page.keyboard.press('Enter');
      await waitNoLayers(page);
    }
    await page.waitForFunction(() => !document.querySelector('.lpill:not([inert])'), null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const a3 = await activeDesc(page);
    check('last pill finished: focus is on the +, not <body>', a3 === 'button#fab.fab', a3);
    await context.close();
  }

  // ======================================================== R1-06
  console.log('\nR1-06 pushed screens take and return focus');
  {
    const { context, page } = await freshPage();
    await page.focus('[data-view="today"] [data-action="settings"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-view="settings"]');
    await page.waitForTimeout(500);
    const a1 = await activeDesc(page);
    check('push: focus moves into the new screen', await page.evaluate(() => { const s = document.querySelector('[data-view="settings"]'); return s.contains(document.activeElement); }), a1);
    // Nested push from a settings row, then Back → that row.
    await page.focus('[data-view="settings"] [data-action="customize"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-view="settings"]').length === 2);
    await page.waitForTimeout(450);
    check('nested push: focus in the sub-page', await page.evaluate(() => document.querySelectorAll('[data-view="settings"]')[1].contains(document.activeElement)));
    await page.goBack();
    await page.waitForFunction(() => document.querySelectorAll('[data-view="settings"]').length === 1, null, { timeout: 3000 });
    await page.waitForTimeout(100);
    check('browser Back from the sub-page: focus returns to the row that opened it', await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-view="settings"] [data-action="customize"]')), await activeDesc(page));
    // In-app back button → the avatar.
    await page.focus('[data-view="settings"] [data-action="back"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-view="settings"]:not(.is-leaving-right)'), null, { timeout: 3000 });
    await page.waitForTimeout(100);
    check('in-app Back: focus returns to the avatar', await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-view="today"] [data-action="settings"]')), await activeDesc(page));
    // Push again, browser Back → the avatar.
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-view="settings"]:not(.is-leaving-right)');
    await page.waitForTimeout(450);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('[data-view="settings"]:not(.is-leaving-right)'), null, { timeout: 3000 });
    await page.waitForTimeout(100);
    check('browser Back: focus returns to the avatar', await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-view="today"] [data-action="settings"]')), await activeDesc(page));
    await context.close();

    // A navigation that removes the focused control ("Get started" tears
    // down the onboarding root) lands focus on the new view, not <body>.
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await p2.goto(`${BASE_URL}/`);
    await p2.waitForSelector('[data-view="onboarding"] [data-action="start"]', { timeout: 15000 });
    await p2.focus('[data-action="start"]');
    await p2.keyboard.press('Enter');
    await p2.waitForSelector('[data-view="today"]');
    await p2.waitForTimeout(400);
    check('keyboard "Get started": focus lands on Today, not <body>', await p2.evaluate(() => document.querySelector('[data-view="today"]').contains(document.activeElement)), await activeDesc(p2));
    await c2.close();
  }

  // ======================================================== R2-01
  console.log('\nR2-01 double-tap on a pill\'s Finish doesn\'t hit Undo');
  for (const gap of [60, 150]) {
    const { context, page } = await freshPage({ touch: true });
    const id = await startEvent(page, 'sleep', { kind: 'nap' }, 20);
    await page.waitForSelector('.lpill');
    await page.waitForTimeout(600);
    const b = await (await page.$('.lpill-finish')).boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(gap);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(700);
    const r = await page.evaluate(async ([u, eid]) => {
      const { events } = await import(u);
      const t = document.querySelector('.toast');
      return { endTime: (await events.get(eid)).endTime, toast: t ? t.querySelector('.toast-msg').textContent : null, undo: !!(t && t.querySelector('.toast-action')) };
    }, [mod('/js/core/store.js'), id]);
    check(`${gap} ms double-tap: the nap stays finished (2nd tap swallowed)`, r.endTime !== null && r.toast === 'Wake-up logged' && r.undo, JSON.stringify(r));
    if (gap === 150) {
      // A deliberate tap on Undo afterwards still works.
      const u = await (await page.$('.toast-action')).boundingBox();
      await page.touchscreen.tap(u.x + u.width / 2, u.y + u.height / 2);
      await page.waitForTimeout(300);
      const after = await page.evaluate(async ([m, eid]) => { const { events } = await import(m); const t = document.querySelector('.toast-msg'); return { endTime: (await events.get(eid)).endTime, msg: t && t.textContent }; }, [mod('/js/core/store.js'), id]);
      check('…a later, deliberate Undo tap restores it', after.endTime === null && after.msg === 'Restored', JSON.stringify(after));
    }
    await context.close();
  }
  {
    // The guard is in toast() itself: an immediate pointer click is ignored,
    // keyboard activation is not.
    const { context, page } = await freshPage();
    const r = await page.evaluate(async (u) => {
      const { toast } = await import(u);
      let runs = 0;
      toast({ message: 'Deleted', action: { label: 'Undo', run() { runs += 1; } } });
      const btn = document.querySelector('.toast-action');
      const opts = { bubbles: true, cancelable: true, detail: 1 };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('click', opts));
      const early = runs;
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
      await new Promise((res) => setTimeout(res, 20));
      return { early, keyboard: runs };
    }, mod('/js/ui/toast.js'));
    check('toast: a pointer tap in the first moments is ignored, keyboard activation is not', r.early === 0 && r.keyboard === 1, JSON.stringify(r));
    await context.close();
  }

  // ======================================================== R2-02
  console.log('\nR2-02 double-tap on a pill doesn\'t hit its sheet\'s primary');
  for (const [type, data, label] of [['sleep', { kind: 'nap' }, 'nap'], ['feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, 'bottle']]) {
    const { context, page } = await freshPage({ touch: true });
    const id = await startEvent(page, type, data, 20);
    await page.waitForSelector('.lpill');
    await page.waitForTimeout(600);
    const b = await (await page.$('.lpill-open')).boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(250);
    const under = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return !!(el && el.closest('.sheet-layer [data-finish]')); }, [cx, cy]);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(700);
    const endTime = await page.evaluate(async ([u, eid]) => { const { events } = await import(u); return (await events.get(eid)).endTime; }, [mod('/js/core/store.js'), id]);
    check(`${label}: the 2nd tap lands on the sheet's primary (repro precondition)`, under);
    check(`${label}: …and is swallowed — still running, sheet still open`, endTime === null && (await layers(page)).join() === 'open', `endTime=${endTime} layers=${await layers(page)}`);
    const f = await (await page.$('.sheet-layer [data-finish]')).boundingBox();
    await page.touchscreen.tap(f.x + f.width / 2, f.y + f.height / 2);
    await waitNoLayers(page);
    const end2 = await page.evaluate(async ([u, eid]) => { const { events } = await import(u); return (await events.get(eid)).endTime; }, [mod('/js/core/store.js'), id]);
    check(`${label}: a deliberate tap on the primary afterwards finishes it`, end2 !== null);
    await context.close();
  }

  // ======================================================== R2-03
  console.log('\nR2-03 + → tile: the twin sits on the +, which stays hidden');
  {
    const { context, page } = await freshPage();
    const fab0 = await page.evaluate(() => { const r = document.getElementById('fab').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    await page.click('#fab');
    await page.waitForTimeout(600);
    await page.click('.sheet-layer [data-key="bottle"]');
    await page.waitForTimeout(60);
    const g = await page.evaluate(() => {
      const ls = [...document.querySelectorAll('.sheet-layer')];
      const top = ls[ls.length - 1];
      const x = top.querySelector('.fab-x');
      const s = top.querySelector('.sheet');
      return {
        n: ls.length,
        left: parseFloat(x.style.getPropertyValue('--fab-left')),
        top: parseFloat(x.style.getPropertyValue('--fab-top')),
        size: parseFloat(x.style.getPropertyValue('--fab-size-px')),
        growX: parseFloat(s.style.getPropertyValue('--grow-x')) + s.getBoundingClientRect().left,
        growY: parseFloat(s.style.getPropertyValue('--grow-y')) + s.getBoundingClientRect().top,
        growR: parseFloat(s.style.getPropertyValue('--grow-r')),
      };
    });
    const near = (a, b) => Math.abs(a - b) < 0.75;
    check('feed sheet from a tile: twin at the +\'s resting spot and size', near(g.left, fab0.x) && near(g.top, fab0.y) && near(g.size, fab0.w), `${JSON.stringify(g)} vs ${JSON.stringify(fab0)}`);
    check('…and its grow circle is centred on the + at the +\'s radius', near(g.growX, fab0.x + fab0.w / 2) && near(g.growY, fab0.y + fab0.w / 2) && near(g.growR, fab0.w / 2), JSON.stringify(g));
    await page.waitForTimeout(600);
    // Close it, watching every frame: the real + must stay hidden as long as
    // any twin is on screen, and reappear exactly where the twin was.
    const trace = page.evaluate(async () => {
      const out = [];
      const t0 = performance.now();
      await new Promise((res) => {
        const f = () => {
          const fab = document.getElementById('fab');
          out.push({ twin: !!document.querySelector('.fab-x'), vis: getComputedStyle(fab).visibility });
          if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res();
        };
        f();
      });
      return out;
    });
    await page.keyboard.press('Escape');
    const frames = await trace;
    const bad = frames.filter((f) => f.twin && f.vis === 'visible').length;
    check('during the close, never a twin and a visible + at once', bad === 0 && frames.some((f) => f.twin), `${bad} of ${frames.length} frames`);
    check('…and the + is visible once the twin is gone', frames[frames.length - 1].vis === 'visible' && !frames[frames.length - 1].twin);
    const fab1 = await page.evaluate(() => { const r = document.getElementById('fab').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
    check('…exactly where the twin was', near(fab1.x, g.left) && near(fab1.y, g.top), `${JSON.stringify(fab1)} vs twin ${g.left},${g.top}`);
    await context.close();
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (err) {
  failures.push(`crashed: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nmotion-focus: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
