import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const root = '/home/user/NurtureBabyTracker/docs/design';
const out = root + '/final'; mkdirSync(out, { recursive: true });
const only = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: 2 });
const ext = []; const errs = [];
p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) ext.push(r.url()); });
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('requestfailed', r => errs.push('FAILED ' + r.url()));
await p.goto('file://' + root + '/mockup.html');
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
const fonts = await p.evaluate(() => [...document.fonts].map(f => `${f.family} ${f.style} ${f.status}`));
console.log('fonts:', fonts.join(' | '));
console.log('external requests:', ext.length, ext.slice(0, 5), 'errors:', errs);
const report = await p.evaluate(() => {
  const small = [], over = [], tiny = [];
  document.querySelectorAll('.frame').forEach(fr => {
    const fb = fr.getBoundingClientRect();
    fr.querySelectorAll('button,[role=switch],a,label.field').forEach(el => {
      const r = el.getBoundingClientRect(); if (!r.width) return;
      if (r.bottom < fb.top || r.top > fb.bottom) return;
      if ((r.width < 44 || r.height < 44) && !el.closest('.scrim,.behind')) small.push(fr.id + ' ' + el.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    fr.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (el.children.length === 0 && el.textContent.trim() && parseFloat(cs.fontSize) < 12 && !(el.closest('svg'))) tiny.push(fr.id + ' ' + el.textContent.trim().slice(0, 20) + ' ' + cs.fontSize);
      if (el.scrollWidth > el.clientWidth + 1 && ['hidden', 'clip'].includes(cs.overflowX) && el.clientWidth > 0 && !el.classList.contains('screen') && !el.classList.contains('frame')) over.push(fr.id + ' ' + el.className + ': ' + el.textContent.trim().slice(0, 40));
    });
    // content horizontally escaping the frame
    fr.querySelectorAll('.screen *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && (r.right > fb.right - 8 || r.left < fb.left + 8) && !el.closest('.cover,.list,.ql-grid,.stats,.strip,.hero,.tiles,.diaper-row,.days,.split,.promises,.grid3')) { /* allow gutters */ if (r.right > fb.right - 19.5 || r.left < fb.left + 19.5) over.push(fr.id + ' gutter ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left - fb.left) + '..' + Math.round(r.right - fb.left)); } });
  });
  return { small: [...new Set(small)], over: [...new Set(over)].slice(0, 40), tiny: [...new Set(tiny)].slice(0, 20) };
});
console.log(JSON.stringify(report, null, 1));
const ids = await p.$$eval('.frame', els => els.map(e => e.id));
for (const id of ids) { if (only && !id.startsWith('frame-' + only)) continue; await p.locator('#' + id).screenshot({ path: `${out}/${id}.png` }); }

await b.close();
