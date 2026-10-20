// Onboarding (DESIGN §13 Frame 8, §12 privacy surface; AUDIT §6.4 order;
// ARCHITECTURE §10 photo → app icon, §10b install-as-protection).
//
// A full-screen router root (no nav, no live pill), shown while
// !settings.get('onboarded'). Four steps with a dot pager and directional
// slides (DESIGN §7.2 #7):
//
//   1 baby      Frame 8: the promise, then "Who are we caring for?" (name,
//               birth date, circular photo picker). "I have a backup file"
//               merges a backup and finishes.
//   2 feeding   oz / mL, and "every tracker is on, hide any in Customize".
//   3 goal      optional daily pumping goal (dropped when Pumping is hidden).
//   4 install   Add to Home Screen, framed as protection: iOS steps (with a
//               preview of the photo icon) or the native install prompt.
//
// Nothing is lost if the app is closed mid-way: every field is written to
// settings as it changes (the name on a short debounce, flushed on blur and
// before any step change), and the current step is kept as a per-device
// convenience in localStorage, so a reopened app resumes where it was.
//
// Finishing is settings.set('onboarded', true): app.js then lands on Today
// and asks the browser to persist storage. "Skip" ([data-action="start"])
// finishes from any step with whatever has been entered so far (every e2e
// suite uses it to get past onboarding in one tap).

import { importBackup } from '../core/backup.js';

const STEP_KEY = 'nurture.onboardingStep';
const NAME_SAVE_MS = 350;
const GOAL_SAVE_MS = 300;
const LEAVE_MS = 320; // > --dur-fast exit, fallback when transitionend never comes
const ML_PER_OZ = 29.5735;

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, v) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } }

function isStandalone() {
  try {
    return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch { return false; }
}
function isIOS() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
}

/** 'YYYY-MM-DD' → "Wed, Sep 2, 2026" (local date, device locale). */
function longDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try {
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}

/** The pump goal as shown in a unit: oz to 1 decimal, mL to the nearest 10. */
function goalIn(oz, unit) {
  return unit === 'mL' ? Math.round((oz * ML_PER_OZ) / 10) * 10 : oz;
}
const GOAL_RANGE = Object.freeze({ oz: { min: 1, max: 200, step: 1, presets: [16, 24, 32] }, mL: { min: 30, max: 5910, step: 10, presets: [480, 720, 960] } });

/** Trackers shown on the Feeding step (visible ones only). */
const TRACKER_ROWS = Object.freeze([
  { keys: ['bottle', 'formula'], label: 'Bottles & formula', icon: 'bottle', cat: 'cat-feed' },
  { keys: ['breastfeeding'], label: 'Breastfeeding', icon: 'breast', cat: 'cat-feed' },
  { keys: ['sleep'], label: 'Sleep', icon: 'moon', cat: 'cat-sleep' },
  { keys: ['diaper'], label: 'Diapers', icon: 'diaper', cat: 'cat-diaper' },
  { keys: ['pump'], label: 'Pumping', icon: 'pump', cat: 'cat-pump' },
  { keys: ['stash'], label: 'Milk stash', icon: 'pouch', cat: 'cat-pump' },
  { keys: ['memories'], label: 'Memories', icon: 'spark', cat: 'cat-mem' },
]);

