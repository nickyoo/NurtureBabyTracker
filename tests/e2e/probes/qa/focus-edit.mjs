// Keyboard: row → Edit → change → Save; where does focus land, and how does the edit surface enter/exit?
import { launch, freshApp, activeDesc, shot } from './lib.mjs';
const browser = await launch();
const { context, page } = await freshApp(browser);
await page.click('#tabBar button:has-text("Timeline")'); await page.waitForTimeout(800);
const btns = async () => page.$$eval('.sheet-layer:last-child button', (bs) => bs.map((b) => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 30)));
const rows = await page.$$('[data-view="timeline"] .row[data-event-id]');
await rows[0].focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(800);
const edit = await page.$('.sheet-layer:last-child button:has-text("Edit")');
await edit.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
console.log('after Edit: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page));
console.log('edit buttons:', (await btns()).join(' | '));
await shot(page, 'edit-sheet');
const more = await page.$('.sheet-layer:last-child button[aria-label^="More"]');
if (more) { await more.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
const save = await page.$('.sheet-layer:last-child button:has-text("Save")');
if (save) { await save.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(1600); }
console.log('after Save: layers', await page.$$eval('.sheet-layer', (l) => l.length), 'focus', await activeDesc(page));
await context.close(); await browser.close();
