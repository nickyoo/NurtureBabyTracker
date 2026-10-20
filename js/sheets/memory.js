// Memory sheet: add / view / edit / delete a memory or a first (DESIGN §6.6
// Sheet, §6.8 MemoryCover / FirstsRow / Field / Chip, motion #1, #7, #8, #9;
// ARCHITECTURE §3 milestone events, §5.3 sheet contract, §7.1–7.2; AUDIT
// §6.3 Milestones & Memories).
//
//   ctx.sheets.memory({ origin })                          // add
//   ctx.sheets.memory({ origin, preset: { key } })         // add a preset first
//   ctx.sheets.memory({ origin, preset: { startTime } })   // add, back-dated (quick log time chip)
//   ctx.sheets.memory({ origin, id, event })               // view (photo viewer)
//   ctx.sheets.memory({ origin, id, event, mode: 'edit' }) // straight to the edit form
//
//  - Add / edit form: a row of the firsts not kept yet (tap one to name the
//    memory after it), the name, photos (<input type=file accept=image/*>
//    → ctx.photos.add, downscaled + re-encoded on this phone), the day
//    (default today) with the baby's age on that day, a note, and "who"
//    when there are two babies. Save shows "Saved" in the button (#8), then
//    the sheet closes and the memory slides into the book (#9).
//  - View: the photo viewer (‹ › and swipe between photos, dimmed at night
//    through --photo-filter), the day and age, the note, "Use as cover",
//    Edit (steps forward) and Delete → Undo toast (events.restore). Photos
//    of a deleted memory are only removed once that Undo has gone.
//  - Photos picked but never saved are removed when the sheet closes, so
//    nothing is left behind on the phone.
//
// Never imports another sheet or view.

const SUCCESS_HOLD_MS = 400;   // DESIGN §7.2 #8
const MAX_PHOTOS = 20;         // core/store.js LIMITS.photoIds
const COVER_KEY = 'memoryCovers'; // settings: { [babyId]: eventId } (read by views/memories.js)
const DAY = 24 * 60 * 60 * 1000;

// The preset firsts. KEEP IN SYNC with js/views/memories.js (a sheet may not
// import a view; tests/memories.test.js checks the two tables match).
const PRESETS = Object.freeze([
  { key: 'first-bath', title: 'First bath at home', caption: 'The first bath at home', min: 0, max: 21, usually: 'Usually in the first weeks' },
  { key: 'head-up', title: 'Head up in tummy time', caption: 'Head up in tummy time', min: 28, max: 90, usually: 'Usually 1–3 months' },
  { key: 'first-smile', title: 'First real smile', caption: 'The first real smile', min: 42, max: 56, usually: 'Usually 6–8 weeks' },
  { key: 'laughs', title: 'Laughs out loud', caption: 'The first big laugh', min: 91, max: 122, usually: 'Usually 3–4 months' },
  { key: 'rolls-over', title: 'Rolls over', caption: 'The first roll over', min: 122, max: 183, usually: 'Usually 4–6 months' },
  { key: 'first-solid', title: 'First solid food', caption: 'The first taste of food', min: 168, max: 213, usually: 'Usually around 6 months' },
  { key: 'sits-up', title: 'Sits up', caption: 'Sitting up', min: 183, max: 244, usually: 'Usually 6–8 months' },
  { key: 'first-tooth', title: 'First tooth', caption: 'The first tooth', min: 183, max: 305, usually: 'Usually 6–10 months' },
  { key: 'crawls', title: 'Crawls', caption: 'Off and crawling', min: 213, max: 305, usually: 'Usually 7–10 months' },
  { key: 'stands', title: 'Stands', caption: 'Standing tall', min: 274, max: 365, usually: 'Usually 9–12 months' },
  { key: 'first-word', title: 'First word', caption: 'The first word', min: 304, max: 426, usually: 'Usually 10–14 months' },
  { key: 'first-steps', title: 'First steps', caption: 'The first steps', min: 304, max: 456, usually: 'Usually 10–15 months' },
].map(Object.freeze));
const PRESET_BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));

// Which firsts each baby already has, kept current from the events bus by
// setup() — so the form opens with the right chips in its first frame.
const keptByBaby = new Map(); // babyId|'' → Map(key → count)

