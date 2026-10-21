// Unit tests for the shared-element FLIP math in sheet.js (#6, #16 — QA
// MAV-1 / MAV-2): a flight copy laid out at its own box must land EXACTLY on
// the target rect, so the swap with the real element is invisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipTransform } from '../js/ui/sheet.js';

/** Apply "translate(dx, dy) scale(sx[, sy])" (origin top-left) to a box. */
function apply(home, tf) {
  const m = /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)(?:, ([-\d.]+))?\)$/.exec(tf);
  assert.ok(m, `unexpected transform: ${tf}`);
  const [dx, dy, sx] = [m[1], m[2], m[3]].map(Number);
  const sy = m[4] === undefined ? sx : Number(m[4]);
  return { left: home.left + dx, top: home.top + dy, width: home.width * sx, height: home.height * sy };
}
const close = (a, b) => ['left', 'top', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 0.05);

test('flipTransform maps a box onto any rect (chip: card icon → header chip and back)', () => {
  const home = { left: 20, top: 359, width: 36, height: 36 };      // header chip at rest
  const icon = { left: 36, top: 112, width: 20, height: 20 };      // the card's icon
  assert.ok(close(apply(home, flipTransform(home, icon)), icon));
  assert.ok(close(apply(home, flipTransform(home, home)), home), 'identity at home');
  assert.equal(flipTransform(home, home), 'translate(0px, 0px) scale(1, 1)');
});

test('flipTransform uniform: text keeps its aspect, centred on the target, its height', () => {
  const timer = { left: 124, top: 259, width: 143, height: 56 };   // the sheet's 00:00
  const time = { left: 219, top: 730, width: 67, height: 29 };     // the pill's time
  const r = apply(timer, flipTransform(timer, time, { uniform: true }));
  assert.ok(Math.abs(r.height - time.height) < 0.05);
  assert.ok(Math.abs((r.left + r.width / 2) - (time.left + time.width / 2)) < 0.05, 'centred');
  assert.ok(Math.abs(r.top - time.top) < 0.05);
  assert.ok(Math.abs(r.width / r.height - timer.width / timer.height) < 0.05, 'aspect kept');
});

test('flipTransform survives a zero-size home (no NaN / Infinity)', () => {
  const tf = flipTransform({ left: 0, top: 0, width: 0, height: 0 }, { left: 5, top: 6, width: 7, height: 8 });
  assert.ok(!/NaN|Infinity/.test(tf), tf);
});
