// Timeline, pediatrician report and entry sheet: the pure helpers behind
// the day pager, the 24h strip, the report's sections and the edit form's
// validation (DESIGN §6.8, §10, §13 Frame 4; ARCHITECTURE §10c).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test as tl } from '../js/views/timeline.js';
import { _test as rp } from '../js/views/report.js';
import { _test as ev } from '../js/sheets/event.js';

const ALL = { bottle: true, formula: true, breastfeeding: true, pump: true, stash: true, sleep: true, diaper: true, memories: true };
const H = 3600 * 1000;
const day0 = new Date(2026, 9, 14).getTime();
const at = (h, m = 0) => new Date(2026, 9, 14, h, m).getTime();
const startOf = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };

test('timeline: hidden trackers drop their lanes, tiles and rows', () => {
  assert.deepEqual(tl.visibleLanes(ALL).map((l) => l.key), ['sleep', 'feed', 'diaper', 'pump']);
  assert.deepEqual(tl.visibleLanes({ ...ALL, pump: false, sleep: false }).map((l) => l.key), ['feed', 'diaper']);
  // The feed lane stays while either kind of feed is on.
  assert.ok(tl.visibleLanes({ ...ALL, bottle: false }).some((l) => l.key === 'feed'));
  assert.ok(!tl.visibleLanes({ ...ALL, bottle: false, breastfeeding: false }).some((l) => l.key === 'feed'));
  assert.equal(tl.eventVisible({ type: 'feed', data: { method: 'breast' } }, { ...ALL, breastfeeding: false }), false);
  assert.equal(tl.eventVisible({ type: 'feed', data: { method: 'bottle' } }, { ...ALL, breastfeeding: false }), true);
  assert.equal(tl.eventVisible({ type: 'milestone', data: {} }, { ...ALL, memories: false }), false);
});

test('timeline: the week row ends on today and pages back by whole weeks', () => {
  const today = startOf(day0);
  const w = tl.weekWindow(today, today, addDays, startOf);
  assert.equal(w.length, 7);
  assert.equal(w[6], today);
  const lastWeek = tl.weekWindow(startOf(addDays(today, -7)), today, addDays, startOf);
  assert.equal(lastWeek[6], startOf(addDays(today, -7)));
  const inWeek = tl.weekWindow(startOf(addDays(today, -3)), today, addDays, startOf);
  assert.equal(inWeek[6], today, 'a day inside this week keeps the current week row');
});

test('timeline: strip marks carry meaning by shape (night solid, nap outline, breast hollow, diaper glyphs)', () => {
  const lanes = tl.visibleLanes(ALL);
  const evs = [
    { id: 'a', type: 'sleep', startTime: at(0) - 2 * H, endTime: at(2), data: { kind: 'night' } },
    { id: 'b', type: 'sleep', startTime: at(8, 55), endTime: null, data: { kind: 'nap' } },
    { id: 'c', type: 'feed', startTime: at(2, 10), endTime: at(2, 28), data: { method: 'bottle' } },
    { id: 'd', type: 'feed', startTime: at(5, 5), endTime: at(5, 25), data: { method: 'breast' } },
    { id: 'e', type: 'diaper', startTime: at(2, 25), endTime: at(2, 25), data: { kind: 'dirty' } },
    { id: 'f', type: 'diaper', startTime: at(6, 50), endTime: at(6, 50), data: { kind: 'both' } },
    { id: 'g', type: 'pump', startTime: at(7, 10), endTime: at(7, 26), data: {} },
  ];
  const { marks, nowX } = tl.stripMarks(evs, { dayStart: at(0), dayEnd: addDays(at(0), 1), now: at(9, 50), lanes });
  const by = Object.fromEntries(marks.map((m) => [m.id, m]));
  assert.equal(by.a.shape, 'night');
  assert.equal(by.a.x1, 30, 'a night that began yesterday is clipped at midnight');
  assert.equal(by.b.shape, 'nap');
  assert.ok(by.b.running && by.b.x2 > by.b.x1, 'a running nap reaches the now-line');
  assert.equal(by.c.shape, 'bottle');
  assert.equal(by.d.shape, 'breast');
  assert.equal(by.e.shape, 'dirty');
  assert.equal(by.f.shape, 'both');
  assert.equal(by.g.shape, 'pump');
  assert.equal(by.g.lane, 3);
  assert.ok(Math.abs(nowX - (30 + 288 * (9 + 50 / 60) / 24)) < 0.01);
  // Another day: no now-line.
  assert.equal(tl.stripMarks([], { dayStart: addDays(at(0), -1), dayEnd: at(0), now: at(9, 50), lanes }).nowX, null);
});

