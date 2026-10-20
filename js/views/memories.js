// Memories: the keepsake book (DESIGN §6.8 MemoryCover + FirstsRow, §13
// Frame 6, §8.6 photos dimmed at night; ARCHITECTURE §3 milestone events,
// §5.2 view contract; AUDIT §6.3 Milestones & Memories).
//
//  - Header: eyebrow "<NAME>'S BOOK" (the active baby, never a pronoun),
//    "Memories", and the labelled outline action "Add" (camera) → the memory
//    sheet, which grows from it (#1).
//  - Cover print: the photo the family chose for this baby's cover (Use as
//    cover in the memory sheet → settings.memoryCovers[babyId]), else the
//    newest memory with a photo. Italic caption + "Fri, Oct 9 · 5 weeks".
//    A button: it opens that memory. No photo yet → a warm EmptyState with
//    the one primary action of the screen.
//  - Firsts: the 12 preset milestones. Kept ones are rows (newest first,
//    date · age at that day, a mounted print when there's a photo); then ONE
//    gentle suggestion — the next unkept first for this baby's age
//    ("Usually 3–4 months") with an outline "+ Add". "N of 12 kept".
//  - Below: the family's own memories, grouped by week of life ("Week 6",
//    "Oct 7–13"), as a 3-column grid of prints with captions.
//  - Footer: what the photos cost on this phone (subtle, with a lock).
//
// Rows/tiles are keyed and patched in place. Store changes that land while a
// sheet is open wait until it has closed, then new items slide in where they
// land (#9) and removed ones collapse — so a saved memory visibly arrives.
// Photos come from ctx.photos.get(id) (cached object URLs, never revoked
// here). Switching the active baby re-renders the whole book for that baby.
//
// Never imports another view or sheet: the sheet is ctx.sheets.memory.

const DAY = 24 * 60 * 60 * 1000;
const NEW_ROW_MS = 1500;        // > --dur-highlight (1200 ms)
const COVER_KEY = 'memoryCovers'; // settings: { [babyId]: eventId }

// The preset firsts. KEEP IN SYNC with js/sheets/memory.js (a view may not
// import a sheet; tests/memories.test.js checks the two tables match).
// min/max: the typical window in days, used only to pick ONE gentle
// suggestion; `usually` is the copy (DESIGN §10: calm, never a deadline).
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

// ================================================================ pure

/** Local midnight of a 'YYYY-MM-DD' birth date, or NaN. */
function birthMidnight(birthDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** Whole local days from midnight `fromMs` to the day of `ts` (DST-safe). */
function dayIndex(fromMs, ts) {
  const d = new Date(ts);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day - fromMs) / DAY);
}

/**
 * Age in whole days at `at`, or null when the birth date is unknown or later.
 * @param {string|null} birthDate 'YYYY-MM-DD'
 * @param {number} at epoch ms
 * @returns {number|null}
 */
function ageDays(birthDate, at) {
  const b = birthMidnight(birthDate);
  if (!Number.isFinite(b)) return null;
  const d = dayIndex(b, at);
  return d >= 0 ? d : null;
}

/** Is this memory one of the preset firsts? */
function presetOf(e) {
  const key = e && e.data && e.data.key;
  return (key && PRESET_BY_KEY.get(key)) || null;
}

/**
 * The ONE gentle suggestion: the next unkept first, in typical-age order,
 * whose window hasn't passed yet for this baby (else the earliest unkept
 * one). null when all twelve are kept.
 * @param {Set<string>} kept preset keys already kept
 * @param {number|null} days the baby's age in days (null = unknown)
 * @returns {object|null}
 */
function suggestNext(kept, days) {
  const open = PRESETS.filter((p) => !kept.has(p.key)).sort((a, b) => a.min - b.min || a.max - b.max);
  if (!open.length) return null;
  if (days === null || days === undefined) return open[0];
  return open.find((p) => p.max >= days) || open[0];
}

/**
 * Week-of-life group for a memory: { key, title, range }. With a birth date
 * on or before the memory: "Week 6" + the dates of that week ("Oct 7–13").
 * Otherwise a calendar week (Sunday start) with no week number.
 * @param {number} ts
 * @param {string|null} birthDate
 * @param {(ts: number, opts: object) => string} [fmt] date formatter (tests)
 * @returns {{ key: string, title: string, range: string, start: number }}
 */
