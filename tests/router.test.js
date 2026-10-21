// ui/router.js pure logic: tab visibility, direction, Back behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAB_ORDER, visibleTabs, resolveTab, tabDirection, backAction, backDepth } from '../js/ui/router.js';

const ALL_ON = { bottle: true, formula: true, breastfeeding: true, pump: true, stash: true, sleep: true, diaper: true, memories: true };

test('nav order is Today · Timeline · Stash · Memories', () => {
  assert.deepEqual([...TAB_ORDER], ['today', 'timeline', 'stash', 'memories']);
});

test('visibleTabs hides Stash / Memories with their trackers only', () => {
  assert.deepEqual(visibleTabs(ALL_ON), ['today', 'timeline', 'stash', 'memories']);
  assert.deepEqual(visibleTabs({ ...ALL_ON, stash: false }), ['today', 'timeline', 'memories']);
  assert.deepEqual(visibleTabs({ ...ALL_ON, memories: false }), ['today', 'timeline', 'stash']);
  assert.deepEqual(visibleTabs({ ...ALL_ON, stash: false, memories: false }), ['today', 'timeline']);
  // other trackers never hide a tab (pump off ≠ stash off)
  assert.deepEqual(visibleTabs({ ...ALL_ON, pump: false, sleep: false, diaper: false }), ['today', 'timeline', 'stash', 'memories']);
  // missing / partial settings default to visible
  assert.deepEqual(visibleTabs(null), ['today', 'timeline', 'stash', 'memories']);
  assert.deepEqual(visibleTabs({}), ['today', 'timeline', 'stash', 'memories']);
});

test('resolveTab redirects hidden or unknown tabs to Today', () => {
  assert.equal(resolveTab('stash', ALL_ON), 'stash');
  assert.equal(resolveTab('stash', { ...ALL_ON, stash: false }), 'today');
  assert.equal(resolveTab('memories', { ...ALL_ON, memories: false }), 'today');
  assert.equal(resolveTab('settings', ALL_ON), 'today');
  assert.equal(resolveTab('timeline', { stash: false, memories: false }), 'timeline');
});

test('tabDirection follows nav order', () => {
  assert.equal(tabDirection('today', 'timeline'), 1);
  assert.equal(tabDirection('today', 'memories'), 1);
  assert.equal(tabDirection('stash', 'timeline'), -1);
  assert.equal(tabDirection('memories', 'today'), -1);
  assert.equal(tabDirection('today', 'today'), 0);
  assert.equal(tabDirection(null, 'today'), 0, 'first mount has no direction');
  assert.equal(tabDirection('today', 'settings'), 0);
});

test('backAction: top sheet first, then screens, then Today, then leave', () => {
  assert.equal(backAction({ sheets: 1, screens: 2, tab: 'stash' }), 'sheet');
  assert.equal(backAction({ sheets: 0, screens: 2, tab: 'stash' }), 'screen');
  assert.equal(backAction({ sheets: 0, screens: 0, tab: 'stash' }), 'tab');
  assert.equal(backAction({ sheets: 0, screens: 0, tab: 'today' }), 'none');
  assert.equal(backAction({ sheets: 0, screens: 0, tab: null, root: true }), 'none', 'Back on onboarding leaves the app');
  assert.equal(backAction({ sheets: 1, root: true }), 'sheet', 'a sheet over onboarding still closes first');
  assert.equal(backAction(), 'none');
});

test('backDepth counts every level Back can absorb', () => {
  assert.equal(backDepth({ sheets: 0, screens: 0, tab: 'today' }), 0);
  assert.equal(backDepth({ sheets: 0, screens: 0, tab: 'timeline' }), 1);
  assert.equal(backDepth({ sheets: 2, screens: 1, tab: 'stash' }), 4);
  assert.equal(backDepth({ sheets: 0, screens: 0, tab: null, root: true }), 0);
  assert.equal(backDepth({ sheets: 1, screens: 0, tab: null, root: true }), 1);
});

test('FLOW-02: onboarding past its first step takes Back itself (one step back)', () => {
  assert.equal(backAction({ sheets: 0, screens: 0, tab: null, root: true, rootStep: true }), 'root');
  assert.equal(backDepth({ sheets: 0, screens: 0, tab: null, root: true, rootStep: true }), 1);
  assert.equal(backAction({ sheets: 1, root: true, rootStep: true }), 'sheet', 'a sheet over onboarding still closes first');
  assert.equal(backDepth({ sheets: 1, root: true, rootStep: true }), 2);
  assert.equal(backAction({ root: true, rootStep: false }), 'none', 'first step: Back leaves');
  assert.equal(backAction({ tab: 'today', rootStep: true }), 'none', 'rootStep means nothing without a root');
  assert.equal(backDepth({ tab: 'today', rootStep: true }), 0);
});
