# Calm Oat — Nurture design system (candidate)

> **The feeling:** a quiet, sunlit nursery at 3 a.m. Oat, sand and linen neutrals. One clay accent, carried over from today's brand. Five soft category hues so you can tell what happened without reading. Big friendly numbers, and plenty of room around them.

Files in this folder:

| File | What it is |
|---|---|
| `mockup.html` | 8 static phone frames (390 × 844). Self-contained: inline CSS and an inline SVG icon sprite, no JS. It makes **0 network requests**, which was checked in Playwright. |
| `frame-1.png` … `frame-8.png` | Element screenshots at deviceScaleFactor 2 (780 × 1688). |
| `fonts/nunito-latin-wght-normal.woff2` | Nunito variable (wght 200–1000), latin, 39 KB. SIL OFL 1.1. |
| `fonts/fraunces-latin-full-normal.woff2` | Fraunces variable (opsz 9–144, wght 100–900, SOFT 0–100, WONK 0–1), latin, 121 KB. SIL OFL 1.1. |

Both fonts come from the `@fontsource-variable/nunito@5.3.0` and `@fontsource-variable/fraunces@5.3.0` npm tarballs. These are the same files jsDelivr serves, and jsDelivr itself is blocked in this sandbox. Both files were checked: non-zero size and the `wOF2` magic number.

---

## 1. Principles

1. **One glance, one tap.** Today answers "when did she last eat, sleep, get changed, when did I pump" in four cards. Each card is also the button that logs that thing.
2. **Color is a hint, never the message.** Every category color comes with an icon and a word: Fed, Asleep, Diaper, Pumped. The timeline lanes are labelled by icon. Diaper type is shown by shape (ring = wet, filled = dirty, ring + dot = both), not by hue.
3. **Flat and warm, no glass.** Tinted cards sit flat on the oat background. White cards get one soft shadow. There's no blur, no gradients on chrome, and no decorative bows or vines.
4. **Nothing comes from nowhere.** Every surface grows out of whatever summoned it and goes back into it (§8).
5. **Private by construction.** Fonts are self-hosted, nothing is fetched, the promise is on screen 1, and a Privacy row sits in Settings.

---

## 2. Color tokens

Tokens live on `:root`. Night mode redefines tokens only and never touches components.

### 2.1 Neutrals and accent

| Token | Light | Night | Role |
|---|---|---|---|
| `--bg` | `#F6F1E8` oat | `#14110E` | App background |
| `--surface` | `#FFFCF7` linen | `#1E1A16` | Cards, lists, sheets, nav |
| `--surface-2` | `#EFE8DC` sand | `#28221D` | Fields, chips, tracks, secondary rows |
| `--line` | `#E9DFD0` | `#2E2822` | Hairline dividers (decorative only) |
| `--line-strong` | `#958675` | `#7E7163` | Control outlines (off toggle, input border), ≥3:1 |
| `--text` | `#2B2420` warm ink | `#D9CDBC` | Primary text. Night is never pure white. |
| `--text-2` | `#665A4E` | `#A89A89` | Secondary text |
| `--text-3` | `#766A5D` | `#9B8E7E` | Tertiary text (AM/PM, axis, inactive tabs). Still ≥4.5:1. |
| `--accent` | `#A6532F` clay | `#D48660` | Primary buttons, +, active tab icon, toggles on, now-line |
| `--accent-press` | `#8F4627` | `#C27A56` | Pressed primary |
| `--on-accent` | `#FFFCF7` | `#1C130E` | Label on accent |
| `--accent-soft` | `#F5E3D6` | `#3A281E` | Accent-tinted chips, avatar ring, now flag |
| `--accent-ink` | `#97492A` | `#E39A74` | Accent-colored text: links, back, wordmark |
| `--fab-bg` | `= --accent` | `#B9714F` | Center +. It's dimmer at night so the brightest thing on screen isn't a button. |
| `--pill-bg` / `--pill-text` / `--pill-text-2` | `#2B2420` / `#F6EFE4` / `#C9BBAB` | `#2E2722` / `#D9CDBC` / `#A89A89` | Live pill and toast. They're dark in both themes so they read as "floating, live". |
| `--scrim` | `rgba(38,29,22,.46)` | `rgba(0,0,0,.60)` | Sheet backdrop |
| `--danger-tint` / `--danger-ink` | `#F8E0DA` / `#A3392A` | `#3A201B` / `#EE9483` | Destructive buttons and errors |
| `--warn-tint` / `--warn-ink` | `#FBE9C8` / `#7F5310` | `#352A16` / `#E2B565` | Expiry soon, overdue |
| `--ok-tint` / `--ok-ink` | `#E3ECDD` / `#46663F` | `#1F2A1F` / `#98BB91` | Fresh, done |