export default {
  id: 'onboarding',
  title: 'Welcome to Nurture',

  /**
   * @param {HTMLElement} root the view's scrolling <section>
   * @param {object} ctx
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render } = ctx.html;
    const S = ctx.settings;
    const F = ctx.format;
    const I = (name, size) => ctx.icons.iconHtml(name, size ? { size } : undefined);

    // ------------------------------------------------------------ state
    let alive = true;
    let stepKey = 'baby';
    let finishing = false;
    let photoBusy = false;
    let restoreBusy = false;
    let nameTimer = 0;
    let namePending = null;      // { babyId, name } not yet written
    let nameWrite = Promise.resolve();
    let goalTimer = 0;
    let goalDraft = null;        // value in the current unit, not yet written
    let goalWrite = Promise.resolve();
    let deferredPrompt = null;   // beforeinstallprompt (Android / Chrome)
    let installed = isStandalone();
    const addedPhotos = new Set(); // photos picked in this session (safe to delete when replaced)
    const timers = new Set();

    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
      return t;
    };

    const trackers = () => S.get('trackers') || {};
    const unit = () => (S.get('units') === 'mL' ? 'mL' : 'oz');
    const baby = () => S.activeBaby();
    const babyId = () => S.get('activeBabyId');
    /** The name as typed (pending) or as stored. */
    const nameNow = () => (namePending ? namePending.name : ((baby() && baby().name) || '')).trim();
    const steps = () => ['baby', 'feeding', ...(trackers().pump !== false ? ['goal'] : []), 'install'];
    const P = (n) => F.possessive(n);

    // ------------------------------------------------------------ shell
    render(root, html`<div class="ob">
      <div class="ob-top">
        <div class="ob-top-start" data-top-start></div>
        <div class="ob-top-end">
          <span class="steps ob-dots" aria-hidden="true" data-dots></span>
          <button type="button" class="btn btn-ghost ob-skip" data-action="start" aria-label="Skip setup">Skip</button>
        </div>
      </div>
      <div class="ob-stage" data-stage></div>
      <input type="file" class="sr-only" accept="image/*" tabindex="-1" aria-hidden="true" data-photo-input>
      <input type="file" class="sr-only" accept=".json,application/json" tabindex="-1" aria-hidden="true" data-restore-input>
    </div>`);
    const stage = root.querySelector('[data-stage]');
    const topStart = root.querySelector('[data-top-start]');
    const dotsEl = root.querySelector('[data-dots]');
    const skipBtn = root.querySelector('.ob-skip');
    const photoInput = root.querySelector('[data-photo-input]');
    const restoreInput = root.querySelector('[data-restore-input]');

    function paintTop() {
      const list = steps();
      const i = Math.max(0, list.indexOf(stepKey));
      const first = i === 0;
      if (topStart.dataset.mode !== (first ? 'mark' : 'back')) {
        topStart.dataset.mode = first ? 'mark' : 'back';
        render(topStart, first
          ? html`<span class="wordmark">Nurture</span>`
          : html`<button type="button" class="btn btn-ghost ob-back" data-action="back">${I('chev-l', 22)}Back</button>`);
        topStart.classList.remove('is-swapping');
        topStart.getBoundingClientRect();
        topStart.classList.add('is-swapping');
      }
      // Dots: rebuild only when the count changes, so the width transition
      // (components.css .steps > i) carries the move between steps.
      if (dotsEl.children.length !== list.length) render(dotsEl, html`${list.map(() => html`<i></i>`)}`);
      [...dotsEl.children].forEach((d, n) => d.classList.toggle('is-on', n === i));
      // The last step's own buttons finish; a Skip there would be a duplicate.
      skipBtn.hidden = stepKey === 'install';
    }

    // ------------------------------------------------------------ steps

    function stepLabel(key) {
      const list = steps();
      return `Step ${list.indexOf(key) + 1} of ${list.length}. `;
    }

    function noteText() {
      const n = nameNow();
      // The icon claim only where it's true: iOS Safari, before install (§12).
      const iconClaim = isIOS() && !installed;
      if (n) {
        return iconClaim
          ? `${P(n)} photo and name never leave this phone. On iPhone, ${P(n)} photo can become the app icon.`
          : `${P(n)} photo and name never leave this phone.`;
      }
      return iconClaim
        ? 'Your baby’s photo and name never leave this phone. On iPhone, the photo can become the app icon.'
        : 'Your baby’s photo and name never leave this phone.';
    }

    function photoLabel() {
      const n = nameNow();
      const has = !!(baby() && baby().photoId);
      if (has) return n ? `Change ${P(n)} photo` : 'Change the photo';
      return n ? `Add a photo of ${n}` : 'Add a photo of your baby';
    }

    function babyStep() {
      const b = baby() || {};
      const today = ctx.time.dayKey(Date.now());
      const has = !!b.photoId;
      return html`
        <div class="ob-body">
          <h1 class="disp ob-hero" tabindex="-1" data-focus><span class="sr-only">${stepLabel('baby')}</span>Free. Private.<span class="it ob-hero-it">Everything stays on this phone.</span></h1>
          <ul class="ob-promises">
            <li>${I('shield', 22)}<span><b>No account.</b> No ads, no analytics.</span></li>
            <li>${I('phone', 22)}<span><b>Works offline,</b> even at 3am.</span></li>
            <li>${I('share', 22)}<span><b>Yours to keep.</b> Export or erase any time.</span></li>
          </ul>
          <h2 class="disp ob-h2">Who are we caring for?</h2>
          <div class="ob-who">
            <button type="button" class="ob-photo ${has ? 'has-photo' : ''}" data-action="photo" aria-label="${photoLabel()}">
              <img class="ob-photo-img" alt="" data-photo-img hidden>
              <span class="ob-photo-empty" aria-hidden="true">${I('camera', 26)}<span>Add photo</span></span>
              <span class="ob-photo-badge" aria-hidden="true">${I(has ? 'edit' : 'plus', 18)}</span>
            </button>
            <div class="ob-fields">
              <label class="field ob-field" data-name-field>
                <span class="field-label">Baby’s name</span>
                <input class="field-input" type="text" name="name" autocomplete="off" autocapitalize="words" enterkeyhint="next" maxlength="100" placeholder="Name or nickname" value="${namePending ? namePending.name : (b.name || '')}" data-field="name" aria-describedby="obNameError">
              </label>
              <label class="field ob-field ob-date">
                <span class="field-label">Born</span>
                <span class="ob-date-row" aria-hidden="true"><span class="ob-date-val num" data-date-val>${b.birthDate ? longDate(b.birthDate) : 'Add date'}</span>${I('chev-d', 20)}</span>
                <input class="ob-date-input" type="date" name="born" max="${today}" value="${b.birthDate || ''}" data-field="born">
              </label>
            </div>
          </div>
          <p class="field-error ob-error" id="obNameError" data-name-error hidden></p>
          <p class="note ob-note">${I('lock', 16)}<span data-note>${noteText()}</span></p>
        </div>
        <div class="ob-foot">
          <button type="button" class="btn btn-primary btn-block" data-action="next">Continue</button>
          <button type="button" class="btn btn-ghost" data-action="restore">I have a backup file</button>
          <p class="field-error ob-error" role="alert" data-restore-error hidden></p>
        </div>`;
    }

    function unitsExample(u) {
      return u === 'mL' ? html`A typical bottle reads <b class="num">120 mL</b>.` : html`A typical bottle reads <b class="num">4 oz</b>.`;
    }

    function feedingStep() {
      const u = unit();
      const t = trackers();
      const rows = TRACKER_ROWS.filter((r) => r.keys.some((k) => t[k] !== false));
      const n = nameNow();
      return html`
        <div class="ob-body">
          <span class="ob-disc cat-feed" aria-hidden="true">${I('bottle', 30)}</span>
          <h1 class="disp ob-title" tabindex="-1" data-focus><span class="sr-only">${stepLabel('feeding')}</span>How do you measure milk?</h1>
          <p class="ob-lede">For bottles, pumping and the stash. You can switch any time in Settings.</p>
          <div class="segmented ob-units" role="radiogroup" aria-label="Units" data-units>
            <button type="button" role="radio" aria-checked="${u === 'oz' ? 'true' : 'false'}" tabindex="${u === 'oz' ? '0' : '-1'}" data-unit="oz">Ounces (oz)</button>
            <button type="button" role="radio" aria-checked="${u === 'mL' ? 'true' : 'false'}" tabindex="${u === 'mL' ? '0' : '-1'}" data-unit="mL">Milliliters (mL)</button>
          </div>
          <p class="ob-example" aria-live="polite" data-units-example>${unitsExample(u)}</p>
          ${rows.length ? html`
            <h2 class="disp ob-h2">Everything is on</h2>
            <p class="ob-lede">${n ? `Nurture keeps track of all of this for ${n} from day one.` : 'Nurture keeps track of all of this from day one.'} Hide anything you don’t use later in Settings → Customize. Hidden trackers keep their data.</p>
            <ul class="ob-trackers">
              ${rows.map((r) => html`<li class="badge ${r.cat}">${I(r.icon, 14)}${r.label}</li>`)}
            </ul>` : html`
            <p class="note ob-note">${I('info', 16)}<span>Every tracker is hidden right now. Turn them back on any time in Settings → Customize. Hidden trackers keep their data.</span></p>`}
        </div>
        <div class="ob-foot">
          <button type="button" class="btn btn-primary btn-block" data-action="next">Continue</button>
        </div>`;
    }

    function goalInfo() {
      const u = unit();
      const r = GOAL_RANGE[u];
      const v = goalDraft ?? goalIn(S.get('pumpGoalOz'), u);
      const text = u === 'mL' ? `${v}` : F.amount(v, 'oz').replace(/\s*oz$/, '');
      const spoken = u === 'mL' ? `${v} milliliters a day` : `${v} ${v === 1 ? 'ounce' : 'ounces'} a day`;
      return { u, v, text, spoken, ...r };
    }

    function goalStep() {
      const g = goalInfo();
      return html`
        <div class="ob-body">
          <span class="ob-disc cat-pump" aria-hidden="true">${I('pump', 30)}</span>
          <h1 class="disp ob-title" tabindex="-1" data-focus><span class="sr-only">${stepLabel('goal')}</span>A daily pumping goal?</h1>
          <p class="ob-lede">Optional. Today shows how close you are, and nothing nags. Change it any time in Settings.</p>
          <div class="ob-goal cat-pump" data-goal>
            <div class="stepper">
              <button type="button" class="stepper-btn" data-action="goal" data-dir="-1" aria-label="Lower the goal" ${g.v <= g.min ? html`disabled` : ''}>${I('minus', 24)}</button>
              <div class="stepper-value" role="spinbutton" tabindex="0" aria-label="Daily pumping goal" aria-valuenow="${g.v}" aria-valuemin="${g.min}" aria-valuemax="${g.max}" aria-valuetext="${g.spoken}" data-goal-value><span class="num" data-goal-num>${g.text}</span><small>${g.u}</small></div>
              <button type="button" class="stepper-btn" data-action="goal" data-dir="1" aria-label="Raise the goal" ${g.v >= g.max ? html`disabled` : ''}>${I('plus', 24)}</button>
            </div>
            <p class="ob-goal-sub">a day</p>
            <div class="quick-chips" role="group" aria-label="Common goals">
              ${g.presets.map((p) => html`<button type="button" class="quick-chip" data-action="goal-preset" data-value="${p}" aria-pressed="${p === g.v ? 'true' : 'false'}">${`${p} ${g.u}`}</button>`)}
            </div>
          </div>
        </div>
        <div class="ob-foot">
          <button type="button" class="btn btn-primary btn-block" data-action="next">Continue</button>
          <button type="button" class="btn btn-ghost" data-action="skip-step">Skip for now</button>
        </div>`;
    }

    function iosGuide() {
      return html`<ol class="ob-steps" aria-label="On iPhone or iPad, in Safari">
          <li><span class="ob-num num" aria-hidden="true">1</span><span>Tap the Share button ${I('share', 18)} in Safari’s toolbar.</span></li>
          <li><span class="ob-num num" aria-hidden="true">2</span><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>
          <li><span class="ob-num num" aria-hidden="true">3</span><span>Tap <b>Add</b>, then open Nurture from your Home Screen.</span></li>
        </ol>`;
    }

    function androidGuide() {
      return html`<ol class="ob-steps" aria-label="On Android, in Chrome">
          <li><span class="ob-num num" aria-hidden="true">1</span><span>Tap the menu ${I('more', 18)} at the top right.</span></li>
          <li><span class="ob-num num" aria-hidden="true">2</span><span>Tap <b>Install app</b> or <b>Add to Home screen</b>.</span></li>
          <li><span class="ob-num num" aria-hidden="true">3</span><span>Tap <b>Install</b>.</span></li>
        </ol>`;
    }

    function installStep() {
      const n = nameNow();
      const log = n ? `${P(n)} log` : 'your log';
      const ios = isIOS();
      const icon = S.get('iconDataUrl');
      const lbl = stepLabel('install');
      if (installed) {
        return html`
          <div class="ob-body">
            <span class="ob-disc cat-diaper" aria-hidden="true">${I('check', 30)}</span>
            <h1 class="disp ob-title" tabindex="-1" data-focus><span class="sr-only">${lbl}</span>You’re all set</h1>
            <p class="ob-lede">${`Nurture is on your Home Screen, so ${log} is kept safe from the browser’s storage clean-up.`}</p>
          </div>
          <div class="ob-foot">
            <button type="button" class="btn btn-primary btn-block" data-action="finish">Start tracking</button>
          </div>`;
      }
      const canPrompt = !!deferredPrompt && !ios;
      return html`
        <div class="ob-body">
          <span class="ob-disc cat-accent" aria-hidden="true">${I('phone', 30)}</span>
          <h1 class="disp ob-title" tabindex="-1" data-focus><span class="sr-only">${lbl}</span>${n ? `Keep ${P(n)} log safe` : 'Keep your log safe'}</h1>
          <p class="ob-lede">${ios
            ? `Add Nurture to your Home Screen so iPhone never clears ${log}. It opens full screen and works offline.`
            : `Add Nurture to your Home Screen so the browser never clears ${log}. It opens full screen and works offline.`}</p>
          ${ios && icon ? html`
            <div class="ob-icon-preview">
              <span class="ob-icon-tile"><img src="${icon}" alt="" width="60" height="60"><span>Nurture</span></span>
              <p>${n ? `${P(n)} photo will be the icon on your Home Screen.` : 'Your photo will be the icon on your Home Screen.'}</p>
            </div>` : ''}
          ${canPrompt ? '' : html`${ios ? iosGuide() : androidGuide()}`}
          ${ios ? html`<p class="note ob-note">${I('info', 16)}<span>The Home Screen app keeps its own storage, separate from Safari. Open Nurture from there and log there from now on.</span></p>` : ''}
        </div>
        <div class="ob-foot">
          ${canPrompt
            ? html`<button type="button" class="btn btn-primary btn-block" data-action="install">${I('download', 22)}Add to Home Screen</button>
                <button type="button" class="btn btn-ghost" data-action="finish">Not now</button>`
            : html`<button type="button" class="btn btn-primary btn-block" data-action="finish">Start tracking</button>
                <p class="ob-later">You can do this later in Settings → Add to Home Screen.</p>`}
        </div>`;
    }

    const STEP_RENDER = { baby: babyStep, feeding: feedingStep, goal: goalStep, install: installStep };

    function buildStep(key) {
      const el = document.createElement('section');
      el.className = 'ob-step';
      el.dataset.step = key;
      render(el, STEP_RENDER[key]());
      return el;
    }

    function currentStepEl() {
      return stage.querySelector('.ob-step:not(.is-leaving)');
    }

    /** Re-render the current step in place (no slide), keeping focus by key. */
    function repaintStep() {
      const cur = currentStepEl();
      if (!cur) return;
      const a = document.activeElement;
      const focusSel = a && cur.contains(a)
        ? (a.dataset.field ? `[data-field="${a.dataset.field}"]` : a.dataset.action ? `[data-action="${a.dataset.action}"]${a.dataset.dir ? `[data-dir="${a.dataset.dir}"]` : ''}` : a.dataset.unit ? `[data-unit="${a.dataset.unit}"]` : null)
        : null;
      const next = buildStep(stepKey);
      cur.replaceWith(next);
      afterStepRender(next);
      if (focusSel) { const f = next.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
    }

    function afterStepRender(el) {
      if (el.dataset.step === 'baby') paintPhoto(el);
    }

    function show(key, { direction = 'forward', focus = true } = {}) {
      if (!STEP_RENDER[key]) key = 'baby';
      const from = currentStepEl();
      stepKey = key;
      lsSet(STEP_KEY, key);
      const el = buildStep(key);
      stage.appendChild(el);
      afterStepRender(el);
      paintTop();
      if (from) {
        const dir = direction === 'back' ? 'is-back' : 'is-fwd';
        el.classList.add('is-entering', dir);
        el.getBoundingClientRect(); // commit the start position
        el.classList.remove('is-entering');
        from.classList.add('is-leaving', dir);
        from.inert = true;
        let gone = false;
        const drop = () => { if (gone) return; gone = true; from.remove(); el.classList.remove(dir); };
        from.addEventListener('transitionend', (e) => { if (e.target === from) drop(); });
        later(drop, LEAVE_MS);
        root.scrollTop = 0;
      }
      if (focus) {
        const h = el.querySelector('[data-focus]');
        if (h) { try { h.focus({ preventScroll: true }); } catch { /* detached */ } }
      }
    }

    function stepBy(delta) {
      const list = steps();
      const i = list.indexOf(stepKey);
      const next = list[Math.min(list.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))];
      if (next && next !== stepKey) show(next, { direction: delta < 0 ? 'back' : 'forward' });
    }

    // ------------------------------------------------------------ name + born

    function scheduleName(value) {
      namePending = { babyId: babyId(), name: value };
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => { flushName(); }, NAME_SAVE_MS);
      paintNameDependents();
    }

    function flushName() {
      clearTimeout(nameTimer);
      const p = namePending;
      if (!p) return nameWrite;
      nameWrite = nameWrite.then(async () => {
        try {
          const b = S.babies().find((x) => x.id === p.babyId);
          if (b && b.name !== p.name.trim()) await S.updateBaby(p.babyId, { name: p.name });
        } catch (err) {
          console.warn('onboarding: name not saved', err);
        } finally {
          if (namePending === p) namePending = null;
        }
      });
      return nameWrite;
    }

    function paintNameDependents() {
      const cur = currentStepEl();
      if (!cur) return;
      const note = cur.querySelector('[data-note]');
      if (note) note.textContent = noteText();
      const photo = cur.querySelector('[data-action="photo"]');
      if (photo) photo.setAttribute('aria-label', photoLabel());
      if (nameNow()) clearNameError();
    }

    function showNameError(text) {
      const cur = currentStepEl();
      if (!cur) return;
      const field = cur.querySelector('[data-name-field]');
      const err = cur.querySelector('[data-name-error]');
      if (field) field.classList.add('is-error');
      if (err) { render(err, html`${I('info', 16)}${text}`); err.hidden = false; }
      const input = cur.querySelector('[data-field="name"]');
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    }

    function clearNameError() {
      const cur = currentStepEl();
      if (!cur) return;
      const field = cur.querySelector('[data-name-field]');
      const err = cur.querySelector('[data-name-error]');
      if (field) field.classList.remove('is-error');
      if (err) err.hidden = true;
      const input = cur.querySelector('[data-field="name"]');
      if (input) input.removeAttribute('aria-invalid');
    }

    async function saveBorn(value) {
      const id = babyId();
      const v = /^\d{4}-\d{2}-\d{2}$/.test(value || '') && value <= ctx.time.dayKey(Date.now()) ? value : null;
      const cur = currentStepEl();
      const label = cur && cur.querySelector('[data-date-val]');
      if (label) label.textContent = v ? longDate(v) : 'Add date';
      try { await S.updateBaby(id, { birthDate: v }); } catch (err) { console.warn('onboarding: birth date not saved', err); }
    }

    // ------------------------------------------------------------ photo → app icon (§10)

    let photoUrlFor = null;
    async function paintPhoto(scope = currentStepEl()) {
      if (!scope) return;
      const img = scope.querySelector('[data-photo-img]');
      const btn = scope.querySelector('[data-action="photo"]');
      if (!img || !btn) return;
      const id = baby() && baby().photoId;
      if (!id) {
        img.hidden = true;
        img.removeAttribute('src');
        btn.classList.remove('has-photo');
        return;
      }
      photoUrlFor = id;
      let url = null;
      try { url = await ctx.photos.get(id); } catch { url = null; }
      if (!alive || photoUrlFor !== id || !img.isConnected) return;
      if (url) {
        img.src = url;
        img.hidden = false;
        btn.classList.add('has-photo');
      }
    }

    function applyTouchIcon(url) {
      // app.js re-applies settings.iconDataUrl on every boot and on change;
      // swap it here too so it is in place the moment the photo is picked.
      const touch = document.getElementById('appleTouchIcon');
      if (touch && url) touch.setAttribute('href', url);
    }

    async function pickPhoto(file) {
      if (!file || photoBusy) return;
      photoBusy = true;
      const btn = currentStepEl() && currentStepEl().querySelector('[data-action="photo"]');
      if (btn) btn.setAttribute('aria-busy', 'true');
      const id = babyId();
      const old = baby() && baby().photoId;
      try {
        let rec;
        try {
          rec = await ctx.photos.add(file);
        } catch (err) {
          ctx.toast({ message: err && err.name === 'PhotoDecodeError' ? 'That photo couldn’t be read. Try another one.' : 'Couldn’t save that photo. Try another one.', tone: 'warn' });
          if (!(err && err.name === 'PhotoDecodeError')) console.warn('onboarding: photo not saved', err);
          return;
        }
        addedPhotos.add(rec.id);
        await S.updateBaby(id, { photoId: rec.id });
        try {
          const url = await ctx.photos.makeIconDataUrl(rec.id, 180);
          applyTouchIcon(url);
          await S.set('iconDataUrl', url);
          await S.set('iconBabyId', id);
        } catch (err) { console.warn('onboarding: app icon not updated', err); }
        if (old && old !== rec.id && addedPhotos.has(old)) {
          addedPhotos.delete(old);
          ctx.photos.remove(old).catch(() => {});
        }
      } catch (err) {
        console.warn('onboarding: photo not saved', err);
        ctx.toast({ message: 'Couldn’t save that photo. Try another one.', tone: 'warn' });
      } finally {
        photoBusy = false;
        const b2 = currentStepEl() && currentStepEl().querySelector('[data-action="photo"]');
        if (b2) {
          b2.removeAttribute('aria-busy');
          b2.setAttribute('aria-label', photoLabel());
          const badge = b2.querySelector('.ob-photo-badge');
          if (badge) render(badge, I(baby() && baby().photoId ? 'edit' : 'plus', 18));
        }
        paintPhoto();
      }
    }

    // ------------------------------------------------------------ units + goal

    async function setUnit(u) {
      if (u !== 'oz' && u !== 'mL') return;
      const cur = currentStepEl();
      const group = cur && cur.querySelector('[data-units]');
      if (group) {
        for (const b of group.querySelectorAll('[data-unit]')) {
          const on = b.dataset.unit === u;
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          b.tabIndex = on ? 0 : -1;
        }
      }
      const ex = cur && cur.querySelector('[data-units-example]');
      if (ex) render(ex, unitsExample(u));
      if (goalDraft !== null) await flushGoal();
      try { await S.set('units', u); } catch (err) { console.warn('onboarding: units not saved', err); }
    }

    function paintGoal() {
      const cur = currentStepEl();
      const box = cur && cur.querySelector('[data-goal]');
      if (!box) return;
      const g = goalInfo();
      const val = box.querySelector('[data-goal-value]');
      val.setAttribute('aria-valuenow', String(g.v));
      val.setAttribute('aria-valuemin', String(g.min));
      val.setAttribute('aria-valuemax', String(g.max));
      val.setAttribute('aria-valuetext', g.spoken);
      box.querySelector('[data-goal-num]').textContent = g.text;
      val.querySelector('small').textContent = g.u;
      const down = box.querySelector('[data-dir="-1"]');
      const up = box.querySelector('[data-dir="1"]');
      down.disabled = g.v <= g.min;
      up.disabled = g.v >= g.max;
      for (const c of box.querySelectorAll('[data-action="goal-preset"]')) c.setAttribute('aria-pressed', Number(c.dataset.value) === g.v ? 'true' : 'false');
    }

    function setGoal(value) {
      const g = goalInfo();
      const snapped = g.u === 'mL' ? Math.round(value / 10) * 10 : Math.round(value * 10) / 10;
      const v = Math.min(g.max, Math.max(g.min, snapped));
      if (v === g.v) return;
      goalDraft = v;
      paintGoal();
      clearTimeout(goalTimer);
      goalTimer = setTimeout(() => { flushGoal(); }, GOAL_SAVE_MS);
    }

    function stepGoal(dir) {
      const g = goalInfo();
      const next = g.u === 'mL'
        ? (dir > 0 ? Math.floor(g.v / 10) * 10 + 10 : Math.ceil(g.v / 10) * 10 - 10)
        : (dir > 0 ? Math.floor(g.v) + 1 : Math.ceil(g.v) - 1);
      setGoal(next);
    }

    function flushGoal() {
      clearTimeout(goalTimer);
      if (goalDraft === null) return goalWrite;
      const v = goalDraft;
      const u = unit();
      goalWrite = goalWrite.then(async () => {
        try {
          const oz = u === 'mL' ? Math.max(1, Math.round((v / ML_PER_OZ) * 10) / 10) : v;
          await S.set('pumpGoalOz', oz);
        } catch (err) {
          console.warn('onboarding: pump goal not saved', err);
        } finally {
          if (goalDraft === v) goalDraft = null;
        }
      });
      return goalWrite;
    }

    // ------------------------------------------------------------ restore (merge) → finish

    function importSummary(res) {
      const s = (res && res.stats) || {};
      const ev = s.events ? s.events.added + s.events.updated : 0;
      const inv = s.inventory ? s.inventory.added + s.inventory.updated : 0;
      const ph = s.photos ? s.photos.added : 0;
      const parts = [];
      if (ev) parts.push(F.plural(ev, 'entry', 'entries'));
      if (inv) parts.push(F.plural(inv, 'pouch', 'pouches'));
      if (ph) parts.push(F.plural(ph, 'photo'));
      return parts.length ? `Welcome back · ${parts.join(', ')} restored` : 'Welcome back · that file had nothing new';
    }

    async function restore(file) {
      if (!file || restoreBusy || finishing) return;
      restoreBusy = true;
      const cur = currentStepEl();
      const btn = cur && cur.querySelector('[data-action="restore"]');
      const err = cur && cur.querySelector('[data-restore-error]');
      if (err) err.hidden = true;
      if (btn) btn.setAttribute('aria-busy', 'true');
      try {
        await flushName();
        const res = await importBackup(file, { mode: 'merge' });
        // The restored baby's photo becomes the iPhone icon, as if picked here.
        const b = S.activeBaby();
        if (b && b.photoId && !S.get('iconDataUrl')) {
          try {
            const url = await ctx.photos.makeIconDataUrl(b.photoId, 180);
            applyTouchIcon(url);
            await S.set('iconDataUrl', url);
            await S.set('iconBabyId', b.id);
          } catch (e) { console.warn('onboarding: app icon not updated', e); }
        }
        finishing = true;
        lsDel(STEP_KEY);
        await S.set('onboarded', true);
        ctx.toast({ message: importSummary(res) });
      } catch (ex) {
        finishing = false;
        if (!(ex && ex.name === 'BackupError')) console.warn('onboarding: import failed', ex);
        const live = currentStepEl() && currentStepEl().querySelector('[data-restore-error]');
        if (live) {
          render(live, html`${I('info', 16)}${ex && ex.name === 'BackupError' ? ex.message : 'That file couldn’t be restored. Nothing was changed.'}`);
          live.hidden = false;
        }
      } finally {
        restoreBusy = false;
        if (btn && btn.isConnected) btn.removeAttribute('aria-busy');
      }
    }

    // ------------------------------------------------------------ install

    function onBeforeInstall(e) {
      e.preventDefault(); // keep Chrome's own mini-infobar out of onboarding
      deferredPrompt = e;
      if (stepKey === 'install') repaintStep();
    }
    function onInstalled() {
      installed = true;
      deferredPrompt = null;
      if (stepKey === 'install') repaintStep();
    }

    async function promptInstall(btn) {
      const ev = deferredPrompt;
      if (!ev) { repaintStep(); return; }
      deferredPrompt = null; // a prompt can only be shown once
      btn.setAttribute('aria-busy', 'true');
      try {
        // (BeforeInstallPromptEvent's own method, not window.prompt)
        const showNative = ev.prompt;
        await showNative.call(ev);
        const choice = await ev.userChoice;
        if (choice && choice.outcome === 'accepted') installed = true;
      } catch (err) {
        console.warn('onboarding: install prompt failed', err);
      }
      if (alive && stepKey === 'install') repaintStep();
    }

    // ------------------------------------------------------------ finish

    async function finish() {
      if (finishing) return;
      finishing = true;
      try {
        await Promise.all([flushName(), flushGoal()]);
        lsDel(STEP_KEY);
        await S.set('onboarded', true); // app.js → Today + persistence request
      } catch (err) {
        finishing = false;
        console.warn('onboarding: could not finish', err);
        ctx.toast({ message: 'Couldn’t save. Close other Nurture tabs and try again.', tone: 'warn' });
      }
    }

    async function next() {
      if (stepKey === 'baby') {
        const input = currentStepEl() && currentStepEl().querySelector('[data-field="name"]');
        const typed = input ? input.value : nameNow();
        if (!typed.trim()) { showNameError('Add a name, or a nickname for now.'); return; }
        if (input && (!namePending || namePending.name !== typed)) scheduleName(typed);
        flushName();
      }
      if (stepKey === 'goal') flushGoal();
      const list = steps();
      if (list.indexOf(stepKey) >= list.length - 1) { finish(); return; }
      stepBy(1);
    }

    // ------------------------------------------------------------ events

    function onClick(e) {
      const b = e.target.closest('[data-action], [data-unit]');
      if (!b || !root.contains(b) || b.closest('.is-leaving')) return;
      if (b.dataset.unit) { setUnit(b.dataset.unit); return; }
      switch (b.dataset.action) {
        case 'start': finish(); break;
        case 'finish': finish(); break;
        case 'next': next(); break;
        case 'skip-step': stepBy(1); break;
        case 'back': flushName(); stepBy(-1); break;
        case 'photo': if (!photoBusy) { photoInput.value = ''; photoInput.click(); } break;
        case 'restore': if (!restoreBusy) { restoreInput.value = ''; restoreInput.click(); } break;
        case 'goal': stepGoal(Number(b.dataset.dir) || 0); break;
        case 'goal-preset': setGoal(Number(b.dataset.value)); break;
        case 'install': promptInstall(b); break;
        default: break;
      }
    }

    function onInput(e) {
      const t = e.target;
      if (t.dataset && t.dataset.field === 'name') scheduleName(t.value);
    }

    function onChange(e) {
      const t = e.target;
      if (t === photoInput) { pickPhoto(t.files && t.files[0]); return; }
      if (t === restoreInput) { restore(t.files && t.files[0]); return; }
      if (t.dataset && t.dataset.field === 'born') saveBorn(t.value);
    }

    function onFocusOut(e) {
      if (e.target.dataset && e.target.dataset.field === 'name') flushName();
    }

    function onDateClick(e) {
      // Chromium only opens the calendar from its icon; open it from anywhere
      // on the field, like iOS does.
      const t = e.target;
      if (!(t.dataset && t.dataset.field === 'born') || typeof t.showPicker !== 'function') return;
      try { t.showPicker(); } catch { /* not allowed here: the native control still works */ }
    }

    function onKeydown(e) {
      const t = e.target;
      // Enter in the name field moves on, like the keyboard's "next" key says.
      if (e.key === 'Enter' && t.dataset && t.dataset.field === 'name') { e.preventDefault(); next(); return; }
      // Units radiogroup: arrows move and select (DESIGN §11).
      if (t.dataset && t.dataset.unit && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const u = t.dataset.unit === 'oz' ? 'mL' : 'oz';
        setUnit(u);
        const other = t.parentElement.querySelector(`[data-unit="${u}"]`);
        if (other) other.focus();
        return;
      }
      // Goal spinbutton.
      if (t.hasAttribute && t.hasAttribute('data-goal-value')) {
        const g = goalInfo();
        const big = g.u === 'mL' ? 100 : 5;
        const map = { ArrowUp: () => stepGoal(1), ArrowRight: () => stepGoal(1), ArrowDown: () => stepGoal(-1), ArrowLeft: () => stepGoal(-1), PageUp: () => setGoal(g.v + big), PageDown: () => setGoal(g.v - big), Home: () => setGoal(g.min), End: () => setGoal(g.max) };
        if (map[e.key]) { e.preventDefault(); map[e.key](); }
      }
    }

    root.addEventListener('click', onClick);
    root.addEventListener('click', onDateClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKeydown);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Settings changed elsewhere (another tab, an import, a switched baby,
    // a hidden tracker): bring the screen in step without clobbering typing.
    const offSettings = S.subscribe((change) => {
      if (!alive) return;
      const key = change && change.key;
      const all = key === '*';
      if (all || key === 'trackers') {
        const list = steps();
        if (!list.includes(stepKey)) show(list[Math.min(list.length - 1, 2)], { direction: 'forward', focus: false });
        else if (stepKey === 'feeding') repaintStep();
        paintTop();
      }
      if ((all || key === 'babies' || key === 'activeBabyId') && stepKey === 'baby') {
        const cur = currentStepEl();
        const input = cur && cur.querySelector('[data-field="name"]');
        const b = baby() || {};
        if (input && document.activeElement !== input && !namePending && input.value !== (b.name || '')) input.value = b.name || '';
        const born = cur && cur.querySelector('[data-field="born"]');
        if (born && document.activeElement !== born && born.value !== (b.birthDate || '')) {
          born.value = b.birthDate || '';
          const label = cur.querySelector('[data-date-val]');
          if (label) label.textContent = b.birthDate ? longDate(b.birthDate) : 'Add date';
        }
        paintNameDependents();
        if (!photoBusy) paintPhoto();
      }
      if ((all || key === 'units') && stepKey === 'feeding') {
        const cur = currentStepEl();
        const on = cur && cur.querySelector('[data-unit][aria-checked="true"]');
        if (!on || on.dataset.unit !== unit()) repaintStep();
      }
      if ((all || key === 'units' || key === 'pumpGoalOz') && stepKey === 'goal' && goalDraft === null) paintGoal();
    });

    // ------------------------------------------------------------ start (resume where we were)
    const saved = lsGet(STEP_KEY);
    show(steps().includes(saved) ? saved : 'baby', { focus: false });

    return {
      unmount() {
        alive = false;
        root.removeEventListener('click', onClick);
        root.removeEventListener('click', onDateClick);
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
        root.removeEventListener('focusout', onFocusOut);
        root.removeEventListener('keydown', onKeydown);
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        window.removeEventListener('appinstalled', onInstalled);
        offSettings();
        for (const t of timers) clearTimeout(t);
        timers.clear();
        // Never drop what was typed: write anything still pending.
        flushName();
        flushGoal();
      },
    };
  },
};
