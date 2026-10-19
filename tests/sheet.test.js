// Unit tests for sheet.js helpers that don't need a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterTransition, ENTER_GUARD_MS, guardEnterTaps, untransformRect } from '../js/ui/sheet.js';

function transitionEvent(type, propertyName) {
  const e = new Event(type);
  Object.defineProperty(e, 'propertyName', { value: propertyName });
  return e;
}

// R1-01: closing a surface during its enter transition cancels the enter
// transition; that transitioncancel must not count as "exit finished".
test('afterTransition ignores transitioncancel (it falls through to the timeout)', async () => {
  const el = new EventTarget();
  let calls = 0;
  afterTransition(el, 60, () => { calls += 1; });
  el.dispatchEvent(transitionEvent('transitioncancel', 'transform'));
  assert.equal(calls, 0, 'a cancelled transition is not completion');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(calls, 1, 'the timeout fallback still finishes it');
});

test('afterTransition with a property only accepts that property\'s transitionend', () => {
  const el = new EventTarget();
  let calls = 0;
  const cancel = afterTransition(el, 10000, () => { calls += 1; }, { property: 'transform' });
  el.dispatchEvent(transitionEvent('transitionend', 'opacity'));
  assert.equal(calls, 0);
  el.dispatchEvent(transitionEvent('transitionend', 'transform'));
  assert.equal(calls, 1);
  el.dispatchEvent(transitionEvent('transitionend', 'transform'));
  assert.equal(calls, 1, 'runs once');
  cancel();
});

test('afterTransition ignores events bubbling from children, and cancel() stops it', async () => {
  const el = new EventTarget();
  let calls = 0;
  const stop = afterTransition(el, 10000, () => { calls += 1; });
  const ev = transitionEvent('transitionend', 'transform');
  Object.defineProperty(ev, 'target', { value: {} });
  el.dispatchEvent(ev);
  assert.equal(calls, 0);
  stop();
  const cancel = afterTransition(el, 20, () => { calls += 1; });
  cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 0);
});

// R1-02: the × / scrim ignore the tail of the opening tap for a while.
test('enter guard covers a double-tap interval', () => {
  assert.ok(ENTER_GUARD_MS >= 300 && ENTER_GUARD_MS <= 500, String(ENTER_GUARD_MS));
});

// R2-01 / R2-02: a click whose press landed during the guard is swallowed
// before handlers inside the guarded element run; keyboard clicks pass.
function click(detail) {
  const e = new Event('click', { cancelable: true });
  Object.defineProperty(e, 'detail', { value: detail });
  return e;
}

test('guardEnterTaps swallows a pointer click pressed inside the guard window', () => {
  const el = new EventTarget();
  let hits = 0;
  guardEnterTaps(el, { shownAt: performance.now(), ms: 10000 });
  el.addEventListener('click', () => { hits += 1; });
  el.dispatchEvent(new Event('pointerdown'));
  const e = click(1);
  el.dispatchEvent(e);
  assert.equal(hits, 0, 'the second tap of a double-tap does nothing');
  assert.equal(e.defaultPrevented, true);
});

test('guardEnterTaps swallows a click whose press started before the element appeared', () => {
  const el = new EventTarget();
  let hits = 0;
  guardEnterTaps(el, { shownAt: performance.now() - 60000, ms: 10 });
  el.addEventListener('click', () => { hits += 1; });
  el.dispatchEvent(click(1)); // no pointerdown inside el
  assert.equal(hits, 0);
});

test('guardEnterTaps lets a deliberate later tap and keyboard activation through', () => {
  const el = new EventTarget();
  let hits = 0;
  guardEnterTaps(el, { shownAt: performance.now() - 1000, ms: 350 });
  el.addEventListener('click', () => { hits += 1; });
  el.dispatchEvent(new Event('pointerdown'));
  el.dispatchEvent(click(1));
  assert.equal(hits, 1, 'pressed after the guard: works');

  const el2 = new EventTarget();
  let hits2 = 0;
  guardEnterTaps(el2, { shownAt: performance.now(), ms: 10000 });
  el2.addEventListener('click', () => { hits2 += 1; });
  el2.dispatchEvent(click(0)); // Enter / Space / el.click()
  assert.equal(hits2, 1, 'keyboard activation is never delayed');
});

test('guardEnterTaps returns a remover', () => {
  const el = new EventTarget();
  let hits = 0;
  const off = guardEnterTaps(el, { shownAt: performance.now(), ms: 10000 });
  el.addEventListener('click', () => { hits += 1; });
  off();
  el.dispatchEvent(new Event('pointerdown'));
  el.dispatchEvent(click(1));
  assert.equal(hits, 1);
});

// R2-03: the + measured while #app is at scale(.985) (transform-origin 50% 0)
// maps back to its resting geometry.
test('untransformRect divides out a scale about the transform origin', () => {
  const s = 0.985;
  const origin = { x: 195, y: 0 };
  const rest = { left: 166, top: 781, width: 58, height: 58 };
  const scaled = {
    left: origin.x + s * (rest.left - origin.x),
    top: origin.y + s * (rest.top - origin.y),
    width: rest.width * s,
    height: rest.height * s,
  };
  const r = untransformRect(scaled, { a: s, b: 0, c: 0, d: s, e: 0, f: 0 }, origin);
  for (const k of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(r[k] - rest[k]) < 1e-9, `${k}: ${r[k]} vs ${rest[k]}`);
  assert.ok(Math.abs(r.bottom - 839) < 1e-9 && Math.abs(r.right - 224) < 1e-9);
});

test('untransformRect handles translation, and a degenerate matrix returns the rect', () => {
  const r = untransformRect({ left: 110, top: 220, width: 10, height: 10 }, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }, { x: 0, y: 0 });
  assert.deepEqual([r.left, r.top, r.width, r.height], [100, 200, 10, 10]);
  const z = untransformRect({ left: 1, top: 2, width: 3, height: 4 }, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, { x: 0, y: 0 });
  assert.deepEqual([z.left, z.top, z.width, z.height], [1, 2, 3, 4]);
});