### 2.2 Category colors

Each category has three tones:
- **tint** for card and chip fills
- **ink** for text and icons on tint or surface
- **mid** for graphics such as timeline marks, progress fills and the stash split bar

| Category | Hue | Light tint / ink / mid | Night tint / ink / mid | Icon |
|---|---|---|---|---|
| Feed (bottle, nurse) | warm apricot | `#FCE7D4` / `#9A5419` / `#BA682E` | `#33251A` / `#E7A673` / `#C07F52` | bottle, nurse |
| Sleep | dusk lavender | `#ECE7F5` / `#62558F` / `#8576B8` | `#262236` / `#B2A6DE` / `#8B7EBF` | moon (asleep) / sun (awake) |
| Diaper | sage | `#E3ECDD` / `#4A6B47` / `#668960` | `#1F2A1F` / `#98BB91` / `#78986F` | diaper |
| Pump + stash milk | clay rose | `#F7E2E6` / `#9C4459` / `#BF6079` | `#35212A` / `#E098AA` / `#BA6F83` | pump, pouch |
| Memories / milestones | honey | `#F7EDCD` / `#7E6211` / `#9C7A18` | `#30291A` / `#D8B866` / `#B39445` | spark |

Rules:
- The clay **accent** is reserved for actions and "now" (+, primary buttons, toggles, now-line, links). Feed apricot is lighter and more orange, and it never appears on a button fill.
- Use category hue only where the category is the subject. Neutral chrome stays neutral.
- Stash fridge and freezer are two tones of pump-mid, told apart by the fridge and snowflake icons and the words "Fridge" and "Freezer".

### 2.3 Computed contrast (WCAG 2.1 relative luminance)

All ratios below were computed from the hex values with the WCAG formula. Every pair used in the mockup passes in both themes.

