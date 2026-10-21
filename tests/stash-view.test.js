// Stash view + sheet: the pure helpers behind "Use next", the ExpiryBadge
// words and the time phrases (DESIGN §6.8 ExpiryBadge / UseNextHero, §10,
// §16.1 Use-next rule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test as view } from '../js/views/stash.js';
import { _test as sheet } from '../js/sheets/stash.js';

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = new Date(2026, 9, 14, 9, 50).getTime();
let n = 0;
const pouch = (location, pumpedAgo, expiresIn, extra = {}) => ({
  id: `p${(n += 1)}`, status: 'active', location, quantity: 4, unit: 'oz',
  pumpedAt: NOW - pumpedAgo, expiresAt: NOW + expiresIn, createdAt: NOW - pumpedAgo, ...extra,
});

test('Use next: the oldest frozen pouch (FIFO) while fridge milk keeps', () => {
  const fridge = pouch('fridge', 14 * H, 3 * D);
  const newer = pouch('freezer', 20 * D, 160 * D);
  const oldest = pouch('freezer', 42 * D, 138 * D);
  const deep = pouch('deepFreezer', 30 * D, 330 * D);
  assert.equal(view.pickHero([fridge, newer, oldest, deep], NOW).id, oldest.id);
});

test('Use next: thawed milk first, then fridge milk that must go within a day', () => {
  const frozen = pouch('freezer', 42 * D, 138 * D);
  const soon = pouch('fridge', 3.5 * D, 10 * H);
  const thawed = pouch('thawed', 50 * D, 20 * H, { thawedAt: NOW - 4 * H });
  assert.equal(view.pickHero([frozen, soon, thawed], NOW).id, thawed.id);
  assert.equal(view.pickHero([frozen, soon], NOW).id, soon.id);
});

test('Use next: only fridge milk → the soonest to expire; nothing → null', () => {
  const a = pouch('fridge', 1 * D, 3 * D);
  const b = pouch('fridge', 2 * D, 2 * D);
  assert.equal(view.pickHero([a, b], NOW).id, b.id);
  assert.equal(view.pickHero([], NOW), null);
});

test('ExpiryBadge: words for every state, danger only when expired', () => {
  for (const badge of [view.expiryBadge, (item, now) => sheet.expiryBadge(null, item, now)]) {
    assert.deepEqual(badge(pouch('fridge', 1 * D, 3 * D), NOW), { ...badge(pouch('fridge', 1 * D, 3 * D), NOW), tone: 'ok', text: '3 days left' });
    assert.equal(badge(pouch('fridge', 3 * D, 30 * H), NOW).text, '1 day left');
    assert.equal(badge(pouch('fridge', 3 * D, 30 * H), NOW).tone, 'warn');
    assert.equal(badge(pouch('fridge', 3.8 * D, 5 * H), NOW).text, 'Use within 5h');
    assert.equal(badge(pouch('thawed', 9 * D, 20 * 60 * 1000), NOW).text, 'Use within 20 min');
    assert.match(badge(pouch('freezer', 42 * D, 138 * D), NOW).text, /^Best by [A-Z][a-z]{2} \d{1,2}$/);
    const gone = badge(pouch('fridge', 5 * D, -1 * H), NOW);
    assert.equal(gone.tone, 'danger');
    assert.equal(gone.text, 'Expired · discard');
  }
});

test('time words never claim time that is not there', () => {
  assert.equal(view.leftWords(138 * D), '4½ months left');
  assert.equal(view.leftWords(20 * D), '2 weeks left');
  assert.equal(view.leftWords(36 * H), '1 day left');
  assert.equal(view.leftWords(5.9 * H), '5h left');
  assert.equal(view.leftWords(10 * 1000), '1 min left');
  assert.equal(view.ageWords(42 * D), '6 weeks');
  assert.equal(view.ageWords(3 * D), '3 days');
  assert.equal(view.ageWords(20 * 60 * 1000), 'under an hour');
  assert.equal(sheet.leftWords(138 * D), view.leftWords(138 * D));
});

test('usual bottle: median of recent bottles', () => {
  assert.equal(view.median([4, 3, 5]), 4);
  assert.equal(view.median([4, 5]), 4.5);
  assert.equal(view.median([]), null);
});
