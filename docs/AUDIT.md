# Nurture — User Flow Audit & Rebuild Spec

**Date:** 2026-10-14 · **Audited build:** v1.6.0 (`main` @ 8372ae4) · **Method:** full code read of every view controller + scripted walk-throughs in headless Chromium at iPhone size (390×844), light and dark, oz and mL.

This doc has two jobs:

1. **Record what's broken** — every dead click, wrong destination, data bug, and animation that appears from nowhere.
2. **Be the build spec** for the redesign + expansion (Phases 2–4). It's written so an agent team can execute it without re-deriving decisions.

Severity key: **P0** = loses or corrupts data / traps the user · **P1** = wrong result, safety, or a dead end · **P2** = friction, confusion, polish · **P3** = nice-to-have.

---

## 0. Locked product decisions (from the owner)

| Decision | Choice |
|---|---|
| Format | Stays a web app / installable PWA. No native wrapper. |
| New tracking | **Sleep + Diapers**, **Milestones + Memories** (photo journal). Feeds / pumping / stash stay and keep their depth. |
| Not in scope (for now) | Growth/percentiles, health/meds, solids, activities. Design the data model so they can be added without migration pain. |
| Sync | **Local-only + share via export/link.** No accounts. Build the event model so real sync can be bolted on later. |
| Visual direction | **Warm, calm, minimal** — soft neutrals, one warm accent, big type, color-coded categories, genuinely dim night mode. Built for one-handed use at 3am. |
| Rollout | **Phased PRs**: (1) audit + critical fixes ← *this PR*, (2) design system + redesign, (3) new trackers, (4) baby-photo icon + share + polish. |
| Baby photo as app icon | Yes, **iPhone-only and pre-install only** (see §6.4). Clearly labeled as such in the UI. |
| **Positioning** | **"Fully private & free."** This is the edge — every design and engineering choice must make it *true and provable*, not just a tagline. See §6.8. |
| **Tracker visibility** | **All trackers on by default.** Settings → *Customize* lets each family hide what they don't use (pumping, stash, formula, breastfeeding, sleep, diapers, memories) and reorder Today's cards. Hidden ≠ deleted: data stays, and re-enabling brings it back. |

---

## 1. Fixed in this PR (Phase 1)

All verified in a real browser after the fix, and covered by unit tests where the logic is pure (60 tests, up from 54).