| Pair (fg on bg) | Use | Light fg / bg | Light ratio | Dark fg / bg | Dark ratio | Target |
|---|---|---|---|---|---|---|
| `text` on `bg` | body/titles | #2B2420 / #F6F1E8 | 13.57 | #D9CDBC / #14110E | 12.01 | ≥4.5:1 |
| `text` on `surface` | card text | #2B2420 / #FFFCF7 | 14.91 | #D9CDBC / #1E1A16 | 11.04 | ≥4.5:1 |
| `text` on `surface2` | field values | #2B2420 / #EFE8DC | 12.53 | #D9CDBC / #28221D | 10.03 | ≥4.5:1 |
| `text2` on `bg` | secondary text | #665A4E / #F6F1E8 | 5.95 | #A89A89 / #14110E | 6.85 | ≥4.5:1 |
| `text2` on `surface` | row subtitles | #665A4E / #FFFCF7 | 6.54 | #A89A89 / #1E1A16 | 6.30 | ≥4.5:1 |
| `text2` on `surface2` | field labels, time chip | #665A4E / #EFE8DC | 5.50 | #A89A89 / #28221D | 5.72 | ≥4.5:1 |
| `text3` on `bg` | tertiary (AM/PM, axis) | #766A5D / #F6F1E8 | 4.68 | #9B8E7E / #14110E | 5.88 | ≥4.5:1 |
| `text3` on `surface` | AM/PM in rows, axis labels | #766A5D / #FFFCF7 | 5.14 | #9B8E7E / #1E1A16 | 5.40 | ≥4.5:1 |
| `text3` on `nav` | inactive tab label | #766A5D / #FFFCF7 | 5.14 | #9B8E7E / #1A1613 | 5.62 | ≥4.5:1 |
| `accentInk` on `bg` | links, wordmark | #97492A / #F6F1E8 | 5.65 | #E39A74 / #14110E | 8.19 | ≥4.5:1 |
| `accentInk` on `surface` | back link, ghost button | #97492A / #FFFCF7 | 6.21 | #E39A74 / #1E1A16 | 7.53 | ≥4.5:1 |
| `accentInk` on `accentSoft` | Now flag, privacy chip icon | #97492A / #F5E3D6 | 5.10 | #E39A74 / #3A281E | 6.08 | ≥4.5:1 |
| `onAccent` on `accent` | primary button label | #FFFCF7 / #A6532F | 5.26 | #1C130E / #D48660 | 6.42 | ≥4.5:1 |
| `onAccent` on `fab` | + button glyph | #FFFCF7 / #A6532F | 5.26 | #1C130E / #B9714F | 4.82 | ≥3:1 |
| `accent` on `nav` | active tab icon | #A6532F / #FFFCF7 | 5.26 | #D48660 / #1A1613 | 6.32 | ≥3:1 |
| `accent` on `surface` | toggle on, now line | #A6532F / #FFFCF7 | 5.26 | #D48660 / #1E1A16 | 6.07 | ≥3:1 |
| `lineStrong` on `surface` | control outlines (off toggle, inputs) | #958675 / #FFFCF7 | 3.45 | #7E7163 / #1E1A16 | 3.65 | ≥3:1 |
| `pillText` on `pill` | live pill title + timer | #F6EFE4 / #2B2420 | 13.36 | #D9CDBC / #2E2722 | 9.38 | ≥4.5:1 |
| `pillText2` on `pill` | live pill subtitle | #C9BBAB / #2B2420 | 8.13 | #A89A89 / #2E2722 | 5.35 | ≥4.5:1 |
| `pillInk` on `pill` | live pill icon/dot | #E7A673 / #2B2420 | 7.34 | #E7A673 / #2E2722 | 7.07 | ≥3:1 |
| `feedInk` on `feedTint` | feed label/icon on tint | #9A5419 / #FCE7D4 | 4.79 | #E7A673 / #33251A | 7.11 | ≥4.5:1 |
| `text` on `feedTint` | value on feed card | #2B2420 / #FCE7D4 | 12.73 | #D9CDBC / #33251A | 9.44 | ≥4.5:1 |
| `text2` on `feedTint` | subtitle on feed card | #665A4E / #FCE7D4 | 5.58 | #A89A89 / #33251A | 5.39 | ≥4.5:1 |
| `feedInk` on `surface` | feed icon on surface | #9A5419 / #FFFCF7 | 5.61 | #E7A673 / #1E1A16 | 8.32 | ≥3:1 |
| `feedMid` on `surface2` | feed strip mark on track | #BA682E / #EFE8DC | 3.38 | #C07F52 / #28221D | 4.79 | ≥3:1 |
| `feedMid` on `surface` | feed graphic on card | #BA682E / #FFFCF7 | 4.02 | #C07F52 / #1E1A16 | 5.27 | ≥3:1 |
| `sleepInk` on `sleepTint` | sleep label/icon on tint | #62558F / #ECE7F5 | 5.39 | #B2A6DE / #262236 | 6.89 | ≥4.5:1 |
| `text` on `sleepTint` | value on sleep card | #2B2420 / #ECE7F5 | 12.58 | #D9CDBC / #262236 | 9.83 | ≥4.5:1 |
| `text2` on `sleepTint` | subtitle on sleep card | #665A4E / #ECE7F5 | 5.52 | #A89A89 / #262236 | 5.61 | ≥4.5:1 |
| `sleepInk` on `surface` | sleep icon on surface | #62558F / #FFFCF7 | 6.38 | #B2A6DE / #1E1A16 | 7.74 | ≥3:1 |
| `sleepMid` on `surface2` | sleep strip mark on track | #8576B8 / #EFE8DC | 3.27 | #8B7EBF / #28221D | 4.36 | ≥3:1 |
| `sleepMid` on `surface` | sleep graphic on card | #8576B8 / #FFFCF7 | 3.89 | #8B7EBF / #1E1A16 | 4.80 | ≥3:1 |
| `diaperInk` on `diaperTint` | diaper label/icon on tint | #4A6B47 / #E3ECDD | 4.97 | #98BB91 / #1F2A1F | 6.99 | ≥4.5:1 |
| `text` on `diaperTint` | value on diaper card | #2B2420 / #E3ECDD | 12.58 | #D9CDBC / #1F2A1F | 9.52 | ≥4.5:1 |
| `text2` on `diaperTint` | subtitle on diaper card | #665A4E / #E3ECDD | 5.52 | #A89A89 / #1F2A1F | 5.43 | ≥4.5:1 |
| `diaperInk` on `surface` | diaper icon on surface | #4A6B47 / #FFFCF7 | 5.89 | #98BB91 / #1E1A16 | 8.11 | ≥3:1 |
| `diaperMid` on `surface2` | diaper strip mark on track | #668960 / #EFE8DC | 3.25 | #78986F / #28221D | 4.88 | ≥3:1 |
| `diaperMid` on `surface` | diaper graphic on card | #668960 / #FFFCF7 | 3.86 | #78986F / #1E1A16 | 5.37 | ≥3:1 |
| `pumpInk` on `pumpTint` | pump label/icon on tint | #9C4459 / #F7E2E6 | 5.02 | #E098AA / #35212A | 6.59 | ≥4.5:1 |
| `text` on `pumpTint` | value on pump card | #2B2420 / #F7E2E6 | 12.34 | #D9CDBC / #35212A | 9.56 | ≥4.5:1 |
| `text2` on `pumpTint` | subtitle on pump card | #665A4E / #F7E2E6 | 5.41 | #A89A89 / #35212A | 5.45 | ≥4.5:1 |
| `pumpInk` on `surface` | pump icon on surface | #9C4459 / #FFFCF7 | 6.06 | #E098AA / #1E1A16 | 7.61 | ≥3:1 |
| `pumpMid` on `surface2` | pump strip mark on track | #BF6079 / #EFE8DC | 3.34 | #BA6F83 / #28221D | 4.26 | ≥3:1 |
| `pumpMid` on `surface` | pump graphic on card | #BF6079 / #FFFCF7 | 3.97 | #BA6F83 / #1E1A16 | 4.68 | ≥3:1 |
| `memInk` on `memTint` | mem label/icon on tint | #7E6211 / #F7EDCD | 4.93 | #D8B866 / #30291A | 7.52 | ≥4.5:1 |
| `text` on `memTint` | value on mem card | #2B2420 / #F7EDCD | 13.05 | #D9CDBC / #30291A | 9.20 | ≥4.5:1 |
| `text2` on `memTint` | subtitle on mem card | #665A4E / #F7EDCD | 5.72 | #A89A89 / #30291A | 5.25 | ≥4.5:1 |
| `memInk` on `surface` | mem icon on surface | #7E6211 / #FFFCF7 | 5.63 | #D8B866 / #1E1A16 | 9.03 | ≥3:1 |
| `memMid` on `surface2` | mem strip mark on track | #9C7A18 / #EFE8DC | 3.31 | #B39445 / #28221D | 5.41 | ≥3:1 |
| `memMid` on `surface` | mem graphic on card | #9C7A18 / #FFFCF7 | 3.94 | #B39445 / #1E1A16 | 5.96 | ≥3:1 |
| `warnInk` on `warnTint` | expiry warning badge | #7F5310 / #FBE9C8 | 5.59 | #E2B565 / #352A16 | 7.38 | ≥4.5:1 |
| `okInk` on `okTint` | fresh badge | #46663F / #E3ECDD | 5.35 | #98BB91 / #1F2A1F | 6.99 | ≥4.5:1 |
| `pumpInk` on `surface` | USE NEXT tag | #9C4459 / #FFFCF7 | 6.06 | #E098AA / #1E1A16 | 7.61 | ≥4.5:1 |

