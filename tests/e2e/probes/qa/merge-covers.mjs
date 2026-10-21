// Known gap: merge import drops memoryCovers. Export with a cover set, clear it, merge the same file back.
import { launch, freshApp, mod } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
const r = await page.evaluate(async ([b, s, st]) => {
  const B = await import(b); const { settings } = await import(s); const { events } = await import(st);
  const baby = settings.activeBaby();
  const m = await events.add({ type: 'milestone', startTime: Date.now() - 3600000, data: { key: null, title: 'First smile', photoIds: [] } });
  await settings.set('memoryCovers', { [baby.id]: m.id });
  const file = await B.exportBackupFile({ includePhotos: false, name: 'x.json' });
  const inFile = JSON.parse(await file.text()).settings?.memoryCovers;
  await settings.set('memoryCovers', {});
  const res = await B.importBackup(file, { mode: 'merge', safetyBackup: () => {} });
  return { inFile, afterMerge: settings.get('memoryCovers'), settingsApplied: res.stats.settings };
}, [mod('/js/core/backup.js'), mod('/js/core/settings.js'), mod('/js/core/store.js')]);
console.log(JSON.stringify(r));
await context.close(); await browser.close();
