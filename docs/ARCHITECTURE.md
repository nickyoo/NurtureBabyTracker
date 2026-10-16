# Nurture v2 — Architecture Contract

This is the contract every module in the v2 rebuild codes against. If you are building a view or a sheet, **you may only depend on the APIs in this file**; if you need something that isn't here, it belongs in the foundation, not in your module.

Companion docs: `docs/AUDIT.md` (what's broken + product decisions), `docs/DESIGN.md` (visual system, motion contract, screen layouts).

Stack stays: static HTML + CSS + native ES modules, **no framework, no build step, no runtime dependencies**. Tests use Node's built-in `node:test`; e2e uses Playwright (dev only).

---

## 1. Principles

1. **Private by construction.** No network requests after load. No `fetch()` to anything but same-origin static files. No third-party scripts, fonts, images, or analytics. CSP enforces it (§9).
2. **One source of truth per thing.** Events (things that happened) live in the `events` store. Milk pouches (stateful objects) live in `inventory`. Photos live in `photos`. Preferences + profile live in `settings`. Nothing important lives in `localStorage` (only per-device UI conveniences).
3. **Safe rendering by default.** All HTML is built with the `html` tagged template (§5.1), which escapes every interpolation. Raw HTML requires an explicit `raw()` and is reserved for our own static SVG icons.
4. **Every surface has an origin.** Sheets, toasts, rows and pills follow the motion contract in DESIGN.md: they enter from and exit to the thing that summoned them.
5. **Reversible over confirmable.** Deletes and "mark used / discard" happen immediately with an **Undo** toast. Only truly destructive, non-undoable actions (erase all data, import-replace) use a confirm sheet. No `alert()` / `confirm()` / `prompt()` anywhere.

---

## 2. File layout

```
index.html                 App shell only (see §8). No inline <script>, no style="" attributes.
manifest.json
sw.js                      Offline cache (asset list must list every file below)
netlify.toml               Headers: CSP, cache policy (§9)
fonts/                     Self-hosted woff2 + OFL licenses
icons/                     Static app icons
css/
  tokens.css               Design tokens (from DESIGN.md) — light on :root, dark on [data-theme="dark"]
  base.css                 Reset, typography, layout primitives, focus ring, utilities
  components.css           Button, Card, QuickLogCard, ListRow, Chip, Segmented, Stepper, Toggle,
                           EmptyState, Avatar, Badge, Sheet, Toast, LivePill, Nav, Header, TimelineStrip
  views/<view>.css         One file per view (today, timeline, stash, memories, settings, onboarding)
  sheets/<sheet>.css       One file per sheet family (feed, pump, sleep, diaper, quicklog, event, stash, memory)
js/
  app.js                   Bootstrap only: theme, migration, router, nav, live pill, register views/sheets
  core/
    db.js                  IndexedDB v2 wrapper (low level; only core/* imports it)
    store.js               Events API + change bus (§4)
    stash.js               Inventory API (wraps existing FIFO/expiry engine) + change bus
    photos.js              Photo blobs: add (downscale), get URL, delete
    settings.js            Settings + profile + tracker visibility (§6)
    units.js               oz/mL conversion + formatting (pure)
    time.js                Relative time ("2h 10m ago"), durations, day bounds (pure)
    migrate.js             v1 → v2 migration (pure transforms + IDB glue)
    backup.js              Export (JSON v2, CSV) / import (validate + merge) / share (pure validation core)
    reminders.js           Pump schedule from events (pure core + timer)
    audio.js               Chimes (default OFF at night) + haptics
  domain/
    inventory.js           Existing FIFO + CDC expiry engine (kept; pure helpers stay tested)
    safety.js              Bottle safety windows, pace (pure; moved from app.js)
    sleep.js               Wake windows by age, nap/night classification (pure)
    trends.js              Aggregates over events (pure)
  ui/
    html.js                html`` tagged template + raw() + render(target, template)
    icons.js               icon(name, {size}) → raw SVG string; category → icon map
    sheet.js               openSheet() (§7.1)
    toast.js               toast() with Undo (§7.2)
    confirm.js             confirmSheet() → Promise<boolean> (§7.3)
    router.js              Tabs + pushed screens + history integration (§7.4)
    livePill.js            Running-activity pills above the nav (§7.5)
    format.js              Shared display helpers built on units/time (e.g. eventSummary(event))
  views/
    today.js  timeline.js  stash.js  memories.js  settings.js  onboarding.js
  sheets/
    quickLog.js            The "+" sheet: grid of log types (respects tracker visibility)
    feed.js                Bottle (formula / breast milk / thawed source) + breastfeeding L/R + live bottle
    pump.js                Pump timer + log past pump + store-to-stash
    sleep.js               Start/stop sleep + log past sleep
    diaper.js              One-tap wet/dirty/both + optional details
    event.js               Event detail: view / edit / delete (+undo) for any event type
    stash.js               Add pouch, pouch detail (thaw / feed / used / discard)
    memory.js              Add/edit milestone or memory with photo
tests/
  *.test.js                node:test unit tests (pure modules only)
  e2e/*.mjs                Playwright walkthroughs (run against `python3 -m http.server`)
```

Legacy v1 modules (`dashboardView.js`, `feedFlow.js`, `pumpTimerView.js`, `inventoryView.js`, `settingsView.js`, `bottles.js`, `viewHelpers.js`, `css/style.css`) are deleted once their behavior is ported. Their pure helpers move (with their tests) into `domain/` and `core/`.

---

## 3. Data model (IndexedDB `NurtureDB`, version 2)

### Stores

| Store | keyPath | Indexes | Notes |
|---|---|---|---|
| `events` | `id` | `type`, `startTime`, `type_startTime` (`['type','startTime']`), `endTime` | Everything that happened. |
| `inventory` | `id` | `status`, `expiresAt`, `pumpedAt`, `location` | Unchanged shape from v1 (milk pouches). |
| `photos` | `id` | `createdAt` | `{ id, blob, width, height, createdAt }`. |
| `settings` | `key` | — | `{ key, value }`. Profile + preferences (§6). |
| `sessions` | `id` | (v1) | **Read-only legacy.** Kept one release for rollback, never written. |
| `bottles` | `id` | (v1) | Legacy, unused. Left in place. |

### Event record

```js
{
  id: 'evt_<uuid>',
  type: 'feed' | 'pump' | 'sleep' | 'diaper' | 'milestone',
  startTime: 1734300000000,     // epoch ms
  endTime: null | number,       // null = RUNNING (live activity)
  note: '',                     // user text, plain (never HTML)
  data: { ... },                // per-type, below
  createdAt, updatedAt,         // epoch ms
  babyId: 'baby_<uuid>' | null, // which child (twins/siblings). null ONLY for parent-level events (pump)
  deviceId: 'dev_<uuid>',       // set once per install (settings.deviceId); future sync merge key
  migratedFrom?: 'sess_…'       // v1 provenance
}
```

Per-type `data`:

| type | data |
|---|---|
| `feed` | `{ method: 'bottle', milk: 'formula'\|'breastmilk', amount: number, unit: 'oz'\|'mL', prepared?: number, sourceInventoryId?: string }` **or** `{ method: 'breast', left: sec, right: sec, lastSide: 'left'\|'right', activeSide?: 'left'\|'right'\|null, activeSince?: number\|null }` |
| `pump` | `{ amount: number, unit, storedTo: 'fridge'\|'freezer'\|'deepFreezer'\|null, inventoryId?: string }` |
| `sleep` | `{ kind: 'nap'\|'night' }` |
| `diaper` | `{ kind: 'wet'\|'dirty'\|'both'\|'dry', color?: string, consistency?: string }` |
| `milestone` | `{ key?: 'first-smile'\|…\|null, title: string, photoIds: string[] }` |

**Multiple babies.** Every `feed`, `sleep`, `diaper` and `milestone` event carries the `babyId` of the child it's about; `pump` events are the parent's and carry `babyId: null`. The milk stash (`inventory`) is family-level (no `babyId`) — a feed *from* a pouch records the baby. Queries take an optional `babyId` and views pass the active baby. The UI shows a baby switcher (avatar row in Today's header) only once a second baby exists; with one baby nothing about multi-baby is visible. Migration assigns every v1 event to a single default baby created from the v1 `babyName`. One running activity per **type per baby** (twins can nap at the same time).

Amounts are stored **in the unit they were entered in** with the unit recorded; all display/totals go through `core/units.js` (`convertQty`, `sumAmounts`). Never assume oz.

### Live activities

A running activity is simply an event with `endTime: null`:
- **Bottle feed** (`feed`, method bottle): safety countdown derives from `startTime` + `domain/safety.js`. Finish → set `endTime`, final `amount`; cancel → delete.
- **Breastfeeding**: `data.activeSide` + side seconds accumulate; `data.activeSince` (epoch ms) is when the live side started — `left`/`right` hold only *banked* seconds, the live side adds `now − activeSince` (`domain/safety.js` `breastSideTotals`). `activeSide` and `activeSince` always agree: a live side given without `activeSince` counts from `startTime` on create (`events.start('feed', { method:'breast', activeSide:'left' })`) and from *now* on edit. Switching sides is `events.update(id, { data: { activeSide } })`: without an explicit `activeSince` the old side's seconds are banked first (`switchBreastSide`). Stopping banks the live side up to `endTime`.
- **Pump timer**: amount entered on stop.
- **Sleep**: stop sets `endTime`.

Because they're persisted events, they survive reloads with no `localStorage`. At most one running activity per type (enforced in `store.start()`).

### v1 → v2 migration (`core/migrate.js`)

On upgrade (or first v2 boot if `settings.migratedV2 !== true`):
- each v1 `sessions` record → `sessionToEvent(s)` (pure, unit-tested):
  - `pump` → `{ type:'pump', startTime, endTime, data:{ amount: s.outputQty, unit: s.unit||'oz', storedTo: null } }`
  - `feed` → `{ type:'feed', data:{ method:'bottle', milk: s.feedType==='formula'?'formula':'breastmilk', amount: s.outputQty, unit: s.unit||'oz' } }`, `endTime = startTime + durationSec*1000` (or startTime)
  - non-finite `outputQty` (the v1.6 NaN bug) → `amount: null` and `note` "Amount wasn't recorded" so the UI shows "—" and offers edit.
  - times v1 accepted are never a reason to drop a record (v1's edit modal takes any date): a session ending more than a day in the future is moved to **end now** (length kept), a `durationSec` over 24 h is capped, and the note gets "Time was adjusted (please check)". `runMigration()` reports `rejected` / `rejectedIds` for sessions that truly can't be migrated (unknown type, no usable time) so the UI can tell the parent.
  - auto-generated v1 notes ("Formula Feeding", "Breast Milk Bottle Feed", "Pumped session (…)") are dropped; real user notes kept.
- v1 settings keys mapped: `dailyGoalOz`, `pumpIntervalMinutes`, `units`, `themeMode`, `soundEnabled`, `storageWindows`, `parentName`, `babyName`, `onboarding_completed` → v2 settings (§6). Junk keys (`dailyPumpingGoal`, `reminderIntervalHours`, `preferredUnit`) ignored.
- v1 `localStorage` live timers (`nurture_active_pump_timer`, `nurture_bottle_timer`) → running events, then the keys are removed.
- Idempotent: events keep `migratedFrom`; re-running skips existing ids.

---

## 4. `core/store.js` — events API

```js
import { events } from './core/store.js'

await events.add({ type, startTime, endTime, note, data })        // → event (id/createdAt/updatedAt/deviceId filled)
await events.update(id, patch)                                   // shallow-merges top level, deep-merges data → event
await events.remove(id)                                          // → removed event (for undo)
await events.restore(event)                                      // re-put a removed event (undo)
await events.get(id)
await events.query({ type?, types?, from?, to?, running?, babyId? })  // sorted by startTime DESC; babyId filters to that baby + parent-level (null) events
await events.last(type, predicate?)                              // most recent finished event of type
await events.running(type?)                                      // events with endTime === null
await events.start(type, data, { startTime? })                   // creates running event; throws if one of that type runs
await events.stop(id, patch?)                                    // sets endTime = now (or patch.endTime), merges patch
events.subscribe(fn)                                             // fn({ op:'add'|'update'|'remove', event }) → unsubscribe()
```

`stash.js` mirrors this for inventory: `stash.add/update/thaw/markUsed/discard/restore/list({filter})/summary()/frozen()/thawed()/subscribe(fn)`. Thawing, using and discarding emit change events so every view (Today's stash card, Stash tab, feed sheet sources, urgent hints) re-renders without manual cross-calls.

`settings.subscribe(fn)` likewise, for units / theme / tracker visibility changes.

**Views never call each other.** They subscribe to the stores and re-render. This is what kills the v1 class of "tile didn't refresh" bugs.

---

## 5. Rendering

### 5.1 `ui/html.js`

```js
import { html, raw, render } from '../ui/html.js'
const t = html`<li class="row">${event.note}</li>`   // event.note is escaped
render(container, t)                                   // sets innerHTML from the safe template
html`<span>${raw(icon('bottle'))}</span>`              // raw() ONLY for our own static SVG strings
```

Arrays of templates interpolate as concatenated safe HTML. Attribute values are escaped too (quotes included). No `style="…"` in templates — CSP blocks it; use classes or set CSSOM properties (`el.style.setProperty('--fill', '42%')` is allowed).

### 5.2 View module contract

```js
// js/views/today.js
export default {
  id: 'today',
  title: 'Today',
  mount(root, ctx) { /* build DOM, subscribe to stores */ return { unmount() {} } },
}
```

`ctx` = `{ router, openSheet, toast, confirmSheet, settings, events, stash, photos, units, time, format, icons }` — everything a view needs, injected, so views don't import siblings.

### 5.3 Sheet module contract

```js
// js/sheets/feed.js
export function openFeedSheet(ctx, { origin, preset } = {}) → sheetApi
```

Every sheet is opened through `ctx.openSheet` and accepts an `origin` element so the motion contract can animate from it. Sheets register themselves for the live pill: `livePill.register('feed', (event, origin) => openFeedSheet(ctx, { origin, resume: event }))`.

---

## 6. `core/settings.js`

```js
settings.get(key) / settings.set(key, value) / settings.all() / settings.subscribe(fn)
```

| key | default | notes |
|---|---|---|
| `babies` | `[{ id, name:'', birthDate:null, photoId:null, createdAt }]` | at least one; v1 migration creates it from `babyName` |
| `activeBabyId` | first baby's id | which child Today/Timeline/sheets show |
| `parentName` | `''` | |
| `lastBackupAt` | `null` | drives the weekly backup nudge |
| `persistGranted` | `null` | result of `navigator.storage.persist()` |
| `feedbackEmail` | `''` | owner-configured mailto target (no tracking) |
| `units` | `'oz'` | |
| `theme` | `'auto'` | `'auto'` = follow system `prefers-color-scheme`, plus "night hours" dimming (19:00–08:00) unless the user picks light/dark explicitly |
| `trackers` | all `true`: `{ bottle, formula, breastfeeding, pump, stash, sleep, diaper, memories }` | Hidden ≠ deleted |
| `todayOrder` | `['feed','sleep','diaper','pump','stash']` | Customize screen reorders |
| `pumpGoalOz` | `24` | stored in oz |
| `pumpIntervalMinutes` | `180` | |
| `storageWindows` | CDC defaults (v1 shape) | |
| `sound` | `'night-off'` | `'on' \| 'off' \| 'night-off'` |
| `deviceId` | generated once | |
| `onboarded` | `false` | |
| `migratedV2` | `false` | |

---

## 7. UI primitives

### 7.1 `openSheet({ title, origin, render, size, dismissible = true, onClose })`
- `render(body, api)` builds content; may return a cleanup fn.
- `api`: `{ close(result), setTitle(t), step(renderFn, { direction:'forward'|'back' }), el }`. `step()` swaps body content with the directional slide from the motion contract (forward = from right, back = from left), and animates sheet height.
- Motion: backdrop fades in; sheet rises from bottom; if `origin` is given, the sheet's transform-origin/x-offset start from the origin's center and the origin gets a pressed state while the sheet is open. Close reverses, then removes the node on `transitionend` (with a timeout fallback). Reduced motion → opacity only.
- Behavior: focus moves into the sheet, is trapped, and is restored to `origin` on close; `Esc`, backdrop tap and grabber drag-down dismiss when `dismissible`; app root gets `inert` while open; body scroll locked; nested sheets stack.
- A running live activity's sheet is always dismissible — the activity keeps running and its live pill remains (fixes AUDIT F4 permanently).

### 7.2 `toast({ message, action?: { label:'Undo', run }, duration = 5000, tone })`
Rises from just above the nav / live pill (never from the top edge). One at a time; a new toast replaces the old. `aria-live="polite"`.

### 7.3 `confirmSheet({ title, body, confirmLabel, destructive }) → Promise<boolean>`
A small sheet, never the browser dialog. Used only for non-undoable actions.

### 7.4 `router`
- Tabs: `today`, `timeline`, `stash`, `memories` (hidden when the matching tracker is off). Pushed screens: `settings` (+ sub-pages), `onboarding`.
- `router.go(tab)` — directional horizontal transition by nav order; `router.push(screen, params)` — slides in from the right; `router.back()`.
- Uses `history.pushState` + `popstate` so the Android back gesture closes the top sheet first, then pops screens, then switches back to Today.
- Updates `aria-current` on nav items; restores per-tab scroll position.

### 7.5 `livePill`
Subscribes to `events.running()`. One pill per running activity, stacked above the nav, each showing icon + label + live clock (+ safety countdown for bottles, side for breastfeeding). Tapping opens that activity's sheet with the pill as `origin`. Clocks tick from wall-clock (`requestAnimationFrame`-throttled to 1 Hz, paused when `document.hidden`).

---

## 8. `index.html` shell

```html
<body>
  <div id="app">                       <!-- gets inert while a sheet is open -->
    <header id="appHeader"></header>    <!-- per-view header content rendered by the active view -->
    <main id="viewport"></main>         <!-- views mount here -->
    <div id="livePills"></div>
    <nav id="tabBar"></nav>             <!-- Today · Timeline · (+) · Stash · Memories -->
  </div>
  <div id="sheetRoot"></div>
  <div id="toastRoot"></div>
  <script type="module" src="js/app.js"></script>
</body>
```

`<head>`: charset, viewport (`viewport-fit=cover`, pinch-zoom allowed), `<meta name="theme-color">` for light and dark (`media=`), manifest, apple-touch-icon (swappable by onboarding — §10), `mobile-web-app-capable`, preload of the two primary woff2 files, stylesheets in order tokens → base → components → views/* → sheets/*.

---

## 9. Privacy & delivery

`netlify.toml` headers on `/*`:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://nickg.xyz https://*.nickg.xyz
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
X-Content-Type-Options: nosniff
```

Plus a `<meta http-equiv="Content-Security-Policy">` fallback (minus `frame-ancestors`, which meta can't carry) for non-Netlify hosts. JS/CSS/HTML revalidate on every load (`max-age=0, must-revalidate`); fonts/icons are immutable. The service worker caches the full asset list with `cache: 'reload'` and serves cache-first for fonts/icons, network-first for HTML/JS/CSS.

---

## 10. Baby photo → app icon (iOS)

`onboarding.js` (and Settings → Baby) on photo pick: square crop → `photos.add()` (downscaled) → render a 180×180 PNG via canvas → set `<link rel="apple-touch-icon">` `href` to the PNG data URL **and** persist it as `settings.iconDataUrl`; `app.js` re-applies it on every boot *before* the user could reach Add to Home Screen. Favicon uses a 64×64 version. Android keeps the static icon. Copy must say "Your home-screen icon will be Clara's photo (iPhone)."

---

## 10b. Data-loss protection (local-only means *we* must prevent loss)

Safari deletes script-writable storage (IndexedDB) for sites not used in 7 days of browser use; Home-Screen web apps are exempt. With no server there is no recovery, so:
- `core/persist.js`: call `navigator.storage.persist()` after onboarding and on first meaningful log; store the result; `navigator.storage.estimate()` shown in Settings → Data.
- Install is pushed as *protection*, not convenience: "Add to Home Screen so iPhone never clears Clara's log."
- Weekly nudge (Today, dismissible card, never a modal) when `lastBackupAt` is older than 7 days and there's ≥1 day of data: "Save a backup to Files" → `backup.share()`; success updates `lastBackupAt`. Settings → Data shows "Last backup: 3 days ago".
- Any import in `replace` mode first auto-downloads a backup of the current data.

## 10c. Extras in this build

- **Pediatrician report** (`views/report.js` pushed from Timeline and Settings): last 7 or 14 days — feeds/day + total oz, breastfeeding sessions, wet/dirty diapers/day, sleep total/day + longest stretch, pump totals. Clean print stylesheet; "Save as PDF / Print" uses `window.print()`; "Share" uses the CSV/printable HTML. All local.
- **Calendar pump reminders** (`core/ics.js`, pure + tested): export the next N days of pump times (from interval + last pump) as an `.ics` with VALARMs, shared via `navigator.share` / download. The phone's Calendar fires the alerts — nothing leaves the device. Settings copy is honest: "Web apps can't alert you while closed. Add your pump schedule to Calendar instead."
- **Privacy page** (Settings → Privacy): plain-English what/where/how-to-export/how-to-erase, "this app makes no network requests after it loads", link to the public source, and a **Send feedback** `mailto:` (no data attached unless the user types it).

## 11. Testing

- Unit (`npm test`): every pure module — units, time, safety, sleep (wake windows), trends, inventory, migrate (`sessionToEvent`, settings mapping), backup (schema validation, merge rules, escaping of hostile strings), html (escaping), reminders schedule.
- e2e (`npm run e2e`): Playwright scripts per flow at 390×844, light + dark, oz + mL; assert zero console errors and zero non-same-origin requests (privacy check: `page.on('request')` must only ever see `localhost`).
