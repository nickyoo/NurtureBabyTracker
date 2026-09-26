# Nurture — Baby Tracker

A free, offline-first progressive web app for tracking breast-milk pumping and feeding. No account, no backend, no tracking — all data lives in IndexedDB on the device.

**Features**
- Pump session timer with one-tap output logging
- Daily pumping goal with an animated bottle-fill progress visual, plus a next-pump-due readout and an "urgents" strip (pump overdue, thawed milk expiring, low stash)
- Today's Feeds tracker right under the goal — every feed row quick-edits via the tracker-entry editor
- Thaw-from-stash tile on the main page (shows only when frozen stash exists): frozen stash (oldest first) thaws into a "Thawed & ready" stash that feeds straight into the feed flow as a bottle-ready source
- Feed logging in two speeds: a guided bottom-sheet flow (pick type → set amount with a 0.1oz slider, tap-to-type, or preset chips → **Start live timer** as the primary path for a feeding in progress, with a CDC safety countdown that answers "is this bottle still good," or Log finished feed for the "Look right?" review) and an **express gesture** — press-and-hold the center + button, slide up/down for formula vs breast milk (with a sticky, hysteresis-locked type picker), left/right for ounces, lift to review
- Bottle timer: from inside the feed flow, watch the elapsed feed time alongside the per-type CDC safety countdown (formula 1h, breast milk 2h from first feed), then log how much was actually eaten — pace (oz/min) is recorded with the feed
- Milk stash manager (fridge / freezer / deep freezer / thawed / room temp) with FIFO ordering and CDC-based expiration windows
- 7-day supply trends chart (SVG, no dependencies)
- Pump reminders with gentle chimes
- Tracker entries are editable (Edit button on any session)
- CSV export for the pediatrician, JSON backup / restore
- 4-step onboarding: names, daily target, and an Add-to-Home-Screen install guide (iOS + Android)

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
npm test
```

54 unit tests covering the safety-critical logic: milk expiration math, urgency badges, bottle countdown thresholds, thaw-from-stash transitions, stash summaries, feed-flow thawed-source prefills, feed-timer entry defaults, thaw-tile visibility rules, pump-duration validation, trend aggregation, ID generation, session editing, feed-flow gesture math (hysteresis, clamp/precision), and the bottle-timer safety windows. No dependencies — just Node's built-in test runner.

**Structure**

```
index.html        App shell + onboarding flow
manifest.json     PWA manifest (installable, standalone)
sw.js             Service worker — offline-first cache
css/style.css     All styling
js/
  app.js          Orchestrator: screens, onboarding, settings
  db.js           IndexedDB layer (NurtureDB) + collision-safe IDs
  timer.js        Pump timer with wall-clock restore
  inventory.js    FIFO stash engine + expiration math
  bottles.js      Bottle safety countdowns
  reminders.js    Pump schedule + local notifications
  trends.js       Daily aggregates + SVG chart
  export.js       CSV export + JSON backup/restore
  audio.js        Soft chime synthesizer (baby-sleep-safe)
icons/            PWA icons
tests/            Unit tests (node:test)
```
