// Settings: add/switch baby, no remove, backup save → import merge / replace, calendar, feedback, erase.
import * as L from './lib.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const { log, settle, shot, TOP, MIN } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page, { name: 'Robin' });
await page.evaluate(async ([u, now]) => { const { events } = await import(u); await events.add({ type: 'feed', startTime: now - 3600000, endTime: now - 3000000, data: { method: 'bottle', milk: 'formula', amount: 4, unit: 'oz' } }); }, [L.mod('/js/core/store.js'), NOW]);
const openSettings = async () => { await L.tab(page, 'today'); await page.click('[data-view="today"] [data-action="settings"]'); await settle(page, 700); };
// --- add a baby
await openSettings();
await L.clickView(page, 'settings', '[data-action="add-baby"]'); await settle(page, 700);
log('ADD BABY page:', JSON.stringify(await L.viewText(page, 'settings')));
await page.fill('[data-view="settings"]:last-of-type [data-field="name"]', 'Sam');
await L.clickView(page, 'settings', '[data-action="save-baby"]'); await settle(page, 1200);
log('after save:', await L.activeView(page), JSON.stringify((await L.viewText(page, 'settings')).slice(0, 500)));
await shot(page, 'p10-after-add-baby');
log('babies', JSON.stringify((await L.getSetting(page, 'babies')).map((b) => b.name)), 'active', await L.getSetting(page, 'activeBabyId'));
// baby page for Robin: any remove?
log('root now:', JSON.stringify((await L.viewText(page, 'settings')).slice(0, 300)));
await L.clickView(page, 'settings', '[data-action="baby"]'); await settle(page, 700);
log('BABY page Robin:', JSON.stringify(await L.viewText(page, 'settings')));
log('  any remove control?', await page.evaluate(() => [...document.querySelectorAll('[data-view="settings"] button, [data-view="settings"] a')].filter((b) => /remove baby|delete baby|remove robin|delete robin/i.test(b.textContent)).length));
await shot(page, 'p10-baby-page');
await page.goBack(); await settle(page, 500); await page.goBack(); await settle(page, 600);
// --- Today switcher
log('TODAY masthead:', JSON.stringify((await L.viewText(page, 'today')).slice(0, 200)));
await page.click('[data-view="today"] [data-action="switch-baby"]'); await settle(page, 700);
log('switch sheet:', JSON.stringify(await L.topText(page)));
await shot(page, 'p10-switch-sheet');
await page.click(`${TOP} button:has-text("Sam")`).catch((e) => log('no Sam btn', e.message.slice(0, 80))); await L.waitNoLayers(page); await settle(page, 800);
log('TODAY after switch:', JSON.stringify((await L.viewText(page, 'today')).slice(0, 600)));
await shot(page, 'p10-today-sam');
// --- feedback hrefs
await openSettings();
log('feedback hrefs root:', JSON.stringify(await page.$$eval('[data-view="settings"] a[href^="mailto"]', (a) => a.map((x) => [x.textContent.trim().replace(/\s+/g, ' '), x.getAttribute('href')]))));
// --- data page: backup
await L.clickView(page, 'settings', '[data-action="go"][data-arg="data"]'); await settle(page, 700);
log('DATA page:', JSON.stringify(await L.viewText(page, 'settings')));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), L.clickView(page, 'settings', '[data-action="backup"]')]);
let backupPath = null;
if (dl) { backupPath = L.SHOTS + 'p10-backup.json'; await dl.saveAs(backupPath); const j = JSON.parse(await readFile(backupPath, 'utf8')); log('backup', dl.suggestedFilename(), 'events', j.events.length, 'babies', j.settings && JSON.stringify(j.settings.babies && j.settings.babies.map((b) => b.name))); }
await settle(page, 600); log('toast', JSON.stringify(await L.toastText(page))); await L.dismissToast(page);
// --- import merge (same file → nothing new)
if (backupPath) {
  await page.setInputFiles('[data-view="settings"] [data-import]', backupPath); await settle(page, 900);
  log('import sheet:', JSON.stringify(await L.topText(page)));
  await shot(page, 'p10-import-sheet');
  await page.click(`${TOP} [data-choice="merge"]`); await L.waitNoLayers(page, 5000); await settle(page, 600);
  log('merge toast', JSON.stringify(await L.toastText(page))); await L.dismissToast(page);
  // modify the file: add a memory + a cover → merge
  const j = JSON.parse(await readFile(backupPath, 'utf8'));
  const babyId = j.settings.babies[0].id;
  const mem = { id: 'evt_qa_mem1', type: 'milestone', babyId, startTime: NOW - 7200000, endTime: null, data: { title: 'Partner memory', photoIds: [] }, note: '', createdAt: NOW - 7200000, updatedAt: NOW - 7200000, deviceId: 'dev_partner' };
  j.events.push(mem);
  j.settings.memoryCovers = { [babyId]: mem.id };
  const p2 = L.SHOTS + 'p10-backup-partner.json'; await writeFile(p2, JSON.stringify(j));
  await page.setInputFiles('[data-view="settings"] [data-import]', p2); await settle(page, 900);
  await page.click(`${TOP} [data-choice="merge"]`); await L.waitNoLayers(page, 5000); await settle(page, 600);
  log('merge2 toast', JSON.stringify(await L.toastText(page))); await L.dismissToast(page);
  log('memoryCovers after merge:', JSON.stringify(await L.getSetting(page, 'memoryCovers')), 'file had', JSON.stringify(j.settings.memoryCovers));
  // replace
  await page.setInputFiles('[data-view="settings"] [data-import]', backupPath); await settle(page, 900);
  const dls = []; page.on('download', (d) => dls.push(d.suggestedFilename()));
  await page.click(`${TOP} [data-choice="replace"]`); await settle(page, 900);
  log('replace confirm:', JSON.stringify(await L.topText(page)));
  await shot(page, 'p10-replace-confirm');
  await page.click(`${TOP} .btn-danger, ${TOP} [data-confirm]`).catch((e) => log('no confirm btn', e.message.slice(0, 80)));
  await L.waitNoLayers(page, 5000); await settle(page, 1200);
  log('replace toast', JSON.stringify(await L.toastText(page)), 'downloads', JSON.stringify(dls)); await L.dismissToast(page);
  log('babies after replace', JSON.stringify((await L.getSetting(page, 'babies')).map((b) => b.name)), 'view', await L.activeView(page));
}
// --- calendar (feeding page)
await page.goBack(); await settle(page, 600);
await L.clickView(page, 'settings', '[data-action="go"][data-arg="feeding"]'); await settle(page, 700);
log('FEEDING page:', JSON.stringify(await L.viewText(page, 'settings')));
const [cal] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), L.clickView(page, 'settings', '[data-action="calendar"]')]);
log('calendar download', cal && cal.suggestedFilename(), 'toast', JSON.stringify(await L.toastText(page)));
if (cal) { const t = await readFile(await cal.path(), 'utf8'); log(t.split('\r\n').filter((l) => /SUMMARY|DESCRIPTION|RRULE|DTSTART/.test(l)).slice(0, 8).join('\n')); }
await L.dismissToast(page);
// --- privacy + about feedback
await page.goBack(); await settle(page, 600);
for (const pg of ['privacy', 'about']) { await L.clickView(page, 'settings', `[data-action="go"][data-arg="${pg}"]`); await settle(page, 700); log(pg, 'mailto:', JSON.stringify(await page.$$eval('[data-view="settings"] a[href^="mailto"]', (a) => a.map((x) => x.getAttribute('href'))))); await page.goBack(); await settle(page, 600); }
// --- erase
await L.clickView(page, 'settings', '[data-action="go"][data-arg="data"]'); await settle(page, 700);
await L.clickView(page, 'settings', '[data-action="erase"]'); await settle(page, 800);
log('erase confirm:', JSON.stringify(await L.topText(page)));
await page.click(`${TOP} .btn-danger, ${TOP} [data-confirm]`).catch((e) => log('no confirm btn', e.message.slice(0, 80)));
await settle(page, 2000);
log('after erase: view', await L.activeView(page), 'toast', JSON.stringify(await L.toastText(page)), 'events', (await L.q(page)).length);
await shot(page, 'p10-after-erase');
log('errors', L.errors);
await L.close();
