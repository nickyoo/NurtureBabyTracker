// Pure helpers of the Memories view (js/views/memories.js) and the memory
// sheet (js/sheets/memory.js). Both modules import nothing, so they load in
// node without a DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test as V } from '../js/views/memories.js';
import { _test as S } from '../js/sheets/memory.js';
import { babyAge } from '../js/ui/format.js';

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('memories: the view and the sheet share one preset table', () => {
  assert.deepEqual(V.PRESETS.map((p) => ({ ...p })), S.PRESETS.map((p) => ({ ...p })));
  assert.equal(V.PRESETS.length, 12);
  assert.equal(new Set(V.PRESETS.map((p) => p.key)).size, 12);
  for (const p of V.PRESETS) {
    assert.match(p.key, /^[a-z0-9][a-z0-9-]{0,59}$/, 'store MILESTONE_KEY_RE');
    assert.match(p.usually, /^Usually /);
    assert.ok(p.min <= p.max);
    assert.doesNotMatch(`${p.title} ${p.caption} ${p.usually}`, /\b(she|her|he|his|him)\b/i, 'never a pronoun for the baby');
  }
});

test('memories: suggestion follows Frame 6 (6 weeks, three firsts kept → Laughs out loud)', () => {
  const kept = new Set(['first-smile', 'head-up', 'first-bath']);
  assert.equal(V.suggestNext(kept, 42).title, 'Laughs out loud');
  assert.equal(V.suggestNext(kept, 42).usually, 'Usually 3–4 months');
  // Nothing kept at 6 weeks: the bath's window has passed, head up is next.
  assert.equal(V.suggestNext(new Set(), 42).key, 'head-up');
  // Newborn: the bath.
  assert.equal(V.suggestNext(new Set(), 3).key, 'first-bath');
  // Unknown age: the earliest unkept.
  assert.equal(V.suggestNext(new Set(['first-bath']), null).key, 'head-up');
  // Past every window: still the earliest unkept, never nothing.
  assert.equal(V.suggestNext(new Set(['first-bath']), 900).key, 'head-up');
  // All kept: no suggestion.
  assert.equal(V.suggestNext(new Set(V.PRESETS.map((p) => p.key)), 100), null);
});

test('memories: week of life matches Frame 6 ("Week 6 · Oct 7–13" for a Sep 2 birth)', () => {
  const fmt = (ts, o) => new Date(ts).toLocaleDateString('en-US', o);
  const w = V.weekOf(local(2026, 10, 9), '2026-09-02', fmt);
  assert.equal(w.title, 'Week 6');
  assert.equal(w.range, 'Oct 7–13');
  assert.equal(V.weekOf(local(2026, 10, 13, 23, 59), '2026-09-02', fmt).key, w.key);
  assert.equal(V.weekOf(local(2026, 10, 14, 0, 1), '2026-09-02', fmt).title, 'Week 7');
  assert.equal(V.weekOf(local(2026, 9, 2, 1), '2026-09-02', fmt).title, 'Week 1');
  // Across a month boundary.
  assert.equal(V.weekOf(local(2026, 9, 30), '2026-09-02', fmt).range, 'Sep 30 – Oct 6');
  // No birth date (or before birth): a calendar week, no number.
  const c = V.weekOf(local(2026, 10, 9), null, fmt);
  assert.equal(c.title, '');
  assert.equal(c.range, 'Oct 4–10');
});

test('memories: book model — cover, firsts, kept count, own memories by week', () => {
  const ev = (id, day, data) => ({ id, type: 'milestone', startTime: local(2026, 10, day), createdAt: 1, data: { photoIds: [], ...data } });
  const list = [
    ev('a', 9, { key: 'first-smile', title: 'First real smile', photoIds: ['pho_1'] }),
    ev('b', 1, { key: 'head-up', title: 'Head up in tummy time', photoIds: ['pho_2'] }),
    ev('c', 12, { key: null, title: 'Grandma visits' }),
    ev('d', 8, { key: null, title: 'Park', photoIds: ['pho_3'] }),
  ];
  const m = V.bookModel(list, { birthDate: '2026-09-02', coverId: null, now: local(2026, 10, 14) });
  assert.equal(m.cover.id, 'a', 'newest memory with a photo');
  assert.deepEqual(m.firsts.map((e) => e.id), ['a', 'b'], 'newest first');
  assert.equal(m.keptCount, 2);
  assert.equal(m.suggestion.key, 'laughs');
  assert.equal(m.groups.length, 1);
  assert.deepEqual(m.groups[0].items.map((e) => e.id), ['c', 'd']);
  // A chosen cover wins; a stale choice falls back.
  assert.equal(V.bookModel(list, { birthDate: '2026-09-02', coverId: 'b', now: 0 }).cover.id, 'b');
  assert.equal(V.bookModel(list, { birthDate: '2026-09-02', coverId: 'zzz', now: 0 }).cover.id, 'a');
  assert.equal(V.bookModel(list.filter((e) => !e.data.photoIds.length), { birthDate: null, coverId: null, now: 0 }).cover, null);
});

