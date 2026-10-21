// a11y audit of every Settings page, the report, onboarding steps, confirm sheets; light + night.
import { launch, freshApp, setTheme, shot, BASE_URL } from './lib.mjs';
import { auditFn } from './audit-lib.mjs';
const browser = await launch();
const pr = (theme, label, r) => { const lines = []; for (const [k, v] of Object.entries(r)) if (v.length) lines.push(`   ${k} (${v.length}):\n      ${[...new Set(v)].slice(0, 10).join('\n      ')}`); console.log(`[${theme}] ${label}${lines.length ? '\n' + lines.join('\n') : '  clean'}`); };
for (const theme of ['light', 'dark']) {
  const { context, page } = await freshApp(browser, { theme });
  await setTheme(page, theme);
  await page.click('[data-action="settings"]'); await page.waitForTimeout(700);
  console.log(`[${theme}] feedback href:`, await page.$eval('[data-key="feedback"] a', a => a.getAttribute('href')));
  for (const arg of ['feeding', 'storage', 'data', 'privacy', 'install', 'about']) {
    await page.click(`#viewport section:last-of-type [data-action="go"][data-arg="${arg}"]`); await page.waitForTimeout(800);
    pr(theme, `Settings › ${arg}`, await page.evaluate(auditFn)); await shot(page, `set-${arg}-${theme}`);
    if (arg === 'data') {
      const btns = await page.$$eval('#viewport section:last-of-type button', bs => bs.map(b => b.textContent.trim().replace(/\s+/g, ' ')));
      console.log('   data buttons:', btns.join(' | '));
      const erase = await page.$('#viewport section:last-of-type button:has-text("Erase")');
      if (erase) { await erase.click(); await page.waitForTimeout(700); pr(theme, 'confirm: erase', await page.evaluate(auditFn)); await shot(page, `confirm-erase-${theme}`); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
    }
    if (arg === 'about') { console.log('   about feedback href:', await page.$$eval('#viewport section:last-of-type a[href^="mailto"]', as => as.map(a => a.getAttribute('href')))); }
    await page.goBack(); await page.waitForTimeout(700);
  }
  await page.click('#viewport section:last-of-type [data-action="customize"]'); await page.waitForTimeout(800); pr(theme, 'Settings › customize', await page.evaluate(auditFn)); await shot(page, `set-customize-${theme}`); await page.goBack(); await page.waitForTimeout(700);
  await page.click('#viewport section:last-of-type [data-action="baby"]'); await page.waitForTimeout(800); pr(theme, 'Settings › baby', await page.evaluate(auditFn)); await shot(page, `set-baby-${theme}`);
  console.log('   baby page buttons:', (await page.$$eval('#viewport section:last-of-type button, #viewport section:last-of-type a', bs => bs.map(b => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\s+/g, ' ')))).join(' | '));
  await page.goBack(); await page.waitForTimeout(700);
  await page.click('#viewport section:last-of-type [data-action="report"]'); await page.waitForTimeout(1000); pr(theme, 'Report', await page.evaluate(auditFn)); await shot(page, `report-${theme}`); await page.goBack(); await page.waitForTimeout(700);
  console.log('errors', page.errors);
  await context.close();
  // onboarding
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: theme, serviceWorkers: 'block' });
  const pg = await ctx2.newPage(); await pg.goto(BASE_URL + '/'); await pg.waitForSelector('[data-view="onboarding"]'); await pg.waitForTimeout(700);
  for (let i = 1; i <= 5; i++) {
    pr(theme, `Onboarding step ${i}`, await pg.evaluate(auditFn)); await pg.screenshot({ path: `${(await import('./lib.mjs')).OUT}/onb-${i}-${theme}.png` });
    if (i === 1) await pg.fill('input', 'Robin').catch(() => {});
    if (i === 2) { const b = await pg.$('[data-view="onboarding"] .ob-step:not(.is-leaving) button[aria-pressed], [data-view="onboarding"] [data-method="pump"], [data-view="onboarding"] button:has-text("Pump")'); if (b) await b.click().catch(() => {}); }
    const nx = await pg.$('[data-view="onboarding"] [data-action="next"]:visible') || await pg.$('[data-view="onboarding"] [data-action="finish"]:visible');
    if (!nx) break; await nx.click(); await pg.waitForTimeout(800);
    if (await pg.$('[data-view="today"]')) { console.log('   reached Today after step', i); break; }
  }
  await ctx2.close();
}
await browser.close();
