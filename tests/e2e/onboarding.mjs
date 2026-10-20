// e2e: onboarding (DESIGN §13 Frame 8, §12; AUDIT §6.4; ARCHITECTURE §10,
// §10b) on FRESH profiles at 390×844. Drives every step: the promise + baby
// (name, birth date, photo → apple-touch-icon), Back between steps, units,
// the optional pumping goal, Add to Home Screen (iOS guide with the photo
// icon preview, and the Android native prompt), Skip, restore from a backup
// file (merge → Today), resume after a reload mid-way, a hidden Pumping
// tracker, two babies. Asserts zero console errors, zero CSP violations and
// zero requests to any other origin; saves light + night screenshots to
// docs/design/build/onboarding-*.png for comparison with
// docs/design/final/frame-8*.png.
//
// Run all e2e:  PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
// Just this:    BASE_URL=http://127.0.0.1:8123 node tests/e2e/onboarding.mjs

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8123').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const SHOTS = fileURLToPath(new URL('../../docs/design/build/', import.meta.url));
await mkdir(SHOTS, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch();
const consoleErrors = [];
const foreign = [];
const mod = (path) => `${BASE_URL}${path}`;

async function freshPage({ dark = false, ua = IPHONE_UA, reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light',
    serviceWorkers: 'block', userAgent: ua, reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (new URL(u).origin !== ORIGIN) foreign.push(u);
  });
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-view="onboarding"] .ob-step', { timeout: 15000 });
  // Pin the theme so screenshots are deterministic (auto follows the clock).
  await setSetting(page, 'theme', dark ? 'dark' : 'light');
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, dark ? 'dark' : 'light');
  await page.waitForTimeout(300);
  return { context, page };
}

