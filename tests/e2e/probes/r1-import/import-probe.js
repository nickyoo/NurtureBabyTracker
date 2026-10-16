import { events } from '../../../../js/core/store.js';
import { stash } from '../../../../js/core/stash.js';
import { settings } from '../../../../js/core/settings.js';
import { photos } from '../../../../js/core/photos.js';
import { importBackup } from '../../../../js/core/backup.js';
const H = 3600e3, D = 24 * H;
const NOW = Date.now();
const which = new URLSearchParams(location.search).get('t');
const file = over => JSON.stringify({ app: 'nurture', schema: 2, ...over });
const noSafety = () => {};
async function pngBlob() {
  const c = new OffscreenCanvas(40, 30); const g = c.getContext('2d'); g.fillStyle = '#f00'; g.fillRect(0, 0, 40, 30);
  return c.convertToBlob({ type: 'image/png' });
}
const T = {
  async photosMalformed() {
    await settings.load();
    await photos.add(await pngBlob());
    await events.add({ type: 'diaper', data: { kind: 'wet' } });
    const before = (await photos.usage()).count;
    const res = await importBackup(file({ events: [], photos: 5 }), { mode: 'replace', safetyBackup: noSafety });
    return { photosBefore: before, photosAfter: (await photos.usage()).count, warnings: res.warnings };
  },
  async photosAllRejected() {
    await settings.load();
    await photos.add(await pngBlob());
    const before = (await photos.usage()).count;
    const res = await importBackup(file({ photos: [{ id: 'pho_x', data: 'not base64!!', width: 1, height: 1 }] }), { mode: 'replace', safetyBackup: noSafety });
    return { photosBefore: before, photosAfter: (await photos.usage()).count, rejected: res.stats.rejected };
  },
  async eventsMalformed() {
    await settings.load();
    for (let i = 0; i < 3; i++) await events.add({ type: 'diaper', data: { kind: 'wet' }, startTime: NOW - i * H });
    const before = (await events.query()).length;
    const res = await importBackup(file({ events: 'oops', inventory: {} }), { mode: 'replace', safetyBackup: noSafety });
    return { eventsBefore: before, eventsAfter: (await events.query()).length, warnings: res.warnings };
  },
  async spoiledMilk() {
    await settings.load();
    const res = await importBackup(file({ inventory: [{ id: 'inv_evil', pumpedAt: NOW - 30 * D, quantity: 5, unit: 'oz', location: 'fridge', expiresAt: Date.UTC(2099, 0, 1), status: 'active' }] }), { mode: 'merge' });
    const usable = await stash.list();
    const next = await stash.useNext();
    const p = usable.find(x => x.id === 'inv_evil');
    return { imported: res.stats.inventory, inUsableList: !!p, status: p && p.status, ageDays: p && Math.round((NOW - p.pumpedAt) / D), expiresYear: p && new Date(p.expiresAt).getUTCFullYear(), useNextId: next && next.id };
  },
  async futureRunning() {
    await settings.load();
    const babyId = settings.get('activeBabyId');
    const local = await events.add({ type: 'feed', data: { method: 'bottle', milk: 'formula', amount: 3, unit: 'oz' }, startTime: NOW - H });
    await importBackup(file({ events: [
      { id: 'evt_future', type: 'sleep', startTime: Date.UTC(2090, 0, 1), endTime: null, babyId, updatedAt: Date.UTC(2099, 0, 1) },
      { ...local, note: 'overwritten', updatedAt: Date.UTC(2099, 0, 1) },
    ] }), { mode: 'merge' });
    let startErr = null;
    try { await events.start('sleep', {}); } catch (e) { startErr = e.name; }
    const stopped = await events.stop('evt_future');
    const lastSleep = await events.last('sleep');
    const edited = await events.update(local.id, { note: 'my real edit' });
    return { startSleepNow: startErr, lastSleepYear: new Date(lastSleep.startTime).getUTCFullYear(), stoppedEndYear: new Date(stopped.endTime).getUTCFullYear(), localNoteAfterImport: (await events.get(local.id)).note === 'my real edit' ? 'edited' : 'x', editUpdatedAtYear: new Date(edited.updatedAt).getUTCFullYear() };
  },
  async settingsOnlyNoSafety() {
    await settings.load();
    const id = settings.get('activeBabyId');
    await settings.updateBaby(id, { name: 'Clara', birthDate: '2026-08-01' });
    await settings.set('parentName', 'Sam');
    await settings.patch('storageWindows', { fridgeDays: 3 });
    let safetyCalls = 0;
    const res = await importBackup(file({ settings: { babies: [{ id: 'baby_other', name: 'Max' }], parentName: 'Eve' } }), { mode: 'replace', safetyBackup: () => { safetyCalls += 1; } });
    return { safetyCalls, safetyBackup: res.safetyBackup, babiesAfter: settings.get('babies').map(b => b.name), parentAfter: settings.get('parentName') };
  },
  async runningDiaper() {
    await settings.load();
    const babyId = settings.get('activeBabyId');
    await importBackup(file({ events: [
      { id: 'evt_rd', type: 'diaper', startTime: NOW - H, endTime: null, babyId, data: { kind: 'wet' } },
      { id: 'evt_rm', type: 'milestone', startTime: NOW - H, endTime: null, babyId, data: { title: 'x' } },
    ] }), { mode: 'merge' });
    return { running: (await events.running()).map(e => `${e.type}:${e.endTime}`) };
  },
};
try { window.__R = { t: which, ok: true, v: await T[which]() }; }
catch (e) { window.__R = { t: which, ok: false, err: `${e.name}: ${e.message}` }; }
window.__done = true;
