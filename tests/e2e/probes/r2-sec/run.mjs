import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const port = process.argv[2] || '8163';
const base = `http://127.0.0.1:${port}/tests/e2e/probes/r2-sec/blank.html`;
const browser = await chromium.launch();
async function fresh() { const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(base); return { ctx, page }; }
let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`); if (!ok) fails++; };

// 1. ReDoS through the real import path (File -> importBackup), merge mode.
{
  const { ctx, page } = await fresh();
  const r = await page.evaluate(async () => {
    const { importBackup } = await import('/js/core/backup.js');
    const evil = '1'.repeat(30000) + 'x';
    const events = Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, type: 'diaper', startTime: evil, data: { kind: 'wet' } }));
    const file = new File([JSON.stringify({ app: 'nurture', schema: 2, events })], 'b.json', { type: 'application/json' });
    const t = performance.now();
    let err = null;
    try { await importBackup(file); } catch (e) { err = `${e.name}: ${e.message}`; }
    return { ms: Math.round(performance.now() - t), bytes: file.size, err };
  });
  check('importBackup of a 120 KB file finishes in < 1 s', r.ms < 1000, JSON.stringify(r));
  await ctx.close();
}

// 2. Nested-array type: importBackup must throw BackupError (safe message), not RangeError.
{
  const { ctx, page } = await fresh();
  const r = await page.evaluate(async () => {
    const { importBackup } = await import('/js/core/backup.js');
    const deep = '['.repeat(100000) + ']'.repeat(100000);
    const text = `{"app":"nurture","schema":2,"events":[{"id":"x","type":${deep},"startTime":1}]}`;
    const file = new File([text], 'b.json', { type: 'application/json' });
    try { await importBackup(file); return { threw: null, bytes: file.size }; } catch (e) { return { threw: e.name, message: e.message, bytes: file.size }; }
  });
  check('nested-array type -> BackupError', r.threw === 'BackupError', JSON.stringify(r));
  await ctx.close();
}

// 3. Thawed pouch pumped years ago: merge import, then useNext() offers it.
{
  const { ctx, page } = await fresh();
  const r = await page.evaluate(async () => {
    const { importBackup } = await import('/js/core/backup.js');
    const { useNext, summary } = await import('/js/core/stash.js');
    const now = Date.now();
    const file = new File([JSON.stringify({ app: 'nurture', schema: 2, inventory: [{
      id: 'inv_ancient', pumpedAt: Date.UTC(2021, 0, 1), quantity: 4, unit: 'oz', location: 'thawed',
      thawedAt: now - 3600e3, expiresAt: now + 48 * 3600e3, status: 'active' }] })], 'b.json');
    await importBackup(file);
    const next = await useNext();
    const s = await summary();
    return { next: next && { id: next.id, pumpedAt: new Date(next.pumpedAt).toISOString(), status: next.status, expiresAt: new Date(next.expiresAt).toISOString() }, totalOz: s.totalOz };
  });
  check('years-old thawed pouch is not offered as next feed', !r.next || r.next.id !== 'inv_ancient', JSON.stringify(r));
  await ctx.close();
}

// 4. Network: import + export + CSV make no requests beyond module loads.
{
  const { ctx, page } = await fresh();
  const reqs = [];
  await page.evaluate(async () => { await import('/js/core/backup.js'); await import('/js/core/ics.js'); await import('/js/core/photos.js'); await import('/js/core/persist.js'); await import('/js/core/reminders.js'); await import('/js/core/audio.js'); await import('/js/core/migrate.js'); });
  page.on('request', q => reqs.push(q.url()));
  await page.evaluate(async () => {
    const b = await import('/js/core/backup.js');
    await b.importBackup({ app: 'nurture', schema: 2, events: [{ id: 'e1', type: 'diaper', startTime: Date.now() - 1000, data: { kind: 'wet' }, note: '<img src=x onerror=alert(1)>' }], settings: { __proto__: { polluted: 1 }, parentName: '<script>' } });
    await b.exportBackupFile({ includePhotos: true });
    await b.exportCsvFile();
    const { pumpScheduleIcs } = await import('/js/core/ics.js');
    pumpScheduleIcs({ intervalMinutes: 180 });
  });
  check('no network requests during import/export', reqs.length === 0, JSON.stringify(reqs));
  const polluted = await page.evaluate(() => ({}).polluted);
  check('no prototype pollution', polluted === undefined, String(polluted));
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
