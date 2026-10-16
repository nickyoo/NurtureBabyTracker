import { events } from '../../../js/core/store.js';
import { stash } from '../../../js/core/stash.js';
import { settings } from '../../../js/core/settings.js';
import { photos } from '../../../js/core/photos.js';
import { rangeTotals, dayTotals } from '../../../js/domain/trends.js';
const HOUR = 3600e3, MIN = 60e3, DAY = 24 * HOUR;
const R = [];
async function t(name, fn) {
  try { const v = await fn(); R.push({ name, ok: true, v }); }
  catch (e) { R.push({ name, ok: false, err: `${e && e.name}: ${e && e.message}` }); }
}
await settings.load();

await t('P1 breastfeed finished via events.update keeps a live side', async () => {
  const start = Date.now() - 20 * MIN;
  const ev = await events.start('feed', { method: 'breast', activeSide: 'left', activeSince: start }, { startTime: start });
  const done = await events.update(ev.id, { endTime: start + 15 * MIN });
  const stored = await events.get(ev.id);
  const tomorrow = Date.now() + DAY;
  const totals = rangeTotals([stored], start - HOUR, start + HOUR, { now: tomorrow });
  return { endTime: stored.endTime !== null, activeSide: stored.data.activeSide, activeSince: stored.data.activeSince,
    breastSecWhenViewedNow: rangeTotals([stored], start - HOUR, start + HOUR, { now: Date.now() }).feed.breastSec,
    breastSecWhenViewedTomorrow: totals.feed.breastSec, expectedAboutSec: 15 * 60 };
});

await t('P2 pouch edited to a later expiry stays expired forever', async () => {
  const p = await stash.add({ quantity: 4, unit: 'oz', location: 'room', pumpedAt: Date.now() - 5 * HOUR });
  const before = (await stash.list()).map(x => x.id).includes(p.id); // list() sweeps -> 'expired'
  const fixed = await stash.update(p.id, { location: 'freezer' });
  const after = await stash.list();
  const frozen = await stash.frozen();
  return { inListBeforeFix: before, statusAfterFix: fixed.status, expiresAtInFuture: fixed.expiresAt > Date.now(),
    inUsableListAfterFix: after.some(x => x.id === p.id), inFrozenAfterFix: frozen.some(x => x.id === p.id) };
});

await t('P3 query({from:t,to:t}) (empty window)', async () => {
  const t0 = Date.now();
  return (await events.query({ from: t0, to: t0 })).length;
});
await t('P3b query({type, from:t,to:t})', async () => {
  const t0 = Date.now();
  return (await events.query({ type: 'feed', from: t0, to: t0 })).length;
});
await t('P3c query({from > to})', async () => {
  const t0 = Date.now();
  return (await events.query({ from: t0, to: t0 - 1 })).length;
});

await t('P4 start twice concurrently', async () => {
  const r = await Promise.allSettled([events.start('sleep'), events.start('sleep')]);
  return r.map(x => x.status + (x.reason ? ':' + x.reason.name : ''));
});

await t('P5 HEIC garbage photo', async () => {
  try { await photos.add(new File([new Uint8Array(1000).fill(7)], 'a.heic', { type: 'image/heic' })); return 'stored?!'; }
  catch (e) { return e.name; }
});

window.__R = R; window.__done = true;
document.getElementById('out').textContent = JSON.stringify(R, null, 2);