function weekOf(ts, birthDate, fmt = defaultFmt) {
  const b = birthMidnight(birthDate);
  let start;
  let title;
  if (Number.isFinite(b) && dayIndex(b, ts) >= 0) {
    const week = Math.floor(dayIndex(b, ts) / 7);
    start = addLocalDays(b, week * 7);
    title = `Week ${week + 1}`;
  } else {
    const d = new Date(ts);
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
    title = '';
  }
  const end = addLocalDays(start, 6);
  return { key: `w${start}`, title, range: dayRange(start, end, fmt), start };
}

function addLocalDays(ms, n) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

function defaultFmt(ts, opts) { return new Date(ts).toLocaleDateString(undefined, opts); }

/** "Oct 7–13", "Sep 29 – Oct 5" (adds the year when it isn't this year). */
function dayRange(start, end, fmt = defaultFmt, now = Date.now()) {
  const s = new Date(start);
  const e = new Date(end);
  const yearOpt = s.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {};
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${fmt(start, { month: 'short', day: 'numeric' })}–${fmt(end, { day: 'numeric', ...yearOpt })}`;
  }
  return `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', ...yearOpt })}`;
}

/** "6 weeks, 3 days" → "6 weeks" for the cover's short line. */
function shortAge(age) {
  return /week/.test(age) ? age.split(',')[0] : age;
}

/** "820 KB", "3.4 MB". */
function bytesLabel(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}

/** First photo id of a memory, or null. */
function firstPhoto(e) {
  const ids = e && e.data && Array.isArray(e.data.photoIds) ? e.data.photoIds : [];
  return ids.find((id) => typeof id === 'string' && id) || null;
}

const newestFirst = (a, b) => (b.startTime - a.startTime) || ((b.createdAt || 0) - (a.createdAt || 0)) || String(a.id).localeCompare(String(b.id));

/**
 * Everything the book shows for one baby. Pure.
 * @param {object[]} list milestone events for this baby
 * @param {{ birthDate: string|null, coverId: string|null, now: number }} o
 */
function bookModel(list, { birthDate, coverId, now }) {
  const all = list.slice().sort(newestFirst);
  const firsts = all.filter((e) => presetOf(e));
  const own = all.filter((e) => !presetOf(e));
  const kept = new Set(firsts.map((e) => e.data.key));
  const withPhoto = all.filter(firstPhoto);
  const cover = (coverId && withPhoto.find((e) => e.id === coverId)) || withPhoto[0] || null;
  const groups = [];
  for (const e of own) {
    const w = weekOf(e.startTime, birthDate);
    let g = groups.find((x) => x.key === w.key);
    if (!g) { g = { ...w, items: [] }; groups.push(g); }
    g.items.push(e);
  }
  groups.sort((a, b) => b.start - a.start);
  return {
    total: all.length,
    cover,
    firsts,
    keptCount: kept.size,
    suggestion: suggestNext(kept, ageDays(birthDate, now)),
    groups,
  };
}

// ================================================================ view

