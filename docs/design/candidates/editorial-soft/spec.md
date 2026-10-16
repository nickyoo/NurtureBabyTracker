# Nurture — "Editorial Soft" design system

> A calm journal. Paper-warm surfaces, hairline rules in place of boxes, a refined optical-size serif for names and numbers, a quiet sans for everything you tap. One clay accent; five category inks that never travel without an icon and a word. It should feel like a notebook you would keep after the newborn phase.

Reference mockup: `mockup.html` (8 frames, 390 × 844), renders `frame-1.png` … `frame-8.png`.

---

## 1. Principles

1. **Rules, not boxes.** Content sits on the page and hairlines separate it (Today's since-last grid, timeline rows, stash rows). Raised surfaces are only for things you can pick up: sheets, the "Use next" pouch, the live pill, grouped settings lists.
2. **Serif = what you read, sans = what you do.** Fraunces sets names, titles and measured values ("2h 10m", "4 oz", "46 oz"). Inter sets labels, buttons, metadata and anything that has to be read at a glance under stress.
3. **One accent.** Clay (`--accent`) marks the single primary action on screen: the + button, the primary button, the selected tab bar, today in the day pager, toggles in the on position. Everything else is ink or a category color.
4. **Color is never the only signal.** Every category color comes with its icon and its label (FED, ASLEEP, DIAPER, PUMPED). In the timeline strip, sleep type also differs by lightness, breastfeeding uses a dashed tick, and a wet diaper is a hollow ring while a dirty one is filled.
5. **3am first.** Big numerals, 44pt minimum targets (whole since-last cards are buttons), one-thumb reach for primary actions (bottom nav, + button, sheet buttons at the bottom), and a night theme that is dim, not just inverted.

---

## 2. Color tokens

All ratios are WCAG 2.x relative-luminance contrast, **computed** (script: sRGB → linear → `(L1+0.05)/(L2+0.05)`). Targets: ≥ 4.5:1 body text, ≥ 3:1 large text (≥ 24px, or ≥ 18.66px bold), icons and UI boundaries that carry state.

### 2.1 Neutrals and accent

| Token | Light | Dark (night) | Use |
|---|---|---|---|
| `--paper` | `#F7F2EA` | `#14110F` | App background |
| `--raised` | `#FDFAF5` | `#1C1815` | Sheets, hero pouch, grouped lists, tab bar (light) |
| `--sunk` | `#EFE8DC` | `#0F0D0B` | Progress track, strip lanes, segmented track, neutral badge |
| `--ink` | `#2A231E` | `#DCCFBE` | Primary text, numerals |
| `--ink-2` | `#5C5047` | `#AD9F8E` | Secondary text, metadata |
| `--ink-3` | `#6F6358` | `#8F8273` | Tertiary text, eyebrows, inactive tabs, units |
| `--rule` | `#E3D9CA` | `#2B2521` | Hairline dividers (decorative) |
| `--rule-2` | `#CBBDAB` | `#3E3631` | Secondary-button outline, grabber, timeline spine (decorative) |
| `--control-off` | `#8F8274` | `#6E6357` | Toggle-off outline and knob, input underline |
| `--accent` | `#A04D29` | `#D3875E` | Primary button fill, toggle on, active-tab bar, today ring |
| `--on-accent` | `#FFF8F0` | `#1A110C` | Text/icon on accent |
| `--fab` | `#A04D29` | `#B26A45` | + button (dimmer at night so it doesn't glare) |
| `--accent-ink` | `#8E4122` | `#DE9A73` | Accent-colored text: links, "Use next", back button, wordmark |
| `--accent-tint` | `#F4E4D7` | `#36231A` | "Use soon" badge, photo-picker fill |
| `--danger` | `#A42E27` | `#E07F72` | Destructive text, expired badge |
| `--danger-tint` | `#F7E0DC` | `#361C19` | Expired badge fill |
| `--pill` | `#2A231E` | `#2A2420` | Live pill surface (dark in both themes, so it reads as "running" anywhere) |
| `--pill-text` | `#F7F2EA` | `#DCCFBE` | Live pill primary text |
| `--pill-muted` | `#C9BBAA` | `#A39584` | Live pill secondary text |
| `--pill-feed` | `#D1A257` | `#D1A257` | Live pill icon and progress ring (the running category's dark-theme ink) |
| `--scrim` | `rgba(33,26,21,.46)` | `rgba(0,0,0,.60)` | Backdrop behind sheets |

### 2.2 Category colors

Each category has an **ink** (text, icons, strip marks) and a **tint** (icon chip, small add button, badge fill). The stash uses the pump colors, because a pouch is pumped milk.

| Category | Icon | Light ink / tint | Dark ink / tint |
|---|---|---|---|
| Feed (bottle, breast) | bottle / drop | `#875A10` / `#F5E8CF` | `#D1A257` / `#2F2517` |
| Sleep | crescent moon | `#46518F` / `#E5E7F2` | `#9AA3D6` / `#212433` |
| Diaper | diaper cup | `#3B6A54` / `#DFEAE2` | `#86B39A` / `#1B2620` |
| Pump + Stash | flange / pouch | `#7A4373` / `#F1E2ED` | `#C48DBC` / `#2C1F2A` |
| Memories | sparkle | `#9C3C55` / `#F6E1E6` | `#DB8C9F` / `#33201F` |

The five inks sit at clearly different hues (amber, indigo, green, plum, rose) and stay at similar lightness, so no category looks louder than another. Each one passes 4.5:1 as text on paper, raised and its own tint in both themes (table below).

### 2.3 Computed contrast: every text/background pair used

**Light**

| Foreground | Background | Ratio | Passes |
|---|---|---|---|
| ink `#2A231E` | paper `#F7F2EA` | 13.88 | AAA |
| ink | raised `#FDFAF5` | 14.86 | AAA |
| ink | sunk `#EFE8DC` | 12.70 | AAA |
| ink-2 `#5C5047` | paper | 7.00 | AAA |
| ink-2 | raised | 7.49 | AAA |
| ink-2 | sunk | 6.40 | AA |
| ink-3 `#6F6358` | paper | 5.23 | AA |
| ink-3 | raised / tab bar | 5.60 | AA |
| ink-3 | sunk | 4.79 | AA |
| accent-ink `#8E4122` | paper | 6.43 | AA |
| accent-ink | raised | 6.89 | AA |
| accent-ink | accent-tint `#F4E4D7` | 5.78 | AA |
| on-accent `#FFF8F0` | accent `#A04D29` | 5.56 | AA |
| accent (active tab bar, today ring) | paper / raised | 5.25 / 5.62 | AA (non-text ≥ 3) |
| feed `#875A10` | paper / raised / feed-tint | 5.38 / 5.76 / 4.95 | AA |
| sleep `#46518F` | paper / raised / sleep-tint | 6.65 / 7.12 / 6.01 | AA |
| diaper `#3B6A54` | paper / raised / diaper-tint | 5.58 / 5.98 / 5.04 | AA |
| pump `#7A4373` | paper / raised / pump-tint | 6.55 / 7.01 / 5.85 | AA |
| memory `#9C3C55` | paper / raised / memory-tint | 5.91 / 6.32 / 5.27 | AA |
| danger `#A42E27` | paper / danger-tint | 6.28 / 5.55 | AA |
| pill-text `#F7F2EA` | pill `#2A231E` | 13.88 | AAA |
| pill-muted `#C9BBAA` | pill | 8.23 | AAA |
| pill-feed `#D1A257` (icon, ring) | pill | 6.64 | AA |
| pill (Finish label) | pill-text button `#F7F2EA` | 13.88 | AAA |
| control-off `#8F8274` (toggle-off outline) | paper / raised / sunk | 3.36 / 3.59 / 3.07 | non-text ≥ 3 |
| knob `#FFFDF9` | accent (toggle on) | 5.76 | non-text ≥ 3 |
| `#FFF8F0` caption | darkest photo-cover scrim stop (≈ `#7A5E4E`) | 5.63 | AA |

**Dark (night)**

| Foreground | Background | Ratio | Passes |
|---|---|---|---|
| ink `#DCCFBE` | paper `#14110F` | 12.28 | AAA |
| ink | raised `#1C1815` | 11.51 | AAA |
| ink | sunk `#0F0D0B` | 12.66 | AAA |
| ink | tab bar `#181512` | 11.87 | AAA |
| ink-2 `#AD9F8E` | paper / raised / sunk | 7.28 / 6.82 / 7.51 | AA–AAA |
| ink-3 `#8F8273` | paper | 5.02 | AA |
| ink-3 | raised | 4.71 | AA |
| ink-3 | sunk / tab bar | 5.18 / 4.86 | AA |
| accent-ink `#DE9A73` | paper / raised / accent-tint | 8.04 / 7.54 / 6.36 | AA |
| on-accent `#1A110C` | accent `#D3875E` | 6.55 | AA |
| on-fab `#1A110C` (icon) | fab `#B26A45` | 4.46 | non-text ≥ 3 |
| fab | tab bar | 4.36 | non-text ≥ 3 |
| feed `#D1A257` | paper / raised / tint | 8.07 / 7.57 / 6.45 | AA |
| sleep `#9AA3D6` | paper / raised / tint | 7.69 / 7.21 / 6.29 | AA |
| diaper `#86B39A` | paper / raised / tint | 7.99 / 7.50 / 6.64 | AA |
| pump `#C48DBC` | paper / raised / tint | 7.06 / 6.62 / 5.90 | AA |
| memory `#DB8C9F` | paper / raised / tint | 7.40 / 6.94 / 6.04 | AA |
| danger `#E07F72` | paper / danger-tint | 6.67 / 5.57 | AA |
| pill-text `#DCCFBE` | pill `#2A2420` | 10.00 | AAA |
| pill-muted `#A39584` | pill | 5.24 | AA |
| pill-feed `#D1A257` | pill | 6.57 | AA |
| pill-text (Finish label) | night button `#3A322C` | 8.20 | AAA |
| control-off `#6E6357` | paper / raised / sunk | 3.21 / 3.01 / 3.31 | non-text ≥ 3 |
| accent (toggle-on track) | raised | 6.21 | non-text ≥ 3 |

Notes:
- `--rule` and `--rule-2` (1.65:1 light, 1.59:1 dark against paper) are decorative only. They never carry meaning alone. A secondary button is identified by its label, and the outline is a courtesy.
- In the night theme the toggle knob (`#DCCFBE`) on the accent track is only 1.85:1. That's acceptable because the **track** carries the on state (6.21:1 against the surface) and the knob position backs it up. Never use knob color alone to signal state.
- Darkest pair in the system: ink-3 on night raised, 4.71:1. Don't introduce a lighter tertiary on raised surfaces.

---

## 3. Typography

**Families** (self-hosted woff2, `font-display: swap`, zero third-party requests):
- **Fraunces** (variable: `opsz` 9–144, `wght` 100–900, `SOFT`, `WONK`). Files: `fonts/fraunces-latin-full-normal.woff2` (121 KB) and `fonts/fraunces-latin-full-italic.woff2` (150 KB). Always set `font-variation-settings: "SOFT" 50, "WONK" 0` and `font-optical-sizing: auto`. The wordmark alone uses `"SOFT" 100, "WONK" 1` italic.
- **Inter** (variable with `opsz`). File: `fonts/inter-latin-opsz-normal.woff2` (73 KB). Feature `cv11` (single-storey a) is on.
- Fallbacks: `Georgia, "Times New Roman", serif` / `system-ui, -apple-system, "Segoe UI", sans-serif`.
- Ship: subset both to Latin plus the punctuation in use (· – — ’ ½). Precache in the service worker. Licenses (OFL) sit next to the files.

**Numerals:** every time, duration, amount and count uses `font-variant-numeric: tabular-nums lining-nums` (`.num`). Live timers must not jitter. Units are set in smaller Inter after a serif numeral: `2`h`10`m, `4`oz.

| Role | Family | Size / line-height | Weight | Tracking | Example |
|---|---|---|---|---|---|
| Display XL (onboarding) | Fraunces | 44 / 1.02 | 380 (italic 360 for the accent line) | −0.025em | "Free. Private." |
| Hero numeral | Fraunces | 56 / 0.95 | 380 | −0.03em | Stash "46 oz" |
| Screen title | Fraunces | 34–38 / 1.0–1.05 | 400 | −0.015em | "Clara", "Customize" |
| Since-last value | Fraunces | 34 / 1.0 | 400 | −0.02em | "2h 10m" |
| Sheet title | Fraunces | 28 / 1.1 | 400 | −0.015em | "Log for Clara" |
| Section head | Fraunces | 24 / 1.2 | 400 | −0.01em | "Today", "The day" |
| Stat value | Fraunces | 23 / 1.0 | 420 | −0.015em | "14h 30m" |
| Tile / milestone title | Fraunces | 18–21 / 1.1–1.2 | 430 | −0.01em | "Bottle", "First real smile" |
| Row amount | Fraunces | 20–22 / 1.0 | 420 | −0.01em | "3.5 oz" |
| Age subtitle | Fraunces italic | 17 | 300 | 0 | "6 weeks, 1 day" |
| Body / row title | Inter | 16 / 1.3 | 550 | −0.005em | "Bottle" |
| Button | Inter | 16 (block 17) | 600 | −0.005em | "Continue" |
| Secondary | Inter | 14–15 / 1.35–1.4 | 400–450 | 0 | "4 oz formula · 7:40 AM" |
| Caption / meta | Inter | 13 / 1.35 | 400–500 | 0 | "Fridge or freezer pouch" |
| Eyebrow / category key | Inter caps | 12 | 600–650 | +0.08–0.09em | "FED", "MILK STASH" |
| Tab label / micro | Inter | 11–12 | 550–700 | +0.01–0.07em | "Today", "LIVE", "AM" |

The 11px floor applies only to uppercase micro labels (AM/PM, LIVE) that repeat information already shown elsewhere. Body text never drops below 13px. All sizes are in rem so Dynamic Type / browser zoom works. At 200% the since-last grid falls back to one column.

---

## 4. Spacing, layout, radii, elevation

**Spacing (4pt grid):** `4, 8, 12, 16, 20, 24, 32, 40, 48`. Page gutter is **20**. Grouped lists and sheet tiles are inset **16**. Rows are 54–62 tall (min 44 hit), and section heads get 22 above and 6 below.

**Layout:** 390 × 844 reference. Status-bar safe area 47. Bottom nav 98 including the 34 home-indicator inset. The live pill sits 130 from the bottom (16 side insets, 60 tall). A paper-colored fade (150 tall) above the nav keeps content from colliding with the pill. Use `env(safe-area-inset-*)` in production.

**Radii:** `4` photos and thumbnails (a printed-photo feel) · `6` memory cover · `14` dragged row · `16` day-pager cell · `20` tiles, grouped lists, wide rows · `22` hero pouch · `30` sheet top corners · `999` buttons, chips, badges, pill, toggles, avatar.

**Elevation:** kept minimal. Most things are flat on paper with hairlines.

| Level | Light | Dark | Used by |
|---|---|---|---|
| 0 | none plus 1px `--rule` inset | same | lists, tiles, cards |
| 1 | `0 1px 2px rgb(42 35 30/.06), 0 4px 12px -6px rgb(42 35 30/.10)` | `0 0 0 1px rgb(0 0 0/.2)` | hero pouch |
| 2 | `0 2px 6px …/.06, 0 18px 40px -12px …/.22` | `0 18px 40px -12px rgb(0 0 0/.7)` plus 1px `--pill-rule` ring | live pill, dragged row |
| Sheet | `0 -18px 48px -16px …/.28` | `0 -18px 48px -16px rgb(0 0 0/.8)` | sheets |

In the dark theme elevation comes from lighter surfaces (`raised` > `paper` > `sunk`) and 1px rings, never from glow. No `backdrop-filter` anywhere (fixes the glassmorphism problem in AUDIT §6.6).

---

## 5. Components

All interactive elements are at least 44 × 44 (hit area may extend past the visual). Every state uses the tokens above. Focus ring for all components is `outline: 2px solid var(--accent-ink); outline-offset: 2px`, shown on `:focus-visible` only.

| Component | Anatomy & sizing | States |
|---|---|---|
| **Button: primary** | Accent fill, on-accent label, 48 tall (block 56), radius 999, 22 side padding, optional 20px leading icon | default · pressed (scale .98, fill darkened 8%) · focus ring · disabled (sunk fill, ink-3 label, no shadow) · loading (label swaps to a 3-dot ellipsis, width locked) |
| **Button: secondary** | Transparent, 1.25px `--rule-2` inset outline, ink label | pressed (`--sunk` fill) · focus · disabled (ink-3 label) |
| **Button: ghost** | Accent-ink label, no outline, 44 tall, 12 padding (links such as "Timeline ›", "I have a backup file") | pressed (accent-tint fill) · focus · disabled |
| **Button: destructive** | `--danger` fill, on-accent label. Only inside a confirm sheet, never on a list row. Delete is otherwise undo-based. | pressed · focus · disabled |
| **QuickLogCard** (since-last) | The whole half-width cell is one button (min 128 tall): category key (icon + caps label) · serif value + unit · one-line detail · 28px tinted action glyph (+, or ☀ "wake" for a running sleep). Pump adds a 4px goal bar. | idle · running (value counts up live, LIVE dot, glyph becomes the stop action) · stale (> 3h since feed: detail line turns accent-ink, never red) · hidden (removed by Customize, grid reflows) · pressed (sunk fill on the cell) |
| **Sheet** | Raised surface, 30 top radius, 40 × 5 grabber in a 24 hit strip, serif title + one-line hint, top-right "when" chip (Now ▾). Content scrolls inside it. Primary action pinned to the bottom above the safe area. | peek (quick-log, content height) · expanded (forms, up to 92% height) · dragging (follows finger, scrim opacity tracks the drag) · dismissed by swipe down, scrim tap, × or Escape. Focus is trapped inside, then returned to the invoker on close. |
| **Toast w/ Undo** | Pill surface (`--pill`), 52 tall, sits where the live pill would (pushes the live pill up 60 if both show). Message plus "Undo" ghost button in `--pill-feed`. 6s timer, paused while touched or focused. | showing · undoing (text swaps to "Restored") · stacked (a newer toast replaces the old one, no queue) · `role="status"` with `aria-live="polite"` |
| **LivePill** | 60 tall, dark pill, 42 progress ring with category icon, "Bottle · 12:04" (tabular) + "good for 1h 48m", 44 tall "Finish" button | running · paused (ring dashed, "Paused" label, Resume button) · warning (< 15 min left: secondary text turns `--pill-feed`, no flashing) · multiple (shows the most recent one, "+1" chip opens a list) · tap body to open the activity's sheet |
| **ListRow** (timeline) | Grid: time (52, right-aligned, tabular, AM/PM micro) · 32 category chip sitting on a 1px spine · title + detail · serif amount. Min 62 tall. | default · pressed (sunk) · running (amount in category ink, "still going") · newly inserted (see motion) · swipe left shows Edit / Delete (Delete leads to toast + undo) |
| **Chip** | 32 or 44 circle, category tint fill, category ink icon (`.chip-ic`). Text chips/badges: 24–26 tall, radius 999, 12/600. | category · neutral (sunk / ink-2) · soon (accent-tint / accent-ink) · expired (danger-tint / danger). Expiry badges always pair an icon (clock / hourglass / ⚠) with text. |
| **SegmentedControl** | Sunk track with 1px rule inset, 3 padding, 40-tall segments, radius 999. Selected segment is raised with a level-1 shadow. Used for Formula / Breast milk / Breastfeed and L / R. | selected · unselected · pressed · disabled. `role="radiogroup"`, arrow keys move between segments. |
| **NumberStepper** | Huge serif value (44) with unit, − / + 56 round secondary buttons either side, quick-pick chips below (2, 3, 4, 5 oz). Long-press repeats. | default · at min/max (button disabled, haptic tick) · editing (tap value to type, numeric keypad) · `role="spinbutton"` with `aria-valuenow` and `aria-valuetext="4 ounces"` |
| **Toggle** | 52 × 32 track, 26 knob. On: accent track + knob. Off: sunk track, 1.5px control-off outline, control-off knob. Hit area 52 × 44. | on · off · pressed (knob widens 4px) · disabled (40% opacity) · `role="switch"` + `aria-checked` |
| **EmptyState** | Serif one-liner, Inter sub-line, one ghost or secondary action, optional 48px line icon in ink-3. No illustrations of bows or vines. | e.g. Stash: "No milk saved yet." / "Pumped milk you store will line up here, oldest first." / [Add pouch] |
| **TimelineStrip** | 350 wide SVG, four 18-tall lanes on sunk with 16px lane icons. Hour grid every 3h, major lines at 12a / 12p. Sleep: night = solid, nap = 55% opacity. Feed: 2.4 ticks, breastfeeding dashed. Diaper: wet = ring, dirty = filled, both = ring + dot. Pump: 5-wide bars, height ∝ amount. | Day view (default) · tap a mark to scroll the list to that entry · now-line in accent for today · `role="img"` with an `aria-label` summary plus the list below as the accessible equivalent |
| **Avatar** | 48 circle photo (or the initial in serif on accent-tint) with a 20px gear badge bottom-right. Opens Settings. Onboarding picker: 104 circle, dashed accent outline, "Add photo", 32 accent + badge. | default · no photo (initial) · pressed · night (photo brightness .72) |
| **DayPager** | Title "Tuesday, Oct 13" + 44 ‹ › icon buttons, 7-day row below (34 circles). Selected = ink fill. Today = accent ring + accent-ink numeral. | selected · today · future (disabled, ink-3 at 50%) · swipe horizontally on the content to page |
| **Tab bar** | 5-column grid (1fr 1fr 84 1fr 1fr), 64 tall targets, 24 icons + 12 label. Active = ink + 2px accent bar on top edge. Center 60px + button (fab) raised 18 above, with a 5px surface-colored ring. | active · inactive · pressed · the + becomes an ink × while its sheet is open |

---

## 6. Motion contract

The rule (AUDIT §3): **everything enters from and exits to what summoned it.** Motion explains where things came from. It's never decoration.

**Tokens**
| Token | Value | Use |
|---|---|---|
| `--dur-1` | 120ms | press feedback, toggle knob, color changes |
| `--dur-2` | 200ms | toast, pill, small moves, fades |
| `--dur-3` | 280ms | sheet open, tab content, step changes |
| `--dur-4` | 360ms | quick-log grow from +, large sheets |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | entering |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | exiting (exits run at about 75% of the enter duration) |
| `--ease-std` | `cubic-bezier(.4, 0, .2, 1)` | moving between two on-screen states |
| `--spring-sheet` | `cubic-bezier(.32, .72, 0, 1)` | sheet follow-through after a drag release |

| Moment | Origin → destination | Spec |
|---|---|---|
| **Quick-log grows from +** | + button (bottom center) | Sheet starts as a 60px circle clipped at the + position (`clip-path: circle(30px at 50% calc(100% - 64px))`) and expands to full sheet in `--dur-4` `--ease-out`. Tiles fade/rise 8px with 20ms stagger starting at 120ms. The + icon rotates 45° into × (`--dur-2`) and the fill crossfades accent → ink. A faint accent radial glow stays anchored at the + (visible in frame 3). Close plays it in reverse (`--dur-3` `--ease-in`) back into the button. |
| **Sheet open** (from a since-last card, row or pill) | The tapped element | Sheet translates up from the bottom edge in `--dur-3` `--ease-out`. The invoker gets a 120ms press-scale and keeps a sunk highlight until the sheet covers it. |
| **Sheet close** | Back to the bottom edge / invoker | `--dur-2` `--ease-in` translate down. A drag release beyond 30% height or 600px/s velocity dismisses with `--spring-sheet` and the remaining distance's time. Below that it snaps back. |
| **Backdrop** | Behind the sheet | Scrim fades 0 → scrim in lockstep with the sheet (same duration and easing). During a drag its opacity is proportional to sheet position. Today behind the sheet scales to 0.985 (light theme only). |
| **Tab switch** | Direction of the tab | Content slides 24px plus a crossfade in `--dur-3` `--ease-std`. Going to a tab on the right enters from the right, to the left enters from the left. The active bar slides between tabs. Scroll position is restored per tab. |
| **Step forward / back** (feed flow, onboarding) | Forward = from right, back = from left | Outgoing step moves −32px and fades (`--dur-2` `--ease-in`). Incoming moves +32px → 0 (`--dur-3` `--ease-out`). Sheet height animates to fit with `--ease-std`. The onboarding step bar fills left to right. |
| **Toast** | From the bottom, above the nav | Rises 16px and fades in (`--dur-2` `--ease-out`). Exits by fading and dropping 8px (`--dur-2` `--ease-in`). Undo collapses the toast and the restored row re-inserts (below). |
| **New row inserted** | From the sheet that created it | After the sheet closes, the new row expands from 0 height (`--dur-3` `--ease-out`) at its chronological position. Its chip scales 0.6 → 1 and the row gets a category-tint wash that fades over 1.2s. The matching since-last value crossfades to the new number. |
| **Live pill appear** | From the action that started it | Pill rises 12px from the nav and fades in (`--dur-2` `--ease-out`). The ring starts drawing immediately. On Finish the pill collapses toward the + button (scale .9, fade, `--dur-2`) while the entry inserts in the list. Timer digits never animate per tick. |
| **Press** | In place | Scale .97–.98 over `--dur-1`. No ripple. |

**Reduced motion** (`prefers-reduced-motion: reduce`): all translate, scale and clip-path animations become **opacity crossfades of 120ms** (sheet, tab, step, toast, pill). No stagger, no parallax, no Today scale-back. The new-row tint wash stays (it's color, not motion) but is shortened to 600ms. Drag-to-dismiss still works, without the spring. The live ring updates in steps, once a minute. An in-app "Reduce motion" setting mirrors the media query.

---

## 7. Icons

- 24 × 24 grid, **1.7px stroke** (1.9 at 16px, 1.8 at 18px, 2.1 for + and the action glyphs), `stroke-linecap: round`, `stroke-linejoin: round`, no fills, `currentColor` only.
- Corner radius about 2px on rectangles, 2px optical padding inside the grid. Shapes are simple and literal: bottle, drop (breastfeeding), crescent (sleep), diaper cup, flange (pump), pouch/jar (stash), sparkle (memories), book (Memories tab), sun (Today / wake), list (Timeline), gear, lock, shield, camera, clock, hourglass, chevrons, grip (6 dots).
- Icons are inline `<symbol>` sprites, `aria-hidden="true"`. The button's `aria-label` or visible text carries the meaning. No emoji as UI. No decorative bows, vines or hearts.
- Category icons take the category ink. Navigation and utility icons take ink / ink-2 / ink-3.

---

## 8. Night mode

- **Trigger:** follows the system by default. Optional "Night mode: auto 8pm–7am" in Settings, plus a manual override. Switching crossfades over 200ms (instant when reduced motion is on).
- **Genuinely dim:** paper `#14110F` (not pure black, to avoid OLED smear on scroll). The brightest text is `#DCCFBE`, a warm parchment rather than white, at 12.3:1. No element is brighter than the primary text.
- **Accent is softened** to `#D3875E` for text and toggles. The + button gets a dimmer `#B26A45` so the largest accent shape isn't the brightest object on a dark screen.
- **Photos and avatars** render at `brightness(.7) saturate(.85)`. Category tints become deep low-chroma versions of the same hue.
- **No pure white, no glow, no blur.** Shadows give way to 1px rings and surface steps.
- **The live pill stays the same** in both themes (dark pill, amber ring), so it's recognisable at a glance at any hour.
- Status bar and `theme-color` meta follow `--paper`. Haptics are preferred over sounds. Nothing flashes, including timer warnings.

---

## 9. Privacy and copy surfaces

- Onboarding leads with **"Free. Private. Everything stays on this phone."** Three hairline-ruled promises follow: No account / Works offline / Yours to keep (export or erase).
- Settings → Customize ends with a **Privacy row**: lock icon, "On this phone only", "No account, ads or tracking", plus live proof ("0 network requests · 14.2 MB stored"). It opens Privacy & data (export, import, erase).
- Fonts and icons are bundled. The shipped app makes zero third-party requests (the mockup itself loads only local `fonts/`).

---

## 10. Frame index

1. Today, light: masthead (date eyebrow, serif name + italic age, avatar → Settings), 2 × 2 since-last grid in hairlines, today's journal list, live pill (bottle 12:04, good for 1h 48m), nav with center +.
2. Today, night: same content in night tokens.
3. Quick-log sheet growing from the + button over a dimmed Today: grabber, "Now ▾" time chip, six big tiles (sleep tile shows LIVE → "Wake up"), Add milk to stash row, + turned to ×.
4. Timeline: day title + ‹ › pager + 7-day strip, four daily stats, 24h activity strip (sleep blocks, feed ticks, diaper rings/dots, pump bars), the day's list newest first.
5. Stash: 46 oz hero numeral, fridge/freezer split bar, "Use next" 4 oz pouch from Sep 2 with Thaw / Thaw & feed, fridge list with expiry badges (CDC: 4 days fridge, 6–12 months freezer).
6. Memories: a keepsake book with a mounted cover photo, Firsts list with mounted thumbnails and a suggested next milestone, weekly photo grid.
7. Settings → Customize: grouped toggle list with category chips and drag handles (Sleep shown mid-drag), Memories toggled off to show the off state, Privacy row.
8. Onboarding: wordmark, step bar, the privacy promise, circular photo picker, name/born fields, restore link, Continue.
