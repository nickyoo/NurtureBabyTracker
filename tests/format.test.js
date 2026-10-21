// ui/format.js: display wording (DESIGN §10). Dates are built with the local
// calendar so the tests pass in any time zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amount, amountSplit, spanParts, span, since, spanSpoken, clock, clockParts, durationLabel,
  dateLabel, dayLabel, eyebrowDate, babyAge, babyName, possessive, plural, categoryOf, categoryClass,
  eventTitle, eventSubtitle, eventAmount, eventLabel,
} from '../js/ui/format.js';

const MIN = 60 * 1000;
const H = 60 * MIN;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 14, 9, 50); // Wed, Oct 14 2026, 9:50 AM

test('amount: units, rounding, conversion, missing', () => {
  assert.equal(amount(4, 'oz'), '4 oz');
  assert.equal(amount(3.5, 'oz'), '3.5 oz');
  assert.equal(amount(4.0, 'oz'), '4 oz');
  assert.equal(amount(120, 'mL'), '120 mL');
  assert.equal(amount(4, 'oz', 'mL'), '118 mL');
  assert.equal(amount(null, 'oz'), '—');
  assert.equal(amount(NaN, 'oz'), '—');
  assert.deepEqual(amountSplit(12.5, 'oz'), { value: '12.5', unit: 'oz', missing: false });
});

test('spanParts / span: since-last numerals', () => {
  assert.deepEqual(spanParts(30 * 1000), []);
  assert.equal(span(30 * 1000), 'Just now');
  assert.deepEqual(spanParts(55 * MIN), [{ v: '55', u: 'm' }]);
  assert.deepEqual(spanParts(2 * H + 10 * MIN), [{ v: '2', u: 'h' }, { v: '10', u: 'm' }]);
  assert.equal(span(3 * H), '3h 00m', 'minutes are two digits past an hour');
  assert.equal(span(3 * H + 5 * MIN), '3h 05m');
  assert.equal(span(59 * MIN + 59 * 1000), '59m', 'truncates, never rounds up');
  assert.equal(span(26 * H), '1d 2h');
  assert.equal(span(NaN), 'Just now');
  assert.equal(span(-5 * MIN), 'Just now');
});

test('since: relative wording, future clamps to Just now', () => {
  assert.equal(since(NOW - (2 * H + 10 * MIN), NOW), '2h 10m ago');
  assert.equal(since(NOW - 55 * MIN, NOW), '55m ago');
  assert.equal(since(NOW - 20 * 1000, NOW), 'Just now');
  assert.equal(since(NOW + 5 * MIN, NOW), 'Just now');
  assert.equal(since('nope', NOW), '');
});

test('spanSpoken for aria labels', () => {
  assert.equal(spanSpoken(2 * H + 10 * MIN), '2 hours 10 minutes');
  assert.equal(spanSpoken(3 * H), '3 hours');
  assert.equal(spanSpoken(1 * MIN), '1 minute');
  assert.equal(spanSpoken(10), 'less than a minute');
});

test('clock / clockParts honour 12h vs 24h', () => {
  const t = at(2026, 10, 14, 7, 40);
  assert.equal(clock(t, { hour12: true }), '7:40 AM');
  assert.equal(clock(at(2026, 10, 14, 0, 5), { hour12: true }), '12:05 AM');
  assert.equal(clock(at(2026, 10, 14, 15, 4), { hour12: false }), '15:04');
  assert.deepEqual(clockParts(at(2026, 10, 14, 20, 20), { hour12: true }), { time: '8:20', meridiem: 'PM' });
  assert.deepEqual(clockParts(at(2026, 10, 14, 20, 20), { hour12: false }), { time: '20:20', meridiem: '' });
});

test('durationLabel', () => {
  assert.equal(durationLabel(18 * MIN), '18 min');
  assert.equal(durationLabel(65 * MIN), '1h 05m');
  assert.equal(durationLabel(30 * 1000), '30 sec');
  assert.equal(durationLabel(0), '0 min');
});

test('dates: dayLabel / dateLabel / eyebrowDate', () => {
  assert.equal(dayLabel(at(2026, 10, 14, 1), NOW), 'Today');
  assert.equal(dayLabel(at(2026, 10, 13, 23), NOW), 'Yesterday');
  assert.equal(dateLabel(at(2026, 10, 14), NOW, 'en-US'), 'Wed, Oct 14');
  assert.match(dateLabel(at(2025, 3, 2), NOW, 'en-US'), /2025/);
  assert.equal(eyebrowDate(NOW, 'en-US'), 'Wednesday · October 14');
});