export default {
  id: 'memories',
  title: 'Memories',
  /**
   * @param {HTMLElement} root the view's scrolling <section>
   * @param {object} ctx app ctx (ARCHITECTURE §5.2)
   * @returns {{ unmount: () => void }}
   */
  mount(root, ctx) {
    const { html, render, element } = ctx.html;
    const I = (name, size = 20) => ctx.icons.iconHtml(name, { size });
    const F = ctx.format;

    render(root, html`<div class="view-pad mem">
        <header class="page-hd is-compact mem-hd">
          <div class="mem-hd-text"><p class="eyebrow" data-eyebrow></p><h1 class="page-title">Memories</h1></div>
          <div class="hd-actions">
            <button type="button" class="btn btn-outline" data-action="add" aria-label="Add a memory">${I('camera', 20)}Add</button>
          </div>
        </header>
        <div class="mem-cover-slot" data-cover></div>
        <section class="mem-firsts" aria-labelledby="mem-firsts-title">
          <div class="sec-hd"><h2 class="sec-title" id="mem-firsts-title">Firsts</h2><span class="sec-meta num" data-kept></span></div>
          <ul class="firsts cat-mem" data-firsts></ul>
        </section>
        <div class="mem-weeks" data-weeks></div>
        <p class="note mem-storage" data-storage></p>
      </div>`);
    const eyebrowEl = root.querySelector('[data-eyebrow]');
    const coverEl = root.querySelector('[data-cover]');
    const keptEl = root.querySelector('[data-kept]');
    const firstsEl = root.querySelector('[data-firsts]');
    const weeksEl = root.querySelector('[data-weeks]');
    const storageEl = root.querySelector('[data-storage]');

    let stopped = false;
    let ready = false;
    let seq = 0;
    let shownBaby = null;
    let model = null;
    let dirty = false;
    let dirtyAnimate = true;
    let coverSig = '';
    let storageSig = '';
    let coverIdNow = null;
    const timers = new Set();

    const baby = () => ctx.activeBaby() || null;
    const name = () => F.babyName(baby());
    const covers = () => {
      const v = ctx.settings.get(COVER_KEY);
      return v && typeof v === 'object' ? v : {};
    };
    const dateLine = (e) => {
      const age = F.babyAge(baby() && baby().birthDate, e.startTime);
      return age ? `${F.dateLabel(e.startTime)} · ${age}` : F.dateLabel(e.startTime);
    };
    const titleOf = (e) => F.eventTitle(e);

    // ------------------------------------------------------------ load
    async function load() {
      const b = baby();
      const list = await ctx.events.query({ type: 'milestone', babyId: b ? b.id : undefined });
      return { babyId: b ? b.id : null, list };
    }

    // ------------------------------------------------------------ photos
    /** Fill every <img data-photo> that has no src yet from the photo store. */
    function hydrate(scope) {
      for (const img of scope.querySelectorAll('img[data-photo]:not([src]):not([data-h])')) {
        const id = img.dataset.photo;
        img.dataset.h = '1'; // asked for once
      img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
        ctx.photos.get(id).then((url) => {
          if (stopped || !img.isConnected || img.dataset.photo !== id) return;
          if (url) img.src = url; else img.closest('.print, .mem-cover, .mem-tile')?.classList.add('is-missing');
        }).catch(() => {});
      }
    }
    const photoImg = (id, cls, alt = '') => (id ? html`<img class="${cls}" data-photo="${id}" alt="${alt}" decoding="async">` : '');

    // ------------------------------------------------------------ keyed lists
    const isLeaving = (n) => n.classList.contains('is-removing');
    function markNew(li) {
      li.classList.add('is-inserting');
      const t = setTimeout(() => { timers.delete(t); li.classList.remove('is-inserting'); }, NEW_ROW_MS);
      timers.add(t);
      // A memory that lands below the fold is brought into view (#9: the
      // eye follows where it went).
      const r = li.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      if (r.top > box.bottom - 120 || r.bottom < box.top) li.scrollIntoView({ block: 'center', behavior: ctx.motionReduced() ? 'auto' : 'smooth' });
    }
    function removeNode(node, animate) {
      if (node.contains(document.activeElement)) {
        let next = node.nextElementSibling;
        while (next && isLeaving(next)) next = next.nextElementSibling;
        const target = (next && next.querySelector('button')) || (node.previousElementSibling && node.previousElementSibling.querySelector('button'));
        if (target) target.focus({ preventScroll: true }); else root.focus({ preventScroll: true });
      }
      if (!animate || !ready || ctx.motionReduced()) { node.remove(); return; }
      node.style.setProperty('max-height', `${node.offsetHeight}px`);
      node.getBoundingClientRect();
      node.classList.add('is-removing');
      let gone = false;
      const done = () => { if (!gone) { gone = true; node.remove(); } };
      node.addEventListener('transitionend', (e) => { if (e.target === node) done(); });
      const t = setTimeout(() => { timers.delete(t); done(); }, 420);
      timers.add(t);
    }
    /**
     * Patch `container`'s keyed <li> children to `items` ({ key, sig, tpl }).
     * Unchanged items keep their node (focus + pressed state survive); changed
     * ones re-render inside the same <li>; new ones slide in when animating.
     */
    function sync(container, items, { animate }) {
      const existing = new Map();
      for (const n of container.children) if (!isLeaving(n)) existing.set(n.dataset.key, n);
      const want = new Set(items.map((i) => i.key));
      for (const [k, n] of existing) if (!want.has(k)) removeNode(n, animate);
      let prev = null;
      const added = [];
      for (const it of items) {
        let n = existing.get(it.key);
        if (n) {
          if (n.dataset.sig !== it.sig) {
            const hadFocus = n.contains(document.activeElement);
            const focusSel = hadFocus && document.activeElement.dataset.focus ? `[data-focus="${document.activeElement.dataset.focus}"]` : 'button';
            render(n, it.tpl);
            n.dataset.sig = it.sig;
            if (hadFocus) { const f = n.querySelector(focusSel) || n.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
          }
        } else {
          n = element(html`<li data-key="${it.key}" data-sig="${it.sig}"></li>`);
          render(n, it.tpl);
          added.push(n);
        }
        // keep order (skip nodes still collapsing out)
        let ref = prev ? prev.nextElementSibling : container.firstElementChild;
        while (ref && isLeaving(ref) && ref !== n) ref = ref.nextElementSibling;
        if (ref !== n) container.insertBefore(n, ref);
        prev = n;
      }
      for (const n of added) {
        hydrate(n);
        if (animate && ready) markNew(n);
      }
      for (const n of existing.values()) if (n.isConnected) hydrate(n);
    }

    // ------------------------------------------------------------ paint
    function paintHeader() {
      eyebrowEl.textContent = `${F.possessive(name())} book`;
    }

    function paintCover(m) {
      const e = m.cover;
      const sig = e ? `c|${e.id}|${firstPhoto(e)}|${titleOf(e)}|${e.startTime}|${baby() && baby().birthDate}` : `e|${m.total ? 'nophoto' : 'none'}|${name()}`;
      if (sig === coverSig) return;
      const hadFocus = coverEl.contains(document.activeElement);
      coverSig = sig;
      if (e) {
        const p = presetOf(e);
        const caption = p ? p.caption : titleOf(e);
        const age = F.babyAge(baby() && baby().birthDate, e.startTime);
        const when = age ? `${F.dateLabel(e.startTime)} · ${shortAge(age)}` : F.dateLabel(e.startTime);
        render(coverEl, html`<button type="button" class="cover mem-cover ${ready ? 'is-entering' : ''}" data-open="${e.id}" data-focus="cover"
            aria-label="${`Cover photo: ${caption}, ${when}. Open this memory`}">
            ${photoImg(firstPhoto(e), 'cover-photo')}
            <span class="cover-cap"><span class="it">${caption}</span><small class="num">${when}</small></span>
          </button>`);
        hydrate(coverEl);
      } else {
        const none = !m.total;
        render(coverEl, html`<div class="empty-state cat-mem mem-cover-empty ${ready ? 'is-entering' : ''}">
            <span class="empty-disc">${I(none ? 'book' : 'camera', 30)}</span>
            <h2 class="empty-title">${none ? `${F.possessive(name())} book starts here` : 'No photos yet'}</h2>
            <p class="empty-text">${none
              ? 'Keep firsts, photos and little notes. They stay on this phone.'
              : `Add a photo to a memory and it becomes the cover of ${F.possessive(name())} book.`}</p>
            <button type="button" class="btn btn-primary" data-action="add" data-focus="cover">${I('camera', 22)}${none ? 'Add a memory' : 'Add a photo'}</button>
          </div>`);
      }
      if (hadFocus) {
        const f = coverEl.querySelector('[data-focus="cover"]');
        if (f) f.focus({ preventScroll: true });
      }
    }

    function firstRowItem(e) {
      const photo = firstPhoto(e);
      const line = dateLine(e);
      const title = titleOf(e);
      return {
        key: e.id,
        sig: `${title}|${line}|${photo}`,
        tpl: html`<button type="button" class="first-row" data-open="${e.id}" aria-label="${`${title}, ${line}${photo ? ', with a photo' : ''}. Open`}">
            <span class="spark-chip">${I('spark', 22)}</span>
            <span class="first-text"><b>${title}</b><small class="num">${line}</small></span>
            ${photo ? html`<span class="print">${photoImg(photo, '')}</span>` : ''}
          </button>`,
      };
    }

    function paintFirsts(m, { animate }) {
      keptEl.textContent = `${m.keptCount} of ${PRESETS.length} kept`;
      const items = m.firsts.map(firstRowItem);
      const s = m.suggestion;
      if (s) {
        items.push({
          key: `suggest:${s.key}`,
          sig: s.key,
          tpl: html`<div class="first-row is-suggested">
              <span class="spark-chip">${I('spark', 22)}</span>
              <span class="first-text"><span class="it">${s.title}</span><small>${s.usually}</small></span>
              <button type="button" class="btn btn-outline mem-suggest-add" data-suggest="${s.key}" aria-label="${`Add ${s.title}`}">${I('plus', 20)}Add</button>
            </div>`,
        });
      }
      sync(firstsEl, items, { animate });
    }

    function tileTpl(e) {
      const photo = firstPhoto(e);
      const title = titleOf(e);
      const line = dateLine(e);
      return html`<button type="button" class="mem-tile ${photo ? '' : 'is-text'}" data-open="${e.id}" aria-label="${`${title}, ${line}${photo ? ', with a photo' : ''}. Open`}">
          <span class="mem-tile-ph">${photo ? photoImg(photo, '') : html`<span class="mem-tile-ic">${I('spark', 22)}</span>`}</span>
          <span class="mem-tile-cap">${title}</span>
        </button>`;
    }

    function paintWeeks(m, { animate }) {
      const groups = m.groups.map((g) => ({ key: g.key, group: g }));
      // Groups: keep the <section> (and its keyed tiles) when it exists.
      const existing = new Map();
      for (const n of weeksEl.children) if (!isLeaving(n)) existing.set(n.dataset.key, n);
      const want = new Set(groups.map((g) => g.key));
      for (const [k, n] of existing) if (!want.has(k)) removeNode(n, animate);
      let prev = null;
      for (const g of groups) {
        let sec = existing.get(g.key);
        const head = html`<div class="sec-hd"><h2 class="sec-title">${g.group.title || g.group.range}</h2>${g.group.title ? html`<span class="sec-meta num">${g.group.range}</span>` : ''}</div>`;
        const isNew = !sec;
        if (isNew) {
          sec = element(html`<section class="mem-week" data-key="${g.key}"><div data-head></div><ul class="grid3 mem-grid cat-mem" data-grid></ul></section>`);
        }
        render(sec.querySelector('[data-head]'), head);
        let ref = prev ? prev.nextElementSibling : weeksEl.firstElementChild;
        while (ref && isLeaving(ref) && ref !== sec) ref = ref.nextElementSibling;
        if (ref !== sec) weeksEl.insertBefore(sec, ref);
        // a brand-new week: its tiles arrive with it (the section animates)
        sync(sec.querySelector('[data-grid]'), g.group.items.map((e) => ({ key: e.id, sig: `${titleOf(e)}|${firstPhoto(e)}|${dateLine(e)}`, tpl: tileTpl(e) })), { animate: animate && !isNew });
        if (isNew && animate && ready) markNew(sec);
        prev = sec;
      }
    }

    async function paintStorage() {
      let u = null;
      try { u = await ctx.photos.usage(); } catch { u = null; }
      if (stopped) return;
      const sig = u ? `${u.count}|${u.bytes}` : 'x';
      if (sig === storageSig) return;
      storageSig = sig;
      if (!u || !u.count) {
        render(storageEl, html`${I('lock', 16)}<span>Photos you add stay on this phone, and nowhere else.</span>`);
      } else {
        render(storageEl, html`${I('lock', 16)}<span>Only on this phone · <span class="num">${F.plural(u.count, 'photo')} · ${bytesLabel(u.bytes)}</span></span>`);
      }
    }

    function paint({ animate }) {
      if (!model) return;
      const b = baby();
      const m = bookModel(model.list, { birthDate: b && b.birthDate, coverId: b ? covers()[b.id] || null : null, now: Date.now() });
      coverIdNow = m.cover ? m.cover.id : null;
      paintHeader();
      paintCover(m);
      paintFirsts(m, { animate });
      paintWeeks(m, { animate });
      paintStorage();
      ready = true;
    }

    async function refresh({ animate = true } = {}) {
      const my = (seq += 1);
      let next;
      try { next = await load(); } catch (err) { console.error('Memories: load failed', err); return; }
      if (stopped || my !== seq) return;
      // Another baby: a fresh book, no slide-ins.
      if (shownBaby !== null && next.babyId !== shownBaby) {
        animate = false;
        render(firstsEl, null);
        render(weeksEl, null);
        coverSig = '';
      }
      shownBaby = next.babyId;
      model = next;
      paint({ animate });
    }

    // Store changes under an open sheet wait until it has closed (#9).
    const sheetOpen = () => document.documentElement.classList.contains('has-sheet');
    let queued = null;
    function queueRefresh(animate) {
      if (queued) { queued.animate = queued.animate && animate; return; }
      queued = { animate };
      queueMicrotask(() => { const q = queued; queued = null; refresh(q); });
    }
    function onStoreChange({ animate = true } = {}) {
      if (sheetOpen()) { dirty = true; dirtyAnimate = dirtyAnimate && animate; return; }
      queueRefresh(animate);
    }
    function flushDirty() {
      if (!dirty || sheetOpen()) return;
      dirty = false;
      const a = dirtyAnimate;
      dirtyAnimate = true;
      queueRefresh(a);
    }
    const sheetWatch = new MutationObserver(flushDirty);
    sheetWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // ------------------------------------------------------------ actions
    const onClick = (e) => {
      const t = e.target.closest('[data-open], [data-suggest], [data-action]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.open) {
        const ev = model && model.list.find((x) => x.id === t.dataset.open);
        ctx.sheets.memory({ origin: t, id: t.dataset.open, event: ev, coverId: coverIdNow });
      } else if (t.dataset.suggest) {
        ctx.sheets.memory({ origin: t, preset: { key: t.dataset.suggest } });
      } else if (t.dataset.action === 'add') {
        ctx.sheets.memory({ origin: t });
      }
    };
    root.addEventListener('click', onClick);
    const onAnimEnd = (e) => { if (e.target.classList && e.target.classList.contains('is-entering')) e.target.classList.remove('is-entering'); };
    root.addEventListener('animationend', onAnimEnd);

    // ------------------------------------------------------------ subscriptions
    const offEvents = ctx.events.subscribe((c) => {
      if (!c || c.op === 'bulk') { onStoreChange({ animate: false }); return; }
      if ((c.event && c.event.type === 'milestone') || (c.prev && c.prev.type === 'milestone')) onStoreChange({ animate: true });
    });
    const offSettings = ctx.settings.subscribe((c) => {
      const key = c && c.key;
      if (key === '*' || key === 'activeBabyId' || key === 'babies' || key === COVER_KEY) onStoreChange({ animate: false });
    });
    const offPhotos = typeof ctx.photos.subscribe === 'function'
      ? ctx.photos.subscribe((c) => {
        storageSig = '';
        if (c && c.op === 'bulk') { coverSig = ''; render(firstsEl, null); render(weeksEl, null); onStoreChange({ animate: false }); } else paintStorage();
      })
      : () => {};
    // Ages and "this week" move with the calendar.
    const onVisibility = () => { if (!document.hidden) onStoreChange({ animate: false }); };
    document.addEventListener('visibilitychange', onVisibility);

    refresh({ animate: false });

    return {
      unmount() {
        stopped = true;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        sheetWatch.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        root.removeEventListener('click', onClick);
        root.removeEventListener('animationend', onAnimEnd);
        offEvents();
        offSettings();
        offPhotos();
      },
    };
  },
};

// Exported for unit tests (pure).
export const _test = Object.freeze({ PRESETS, suggestNext, weekOf, dayRange, shortAge, bytesLabel, ageDays, bookModel });
