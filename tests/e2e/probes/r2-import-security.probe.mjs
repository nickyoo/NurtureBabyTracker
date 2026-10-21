// Round-2 adversarial probes (import/export security). Not part of `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, buildCsv } from '../../../js/core/backup.js';

const NOW = Date.UTC(2026, 9, 16, 12);
const HOUR = 3600e3;

test('ReDoS: a 40 KB numeric-looking string in `schema` must not stall validateBackup', () => {
  const evil = '1'.repeat(40000) + 'x';
  const t = performance.now();
  const v = validateBackup({ app: 'nurture', schema: evil, events: [] }, { now: NOW });
  const ms = performance.now() - t;
  console.log(`validateBackup with 40k-char schema took ${ms.toFixed(0)} ms; ok=${v.ok}`);
  assert.ok(ms < 500, `validateBackup blocked the thread for ${ms.toFixed(0)} ms`);
});

test('ReDoS: 5 events with 20 KB startTime strings must not stall validateBackup', () => {
  const evil = '1'.repeat(20000) + 'x';
  const events = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, type: 'diaper', startTime: evil, data: { kind: 'wet' } }));
  const t = performance.now();
  validateBackup({ app: 'nurture', schema: 2, events }, { now: NOW });
  const ms = performance.now() - t;
  console.log(`validateBackup with 5 x 20k-char startTime took ${ms.toFixed(0)} ms`);
  assert.ok(ms < 500, `validateBackup blocked the thread for ${ms.toFixed(0)} ms`);
});

test('thawed pouch pumped 5 years ago imports as active milk (thawedAt not bounded by pumpedAt)', () => {
  const v = validateBackup({
    app: 'nurture', schema: 2,
    inventory: [{
      id: 'inv_old', pumpedAt: Date.UTC(2021, 0, 1), quantity: 4, unit: 'oz', location: 'thawed',
      thawedAt: NOW - HOUR, expiresAt: NOW + 48 * HOUR, status: 'active',
    }],
  }, { now: NOW });
  const p = v.data.inventory[0];
  console.log('imported pouch:', JSON.stringify({ status: p.status, location: p.location, pumpedAt: new Date(p.pumpedAt).toISOString(), expiresAt: new Date(p.expiresAt).toISOString() }));
  assert.ok(p.expiresAt <= NOW, `5-year-old milk accepted as good until ${new Date(p.expiresAt).toISOString()}`);
});

test('deeply nested array as an event `type` must not make validateBackup throw', () => {
  let t = []; for (let i = 0; i < 200000; i++) t = [t];
  let threw = null;
  try { validateBackup({ app: 'nurture', schema: 2, events: [{ id: 'x', type: t }] }, { now: NOW }); } catch (e) { threw = e; }
  console.log('threw:', threw && `${threw.name}: ${threw.message}`);
  assert.equal(threw, null);
});

test('CSV: formula prefixes are neutralised', () => {
  const csv = buildCsv([{ id: 'a', type: 'diaper', startTime: NOW, endTime: NOW, note: '=HYPERLINK("http://x")', data: { kind: 'wet' } }], { now: NOW });
  console.log(csv.split('\r\n')[1]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
});
