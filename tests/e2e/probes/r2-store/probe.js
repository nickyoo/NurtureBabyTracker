import { events } from '../../../../js/core/store.js';
import { stash } from '../../../../js/core/stash.js';
import { settings } from '../../../../js/core/settings.js';
import { exportBackup, importBackup } from '../../../../js/core/backup.js';
import { breastSideTotals } from '../../../../js/domain/safety.js';
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const R = [];
const which = new URLSearchParams(location.search).get('t');
async function t(name, fn) {
  if (which && !name.startsWith(which)) return;
  try { R.push({ name, ok: true, v: await fn() }); }
  catch (e) { R.push({ name, ok: false, err: `${e && e.name}: ${e && e.message}` }); }
}
await settings.load();

await t('A1 future-dated pouch: add ok, remove -> Undo restore', async () => {
  const p = await stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: Date.now() + 3 * DAY });
  const removed = await stash.remove(p.id);
  let undo;
  try { await stash.restore(removed); undo = 'restored'; } catch (e) { undo = `${e.name}: ${e.message}`; }
  return { added: !!p.id, undo, stillExists: !!(await stash.get(p.id)) };
});

await t('A2 future-dated pouch: markUsed -> Undo restore(before)', async () => {
  const p = await stash.add({ quantity: 5, unit: 'oz', location: 'freezer', pumpedAt: Date.now() + 3 * DAY });
  const before = await stash.get(p.id);
  await stash.markUsed(p.id);
  let undo;
  try { await stash.restore(before); undo = 'restored'; } catch (e) { undo = `${e.name}: ${e.message}`; }
  return { undo, statusNow: (await stash.get(p.id)).status };
});

await t('A3 future-dated pouch: backup export -> replace import', async () => {
  const p = await stash.add({ quantity: 6, unit: 'oz', location: 'freezer', pumpedAt: Date.now() + 3 * DAY });
  const data = await exportBackup();
  const inFile = data.inventory.some(x => x.id === p.id);
  const res = await importBackup(JSON.stringify(data), { mode: 'replace', safetyBackup: () => {} });
  return { inFile, afterImport: !!(await stash.get(p.id)), warnings: res.warnings };
});

await t('A3b one normal + one future-dated pouch: export -> replace import', async () => {
  const ok = await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: Date.now() - HOUR });
  const fut = await stash.add({ quantity: 6, unit: 'oz', location: 'freezer', pumpedAt: Date.now() + 3 * DAY });
  const data = await exportBackup();
  const res = await importBackup(JSON.stringify(data), { mode: 'replace', safetyBackup: () => {} });
  return { normalSurvives: !!(await stash.get(ok.id)), futureSurvives: !!(await stash.get(fut.id)), warnings: res.warnings };
});

await t('A4 pre-2000 pumpedAt (0) accepted by add, lost on Undo', async () => {
  const p = await stash.add({ quantity: 3, unit: 'oz', location: 'fridge', pumpedAt: 0 });
  const removed = await stash.remove(p.id);
  try { await stash.restore(removed); return { pumpedAt: p.pumpedAt, undo: 'restored' }; } catch (e) { return { pumpedAt: p.pumpedAt, undo: `${e.name}: ${e.message}` }; }
});

await t('B1 stash.add with a Date pumpedAt silently becomes now', async () => {
  const when = new Date(Date.now() - 2 * DAY);
  const p = await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: when });
  let evErr = null;
  try { await events.add({ type: 'pump', startTime: when, data: { amount: 4, unit: 'oz' } }); } catch (e) { evErr = `${e.name}: ${e.message}`; }
  let updErr = null;
  try { await stash.update(p.id, { pumpedAt: when }); } catch (e) { updErr = `${e.name}: ${e.message}`; }
  return { requested: when.getTime(), storedPumpedAt: p.pumpedAt, offByHours: Math.round((p.pumpedAt - when.getTime()) / HOUR), eventsAddWithDate: evErr, stashUpdateWithDate: updErr };
});

await t('B2 stash.add with an ISO/datetime-local string pumpedAt silently becomes now', async () => {
  const s = '2026-10-14T08:00';
  const p = await stash.add({ quantity: 4, unit: 'oz', location: 'fridge', pumpedAt: s });
  return { requested: s, storedPumpedAtISO: new Date(p.pumpedAt).toISOString() };
});

await t('C1 breastfeed started per spec data shape (activeSide, no activeSince)', async () => {
  const start = Date.now() - 10 * MIN;
  const ev = await events.start('feed', { method: 'breast', left: 0, right: 0, lastSide: 'left', activeSide: 'left' }, { startTime: start });
  const live = breastSideTotals(ev.data, Date.now());
  const done = await events.stop(ev.id);
  return { storedData: ev.data, liveTotalSecAfter10Min: live.total, stoppedData: done.data, expectedLeftSecAtLeast: 600 };
});

await t('C2 switch side by patching activeSide (spec shape) misattributes time', async () => {
  const start = Date.now() - 10 * MIN;
  const ev = await events.start('feed', { method: 'breast', activeSide: 'left', activeSince: start }, { startTime: start, babyId: (await settings.load(), settings.get('babies')[0].id) }).catch(async e => { if (e.running) { await events.stop(e.running.id); return events.start('feed', { method: 'breast', activeSide: 'left', activeSince: start }, { startTime: start }); } throw e; });
  const upd = await events.update(ev.id, { data: { activeSide: 'right' } });
  const done = await events.stop(ev.id);
  return { afterPatch: upd.data, stopped: { left: done.data.left, right: done.data.right }, expected: 'left ~600s, right ~0s' };
});

await t('D1 query from>to', async () => (await events.query({ from: Date.now(), to: Date.now() - HOUR })).length);
await t('D2 query from===to', async () => { const n = Date.now(); return (await events.query({ type: 'feed', from: n, to: n })).length; });

await t('E1 edit null-baby event passing babyId: null (unchanged)', async () => {
  const e = await events.add({ type: 'diaper', data: { kind: 'wet' } });
  // simulate an imported null-baby event via restore (lenient, keeps null)
  const removed = await events.remove(e.id);
  await events.restore({ ...removed, babyId: null });
  const nb = await events.get(e.id);
  let viaOmit, viaNull;
  try { await events.update(e.id, { note: 'a' }); viaOmit = 'ok'; } catch (x) { viaOmit = `${x.name}: ${x.message}`; }
  try { await events.update(e.id, { note: 'b', babyId: nb.babyId }); viaNull = 'ok'; } catch (x) { viaNull = `${x.name}: ${x.message}`; }
  return { storedBabyId: nb.babyId, editOmittingBabyId: viaOmit, editPassingSameNullBabyId: viaNull };
});

window.__R = R; window.__done = true;