test('babyAge: days, weeks, weeks+days, months, years', () => {
  const born = '2026-09-02';
  assert.equal(babyAge(born, NOW), '6 weeks', 'Sep 2 → Oct 14 is exactly 6 weeks (DESIGN sample)');
  assert.equal(babyAge(born, at(2026, 10, 9)), '5 weeks, 2 days');
  assert.equal(babyAge(born, at(2026, 9, 28)), '3 weeks, 5 days');
  assert.equal(babyAge(born, at(2026, 9, 6)), '4 days');
  assert.equal(babyAge(born, at(2026, 9, 3)), '1 day');
  assert.equal(babyAge(born, at(2026, 9, 2, 18)), 'Born today');
  assert.equal(babyAge(born, at(2026, 9, 9)), '1 week');
  assert.equal(babyAge(born, at(2026, 12, 2)), '3 months', '13 weeks switches to months');
  assert.equal(babyAge(born, at(2027, 5, 1)), '7 months');
  assert.equal(babyAge(born, at(2028, 9, 2)), '2 years');
  assert.equal(babyAge(born, at(2028, 12, 3)), '2 years, 3 months');
  assert.equal(babyAge(born, at(2026, 8, 1)), '', 'future birth date → nothing');
  assert.equal(babyAge(null, NOW), '');
  assert.equal(babyAge('2026-02-31', NOW), '', 'invalid date');
  assert.equal(babyAge(at(2026, 9, 2), NOW), '6 weeks', 'timestamps work too');
});

test('names: fallback, possessive, plural', () => {
  assert.equal(babyName({ name: ' Clara ' }), 'Clara');
  assert.equal(babyName({ name: '' }), 'Baby');
  assert.equal(babyName(null, 'your baby'), 'your baby');
  assert.equal(possessive('Clara'), 'Clara’s');
  assert.equal(possessive(''), '');
  assert.equal(plural(1, 'feed'), '1 feed');
  assert.equal(plural(3, 'feed'), '3 feeds');
  assert.equal(plural(2, 'pouch', 'pouches'), '2 pouches');
});

test('categories', () => {
  assert.equal(categoryOf('milestone'), 'mem');
  assert.equal(categoryOf({ type: 'feed' }), 'feed');
  assert.equal(categoryClass('pump'), 'cat-pump');
  assert.equal(categoryClass('stash'), 'cat-pump');
  assert.equal(categoryClass('bogus'), 'cat-neutral');
});

const ev = (type, data, startTime, endTime = startTime, extra = {}) => ({ id: 'evt_1', type, data, startTime, endTime, note: '', ...extra });