Further pairs that aren't in the mockup frames but are specified for components:

| Pair | Light | Night |
|---|---|---|
| `on-accent` on `accent-press` | `#FFFCF7`/`#8F4627` **6.68** | `#1C130E`/`#C27A56` **5.41** |
| Destructive filled: `#FFFCF7` on `danger-ink` | `#A3392A` **6.46** | `#1C130E` on `#EE9483` **8.01** |
| Destructive soft: `danger-ink` on `danger-tint` | **5.25** | **6.56** |
| `accent-ink` on `surface-2` (link inside a field) | **5.22** | **6.84** |
| `accent` on `surface-2` (now-line over the track, UI) | **4.42** (≥3) | **5.52** |
| Undo in toast: `pill-ink #E7A673` on `pill-bg` | **7.34** | **7.07** |

`--line` (≈1.3:1) is only ever a decorative divider. Anything that has to be seen as a control boundary uses `--line-strong` (3.45 / 3.65), or it's a filled shape.

---

## 3. Typography

Two families, both self-hosted woff2 with zero third-party requests:

- **Fraunces** (variable) is the *soft display face*. Set it with `font-variation-settings: "SOFT" 100, "WONK" 0` and `font-optical-sizing: auto`, weight 560. SOFT 100 rounds the serifs, so it feels like a picture-book title rather than a newspaper. Use it for big numbers, page titles, the baby's name and the onboarding headline.
- **Nunito** (variable) is the rounded UI sans. Use it for everything else, including all *running* numbers.

**Tabular numerals, checked against the font files:**
- Nunito's digits are fixed-width by default: every digit is 600 units, and `:` is 211. So timers, list times and amounts don't jitter. We still set `font-variant-numeric: tabular-nums` (the `.tnum` class) on every time and amount, so a future font swap keeps the behaviour.
- **Fraunces has proportional digits and no `tnum` feature.** Rule: Fraunces is only for numbers that change at most once a minute and are left-aligned ("2h 10m", "46 oz", "4 oz"). **Anything that ticks every second uses Nunito 800**: the live pill "12:04" and the sheet timers.

