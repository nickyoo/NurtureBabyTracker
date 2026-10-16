import { photos } from '../../../js/core/photos.js';
import { events, subscribe } from '../../../js/core/store.js';
import { stash } from '../../../js/core/stash.js';
import { settings } from '../../../js/core/settings.js';
const R = [];
async function t(name, fn) {
  try { const v = await fn(); R.push({ name, ok: true, v }); }
  catch (e) { R.push({ name, ok: false, err: `${e && e.name}: ${e && e.message}` }); }
}
await settings.load();
await t('wide png', async () => {
  const b = await (await fetch('./wide.png')).blob();
  const r = await photos.add(b); return r;
});
await t('huge png 30000x30000', async () => {
  const b = await (await fetch('./huge.png')).blob();
  const t0 = performance.now();
  const r = await photos.add(b); return { ...r, ms: Math.round(performance.now() - t0) };
});
await t('event remove/restore round trip', async () => {
  const e = await events.add({ type: 'feed', data: { method: 'bottle', amount: 3.5, unit: 'oz', milk: 'formula', prepared: 4 }, note: '  hi\n', startTime: Date.now() - 60000, endTime: Date.now() });
  const removed = await events.remove(e.id);
  await events.restore(removed);
  const back = await events.get(e.id);
  return { same: JSON.stringify(back) === JSON.stringify(e), e, back };
});
await t('stash remove/restore round trip', async () => {
  const p = await stash.add({ quantity: 4, unit: 'oz', location: 'freezer', notes: 'x' });
  const th = await stash.thaw(p.id);
  const removed = await stash.remove(p.id);
  await stash.restore(removed);
  const back = await stash.get(p.id);
  return { same: JSON.stringify(back) === JSON.stringify(th), th, back };
});
await t('settings.set storageWindows out of range', async () => {
  await settings.patch('storageWindows', { fridgeDays: 2 });
  const r = await settings.patch('storageWindows', { thawedBottleHours: 0, fridgeDays: 30 });
  return { stored: r, threw: false };
});
await t('double subscribe then one unsubscribe', async () => {
  let n = 0; const fn = () => { n++; };
  const u1 = subscribe(fn); const u2 = subscribe(fn); u1();
  await events.add({ type: 'diaper', data: { kind: 'wet' } });
  u2();
  return { callsAfterOnlyFirstUnsubscribed: n };
});
window.__R = R; window.__done = true;
