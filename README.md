# Nurture — Baby Tracker

A free, offline-first progressive web app for tracking breast-milk pumping and feeding. No account, no backend, no tracking — all data lives in IndexedDB on the device.

**Features**
- Four tabs plus a center **Quick Feed** button: **Pump** (goal, timer, log feed, today's feeds), **History** (activity log, 7-day trends, CSV export), **Stash** (thaw from stash + FIFO inventory), **Settings** — each tab surfaces only the urgent items relevant to it, at the top
- Pump session timer with one-tap output logging
- Daily pumping goal with an animated bottle-fill progress visual, plus a next-pump-due readout
- Today's Feeds tracker on the Pump tab — every feed row quick-edits via the tracker-entry editor
- Thaw-from-stash tile on the Stash tab (shows only when frozen stash exists): frozen stash (oldest first) thaws into a "Thawed & ready" stash that feeds straight into the feed flow as a bottle-ready source
- Feed logging in two speeds: a guided bottom-sheet flow (pick type → set amount with a 0.1oz slider, tap-to-type, or preset chips → **Start live timer** as the primary path for a feeding in progress, with a CDC safety countdown that answers "is this bottle still good," or Log finished feed for the "Look right?" review) and an **express gesture** — press-and-hold the elevated Feed nav button, slide up/down for formula vs breast milk (with a sticky, hysteresis-locked type picker), left/right for ounces, lift to review
- Bottle timer: from inside the feed flow, watch the elapsed feed time alongside the per-type CDC safety countdown (formula 1h, breast milk 2h from first feed), then log how much was actually eaten — pace (oz/min) is recorded with the feed
- Milk stash manager (fridge / freezer / deep freezer / thawed / room temp) with FIFO ordering and CDC-based expiration windows
- 7-day supply trends chart (SVG, no dependencies)
- Pump reminders with gentle chimes
- Tracker entries are editable (Edit button on any session)
- CSV export for the pediatrician, JSON backup / restore
- 4-step onboarding: names, daily target, and an Add-to-Home-Screen install guide (iOS + Android)
- Respects `prefers-reduced-motion`; pinch-zoom is not disabled

**Run it**

Any static file server works — the app is plain HTML/CSS/JS with ES modules:

```sh
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL on your phone and use *Add to Home Screen* for the full-screen app experience with offline support.

**Tests**

```sh
npm test            # fast checks: no dependencies, about a second
npm run test:e2e    # real-browser checks: drives the actual app in Chromium (about 2 minutes)
npm run test:all    # both
```

The browser tests need Playwright once: `npm install`, then `npx playwright install chromium`.

Three layers, each catching a different kind of problem:

1. **Unit tests** (`tests/nurture.test.js`, 69) — the safety-critical logic: milk expiration math, urgency badges, bottle countdown thresholds, thaw-from-stash transitions, stash summaries, feed-flow prefills and gesture math, pump-duration validation, trend aggregation, ID generation, session editing, plus backup-file validation, how onboarding answers map to saved settings, and HTML escaping.
2. **Static wiring audit** (`tests/static-audit.test.js`, 25) — cross-checks the HTML, CSS and JS against each other with no browser: every `data-action` has a handler, every element id the JS looks up exists, every `<button>` is wired to something, every saved setting is loaded back, every method call hits a method that exists, every link / import / manifest icon / service-worker cache entry resolves, and a global `[hidden]` rule exists.
3. **Browser tests** (`tests/e2e/`, 225) — real Chromium, phone-sized screens, a frozen clock, and isolated storage per test. Scenario files cover the pump, feed flow (guided, express gesture, thawed stash), bottle timer, history, stash, settings, backup / restore / reset, onboarding, the install prompt, offline mode, and layout at 320 / 390 / 768 px. **`sweep.test.js`** is the "no dead clicks, no traps" net: it finds every control on every tab and inside every sheet (new buttons are picked up automatically), clicks each one in a fresh app, and fails if the click does nothing you could see or hear, or if a sheet it opens can't be closed with a finger.

Nearly every screen repaints only after an awaited IndexedDB read, so browser tests should wait for the result (`eventually()` / `waitForFunction`) instead of asserting right after a click.

**Structure**

```
index.html        App shell + onboarding flow
manifest.json     PWA manifest (installable, standalone)
sw.js             Service worker — offline-first cache
css/style.css     All styling
js/
  app.js            Thin orchestrator: shared settings state, navigation/tab
                    switching, theme engine, the global delegated action
                    dispatch, and the pure exported helpers the unit tests
                    import directly (applySessionEdits, feed-flow math, etc.)
  onboarding.js     4-step welcome/setup wizard (composed into App)
  settingsView.js   Settings tab: preferences form, storage-window rules,
                    backup/reset
  pumpTimerView.js  Pump tab hero timer tile + the manual-pump modal
  inventoryView.js  Stash tab: FIFO list + thaw/mark-used/discard actions
                    (the shared inventory-mutation actions other views call)
  dashboardView.js  Goal-bottle fill, activity history, trends chart, feeds
                    tracker, thaw-from-stash tile, split urgent strips, and
                    the session-edit modal
  feedFlow.js       Guided feed-logging sheet, the press-and-hold express
                    gesture, and the live bottle timer (per-type CDC safety
                    countdown, persisted across reload)
  installPrompt.js  PWA install banner (Pump tab) + Settings entry point +
                    manual iOS/Android install-guide modal, wired to the
                    native beforeinstallprompt event where supported
  viewHelpers.js    Small pure display helpers (escapeHtml, displayQty)
                    shared between dashboardView.js and feedFlow.js
  db.js             IndexedDB layer (NurtureDB) + collision-safe IDs
  timer.js          Pump timer with wall-clock restore
  inventory.js      FIFO stash engine + expiration math
  bottles.js        Legacy bottle-status helper — superseded by the live
                    bottle-timer in feedFlow.js; kept only because it still
                    has passing tests
  reminders.js      Pump schedule + local notifications
  trends.js         Daily aggregates + SVG chart
  export.js         CSV export + JSON backup/restore
  audio.js          Soft chime synthesizer (baby-sleep-safe)
icons/            PWA icons
tests/
  nurture.test.js       Unit tests (pure logic)
  static-audit.test.js  HTML/CSS/JS wiring audit (no browser)
  e2e/                  Real-browser tests (Playwright): scenarios, the click
                        sweep, and the shared harness
```