test('timeline: tapping near a mark finds it, on its own lane only', () => {
  const marks = [{ id: 'x', lane: 1, x1: 100, x2: 100 }, { id: 'y', lane: 1, x1: 140, x2: 160 }, { id: 'z', lane: 2, x1: 100, x2: 100 }];
  assert.equal(tl.hitMark(marks, 104, 1).id, 'x');
  assert.equal(tl.hitMark(marks, 150, 1).id, 'y');
  assert.equal(tl.hitMark(marks, 100, 2).id, 'z');
  assert.equal(tl.hitMark(marks, 300, 1), null);
});

test('timeline: 12h and 24h axis words', () => {
  assert.deepEqual(tl.hourWords(true).axis, ['12a', '6a', '12p', '6p', '12a']);
  assert.equal(tl.hourWords(true).band, '7 PM – 7 AM');
  assert.deepEqual(tl.hourWords(false).axis, ['0', '6', '12', '18', '24']);
});

test('report: sections follow the trackers; averages read without trailing .0', () => {
  assert.deepEqual(rp.sections(ALL), { feeds: true, bottle: true, breast: true, diaper: true, sleep: true, pump: true });
  const s = rp.sections({ ...ALL, bottle: false, pump: false });
  assert.equal(s.feeds, true);
  assert.equal(s.bottle, false);
  assert.equal(s.pump, false);
  assert.equal(rp.sections({ ...ALL, bottle: false, breastfeeding: false }).feeds, false);
  assert.equal(rp.num(8), '8');
  assert.equal(rp.num(6.25), '6.3');
  assert.equal(rp.num(NaN), '0');
  assert.equal(rp.eventVisible({ type: 'pump', data: {} }, { ...ALL, pump: false }), false);
});

test('entry sheet: which fields an entry gets', () => {
  assert.equal(ev.kindOf({ type: 'feed', data: { method: 'breast' } }), 'breast');
  assert.equal(ev.kindOf({ type: 'feed', data: { method: 'bottle' } }), 'bottle');
  assert.equal(ev.kindOf({ type: 'sleep', data: {} }), 'sleep');
  assert.equal(ev.hasDuration({ type: 'sleep', startTime: 1, endTime: 1, data: {} }), true);
  assert.equal(ev.hasDuration({ type: 'diaper', startTime: 1, endTime: 1, data: {} }), false);
  // A quick-logged bottle is an instant; a timed one lasts.
  assert.equal(ev.hasDuration({ type: 'feed', startTime: at(7), endTime: at(7), data: { method: 'bottle' } }), false);
  assert.equal(ev.hasDuration({ type: 'feed', startTime: at(7), endTime: at(7, 18), data: { method: 'bottle' } }), true);
});

test('entry sheet: date + time inputs round-trip in local time', () => {
  const t = at(7, 40);
  assert.equal(ev.dateValue(t), '2026-10-14');
  assert.equal(ev.timeValue(t), '07:40');
  assert.equal(ev.fromInputs('2026-10-14', '07:40'), t);
  assert.ok(Number.isNaN(ev.fromInputs('2026-02-30', '07:40')), 'impossible dates are rejected');
  assert.ok(Number.isNaN(ev.fromInputs('', '07:40')));
  assert.equal(ev.parseAmount('4,5'), 4.5);
  assert.equal(ev.parseAmount(''), null);
  assert.equal(ev.parseAmount('abc'), undefined);
});

test('entry sheet: edits validate calmly (no end before start, nothing in the future)', () => {
  const now = at(9, 50);
  const ok = { start: at(7, 40), end: at(7, 58), running: false, now };
  assert.equal(ev.editProblem(ok), '');
  assert.match(ev.editProblem({ ...ok, end: at(7) }), /end can’t be before the start/);
  assert.match(ev.editProblem({ ...ok, start: now + 5 * 60000, end: now + 6 * 60000 }), /still to come/);
  assert.equal(ev.editProblem({ ...ok, start: now + 30000, end: now + 30000 }), '', 'within a minute of now is fine');
  assert.match(ev.editProblem({ ...ok, end: now + 2 * 60000 }), /end is still to come/);
  assert.equal(ev.editProblem({ start: at(8, 55), end: null, running: true, now }), '', 'a running entry has no end to check');
  assert.match(ev.editProblem({ ...ok, start: NaN }), /Pick a day and a time/);
  assert.match(ev.editProblem({ ...ok, amount: undefined, amountMax: 64 }), /as a number/);
  assert.match(ev.editProblem({ ...ok, amount: 99, amountMax: 64 }), /up to 64/);
  assert.equal(ev.editProblem({ ...ok, amount: null, amountMax: 64 }), '', 'an amount can stay unrecorded');
  assert.match(ev.editProblem({ ...ok, left: -1, right: 3 }), /Minutes per side/);
  assert.match(ev.editProblem({ ...ok, needsTitle: true, title: '  ' }), /name/);
  // Copy never uses a pronoun for the baby.
  for (const msg of [ev.editProblem({ ...ok, end: at(7) }), ev.editProblem({ ...ok, start: now + 5 * 60000 })]) assert.doesNotMatch(msg, /\b(she|he|her|his)\b/i);
});