test('memories: small words', () => {
  assert.equal(V.shortAge('5 weeks, 2 days'), '5 weeks');
  assert.equal(V.shortAge('3 months'), '3 months');
  assert.equal(V.bytesLabel(0), '0 KB');
  assert.equal(V.bytesLabel(800 * 1024), '800 KB');
  assert.equal(V.bytesLabel(3.4 * 1024 * 1024), '3.4 MB');
  assert.equal(V.bytesLabel(2 * 1024 * 1024), '2 MB');
  assert.equal(V.bytesLabel(25.4 * 1024 * 1024), '25 MB');
  assert.equal(V.ageDays('2026-09-02', local(2026, 10, 14)), 42);
  assert.equal(V.ageDays('2026-09-02', local(2026, 8, 30)), null);
  assert.equal(V.ageDays(null, Date.now()), null);
});

test('memory sheet: the day picked becomes a sensible time', () => {
  const now = local(2026, 10, 14, 9, 50);
  assert.equal(S.startFor('2026-10-14', { now }), now, 'today → now');
  assert.equal(S.startFor('2026-10-09', { now }), local(2026, 10, 9, 12), 'another day → its noon');
  const kept = local(2026, 10, 9, 15, 30);
  assert.equal(S.startFor('2026-10-09', { keep: kept, now }), kept, 'the same day keeps its exact time');
  assert.equal(S.startFor('2026-10-08', { keep: kept, now }), local(2026, 10, 8, 12));
  assert.ok(Number.isNaN(S.startFor('2026-02-30', { now })));
  assert.ok(Number.isNaN(S.startFor('', { now })));
});

test('memory sheet: calm validation', () => {
  const now = local(2026, 10, 14, 9);
  assert.equal(S.formProblem({ title: ' ', day: '2026-10-14', now }), 'Give this memory a name.');
  assert.equal(S.formProblem({ title: 'Smile', day: '', now }), 'Pick the day it happened.');
  assert.equal(S.formProblem({ title: 'Smile', day: '2026-10-15', now }), 'That day is still to come. Pick a day up to today.');
  assert.equal(S.formProblem({ title: 'Smile', day: '2026-10-14', now }), '');
});

test('memory sheet: age line uses the name, never a pronoun', () => {
  assert.equal(S.ageLine('Clara', '2026-09-02', '2026-10-09', babyAge), 'Clara was 5 weeks, 2 days.');
  assert.equal(S.ageLine('Clara', '2026-09-02', '2026-09-28', babyAge), 'Clara was 3 weeks, 5 days.');
  assert.equal(S.ageLine('Clara', '2026-09-02', '2026-09-06', babyAge), 'Clara was 4 days.');
  assert.equal(S.ageLine('Clara', '2026-09-02', '2026-09-02', babyAge), 'The day Clara was born.');
  assert.equal(S.ageLine('Clara', '2026-09-02', '2026-08-20', babyAge), 'Before Clara was born.');
  assert.equal(S.ageLine('Clara', null, '2026-10-09', babyAge), '');
});

test('memory sheet: chips offer the firsts not kept yet, in typical-age order', () => {
  const kept = new Map([['first-smile', 1], ['first-bath', 1]]);
  const keys = S.chipPresets(kept, null).map((p) => p.key);
  assert.ok(!keys.includes('first-smile') && !keys.includes('first-bath'));
  assert.equal(keys[0], 'head-up');
  assert.equal(keys.length, 10);
  assert.ok(S.chipPresets(kept, 'first-smile').some((p) => p.key === 'first-smile'), 'the chosen one stays');
  assert.equal(S.chipPresets(null, null).length, 12);
});