| Style | Family | Size / line | Weight | Use |
|---|---|---|---|---|
| `display-xl` | Fraunces | 44 / 46 | 560 | Stash total |
| `display-l` | Fraunces | 38 / 42 | 560 | Since-last values, onboarding headline (−0.02em) |
| `display-m` | Fraunces | 32 / 36 | 560 | Page titles (Timeline, Stash, Memories), "Use next" amount |
| `display-s` | Fraunces | 26–28 / 30–32 | 560 | Baby name in header, sheet title |
| unit suffix | Fraunces | 55% of value | 500, `--text-2` | the `h`, `m`, `oz` after a display number |
| `timer` | Nunito | 24 / 28 (pill) · 56 / 60 (sheet) | 800, tnum | Running timers |
| `title` | Nunito | 20 / 26 | 800 | Section headers ("Today") |
| `headline` | Nunito | 17 / 22 | 800 | Button labels, amounts in rows, pager day |
| `body` | Nunito | 16 / 22 | 800 titles · 600 text | Row titles, list text, inputs (16+ avoids iOS zoom) |
| `callout` | Nunito | 15 / 21 | 600–800 | Card labels, intro copy, links |
| `subhead` | Nunito | 14 / 19 | 600 | Row subtitles, card sub-lines |
| `footnote` | Nunito | 13 / 18 | 600–800 | Badges, hints, uppercase group labels (+0.06em) |
| `caption` | Nunito | 12 / 16 | 700–800 | Tab labels, AM/PM, strip axis. **This is the minimum size; nothing is smaller.** |

Sizes are written in `rem` in code (16px root), so iOS text-size settings scale the UI. Cards grow taller instead of truncating at large sizes.

---

## 4. Spacing, radii, elevation, layout