async function setSetting(page, key, value) {
  await page.evaluate(async ([url, k, v]) => { const { settings } = await import(url); await settings.set(k, v); }, [mod('/js/core/settings.js'), key, value]);
}
async function getSetting(page, key) {
  return page.evaluate(async ([url, k]) => { const { settings } = await import(url); return settings.get(k); }, [mod('/js/core/settings.js'), key]);
}
async function activeBaby(page) {
  return page.evaluate(async (url) => { const { settings } = await import(url); return settings.activeBaby(); }, mod('/js/core/settings.js'));
}
const step = (page) => page.evaluate(() => { const s = document.querySelector('.ob-step:not(.is-leaving)'); return s && s.dataset.step; });
const activeView = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll('#viewport > .view')].filter((s) => !s.classList.contains('is-fading-out'));
  return v.length ? v[v.length - 1].getAttribute('data-view') : null;
});
const settle = (page, ms = 450) => page.waitForTimeout(ms);
async function clickIn(page, sel) {
  await page.click(`.ob-step:not(.is-leaving) ${sel}`);
}
async function waitStep(page, key) {
  await page.waitForFunction((k) => { const s = document.querySelector('.ob-step:not(.is-leaving)'); return s && s.dataset.step === k; }, key, { timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector('.ob-step.is-leaving'), null, { timeout: 3000 });
}
/** Every visible interactive element is ≥ 44×44 and has an accessible name. */
async function targetsOk(page) {
  return page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('[data-view="onboarding"] button, [data-view="onboarding"] a, [data-view="onboarding"] input:not([type="file"]), [data-view="onboarding"] [role="spinbutton"]')) {
      if (el.closest('[hidden]') || el.closest('.is-leaving')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const box = el.closest('label.field') ? el.closest('label.field').getBoundingClientRect() : r;
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim() || (el.labels && el.labels[0] && el.labels[0].textContent.trim());
      if (box.width < 44 || box.height < 44) bad.push(`${el.outerHTML.slice(0, 60)} ${Math.round(box.width)}×${Math.round(box.height)}`);
      if (!name) bad.push(`no name: ${el.outerHTML.slice(0, 60)}`);
    }
    return bad;
  });
}
/** Visible copy never uses a gendered pronoun for the baby (DESIGN §10). */
async function pronounFree(page) {
  const text = await page.evaluate(() => document.querySelector('[data-view="onboarding"]').innerText);
  const m = text.match(/\b(she|her|hers|he|him|his)\b/i);
  return m ? m[0] : null;
}
async function photoPng(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#c98b6b'; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#f3dccb'; g.beginPath(); g.arc(200, 150, 90, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b4a3a'; g.beginPath(); g.arc(170, 130, 10, 0, Math.PI * 2); g.arc(230, 130, 10, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'clara.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}
async function shot(page, name) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}onboarding-${name}.png` });
}

try {
  // ------------------------------------------------ the full flow (iPhone, light)
  console.log('\nfull flow · iPhone · light');
  {
    const { context, page } = await freshPage();
    check('fresh profile lands on onboarding', await activeView(page) === 'onboarding');
    check('chrome is bare (no nav, no pill)', await page.evaluate(() => document.body.dataset.chrome === 'bare' && document.getElementById('tabBar').hidden));
    check('starts on step 1 (baby) with 4 dots, the first on', await step(page) === 'baby'
      && await page.evaluate(() => { const d = [...document.querySelectorAll('.ob-dots > i')]; return d.length === 4 && d[0].classList.contains('is-on') && !d[1].classList.contains('is-on'); }));
    check('wordmark on step 1', await page.isVisible('.ob-top .wordmark'));
    const s1 = await page.evaluate(() => document.querySelector('.ob-step').innerText);
    check('the promise copy (DESIGN §12)', ['Free. Private.', 'Everything stays on this phone.', 'No account.', 'No ads, no analytics.', 'Works offline,', 'even at 3am.', 'Yours to keep.', 'Export or erase any time.', 'Who are we caring for?', 'I have a backup file'].every((t) => s1.includes(t)), s1);
    check('no account / cloud / premium talk', !/\b(sign in|log in|account required|cloud|sync|premium|subscribe)\b/i.test(s1));
    check('targets ≥ 44 and named (step 1)', (await targetsOk(page)).length === 0, (await targetsOk(page)).join(' | '));
    await shot(page, 'empty-light');

    // Continue with no name: gentle inline error, focus to the field, no step change.
    await clickIn(page, '[data-action="next"]');
    await settle(page, 200);
    check('Continue without a name stays and asks for one', await step(page) === 'baby' && await page.isVisible('[data-name-error]')
      && await page.evaluate(() => document.activeElement && document.activeElement.dataset.field === 'name'));

    // Name + birth date are saved as they're entered.
    await page.fill('[data-field="name"]', 'Clara');
    await page.fill('[data-field="born"]', '2026-09-02');
    await page.dispatchEvent('[data-field="born"]', 'change');
    await page.waitForFunction(async (url) => { const { settings } = await import(url); const b = settings.activeBaby(); return b && b.name === 'Clara' && b.birthDate === '2026-09-02'; }, mod('/js/core/settings.js'), { timeout: 3000 });
    check('name + birth date saved while typing (nothing lost on close)', true);
    check('error clears once a name is typed', !(await page.isVisible('[data-name-error]')));
    check('born shows as "Wed, Sep 2, 2026"', (await page.textContent('[data-date-val]')).trim() === 'Wed, Sep 2, 2026', await page.textContent('[data-date-val]'));
    const note = await page.textContent('[data-note]');
    check('lock note uses the name, never a pronoun (iOS: icon claim)', note === 'Clara’s photo and name never leave this phone. On iPhone, Clara’s photo can become the app icon.', note);

    // Photo picker: the circle opens the file chooser; the photo becomes the iPhone icon at once.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickIn(page, '[data-action="photo"]')]);
    await chooser.setFiles(await photoPng(page));
    await page.waitForFunction(() => { const i = document.querySelector('[data-photo-img]'); return i && !i.hidden && i.src.startsWith('blob:'); }, null, { timeout: 5000 });
    const touch = await page.getAttribute('#appleTouchIcon', 'href');
    const icon = await getSetting(page, 'iconDataUrl');
    const b1 = await activeBaby(page);
    check('photo saved on the baby', !!(b1 && b1.photoId));
    check('settings.iconDataUrl is a PNG data URL', typeof icon === 'string' && icon.startsWith('data:image/png;base64,'));
    check('#appleTouchIcon swapped to the photo immediately', touch === icon);
    check('photo button relabelled "Change Clara’s photo"', await page.getAttribute('[data-action="photo"]', 'aria-label') === 'Change Clara’s photo');
    check('no pronouns on step 1', !(await pronounFree(page)), await pronounFree(page));
    await shot(page, 'baby-light');

    // Reload mid-way: everything is still there.
    await page.reload();
    await page.waitForSelector('[data-view="onboarding"] .ob-step');
    await settle(page, 400);
    check('reload: still onboarding, name kept', await step(page) === 'baby' && await page.inputValue('[data-field="name"]') === 'Clara');
    check('reload: birth date + photo kept', await page.inputValue('[data-field="born"]') === '2026-09-02'
      && await page.waitForFunction(() => { const i = document.querySelector('[data-photo-img]'); return i && !i.hidden; }, null, { timeout: 3000 }).then(() => true, () => false));

    // Step 2: forward slide, heading focused, Back works.
    await clickIn(page, '[data-action="next"]');
    await page.waitForSelector('.ob-step.is-leaving', { timeout: 1000 }).then(() => check('step change slides (old step leaves)', true), () => check('step change slides (old step leaves)', false));
    await waitStep(page, 'feeding');
    check('step 2: heading takes focus (announced)', await page.evaluate(() => document.activeElement && document.activeElement.matches('.ob-step [data-focus]') && document.activeElement.textContent.includes('Step 2 of 4')));
    check('step 2: Back replaces the wordmark; second dot on', await page.isVisible('[data-action="back"]') && await page.evaluate(() => document.querySelectorAll('.ob-dots > i')[1].classList.contains('is-on')));
    check('step 2: every tracker listed, Customize mentioned', await page.evaluate(() => { const t = document.querySelector('.ob-step').innerText; return document.querySelectorAll('.ob-trackers > li').length === 7 && t.includes('Settings → Customize'); }));
    check('targets ≥ 44 and named (step 2)', (await targetsOk(page)).length === 0, (await targetsOk(page)).join(' | '));
    await shot(page, 'feeding-light');
    await page.click('[data-action="back"]');
    await waitStep(page, 'baby');
    check('Back → step 1 with everything kept', await page.inputValue('[data-field="name"]') === 'Clara');
    await clickIn(page, '[data-action="next"]');
    await waitStep(page, 'feeding');

    // Units: mL.
    await clickIn(page, '[data-unit="mL"]');
    await page.waitForFunction(async (url) => (await import(url)).settings.get('units') === 'mL', mod('/js/core/settings.js'), { timeout: 3000 });
    check('mL chosen → settings.units = mL, example in mL', (await page.textContent('[data-units-example]')).includes('120 mL'));
    check('units radiogroup semantics', await page.evaluate(() => document.querySelector('[data-units]').getAttribute('role') === 'radiogroup' && document.querySelector('[data-unit="mL"]').getAttribute('aria-checked') === 'true'));
    await page.focus('.ob-step:not(.is-leaving) [data-unit="mL"]');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(async (url) => (await import(url)).settings.get('units') === 'oz', mod('/js/core/settings.js'), { timeout: 3000 });
    check('arrow key moves the units selection (oz)', await page.evaluate(() => document.activeElement.dataset.unit === 'oz'));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(async (url) => (await import(url)).settings.get('units') === 'mL', mod('/js/core/settings.js'), { timeout: 3000 });

    // Step 3: pumping goal in mL.
    await clickIn(page, '[data-action="next"]');
    await waitStep(page, 'goal');
    check('step 3: goal shown in mL (24 oz → 710 mL)', (await page.textContent('[data-goal-value]')).replace(/\s/g, '') === '710mL', await page.textContent('[data-goal-value]'));
    await clickIn(page, '[data-action="goal"][data-dir="1"]');
    check('+ → 720 mL', (await page.getAttribute('[data-goal-value]', 'aria-valuenow')) === '720');
    await page.waitForFunction(async (url) => Math.abs((await import(url)).settings.get('pumpGoalOz') - 24.3) < 0.05, mod('/js/core/settings.js'), { timeout: 3000 });
    check('goal saved in oz (24.3)', true);
    await clickIn(page, '[data-action="goal-preset"][data-value="960"]');
    check('preset chip sets 960 mL and shows pressed', (await page.getAttribute('[data-goal-value]', 'aria-valuenow')) === '960'
      && await page.getAttribute('[data-action="goal-preset"][data-value="960"]', 'aria-pressed') === 'true');
    await page.focus('[data-goal-value]');
    await page.keyboard.press('ArrowDown');
    check('spinbutton arrow keys step it (950)', (await page.getAttribute('[data-goal-value]', 'aria-valuenow')) === '950');
    check('targets ≥ 44 and named (step 3)', (await targetsOk(page)).length === 0, (await targetsOk(page)).join(' | '));
    await shot(page, 'goal-light');

    // Step 4: install (iOS guide + photo icon preview).
    await clickIn(page, '[data-action="next"]');
    await waitStep(page, 'install');
    const s4 = await page.evaluate(() => document.querySelector('.ob-step:not(.is-leaving)').innerText);
    check('step 4: protection framing with the name', s4.includes('Keep Clara’s log safe') && s4.includes('so iPhone never clears Clara’s log'), s4);
    check('step 4: iOS steps', s4.includes('Add to Home Screen') && await page.evaluate(() => document.querySelectorAll('.ob-step:not(.is-leaving) .ob-steps li').length === 3));
    check('step 4: photo icon preview', await page.evaluate(() => { const i = document.querySelector('.ob-icon-preview img'); return !!i && i.src.startsWith('data:image/png'); }));
    check('step 4: Skip hidden on the last step', !(await page.isVisible('.ob-skip')));
    check('no pronouns on step 4', !(await pronounFree(page)), await pronounFree(page));
    check('targets ≥ 44 and named (step 4)', (await targetsOk(page)).length === 0, (await targetsOk(page)).join(' | '));
    await shot(page, 'install-light');

    await page.reload();
    await page.waitForSelector('[data-view="onboarding"] .ob-step');
    await settle(page, 300);
    check('reload resumes on step 4', await step(page) === 'install');

    await clickIn(page, '[data-action="finish"]');
    await page.waitForSelector('[data-view="today"]');
    await settle(page, 500);
    check('Start tracking → Today', await activeView(page) === 'today');
    check('onboarded = true, resume key cleared', await getSetting(page, 'onboarded') === true && await page.evaluate(() => localStorage.getItem('nurture.onboardingStep') === null));
    check('Today greets Clara', (await page.textContent('[data-view="today"]')).includes('Clara'));
    check('focus landed on Today, not <body>', await page.evaluate(() => document.querySelector('[data-view="today"]').contains(document.activeElement)));
    check('zero CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(', '));
    await context.close();
  }

  // ------------------------------------------------ night screenshots + flow
  console.log('\nnight');
  {
    const { context, page } = await freshPage({ dark: true });
    await page.fill('[data-field="name"]', 'Clara');
    await page.fill('[data-field="born"]', '2026-09-02');
    await page.dispatchEvent('[data-field="born"]', 'change');
    await settle(page, 400);
    await shot(page, 'baby-night');
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'feeding'); await shot(page, 'feeding-night');
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'goal'); await shot(page, 'goal-night');
    check('goal shown in oz by default', (await page.textContent('[data-goal-value]')).replace(/\s/g, '') === '24oz');
    await clickIn(page, '[data-action="skip-step"]'); await waitStep(page, 'install');
    check('"Skip for now" on the goal moves on without changing it', await getSetting(page, 'pumpGoalOz') === 24);
    await shot(page, 'install-night');
    check('night: primary button is soft ember (not the lit accent)', await page.evaluate(() => getComputedStyle(document.querySelector('.ob-step:not(.is-leaving) .btn-primary')).backgroundColor === 'rgb(58, 42, 32)'));
    await context.close();
  }

  // ------------------------------------------------ Skip (one tap) — the other suites rely on it
  console.log('\nskip');
  {
    const { context, page } = await freshPage({ ua: ANDROID_UA });
    const note = await page.textContent('[data-note]');
    check('no iPhone icon claim off iOS', note === 'Your baby’s photo and name never leave this phone.', note);
    await page.fill('[data-field="name"]', 'Ari');
    await page.click('[data-action="start"]');
    await page.waitForSelector('[data-view="today"]');
    await settle(page);
    const b = await activeBaby(page);
    check('Skip finishes in one tap and keeps the typed name', await activeView(page) === 'today' && b.name === 'Ari', JSON.stringify(b));
    check('all trackers stay on', Object.values(await getSetting(page, 'trackers')).every(Boolean));
    await context.close();
  }

  // ------------------------------------------------ Android native install prompt
  console.log('\nandroid install prompt');
  {
    const { context, page } = await freshPage({ ua: ANDROID_UA });
    await page.fill('[data-field="name"]', 'Ari');
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'feeding');
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'goal');
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'install');
    check('no prompt yet: Android menu guide shown', (await page.textContent('.ob-step:not(.is-leaving)')).includes('Install app'));
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(e);
    });
    await page.waitForSelector('.ob-step:not(.is-leaving) [data-action="install"]');
    check('beforeinstallprompt → "Add to Home Screen" button + "Not now"', await page.isVisible('.ob-step:not(.is-leaving) [data-action="finish"]'));
    await clickIn(page, '[data-action="install"]');
    await page.waitForFunction(() => (document.querySelector('.ob-step:not(.is-leaving)') || {}).innerText.includes('You’re all set'), null, { timeout: 3000 });
    check('accepting the native prompt → "You’re all set"', await page.evaluate(() => window.__prompted === true));
    await shot(page, 'installed-light');
    await clickIn(page, '[data-action="finish"]');
    await page.waitForSelector('[data-view="today"]');
    check('→ Today', true);
    await context.close();
  }

  // ------------------------------------------------ restore from a backup file
  console.log('\nrestore');
  {
    // Make a real backup with the app's own exporter.
    const { context: c0, page: p0 } = await freshPage();
    await p0.fill('[data-field="name"]', 'Juno');
    await setSetting(p0, 'units', 'mL');
    await p0.evaluate(async (url) => { const { settings } = await import(url); await settings.patch('trackers', { memories: false }); }, mod('/js/core/settings.js'));
    await p0.click('[data-action="start"]');
    await p0.waitForSelector('[data-view="today"]');
    const backup = await p0.evaluate(async ([s, b]) => {
      const { events } = await import(s);
      await events.add({ type: 'diaper', startTime: Date.now() - 3600000, endTime: Date.now() - 3600000, data: { kind: 'wet' } });
      await events.add({ type: 'diaper', startTime: Date.now() - 7200000, endTime: Date.now() - 7200000, data: { kind: 'dirty' } });
      const { exportBackup } = await import(b);
      return JSON.stringify(await exportBackup());
    }, [mod('/js/core/store.js'), mod('/js/core/backup.js')]);
    await c0.close();

    const { context, page } = await freshPage();
    // A bad file: inline error, still onboarding.
    let [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickIn(page, '[data-action="restore"]')]);
    await chooser.setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
    await page.waitForSelector('[data-restore-error]:not([hidden])', { timeout: 3000 });
    check('a file that isn’t a backup: inline error, nothing changed', await activeView(page) === 'onboarding' && (await page.textContent('[data-restore-error]')).includes('isn’t a Nurture backup'));
    [chooser] = await Promise.all([page.waitForEvent('filechooser'), clickIn(page, '[data-action="restore"]')]);
    await chooser.setFiles({ name: 'nurture-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await page.waitForSelector('[data-view="today"]', { timeout: 5000 });
    await settle(page, 500);
    check('restore merges and lands on Today', await activeView(page) === 'today' && await getSetting(page, 'onboarded') === true);
    check('restored baby + entries', (await activeBaby(page)).name === 'Juno'
      && await page.evaluate(async (s) => (await (await import(s)).events.query({ type: 'diaper' })).length === 2, mod('/js/core/store.js')));
    check('the backup’s preferences come back on a fresh phone (mL, Memories hidden)', await getSetting(page, 'units') === 'mL' && (await getSetting(page, 'trackers')).memories === false);
    check('welcome-back toast', (await page.textContent('#toastRoot')).includes('Welcome back · 2 entries restored'), await page.textContent('#toastRoot'));
    await context.close();
  }

  // ------------------------------------------------ hidden Pumping tracker + two babies
  console.log('\nhidden tracker + two babies');
  {
    const { context, page } = await freshPage();
    await page.evaluate(async (url) => {
      const { settings } = await import(url);
      await settings.patch('trackers', { pump: false });
      const first = settings.activeBaby();
      await settings.updateBaby(first.id, { name: 'Rosa' });
      const twin = await settings.addBaby({ name: 'Theo' });
      await settings.setActiveBaby(twin.id);
    }, mod('/js/core/settings.js'));
    await settle(page, 300);
    check('Pumping hidden → 3 dots', await page.evaluate(() => document.querySelectorAll('.ob-dots > i').length === 3));
    check('active baby shown (Theo)', await page.inputValue('[data-field="name"]') === 'Theo');
    await page.evaluate(async (url) => { const { settings } = await import(url); await settings.setActiveBaby(settings.babies()[0].id); }, mod('/js/core/settings.js'));
    await settle(page, 200);
    check('switching the active baby updates the screen (Rosa)', await page.inputValue('[data-field="name"]') === 'Rosa' && (await page.textContent('[data-note]')).startsWith('Rosa’s photo'));
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'feeding');
    check('hidden tracker absent from the list', await page.evaluate(() => ![...document.querySelectorAll('.ob-trackers > li')].some((l) => l.textContent.includes('Pumping'))));
    await clickIn(page, '[data-action="next"]'); await waitStep(page, 'install');
    check('goal step skipped when Pumping is hidden', true);
    await page.click('[data-action="back"]'); await waitStep(page, 'feeding');
    check('Back from install → feeding', true);
    await context.close();
  }

  // ------------------------------------------------ reduced motion: no slide, still works
  console.log('\nreduced motion');
  {
    const { context, page } = await freshPage({ reduced: true });
    await page.fill('[data-field="name"]', 'Clara');
    await clickIn(page, '[data-action="next"]');
    const moved = await page.evaluate(() => { const s = document.querySelector('.ob-step.is-leaving'); return s ? getComputedStyle(s).transform : 'none'; });
    check('reduced motion: steps cross-fade without moving', moved === 'none' || moved === 'matrix(1, 0, 0, 1, 0, 0)', moved);
    await waitStep(page, 'feeding');
    await context.close();
  }

  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('zero requests to other origins', foreign.length === 0, foreign.join(', '));
} catch (err) {
  failures.push(`threw: ${err && err.stack ? err.stack : err}`);
  console.error(err);
} finally {
  await browser.close();
}

console.log(`\nonboarding e2e: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
