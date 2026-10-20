# Nurture: a private baby tracker

Nurture is a free baby tracker that works offline as a progressive web app. It logs feeds, sleep, diapers, pumping, the milk stash and memories. There is no account, no server, no analytics and no ads. Everything stays on the phone it was logged on.

> **Free. Private. Everything stays on this phone.**

## The privacy promise

- **No network requests after the app loads.** The app ships only static files. Fonts and icons are self-hosted. A strict Content Security Policy (`default-src 'self'`, set in `netlify.toml` and repeated as a `<meta>` tag) blocks third-party scripts, styles, images and connections. Settings → Privacy shows a live count of requests to other sites, which should always read 0.
- **Your data lives in IndexedDB on the device**, and photos are downscaled before they're stored. The app asks the browser not to evict that storage (`navigator.storage.persist()`).
- **Yours to keep:** you can save a JSON backup (with or without photos), export a CSV for the pediatrician, import a backup (merge or replace), or erase everything.
- Because there is no server, a lost phone means lost data. Nurture works against that in three ways:
  - It suggests a weekly backup on Today. This is a card you can dismiss, never a pop-up.
  - It presents Add to Home Screen as protection, because iPhone clears website storage after 7 days without use and Home Screen apps are exempt.
  - Before any "replace" import, it saves a safety backup.

## Features

- **Today:** a masthead with the baby's name and age. Cards show the time since the last feed, sleep, diaper, pump and stash change, and their order and visibility can be changed. Below them are today's entries, newest first, plus the weekly backup card and an install hint.
- **Quick log (the + button):**
  - Tiles change with what's happening: a running bottle, which breast side to start on, pumping progress toward the goal, and starting or ending a nap.
  - Wet, Dirty and Both each log a diaper in one tap, with Undo and "Add details".
  - A time chip back-dates any entry.
- **Feeding:**
  - Bottles can be formula, breast milk, or milk from the stash.
  - A live bottle shows a CDC safety countdown (formula 1 h; breast milk 2 h once feeding starts) and asks "How much did Clara drink?" when it ends.
  - Breastfeeding has a left/right timer with pause and side switching.
  - The **express gesture**: hold + and slide to log a bottle in one move.
- **Pumping:** a live timer, past pumps, a daily goal, and "How much did you pump?" followed by storing the milk in the fridge or freezer.
- **Sleep:** naps and night sleep, with live timers, past sleeps (checked for overlaps), and wake windows by age.
- **Milk stash:** pouches in the fridge, freezer, deep freezer, at room temperature, or thawed. The fridge/freezer split bar and "Use next" suggestion work oldest first, and expiry badges follow CDC guidance. Pouches can be thawed, fed, marked used or discarded, and every action can be undone.
- **Timeline:** a day pager, summary tiles that filter the list, a 24-hour strip (sleep, feeds, diapers, pumps), and an entry sheet to view, edit or delete any entry.
- **Pediatrician report:** the last 7 or 14 days, which you can print or save as a PDF, or share as a CSV.
- **Memories:** a keepsake book for each baby. It has a cover photo, 12 suggested firsts by typical age, photos grouped by week of life, and a photo viewer.
- **Settings:**
  - Babies (one or more), each with a photo that becomes the iPhone home-screen icon.
  - Customize: turn trackers on or off and reorder Today's cards. Hidden trackers disappear everywhere but keep their data.
  - oz or mL, Appearance (Auto, Light, Night), Reduce motion and Sound.
  - Milk storage windows, and pump reminders added to your Calendar as an `.ics` file.
  - Backup and data, Privacy, and About.
- **Night mode:** warm and dim, and turned on automatically from 7 PM to 8 AM in Auto.
- **Accessibility:** every control is a real button or input with a 44 px target and a visible focus ring. Sheets trap focus and return it when they close. Reduced motion is respected, both from the system and from the in-app setting.
- **Twins and siblings:** feeds, sleep, diapers and memories are tracked per baby. Pumping and the stash are shared by the family.
- **Upgrading from v1:** existing v1 data (sessions, stash and settings) moves over automatically on first launch.

## Run it

It's plain HTML, CSS and native ES modules, with no build step and no runtime dependencies. Any static file server works:

```sh
python3 -m http.server 8080
# or
npx serve .
```

Open the printed URL. On a phone, use **Add to Home Screen** for the full-screen offline app.

## Tests

```sh
npm test
```

The unit tests use Node's built-in `node:test` and cover every pure module:

- units, time, format and html escaping
- bottle safety and sleep wake windows
- trends and the stash expiry engine (FIFO + CDC)
- v1 migration, and backup validation, merge and CSV escaping
- the pump schedule and `.ics` export
- settings sanitising
- the service-worker asset list and CSP guards

```sh
PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright/index.mjs npm run e2e
```

The end-to-end suites run with Playwright, which is a dev-only tool. Point `PLAYWRIGHT_PATH` at a Playwright `index.mjs`, or install the `playwright` package. `tests/e2e/run.mjs` starts a throwaway static server on 127.0.0.1 and runs every `tests/e2e/*.mjs` script against it at 390×844.

The suites cover the shell, motion and focus, Today, quick log, the feed, pump, sleep and diaper sheets, Timeline and the report, Stash, Memories, Settings, onboarding, and a full walkthrough of the app. Each one checks:

- light and night themes, oz and mL, one baby and two
- hidden trackers, empty data and lots of data
- zero console errors, zero CSP violations and zero requests to other origins

Screenshots go to `docs/design/build/`.

## Structure

```
index.html            App shell only (no inline script or style; CSP meta)
manifest.json         PWA manifest
sw.js                 Service worker: precaches every shipped file, offline-first
netlify.toml          Hosting headers (CSP, cache policy)
arcade.json           Listing metadata for the owner's arcade
fonts/                Self-hosted Fraunces + Nunito (OFL)
icons/                Static app icons
css/
  tokens.css          Design tokens (light + night)
  base.css            Reset, type, layout, focus ring
  components.css      Buttons, cards, rows, sheet, toast, live pill, nav, …
  views/*.css         One file per screen
  sheets/*.css        One file per sheet
js/
  app.js              Bootstrap: theme, migration, ctx, router, live pills
  theme-boot.js       Sets the theme before first paint
  core/               Data layer: IndexedDB, events store, stash, photos,
                      settings, units, time, migrate (v1 → v2), backup,
                      persist, reminders, ics, audio
  domain/             Pure logic: inventory (FIFO + CDC), safety, sleep, trends
  ui/                 Primitives: html (safe templates), icons, sheet, toast,
                      confirm, router, livePill, format
  views/              today, timeline, report, stash, memories, settings, onboarding
  sheets/             quickLog, feed, pump, sleep, diaper, event, stash, memory
tests/
  *.test.js           Unit tests (node:test)
  e2e/*.mjs           Playwright suites + fixtures
docs/
  DESIGN.md           Design system, motion contract, screen layouts, copy voice
  ARCHITECTURE.md     Module contracts
  AUDIT.md            The v1 audit that motivated the rebuild
  design/             Target frames (final/) and build screenshots (build/)
```

## License

MIT. The fonts are under the SIL Open Font License 1.1 (see `fonts/`).