**Spacing (4pt grid):** `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48.
- Screen gutter: 20 (onboarding 24).
- Card padding: 14–16.
- Grid gaps: 12 (cards), 10 (tiles), 8 (stats), 6 (photo grid).
- Section gap: 14–20.

**Radii:**

| Token | Value | Used for |
|---|---|---|
| `--r-xs` | 8 | Strip tracks |
| `--r-sm` | 14 | Category icon chips, fields |
| `--r-md` | 18 | Stat tiles |
| `--r-lg` | 22 | Lists, white cards, sheet tiles |
| `--r-xl` | 24 | QuickLogCards, Use-next hero |
| `--r-sheet` | 28 | Sheet top corners |
| `--r-pill` | 9999 | Buttons, chips, live pill, toggles |

**Elevation.** Light theme uses shadows. In night theme shadows become a 1px `rgba(255,240,220,.03–.06)` hairline, because a shadow can't be seen on near-black.

| Level | Light value | Used for |
|---|---|---|
| e0 | none | Tinted cards and tiles. Their color is the separation. |
| e1 | `0 1px 2px rgba(60,40,20,.05), 0 4px 14px -6px rgba(60,40,20,.10)` | White cards on oat |
| e2 | `0 10px 30px -8px rgba(43,36,32,.38), 0 2px 6px rgba(43,36,32,.12)` | Live pill, toast, + |
| e3 | `0 -12px 40px rgba(30,20,12,.20)` | Sheets |

**Phone layout (390 × 844):**

| Element | Size / position |
|---|---|
| Status-bar safe area | 47 |
| Bottom nav | 56 + 34 home-indicator inset = 90 |
| Center + | 58 circle, raised 8 above the nav, with a 4px ring in `--nav-bg` |
| Live pill | 60 tall, 16 side insets, bottom 104 (clear of the + ring) |
| Content fade | 92px fade to `--bg` above the nav, so scrolled rows slide under the pill gracefully |

Today fits on **one screen**: header, four cards, then the newest three rows of the timeline.

---

## 5. Components and states

Every interactive element is a real `<button>`/`<input>` with a hit area of **≥44 × 44**. Playwright checked every button in the mockup.

Shared states, applied to everything below:

| State | Treatment |
|---|---|
| Focus | `:focus-visible` ring = `0 0 0 3px var(--bg), 0 0 0 5px var(--accent-ink)` |
| Pressed | `scale(.97)` plus a darker fill, 120ms |
| Disabled | opacity .38, no shadow, `aria-disabled` |

| Component | Anatomy | States and rules |
|---|---|---|
| **Button: primary** | 52 tall (56 `block`), pill, accent fill, Nunito 17/800, optional 22px leading icon | default · pressed (`--accent-press`) · focus · disabled · loading (label → 3-dot, width locked). **One per view.** |
| **Button: secondary** | Surface fill plus 1px `--line` inset (on tint), or `--surface-2` fill (on surface); text `--text` | Same states. Pairs with primary, as in Thaw / Feed. |
| **Button: ghost** | No fill, `--accent-ink` text, 44–48 tall | For "See timeline", "Restore from a backup file". Pressed shows a `--accent-soft` fill. |
| **Button: destructive** | Soft (`danger-tint` + `danger-ink`) in lists. Filled (`danger-ink` + `#FFFCF7`) only as the confirm button inside a confirm sheet. | Never a native `confirm()`. Reversible deletes use Toast + Undo instead of confirmation. |
| **QuickLogCard** | Tint fill, r24, 148 tall. Label row (category icon + word + 32px action glyph), Fraunces value + unit suffix, sub-line in `--text-2`, optional goal bar (pump). The whole card is the button. | **idle** "2h 10m · ago" · **live** (sleep/nurse running: label "Asleep", live dot, action glyph swaps to *sun* = log wake-up) · **due** (e.g. feed past the usual interval: a "Due" `warn` badge with text, never color alone) · **empty** ("No feeds yet", "Tap to log") · **pressed** scale .98 · **hidden** via Customize. Tapping opens that category's sheet, growing from the card. |
| **Sheet** | `--surface`, r28 top, 40×5 grabber, header (Fraunces title + optional "Now 9:50 ▾" time chip, 44 tall), content, optional sticky footer. The scrim sits behind it. | open / closed / dragging / step N. Focus is trapped inside and returns to the trigger on close. Esc and scrim tap close it. The time chip opens a time picker, so you can log in the past without editing afterwards. |
| **Quick-log sheet** (frame 3) | 3×2 tiles (112 tall, tint fill, 44 icon disc, label, hint) + "One-tap diaper" Wet/Dirty/Both (52 tall) + "Add milk to stash" row + long-press tip | Tiles are context-aware: Sleep shows **Woke up** while asleep. Hidden trackers drop out, and the grid reflows to 2 columns when ≤4 tiles remain. |
| **Toast w/ Undo** | Pill-bg (dark in both themes), 56 tall, message + **Undo** (`pill-ink`, 44 hit), sits above the live pill | Shown 5s; the timer pauses while touched or focused. `role="status"`. Only for background or reversible actions (delete, mark used, discard). In-sheet success replaces the "Feed logged!" toast. |
| **LivePill** | 60 tall, pill-bg. Category disc (44) with live dot, title + sub ("good for 1h 48m"), Nunito 24/800 tnum timer, chevron-up | Tap reopens its sheet, which grows from the pill. Two running activities collapse into "2 running" with stacked discs; tap to choose. `aria-live="polite"`, announcing on the minute, not every second. Under 10 min left: the sub-line turns `warn-ink` and reads "use within 9 min" (text, not color alone). |
| **ListRow** | 64 min height: time column (44, tnum, AM/PM caption) · 40 category chip · title/sub · trailing amount, badge or chevron | Tap opens the detail sheet (edit, delete with undo). It's one pattern everywhere (fixes audit §2 "Edit vs row tap"). A new row flashes its category tint (see Motion). Dividers are inset past the time column. |
| **Chip / Badge** | 28 tall, pill, footnote 800. Category, warn, ok or accent-soft variants. Optional 14px icon. | Read-only badges aren't buttons. Filter chips are 36 visual with a 44 hit and show a selected state with a check icon plus a fill. |
| **SegmentedControl** | Track `--surface-2`, 44 tall, r-pill; selected segment `--surface` + e1, 800 weight | Used for oz/mL, Nap/Night, Fridge/Freezer filter, Bottle: formula/breast milk. Keyboard: arrow keys. Selection slides 200ms. |
| **NumberStepper** | Fraunces 44 value + unit; −/+ round buttons 56; quick chips (+0.5 / +1 oz or +15 / +30 mL), 44 tall | Tapping the number opens a numeric keypad sheet. There's no inline swap to a different-sized input (fixes the §3 layout jump). Holding −/+ repeats at 8/s. Bounds give a gentle shake (reduced motion: none). |
| **Toggle** | 52×32 track, 26 knob, 44 hit | Off: `--toggle-off` track + 1px `--line-strong` outline. On: accent track. Knob is white in light and `#E8DDCE` at night. Label is the whole row. |
| **EmptyState** | 64 tint disc with the category icon, Fraunces 22 title, `--text-2` body, one primary action | e.g. Memories: "Your first photo of Clara goes here", [Add a photo]. |
| **TimelineStrip** | Card with 4 lanes (sleep, feed, diaper, pump). Each lane is a 26px icon label + a 24-tall `--surface-2` track with 6px insets. Marks: sleep = blocks; feed/pump = 5px ticks or duration blocks; diaper = 12px dot (ring = wet, filled = dirty, ring+dot = both). | Shows a now-line (accent 2px) with a "Now 9:50" flag; future time is hatched; a running sleep is a striped block. Tapping a mark opens that event. `role="img"` + an `aria-label` summary, and the day's list below is the accessible equivalent. Hidden trackers drop their lane. |
| **Day pager** | Surface pill, 44 round prev/next, "Today" + date | Next is disabled on today. Swipe the strip horizontally to page days. The calendar button jumps to a date. |
| **Avatar** | 44 photo (48 hit) with a 2px bg ring + 2px accent-soft ring, or initial in Fraunces on `accent-soft` | It's the Settings entry point (`aria-label="Clara's profile and settings"`). Onboarding uses a 104 picker with a dashed accent ring, a camera icon and a 34 "+" badge. |
| **Stash "Use next" hero** | Pump tint, r24: "USE NEXT" tag, location, pouch illustration, Fraunces amount, two meta lines, Thaw (primary) / Feed (secondary) | The oldest frozen pouch FIFO-first, or a thawed pouch if one exists ("Thawed 1h ago · use within 23h"). An expired pouch shows a danger badge and only offers Discard. |
| **Expiry badge** | Chip | `ok` "4 days left" · `warn` clock + "1 day left" · `next` "Best by Mar 2" · `danger` "Expired · discard". Each badge always includes words. |

