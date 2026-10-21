// Browser-side tests for the QA round 1 data / backup / onboarding fixes,
// against REAL IndexedDB. Driven by tests/e2e/data.mjs: each suite runs in a
// fresh browser context. Results land on window.__results.

const params = new URLSearchParams(location.search);
const suite = params.get('suite') || 'remove-baby';
const results = [];
const out = document.getElementById('out');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function fail(msg) { throw new Error(msg); }
function ok(cond, msg) { if (!cond) fail(msg || 'assertion failed'); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${msg || 'not equal'}\n  actual:   ${a}\n  expected: ${e}`);
}
async function rejects(promise, check, msg) {
  try { await promise; } catch (err) {
    if (check && !check(err)) fail(`${msg || 'wrong error'}: ${err && err.name} ${err && err.message}`);
    return err;
  }
  fail(`${msg || 'expected rejection'}`);
  return null;
}
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: String((err && err.stack) || err) });
  }
  out.textContent = results.map(r => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n${r.error}`}`).join('\n');
}

const mods = async () => ({
  backup: await import('../../../js/core/backup.js'),
  settings: (await import('../../../js/core/settings.js')),
  events: (await import('../../../js/core/store.js')).events,
  db: await import('../../../js/core/db.js'),
  photosMod: await import('../../../js/core/photos.js'),
});
const file = over => JSON.stringify({ app: 'nurture', schema: 2, ...over });
const photoRec = (id) => ({ id, blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }), width: 10, height: 10, createdAt: Date.now(), type: 'image/jpeg', bytes: 4 });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SUITES = {};

SUITES['remove-baby'] = async () => {
  const { backup, settings, events, db } = await mods();
  await settings.load();
  const t = Date.now() - 2 * HOUR;
  const avaId = settings.get('activeBabyId');
  await settings.updateBaby(avaId, { name: 'Ava' });
  const ben = await settings.addBaby({ name: 'Ben', photoId: 'pho_benface' });
  const mk = (id, babyId, type, data) => ({ id, type, startTime: t, endTime: t, babyId, data, createdAt: t, updatedAt: t });
  await db.transaction([db.STORES.events, db.STORES.photos], 'readwrite', (s) => {
    for (const p of ['pho_ben', 'pho_shared', 'pho_benface', 'pho_ava']) s.photos.put(photoRec(p));
    s.events.put(mk('evt_ava_d', avaId, 'diaper', { kind: 'wet' }));
    s.events.put(mk('evt_ava_m', avaId, 'milestone', { title: 'Smile', photoIds: ['pho_shared', 'pho_ava'] }));
    s.events.put(mk('evt_ben_d', ben.id, 'diaper', { kind: 'dirty' }));
    s.events.put(mk('evt_ben_m', ben.id, 'milestone', { title: 'Roll', photoIds: ['pho_ben', 'pho_shared'] }));
    s.events.put({ ...mk('evt_pump', null, 'pump', { amount: 4, unit: 'oz', storedTo: null }), babyId: null });
  });
  await settings.set('memoryCovers', { [avaId]: 'evt_ava_m', [ben.id]: 'evt_ben_m' });
  await settings.set('iconDataUrl', PNG);
  await settings.set('iconBabyId', ben.id);
  await settings.setActiveBaby(ben.id);

  await test('settings.removeBaby: Ben\'s entries, photos only Ben used, cover and icon go; Ava, shared photos and the parent\'s pumps stay; Today moves to Ava', async () => {
    const seen = { settings: [], events: [], photos: 0 };
    const off1 = settings.subscribe(c => seen.settings.push(c.key));
    const off2 = events.subscribe(c => seen.events.push(c && c.op));
    const before = await backup.getSafetyCopy();
    eq(before, null);
    const res = await settings.removeBaby(ben.id);
    off1(); off2();
    eq([res.removedEvents, res.removedPhotos, res.name, res.safetyKept], [2, 2, 'Ben', true]);
    eq(settings.babies().map(b => b.name), ['Ava']);
    eq(settings.get('activeBabyId'), avaId, 'active baby moved');
    eq(settings.get('memoryCovers'), { [avaId]: 'evt_ava_m' });
    eq([settings.get('iconBabyId'), settings.get('iconDataUrl')], [null, null], 'icon made from Ben\'s photo is gone');
    const ids = (await db.getAll(db.STORES.events)).map(e => e.id).sort();
    eq(ids, ['evt_ava_d', 'evt_ava_m', 'evt_pump'], 'parent-level pump kept');
    const photos = (await db.getAll(db.STORES.photos)).map(p => p.id).sort();
    eq(photos, ['pho_ava', 'pho_shared'], 'a photo Ava\'s memory still uses is kept');
    ok(seen.settings.includes('*'), `settings change emitted: ${seen.settings}`);
    ok(seen.events.includes('bulk'), 'events change emitted');
    ok(await backup.getSafetyCopy(), 'a copy of what was here is kept on this phone');
  });

  await test('settings.removeBaby refuses the last baby (RangeError) and an unknown one (TypeError), touching nothing', async () => {
    const n = (await db.getAll(db.STORES.events)).length;
    await rejects(settings.removeBaby(avaId), e => e instanceof RangeError, 'last baby');
    await rejects(settings.removeBaby('baby_nobody'), e => e instanceof TypeError, 'unknown baby');
    eq([settings.babies().length, (await db.getAll(db.STORES.events)).length], [1, n]);
  });

  await test('removing a baby can be undone from the kept copy (entries, photos, cover, active baby)', async () => {
    await backup.restoreSafetyCopy();
    eq(settings.babies().map(b => b.name).sort(), ['Ava', 'Ben']);
    eq((await db.getAll(db.STORES.events)).map(e => e.id).sort(), ['evt_ava_d', 'evt_ava_m', 'evt_ben_d', 'evt_ben_m', 'evt_pump']);
    eq((await db.getAll(db.STORES.photos)).map(p => p.id).sort(), ['pho_ava', 'pho_ben', 'pho_benface', 'pho_shared']);
    eq(settings.get('memoryCovers')[ben.id], 'evt_ben_m');
  });

  await test('removeBaby reads the baby list from the store, not a stale cache (another tab added a sibling)', async () => {
    // Another tab writes a third baby straight to the store; this tab's cache doesn't know.
    await db.transaction(db.STORES.settings, 'readwrite', (s, ctx) => {
      const g = s.settings.get('babies');
      g.onsuccess = () => { s.settings.put({ key: 'babies', value: [...g.result.value, { id: 'baby_cleo', name: 'Cleo', birthDate: null, photoId: null, createdAt: null }], updatedAt: Date.now() }); ctx.done(); };
    });
    await settings.removeBaby(ben.id);
    eq(settings.babies().map(b => b.name), ['Ava', 'Cleo'], 'Cleo survives');
  });
};

SUITES['fresh-restore'] = async () => {
  const { backup, settings, db } = await mods();
  await settings.load();
  const t = Date.now() - 2 * HOUR;
  const placeholder = settings.get('activeBabyId');
  // Onboarding: a name was typed and a photo picked before "I have a backup file".
  await db.put(db.STORES.photos, photoRec('pho_typed'));
  await settings.updateBaby(placeholder, { name: 'Avery', photoId: 'pho_typed' });
  await settings.set('iconDataUrl', PNG);
  await settings.set('iconBabyId', placeholder);
  const twins = file({
    settings: { babies: [{ id: 'baby_ava', name: 'Ava' }, { id: 'baby_ben', name: 'Ben' }], activeBabyId: 'baby_ben' },
    events: [
      { id: 'evt_a', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ava', data: { kind: 'wet' }, createdAt: t, updatedAt: t },
      { id: 'evt_b', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_ben', data: { kind: 'wet' }, createdAt: t, updatedAt: t },
    ],
  });

  await test('DI-03: an ordinary merge keeps a named baby (no guessing)', async () => {
    eq(backup.isPristineProfile(settings.babies(), []), false);
  });

  await test('DI-03: onboarding restore (freshInstall) of a twins backup replaces the typed placeholder; the file\'s active baby is shown', async () => {
    const res = await backup.importBackup(twins, { mode: 'merge', freshInstall: true });
    eq(settings.babies().map(b => b.name), ['Ava', 'Ben'], 'no "Avery" left behind');
    eq(settings.get('activeBabyId'), 'baby_ben');
    eq(res.adoptedProfile, true);
    eq(backup.describeImport(res, { restore: true }), 'Welcome back · 2 entries restored');
    eq([settings.get('iconBabyId'), settings.get('iconDataUrl')], [null, null], 'no icon for a baby that is gone');
  });
};

SUITES['fresh-restore-single'] = async () => {
  const { backup, settings, db } = await mods();
  await settings.load();
  const placeholder = settings.get('activeBabyId');
  await db.put(db.STORES.photos, photoRec('pho_typed'));
  await settings.updateBaby(placeholder, { name: 'Jo', photoId: 'pho_typed' });
  await settings.set('iconDataUrl', PNG);
  await settings.set('iconBabyId', placeholder);

  await test('DI-03: restoring a one-baby backup with a different name keeps the file\'s name and the photo picked here (and its icon)', async () => {
    await backup.importBackup(file({ settings: { babies: [{ id: 'baby_juno', name: 'Juno', birthDate: '2026-09-01' }] }, events: [] }), { mode: 'merge', freshInstall: true });
    eq(settings.babies().map(b => [b.id, b.name, b.photoId, b.birthDate]), [['baby_juno', 'Juno', 'pho_typed', '2026-09-01']]);
    eq(settings.get('activeBabyId'), 'baby_juno');
    eq([settings.get('iconBabyId'), settings.get('iconDataUrl')], ['baby_juno', PNG]);
  });
};

SUITES.imports = async () => {
  const { backup, settings, events } = await mods();
  await settings.load();
  const clara = settings.get('activeBabyId');
  await settings.updateBaby(clara, { name: 'Clara', birthDate: '2026-09-08' });
  const t = Date.now() - 2 * HOUR;

  await test('DI-12: a merged sleep running for 17 h comes in finished at its start with a note; a 3 h feed keeps running', async () => {
    const res = await backup.importBackup(file({
      settings: { babies: [{ id: clara, name: 'Clara' }] },
      events: [
        { id: 'evt_s17', type: 'sleep', startTime: Date.now() - 17 * HOUR, endTime: null, babyId: clara, data: { kind: 'night' }, createdAt: t, updatedAt: t },
        { id: 'evt_f3', type: 'feed', startTime: Date.now() - 3 * HOUR, endTime: null, babyId: clara, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' }, createdAt: t, updatedAt: t },
      ],
    }), { mode: 'merge' });
    const s = await events.get('evt_s17');
    eq([s.endTime === s.startTime, s.note], [true, backup.STALE_RUNNING_NOTE]);
    eq((await events.get('evt_f3')).endTime, null);
    eq(res.stats.events.stoppedStale, 1);
    ok(/1 old timer stopped/.test(backup.describeImport(res)), backup.describeImport(res));
  });

  await test('DI-04: "Clara Rose" added as a new baby is named in the summary, with where to switch', async () => {
    const partner = file({
      settings: { babies: [{ id: 'baby_rose', name: 'Clara Rose', birthDate: '2026-09-08' }] },
      events: [{ id: 'evt_r1', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_rose', data: { kind: 'wet' }, createdAt: t, updatedAt: t }],
    });
    eq(await backup.previewBabyQuestion(partner), { local: { id: clara, name: 'Clara' }, incoming: { id: 'baby_rose', name: 'Clara Rose' } }, 'the merge asks first');
    const res = await backup.importBackup(partner, { mode: 'merge', babyMatches: { baby_rose: null } });
    eq(backup.describeImport(res), 'Merged · 1 entry added. Added Clara Rose as a new baby. Switch babies from the name on Today.');
  });

  await test('DI-04: answering "same baby" puts the partner\'s entries on this phone\'s Clara', async () => {
    const partner = file({
      settings: { babies: [{ id: 'baby_rose2', name: 'Clara R', birthDate: '2026-09-08' }] },
      events: [{ id: 'evt_r2', type: 'diaper', startTime: t, endTime: t, babyId: 'baby_rose2', data: { kind: 'wet' }, createdAt: t, updatedAt: t }],
    });
    await settings.removeBaby('baby_rose');
    const res = await backup.importBackup(partner, { mode: 'merge', babyMatches: { baby_rose2: clara } });
    eq([(await events.get('evt_r2')).babyId, settings.babies().length], [clara, 1]);
    eq(backup.describeImport(res), 'Merged · 1 entry added');
  });
};

(async () => {
  try {
    if (!SUITES[suite]) throw new Error(`unknown suite ${suite}`);
    await SUITES[suite]();
  } catch (err) {
    results.push({ name: `suite ${suite} crashed`, ok: false, error: String((err && err.stack) || err) });
  }
  window.__results = results;
  window.__done = true;
})();
