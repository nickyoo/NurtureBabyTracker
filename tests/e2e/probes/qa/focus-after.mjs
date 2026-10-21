// Focus restore when the origin row is re-rendered or removed (edit-save, delete) — keyboard only.
import { launch, freshApp, activeDesc } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('#tabBar button:has-text("Timeline")'); await page.waitForTimeout(800);
const rowSel = '[data-view="timeline"] .row[data-event-id]';
const btns = async () => page.$$eval('.sheet-layer:last-child button', (bs) => bs.map((b) => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 30)));
await page.focus(rowSel); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
console.log('entry sheet buttons:', (await btns()).join(' | '));
const more = await page.$('.sheet-layer:last-child button[aria-label^="More"], .sheet-layer:last-child button:has-text("+0.5"), .sheet-layer:last-child button:has-text("+1")');
if (more) { await more.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
const save = await page.$('.sheet-layer:last-child button:has-text("Save")');
if (save) { await save.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); console.log('after Save: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page)); }
else console.log('no Save button');
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
await page.focus(rowSel); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const del = await page.$('.sheet-layer:last-child button:has-text("Delete")');
await del.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
console.log('after Delete 1: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'buttons', (await btns()).join(' | '), 'focus', await activeDesc(page));
const confirm = await page.$('.sheet-layer:last-child button.btn-danger, .sheet-layer:last-child button:has-text("Delete")');
if (confirm && (await page.$$eval('.sheet-layer', (l) => l.length))) { await confirm.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
console.log('after delete: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page), 'toast', await page.$$eval('#toastRoot .toast', (t) => t.map((x) => x.textContent.trim())));
await context.close(); await browser.close();