---

## 6. Iconography

- **24 × 24 grid, 1.75px stroke**, round caps and joins, no fills. Exceptions: status dots, the grip dots and the "dirty" diaper dot. The center + renders at 30px, where the stroke scales to about 2.2px for weight.
- **Sizes:** 14 (in badges), 18 (inline with text), 20–22 (card labels, chips), 24–26 (tabs, rows), 30 (+).
- **Color:** category ink inside category contexts, `--text-2` for neutral, `--accent` for the active tab, `--pill-ink` on the live pill.
- **Shapes:** each one is simple, friendly and rounded (bottle, nurse, pump, pouch, moon/sun, diaper, spark, images…). No literal anatomy and no cartoon faces.
- Every icon has a visible word next to it or an `aria-label` on its button. Icons are `aria-hidden`.
- **Delivery:** ship the icons as one inline SVG `<symbol>` sprite in `index.html`, referenced with `<use href="#i-name">`. That means no icon-font request and no external fetch.

---

## 7. Night mode

1. **Genuinely dim.**
   - Background `#14110E`. Primary text tops out at `#D9CDBC` (12:1, not 18:1), which avoids halation on OLED.
   - Nothing is pure white. The toggle knob is `#E8DDCE`.
   - Category tints become deep, low-chroma versions. Inks are lifted until they reach ≥6.5:1.
2. **Large bright fills are tamed.** The + uses `#B9714F`. Primary buttons keep `#D48660` with dark labels.
3. **No motion that draws the eye.** The live-dot pulse becomes a static dot, and toasts don't bounce.
4. **Switching.**
   - "Auto" follows the system scheme, or optionally a time window (7 pm–7 am) chosen in Settings → Appearance.
   - Tokens transition over 600ms.
   - It **never flips while a sheet is open**. The switch is deferred until the sheet closes.
5. **Shadows become hairlines**, as described in §4.
6. **Photos** in Memories get `filter: brightness(.88)` at night. The `theme-color` meta tag updates to `#14110E` so the status bar matches.

---

## 8. Motion contract

**Rule (audit §3): everything enters from and exits to whatever summoned it.**

**Tokens:**

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 120ms | Presses |
| `--dur-fast` | 200ms | Toasts, fades |
| `--dur-base` | 280ms | Tabs, steps, sheet close |
| `--dur-sheet` | 380ms | Sheet open |
| `--dur-grow` | 420ms | Growing from + |
| `--dur-theme` | 600ms | Theme change |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Entering |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Leaving |
| `--ease-spring` | `cubic-bezier(.32,1.2,.5,1)` | ≤2% overshoot, sheets and pill only |

