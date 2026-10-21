// Settings (DESIGN §13 Frame 7 + "the rest of Settings"; ARCHITECTURE §6,
// §10, §10b, §10c). A pushed screen (§7.4): params.page picks a sub-page and
// every sub-page is pushed with router.push('settings', { page, … }).
//
//   root        babies, tracking, comfort (appearance, motion, sound), your
//               data, about
//   baby        name, birth date, photo → app icon (iPhone); { babyId } or
//               { new: true } to add a baby
//   customize   Frame 7: tracker toggles + drag / keyboard reorder of Today
//   feeding     formula toggle, pumping goal + interval + Calendar (.ics)
//   storage     milk storage windows (CDC defaults, editable)
//   data        last backup, storage used, persistence, save / CSV / import
//               (merge or replace) / erase everything
//   privacy     plain-English privacy page with live proof
//   install     Add to Home Screen, framed as protection
//   about       version, source, licenses
//
// Rendering: each page is one html`` template. The first paint renders it;
// every later paint MORPHS the live DOM to the new template (attributes and
// text patched in place, keyed rows moved, new rows animated in, removed
// rows collapsed). So focus, input drafts and in-flight transitions (a toggle
// knob sliding) survive every settings change, and the view simply repaints
// whenever a store says something changed — including another tab's write,
// an import or an erase.

import { backup } from '../core/backup.js';
import { shareIcs } from '../core/ics.js';
import { sound } from '../core/audio.js';
import { DEFAULT_STORAGE_WINDOWS, MAX_STORAGE_WINDOWS } from '../domain/inventory.js';

const APP_VERSION = '2.0.0';
const SOURCE_URL = 'https://github.com/nickyoo/NurtureBabyTracker';
const SOURCE_LABEL = 'github.com/nickyoo/NurtureBabyTracker';
const ML_PER_OZ = 29.5735;
const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_PRESS_MS = 450;
const SUCCESS_HOLD_MS = 400;

const PAGES = Object.freeze({
  baby: 'Baby',
  customize: 'Customize',
  feeding: 'Feeding',
  storage: 'Milk storage',
  data: 'Your data',
  privacy: 'Privacy',
  install: 'Home Screen',
  about: 'About',
});
const TAB_LABEL = Object.freeze({ today: 'Today', timeline: 'Timeline', stash: 'Stash', memories: 'Memories' });
const SCREEN_LABEL = Object.freeze({ settings: 'Settings', report: 'Report' });

/** Customize rows. `unit` = the Today card the row belongs to (null = none). */
const TRACKERS = Object.freeze([
  { key: 'bottle', unit: 'feed', cat: 'cat-feed', icon: 'bottle', title: 'Bottle feeds' },
  { key: 'breastfeeding', unit: 'feed', cat: 'cat-feed', icon: 'breast', title: 'Breastfeeding' },
  { key: 'sleep', unit: 'sleep', cat: 'cat-sleep', icon: 'moon', title: 'Sleep' },
  { key: 'diaper', unit: 'diaper', cat: 'cat-diaper', icon: 'diaper', title: 'Diapers' },
  { key: 'pump', unit: 'pump', cat: 'cat-pump', icon: 'pump', title: 'Pumping' },
  { key: 'stash', unit: 'stash', cat: 'cat-pump', icon: 'pouch', title: 'Milk stash' },
  { key: 'memories', unit: null, cat: 'cat-mem', icon: 'spark', title: 'Milestones & memories' },
]);
const CARD_KEYS = Object.freeze(['feed', 'sleep', 'diaper', 'pump', 'stash']);
const UNIT_TITLE = Object.freeze({ feed: 'Feeds', sleep: 'Sleep', diaper: 'Diapers', pump: 'Pumping', stash: 'Milk stash' });

/** Milk storage windows (settings.storageWindows), CDC defaults. */
const WINDOWS = Object.freeze([
  { key: 'roomTempHours', icon: 'clock', title: 'Room temperature', unit: ['hour', 'hours'], sub: 'Freshly pumped, up to 77 °F' },
  { key: 'fridgeDays', icon: 'fridge', title: 'Fridge', unit: ['day', 'days'], sub: 'Freshly pumped' },
  { key: 'freezerMonths', icon: 'snow', title: 'Freezer', unit: ['month', 'months'], sub: 'Best within this time' },
  { key: 'deepFreezerMonths', icon: 'snow', title: 'Deep freezer', unit: ['month', 'months'], sub: 'At 0 °F or colder' },
  { key: 'thawedBottleHours', icon: 'thaw', title: 'Thawed, in the fridge', unit: ['hour', 'hours'], sub: 'Don’t refreeze thawed milk' },
  { key: 'startedBottleHours', icon: 'bottle', title: 'Once a feed starts', unit: ['hour', 'hours'], sub: 'Breast milk. Formula is always 1 hour.' },
]);

// Runtime classes other modules put on our elements (sheet.js marks a
// sheet's origin): a repaint must never strip them.
const KEEP_CLASS = /^(is-sheet|is-under|st-rt-)/;

