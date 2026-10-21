import { events } from '../../../../js/core/store.js';
import { stash } from '../../../../js/core/stash.js';
import { settings } from '../../../../js/core/settings.js';
import { photos, PhotoDecodeError } from '../../../../js/core/photos.js';
import { rangeTotals } from '../../../../js/domain/trends.js';
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const R = [];
const which = new URLSearchParams(location.search).get('t');
async function t(name, fn) {
  if (which && !name.startsWith(which)) return;
  try { R.push({ name, ok: true, v: await fn() }); }
  catch (e) { R.push({ name, ok: false, err: `${e && e.name}: ${e && e.message}` }); }
}
await settings.load();

await t('A finish running breastfeed via update({endTime})', async () => {
  const start = Date.now() - 20 * MIN;
  const ev = await events.start('feed', { method: 'breast', activeSide: 'left', activeSince: start }, { startTime: start });
  await events.update(ev.id, { endTime: start + 15 * MIN });
  const s = await events.get(ev.id);
  return {
    stored: s.data,
    breastSec_now: rangeTotals([s], start - HOUR, start + HOUR, { now: Date.now() }).feed.breastSec,
    breastSec_in_1_day: rangeTotals([s], start - HOUR, start + HOUR, { now: Date.now() + DAY }).feed.breastSec,
    expected: 15 * 60,
  };
});

await t('B list({now: future}) persists expiry permanently', async () => {
  const p = await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: Date.now() });
  await stash.list({ now: Date.now() + 10 * DAY });
  const stored = await stash.get(p.id);
  const usableNow = (await stash.list()).some(x => x.id === p.id);
  return { expiresAtInFuture: stored.expiresAt > Date.now(), storedStatus: stored.status, usableNow };
});

await t('C expired pouch corrected via update stays expired', async () => {
  const p = await stash.add({ quantity: 4, unit: 'oz', location: 'room', pumpedAt: Date.now() - 5 * HOUR });
  await stash.list(); // sweeps -> expired
  const fixed = await stash.update(p.id, { location: 'freezer' });
  return { status: fixed.status, expiresAtInFuture: fixed.expiresAt > Date.now(),
    inFrozen: (await stash.frozen()).some(x => x.id === p.id), canThaw: (await stash.thaw(p.id)) !== null };
});

await t('D query empty window from===to', async () => {
  const t0 = Date.now();
  return (await events.query({ from: t0, to: t0 })).length;
});
await t('D2 query type + from===to', async () => {
  const t0 = Date.now();
  return (await events.query({ type: 'feed', from: t0, to: t0 })).length;
});

await t('E concurrent start x2', async () => {
  const r = await Promise.allSettled([events.start('sleep'), events.start('sleep')]);
  return r.map(x => x.status + (x.reason ? ':' + x.reason.name : ''));
});

await t('F concurrent settings.patch lost update', async () => {
  await Promise.all([settings.patch('trackers', { pump: false }), settings.patch('trackers', { sleep: false })]);
  const mem = settings.get('trackers');
  await settings.reload();
  const disk = settings.get('trackers');
  return { mem: { pump: mem.pump, sleep: mem.sleep }, disk: { pump: disk.pump, sleep: disk.sleep } };
});

await t('G event remove/restore exact', async () => {
  const e = await events.add({ type: 'feed', startTime: Date.now() - MIN, endTime: Date.now(), note: 'x\ny', data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'mL', prepared: 4 } });
  const r = await events.remove(e.id);
  await events.restore(r);
  const b = await events.get(e.id);
  return JSON.stringify(Object.entries(b).sort()) === JSON.stringify(Object.entries(e).sort());
});

await t('H HEIC/garbage blob', async () => {
  const blob = new Blob([new Uint8Array(5000).map((_, i) => i % 251)], { type: 'image/heic' });
  try { await photos.add(blob); return 'no error'; } catch (e) { return `${e.name} isPhotoDecodeError=${e instanceof PhotoDecodeError}`; }
});

await t('I photos.get racing remove', async () => {
  const c = new OffscreenCanvas(10, 10); c.getContext('2d').fillRect(0, 0, 10, 10);
  const { id } = await photos.add(await c.convertToBlob({ type: 'image/png' }));
  const [url, existed] = await Promise.all([photos.get(id), photos.remove(id)]);
  const again = await photos.get(id);
  return { url: !!url, existed, getAfterDeleteReturns: again };
});

await t('J huge 30000x30000 png', async () => {
  const b = await (await fetch('../huge.png')).blob();
  const t0 = performance.now();
  try { const r = await photos.add(b); return { ...r, ms: Math.round(performance.now() - t0) }; }
  catch (e) { return `${e.name}: ${e.message} isPhotoDecodeError=${e instanceof PhotoDecodeError}`; }
});

await t('K past breastfeed logged via add() with a live side', async () => {
  const start = Date.now() - 2 * HOUR;
  const ev = await events.add({ type: 'feed', startTime: start, endTime: start + 10 * MIN, data: { method: 'breast', left: 600, activeSide: 'right', activeSince: start + 5 * MIN } });
  return { activeSide: ev.data.activeSide, breastSec: rangeTotals([ev], start - HOUR, start + HOUR, { now: Date.now() }).feed.breastSec, expectedAtMost: 600 + 300 };
});

window.__R = R; window.__done = true;
