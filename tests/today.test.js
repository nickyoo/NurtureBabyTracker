// Today view: the pure helpers that decide which cards and rows show
// (DESIGN §6.3, §10 "Hidden trackers disappear everywhere").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../js/views/today.js';

const { visibleCards, eventVisible } = _test;
const ALL = { bottle: true, formula: true, breastfeeding: true, pump: true, stash: true, sleep: true, diaper: true, memories: true };

test('cards follow settings.todayOrder, visible trackers only', () => {
  assert.deepEqual(visibleCards(['feed', 'sleep', 'diaper', 'pump', 'stash'], ALL), ['feed', 'sleep', 'diaper', 'pump', 'stash']);
  assert.deepEqual(visibleCards(['pump', 'feed', 'sleep', 'diaper', 'stash'], { ...ALL, sleep: false }), ['pump', 'feed', 'diaper', 'stash']);
  assert.deepEqual(visibleCards(['feed', 'sleep', 'diaper', 'pump', 'stash'], { ...ALL, pump: false, stash: false }), ['feed', 'sleep', 'diaper']);
});

test('the feed card shows while either bottle or breastfeeding is on', () => {
  assert.ok(visibleCards(null, { ...ALL, bottle: false }).includes('feed'));
  assert.ok(visibleCards(null, { ...ALL, breastfeeding: false }).includes('feed'));
  assert.ok(!visibleCards(null, { ...ALL, bottle: false, breastfeeding: false }).includes('feed'));
});

test('a partial or junk todayOrder still lists every visible card once', () => {
  assert.deepEqual(visibleCards(['diaper', 'diaper', 'bogus'], ALL), ['diaper', 'feed', 'sleep', 'pump', 'stash']);
  assert.deepEqual(visibleCards(undefined, ALL), ['feed', 'sleep', 'diaper', 'pump', 'stash']);
});

test('rows of hidden trackers disappear', () => {
  const bottle = { type: 'feed', data: { method: 'bottle' } };
  const breast = { type: 'feed', data: { method: 'breast' } };
  assert.equal(eventVisible(bottle, { ...ALL, bottle: false }), false);
  assert.equal(eventVisible(breast, { ...ALL, bottle: false }), true);
  assert.equal(eventVisible(breast, { ...ALL, breastfeeding: false }), false);
  assert.equal(eventVisible({ type: 'pump', data: {} }, { ...ALL, pump: false }), false);
  assert.equal(eventVisible({ type: 'sleep', data: {} }, { ...ALL, sleep: false }), false);
  assert.equal(eventVisible({ type: 'diaper', data: {} }, { ...ALL, diaper: false }), false);
  assert.equal(eventVisible({ type: 'milestone', data: {} }, { ...ALL, memories: false }), false);
  assert.equal(eventVisible({ type: 'milestone', data: {} }, ALL), true);
});
