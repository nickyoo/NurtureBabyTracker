// Data-integrity lens helpers: boot the real app on a realistic v1 profile.
import { chromium, BASE_URL, mod, OUT } from '../lib.mjs';
export { chromium, BASE_URL, mod, OUT };
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function v1Seed(now) {
  const T1 = now - 2 * DAY, T2 = now - DAY;
  return {
    sessions: [
      { id: 'pump_aaa', type: 'pump', startTime: T1, endTime: T1 + 20 * MIN, durationSec: 1200, outputQty: 4.5, unit: 'oz', notes: 'morning', createdAt: T1 + 20 * MIN },
      { id: 'pump_nan', type: 'pump', startTime: T1 + 3 * HOUR, endTime: T1 + 3 * HOUR + 15 * MIN, durationSec: 900, outputQty: 'NaN', unit: 'mL', notes: '', createdAt: T1 + 3 * HOUR },
      { id: 'pump_null', type: 'pump', startTime: T1 + 6 * HOUR, endTime: T1 + 6 * HOUR + 10 * MIN, durationSec: 600, outputQty: null, unit: 'oz', notes: 'left side only', createdAt: T1 + 6 * HOUR },
      { id: 'sess_bbb', type: 'feed', feedType: 'breastmilk', startTime: T2, endTime: T2, durationSec: 900, outputQty: 120, unit: 'mL', notes: 'Bottle feed (120 mL prepared)', createdAt: T2 },
      { id: 'sess_ccc', type: 'feed', feedType: 'formula', startTime: T2 + 2 * HOUR, endTime: T2 + 2 * HOUR, durationSec: 0, outputQty: 4, unit: 'oz', notes: 'Formula Feeding', createdAt: T2 + 2 * HOUR },
      { id: 'sess_ddd', type: 'feed', feedType: 'breastmilk', startTime: T2 + 4 * HOUR, endTime: T2 + 4 * HOUR, durationSec: 0, outputQty: 3, unit: 'oz', notes: '<img src=x onerror=alert(1)>', createdAt: T2 + 4 * HOUR },
      { id: 'sess_today', type: 'feed', feedType: 'formula', startTime: now - 3 * HOUR, endTime: now - 3 * HOUR, durationSec: 600, outputQty: 150, unit: 'mL', notes: '', createdAt: now - 3 * HOUR },
      { id: 'pump_today', type: 'pump', startTime: now - 4 * HOUR, endTime: now - 4 * HOUR + 15 * MIN, durationSec: 900, outputQty: 3.25, unit: 'oz', notes: '', createdAt: now - 4 * HOUR },
      { id: 'bot_zzz', type: 'bottle', startTime: T2, outputQty: 2 },
    ],
    inventory: [
      { id: 'inv_frozen-1', pumpedAt: now - 30 * DAY, quantity: 5, unit: 'oz', location: 'freezer', expiresAt: now + 150 * DAY, status: 'active', notes: 'Pumped session (20:00)', createdAt: now - 30 * DAY },
      { id: 'inv_thawed-1', pumpedAt: now - 40 * DAY, quantity: 4, unit: 'oz', location: 'thawed', thawedAt: now - 2 * HOUR, expiresAt: now + 22 * HOUR, status: 'active', notes: '', createdAt: now - 40 * DAY },
      { id: 'inv_fridge-old', pumpedAt: now - 6 * DAY, quantity: 90, unit: 'mL', location: 'fridge', expiresAt: now - 2 * DAY, status: 'active', notes: '', createdAt: now - 6 * DAY },
      { id: 'inv_fridge-ok', pumpedAt: now - 1 * DAY, quantity: 120, unit: 'mL', location: 'fridge', expiresAt: now + 2 * DAY, status: 'active', notes: '', createdAt: now - 1 * DAY },
      { id: 'inv_used-1', pumpedAt: now - 10 * DAY, quantity: 3, unit: 'oz', location: 'fridge', expiresAt: now - 6 * DAY, status: 'used', usedAt: now - 8 * DAY, notes: '', createdAt: now - 10 * DAY },
    ],
    settings: [
      ['dailyGoalOz', 26], ['pumpIntervalMinutes', 120], ['units', 'mL'], ['themeMode', 'light'], ['soundEnabled', false],
      ['storageWindows', { roomTempHours: 4, fridgeDays: 3, freezerMonths: 6, deepFreezerMonths: 12, thawedBottleHours: 24, startedBottleHours: 2 }],
      ['parentName', 'Nick'], ['babyName', 'Clara'], ['onboarding_completed', true],
      ['dailyPumpingGoal', 30], ['reminderIntervalHours', 2], ['preferredUnit', 'oz'],
    ],
  };
}

/** Write the v1 schema + data into NurtureDB v1 from a same-origin blank page. */
export async function seedV1(page, { liveTimers = true } = {}) {
  await page.goto(mod('/manifest.json'));
  await page.evaluate(async ([seed, liveTimers]) => {
    for (const s of seed.sessions) if (s.outputQty === 'NaN') s.outputQty = NaN;
    await new Promise((res, rej) => {
      const req = indexedDB.open('NurtureDB', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const ss = db.createObjectStore('sessions', { keyPath: 'id' });
        ss.createIndex('type', 'type'); ss.createIndex('startTime', 'startTime'); ss.createIndex('createdAt', 'createdAt');
        const inv = db.createObjectStore('inventory', { keyPath: 'id' });
        for (const i of ['status', 'expiresAt', 'pumpedAt', 'location']) inv.createIndex(i, i);
        const b = db.createObjectStore('bottles', { keyPath: 'id' }); b.createIndex('status', 'status'); b.createIndex('expiresAt', 'expiresAt');
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['sessions', 'inventory', 'settings'], 'readwrite');
        for (const s of seed.sessions) tx.objectStore('sessions').put(s);
        for (const i of seed.inventory) tx.objectStore('inventory').put(i);
        for (const [key, value] of seed.settings) tx.objectStore('settings').put({ key, value, updatedAt: Date.now() });
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      req.onerror = () => rej(req.error);
    });
    if (liveTimers) {
      localStorage.setItem('nurture_active_pump_timer', JSON.stringify({ active: true, type: 'pump', startedAt: Date.now() - 10 * 60000, storeDestination: 'freezer' }));
      localStorage.setItem('nurture_bottle_timer', JSON.stringify({ startTs: Date.now() - 5 * 60000, feedType: 'breastmilk', preparedOz: 4, sourceInventoryId: 'inv_thawed-1' }));
    }
  }, [v1Seed(Date.now()), liveTimers]);
}

export async function phone(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    serviceWorkers: opts.sw ? 'allow' : 'block', ...(opts.ctx || {}),
  });
  const page = await context.newPage();
  instrument(page);
  return { context, page };
}

export function instrument(page) {
  page.errors = []; page.foreign = []; page.csp = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') page.errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { const u = r.url(); if (!/^(https?:\/\/127\.0\.0\.1|data:|blob:)/.test(u)) page.foreign.push(u); });
  page.on('dialog', (d) => { page.errors.push(`DIALOG ${d.type()}: ${d.message()}`); d.dismiss(); });
}

export async function watchCsp(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
    window.__xss = [];
    window.alert = (m) => window.__xss.push(`alert:${m}`);
  });
}