let uidSeq = 0;
const uid = () => `mem${(uidSeq += 1)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

// ================================================================ pure

/** 'YYYY-MM-DD' (local) for a timestamp. */
function dateValue(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local noon of a 'YYYY-MM-DD' day, or NaN for anything else. */
function noonOf(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return NaN;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return NaN;
  return d.getTime();
}

/**
 * When the memory happened, from the day picked in the form:
 *  - the day it already had (edit) or was opened with (a back-dated quick
 *    log) keeps that exact time;
 *  - today → now; any other day → its noon (never later than now).
 * @param {string} day 'YYYY-MM-DD'
 * @param {{ keep?: number|null, now?: number }} [o]
 * @returns {number} epoch ms, or NaN
 */
function startFor(day, { keep = null, now = Date.now() } = {}) {
  const noon = noonOf(day);
  if (!Number.isFinite(noon)) return NaN;
  if (Number.isFinite(keep) && dateValue(keep) === day) return keep;
  if (day === dateValue(now)) return now;
  return Math.min(noon, now);
}

/**
 * The form's problem in calm words, or '' when it can be saved. Pure.
 * @param {{ title: string, day: string, now: number }} v
 * @returns {string}
 */
function formProblem(v) {
  if (!String(v.title || '').trim()) return 'Give this memory a name.';
  const noon = noonOf(v.day);
  if (!Number.isFinite(noon)) return 'Pick the day it happened.';
  if (v.day > dateValue(v.now)) return 'That day is still to come. Pick a day up to today.';
  return '';
}

/**
 * The age line under the day: "Clara was 5 weeks, 2 days." Pure.
 * @param {string} name
 * @param {string|null} birthDate
 * @param {string} day 'YYYY-MM-DD'
 * @param {(birth: any, at: number) => string} babyAge format.babyAge
 * @returns {string}
 */
function ageLine(name, birthDate, day, babyAge) {
  const at = noonOf(day);
  if (!birthDate || !Number.isFinite(at)) return '';
  if (day < String(birthDate)) return `Before ${name} was born.`;
  const age = babyAge(birthDate, at);
  if (!age) return '';
  if (age === 'Born today') return `The day ${name} was born.`;
  return `${name} was ${age}.`;
}

/** Firsts to offer as chips: not kept yet (plus the one already chosen), in typical-age order. */
function chipPresets(kept, chosenKey) {
  return PRESETS.filter((p) => !(kept && kept.get(p.key)) || p.key === chosenKey).sort((a, b) => a.min - b.min || a.max - b.max);
}

function bumpKept(event, dir) {
  const key = event && event.data && event.data.key;
  if (!event || event.type !== 'milestone' || !key || !PRESET_BY_KEY.has(key)) return;
  const b = event.babyId || '';
  if (!keptByBaby.has(b)) keptByBaby.set(b, new Map());
  const m = keptByBaby.get(b);
  const n = (m.get(key) || 0) + dir;
  if (n > 0) m.set(key, n); else m.delete(key);
}

// ================================================================ sheet

/**
 * Open the memory sheet.
 * @param {object} ctx app ctx (ARCHITECTURE §5.2)
 * @param {{ origin?: Element, preset?: { key?: string, startTime?: number, title?: string }, event?: object, id?: string, mode?: 'view'|'edit', coverId?: string|null }} [opts]
 *   coverId: the memory the book shows on its cover right now (the view passes it, so a
 *   memory that is already the cover doesn't offer "Use as cover")
 * @returns {object} sheet api
 */
export function openMemorySheet(ctx, { origin, preset, event, id, mode = 'view', coverId } = {}) {
  const { html, render } = ctx.html;
  const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
  const F = ctx.format;
  const babies = () => ctx.settings.get('babies') || [];
  const multi = () => babies().length > 1;
  const babyById = (bid) => babies().find((b) => b.id === bid) || ctx.activeBaby() || null;

  let ev = event && event.type === 'milestone' ? event : null;
  const eventId = ev ? ev.id : (typeof id === 'string' ? id : null);
  let api = null;
  let busy = false;
  let closingFor = null;
  let view = 'form';
  const added = new Set();    // photos added in this sheet and not saved yet
  let viewerIndex = 0;
  let coverNow = typeof coverId === 'string' ? coverId : null;

  const titleOf = (e) => F.eventTitle(e);
  const photosOf = (e) => (e && e.data && Array.isArray(e.data.photoIds) ? e.data.photoIds.filter(Boolean) : []);
  const kindWord = () => 'Memory';

  function showError(body, msg) {
    const el = body.querySelector('[data-error]');
    if (!el) return;
    if (!msg) { el.hidden = true; render(el, null); return; }
    render(el, html`${I('info', 16)}<span>${msg}</span>`);
    el.hidden = false;
  }

  function hydrate(scope) {
    for (const img of scope.querySelectorAll('img[data-photo]:not([src]):not([data-h])')) {
      const pid = img.dataset.photo;
      img.dataset.h = '1'; // asked for once
      img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
      ctx.photos.get(pid).then((url) => {
        if (!img.isConnected || img.dataset.photo !== pid) return;
        if (url) img.src = url; else img.parentElement.classList.add('is-missing');
      }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ view

  function paintView(body) {
    view = 'view';
    const e = ev;
    const photos = photosOf(e);
    if (viewerIndex >= photos.length) viewerIndex = 0;
    const b = babyById(e.babyId);
    const name = F.babyName(b);
    const age = F.babyAge(b && b.birthDate, e.startTime);
    const preset = e.data && e.data.key && PRESET_BY_KEY.get(e.data.key);
    const covers = ctx.settings.get(COVER_KEY) || {};
    const isCover = !!(photos.length && b && (coverNow ? coverNow === e.id : covers[b.id] === e.id));
    api.setTitle(titleOf(e));
    const metaBits = [];
    if (multi() && e.babyId) metaBits.push(name);
    metaBits.push(F.dateLabel(e.startTime));
    if (age) metaBits.push(age);
    render(body, html`<div class="mem-sheet mem-view cat-mem">
        ${photos.length ? html`<figure class="mem-viewer" data-viewer>
            <div class="mem-viewer-mat" tabindex="0" role="group" aria-roledescription="photo viewer" aria-label="${photos.length > 1 ? 'Photos. Use the arrow keys to move between them.' : 'Photo'}" data-mat>
              <img class="mem-viewer-img" data-photo="${photos[viewerIndex]}" alt="${`Photo${photos.length > 1 ? ` ${viewerIndex + 1} of ${photos.length}` : ''}: ${titleOf(e)}`}">
            </div>
            ${photos.length > 1 ? html`<div class="mem-viewer-nav">
                <button type="button" class="btn-round" data-prev aria-label="Previous photo">${I('chev-l', 24)}</button>
                <span class="mem-viewer-count num" aria-live="polite" data-count>${viewerIndex + 1} of ${photos.length}</span>
                <button type="button" class="btn-round" data-next aria-label="Next photo">${I('chev-r', 24)}</button>
              </div>` : ''}
          </figure>` : ''}
        <div class="mem-view-meta">
          ${preset ? html`<span class="badge">${I('spark', 14)}A first</span>` : ''}
          <span class="num">${metaBits.join(' · ')}</span>
        </div>
        ${e.note ? html`<p class="mem-view-note">${e.note}</p>` : ''}
        ${photos.length ? (isCover
          ? html`<p class="note mem-cover-note">${I('check', 16)}<span>${`On the cover of ${F.possessive(name)} book`}</span></p>`
          : html`<button type="button" class="btn btn-ghost mem-use-cover" data-cover>${I('book', 20)}Use as cover</button>`) : ''}
        <p class="field-error" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <div class="mem-view-btns">
            <button type="button" class="btn btn-danger-soft" data-delete>${I('trash', 22)}Delete</button>
            <button type="button" class="btn btn-primary" data-edit>${I('edit', 22)}Edit</button>
          </div>
        </div>
      </div>`);
    hydrate(body);
    const q = (s) => body.querySelector(s);
    q('[data-edit]').addEventListener('click', () => { if (!busy) api.step((bd) => paintForm(bd, { editing: ev }), { direction: 'forward' }); });
    q('[data-delete]').addEventListener('click', (evt) => remove(body, evt.currentTarget));
    const coverBtn = q('[data-cover]');
    if (coverBtn) coverBtn.addEventListener('click', () => useAsCover(body, coverBtn));
    if (photos.length > 1) bindViewer(body, photos);
  }

  function bindViewer(body, photos) {
    const img = body.querySelector('.mem-viewer-img');
    const count = body.querySelector('[data-count]');
    const mat = body.querySelector('[data-mat]');
    const show = (i) => {
      viewerIndex = (i + photos.length) % photos.length;
      img.classList.remove('is-loaded');
      img.removeAttribute('src');
      delete img.dataset.h;
      img.dataset.photo = photos[viewerIndex];
      img.alt = `Photo ${viewerIndex + 1} of ${photos.length}: ${titleOf(ev)}`;
      count.textContent = `${viewerIndex + 1} of ${photos.length}`;
      hydrate(body);
    };
    body.querySelector('[data-prev]').addEventListener('click', () => show(viewerIndex - 1));
    body.querySelector('[data-next]').addEventListener('click', () => show(viewerIndex + 1));
    mat.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(viewerIndex - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(viewerIndex + 1); }
    });
    // Swipe sideways between photos (vertical drags stay the sheet's).
    let sx = null;
    let sy = null;
    mat.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    mat.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) show(viewerIndex + (dx < 0 ? 1 : -1));
    });
    mat.addEventListener('pointercancel', () => { sx = null; });
  }

  async function useAsCover(body, btn) {
    if (busy || !ev) return;
    const b = babyById(ev.babyId);
    if (!b) return;
    busy = true;
    try {
      const cur = ctx.settings.get(COVER_KEY);
      await ctx.settings.set(COVER_KEY, { ...(cur && typeof cur === 'object' ? cur : {}), [b.id]: ev.id });
      coverNow = ev.id;
      const note = html`<p class="note mem-cover-note is-entering">${I('check', 16)}<span>${`On the cover of ${F.possessive(F.babyName(b))} book`}</span></p>`;
      const holder = document.createElement('div');
      render(holder, note);
      const p = holder.firstElementChild;
      btn.replaceWith(p);
      // Keep keyboard focus somewhere sensible: the next control.
      body.querySelector('[data-edit]').focus({ preventScroll: true });
    } catch (err) {
      console.error('memory sheet: cover not saved', err);
      showError(body, 'That didn’t work. Try again.');
    } finally {
      busy = false;
    }
  }

  async function remove(body, btn) {
    if (busy || !ev) return;
    busy = true;
    btn.style.setProperty('min-width', `${btn.offsetWidth}px`);
    btn.setAttribute('aria-busy', 'true');
    closingFor = 'deleted';
    let removed = null;
    try {
      removed = await ctx.events.remove(ev.id);
    } catch (err) {
      console.error('memory sheet: delete failed', err);
      closingFor = null;
      busy = false;
      btn.removeAttribute('aria-busy');
      showError(body, 'That didn’t delete. Try again.');
      return;
    }
    if (api.isOpen()) api.close('deleted');
    await api.closed;
    if (!removed) return;
    const photos = photosOf(removed);
    const handle = ctx.toast({ message: `${kindWord()} deleted`, action: { label: 'Undo', run: () => ctx.events.restore(removed) } });
    // The photos go only once Undo can no longer bring the memory back.
    if (photos.length && handle && handle.done && typeof handle.done.then === 'function') {
      handle.done.then((why) => {
        if (why === 'action') return;
        for (const pid of photos) ctx.photos.remove(pid).catch(() => {});
      });
    }
  }

  // ------------------------------------------------------------ form

  function paintForm(body, { editing = null } = {}) {
    view = 'form';
    const ids = { presets: uid(), photos: uid(), who: uid(), err: uid(), age: uid() };
    const today = dateValue(Date.now());
    const pre = preset && typeof preset === 'object' ? preset : {};
    const presetKey = editing ? (editing.data && editing.data.key) || null : (PRESET_BY_KEY.has(pre.key) ? pre.key : null);
    const st = {
      key: presetKey,
      babyId: editing ? (editing.babyId || (ctx.activeBaby() && ctx.activeBaby().id) || null) : ((ctx.activeBaby() && ctx.activeBaby().id) || null),
      photos: editing ? photosOf(editing).slice() : [],
      pending: 0,
    };
    const keepTime = editing ? editing.startTime : (Number.isFinite(pre.startTime) ? pre.startTime : null);
    const initialDay = keepTime !== null ? dateValue(keepTime) : today;
    const initialTitle = editing ? titleOf(editing) : (presetKey ? PRESET_BY_KEY.get(presetKey).title : (typeof pre.title === 'string' ? pre.title : ''));
    api.setTitle(editing ? 'Edit memory' : 'Add a memory');

    const whoTpl = () => html`<div class="mem-block"><p class="mem-lbl" id="${ids.who}">Who</p>
        <div class="segmented cat-scoped mem-seg" role="radiogroup" aria-labelledby="${ids.who}" data-seg="who">
          ${babies().map((b) => html`<button type="button" role="radio" aria-checked="${b.id === st.babyId ? 'true' : 'false'}" tabindex="${b.id === st.babyId ? '0' : '-1'}" data-value="${b.id}">${F.babyName(b)}</button>`)}
        </div></div>`;

    render(body, html`<div class="mem-sheet mem-form cat-mem">
        ${editing ? html`<button type="button" class="btn btn-ghost mem-back" data-back>${I('chev-l', 20)}Back</button>` : ''}
        ${multi() ? whoTpl() : ''}
        <div class="mem-block" data-presets-block>
          <p class="mem-lbl" id="${ids.presets}">A first?</p>
          <div class="mem-chips" role="group" aria-labelledby="${ids.presets}" data-chips></div>
        </div>
        <label class="field"><span class="field-label">Name</span>
          <input class="field-input" type="text" maxlength="200" autocomplete="off" enterkeyhint="done" data-title placeholder="First trip to the park" aria-describedby="${ids.err}"></label>
        <div class="mem-block">
          <p class="mem-lbl" id="${ids.photos}">Photos</p>
          <div class="mem-photos" role="group" aria-labelledby="${ids.photos}">
            <ul class="mem-ph-list" data-photo-list></ul>
            <label class="mem-pick" data-pick-label>
              <input class="mem-pick-input" type="file" accept="image/*" multiple data-pick aria-describedby="${ids.err}">
              <span class="mem-pick-ic">${I('camera', 24)}</span><span class="mem-pick-txt" data-pick-txt>Add photo</span>
            </label>
          </div>
          <p class="note">${I('lock', 16)}<span>Photos are made smaller and kept only on this phone.</span></p>
        </div>
        <div class="mem-block">
          <label class="field"><span class="field-label">Day</span>
            <input class="field-input num" type="date" max="${today}" data-day value="${initialDay}" aria-describedby="${`${ids.age} ${ids.err}`}"></label>
          <p class="field-help mem-age" id="${ids.age}" data-age></p>
        </div>
        <label class="field"><span class="field-label">Note</span>
          <textarea class="field-input" rows="2" maxlength="2000" data-note placeholder="What you want to remember"></textarea></label>
        <p class="field-error" id="${ids.err}" data-error role="status" hidden></p>
        <div class="sheet-footer">
          <button type="button" class="btn btn-primary btn-block" data-save>${editing ? 'Save' : 'Save memory'}</button>
        </div>
      </div>`);

    const q = (s) => body.querySelector(s);
    const titleEl = q('[data-title]');
    const dayEl = q('[data-day]');
    const noteEl = q('[data-note]');
    const ageEl = q('[data-age]');
    const chipsEl = q('[data-chips]');
    const listEl = q('[data-photo-list]');
    const pickEl = q('[data-pick]');
    const pickLabel = q('[data-pick-label]');
    const saveBtn = q('[data-save]');
    titleEl.value = initialTitle;
    noteEl.value = editing ? editing.note || '' : '';

    // ---- firsts chips ----
    function paintChips() {
      const kept = keptByBaby.get(st.babyId || '') || null;
      // In edit, the memory's own first is not "taken" by itself.
      const keptMinusSelf = kept && editing && editing.data && editing.data.key ? new Map([...kept].map(([k, n]) => [k, k === editing.data.key ? n - 1 : n])) : kept;
      // The memory's own first leads the row, so it shows without scrolling.
      const list = chipPresets(keptMinusSelf, st.key).sort((a, b) => (b.key === st.key) - (a.key === st.key));
      q('[data-presets-block]').hidden = !list.length;
      render(chipsEl, list.map((p) => html`<button type="button" class="chip" data-key="${p.key}" aria-pressed="${p.key === st.key ? 'true' : 'false'}"><span class="chip-face">${p.key === st.key ? I('check', 14) : I('spark', 14)}${p.title}</span></button>`));
      chipsEl.scrollLeft = 0;
    }
    chipsEl.addEventListener('click', (e) => {
      const c = e.target.closest('.chip[data-key]');
      if (!c) return;
      const p = PRESET_BY_KEY.get(c.dataset.key);
      if (st.key === p.key) {
        st.key = null;
        if (titleEl.value.trim() === p.title) titleEl.value = '';
      } else {
        st.key = p.key;
        titleEl.value = p.title;
      }
      for (const b of chipsEl.querySelectorAll('.chip')) {
        const onNow = b.dataset.key === st.key;
        b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
        render(b.querySelector('.chip-face'), html`${onNow ? I('check', 14) : I('spark', 14)}${PRESET_BY_KEY.get(b.dataset.key).title}`);
      }
      showError(body, '');
    });
    titleEl.addEventListener('input', () => {
      // Renaming a first away from its preset makes it the family's own memory.
      if (st.key && titleEl.value.trim() !== PRESET_BY_KEY.get(st.key).title) {
        const p = PRESET_BY_KEY.get(st.key);
        // Small edits ("First real smile!") keep the first; a new name doesn't.
        if (!titleEl.value.toLowerCase().includes(p.title.toLowerCase())) {
          st.key = null;
          for (const b of chipsEl.querySelectorAll('.chip')) {
            b.setAttribute('aria-pressed', 'false');
            render(b.querySelector('.chip-face'), html`${I('spark', 14)}${PRESET_BY_KEY.get(b.dataset.key).title}`);
          }
        }
      }
      showError(body, '');
    });

    // ---- age line ----
    function paintAge() {
      const b = babyById(st.babyId);
      const line = ageLine(F.babyName(b), b && b.birthDate, dayEl.value, F.babyAge);
      ageEl.textContent = line;
      ageEl.hidden = !line;
    }
    dayEl.addEventListener('input', () => { paintAge(); showError(body, ''); });
    dayEl.addEventListener('change', paintAge);

    // ---- who ----
    bindRadios(q('[data-seg="who"]'), (b) => { st.babyId = b.dataset.value; paintAge(); paintChips(); });

    // ---- photos ----
    function paintPhotos() {
      const n = st.photos.length;
      render(listEl, [
        ...st.photos.map((pid, i) => html`<li class="mem-ph-item" data-pid="${pid}">
            <span class="print mem-ph"><img data-photo="${pid}" alt="${`Photo ${i + 1}`}"></span>
            <button type="button" class="mem-ph-x" data-remove="${pid}" aria-label="${`Remove photo ${i + 1}`}">${I('close', 18)}</button>
          </li>`),
        ...Array.from({ length: st.pending }, () => html`<li class="mem-ph-item"><span class="print mem-ph is-busy" role="img" aria-label="Adding a photo"></span></li>`),
      ]);
      listEl.hidden = !(n + st.pending);
      hydrate(listEl);
      const full = n + st.pending >= MAX_PHOTOS;
      pickLabel.hidden = full;
      q('[data-pick-txt]').textContent = n + st.pending ? 'Add another' : 'Add photo';
    }
    listEl.addEventListener('click', (e) => {
      const x = e.target.closest('[data-remove]');
      if (!x || busy) return;
      const pid = x.dataset.remove;
      const i = st.photos.indexOf(pid);
      st.photos = st.photos.filter((p) => p !== pid);
      if (added.has(pid)) { added.delete(pid); ctx.photos.remove(pid).catch(() => {}); }
      paintPhotos();
      // Focus the next remove button, else the picker.
      const next = listEl.querySelectorAll('[data-remove]')[Math.min(i, st.photos.length - 1)];
      (next || pickEl).focus({ preventScroll: true });
    });
    let pendingWork = Promise.resolve();
    pickEl.addEventListener('change', () => {
      const files = [...(pickEl.files || [])].slice(0, Math.max(0, MAX_PHOTOS - st.photos.length - st.pending));
      pickEl.value = '';
      if (!files.length) return;
      showError(body, '');
      st.pending += files.length;
      paintPhotos();
      const work = (async () => {
        let failed = 0;
        for (const f of files) {
          try {
            const rec = await ctx.photos.add(f);
            if (!api.isOpen() || closingFor) { ctx.photos.remove(rec.id).catch(() => {}); continue; }
            added.add(rec.id);
            st.photos.push(rec.id);
          } catch (err) {
            failed += 1;
            console.warn('memory sheet: photo not added', err);
          } finally {
            st.pending -= 1;
            if (api.isOpen() && body.isConnected) paintPhotos();
          }
        }
        if (failed && api.isOpen() && body.isConnected) {
          showError(body, failed === files.length && files.length === 1
            ? 'That photo can’t be opened on this phone. Try a JPEG or PNG.'
            : 'Some photos can’t be opened on this phone. Try JPEG or PNG.');
        }
      })();
      pendingWork = pendingWork.then(() => work);
    });

    // ---- back / save ----
    const backBtn = q('[data-back]');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (busy) return;
        // Photos added in this edit, and not saved, go away again.
        for (const pid of [...added]) { added.delete(pid); ctx.photos.remove(pid).catch(() => {}); }
        api.step((bd) => paintView(bd), { direction: 'back' });
      });
    }

    saveBtn.addEventListener('click', async () => {
      if (busy) return;
      const problem = formProblem({ title: titleEl.value, day: dayEl.value, now: Date.now() });
      if (problem) {
        showError(body, problem);
        (problem.includes('name') ? titleEl : dayEl).focus();
        return;
      }
      busy = true;
      saveBtn.style.setProperty('min-width', `${saveBtn.offsetWidth}px`);
      saveBtn.setAttribute('aria-busy', 'true');
      await pendingWork; // photos still being made smaller
      if (!api.isOpen()) return;
      const startTime = startFor(dayEl.value, { keep: keepTime });
      const title = titleEl.value.trim();
      const key = st.key && PRESET_BY_KEY.has(st.key) ? st.key : null;
      const data = { key, title, photoIds: st.photos.slice(0, MAX_PHOTOS) };
      try {
        if (editing) {
          const patch = { startTime, endTime: startTime, note: noteEl.value.trim(), data };
          if (multi() && st.babyId && st.babyId !== editing.babyId) patch.babyId = st.babyId;
          const before = photosOf(editing);
          ev = await ctx.events.update(editing.id, patch);
          // Photos taken out of this memory are deleted now that it's saved.
          for (const pid of before) if (!data.photoIds.includes(pid)) ctx.photos.remove(pid).catch(() => {});
        } else {
          const input = { type: 'milestone', startTime, note: noteEl.value.trim(), data };
          if (st.babyId) input.babyId = st.babyId;
          ev = await ctx.events.add(input);
        }
      } catch (err) {
        console.warn('memory sheet: not saved', err);
        busy = false;
        saveBtn.removeAttribute('aria-busy');
        saveBtn.style.removeProperty('min-width');
        showError(body, 'That didn’t save. Check the day and try again.');
        return;
      }
      added.clear(); // they belong to the memory now
      saveBtn.removeAttribute('aria-busy');
      saveBtn.classList.add('is-success');
      render(saveBtn, html`${I('check', 22)}Saved`);
      closingFor = 'saved';
      await wait(SUCCESS_HOLD_MS);
      if (api.isOpen()) api.close('saved');
    });

    paintChips();
    paintAge();
    paintPhotos();
    return null;
  }

  // ------------------------------------------------------------ gone

  function paintGone(body) {
    view = 'gone';
    api.setTitle('Memory');
    render(body, html`<div class="empty-state cat-mem mem-gone">
        <span class="empty-disc">${I('spark', 30)}</span>
        <h3 class="empty-title">This memory is gone</h3>
        <p class="empty-text">It was deleted, maybe on another tab. Nothing else changed.</p>
        <button type="button" class="btn btn-secondary" data-close>Close</button>
      </div>`);
    body.querySelector('[data-close]').addEventListener('click', () => api.close());
  }

  // ------------------------------------------------------------ open

  const startsInView = !!eventId;
  api = ctx.openSheet({
    title: startsInView ? (ev ? (mode === 'edit' ? 'Edit memory' : titleOf(ev)) : 'Memory') : 'Add a memory',
    origin,
    className: 'sheet-memory',
    onClose() {
      // Photos picked in this sheet but never saved don't stay on the phone.
      for (const pid of added) ctx.photos.remove(pid).catch(() => {});
      added.clear();
    },
    render(body, sheetApi) {
      api = sheetApi;
      if (!startsInView) paintForm(body);
      else if (ev) { if (mode === 'edit') paintForm(body, { editing: ev }); else paintView(body); } else render(body, html`<div class="mem-sheet"><p class="sheet-text mem-loading">Opening…</p></div>`);
      return null;
    },
  });

  // Keep the view honest while it's open: edited or deleted elsewhere.
  if (startsInView) {
    const off = ctx.events.subscribe((change) => {
      if (!api.isOpen() || closingFor || !change) return;
      if (change.op === 'bulk') {
        ctx.events.get(eventId).then((fresh) => {
          if (!api.isOpen() || closingFor) return;
          if (!fresh) { paintGone(api.body); return; }
          ev = fresh;
          if (view === 'view') paintView(api.body);
        }).catch(() => {});
        return;
      }
      const ce = change.event;
      if (!ce || ce.id !== eventId) return;
      if (change.op === 'remove') { paintGone(api.body); return; }
      ev = ce;
      if (view === 'view') paintView(api.body);
    });
    api.closed.then(off, off);
    if (!ev) {
      ctx.events.get(eventId).then((fresh) => {
        if (!api.isOpen()) return;
        if (!fresh || fresh.type !== 'milestone') { paintGone(api.body); return; }
        ev = fresh;
        if (mode === 'edit') paintForm(api.body, { editing: ev }); else paintView(api.body);
      }).catch((err) => {
        console.error('memory sheet: load failed', err);
        if (api.isOpen()) paintGone(api.body);
      });
    }
  }
  return api;
}

// ================================================================ controls

/** Roving radio buttons (segmented control): click, arrows, Home/End. */
function bindRadios(container, onPick) {
  if (!container) return;
  const items = () => [...container.querySelectorAll('[role="radio"]')].filter((b) => !b.disabled);
  const pick = (btn, focus) => {
    for (const b of items()) {
      const on = b === btn;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    if (focus) btn.focus();
    onPick(btn);
  };
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[role="radio"]');
    if (!btn || btn.disabled || !container.contains(btn) || btn.getAttribute('aria-checked') === 'true') return;
    pick(btn, false);
  });
  container.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (i === -1) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j === null) return;
    e.preventDefault();
    pick(list[j], true);
  });
}

/**
 * One-time wiring at boot (called by app.js): keep the "which firsts are
 * kept" cache current so the form's chips are right in its first frame.
 * No live pill (a memory never runs).
 * @param {object} ctx
 */
export function setup(ctx) {
  async function reload() {
    try {
      const list = await ctx.events.query({ type: 'milestone' });
      keptByBaby.clear();
      for (const e of list) bumpKept(e, 1);
    } catch (err) {
      console.warn('memory sheet: firsts not loaded', err);
    }
  }
  reload();
  ctx.events.subscribe((c) => {
    if (!c || c.op === 'bulk') { reload(); return; }
    if (c.op === 'add') bumpKept(c.event, 1);
    else if (c.op === 'remove') bumpKept(c.event, -1);
    else if (c.op === 'update') { bumpKept(c.prev, -1); bumpKept(c.event, 1); }
  });
}

// Exported for unit tests (pure).
export const _test = Object.freeze({ PRESETS, dateValue, noonOf, startFor, formProblem, ageLine, chipPresets, DAY });