test('eventTitle for every type', () => {
  assert.equal(eventTitle(ev('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, NOW)), 'Bottle · formula');
  assert.equal(eventTitle(ev('feed', { method: 'bottle', milk: 'breastmilk', amount: 4, unit: 'oz' }, NOW)), 'Bottle · breast milk');
  assert.equal(eventTitle(ev('feed', { method: 'breast', left: 0, right: 0 }, NOW)), 'Breastfeed');
  assert.equal(eventTitle(ev('pump', { amount: 3.5, unit: 'oz' }, NOW)), 'Pumped');
  assert.equal(eventTitle(ev('pump', {}, NOW, null)), 'Pumping');
  assert.equal(eventTitle(ev('sleep', { kind: 'nap' }, NOW)), 'Nap');
  assert.equal(eventTitle(ev('sleep', { kind: 'night' }, NOW)), 'Night sleep');
  assert.equal(eventTitle(ev('diaper', { kind: 'wet' }, NOW)), 'Diaper');
  assert.equal(eventTitle(ev('milestone', { title: 'First real smile', photoIds: [] }, NOW)), 'First real smile');
  assert.equal(eventTitle(ev('milestone', { title: '' }, NOW)), 'Memory');
  assert.equal(eventTitle(null), '');
});

test('eventSubtitle for every type, finished and running', () => {
  const t = at(2026, 10, 14, 7, 40);
  assert.equal(eventSubtitle(ev('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, t, t + 18 * MIN), { now: NOW }), 'Finished in 18 min');
  assert.equal(eventSubtitle(ev('feed', { method: 'bottle', milk: 'formula', amount: null, unit: 'oz' }, t, t), { now: NOW }), 'Amount not recorded · tap to add');
  assert.equal(eventSubtitle(ev('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, NOW - 12 * MIN, null), { now: NOW }), 'Started 12m ago');
  assert.equal(eventSubtitle(ev('feed', { method: 'breast', left: 480, right: 360 }, t, t + 14 * MIN), { now: NOW }), 'L 8 min · R 6 min');
  assert.equal(eventSubtitle(ev('feed', { method: 'breast', left: 300, right: 0, activeSide: 'left', activeSince: NOW - 9 * MIN }, NOW - 14 * MIN, null), { now: NOW }), 'Left side · 14m so far');
  assert.equal(eventSubtitle(ev('feed', { method: 'breast', left: 300, right: 120, activeSide: null }, NOW - 14 * MIN, null), { now: NOW }), 'Paused · 7m so far');
  assert.equal(eventSubtitle(ev('pump', { amount: 3.5, unit: 'oz', storedTo: 'fridge' }, t, t + 16 * MIN), { now: NOW }), '16 min · to fridge');
  assert.equal(eventSubtitle(ev('pump', { amount: null, unit: 'oz', storedTo: null }, t, t), { now: NOW }), 'amount not recorded');
  assert.equal(eventSubtitle(ev('pump', {}, NOW - 14 * MIN, null), { now: NOW }), '14m so far');
  assert.equal(eventSubtitle(ev('sleep', { kind: 'nap' }, NOW - 55 * MIN, null), { now: NOW }), 'Asleep · 55m so far');
  assert.equal(eventSubtitle(ev('sleep', { kind: 'night' }, t - 80 * MIN, t), { now: NOW }), 'Slept 1h 20m');
  assert.equal(eventSubtitle(ev('diaper', { kind: 'both' }, t), { now: NOW }), 'Wet + dirty');
  assert.equal(eventSubtitle(ev('diaper', { kind: 'dirty', color: 'yellow' }, t), { now: NOW }), 'Dirty · yellow');
  assert.equal(eventSubtitle(ev('milestone', { title: 'x' }, t, t, { note: 'Line one\nline two' }), { now: NOW }), 'Line one');
});

test('eventAmount converts to the display unit and skips amount-less types', () => {
  assert.deepEqual(eventAmount(ev('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, NOW)), { value: '4', unit: 'oz', missing: false });
  assert.deepEqual(eventAmount(ev('pump', { amount: 120, unit: 'mL' }, NOW), 'oz'), { value: '4.1', unit: 'oz', missing: false });
  assert.deepEqual(eventAmount(ev('pump', { amount: null, unit: 'oz' }, NOW)), { value: '—', unit: 'oz', missing: true });
  assert.equal(eventAmount(ev('feed', { method: 'breast' }, NOW)), null);
  assert.equal(eventAmount(ev('diaper', { kind: 'wet' }, NOW)), null);
});

test('eventLabel is one sentence', () => {
  const t = at(2026, 10, 14, 7, 40);
  assert.equal(
    eventLabel(ev('feed', { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, t, t + 18 * MIN), { now: NOW, hour12: true }),
    'Bottle · formula, 4 oz, 7:40 AM. Finished in 18 min.',
  );
  assert.equal(eventLabel(ev('sleep', { kind: 'nap' }, at(2026, 10, 14, 8, 55), null), { now: NOW, hour12: true }), 'Nap, since 8:55 AM. Asleep · 55m so far.');
});

test('eventVisible: hidden trackers disappear everywhere; bottle and breastfeed have their own toggles', async () => {
  const { eventVisible } = await import('../js/ui/format.js');
  const all = { bottle: true, breastfeeding: true, pump: true, sleep: true, diaper: true, memories: true };
  const bottle = { type: 'feed', data: { method: 'bottle' } };
  const breast = { type: 'feed', data: { method: 'breast' } };
  for (const e of [bottle, breast, { type: 'pump' }, { type: 'sleep' }, { type: 'diaper' }, { type: 'milestone' }]) assert.equal(eventVisible(e, all), true);
  assert.equal(eventVisible(bottle, { ...all, bottle: false }), false);
  assert.equal(eventVisible(breast, { ...all, bottle: false }), true);
  assert.equal(eventVisible(breast, { ...all, breastfeeding: false }), false);
  assert.equal(eventVisible({ type: 'milestone' }, { ...all, memories: false }), false);
  assert.equal(eventVisible({ type: 'pump' }, {}), true, 'missing keys default to on');
  assert.equal(eventVisible({ type: 'pump' }, null), true);
  assert.equal(eventVisible({ type: 'weird' }, all), false);
  assert.equal(eventVisible(null, all), false);
});

test('DI-05: saveError says "out of space" for a full phone, else the fallback', async () => {
  const F = await import('../js/ui/format.js');
  const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  assert.equal(F.isQuotaError(quota), true);
  assert.equal(F.isQuotaError({ name: 'AbortError', cause: quota }), true, 'wrapped');
  assert.equal(F.isQuotaError(new Error('x')), false);
  assert.equal(F.isQuotaError(null), false);
  assert.match(F.saveError(quota), /out of space for Nurture/);
  assert.equal(F.saveError(new Error('x')), 'That didn’t save. Try again.');
  assert.equal(F.saveError(new TypeError('x'), 'Couldn’t save that photo.'), 'Couldn’t save that photo.');
});