function lsKeys(prefix) {
  try {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  } catch { return []; }
}
function isStandalone() {
  try {
    return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch { return false; }
}
function isIOS() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
}
/** Requests this page made to any other origin since it loaded (DESIGN §12: live proof). */
function foreignRequests() {
  try {
    return performance.getEntriesByType('resource').filter((e) => {
      try {
        const u = new URL(e.name, location.href);
        return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
      } catch { return false; }
    }).length;
  } catch { return 0; }
}
function bytesText(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '')} GB`;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wordFor = (n, [one, many]) => `${n} ${Number(n) === 1 ? one : many}`;

export default {
  id: 'settings',
  title: 'Settings',
  /**
   * @param {HTMLElement} root the screen's scrolling <section>
   * @param {object} ctx app ctx (ARCHITECTURE §5.2)
   * @param {{ page?: string, babyId?: string, new?: boolean }} [params]
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx, params = {}) {
    const { html, render, fragment } = ctx.html;
    const F = ctx.format;
    const S = ctx.settings;
    const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
    const page = Object.prototype.hasOwnProperty.call(PAGES, params.page) ? params.page : 'root';
    const isNewBaby = page === 'baby' && params.new === true;
    const pid = `st${Math.random().toString(36).slice(2, 8)}`;

    // Back label: whatever this screen sits on (read from the DOM each paint,
    // so it stays right when the router swaps a hidden tab for Today below).
    const belowLabel = () => {
      let el = root.previousElementSibling;
      while (el && (el.classList.contains('is-fading-out') || el.classList.contains('is-leaving-right'))) el = el.previousElementSibling;
      const id = el && el.getAttribute('data-view');
      if (!id) return 'Back';
      return SCREEN_LABEL[id] || TAB_LABEL[id] || 'Back';
    };

    // ---------------------------------------------------------- state
    let stopped = false;
    let painted = false;
    let est = null;               // persist.estimate()
    let lastPumpAt;               // undefined = not looked up yet; null = no pump on record
    let safetyInfo = null;        // the copy kept by the last Replace import (DI-01)
    let photoUse = null;          // photos.usage()
    const urls = new Map();       // photoId → object URL (or null while loading)
    const drafts = {};            // stepper name → pending display value
    const commitTimers = {};
    let moving = null;            // Customize: unit key with the move buttons open
    let announce = '';            // Customize: polite live-region text
    let includePhotos = true;     // Data: backup with photos
    let busyAction = null;        // the async action in flight (one at a time)
    const draftBaby = { name: '', birthDate: '', photoId: null, error: '' };
    let savedNew = false;
    let pendingEnter = [];        // keyed rows added while this screen was covered

    const trackers = () => S.get('trackers') || {};
    const unit = () => (S.get('units') === 'mL' ? 'mL' : 'oz');
    const babies = () => S.babies();
    const activeId = () => S.get('activeBabyId');
    const babyById = (id) => babies().find((b) => b.id === id) || null;
    const pageBaby = () => (page === 'baby' && !isNewBaby ? babyById(params.babyId || activeId()) : null);

    function goalText(oz, u = unit()) {
      return u === 'mL' ? `${Math.round((oz * ML_PER_OZ) / 10) * 10} mL` : F.amount(oz, 'oz');
    }
    function intervalText(min) { return F.span(min * 60000); }

    /** { value: 'Today' | '3 days ago' | 'Wed, Oct 2', phrase: 'today' | '3 days ago' | 'on Wed, Oct 2' } or null. */
    function lastBackup() {
      const ts = S.get('lastBackupAt');
      if (!Number.isFinite(ts)) return null;
      const days = Math.round((ctx.time.startOfDay(Date.now()) - ctx.time.startOfDay(ts)) / DAY_MS);
      if (days <= 0) return { value: 'Today', phrase: 'today' };
      if (days === 1) return { value: 'Yesterday', phrase: 'yesterday' };
      if (days < 14) return { value: `${days} days ago`, phrase: `${days} days ago` };
      if (days < 60) { const w = `${Math.floor(days / 7)} weeks ago`; return { value: w, phrase: w }; }
      const d = F.dateLabel(ts);
      return { value: d, phrase: `on ${d}` };
    }

    // ------------------------------------------------------ snippets

    const navbar = (title) => html`<div class="navbar">
        <button type="button" class="back" data-action="back">${I('chev-l', 24)}${belowLabel()}</button>
        <h1 class="navbar-title">${title}</h1><span></span>
      </div>`;

    const chev = html`<span class="chev">${I('chev-r', 20)}</span>`;

    const navRow = ({ key, action = 'go', arg = '', icon, cat = 'cat-neutral', title, sub, trail = chev }) => html`
      <li data-key="${key}"><button type="button" class="set-row" data-action="${action}" data-arg="${arg}">
        <span class="chip-ic ${cat}">${I(icon)}</span>
        <span class="set-text"><b>${title}</b>${sub ? html`<small>${sub}</small>` : ''}</span>
        ${trail}
      </button></li>`;

    const switchRow = ({ key, action, arg = '', icon, cat = 'cat-neutral', title, sub, on }) => html`
      <li data-key="${key}"><button type="button" class="set-row" role="switch" aria-checked="${on ? 'true' : 'false'}" data-action="${action}" data-arg="${arg}">
        <span class="chip-ic ${cat}">${I(icon)}</span>
        <span class="set-text"><b>${title}</b>${sub ? html`<small>${sub}</small>` : ''}</span>
        <span class="toggle" aria-hidden="true" aria-checked="${on ? 'true' : 'false'}"></span>
      </button></li>`;

    const infoRow = ({ key, icon, cat = 'cat-neutral', title, sub, value }) => html`
      <li data-key="${key}"><div class="set-row">
        <span class="chip-ic ${cat}">${I(icon)}</span>
        <span class="set-text"><b>${title}</b>${sub ? html`<small>${sub}</small>` : ''}</span>
        ${value ? html`<span class="set-value">${value}</span>` : ''}
      </div></li>`;

    const seg = (name, labelId, opts, value, extra = '') => html`
      <div class="segmented ${extra}" role="radiogroup" aria-labelledby="${labelId}" data-seg="${name}">
        ${opts.map((o) => html`<button type="button" role="radio" aria-checked="${o.v === value ? 'true' : 'false'}" tabindex="${o.v === value ? '0' : '-1'}" data-v="${o.v}">${o.l}</button>`)}
      </div>`;

    const segRow = ({ key, icon, title, sub, name, opts, value, extra = '' }) => html`
      <li data-key="${key}"><div class="set-row st-stack">
        <span class="chip-ic cat-neutral">${I(icon)}</span>
        <span class="set-text"><b id="${pid}-${name}">${title}</b>${sub ? html`<small>${sub}</small>` : ''}</span>
        ${seg(name, `${pid}-${name}`, opts, value, `st-seg ${extra}`)}
      </div></li>`;

    // Stepper: − value + (value is a spinbutton; arrows adjust).
    const stepRow = ({ key, icon, cat = 'cat-neutral', title, sub, name }) => {
      const s = stepInfo(name);
      return html`<li data-key="${key}"><div class="set-row st-step-row">
        <span class="chip-ic ${cat}">${I(icon)}</span>
        <span class="set-text"><b id="${pid}-${name.replace(/\W/g, '')}">${title}</b>${sub ? html`<small>${sub}</small>` : ''}</span>
        <span class="st-stepper">
          <button type="button" class="st-step" data-step="${name}" data-dir="-1" aria-label="${`Less: ${title}`}" aria-disabled="${s.value <= s.min ? 'true' : 'false'}">${I('minus', 20)}</button>
          <span class="st-step-val" role="spinbutton" tabindex="0" data-spin="${name}" aria-labelledby="${pid}-${name.replace(/\W/g, '')}"
            aria-valuenow="${s.value}" aria-valuemin="${s.min}" aria-valuemax="${s.max}" aria-valuetext="${s.spoken}">${s.text}</span>
          <button type="button" class="st-step" data-step="${name}" data-dir="1" aria-label="${`More: ${title}`}" aria-disabled="${s.value >= s.max ? 'true' : 'false'}">${I('plus', 20)}</button>
        </span>
      </div></li>`;
    };

    const avatar = (b, size = 'sm') => {
      const url = b && b.photoId ? urls.get(b.photoId) : null;
      const initial = F.babyName(b, '').slice(0, 1).toUpperCase();
      return url
        ? html`<img class="st-av st-av-${size}" src="${url}" alt="">`
        : html`<span class="st-av st-av-${size} st-av-empty" aria-hidden="true">${initial || I('baby', size === 'sm' ? 20 : 34)}</span>`;
    };

    const emptyState = ({ icon, cat = 'cat-neutral', title, text, action, arg = '', label }) => html`
      <div class="empty-state ${cat}" data-key="empty">
        <span class="empty-disc">${I(icon, 30)}</span>
        <h2 class="empty-title">${title}</h2>
        <p class="empty-text">${text}</p>
        ${label ? html`<button type="button" class="btn btn-primary" data-action="${action}" data-arg="${arg}">${label}</button>` : ''}
      </div>`;

    // FLOW-06: no recipient → no mailto (it would open a blank, address-less
    // compose). The owner fills feedbackEmail; until then the row says so.
    const feedbackTo = () => S.get('feedbackEmail') || '';
    const feedbackHref = () => `mailto:${feedbackTo()}?subject=${encodeURIComponent('Nurture feedback')}`;
    const feedbackRow = () => (feedbackTo()
      ? html`<li data-key="feedback"><a class="set-row" href="${feedbackHref()}">
            <span class="chip-ic cat-neutral">${I('edit')}</span>
            <span class="set-text"><b>Send feedback</b><small>Opens your email. Nothing is attached.</small></span>
            ${chev}
          </a></li>`
      : infoRow({ key: 'feedback', icon: 'edit', title: 'Send feedback', sub: 'Feedback email not set up yet' }));

    function proofText() {
      const n = foreignRequests();
      const size = est && Number.isFinite(est.usage) ? bytesText(est.usage) : '';
      return { n, words: `${n} network ${n === 1 ? 'request' : 'requests'}`, size };
    }
    const proof = () => {
      const p = proofText();
      return html`<span class="proof">${I('check', 14)}${p.words}</span>${p.size ? ` · ${p.size}` : ''}`;
    };

    // ------------------------------------------------------ steppers

    function stepInfo(name) {
      const u = unit();
      if (name === 'goal') {
        const oz = S.get('pumpGoalOz');
        if (u === 'mL') {
          const v = drafts.goal ?? Math.round((oz * ML_PER_OZ) / 10) * 10;
          return { value: v, min: 30, max: 5910, text: `${v} mL`, spoken: `${v} milliliters a day` };
        }
        const v = drafts.goal ?? oz;
        return { value: v, min: 1, max: 200, text: F.amount(v, 'oz'), spoken: `${v} ${v === 1 ? 'ounce' : 'ounces'} a day` };
      }
      if (name === 'interval') {
        const v = drafts.interval ?? S.get('pumpIntervalMinutes');
        return { value: v, min: 30, max: 720, text: intervalText(v), spoken: `every ${F.spanSpoken(v * 60000)}` };
      }
      const key = name.slice(4);
      const w = WINDOWS.find((x) => x.key === key);
      const sw = S.get('storageWindows') || DEFAULT_STORAGE_WINDOWS;
      const v = drafts[name] ?? sw[key];
      return { value: v, min: 1, max: MAX_STORAGE_WINDOWS[key], text: wordFor(v, w.unit), spoken: wordFor(v, w.unit) };
    }

    function nextStep(name, value, dir) {
      if (name === 'goal' && unit() === 'mL') return dir > 0 ? Math.floor(value / 10) * 10 + 10 : Math.ceil(value / 10) * 10 - 10;
      if (name === 'goal') return dir > 0 ? Math.floor(value) + 1 : Math.ceil(value) - 1;
      if (name === 'interval') return dir > 0 ? Math.floor(value / 15) * 15 + 15 : Math.ceil(value / 15) * 15 - 15;
      return value + dir;
    }

    function setStep(name, value) {
      const s = stepInfo(name);
      const v = clamp(value, s.min, s.max);
      if (v === s.value) return false;
      drafts[name] = v;
      paint();
      clearTimeout(commitTimers[name]);
      commitTimers[name] = setTimeout(() => commitStep(name), 300);
      return true;
    }

    async function commitStep(name) {
      if (!(name in drafts)) return;
      const v = drafts[name];
      try {
        if (name === 'goal') {
          const oz = unit() === 'mL' ? Math.max(1, Math.round((v / ML_PER_OZ) * 10) / 10) : v;
          await S.set('pumpGoalOz', oz);
        } else if (name === 'interval') {
          await S.set('pumpIntervalMinutes', v);
        } else {
          await S.patch('storageWindows', { [name.slice(4)]: v });
        }
      } catch (err) {
        console.warn('settings: could not save', name, err);
        ctx.toast({ message: 'Couldn’t save that. Try again.', tone: 'warn' });
      }
      if (drafts[name] === v) delete drafts[name];
      if (!stopped) paint();
    }

    function flushSteps() {
      for (const name of Object.keys(commitTimers)) {
        clearTimeout(commitTimers[name]);
        if (name in drafts) commitStep(name);
      }
    }

    // ------------------------------------------------------ pages

    function rootPage() {
      const list = babies();
      const multi = list.length > 1;
      const t = trackers();
      const on = (k) => t[k] !== false;
      const shown = TRACKERS.filter((r) => on(r.key)).length;
      const theme = S.get('theme');
      const snd = S.get('sound');
      const reduce = ctx.motionReduced();
      const goal = goalText(S.get('pumpGoalOz'));
      const sw = S.get('storageWindows') || DEFAULT_STORAGE_WINDOWS;
      const last = lastBackup();
      const feedSub = on('pump')
        ? `Goal ${goal} a day · every ${intervalText(S.get('pumpIntervalMinutes'))}`
        : on('formula') ? 'Formula & breast milk' : 'Breast milk only';
      return html`
        ${navbar('Settings')}
        <p class="grp-lbl">${multi ? 'Babies' : 'Baby'}</p>
        <ul class="set-list st-babies">
          ${list.map((b) => {
            const age = b.birthDate ? F.babyAge(b.birthDate) : '';
            const born = b.birthDate ? `born ${F.dateLabel(ctx.time.parseLocalDate(b.birthDate))}` : '';
            const missing = [!b.name && 'name', !b.birthDate && 'birthday', !b.photoId && 'photo'].filter(Boolean);
            const ask = missing.length ? `Add a ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0]}` : '';
            const sub = [age, born].filter(Boolean).join(' · ') || ask || 'Details';
            return html`<li data-key="${`baby-${b.id}`}"><button type="button" class="set-row" data-action="baby" data-arg="${b.id}">
              ${avatar(b)}
              <span class="set-text"><b>${F.babyName(b, 'Your baby')}</b><small>${sub}</small></span>
              ${multi && b.id === activeId() ? html`<span class="badge badge-next">On Today</span>` : ''}
              ${chev}
            </button></li>`;
          })}
          ${list.length < 12 ? navRow({ key: 'add-baby', action: 'add-baby', icon: 'plus', cat: 'cat-accent', title: 'Add a baby', sub: 'Twins or a sibling' }) : ''}
        </ul>

        <p class="grp-lbl">Tracking</p>
        <ul class="set-list">
          ${navRow({ key: 'customize', action: 'customize', icon: 'timeline', title: 'Customize', sub: shown === TRACKERS.length ? 'What shows on Today and in +' : `${shown} of ${TRACKERS.length} trackers showing` })}
          ${on('bottle') || on('pump') ? navRow({ key: 'feeding', arg: 'feeding', icon: on('bottle') ? 'bottle' : 'pump', cat: on('bottle') ? 'cat-feed' : 'cat-pump', title: on('pump') ? 'Feeding & pumping' : 'Feeding', sub: on('bottle') ? feedSub : `Goal ${goal} a day · every ${intervalText(S.get('pumpIntervalMinutes'))}` }) : ''}
          ${on('stash') || on('pump') || on('bottle') ? navRow({ key: 'storage', arg: 'storage', icon: 'fridge', cat: 'cat-pump', title: 'Milk storage', sub: `Fridge ${wordFor(sw.fridgeDays, ['day', 'days'])} · freezer ${wordFor(sw.freezerMonths, ['month', 'months'])}` }) : ''}
          <li data-key="units"><div class="set-row">
            <span class="chip-ic cat-neutral">${I('pouch')}</span>
            <span class="set-text"><b id="${pid}-units">Units</b><small>${unit() === 'mL' ? 'Amounts in milliliters' : 'Amounts in ounces'}</small></span>
            ${seg('units', `${pid}-units`, [{ v: 'oz', l: 'oz' }, { v: 'mL', l: 'mL' }], unit(), 'st-seg st-seg-inline')}
          </div></li>
        </ul>

        <p class="grp-lbl">Comfort</p>
        <ul class="set-list">
          ${segRow({
            key: 'theme', icon: theme === 'dark' ? 'moon' : 'sun', title: 'Appearance', name: 'theme', value: theme,
            sub: theme === 'auto' ? 'Dims from 7 PM to 8 AM, or when your phone is dark' : theme === 'dark' ? 'Always dim' : 'Always light',
            opts: [{ v: 'auto', l: 'Auto' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Night' }],
          })}
          ${switchRow({ key: 'motion', action: 'motion', icon: 'motion', title: 'Reduce motion', sub: 'Fades instead of slides', on: reduce })}
          ${segRow({
            key: 'sound', icon: 'sound', title: 'Sound', name: 'sound', value: snd, extra: 'st-seg-sound',
            sub: snd === 'on' ? 'Soft chimes when you log' : snd === 'off' ? 'No sounds' : 'Soft chimes, silent 7 PM to 8 AM',
            opts: [{ v: 'on', l: 'On' }, { v: 'night-off', l: 'Quiet at night' }, { v: 'off', l: 'Off' }],
          })}
        </ul>

        <p class="grp-lbl">Your data</p>
        <ul class="set-list">
          ${navRow({ key: 'data', arg: 'data', icon: 'download', cat: 'cat-accent', title: 'Backup & data', sub: last ? `Last backup ${last.phrase}` : 'No backup yet · save one to Files' })}
          ${navRow({ key: 'report', action: 'report', icon: 'report', title: 'Report for the pediatrician', sub: 'Last 7 or 14 days, ready to print' })}
          ${navRow({ key: 'privacy', arg: 'privacy', icon: 'shield', cat: 'cat-accent', title: 'Privacy & your data', sub: proof() })}
          ${navRow({ key: 'install', arg: 'install', icon: 'phone', title: 'Add to Home Screen', sub: isStandalone() ? 'Done · your log is protected' : 'So iPhone never clears your log' })}
        </ul>

        <p class="grp-lbl">About</p>
        <ul class="set-list">
          ${navRow({ key: 'about', arg: 'about', icon: 'info', title: 'About Nurture', sub: `Version ${APP_VERSION} · free and open source` })}
          ${feedbackRow()}
        </ul>
        <p class="st-foot">Free. Private. Everything stays on this phone.</p>`;
    }

    // ---- Customize (Frame 7)

    function trackerOrder() {
      const order = S.get('todayOrder') || CARD_KEYS;
      const units = [...order.filter((k) => CARD_KEYS.includes(k))];
      for (const k of CARD_KEYS) if (!units.includes(k)) units.push(k);
      return [...units.flatMap((u) => TRACKERS.filter((r) => r.unit === u)), ...TRACKERS.filter((r) => r.unit === null)];
    }

    function trackerSub(r, on) {
      if (!on) return r.key === 'memories' ? 'Hidden · photos kept' : 'Hidden · data kept';
      switch (r.key) {
        case 'bottle': return trackers().formula === false ? 'Breast milk' : 'Formula & breast milk';
        case 'breastfeeding': return 'Left / right timer';
        case 'sleep': return 'Naps, nights, wake windows';
        case 'diaper': return 'Wet, dirty, both';
        case 'pump': return `Goal ${goalText(S.get('pumpGoalOz'))} a day`;
        case 'stash': return 'Fridge & freezer';
        default: return 'Firsts and photos';
      }
    }

    function customizePage() {
      const t = trackers();
      const rows = trackerOrder();
      const lastOf = {};
      rows.forEach((r) => { if (r.unit) lastOf[r.unit] = r.key; });
      return html`
        ${navbar('Customize')}
        <p class="intro">Choose what shows on Today and in +. Drag to reorder. Hidden trackers keep their data.</p>
        <p class="grp-lbl">Trackers</p>
        <ul class="set-list st-trackers" data-trackers>
          ${rows.map((r) => {
            const on = t[r.key] !== false;
            const row = html`<li data-key="${`t-${r.key}`}" ${r.unit ? html`data-unit="${r.unit}"` : ''}><div class="set-row" data-row="${r.key}">
              ${r.unit
                ? html`<button type="button" class="grip" data-grip="${r.unit}" aria-label="${r.unit === 'feed' ? 'Move feeds' : `Move ${r.title}`}" aria-describedby="${pid}-hint" aria-expanded="${moving === r.unit ? 'true' : 'false'}">${I('grip', 20)}</button>`
                : html`<span class="st-grip-space" aria-hidden="true"></span>`}
              <span class="chip-ic ${r.cat}">${I(r.icon)}</span>
              <label class="set-text" for="${`${pid}-tg-${r.key}`}" data-tap-toggle="${r.key}"><b>${r.title}</b><small>${trackerSub(r, on)}</small></label>
              <button type="button" class="toggle" id="${`${pid}-tg-${r.key}`}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${`Show ${r.title}`}" data-action="tracker" data-arg="${r.key}"></button>
            </div></li>`;
            if (moving && r.unit === moving && lastOf[r.unit] === r.key) {
              const units = unitOrder();
              const i = units.indexOf(moving);
              return html`${row}<li data-key="${`move-${moving}`}" class="st-move-li"><div class="st-move" role="group" aria-label="${`Move ${UNIT_TITLE[moving]}`}">
                <button type="button" class="btn btn-secondary btn-sm" data-action="move" data-arg="-1" aria-disabled="${i <= 0 ? 'true' : 'false'}">${I('chev-u', 20)}Up</button>
                <button type="button" class="btn btn-secondary btn-sm" data-action="move" data-arg="1" aria-disabled="${i >= units.length - 1 ? 'true' : 'false'}">${I('chev-d', 20)}Down</button>
                <button type="button" class="btn btn-ghost" data-action="move-done">Done</button>
              </div></li>`;
            }
            return row;
          })}
        </ul>
        <p class="sr-only" id="${pid}-hint">Drag to reorder, or use the arrow keys. Feeds move together.</p>
        <p class="sr-only" aria-live="polite">${announce}</p>
        <p class="grp-lbl">Comfort &amp; privacy</p>
        <ul class="set-list">
          ${switchRow({ key: 'motion', action: 'motion', icon: 'motion', title: 'Reduce motion', sub: 'Fades instead of slides', on: ctx.motionReduced() })}
          ${navRow({ key: 'privacy', arg: 'privacy', icon: 'shield', cat: 'cat-accent', title: 'Privacy & your data', sub: proof() })}
        </ul>`;
    }

    // ---- Feeding & pumping

    // FLOW-12: the schedule starts from the last pump only when there is one;
    // with none on record it starts one interval from now (core/ics.js).
    function calHelp() {
      const every = intervalText(drafts.interval ?? S.get('pumpIntervalMinutes'));
      return lastPumpAt === undefined || lastPumpAt === null
        ? `The next 7 days, every ${every}, starting ${every} from now.`
        : `The next 7 days, every ${every} from your last pump.`;
    }

    function feedingPage() {
      const t = trackers();
      const bottle = t.bottle !== false;
      const pump = t.pump !== false;
      if (!bottle && !pump) {
        return html`${navbar('Feeding')}${emptyState({ icon: 'bottle', cat: 'cat-feed', title: 'Bottles and pumping are hidden', text: 'Hidden trackers keep their data. Turn them back on in Customize.', action: 'go', arg: 'customize', label: 'Customize' })}`;
      }
      return html`
        ${navbar('Feeding')}
        ${bottle ? html`
          <p class="grp-lbl">Bottles</p>
          <ul class="set-list">
            ${switchRow({ key: 'formula', action: 'tracker', arg: 'formula', icon: 'bottle', cat: 'cat-feed', title: 'Formula', sub: t.formula === false ? 'Hidden · breast milk only' : 'Offer formula as a bottle choice', on: t.formula !== false })}
          </ul>` : ''}
        ${pump ? html`
          <p class="grp-lbl">Pumping</p>
          <ul class="set-list">
            ${stepRow({ key: 'goal', icon: 'pump', cat: 'cat-pump', title: 'Daily goal', sub: 'Shown on the Pumped card', name: 'goal' })}
            ${stepRow({ key: 'interval', icon: 'clock', title: 'Pump every', sub: 'For your Calendar schedule', name: 'interval' })}
          </ul>
          <div class="st-card cat-pump" data-key="cal">
            <p class="note">${I('bell', 16)}<span>Web apps can’t alert you while they’re closed. Add your pump schedule to Calendar instead: your phone reminds you, and nothing leaves it.</span></p>
            <button type="button" class="btn btn-secondary btn-block" data-action="calendar" ${busyAction === 'calendar' ? html`aria-busy="true"` : ''}>${I('calendar', 22)}Add pump schedule to Calendar</button>
            <p class="st-help" data-cal-help>${calHelp()}</p>
          </div>` : ''}`;
    }

    // ---- Milk storage

    function storagePage() {
      const t = trackers();
      if (t.stash === false && t.pump === false && t.bottle === false) {
        return html`${navbar('Milk storage')}${emptyState({ icon: 'pouch', cat: 'cat-pump', title: 'Milk tracking is hidden', text: 'Turn on bottles, pumping or the stash in Customize to use these times.', action: 'go', arg: 'customize', label: 'Customize' })}`;
      }
      const sw = S.get('storageWindows') || DEFAULT_STORAGE_WINDOWS;
      const changed = WINDOWS.some((w) => (drafts[`win:${w.key}`] ?? sw[w.key]) !== DEFAULT_STORAGE_WINDOWS[w.key]);
      return html`
        ${navbar('Milk storage')}
        <p class="intro">Set from CDC guidance for healthy, full-term babies. Change any of these if your pediatrician suggests different times.</p>
        <p class="grp-lbl">Breast milk keeps</p>
        <ul class="set-list">
          ${WINDOWS.map((w) => {
            const v = drafts[`win:${w.key}`] ?? sw[w.key];
            const def = DEFAULT_STORAGE_WINDOWS[w.key];
            return stepRow({ key: w.key, icon: w.icon, cat: 'cat-pump', title: w.title, sub: v === def ? w.sub : `CDC: ${wordFor(def, w.unit)}`, name: `win:${w.key}` });
          })}
        </ul>
        <div class="st-actions" data-key="reset">
          ${changed ? html`<button type="button" class="btn btn-ghost" data-action="reset-windows">${I('undo', 20)}Back to CDC guidance</button>` : ''}
        </div>
        <p class="note st-note">${I('info', 16)}<span>A guide, not medical advice. When in doubt, ask your pediatrician.</span></p>`;
    }

    // ---- Your data

    function dataPage() {
      const last = lastBackup();
      const persisted = est ? est.persisted : null;
      const granted = persisted === true || S.get('persistGranted') === true;
      const photos = photoUse && photoUse.count ? photoUse : null;
      return html`
        ${navbar('Your data')}
        <p class="grp-lbl">On this phone</p>
        <ul class="set-list">
          ${infoRow({ key: 'last', icon: 'download', title: 'Last backup', value: last ? last.value : 'Never', sub: last ? '' : 'Save one so nothing is lost' })}
          ${infoRow({ key: 'used', icon: 'phone', title: 'Storage used', value: est && Number.isFinite(est.usage) ? bytesText(est.usage) : '—', sub: photos ? `Photos ${bytesText(photos.bytes)}` : '' })}
          ${granted
            ? infoRow({ key: 'persist', icon: 'shield', cat: 'cat-accent', title: 'Kept safe', value: 'Yes', sub: 'This browser won’t clear it to save space' })
            : navRow({ key: 'persist', action: 'persist', icon: 'shield', cat: 'cat-accent', title: 'Keep it safe', sub: persisted === null && !est ? 'Checking…' : 'Ask this browser not to clear it' })}
        </ul>

        <p class="grp-lbl">Backup</p>
        ${photos ? html`<ul class="set-list st-gap">
            ${switchRow({ key: 'with-photos', action: 'with-photos', icon: 'photo', title: 'Include photos', sub: `${F.plural(photos.count, 'photo')} · ${bytesText(photos.bytes)}`, on: includePhotos })}
          </ul>` : ''}
        <div class="st-actions" data-key="backup-actions">
          <button type="button" class="btn btn-primary btn-block" data-action="backup" ${busyAction === 'backup' ? html`aria-busy="true"` : ''}>${I('share', 22)}Save a backup</button>
          <p class="st-help">One file you can keep in Files or iCloud Drive. Open it on a partner’s phone to merge your logs.</p>
          <button type="button" class="btn btn-secondary btn-block" data-action="csv" ${busyAction === 'csv' ? html`aria-busy="true"` : ''}>${I('download', 22)}Export CSV</button>
          <p class="st-help">${`A spreadsheet of every entry, in ${unit() === 'mL' ? 'milliliters' : 'ounces'}.`}</p>
          <label class="btn btn-secondary btn-block st-file" data-key="import">
            <input type="file" class="sr-only" accept=".json,application/json" data-import>
            ${I('upload', 22)}<span>Import a backup</span>
          </label>
          <p class="st-help">Merge a partner’s backup into this phone, or restore everything from a file.</p>
        </div>
        ${safetyInfo ? html`<ul class="set-list st-gap">
            ${navRow({ key: 'undo-replace', action: 'undo-replace', icon: 'upload', cat: 'cat-accent', title: 'Put back what was here before', sub: `Kept from before the import · ${F.dayLabel(safetyInfo.createdAt)}` })}
          </ul>` : ''}

        <p class="grp-lbl">Start over</p>
        <div class="st-actions" data-key="erase">
          <button type="button" class="btn btn-danger-soft btn-block" data-action="erase">${I('trash', 22)}Erase everything</button>
          <p class="st-help">Deletes every entry, photo and setting on this phone. Save a backup first if you might want it.</p>
        </div>`;
    }

    // ---- Privacy & your data

    function privacyPage() {
      const p = proofText();
      return html`
        ${navbar('Privacy')}
        <div class="st-prose">
          <p class="st-proof-line"><span class="badge badge-ok">${I('check', 14)}${p.words}</span>${p.size ? html`<span class="st-proof-size">${`${p.size} on this phone`}</span>` : ''}</p>
          <h2 class="st-hero">Everything stays on this phone.</h2>
          <h3>What Nurture keeps</h3>
          <p>Your baby’s name, birthday and photo; every feed, sleep, diaper, pump and pouch you log; your memories and their photos; and your settings.</p>
          <h3>Where it lives</h3>
          <p>Only here, in this browser’s storage on this phone. There’s no account, no server and no cloud copy. Nobody else can see it, including the people who made Nurture.</p>
          <h3>No network requests</h3>
          <p>This app makes no network requests after it loads. No ads, no analytics, no tracking. The fonts and icons are built in. The count at the top is live: it shows every request this page has made to anywhere else since it opened.</p>
          <h3>Take it with you, or erase it</h3>
          <p>Save a backup or export a spreadsheet whenever you like. You can also erase everything on this phone. That can’t be undone, so save a backup first if you might want it.</p>
          <button type="button" class="btn btn-outline" data-action="go" data-arg="data">${I('download', 20)}Backup, export or erase</button>
          <h3>Check for yourself</h3>
          <p>Nurture is open source, so anyone can read exactly what it does.</p>
          <a class="btn btn-outline" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">${I('info', 20)}View the source code</a>
          ${feedbackTo() ? html`<h3>Send feedback</h3>
          <p>Feedback opens your email app with only the subject filled in. Nothing from your log is attached, only what you type.</p>
          <a class="btn btn-outline" href="${feedbackHref()}">${I('edit', 20)}Send feedback</a>` : ''}
        </div>`;
    }

    // ---- Add to Home Screen

    function installPage() {
      const ios = isIOS();
      const b = S.activeBaby();
      const name = F.babyName(b, 'your baby');
      const iphone = html`
        <section class="st-guide" data-key="ios">
          <p class="grp-lbl">iPhone or iPad · Safari</p>
          <ol class="st-steps">
            <li><span class="st-num">1</span><span>Tap the Share button ${I('share', 18)} in Safari’s toolbar.</span></li>
            <li><span class="st-num">2</span><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>
            <li><span class="st-num">3</span><span>Tap <b>Add</b>, then open Nurture from your Home Screen.</span></li>
          </ol>
          <p class="note">${I('info', 16)}<span>On iPhone the Home Screen app keeps its own storage. If you’ve already logged in Safari, save a backup first, then import it in the Home Screen app.</span></p>
        </section>`;
      const android = html`
        <section class="st-guide" data-key="android">
          <p class="grp-lbl">Android · Chrome</p>
          <ol class="st-steps">
            <li><span class="st-num">1</span><span>Tap the menu ${I('more', 18)} at the top right.</span></li>
            <li><span class="st-num">2</span><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>
            <li><span class="st-num">3</span><span>Tap <b>Install</b>.</span></li>
          </ol>
        </section>`;
      return html`
        ${navbar('Home Screen')}
        ${isStandalone()
          ? html`<div class="st-card is-ok" data-key="done"><p class="st-card-title">${I('check', 20)}Nurture is on your Home Screen</p><p class="st-help">Your log is protected from the browser’s storage clean-up.</p></div>`
          : html`<p class="intro">${`Safari can clear a website’s storage when it hasn’t been opened for a week. Added to your Home Screen, Nurture is kept safe, so iPhone never clears ${F.possessive(name) || 'your'} log. It opens full screen, like an app.`}</p>`}
        ${b && b.photoId && ios ? html`<p class="note st-note">${I('photo', 16)}<span>${`${F.possessive(F.babyName(b))} photo will be the icon on iPhone.`}</span></p>` : ''}
        ${ios ? html`${iphone}${android}` : html`${android}${iphone}`}
        <div class="st-actions" data-key="install-backup">
          <button type="button" class="btn btn-outline" data-action="go" data-arg="data">${I('download', 20)}Save a backup first</button>
        </div>`;
    }

    // ---- About

    function aboutPage() {
      return html`
        ${navbar('About')}
        <div class="st-about" data-key="hero">
          <p class="wordmark">Nurture</p>
          <p class="st-version">${`Version ${APP_VERSION}`}</p>
          <p class="st-tagline">Free. Private. Everything stays on this phone.</p>
        </div>
        <p class="grp-lbl">Open source</p>
        <ul class="set-list">
          <li data-key="source"><a class="set-row" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">
            <span class="chip-ic cat-neutral">${I('info')}</span>
            <span class="set-text"><b>Source code</b><small>${SOURCE_LABEL}</small></span>${chev}
          </a></li>
          ${feedbackRow()}
        </ul>
        <p class="grp-lbl">Licenses</p>
        <ul class="set-list">
          ${infoRow({ key: 'lic-app', icon: 'book', title: 'Nurture', sub: 'MIT License' })}
          <li data-key="lic-nunito"><a class="set-row" href="fonts/OFL-Nunito.txt" target="_blank" rel="noopener">
            <span class="chip-ic cat-neutral">${I('book')}</span>
            <span class="set-text"><b>Nunito font</b><small>SIL Open Font License 1.1 · The Nunito Project Authors</small></span>${chev}
          </a></li>
          <li data-key="lic-fraunces"><a class="set-row" href="fonts/OFL-Fraunces.txt" target="_blank" rel="noopener">
            <span class="chip-ic cat-neutral">${I('book')}</span>
            <span class="set-text"><b>Fraunces font</b><small>SIL Open Font License 1.1 · The Fraunces Project Authors</small></span>${chev}
          </a></li>
        </ul>
        <p class="note st-note">${I('info', 16)}<span>Milk storage times follow CDC guidance. Nurture is a log, not medical advice.</span></p>`;
    }

    // ---- Baby (edit or add)

    function babyPage() {
      const b = isNewBaby ? null : pageBaby();
      if (!isNewBaby && !b) {
        return html`${navbar('Baby')}${emptyState({ icon: 'baby', title: 'This baby isn’t here anymore', text: 'Their details may have changed on another screen or from a backup.', action: 'back', label: 'Back to Settings' })}`;
      }
      const fields = isNewBaby ? draftBaby : { name: b.name, birthDate: b.birthDate || '', photoId: b.photoId };
      const shown = isNewBaby ? { ...draftBaby, id: null } : b;
      const name = F.babyName(shown, '');
      const hasPhoto = !!fields.photoId;
      const multi = babies().length > 1;
      const age = fields.birthDate ? F.babyAge(fields.birthDate) : '';
      const today = ctx.time.dayKey(Date.now());
      const photoBusy = busyAction === 'photo';
      const iconIsThis = !isNewBaby && hasPhoto && (S.get('iconBabyId') === b.id || babies().length === 1);
      return html`
        ${navbar(isNewBaby ? 'Add a baby' : (name || 'Baby'))}
        <div class="st-baby">
          <label class="st-photo ${hasPhoto ? 'has-photo' : ''}" ${photoBusy ? html`aria-busy="true"` : ''}>
            <input type="file" class="sr-only" accept="image/*" data-photo>
            ${hasPhoto ? avatar(shown, 'lg') : html`<span class="st-photo-empty" aria-hidden="true">${I('camera', 30)}</span>`}
            <span class="st-photo-label">${hasPhoto ? 'Change photo' : 'Add photo'}</span>
            <span class="st-photo-badge" aria-hidden="true">${I(hasPhoto ? 'edit' : 'plus', 16)}</span>
          </label>
          <div class="st-fields">
            <label class="field ${draftBaby.error && isNewBaby ? 'is-error' : ''}">
              <span class="field-label">Baby’s name</span>
              <input class="field-input" type="text" name="name" autocomplete="off" autocapitalize="words" enterkeyhint="done" maxlength="100" placeholder="Name" value="${fields.name || ''}" data-field="name">
            </label>
            ${draftBaby.error && isNewBaby ? html`<p class="field-error">${I('info', 16)}${draftBaby.error}</p>` : ''}
            <label class="field">
              <span class="field-label">Born</span>
              <input class="field-input" type="date" name="born" max="${today}" value="${fields.birthDate || ''}" data-field="born">
            </label>
            ${age ? html`<p class="st-age">${age}</p>` : ''}
          </div>
        </div>
        ${hasPhoto && !isNewBaby ? html`<div class="st-actions st-actions-row" data-key="photo-actions">
            <button type="button" class="btn btn-ghost" data-action="remove-photo">${I('trash', 20)}Remove photo</button>
          </div>` : ''}
        <p class="note st-note" data-key="photo-note">${I(iconIsThis ? 'phone' : 'lock', 16)}<span>${iconIsThis
          ? `${name ? `${F.possessive(name)} photo` : 'This photo'} is now the app icon on this phone. On iPhone, remove and re-add Nurture to your Home Screen to update the icon.`
          : `${name ? `${F.possessive(name)} photo and name` : 'Photos and names'} never leave this phone. On iPhone, the photo can become the app icon.`}</span></p>
        ${!isNewBaby && multi ? html`<div class="st-actions" data-key="switch">
            ${b.id === activeId()
              ? html`<p class="st-on-today"><span class="badge badge-next">${I('check', 14)}On Today</span>${`Today, Timeline and the + are showing ${name || 'this baby'}.`}</p>`
              : html`<button type="button" class="btn btn-secondary btn-block" data-action="make-active">${I('home', 22)}${`Show ${name || 'this baby'} on Today`}</button>`}
          </div>` : ''}
        ${!isNewBaby && multi ? html`<div class="st-actions" data-key="remove-baby">
            <button type="button" class="btn btn-danger-soft btn-block" data-action="remove-baby" ${busyAction === 'remove-baby' ? html`aria-busy="true"` : ''}>${I('trash', 22)}${`Remove ${name || 'this baby'}`}</button>
            <p class="st-help">${`Deletes ${name ? `${F.possessive(name)}` : 'this baby’s'} entries and photos from this phone. A safety backup is saved first.`}</p>
          </div>` : ''}
        ${isNewBaby ? html`<div class="st-actions" data-key="add">
            <button type="button" class="btn btn-primary btn-block" data-action="save-baby" ${busyAction === 'save-baby' ? html`aria-busy="true"` : ''}>${I('plus', 22)}Add baby</button>
            <p class="st-help">Once there are two, tap the name at the top of Today to switch.</p>
          </div>` : ''}`;
    }

    const PAGE_FN = {
      root: rootPage, customize: customizePage, feeding: feedingPage, storage: storagePage, data: dataPage,
      privacy: privacyPage, install: installPage, about: aboutPage, baby: babyPage,
    };

    // ------------------------------------------------------ morph

    function sameNode(a, b) {
      if (a.nodeType !== b.nodeType) return false;
      if (a.nodeType !== 1) return true;
      return a.tagName === b.tagName && (a.getAttribute('data-key') || '') === (b.getAttribute('data-key') || '')
        && (a.getAttribute('type') || '') === (b.getAttribute('type') || '');
    }

    function morphAttrs(o, n) {
      for (const { name, value } of [...n.attributes]) {
        if (name === 'class') {
          const keep = [...o.classList].filter((c) => KEEP_CLASS.test(c));
          const next = [...new Set([...value.split(/\s+/).filter(Boolean), ...keep])].join(' ');
          if (o.getAttribute('class') !== next) o.setAttribute('class', next);
        } else if (o.getAttribute(name) !== value) {
          o.setAttribute(name, value);
        }
      }
      for (const { name } of [...o.attributes]) {
        if (name === 'style') continue; // CSSOM-set custom properties (drag)
        if (name === 'class') {
          if (!n.hasAttribute('class')) {
            const keep = [...o.classList].filter((c) => KEEP_CLASS.test(c));
            if (keep.length) o.setAttribute('class', keep.join(' ')); else o.removeAttribute('class');
          }
          continue;
        }
        if (!n.hasAttribute(name)) o.removeAttribute(name);
      }
      if (o.tagName === 'INPUT' && o.type !== 'file' && o !== document.activeElement) {
        const v = n.getAttribute('value') || '';
        if (o.value !== v) o.value = v;
      }
    }

    function morphNode(o, n) {
      if (o.nodeType !== 1) {
        if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
        return;
      }
      morphAttrs(o, n);
      morphChildren(o, n);
    }

    function enter(el) {
      if (!painted) return;
      if (root.inert || root.classList.contains('is-covered')) { pendingEnter.push(el); return; }
      if (ctx.motionReduced()) { el.classList.add('st-rt-wash'); setTimeout(() => el.classList.remove('st-rt-wash'), 700); return; }
      el.classList.add('st-rt-enter');
      setTimeout(() => el.classList.remove('st-rt-enter'), 1400);
    }

    function leave(el) {
      if (!painted || ctx.motionReduced() || root.inert) { el.remove(); return; }
      el.style.setProperty('--st-h', `${el.offsetHeight}px`);
      el.classList.add('st-rt-leave');
      el.getBoundingClientRect();
      el.classList.add('st-rt-leave-go');
      setTimeout(() => el.remove(), 260);
    }

    const isLeaving = (c) => c.nodeType === 1 && c.classList.contains('st-rt-leave');
    const keyOf = (c) => (c.nodeType === 1 ? c.getAttribute('data-key') : null);

    // Keyed children match by data-key wherever they are; unkeyed ones match
    // the next unused old node of the same kind. Existing nodes are only
    // moved when the order really changed, so focus rarely moves at all.
    function morphChildren(oldParent, newParent) {
      const olds = [...oldParent.childNodes].filter((c) => !isLeaving(c));
      const byKey = new Map();
      for (const c of olds) if (keyOf(c)) byKey.set(keyOf(c), c);
      const used = new Set();
      const result = [];
      let cursor = 0;
      for (const n of [...newParent.childNodes]) {
        const key = keyOf(n);
        let o = null;
        if (key) {
          o = byKey.get(key) || null;
          if (o && (used.has(o) || !sameNode(o, n))) o = null;
        } else {
          for (let j = cursor; j < olds.length; j++) {
            const c = olds[j];
            if (used.has(c) || keyOf(c)) continue;
            if (sameNode(c, n)) { o = c; cursor = j + 1; break; }
          }
        }
        if (o) { used.add(o); morphNode(o, n); result.push(o); } else { result.push(n); if (key) enter(n); }
      }
      for (const c of olds) {
        if (used.has(c)) continue;
        if (keyOf(c)) leave(c); else c.remove();
      }
      let prev = null;
      for (const node of result) {
        let at = prev ? prev.nextSibling : oldParent.firstChild;
        while (at && isLeaving(at)) at = at.nextSibling;
        if (node !== at) oldParent.insertBefore(node, at);
        prev = node;
      }
    }

    function paint() {
      if (stopped) return;
      const tpl = html`<div class="view-pad st st-page-${page}">${PAGE_FN[page]()}</div>`;
      if (!painted) {
        render(root, tpl);
        painted = true;
      } else {
        const had = document.activeElement;
        morphChildren(root, fragment(tpl));
        // A moved node loses focus in some browsers: put it back.
        if (had && had !== document.activeElement && had.isConnected && root.contains(had)) {
          try { had.focus({ preventScroll: true }); } catch { /* gone */ }
        }
      }
      loadPhotoUrls();
    }

    // ------------------------------------------------------ async data

    function loadPhotoUrls() {
      const ids = new Set(babies().map((b) => b.photoId).filter(Boolean));
      if (draftBaby.photoId) ids.add(draftBaby.photoId);
      for (const id of ids) {
        if (urls.has(id)) continue;
        urls.set(id, null);
        ctx.photos.get(id).then((url) => {
          if (stopped) return;
          urls.set(id, url);
          if (url) paint();
        }).catch((err) => console.warn('settings: photo unavailable', err));
      }
    }

    async function loadEstimate() {
      try {
        const [e, use] = await Promise.all([ctx.persist.estimate(), page === 'data' ? ctx.photos.usage() : Promise.resolve(null)]);
        if (stopped) return;
        est = e;
        if (use) photoUse = use;
        paint();
      } catch (err) { console.warn('settings: storage estimate unavailable', err); }
    }

    // ------------------------------------------------------ actions

    async function run(name, fn) {
      if (busyAction) return;
      busyAction = name;
      paint();
      try { await fn(); } finally {
        busyAction = null;
        if (!stopped) {
          paint();
          // A backup, import or new photo changes what's stored.
          if (page === 'data') loadEstimate();
        }
      }
    }

    const shareResult = (res, what) => {
      if (res === 'cancelled') return;
      ctx.toast({ message: res === 'share' ? `${what} shared` : `${what} saved to your downloads` });
    };

    function go(sub, extra = {}) { ctx.router.push('settings', { page: sub, ...extra }); }

    async function setTracker(key, btn) {
      const now = trackers()[key] !== false;
      if (btn) btn.setAttribute('aria-checked', now ? 'false' : 'true'); // knob slides now
      try { await S.patch('trackers', { [key]: !now }); } catch (err) {
        console.warn('settings: tracker not saved', err);
        ctx.toast({ message: 'Couldn’t save that. Try again.', tone: 'warn' });
        paint();
      }
    }

    async function toggleMotion(btn) {
      const next = !ctx.motionReduced();
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      const tg = btn.querySelector('.toggle');
      if (tg) tg.setAttribute('aria-checked', next ? 'true' : 'false');
      try { await S.set('reduceMotion', next); } catch (err) { console.warn('settings: motion not saved', err); paint(); }
    }

    async function pickSeg(name, value) {
      try {
        if (name === 'units') {
          if ('goal' in drafts) { clearTimeout(commitTimers.goal); await commitStep('goal'); }
          await S.set('units', value === 'mL' ? 'mL' : 'oz');
        }
        else if (name === 'theme') await S.set('theme', value);
        else if (name === 'sound') {
          await S.set('sound', value);
          if (value === 'on') sound.playChime('tick');
        }
      } catch (err) {
        console.warn('settings: not saved', name, err);
        ctx.toast({ message: 'Couldn’t save that. Try again.', tone: 'warn' });
      }
      paint();
    }

    function segSelect(btn, focus) {
      const group = btn.closest('[data-seg]');
      if (!group) return;
      for (const b of group.querySelectorAll('[role="radio"]')) {
        const on = b === btn;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
      if (focus) btn.focus();
      pickSeg(group.dataset.seg, btn.dataset.v);
    }

    async function saveBackup() {
      await run('backup', async () => {
        try {
          const res = await backup.shareBackup({ includePhotos: !!(photoUse && photoUse.count && includePhotos) });
          shareResult(res, 'Backup');
        } catch (err) {
          console.warn('settings: backup failed', err);
          ctx.toast({ message: 'Couldn’t make the backup. Try again.', tone: 'warn' });
        }
      });
    }

    async function exportCsv() {
      await run('csv', async () => {
        try { shareResult(await backup.shareCsv({ unit: unit() }), 'CSV'); } catch (err) {
          console.warn('settings: CSV failed', err);
          ctx.toast({ message: 'Couldn’t make the CSV. Try again.', tone: 'warn' });
        }
      });
    }

    async function addToCalendar() {
      await run('calendar', async () => {
        try {
          const res = await shareIcs({ intervalMinutes: drafts.interval ?? S.get('pumpIntervalMinutes') });
          if (res === 'share') ctx.toast({ message: 'Pump schedule ready for Calendar' });
          else if (res === 'download') ctx.toast({ message: 'Pump schedule saved. Open it to add it to Calendar.' });
        } catch (err) {
          console.warn('settings: calendar failed', err);
          ctx.toast({ message: 'Couldn’t make the schedule. Try again.', tone: 'warn' });
        }
      });
    }

    async function askPersist() {
      await run('persist', async () => {
        const ok = await ctx.persist.requestPersistence().catch(() => false);
        est = await ctx.persist.estimate().catch(() => est);
        if (ok) ctx.toast({ message: 'Done. This browser will keep your data.' });
        else ctx.toast({ message: 'This browser said not yet. Adding Nurture to your Home Screen protects it.' });
      });
    }

    function importSummary(res) {
      if (res.mode === 'replace') {
        // DI-01: only claim what is confirmed — the copy kept on this phone.
        return res.safetyKept ? 'Replaced with the backup. What was here is kept on this phone.' : 'Replaced with the backup';
      }
      const s = res.stats || {};
      const ev = (s.events ? s.events.added + s.events.updated : 0);
      const inv = (s.inventory ? s.inventory.added + s.inventory.updated : 0);
      const ph = (s.photos ? s.photos.added : 0);
      const parts = [];
      if (ev) parts.push(F.plural(ev, 'entry', 'entries'));
      if (inv) parts.push(F.plural(inv, 'pouch', 'pouches'));
      if (ph) parts.push(F.plural(ph, 'photo'));
      let msg = parts.length ? `Merged · ${parts.join(', ')} added` : 'Already up to date · nothing new in that file';
      // DI-04: a baby the merge added is named, never silent.
      const born = ((s.babies && s.babies.addedBabies) || []).map((b) => b.name).filter(Boolean);
      if (born.length) msg += ` · new baby: ${born.join(', ')}`;
      // DI-11: what couldn't be read is said, not hidden.
      const rej = s.rejected || {};
      const skipped = (rej.events || 0) + (rej.inventory || 0);
      if (skipped) msg += ` · ${F.plural(skipped, 'entry', 'entries')} skipped`;
      return msg;
    }

    async function undoReplace(origin) {
      const ok = await ctx.confirmSheet({
        title: 'Put back what was here before?',
        body: 'This phone goes back to how it was before the last Replace. The backup file you imported stays in your files.',
        confirmLabel: 'Put it back',
        cancelLabel: 'Keep it as it is',
        destructive: true,
        origin,
      });
      if (!ok) return;
      try {
        await backup.restoreSafetyCopy();
        safetyInfo = null;
        paint();
        ctx.toast({ message: 'Put back what was here before' });
      } catch (ex) {
        if (!(ex && ex.name === 'BackupError')) console.warn('settings: undo replace failed', ex);
        ctx.toast({ message: ex && ex.name === 'BackupError' ? ex.message : 'That didn’t work. Nothing was changed.', tone: 'warn' });
      }
    }

    async function loadSafetyInfo() {
      try {
        const c = await backup.getSafetyCopy();
        if (stopped) return;
        safetyInfo = c ? { createdAt: c.createdAt } : null;
        paint();
      } catch (err) { console.warn('settings: safety copy unavailable', err); }
    }

    function openImport(file, origin) {
      ctx.openSheet({
        title: 'Import this backup?',
        origin,
        className: 'sheet-st-import',
        render(body, api) {
          render(body, html`
            <p class="st-file-name">${I('upload', 18)}<span>${file.name}</span>${Number.isFinite(file.size) ? html`<small>${bytesText(file.size)}</small>` : ''}</p>
            <div class="st-choice">
              <p><b>Merge</b> adds what’s new from the file and keeps everything here. Use it for a partner’s backup.</p>
              <p><b>Replace</b> swaps what’s here for the file. A safety backup of this phone is saved first.</p>
            </div>
            <p class="field-error" data-error hidden></p>
            <div class="sheet-footer">
              <button type="button" class="btn btn-primary btn-block" data-choice="merge">${I('download', 22)}Merge into this phone</button>
              <button type="button" class="btn btn-secondary btn-block" data-choice="replace">Replace everything</button>
            </div>`);
          let err = body.querySelector('[data-error]');
          let working = false;
          let question = null; // "Is Clara Rose the same baby as Clara?" (DI-04)
          const ask = (q) => {
            api.setTitle(`Is ${q.incoming.name} the same baby as ${q.local.name}?`);
            render(body, html`
              <p class="st-choice">The backup’s baby is <b>${q.incoming.name}</b>. This phone has <b>${q.local.name}</b>.</p>
              <p class="field-error" data-error hidden></p>
              <div class="sheet-footer">
                <button type="button" class="btn btn-primary btn-block" data-choice="same">${`Same baby · merge into ${q.local.name}`}</button>
                <button type="button" class="btn btn-secondary btn-block" data-choice="new">${`Add ${q.incoming.name} as a new baby`}</button>
              </div>`);
            err = body.querySelector('[data-error]');
            const first = body.querySelector('[data-choice="same"]');
            if (first) first.focus();
          };
          const onClick = async (e) => {
            const b = e.target.closest('[data-choice]');
            if (!b || working) return;
            if (b.dataset.choice === 'replace') { api.close('replace'); return; }
            working = true;
            b.setAttribute('aria-busy', 'true');
            err.hidden = true;
            try {
              let babyMatches = null;
              if (b.dataset.choice === 'merge') {
                question = await backup.previewBabyQuestion(file);
                if (question) { working = false; ask(question); return; }
              } else if (question) {
                babyMatches = { [question.incoming.id]: b.dataset.choice === 'same' ? question.local.id : null };
              }
              const res = await backup.importBackup(file, { mode: 'merge', babyMatches });
              b.removeAttribute('aria-busy');
              b.classList.add('is-success');
              render(b, html`${I('check', 22)}Merged`);
              setTimeout(() => api.close({ done: res }), SUCCESS_HOLD_MS);
            } catch (ex) {
              working = false;
              b.removeAttribute('aria-busy');
              err.hidden = false;
              render(err, html`${I('info', 16)}${ex && ex.name === 'BackupError' ? ex.message : 'That file couldn’t be imported.'}`);
              if (!(ex && ex.name === 'BackupError')) console.warn('settings: import failed', ex);
            }
          };
          body.addEventListener('click', onClick);
          return () => body.removeEventListener('click', onClick);
        },
        onClose: async (result) => {
          if (result && result.done) { ctx.toast({ message: importSummary(result.done) }); return; }
          if (result !== 'replace') return;
          const target = origin && origin.isConnected ? origin : null;
          const ok = await ctx.confirmSheet({
            title: 'Replace everything on this phone?',
            body: 'First, Nurture keeps a safety backup of this phone, here and in your downloads, so you can undo this. Then the file’s log, stash and settings replace what’s here.',
            confirmLabel: 'Replace everything',
            cancelLabel: 'Keep what’s here',
            destructive: true,
            origin: target,
          });
          if (!ok) return;
          try {
            const res = await backup.importBackup(file, { mode: 'replace' });
            if (res.safetyKept) safetyInfo = { createdAt: Date.now() };
            ctx.toast({
              message: importSummary(res),
              action: res.safetyKept ? { label: 'Undo', run: () => backup.restoreSafetyCopy().then(() => { safetyInfo = null; if (!stopped) paint(); }) } : undefined,
            });
          } catch (ex) {
            if (!(ex && ex.name === 'BackupError')) console.warn('settings: replace failed', ex);
            ctx.toast({ message: ex && ex.name === 'BackupError' ? ex.message : 'That file couldn’t be imported. Nothing was changed.', tone: 'warn' });
          }
        },
      });
    }

    async function eraseEverything(origin) {
      const ok = await ctx.confirmSheet({
        title: 'Erase everything on this phone?',
        body: 'Every entry, photo and setting will be deleted. This can’t be undone.',
        confirmLabel: 'Erase everything',
        destructive: true,
        origin,
      });
      if (!ok) return;
      try {
        await backup.eraseAll();
        // Per-device conveniences (snoozes, hints) go too: a fresh start.
        for (const k of lsKeys('nurture.')) { try { localStorage.removeItem(k); } catch { /* blocked */ } }
        ctx.toast({ message: 'Everything on this phone was erased' });
      } catch (err) {
        console.warn('settings: erase failed', err);
        ctx.toast({ message: 'Couldn’t erase. Close other Nurture tabs and try again.', tone: 'warn' });
      }
    }

    // ---- baby + photo → app icon (§10)

    async function refreshIcon(babyId, photoId) {
      try {
        const list = babies();
        const iconFor = S.get('iconBabyId');
        const only = list.length === 1;
        if (photoId) {
          if (only || babyId === activeId() || iconFor === babyId || !S.get('iconDataUrl')) {
            const url = await ctx.photos.makeIconDataUrl(photoId, 180);
            await S.set('iconDataUrl', url);
            await S.set('iconBabyId', babyId);
          }
          return;
        }
        if (only || iconFor === babyId) {
          const other = list.find((b) => b.id !== babyId && b.photoId);
          if (other) {
            await S.set('iconDataUrl', await ctx.photos.makeIconDataUrl(other.photoId, 180));
            await S.set('iconBabyId', other.id);
          } else {
            await S.set('iconDataUrl', null);
            await S.set('iconBabyId', null);
          }
        }
      } catch (err) { console.warn('settings: app icon not updated', err); }
    }

    async function pickPhoto(file) {
      if (!file) return;
      await run('photo', async () => {
        let rec;
        try { rec = await ctx.photos.add(file); } catch (err) {
          ctx.toast({ message: err && err.name === 'PhotoDecodeError' ? 'That photo couldn’t be read. Try another one.' : ctx.format.saveError(err, 'Couldn’t save that photo. Try another one.'), tone: 'warn' });
          if (!(err && err.name === 'PhotoDecodeError')) console.warn('settings: photo not saved', err);
          return;
        }
        if (isNewBaby) {
          const old = draftBaby.photoId;
          draftBaby.photoId = rec.id;
          if (old) ctx.photos.remove(old).catch(() => {});
          return;
        }
        const b = pageBaby();
        if (!b) { ctx.photos.remove(rec.id).catch(() => {}); return; }
        const old = b.photoId;
        try {
          await S.updateBaby(b.id, { photoId: rec.id });
          await refreshIcon(b.id, rec.id);
          if (old && old !== rec.id) ctx.photos.remove(old).catch(() => {});
        } catch (err) {
          console.warn('settings: photo not linked', err);
          ctx.photos.remove(rec.id).catch(() => {});
          ctx.toast({ message: 'Couldn’t save that photo. Try again.', tone: 'warn' });
        }
      });
    }

    // FLOW-05: remove a baby (never the last one), behind a confirm sheet,
    // with a safety backup first (backup.removeBaby) and Undo.
    async function removeBabyFlow(origin) {
      const b = pageBaby();
      if (!b || babies().length < 2 || busyAction) return;
      const who = F.babyName(b, '') || 'this baby';
      let entries = 0;
      try { entries = (await ctx.events.query({ babyId: b.id })).filter((e) => e.babyId === b.id).length; } catch { /* count is only for the wording */ }
      const ok = await ctx.confirmSheet({
        title: `Remove ${who} and their entries?`,
        body: `${entries ? `${F.plural(entries, 'entry', 'entries')} and the photos only ${who} has` : `${who} and their photo`} will be deleted from this phone. A safety backup is saved first, so you can put it back from Backup & data.`,
        confirmLabel: `Remove ${who}`,
        cancelLabel: 'Keep',
        destructive: true,
        origin,
      });
      if (!ok) return;
      await run('remove-baby', async () => {
        try {
          const res = await backup.removeBaby(b.id);
          safetyInfo = { createdAt: Date.now() };
          if (!stopped) { try { ctx.router.back(); } catch { /* already gone */ } }
          ctx.toast({
            message: `${who === 'this baby' ? 'Baby' : who} removed`,
            action: res.safetyKept ? { label: 'Undo', run: () => backup.restoreSafetyCopy().then(() => { safetyInfo = null; }) } : undefined,
          });
        } catch (ex) {
          if (!(ex && ex.name === 'BackupError')) console.warn('settings: remove baby failed', ex);
          ctx.toast({ message: ex && ex.name === 'BackupError' ? ex.message : 'That didn’t work. Nothing was removed.', tone: 'warn' });
        }
      });
    }

    async function removePhoto() {
      const b = pageBaby();
      if (!b || !b.photoId) return;
      const old = b.photoId;
      const id = b.id;
      try {
        await S.updateBaby(id, { photoId: null });
        await refreshIcon(id, null);
      } catch (err) { console.warn('settings: photo not removed', err); return; }
      const h = ctx.toast({
        message: 'Photo removed',
        action: { label: 'Undo', run: async () => { await S.updateBaby(id, { photoId: old }); await refreshIcon(id, old); } },
      });
      h.done.then((why) => {
        if (why === 'action') return;
        const still = babies().some((x) => x.photoId === old);
        if (!still) ctx.photos.remove(old).catch(() => {});
      });
    }

    async function saveField(field, input) {
      if (isNewBaby) {
        if (field === 'name') { draftBaby.name = input.value; if (draftBaby.error && input.value.trim()) { draftBaby.error = ''; paint(); } }
        else draftBaby.birthDate = input.value;
        if (field === 'born') paint();
        return;
      }
      const b = pageBaby();
      if (!b) return;
      try {
        if (field === 'name') {
          const v = input.value.trim();
          if (v !== b.name) await S.updateBaby(b.id, { name: v });
        } else {
          const v = input.value || null;
          if (v !== b.birthDate) {
            if (v && v > ctx.time.dayKey(Date.now())) { input.value = b.birthDate || ''; ctx.toast({ message: 'Birthdays can’t be in the future', tone: 'warn' }); return; }
            await S.updateBaby(b.id, { birthDate: v });
          }
        }
      } catch (err) {
        console.warn('settings: baby not saved', err);
        ctx.toast({ message: 'Couldn’t save that. Check it and try again.', tone: 'warn' });
        paint();
      }
    }

    async function addBaby(btn) {
      const nameEl = root.querySelector('[data-field="name"]');
      const bornEl = root.querySelector('[data-field="born"]');
      draftBaby.name = nameEl ? nameEl.value : draftBaby.name;
      draftBaby.birthDate = bornEl ? bornEl.value : draftBaby.birthDate;
      if (!draftBaby.name.trim()) {
        draftBaby.error = 'Add a name so you can tell them apart.';
        paint();
        if (nameEl) nameEl.focus();
        return;
      }
      await run('save-baby', async () => {
        try {
          const bd = draftBaby.birthDate && draftBaby.birthDate <= ctx.time.dayKey(Date.now()) ? draftBaby.birthDate : null;
          const nb = await S.addBaby({ name: draftBaby.name.trim(), birthDate: bd, photoId: draftBaby.photoId });
          savedNew = true;
          if (draftBaby.photoId) await refreshIcon(nb.id, draftBaby.photoId);
          if (btn) { btn.classList.add('is-success'); render(btn, html`${I('check', 22)}Added`); }
          setTimeout(() => {
            if (stopped) return;
            ctx.router.back();
            ctx.toast({
              message: `${nb.name} added`,
              action: { label: 'Show on Today', doneMessage: `Showing ${nb.name}`, run: () => S.setActiveBaby(nb.id) },
            });
          }, SUCCESS_HOLD_MS);
        } catch (err) {
          console.warn('settings: baby not added', err);
          ctx.toast({ message: 'Couldn’t add the baby. Try again.', tone: 'warn' });
        }
      });
    }

    // ---- Customize: reorder (drag, long-press, keys, move buttons)

    const trackerList = () => root.querySelector('[data-trackers]');
    function unitOrder() {
      const ul = trackerList();
      if (!ul) return trackerOrder().map((r) => r.unit).filter((u, i, a) => u && a.indexOf(u) === i);
      const out = [];
      for (const li of ul.children) { const u = li.dataset.unit; if (u && !out.includes(u)) out.push(u); }
      return out;
    }
    function unitGroups() {
      const ul = trackerList();
      const map = new Map();
      for (const li of ul.children) {
        const u = li.dataset.unit;
        if (!u || li.classList.contains('st-rt-leave')) continue;
        if (!map.has(u)) map.set(u, []);
        map.get(u).push(li);
      }
      return [...map.entries()].map(([key, lis]) => ({ key, lis }));
    }
    async function saveOrder(order) {
      try { await S.set('todayOrder', order); } catch (err) {
        console.warn('settings: order not saved', err);
        ctx.toast({ message: 'Couldn’t save the order. Try again.', tone: 'warn' });
        paint();
      }
    }

    // Move DOM groups into `order` and slide every moved row from where it
    // was (FLIP), so nothing jumps.
    function applyOrder(order, { skip = null } = {}) {
      const ul = trackerList();
      const groups = unitGroups();
      const before = new Map();
      for (const g of groups) for (const li of g.lis) before.set(li, li.getBoundingClientRect().top);
      const anchor = [...ul.children].find((li) => !li.dataset.unit && !li.classList.contains('st-move-li')) || null;
      for (const key of order) {
        const g = groups.find((x) => x.key === key);
        if (g) for (const li of g.lis) ul.insertBefore(li, anchor);
      }
      ul.classList.add('st-rt-noanim');
      for (const g of groups) for (const li of g.lis) { li.style.removeProperty('--shift'); }
      if (ctx.motionReduced()) { ul.getBoundingClientRect(); ul.classList.remove('st-rt-noanim'); return; }
      for (const [li, top] of before) {
        if (skip && skip.includes(li)) continue;
        const d = top - li.getBoundingClientRect().top;
        if (Math.abs(d) < 1) continue;
        li.style.setProperty('--dy', `${d}px`);
        li.classList.add('st-rt-flip');
      }
      ul.getBoundingClientRect();
      ul.classList.remove('st-rt-noanim');
      requestAnimationFrame(() => {
        for (const li of ul.querySelectorAll('.st-rt-flip')) {
          li.classList.add('st-rt-settle');
          li.style.setProperty('--dy', '0px');
        }
        setTimeout(() => {
          for (const li of ul.querySelectorAll('.st-rt-flip')) { li.classList.remove('st-rt-flip', 'st-rt-settle'); li.style.removeProperty('--dy'); }
        }, 320);
      });
    }

    function moveUnit(key, dir) {
      const order = unitOrder();
      const i = order.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return false;
      [order[i], order[j]] = [order[j], order[i]];
      applyOrder(order);
      announce = `${UNIT_TITLE[key]} moved ${dir < 0 ? 'up' : 'down'}, ${j + 1} of ${order.length}`;
      saveOrder(order);
      paint();
      return true;
    }

    let drag = null;
    let pressTimer = 0;
    let suppressClick = false;

    function startDrag(unitKey, pointerId, clientY) {
      const ul = trackerList();
      if (!ul) return;
      if (moving) {
        moving = null;
        const bar = ul.querySelector('.st-move-li');
        if (bar) bar.remove();
      }
      const groups = unitGroups().map((g) => {
        const r1 = g.lis[0].getBoundingClientRect();
        const r2 = g.lis[g.lis.length - 1].getBoundingClientRect();
        return { ...g, top: r1.top, h: r2.bottom - r1.top };
      });
      const idx = groups.findIndex((g) => g.key === unitKey);
      if (idx < 0) return;
      drag = { unitKey, pointerId, startY: clientY, groups, idx, target: idx, dy: 0 };
      ul.classList.add('st-rt-reordering');
      for (const li of groups[idx].lis) {
        li.classList.add('st-rt-dragging');
        const row = li.querySelector('.set-row');
        if (row) row.classList.add('st-rt-lifted', 'is-dragging');
      }
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
      window.addEventListener('pointercancel', onDragCancel);
      window.addEventListener('touchmove', blockTouch, { passive: false });
      suppressClick = true;
    }

    function blockTouch(e) { if (drag) e.preventDefault(); }

    function onDragMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { groups, idx } = drag;
      const g = groups[idx];
      const minDy = groups[0].top - g.top;
      const last = groups[groups.length - 1];
      const maxDy = last.top + last.h - (g.top + g.h);
      const dy = clamp(e.clientY - drag.startY, minDy, maxDy);
      drag.dy = dy;
      for (const li of g.lis) li.style.setProperty('--dy', `${dy}px`);
      // The dragged unit's leading edge passing a neighbour's midpoint swaps them.
      const topEdge = g.top + dy;
      const bottomEdge = g.top + g.h + dy;
      let target = idx;
      for (let j = idx + 1; j < groups.length; j++) if (bottomEdge > groups[j].top + groups[j].h / 2) target = j;
      for (let j = idx - 1; j >= 0; j--) if (topEdge < groups[j].top + groups[j].h / 2) target = j;
      drag.target = target;
      groups.forEach((o, j) => {
        if (j === idx) return;
        const shift = idx < j && j <= target ? -g.h : target <= j && j < idx ? g.h : 0;
        for (const li of o.lis) li.style.setProperty('--shift', `${shift}px`);
      });
    }

    function endDrag(commit) {
      if (!drag) return;
      const d = drag;
      drag = null;
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      window.removeEventListener('pointercancel', onDragCancel);
      window.removeEventListener('touchmove', blockTouch);
      const ul = trackerList();
      const g = d.groups[d.idx];
      const finish = () => {
        for (const li of g.lis) {
          li.classList.remove('st-rt-dragging', 'st-rt-settle');
          li.style.removeProperty('--dy');
          const row = li.querySelector('.set-row');
          if (row) row.classList.remove('st-rt-lifted', 'is-dragging');
        }
        if (ul) ul.classList.remove('st-rt-reordering');
      };
      if (commit && d.target !== d.idx) {
        const order = d.groups.map((x) => x.key);
        const [k] = order.splice(d.idx, 1);
        order.splice(d.target, 0, k);
        const visual = g.lis.map((li) => li.getBoundingClientRect().top);
        applyOrder(order, { skip: g.lis });
        // The dragged rows settle from where the finger left them.
        g.lis.forEach((li, i) => {
          li.classList.add('st-rt-noanim-self');
          li.style.setProperty('--dy', '0px');
          const off = visual[i] - li.getBoundingClientRect().top;
          li.style.setProperty('--dy', `${off}px`);
        });
        ul.getBoundingClientRect();
        g.lis.forEach((li) => { li.classList.remove('st-rt-noanim-self'); li.classList.add('st-rt-settle'); li.style.setProperty('--dy', '0px'); });
        setTimeout(finish, 300);
        announce = `${UNIT_TITLE[d.unitKey]} moved to ${d.target + 1} of ${order.length}`;
        saveOrder(order);
        paint();
      } else {
        for (const o of d.groups) for (const li of o.lis) li.style.setProperty('--shift', '0px');
        for (const li of g.lis) { li.classList.add('st-rt-settle'); li.style.setProperty('--dy', '0px'); }
        setTimeout(() => { finish(); for (const o of d.groups) for (const li of o.lis) li.style.removeProperty('--shift'); }, 300);
      }
      setTimeout(() => { suppressClick = false; }, 50);
    }
    function onDragEnd(e) { if (drag && e.pointerId === drag.pointerId) endDrag(true); }
    function onDragCancel(e) { if (drag && e.pointerId === drag.pointerId) endDrag(false); }

    function onPointerDown(e) {
      if (page !== 'customize' || e.button > 0) return;
      const grip = e.target.closest('[data-grip]');
      if (grip && root.contains(grip)) {
        e.preventDefault();
        const startY = e.clientY;
        const id = e.pointerId;
        // A grip tap (no movement) opens the move buttons instead.
        const arm = (ev) => {
          if (ev.pointerId !== id) return;
          if (Math.abs(ev.clientY - startY) > 4) { cleanup(); startDrag(grip.dataset.grip, id, startY); onDragMove(ev); }
        };
        const up = (ev) => { if (ev.pointerId === id) cleanup(); };
        const cleanup = () => { window.removeEventListener('pointermove', arm); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
        window.addEventListener('pointermove', arm);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return;
      }
      // Long-press anywhere else on a reorderable row (DESIGN §15).
      const li = e.target.closest('[data-trackers] > li[data-unit]');
      if (!li || e.target.closest('.toggle')) return;
      const startY = e.clientY;
      const startX = e.clientX;
      const id = e.pointerId;
      clearTimeout(pressTimer);
      const cancel = (ev) => {
        if (ev && ev.pointerId !== id) return;
        if (ev && ev.type === 'pointermove' && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
        clearTimeout(pressTimer);
        window.removeEventListener('pointermove', cancel);
        window.removeEventListener('pointerup', cancel);
        window.removeEventListener('pointercancel', cancel);
      };
      window.addEventListener('pointermove', cancel);
      window.addEventListener('pointerup', cancel);
      window.addEventListener('pointercancel', cancel);
      pressTimer = setTimeout(() => {
        cancel();
        startDrag(li.dataset.unit, id, startY);
      }, LONG_PRESS_MS);
    }

    // ---- stepper hold-to-repeat (8/s)

    let repeat = null;
    function stopRepeat() { if (repeat) { clearTimeout(repeat.t); clearInterval(repeat.i); repeat = null; } }
    function onStepPointer(e) {
      const b = e.target.closest('[data-step]');
      if (!b || !root.contains(b) || e.button > 0) return;
      e.preventDefault();
      b.focus({ preventScroll: true });
      const name = b.dataset.step;
      const dir = Number(b.dataset.dir);
      const once = () => setStep(name, nextStep(name, stepInfo(name).value, dir));
      once();
      stopRepeat();
      repeat = { t: setTimeout(() => { repeat.i = setInterval(() => { if (!once()) stopRepeat(); }, 125); }, 400), i: 0 };
      const up = () => { stopRepeat(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }

    // ------------------------------------------------------ events

    const onClick = (e) => {
      if (suppressClick) { e.preventDefault(); return; }
      const t = e.target;
      const radio = t.closest('[data-seg] [role="radio"]');
      if (radio && root.contains(radio)) { segSelect(radio, false); return; }
      const step = t.closest('[data-step]');
      if (step && root.contains(step)) {
        // Pointer presses are handled on pointerdown (hold to repeat); this
        // is keyboard activation (Enter / Space).
        if (e.detail === 0 && step.getAttribute('aria-disabled') !== 'true') {
          const name = step.dataset.step;
          setStep(name, nextStep(name, stepInfo(name).value, Number(step.dataset.dir)));
        }
        return;
      }
      const grip = t.closest('[data-grip]');
      if (grip && root.contains(grip)) {
        moving = moving === grip.dataset.grip ? null : grip.dataset.grip;
        paint();
        if (moving) {
          const up = root.querySelector('[data-action="move"][data-arg="-1"]');
          const down = root.querySelector('[data-action="move"][data-arg="1"]');
          const f = up && up.getAttribute('aria-disabled') !== 'true' ? up : down;
          if (f) f.focus();
        }
        return;
      }
      // The row words are a <label for> the toggle: the browser forwards
      // their tap to the switch, which lands in the 'tracker' case below.
      const b = t.closest('[data-action]');
      if (!b || !root.contains(b) || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('aria-busy') === 'true') return;
      const arg = b.dataset.arg;
      switch (b.dataset.action) {
        case 'back': ctx.router.back(); break;
        case 'go': go(arg); break;
        case 'customize': go('customize'); break;
        case 'baby': go('baby', { babyId: arg }); break;
        case 'add-baby': go('baby', { new: true }); break;
        case 'report': ctx.router.push('report', { from: 'settings' }); break;
        case 'tracker': setTracker(arg, b.matches('.toggle') ? b : b.querySelector('.toggle') || b); break;
        case 'motion': toggleMotion(b); break;
        case 'with-photos': includePhotos = !includePhotos; paint(); break;
        case 'backup': saveBackup(); break;
        case 'csv': exportCsv(); break;
        case 'calendar': addToCalendar(); break;
        case 'persist': askPersist(); break;
        case 'erase': eraseEverything(b); break;
        case 'undo-replace': undoReplace(b); break;
        case 'reset-windows': resetWindows(); break;
        case 'remove-photo': removePhoto(); break;
        case 'remove-baby': removeBabyFlow(b); break;
        case 'make-active': { const pb = pageBaby(); if (pb) S.setActiveBaby(pb.id).catch((err) => console.warn('settings: switch failed', err)); break; }
        case 'save-baby': addBaby(b); break;
        case 'move': {
          if (!moving) break;
          moveUnit(moving, Number(arg));
          const again = root.querySelector(`[data-action="move"][data-arg="${arg}"]`);
          const other = root.querySelector(`[data-action="move"][data-arg="${-Number(arg)}"]`);
          if (again && again.getAttribute('aria-disabled') === 'true' && other) other.focus();
          break;
        }
        case 'move-done': {
          const key = moving;
          moving = null;
          paint();
          const g = root.querySelector(`[data-grip="${key}"]`);
          if (g) g.focus();
          break;
        }
        default: break;
      }
    };

    async function resetWindows() {
      const prev = S.get('storageWindows');
      for (const k of Object.keys(drafts)) if (k.startsWith('win:')) { delete drafts[k]; clearTimeout(commitTimers[k]); }
      try {
        await S.set('storageWindows', { ...DEFAULT_STORAGE_WINDOWS });
        ctx.toast({ message: 'Back to CDC guidance', action: { label: 'Undo', run: () => S.set('storageWindows', prev) } });
        const first = root.querySelector('[data-spin]');
        if (first) first.focus();
      } catch (err) { console.warn('settings: reset failed', err); }
    }

    const onKey = (e) => {
      const t = e.target;
      // Segmented: arrows move the selection.
      const radio = t.closest && t.closest('[data-seg] [role="radio"]');
      if (radio) {
        const list = [...radio.closest('[data-seg]').querySelectorAll('[role="radio"]')];
        const i = list.indexOf(radio);
        let j = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = list.length - 1;
        if (j !== null) { e.preventDefault(); segSelect(list[j], true); }
        return;
      }
      const spin = t.closest && t.closest('[data-spin]');
      if (spin) {
        const name = spin.dataset.spin;
        const s = stepInfo(name);
        let v = null;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') v = nextStep(name, s.value, 1);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') v = nextStep(name, s.value, -1);
        else if (e.key === 'Home') v = s.min;
        else if (e.key === 'End') v = s.max;
        if (v !== null) { e.preventDefault(); setStep(name, v); }
        return;
      }
      const grip = t.closest && t.closest('[data-grip]');
      if (grip && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveUnit(grip.dataset.grip, e.key === 'ArrowUp' ? -1 : 1);
        grip.focus();
        return;
      }
      if (moving && e.key === 'Escape' && t.closest && t.closest('.st-move')) {
        e.preventDefault();
        e.stopPropagation();
        const key = moving;
        moving = null;
        paint();
        const g = root.querySelector(`[data-grip="${key}"]`);
        if (g) g.focus();
        return;
      }
      if (t.matches && t.matches('[data-field="name"]') && e.key === 'Enter') {
        e.preventDefault();
        if (isNewBaby) addBaby(root.querySelector('[data-action="save-baby"]')); else t.blur();
      }
    };

    const onChange = (e) => {
      const t = e.target;
      if (t.matches('[data-import]')) {
        const file = t.files && t.files[0];
        const label = t.closest('label');
        t.value = '';
        if (file) openImport(file, label);
        return;
      }
      if (t.matches('[data-photo]')) {
        const file = t.files && t.files[0];
        t.value = '';
        pickPhoto(file);
        return;
      }
      if (t.matches('[data-field="name"]')) saveField('name', t);
      else if (t.matches('[data-field="born"]')) saveField('born', t);
    };
    const onInput = (e) => {
      if (isNewBaby && e.target.matches('[data-field="name"]')) {
        draftBaby.name = e.target.value;
        if (draftBaby.error && e.target.value.trim()) { draftBaby.error = ''; paint(); }
      }
    };
    const onPointer = (e) => { onStepPointer(e); onPointerDown(e); };

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('pointerdown', onPointer);
    // Registered up front (iOS decides at touchstart whether a touch can be
    // cancelled): stops the page scrolling while a tracker row is dragged.
    if (page === 'customize') root.addEventListener('touchmove', blockTouch, { passive: false });

    // ------------------------------------------------------ stores

    const offSettings = S.subscribe((c) => {
      if (stopped) return;
      paint();
      // An import (or another tab) replaced everything: re-measure storage.
      if (c && c.key === '*' && ['root', 'customize', 'data', 'privacy'].includes(page)) loadEstimate();
    });
    const offPhotos = ctx.photos.subscribe ? ctx.photos.subscribe((c) => {
      if (stopped) return;
      if (c && c.op === 'bulk') urls.clear();
      if (page === 'data') loadEstimate();
      paint();
    }) : () => {};
    const offRouter = ctx.router.subscribe(() => {
      if (stopped) return;
      paint();
      if (root.inert || !pendingEnter.length) return;
      const list = pendingEnter;
      pendingEnter = [];
      setTimeout(() => { for (const el of list) if (el.isConnected) enter(el); }, 60);
    });
    const onVisible = () => { if (!document.hidden && !stopped) paint(); };
    document.addEventListener('visibilitychange', onVisible);

    paint();
    if (['root', 'customize', 'data', 'privacy'].includes(page)) loadEstimate();
    if (page === 'data') loadSafetyInfo();
    if (page === 'feeding' && ctx.events && typeof ctx.events.last === 'function') {
      ctx.events.last('pump').then((e) => {
        if (stopped) return;
        lastPumpAt = e ? (e.endTime ?? e.startTime) : null;
        paint();
      }).catch((err) => console.warn('settings: last pump unavailable', err));
    }

    return {
      unmount() {
        stopped = true;
        flushSteps();
        stopRepeat();
        clearTimeout(pressTimer);
        if (drag) endDrag(false);
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('change', onChange);
        root.removeEventListener('input', onInput);
        root.removeEventListener('pointerdown', onPointer);
        root.removeEventListener('touchmove', blockTouch);
        document.removeEventListener('visibilitychange', onVisible);
        offSettings();
        offPhotos();
        offRouter();
        // A photo picked for a baby that was never added.
        if (isNewBaby && !savedNew && draftBaby.photoId) ctx.photos.remove(draftBaby.photoId).catch(() => {});
      },
    };
  },
};
