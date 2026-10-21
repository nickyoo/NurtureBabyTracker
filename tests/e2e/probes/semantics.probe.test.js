import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEventPatch, sanitizeEvent } from '../../../js/core/store.js';
import { applyInventoryPatch, effectiveStatus, DEFAULT_STORAGE_WINDOWS } from '../../../js/domain/inventory.js';
import { rangeTotals } from '../../../js/domain/trends.js';
import { sanitizeSetting } from '../../../js/core/settings.js';
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 16, 12);

test('finishing a breastfeed via update() banks the active side', () => {
  const running = sanitizeEvent({ id: 'evt_1', type: 'feed', startTime: T0, endTime: null, babyId: 'baby_a',
    data: { method: 'breast', activeSide: 'left', activeSince: T0 } }, { now: T0 }).value;
  const finished = applyEventPatch(running, { endTime: T0 + 15 * MIN }, T0 + 20 * MIN);
  assert.equal(finished.data.activeSide, null, 'a finished feed must not have a live side');
  const t = rangeTotals([finished], T0 - HOUR, T0 + HOUR, { now: T0 + DAY });
  assert.equal(t.feed.breastSec, 15 * 60);
});

test('fixing an expired pouch to a valid expiry makes it usable again', () => {
  const swept = { id: 'inv_1', pumpedAt: T0 - 5 * HOUR, quantity: 4, unit: 'oz', location: 'room',
    expiresAt: T0 - HOUR, status: 'expired', notes: '', createdAt: T0 - 5 * HOUR };
  const fixed = applyInventoryPatch(swept, { location: 'freezer' }, DEFAULT_STORAGE_WINDOWS, T0);
  assert.ok(fixed.expiresAt > T0);
  assert.equal(effectiveStatus(fixed, T0), 'active');
});

test('strict storageWindows rejects out-of-range values instead of silently defaulting', () => {
  const r = sanitizeSetting('storageWindows', { ...DEFAULT_STORAGE_WINDOWS, fridgeDays: 30 });
  assert.equal(r.ok, false, `stored ${JSON.stringify(r.value)}`);
});