| Moment | Origin | Motion | Reverse |
|---|---|---|---|
| **Sheet open** (from a card or row) | The trigger element | Scrim `opacity 0 → 1`, 280ms ease-out. Sheet `translateY(100%) → 0`, 380ms spring, with `transform-origin` at the trigger's x. The trigger gets a 120ms press-down first. | Sheet `→ translateY(100%)` 240ms ease-in. Scrim fades over 240ms. `display:none` on `transitionend`. Focus returns to the trigger. |
| **Drag to dismiss** | The grabber or header | Follows the finger 1:1; the scrim opacity tracks progress. | Release at >25% of height, or velocity >0.5px/ms, closes. Otherwise it springs back over 280ms. |
| **Quick-log grows from +** | The center of the + button | Sheet `clip-path: circle(29px at 50% <+ centre>) → circle(150%)`, 420ms ease-out. The + rotates 45° into × (280ms). Tiles fade and rise 8px, staggered 30ms, starting at 120ms. Scrim fades in alongside. | The circle collapses back into the ×, the × rotates back to + (240ms ease-in), and the scrim fades. |
| **Express feed (hold +)** | The + | After a 450ms hold, the pad grows radially out of the + using the same clip-path. Haptic tick where supported. | It collapses into the + on release or cancel. |
| **Tab switch** | Nav order | Incoming content `translateX(±24px) → 0` + `opacity 0 → 1`, 280ms ease-out. Today → Timeline slides left; back slides right. The outgoing tab only fades (160ms). The + isn't a tab. | Mirror. |
| **Step forward / back** (in a sheet) | Reading direction | Forward: new step from `+32px`, old step to `−32px`. Back mirrors this. 280ms ease-out. Sheet height animates over 280ms. Primary button label cross-fades. | — |
| **Toast** | The bottom stack (above the live pill) | `translateY(16px) + opacity → 0/1`, 200ms ease-out. | Fades and drops 8px over 160ms ease-in. Undo makes the restored row re-insert (next row). |
| **New row inserted** | The closed sheet's trigger moves into the list | After the sheet closes, the row height opens 0 → 64 (200ms). Then the content slides `translateY(-8px) → 0` and fades in. The background holds the category tint for 900ms, then fades out. The matching QuickLogCard value cross-fades to "just now". | Delete collapses the height over 200ms, then the Undo toast appears. |
| **Live pill appears** | The sheet that started the timer | When "Start timer" closes the sheet, the pill rises from the sheet's last position: `translateY(24px) scale(.96) → 0 / 1`, 320ms spring, landing above the nav. | Tapping the pill grows the sheet out of the pill. On finish, the pill shrinks into the new timeline row (240ms). |
| **Theme change** | — | Root tokens transition over 600ms. Deferred while a sheet is open. | — |
| **Live dot** | — | 2s ease-in-out ring pulse in light only. | Static at night and under reduced motion. |

**Reduced motion** (`prefers-reduced-motion: reduce`):
- Every transform, clip-path and stagger is replaced by an opacity cross-fade of ≤150ms.
- Sheets fade in place.
- The + doesn't rotate; the icon swaps instantly.
- The new-row highlight stays as a static tint for 900ms, so the "where did it go" cue survives without movement.
- No pulses, no bounces, no shakes.

---

## 9. Accessibility checklist (how this direction satisfies audit §5)

- Targets ≥44 × 44. Measured in the mockup with Playwright: there are no buttons smaller than 44 in any frame.
- Real `<button>`, `<label><input type=checkbox>` and `<input>` elements, with no clickable `<div>`s. The avatar, live pill and day pager are buttons with descriptive `aria-label`s.
- Status is never color-only:
  - expiry badges carry words
  - "due" uses a badge with text
  - the live state uses a dot plus the words "Asleep" / "Now"
  - diaper marks use shape
  - fridge and freezer use icons and words
- Focus: a visible 2px accent-ink ring with a 3px bg gap. Sheets trap focus and restore it on close.
- Timers use `aria-live="polite"` and announce once per minute.
- Text is ≥12px everywhere, ≥16px for inputs, and scales with `rem`.

## 10. Privacy surface (audit §6.8)

- Onboarding screen 1 (frame 8):
  - Headline: "Free. Private. Everything stays on this phone."
  - Three plain promises: no account, no ads or analytics, works offline.
  - Note: "The photo stays on this phone. On iPhone it can become Nurture's home-screen icon."
  - A "Restore from a backup file" ghost action, so import is visible on day one.
- Settings → Customize (frame 7) has a **Privacy & data** group. It contains Privacy ("On this phone only · no network") and Export a backup (last backup date and size on device).
- Self-hosted woff2. The mockup makes **0 network requests**. For production:
  - Subset Fraunces with `fontTools.varLib.instancer` to opsz + wght at SOFT=100, WONK=0 (expected ~55 KB).
  - Preload both fonts and cache them in the service worker.

## 11. What this fixes from the audit

| Audit item | What changes |
|---|---|
| §4 3-screen home | Today fits on one screen. |
| §4 crowded header | Avatar + name + one share button. Theme and units move to Settings. |
| §2/§4 duplicate entry points | One + and one card per category. |
| §3 "from thin air" motion | Every surface has a named origin (§8). |
| §2 Use-next pouch | A hero with primary Thaw / Feed. |
| §2 Edit vs row tap | One ListRow pattern. |
| §2 feed stamped "now" | Time chip in every sheet header. |
| §2 express gesture discoverability | Tip in the + sheet. |
| §5 tiny targets and missing focus | Fixed across the system. |
| §6.6 glassmorphism and decorative bows/vines | Removed: flat tinted cards and one shadow level. |