| # | Sev | Bug | Repro (before) | Fix |
|---|---|---|---|---|
| F1 | **P0** | Pump logged as **"NaN mL"** | Open *log a pump manually* → tap a 10/15/20 min chip → close → start & stop the timer. The output stepper shows `NaN`; the saved session has `outputQty: null`. | `pumpTimerView.js` bound **every** `.chip-btn` on the page (including the modal's duration chips, which have no `data-delta`). Scoped the selector to `#timerHeroTile .chip-btn[data-delta]` and guarded `adjustPumpOutput` / timer restore against non-finite values. |
| F2 | **P0** | mL users' pumps saved ~30× too small | Switch to mL → pump timer at 100 mL → Finish. Saved as `3.38 mL`. | `stopAndSave` defaulted to `pumpOutputOz` but labeled it with the active unit. Now passes the quantity that matches the unit. Verified: 130 mL saves as 130 mL. |
| F3 | **P0** | Onboarding goal + pump interval **never saved** | Pick 26 oz / every 2h in onboarding → reload → it's 24 oz / 3h. | `onboarding.finish()` wrote `dailyPumpingGoal` / `reminderIntervalHours` / `preferredUnit`; the app reads `dailyGoalOz` / `pumpIntervalMinutes` / `units`. Keys aligned; interval converted hours→minutes; replaying the tour now preselects your saved interval. Also removed a call to the nonexistent `reminders.init()` (threw on every onboarding finish). |
| F4 | **P0** | Live bottle timer **traps you** | Start a bottle → tap ✕. Nothing happens; the sheet covers the app for the whole feed. | ✕ now tucks the sheet away; the wall-clock timer keeps running. Tapping Quick Feed / Log feed (or holding Quick Feed) returns to the live bottle instead of starting a second feed. *(The redesign should add a persistent "live" pill — see §3.)* |
| F5 | **P1** | Thawed pouch never consumed after a reload mid-feed | Thaw a pouch → feed from it with the live timer → reload → finish & log. The pouch stays "Thawed & ready" forever. | `sourceInventoryId` is now persisted with the bottle timer and restored. |
| F6 | **P1** | Totals mix units | Log 4 oz, switch to mL. History header says "4 mL fed". | New `convertQty` / `sumQty` / `sessionQty` helpers; History header, day groups, Today's Feeds and the feed-flow tally all convert per-session. Rows also render in the active unit. |
| F7 | **P1** | Thaw tile vanishes with your milk in it | Have one frozen pouch → Thaw. The whole tile (including "Thawed & ready") disappears. | `shouldShowThawTile(frozen, thawed)` — visible while either list has items. |
| F8 | **P1** | Thaw tile doesn't appear after adding a frozen pouch | Add a freezer pouch on Stash. Tile stays hidden until you change tabs. | Add / Used / Discard now re-render the dashboard (thaw tile + urgent strips), not just the list. |
| F9 | **P1** | **Expired thawed milk is selectable as a feed source** | Let a thawed pouch expire → Log feed → it's offered and tappable. | Expired pouches still show (so you know to discard) but are disabled. |
| F10 | **P1** | Stash notes render raw HTML | Add a pouch with note `<b>bag</b>`. It renders bold. With backup sharing on the roadmap, an imported file could inject markup/script. | Notes escaped in Stash and History. **Phase 4 import must also validate/escape every field — see §6.5.** |
| F11 | **P1** | `?reset=true` wipes all data silently | Open `…/index.html?reset=true`. Everything is gone. Dangerous once share-links exist. | Now asks for confirmation first. |
| F12 | P2 | "Low stash: 0 oz left" for everyone | Fresh install, or a formula-only family, sees a stash warning on day one. | Only warns users who have ever stored milk. |
| F13 | P2 | Settings goal shows oz in mL mode | mL user opens Settings: "Daily Pumping Target: 26" (oz). | Shows/accepts the active unit; label says which. Unit toggle refreshes the form. |
| F14 | P2 | +0.5 chips add 0.5 **mL** in mL mode | — | Chips read and step `+15/+30/+60/+90` mL in mL mode. |
| F15 | P2 | "1 pumps", "1 feeds" | — | `plural()` helper. |
| F16 | P2 | Banner "Pump Now" starts the timer off-screen | Tap it while scrolled; timer starts somewhere below the fold. | Scrolls the timer into view. |
| F17 | P2 | Arcade "←" pill shows in the installed app | Installed PWA has a back arrow to `/` that goes nowhere useful. | Hidden in `display-mode: standalone`. |

---

## 2. Dead clicks & clicks that should go somewhere

Still open — for the redesign to resolve.

| Sev | Where | Issue | Should do |
|---|---|---|---|
| P1 | Pump tab, "Track pumping" tile | The big "0 sessions today — tap to log a pump" button is a **third** way to open manual pump (plus "or log a pump manually" and the timer). Three entry points to one action, none of them the obvious one. | One "Pump" quick-log tile on Today → sheet with *Start timer* (primary) / *Log past pump*. |
| P1 | Reminder banner "Start First" / "Pump" | Tapping a status banner **immediately starts a pump timer**. A tap meant as "show me" commits an action. | Banner opens the pump sheet; the sheet's primary button starts it. |
| P2 | History accordion header | Collapsing hides the *only* content on the tab — a click that only makes things worse. | Remove the accordion; History becomes a day-scrolling timeline. |
| P2 | History "Show Previous Days" | The only way to go back in time; dumps every day into one list. | Date strip / day pager with per-day summary. |
| P2 | Theme chip ("Day (8am)") | A `<div>` that silently cycles auto→light→dark. No role, no keyboard, label wraps to two lines and reads like a time. | Move to Settings → Appearance. Header gets nothing, or a single icon button with a menu. |
| P2 | Unit chip in header | Global unit switch one stray tap away, with no feedback. | Settings only. |
| P2 | Supply Trends chart | Not interactive — no tap on a day to see that day. | Tap a bar → jump to that day in the timeline. |
| P2 | Stash "Use Next (FIFO)" card | The most important pouch has the same 3 tiny buttons as every other. | "Use next" card gets a primary *Thaw* / *Feed* action. |
| P2 | Thaw "+N more below in Stash ↓" | An in-page anchor `href="#inventoryListContainer"` (jumps without animation, under the sticky header). | Scroll smoothly to the list and highlight the first frozen row. |
| P2 | Feeds: Edit vs row tap | Today's Feeds rows are tap-to-edit; History rows have tiny "Edit" / "Delete" text links. Two patterns for one object. | One pattern everywhere: tap row → detail sheet (edit, delete with undo). |
| P2 | Feed flow | Every feed is stamped **"now"**. Logging a feed from an hour ago means log-then-edit. | Time row in the review step ("Now ▾" → time picker). |
| P2 | Pump timer | You must set the output **before** you stop. The amount is known only *after* pumping. | Stop → "How much?" step (like the bottle timer's review). |
| P2 | Express gesture (hold Quick Feed) | Zero discoverability — nothing tells anyone holding is possible. | One-time coach mark after the 3rd tap-logged feed; long-press hint in the FAB label. |
| P3 | Install banner + onboarding install slide + Settings button | Three install prompts; the banner sits above today's data on every launch. | Install lives in onboarding (after the photo step) + Settings. Banner only after day 3, once. |

---

## 3. Animations: things coming from thin air

The rule for the redesign is **every surface enters from, and exits back to, the thing that summoned it.** Nothing pops in or blinks out.

| Sev | Where | What happens now | What it should do |
|---|---|---|---|
| P1 | All 6 sheets (`.modal-overlay`) | Backdrop **snaps** in (`display:none → flex`), sheet slides up. On close, **both vanish instantly** — no exit at all. | Shared `Sheet` controller: backdrop fades 0→55% while the sheet springs up; on close, reverse (sheet slides down, backdrop fades), then `display:none` on `transitionend`. Drag-to-dismiss on the grabber. |
| P1 | Feed flow → bottle timer | "Start live timer" makes the feed sheet **disappear** and a second sheet slide up from the bottom. | One sheet that morphs: the amount hero shrinks into the timer header; content cross-fades. |
| P1 | Express gesture pad | A hold on the FAB opens a full-screen **sheet sliding from the bottom edge** — not from your thumb. | Pad grows radially out of the FAB (clip-path circle from FAB center), collapses back into it on release. |
| P1 | Feed toast | "Feed Logged!" **drops from the top of the screen** for an action taken at the bottom; it also fires *behind* the feed sheet's own success step (double confirmation). | Success lives in the sheet; after it closes, the new row animates into the timeline (highlight + slide). Toast only for background actions, with **Undo**. |
| P2 | Tab switching | Every tab fades up 8px regardless of direction. | Horizontal slide matching nav order (Today → Timeline slides left), or a plain cross-fade. Pick one, apply everywhere. |
| P2 | Feed-flow steps | Back and forward both play the same "fade up". | Forward = slide left, back = slide right. |
| P2 | Accordion / older history | Content pops in at full height. | Height + opacity transition (or remove accordions — see §2). |
| P2 | Inline "tap to type" edits | Number swaps instantly to an `<input>` of a different size → layout jump. | Same-size input styled identically, or a numeric keypad sheet. |
| P2 | New rows after logging | A logged feed/pump just *exists* on the next render. | New row slides in + brief accent highlight so you see *where* it went. |
| P3 | Goal bottle fill | Fill animates (good) but restarts from current height on every 20 s refresh tick. | Animate only on value change. |
| P3 | Theme switch at 7pm | Whole UI flips instantly while you might be mid-task. | 600 ms color transition on the root tokens; never while a sheet is open. |

All motion must collapse to opacity-only under `prefers-reduced-motion` (today some does, not all).

---

## 4. Flow & information architecture

**P1 — The Pump tab is the whole app.** On a fresh install the first screen is three phone-heights tall: install banner, goal bottle, "Track pumping" tile, hero timer with stepper/chips/destination select, a giant "Log feed" button, then Today's Feeds. It answers *"how much have I pumped?"*, but a parent's first question at 3am is *"when did she last eat, and when did she last sleep?"*

**P1 — Pumping is assumed.** Onboarding asks for a pumping target and interval before anything else. A formula-feeding or exclusively-breastfeeding parent hits a wall of irrelevant UI. Onboarding should ask *how are you feeding?* (breast / bottle-breastmilk / formula / pumping, multi-select) and shape the home screen from the answer.

**P2 — Duplicate entry points.** Log feed exists as the FAB *and* a full-width button. Logging a pump has three doors (§2).

**P2 — Native `alert()` / `confirm()` — 22 of them.** Every delete, thaw, save, error, and reset uses the browser's system dialog. This is the single biggest "this is a website" tell. Replace with in-app confirm sheets for destructive actions and **undo toasts** for everything reversible (delete entry, mark used, discard).

**P2 — Sound on by default.** Chimes play on type-pick, timer start, and every log. For a baby-sleep app, default to **off** between 7pm–8am (or off entirely, with haptics where supported).

**P3 — Header crowding.** Brand + baby name + back pill + theme chip + unit chip, then a reminder banner *above* the header. Status bar of info the user didn't ask for.

---

## 5. Accessibility (WCAG 2.1 AA, iOS HIG 44 pt)

Measured on the Pump tab:

- **Tap targets under 44 px:** goal −/+ (21×28), unit chip (41×29), arcade pill (30×30), install dismiss (24×24), banner action (64×29), increment chips (~58×31), destination select (172×32), "log a pump manually" (152×31).
- **Clickable `<div>`s with no role / keyboard support:** goal fraction display, pump output display, theme chip, feed amount hero, accordion header.
- Sheets don't trap focus or return focus to the trigger on close.
- Status (pump overdue, bottle expiring) is conveyed mainly by color + pulse animation; add text/iconography.
- No visible focus styles on most custom controls.

The redesign's component library must ship with: 44 pt minimum hit areas, real `<button>`s, focus rings, focus trap + restore in sheets, `aria-live` for timers at a polite cadence (not every second).

---

## 6. Rebuild spec (Phases 2–4)

### 6.1 Competitive reference

| App | What to take | What to avoid |
|---|---|---|
| **Nara Baby** (free, ad-free, 4.9★ on ~21k reviews) | Calm layout; one place for naps, diapers, feeds, wake windows; side-by-side breastfeeding timer (L/R) + bottle + pump timer; multiple children; caregiver sharing is its most-praised feature. | Reviewers complain about mL↔oz switching friction during pumping. Some trackers report it's in maintenance mode — room to out-polish it. |
| **Huckleberry** *(from general product knowledge, not re-verified this session)* | "SweetSpot"-style next-nap prediction from wake windows — the reason people open a sleep app. A single big "what's next" card. | Core value is paywalled; a free, private, offline equivalent is a real wedge. |
| **"Mockingbird"** | No baby-tracker app found under this name — Mockingbird is a stroller/high-chair brand. Owner to confirm which app was meant. | — |

**Nurture's edge (proposed):** the only tracker where **pumping and stash are first-class** (FIFO thaw, CDC expiry, live bottle-safety countdown) — *plus* the classic sleep/diaper/feed loop, fully private and offline, free, with a memories journal that makes it something you keep after the newborn phase.

### 6.2 Information architecture

Bottom nav, 4 tabs + center action:

1. **Today** — "Since last" cards (*Fed 2h 10m ago · 4 oz*, *Awake 1h 05m*, *Diaper 3h ago*, *Pumped 2h 40m ago* — pumping card only if the user pumps). Each card is one-tap to log that thing. Under them, today's timeline (newest first) and the pump goal ring if pumping is on.
2. **Timeline** — day pager with a 24h activity strip per day (sleep blocks, feed ticks, diaper dots), tap a day to expand. Replaces History.
3. **(+) center** — tap: radial/quick sheet of all log types. Hold: express feed gesture (kept, now grows from the FAB).
4. **Stash** — kept, restyled; "Use next" hero card with Thaw/Feed.
5. **Memories** — milestones + photo journal (grid → detail). Settings moves behind the baby avatar in the Today header.

A live activity (bottle timer, pump timer, sleep timer, breastfeeding L/R) shows as a **persistent pill above the nav** while running; tapping it reopens its sheet. Multiple can run (e.g. pumping while baby sleeps).

### 6.3 New trackers

- **Sleep:** start/stop timer + "log past sleep" (start, end). Nap vs night auto-classified by time with override. Today card shows awake-time and a simple wake-window hint by age (needs baby birthdate → add to onboarding).
- **Diapers:** one tap: Wet / Dirty / Both (+ optional color/consistency, note). Today card: count + time since last. Timeline dots.
- **Breastfeeding** (fills an obvious gap next to bottle/formula): L/R side timer with "last side" memory.
- **Milestones & Memories:** preset milestones (first smile, rolls over, sits, first word…) + custom; each can carry a photo, date, note. Photos stored as downscaled JPEG blobs in IndexedDB (cap ~1600 px long edge, ~0.8 quality), with a storage-used readout in Settings.

### 6.4 Baby photo as app icon — exact constraints

- **iOS Safari:** reads `<link rel="apple-touch-icon">` **once, at "Add to Home Screen" time**. Onboarding order becomes: *Welcome → Baby (name, birthdate, photo) → Feeding method → Goals (if pumping) → Install*. On photo pick: square-crop UI → render 180×180 PNG on a canvas → swap the `apple-touch-icon` href to the data URL **before** the install step. After install it can't change; Settings explains "to change the icon, remove and re-add Nurture."
- **Android/Chrome:** builds icons from the manifest at install; dynamic (blob/data-URL) manifests are unreliable for installability. **Don't promise it.** Keep the static icon; label the feature "iPhone".
- **Everywhere:** favicon, Today header avatar, splash/launch moment, and Memories cover use the photo and can change any time.

### 6.5 Data model & sharing

- Bump `DB_VERSION` → 2. Add an **`events`** store: `{ id, type: 'feed'|'pump'|'sleep'|'diaper'|'breastfeed'|'milestone', startTime, endTime?, data: {…}, unit?, createdAt, updatedAt, deviceId }`. Migrate existing `sessions` into it (keep `sessions` read-only for one release, for rollback). `deviceId` + `updatedAt` on every record is what makes future sync a merge, not a rewrite.
- Add `photos` store (blobs) and `profile` (baby name, birthdate, photo id, feeding methods).
- **Share via export/link:** export → versioned JSON (optionally with photos as a zip) → Web Share API on mobile (`navigator.share({ files })`), download fallback. "Share today's summary" as plain text / image card for a caregiver.
- **Import is a trust boundary.** Validate against a schema, reject unknown types, coerce numbers, cap string lengths, and render every imported string through `escapeHtml`. Merge by `id` + `updatedAt` (newest wins) instead of today's wipe-and-replace. No URL parameter may ever mutate data without a confirm sheet.

### 6.6 Design system (Phase 2)

- Tokens on `:root` for color, type scale, spacing (4 pt grid), radius, elevation, motion durations/easings; dark theme redefines tokens only. Night mode: true dim (no pure white, warm-shifted), never auto-flips while a sheet is open.
- Category colors (accessible in both themes): feed, sleep, diaper, pump, milestone — used consistently on cards, timeline, and charts.
- Components: Button (primary/secondary/ghost/destructive), Card, QuickLogCard, Sheet (with the §3 motion contract), SegmentedControl, NumberStepper/Keypad, Chip, ListRow (tap → detail), Toast (with Undo), LivePill, EmptyState, TimelineStrip.
- Type: one display face for numbers/titles, one UI sans. Large numerals for amounts and timers.
- Replace all 22 native dialogs.

### 6.8 "Fully private & free" — technical guarantees

The promise has to survive a skeptical parent opening DevTools.

- **Zero third-party requests.** Today the app loads Google Fonts on every launch (leaks IP + timestamp to Google, and breaks first-run offline). Fonts must be **self-hosted** woff2 subsets under `/fonts`, preloaded, and cached by the service worker.
- **Content-Security-Policy** via `netlify.toml` (and a `<meta>` fallback): `default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://nickg.xyz`. This makes "nothing leaves your phone" enforced by the browser, not just by us. No inline `<script>` / `style=""` attributes (move to classes) so `style-src 'self'` holds.
- Also send `Referrer-Policy: no-referrer` and `Permissions-Policy` disabling camera/mic/geolocation (photo upload uses `<input type=file>`, which needs no permission).
- **No analytics, no ads, no accounts, no tracking pixels** — ever. Not even "anonymous" telemetry.
- **Settings → Privacy** screen in plain language: what's stored, where (this device only), how to export it, how to erase it, and a line that the app makes no network requests after it's loaded. Link the source.
- **Free:** no paywall, no "premium" tier, no feature teased-then-locked. Every feature in this spec is free.
- Onboarding's first screen says it once, simply: *"Free. Private. Everything stays on this phone."*

### 6.7 Definition of done for each phase

- Every interactive element is a real button/link with a ≥44 pt target and a visible focus state.
- Every sheet/toast/new element passes the "where did it come from / where did it go" check in §3.
- Scripted walk-through (Playwright, 390×844, light+dark, oz+mL) of: onboarding → each log type → edit → delete+undo → stash thaw→feed → export → import. Zero console errors.
- Unit tests for all pure logic (expiry, unit conversion, wake windows, migration, import validation).
- `npm test` green; README updated.

---

## 7. How this audit was run (to reproduce)

```sh
python3 -m http.server 8080 &
npm test
# Playwright walk-throughs: onboarding (goal 26 / 2h) → reload → verify persisted;
# manual-pump duration chip → verify stepper; mL pump timer → verify saved qty;
# stash add (freezer) → thaw → feed from thawed via live timer → reload mid-feed → log
# → verify pouch consumed; express gesture hold/drag/release; dark mode; tap-target scan.
```
