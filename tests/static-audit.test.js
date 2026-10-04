// Static wiring audit — no browser, no dependencies, runs in well under a second.
//
// These catch whole CLASSES of "it looks right but nothing happens" bugs by cross-checking the
// HTML, CSS and JS against each other: a button with no handler, an element id that JS looks up
// but doesn't exist, a setting that's saved but never read, a call to a method that isn't there,
// a link or cached file that 404s. (The browser suites then prove the behaviour; this proves the wiring.)
//
// Run: npm test

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal browser stubs so the ES modules can be imported under Node (same as nurture.test.js).
globalThis.indexedDB = { open: () => ({}) };
globalThis.window = globalThis;
globalThis.document = { addEventListener: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// The modules whose public surface we cross-check below.
const { db } = await import('../js/db.js');
const { sound } = await import('../js/audio.js');
const { timer } = await import('../js/timer.js');
const { reminders, ReminderManager } = await import('../js/reminders.js');
const { inventory, InventoryManager } = await import('../js/inventory.js');
const { TrendsManager } = await import('../js/trends.js');
const { ExportManager } = await import('../js/export.js');
const { App } = await import('../js/app.js');
const { OnboardingController } = await import('../js/onboarding.js');
const { SettingsView } = await import('../js/settingsView.js');
const { PumpTimerView } = await import('../js/pumpTimerView.js');
const { InventoryView } = await import('../js/inventoryView.js');
const { DashboardView } = await import('../js/dashboardView.js');
const { FeedFlowController } = await import('../js/feedFlow.js');
const { InstallPromptController } = await import('../js/installPrompt.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const HTML = read('index.html');
const CSS = read('css/style.css');
const SW = read('sw.js');
const MANIFEST = JSON.parse(read('manifest.json'));
const JS_FILES = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).sort();
const JS = Object.fromEntries(JS_FILES.map((f) => [f, read(`js/${f}`)]));
const ALL_JS = Object.values(JS).join('\n');

const unique = (a) => [...new Set(a)];
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
// Blank out comments but keep every newline, so line numbers in failure messages stay right.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])(\/\/.*)$/gm, (m, pre, c) => pre + ' '.repeat(c.length));

// ids defined in markup (HTML + ids baked into JS template strings)
const HTML_IDS = [...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const JS_TEMPLATE_IDS = [...ALL_JS.matchAll(/\bid="([^"$]+)"/g)].map((m) => m[1]);
const KNOWN_IDS = new Set([...HTML_IDS, ...JS_TEMPLATE_IDS]);

// ======================================================================= IDs ===
describe('element ids', () => {
  test('every id in index.html is unique (a duplicate silently breaks getElementById)', () => {
    const dupes = HTML_IDS.filter((id, i) => HTML_IDS.indexOf(id) !== i);
    assert.deepEqual(unique(dupes), []);
  });

  test('every id the JS looks up by name exists in the page', () => {
    const missing = [];
    for (const [file, src] of Object.entries(JS)) {
      const code = stripComments(src);
      for (const m of code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!KNOWN_IDS.has(m[1])) missing.push(`js/${file}:${lineOf(src, src.indexOf(m[0]))}  getElementById('${m[1]}')`);
      }
      for (const m of code.matchAll(/querySelector(?:All)?\(\s*['"]#([\w-]+)[^'"]*['"]\s*\)/g)) {
        if (!KNOWN_IDS.has(m[1])) missing.push(`js/${file}  querySelector('#${m[1]}')`);
      }
    }
    assert.deepEqual(missing, [], 'JS is looking for elements that do not exist, so that code silently does nothing');
  });

  test('every <label for="…"> points at a real input', () => {
    const bad = [...HTML.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]).filter((id) => !KNOWN_IDS.has(id));
    assert.deepEqual(bad, []);
  });
});

