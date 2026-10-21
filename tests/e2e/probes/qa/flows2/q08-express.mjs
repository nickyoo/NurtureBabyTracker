// Hold + → express pad: does it appear, can a bottle be logged by drag-release, and is Undo offered?
import * as L from './lib.mjs';
const { log, settle } = L;
await L.launch();
const NOW = new Date('2026-10-20T15:30:00Z').getTime();
const { page } = await L.fresh({ time: NOW });
await L.onboard(page);
const fab = await (await page.$('#fab')).boundingBox();
const cx = fab.x + fab.width / 2, cy = fab.y + fab.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await settle(page, 800);
log('pad:', JSON.stringify(await page.evaluate(() => { const x = document.querySelector('.xp-layer'); return x ? x.innerText.replace(/\n/g, ' | ') : null; })));
await L.shot2(page, 'q08-pad');
for (let i = 1; i <= 6; i++) { await page.mouse.move(cx + i * 10, cy - 120); await settle(page, 40); }
await settle(page, 200);
log('pad while dragging:', JSON.stringify(await page.evaluate(() => { const x = document.querySelector('.xp-layer'); return x ? x.innerText.replace(/\n/g, ' | ') : null; })));
await L.shot2(page, 'q08-pad-drag');
await page.mouse.up(); await settle(page, 1200);
log('after release: toast', JSON.stringify(await L.toastText(page)), 'layers', await page.$$eval('.sheet-layer, .xp-layer', (l) => l.length), 'feeds', JSON.stringify((await L.q(page, { type: 'feed' })).map((f) => f.data)));
await L.shot2(page, 'q08-after');
log('errors', L.errors);
await L.close();