// ================================================================== NAVIGATION ===
describe('tabs', () => {
  test('every nav button points at a real tab pane, and every pane has a nav button', () => {
    const navTabs = [...HTML.matchAll(/class="nav-item[^"]*"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
    const panes = [...HTML.matchAll(/<section class="tab-pane[^"]*" id="tab-([^"]+)"/g)].map((m) => m[1]);
    assert.ok(navTabs.length >= 4);
    assert.deepEqual([...navTabs].sort(), [...panes].sort());
  });
});

// ============================================================== DATA-ACTIONS ===
describe('delegated click actions (data-action)', () => {
  const dispatch = read('js/app.js').match(/switch \(el\.dataset\.action\) \{([\s\S]*?)default:/);
  const handled = dispatch ? [...dispatch[1].matchAll(/case '([^']+)':/g)].map((m) => m[1]) : [];
  const used = unique([...HTML.matchAll(/data-action="([^"]+)"/g), ...ALL_JS.matchAll(/data-action="([^"$]+)"/g)].map((m) => m[1]));
  // Handlers kept on purpose even though nothing uses them yet:
  const RESERVED = new Set(['switch-tab']);

  test('the action dispatcher was found and has handlers', () => {
    assert.ok(handled.length >= 10, 'could not parse the switch in app.js → bindGlobalActions');
  });

  test('every data-action used in markup has a handler (otherwise tapping it is a dead click)', () => {
    assert.deepEqual(used.filter((a) => !handled.includes(a)), []);
  });

  test('every handler is used by something (otherwise it is dead code)', () => {
    assert.deepEqual(handled.filter((a) => !used.includes(a) && !RESERVED.has(a)), []);
  });
});

// ============================================================ BUTTONS HAVE JOBS ===
describe('buttons', () => {
  // Everything JS can reach by id or by class selector
  const code = stripComments(ALL_JS);
  const byId = new Set([
    ...[...code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/#([A-Za-z][\w-]*)/g)].map((m) => m[1]),
  ]);
  const byClass = new Set([...code.matchAll(/querySelector(?:All)?\(\s*['"`][^'"`]*?\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
  const tag = (s) => ({
    id: /\bid="([^"]+)"/.exec(s)?.[1],
    classes: (/\bclass="([^"]*)"/.exec(s)?.[1] || '').split(/\s+/).filter(Boolean),
    action: /\bdata-action=/.test(s), tab: /\bdata-tab=/.test(s),
  });

  test('every <button> in index.html is wired to something', () => {
    const orphans = [];
    for (const m of HTML.matchAll(/<button\b[^>]*>/g)) {
      const b = tag(m[0]);
      const wired = b.action || b.tab || (b.id && byId.has(b.id)) || b.classes.some((c) => byClass.has(c));
      if (!wired) orphans.push(`line ${lineOf(HTML, m.index)}: ${m[0].slice(0, 90)}`);
    }
    assert.deepEqual(orphans, [], 'these buttons have no id/class/data-action that any JS ever looks at');
  });

  test('every <button> built inside a JS template carries a data-action', () => {
    const orphans = [];
    for (const [file, src] of Object.entries(JS)) {
      const code = stripComments(src);
      for (const m of code.matchAll(/<button\b[^>]*>/g)) {
        const b = tag(m[0]);
        if (!b.action && !(b.id && byId.has(b.id))) orphans.push(`js/${file}:${lineOf(code, m.index)}: ${m[0].slice(0, 90)}`);
      }
    }
    assert.deepEqual(orphans, []);
  });

  test('icon-only buttons and links have an accessible name', () => {
    const unnamed = [];
    for (const m of HTML.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const attrs = m[2];
      const visibleText = m[3].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
      if (!visibleText && !/aria-label=|title=/.test(attrs)) unnamed.push(`line ${lineOf(HTML, m.index)}: <${m[1]}${attrs.slice(0, 60)}>`);
    }
    assert.deepEqual(unnamed, []);
  });

  test('there are no inline onclick="" handlers (the app uses one delegated listener instead)', () => {
    const markup = HTML.replace(/<!--[\s\S]*?-->/g, '') + '\n' + stripComments(ALL_JS);
    const inline = [...markup.matchAll(/\bonclick\s*=\s*"/g)];
    assert.equal(inline.length, 0, 'found inline onclick="" attributes');
  });
});

// ==================================================================== LINKS ===
describe('links and assets', () => {
  test('every local href/src in index.html points at a file that exists', () => {
    const refs = [...HTML.matchAll(/\b(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|data:|\/$)/.test(u));
    const missing = unique(refs).filter((u) => !exists(u.split('?')[0]));
    assert.deepEqual(missing, []);
  });

  test('in-page #anchors (HTML and generated) point at an element that exists', () => {
    const anchors = [...HTML.matchAll(/href="#([^"]+)"/g), ...ALL_JS.matchAll(/href="#([^"$]+)"/g)].map((m) => m[1]);
    assert.deepEqual(unique(anchors).filter((id) => !KNOWN_IDS.has(id)), []);
  });

  test('every ES import resolves to a file, and every imported name is actually exported there', () => {
    const problems = [];
    const exportsOf = (src) => {
      const names = new Set();
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/g)) names.add(m[1]);
      for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').forEach((n) => names.add(n.split(/\s+as\s+/).pop().trim()));
      return names;
    };
    for (const [file, src] of Object.entries(JS)) {
      for (const m of src.matchAll(/import\s+(?:\{([^}]*)\}|([\w$]+))\s+from\s+['"](\.[^'"]+)['"]/g)) {
        const target = path.posix.normalize(`js/${m[3]}`);
        if (!exists(target)) { problems.push(`js/${file}: imports ${m[3]} — no such file`); continue; }
        if (m[1]) {
          const have = exportsOf(read(target));
          for (const name of m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
            if (!have.has(name)) problems.push(`js/${file}: imports { ${name} } from ${m[3]} — not exported`);
          }
        }
      }
    }
    assert.deepEqual(problems, [], 'a bad import stops the whole app from loading');
  });

  test('manifest: installable (standalone), start page exists, every icon exists, 192 + 512 provided', () => {
    assert.equal(MANIFEST.display, 'standalone');
    assert.ok(exists(MANIFEST.start_url.replace(/^\.\//, '')), `start_url ${MANIFEST.start_url}`);
    for (const icon of MANIFEST.icons) assert.ok(exists(icon.src), `icon ${icon.src}`);
    const sizes = MANIFEST.icons.map((i) => i.sizes);
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  });

  test('service worker: every file it pre-caches exists (one 404 makes install fail and kills offline mode)', () => {
    const listed = [...SW.match(/ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(listed.length > 20);
    const missing = listed.filter((u) => u !== './' && !exists(u.replace(/^\.\//, '')));
    assert.deepEqual(missing, []);
  });

  test('service worker: pre-caches every module, the stylesheet, the page, the manifest and every icon the page uses', () => {
    const listed = new Set([...SW.match(/ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
    const need = [
      'index.html', 'manifest.json', 'css/style.css',
      ...JS_FILES.map((f) => `js/${f}`),
      ...MANIFEST.icons.map((i) => i.src),
      ...[...HTML.matchAll(/\b(?:href|src)="(icons\/[^"]+)"/g)].map((m) => m[1]),
    ];
    // bottles.js is legacy-but-imported (see README); it must be cached too or offline start-up breaks
    assert.deepEqual(unique(need).filter((f) => !listed.has(f)), []);
  });
});

// ===================================================================== STYLES ===
describe('styles', () => {
  test('a global [hidden] rule guarantees the hidden attribute always hides (author CSS like `display:flex` otherwise beats it)', () => {
    assert.ok(/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(CSS), 'add this to css/style.css:  [hidden] { display: none !important; }');
  });

  test('pinch-zoom is not disabled (accessibility, and the README promises it)', () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(HTML)[1];
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
  });
});

// ================================================================== SETTINGS ===
describe('saved settings', () => {
  // Every key written with setSetting('x', …) must be READ back somewhere, or the choice is silently lost.
  const written = [...ALL_JS.matchAll(/setSetting\(\s*['"]([\w]+)['"]/g)].map((m) => m[1]);
  // "Read back" means it is loaded from the database: loadSettings() copies saved.<key>, something calls
  // getSetting('<key>'), or a file that calls db.getAllSettings() uses settings.<key>. Merely mentioning the
  // key on the in-memory settings object (as the onboarding screen once did) does NOT count — nothing fills it.
  const readable = (key) => {
    if (new RegExp(`saved\\.${key}\\b`).test(JS['app.js'])) return true;
    if (new RegExp(`getSetting\\(\\s*['"]${key}['"]`).test(ALL_JS)) return true;
    return Object.values(JS).some((src) => /getAllSettings\(\)/.test(src) && new RegExp(`settings\\.${key}\\b`).test(stripComments(src)));
  };

  test('every setting that is saved is loaded back somewhere', () => {
    const lost = unique(written).filter((k) => !readable(k));
    assert.deepEqual(lost, [], 'these are written to the database but nothing ever reads them — the user\'s choice is silently thrown away');
  });

  // Read only by migrateLegacySettings(), to recover choices older versions saved under these names.
  const LEGACY_READ_ONLY = new Set(['dailyPumpingGoal', 'reminderIntervalHours']);

  test('every setting that is loaded is saved somewhere (otherwise it can never leave its default)', () => {
    const loaded = unique([...stripComments(read('js/app.js')).matchAll(/saved\.(\w+)/g)].map((m) => m[1]));
    const writtenAll = new Set(written);
    assert.deepEqual(loaded.filter((k) => !writtenAll.has(k) && !LEGACY_READ_ONLY.has(k)), []);
  });
});

// ========================================================== METHOD CALLS EXIST ===
describe('method calls', () => {
  // A call like reminders.init() when only start() exists doesn't fail loudly: it throws inside a
  // try/catch or an event handler and the feature just… doesn't happen.
  // names reachable on a class's instances / on a class itself / on an existing instance
  const protoNames = (cls) => {
    const n = new Set();
    for (let o = cls.prototype; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach((k) => n.add(k));
    return n;
  };
  const staticNames = (cls) => {
    const n = new Set();
    for (let o = cls; o && o !== Function.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach((k) => n.add(k));
    return n;
  };
  const instanceNames = (obj) => {
    const n = new Set(Object.getOwnPropertyNames(obj));
    for (let o = Object.getPrototypeOf(obj); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach((k) => n.add(k));
    return n;
  };

  const SINGLETONS = { db, sound, timer, reminders, inventory };
  const STATICS = { InventoryManager, TrendsManager, ExportManager, ReminderManager };
  const CONTROLLERS = {
    onboarding: OnboardingController, settingsView: SettingsView, pumpTimerView: PumpTimerView,
    inventoryView: InventoryView, dashboardView: DashboardView, feedFlow: FeedFlowController, installPrompt: InstallPromptController,
  };
  const FILE_CLASS = {
    'app.js': App, 'onboarding.js': OnboardingController, 'settingsView.js': SettingsView, 'pumpTimerView.js': PumpTimerView,
    'inventoryView.js': InventoryView, 'dashboardView.js': DashboardView, 'feedFlow.js': FeedFlowController,
    'installPrompt.js': InstallPromptController, 'reminders.js': ReminderManager, 'inventory.js': InventoryManager,
  };

  test('calls on the shared singletons (db, sound, timer, reminders, inventory) hit methods that exist', () => {
    const bad = [];
    for (const [file, src] of Object.entries(JS)) {
      const code = stripComments(src);
      for (const [name, obj] of Object.entries(SINGLETONS)) {
        if (new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(code)) continue; // shadowed by a local of the same name
        const have = instanceNames(obj);
        for (const m of code.matchAll(new RegExp(`(?<![\\w.])${name}\\.(\\w+)\\(`, 'g'))) {
          if (!have.has(m[1])) bad.push(`js/${file}:${lineOf(code, m.index)}  ${name}.${m[1]}() does not exist`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('static helper calls (InventoryManager., TrendsManager., ExportManager., ReminderManager.) hit methods that exist', () => {
    const bad = [];
    for (const [file, src] of Object.entries(JS)) {
      const code = stripComments(src);
      for (const [name, cls] of Object.entries(STATICS)) {
        const have = staticNames(cls);
        for (const m of code.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\(`, 'g'))) {
          if (!have.has(m[1])) bad.push(`js/${file}:${lineOf(code, m.index)}  ${name}.${m[1]}() does not exist`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('app.something() and app.<controller>.something() calls hit methods that exist', () => {
    const bad = [];
    const appMethods = protoNames(App);
    for (const [file, src] of Object.entries(JS)) {
      const code = stripComments(src);
      for (const m of code.matchAll(/\bapp\.(\w+)\(/g)) {
        if (!appMethods.has(m[1])) bad.push(`js/${file}:${lineOf(code, m.index)}  app.${m[1]}() does not exist`);
      }
      for (const m of code.matchAll(/\bapp\.(\w+)\.(\w+)\(/g)) {
        const cls = CONTROLLERS[m[1]];
        if (cls && !protoNames(cls).has(m[2])) bad.push(`js/${file}:${lineOf(code, m.index)}  app.${m[1]}.${m[2]}() does not exist`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('this.something() calls inside each controller hit methods defined on that controller', () => {
    const bad = [];
    for (const [file, cls] of Object.entries(FILE_CLASS)) {
      const code = stripComments(JS[file]);
      const have = protoNames(cls);
      for (const m of code.matchAll(/\bthis\.(\w+)\(/g)) {
        if (!have.has(m[1])) bad.push(`js/${file}:${lineOf(code, m.index)}  this.${m[1]}() is not defined on ${cls.name}`);
      }
    }
    assert.deepEqual(bad, []);
  });
});
