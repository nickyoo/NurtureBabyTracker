# Nurture design system (Phase 2)

**Status:** final. This document is the production source of truth for the redesign. It works together with:

| File | What it is |
|---|---|
| `css/tokens.css` | Every color, type, spacing, radius, shadow, motion, z-index and layout token. Light on `:root`, dark under `[data-theme="dark"]`. |
| `fonts/` | 3 self-hosted woff2 files (120 KB total) plus SIL OFL licenses. |
| `docs/design/mockup.html` | The final 8 frames plus a 6-frame night set, built only from the tokens. |
| `docs/design/final/frame-*.png` | Playwright renders at 2× (780 × 1688). |
| `docs/design/tools/contrast.mjs` | Recomputes every contrast pair in §2.4 straight from `css/tokens.css`. Run `node docs/design/tools/contrast.mjs`. |
| `docs/design/tools/render.mjs` | Re-renders the frames and audits them: external requests, targets under 44 px, text under 12 px, overflow. |

**How it was made.** A three-way judge panel split its votes, so the owner chose a blend:

- **Calm Oat is the base.** It supplies the token architecture (tint / ink / mid per category, a tokens-only dark theme, the two-layer focus ring), flat tinted since-last cards in light mode, one clay accent used only for actions, the Timeline summary tiles and 24h strip, the Stash "Use next" hero, one-tap Wet / Dirty / Both and the dark live pill.
- **From Night First:** the night theme rules, since-last numerals in a tabular sans at 42 px with half-size units, context-aware quick-log tiles and a small font budget.
- **From Editorial Soft:** the masthead header, Memories as a keepsake book, clock time in the since-last detail lines, a Finish button inside the live pill, labelled outline header actions, an in-app Reduce motion setting and explicit ARIA contracts.

§15 lists every judge finding and how it was resolved.

---

## 1. Principles

1. **One glance, one tap.** Today answers four questions: when she last ate, whether she is asleep, when she was last changed and when you last pumped. It uses four cards, and each card is also the button that logs that thing. A tired parent should read the answer in one second and log it in one tap, at most two.
2. **Calm, never anxious.** The palette is soft neutrals with one warm accent and no red for "late". Copy states facts ("Fed 2h 10m ago"), never alarms. Nothing flashes or pulses at night.
3. **One-handed.** Every primary action sits in the bottom half of the screen: the +, the live pill and its Finish button, the sheet buttons and the lower half of each card. Header actions are secondary and always labelled.
4. **Color is a hint, never the message.** Every category color always comes with an icon and a word. On the timeline every mark also has its own shape. Night sleep and naps differ by fill (solid vs outline), not by lightness.
5. **Genuinely dim at night.** Night uses warm charcoal, and nothing on screen is brighter than the text (`#DCD0BF`). Cards turn neutral, the + is the only lit accent fill, and font weights drop by 30.
6. **Nothing comes from nowhere.** Every surface enters from whatever summoned it and exits back into it (§7).
7. **Private by construction.** The app makes zero third-party requests: fonts and icons are bundled, the promise is on screen 1 and the Privacy row shows live proof.

---

## 2. Color

### 2.1 Architecture

- Tokens live on `:root` (light). Dark mode redefines **tokens only**, under `:root[data-theme="dark"], [data-theme="dark"]`. **No component may contain a theme selector.** Wherever night needs a component to look different (neutral cards, a dimmer +, soft primary buttons), the difference is a *semantic token* that has a different value in each theme, such as `--feed-card`, `--fab-bg`, `--primary-bg` or `--toggle-on`.
- The app sets `<html data-theme>` from a tiny blocking script in `<head>` (`js/theme-boot.js`, an external file because the CSP forbids inline scripts) before first paint. The choices are Auto (system scheme, or the clock window 7 PM to 7 AM if the user picks it in Settings → Appearance), Light or Dark. **Never flip while a sheet is open.** Queue the change and apply it on sheet close.
- `data-theme` may also scope a subtree (the mockup uses it per frame). Custom properties that reference other tokens (`--feed-card: var(--feed-tint)`, `--focus-ring`) are therefore declared in **both** theme blocks, so they resolve inside a scoped subtree.
- Per-component category scoping uses the helper classes in tokens.css: `.cat-feed`, `.cat-sleep`, `.cat-diaper`, `.cat-pump`, `.cat-mem`, `.cat-accent` and `.cat-neutral`. Each sets `--c-tint`, `--c-ink`, `--c-mid`, `--c-card` and `--c-well`, and components read only those `--c-*` variables.

### 2.2 Neutrals, accent and status

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#F6F1E8` oat | `#191512` warm charcoal | App background |
| `--surface` | `#FFFCF7` linen | `#221D19` | Cards, lists, nav |
| `--surface-2` | `#EFE8DC` sand | `#2C2520` | Fields, chips, tracks, secondary rows |
| `--band` | `#E6DCCC` | `#120F0D` | Night band (7 PM to 7 AM) behind timeline lanes |
| `--sheet-bg` | `#FFFCF7` | `#26201C` | Sheets (one step above the scrim at night) |
| `--nav-bg` | `#FFFCF7` | `#1D1915` | Bottom nav |
| `--line` | `#E9DFD0` | `#2F2823` | Decorative hairline only. Never the only boundary of a control. |
| `--line-strong` | `#958675` | `#7E7163` | Control outlines (off toggle, input border, outline button) ≥ 3:1 |
| `--knob` | `#FFFCF7` | `#D3C7B6` | Toggle knob (never pure white) |
| `--text` | `#2B2420` | `#DCD0BF` | Primary text. **At night this is the luminance ceiling (L = 0.641).** |
| `--text-2` | `#665A4E` | `#A89A89` | Secondary text, units |
| `--text-3` | `#766A5D` | `#988B7C` | Tertiary text (AM/PM, axis, inactive tabs). Still ≥ 4.5:1 on bg, surface and sheet. |
| `--scrim` | `rgba(38,29,22,.46)` | `rgba(0,0,0,.60)` | Sheet backdrop at full open |
| `--accent` | `#A6532F` clay | `#D48660` | Active tab icon, now-line, selected states |
| `--accent-press` | `#8F4627` | `#C27A56` | Pressed accent |
| `--accent-ink` | `#97492A` | `#E09A76` | Accent-colored **text**: links, back, wordmark, focus ring |
| `--accent-soft` | `#F5E3D6` | `#3A2A20` | Accent tint: "Use next" tag, photo picker, privacy chip |
| `--on-accent` | `#FFFCF7` | `#1C130E` | Label on an accent fill |
| `--fab-bg` / `--fab-press` / `--on-fab` | `#A6532F` / `#8F4627` / `#FFFCF7` | `#B9714F` / `#A8653F` / `#1C130E` | The center +. At night it is dimmer than `--accent` and has no glow. |
| `--primary-bg` / `--primary-press` / `--on-primary` | `#A6532F` / `#8F4627` / `#FFFCF7` | `#3A2A20` / `#46332A` / `#E09A76` | Primary button. **At night it is soft ember with ember text**, so the + is the only lit accent fill. |
| `--toggle-on` | `#A6532F` | `#9A5E40` | Toggle-on track. Dimmed at night so a settings list isn't a wall of lit accents. |
| `--pill-bg` / `--pill-text` / `--pill-text-2` | `#2B2420` / `#F6EFE4` / `#C9BBAB` | `#2E2722` / `#DCD0BF` / `#A89A89` | Live pill and toast: **dark in both themes** so "running" reads the same at any hour |
| `--pill-well` / `--pill-ring` | `#40352D` / `rgba(246,239,228,.10)` | `#3B322B` / `rgba(220,208,191,.10)` | Icon well, 1px pill ring, progress-ring track |
| `--pill-btn-bg` / `--pill-btn-text` | `#F6EFE4` / `#2B2420` | `#463B33` / `#DCD0BF` | Finish button inside the pill |
| `--pill-feed` / `--pill-sleep` / `--pill-pump` / `--pill-warn` | `#E8AE6A` / `#B9AEE2` / `#E39DAF` / `#F0C47A` | `#D9A45E` / `#ABA1D8` / `#D896A8` / `#E2B565` | Category marks, live dot, progress ring and Undo on the pill surface |
| `--warn-tint` / `--warn-ink` | `#FBE9C8` / `#7F5310` | `#352A16` / `#E2B565` | "Use soon", "Due" (always with a clock icon and words) |
| `--ok-tint` / `--ok-ink` | `#E3ECDD` / `#46663F` | `#1F2A1F` / `#98BB91` | "Fresh", "0 network requests" |
| `--danger-tint` / `--danger-ink` / `--on-danger` | `#F8E0DA` / `#A3392A` / `#FFFCF7` | `#3A201B` / `#E58F80` / `#1C130E` | Expired milk, destructive confirm. **Never used for "late" or "overdue".** |

### 2.3 Category colors

Each category has three tones plus two semantic roles:

- **tint** fills chips, tiles, stat tiles and the running-card fill.
- **ink** is used for text and icons on tint or surface, and is ≥ 4.5:1 everywhere.
- **mid** is for graphics (timeline marks, goal bar, stash split) and is ≥ 3:1 on surface, surface-2 and band.
- **card** is the since-last card and quick-log tile fill: `= tint` in light, `= --surface` (neutral) in dark.
- **well** is the icon well on a card: a pale `--well-on-tint` in light, `= tint` in dark.

| Category | Light tint / ink / mid | Dark tint / ink / mid | Icon glyph (24px grid, 1.75 stroke) | Timeline shape | Word |
|---|---|---|---|---|---|
| **Feed** (bottle formula, bottle breast milk, breastfeeding) | `#FBEBD0` / `#8A5A12` / `#9C6A1B` amber | `#33271A` / `#D9A45E` / `#B8884A` | `bottle`: a baby bottle with nipple, collar ring and two measuring ticks. `breast`: a soft cup arc with a small centered circle. | **Tick** 4×16 (bottle: filled; breastfeeding: hollow 5×14) | "Fed", "Bottle", "Breastfeed" |
| **Sleep** | `#ECE7F5` / `#5F538C` / `#7C6DB0` dusk lavender | `#272336` / `#ABA1D8` / `#8A7FBE` | `moon`: a crescent (asleep). `sun`: a circle with 8 short rays (wake up / end nap). | **Block**: night sleep = **solid** fill; nap = **2px outline, no fill** | "Asleep", "Awake", "Nap", "Night" |
| **Diaper** | `#E3ECDD` / `#46663F` / `#5E8158` sage | `#202A1F` / `#95B58E` / `#779770` | `diaper`: a cup-shaped diaper with a leg-curve and side tabs. Type glyphs: `wet` = ring, `dirty` = filled dot, `both` = ring + center dot. | **Ring / dot / ring+dot** | "Diaper", "Wet", "Dirty", "Both" |
| **Pump + Stash** | `#F7E2E6` / `#9A4258` / `#AD5169` clay rose | `#36222A` / `#D896A8` / `#B36F82` | `pump`: a funnel flange over a collection bottle. `pouch`: a milk storage pouch with a seal line. `fridge` / `snow` for location. | **Diamond** 9×9 | "Pumped", "Pump", "Stash", "Fridge", "Freezer" |
| **Memories / milestones** | `#E1ECEF` / `#2F6378` / `#4A7F96` slate-sky | `#1E2B30` / `#8DB6C6` / `#6A97A9` | `spark`: a 4-point star with a small companion star. `camera` for adding photos. `book` is the tab icon. | n/a (not on the strip) | "Memory", "First", the milestone's name |

Rules:

- The clay **accent** (hue ≈ 18°) is reserved for actions and "now". Feed **amber** (≈ 38°) never fills a button, so the two never share a role. Memories moved from honey to slate-sky so it no longer sits next to feed amber.
- Fridge and freezer are both pump-mid. They are told apart by **pattern** (fridge solid, freezer striped), by icon (fridge vs snowflake) and by word.
- Use a category hue only where that category is the subject. Neutral chrome stays neutral.
- Night sleep and naps are distinguished by **solid vs outline** (WCAG 1.4.1). Both marks use `--sleep-mid`, which is ≥ 3:1 on the track and on the night band in both themes (WCAG 1.4.11). The night band itself is a context cue explained by the strip header ("shaded = 7 PM – 7 AM"). It never carries meaning alone.

### 2.4 Verified contrast (computed, WCAG 2.1 relative luminance)

The table below was generated by `node docs/design/tools/contrast.mjs`, which parses `css/tokens.css` directly, resolves `var()` references and blends translucent tokens over their real base (for example, `--well-on-tint` over the card tint). **107 pairs × 2 themes, 0 failures.** Targets: 4.5:1 for text, 3:1 for icons, graphics and UI boundaries. Re-run the script after any token change and paste the new output here.

| Pair (fg on bg) | Used for | Target | Light | Dark |
|---|---|---|---|---|
| `text` on `bg` | Primary text, titles | 4.5:1 | #2B2420 / #F6F1E8 **13.57** | #DCD0BF / #191512 **11.94** |
| `text` on `surface` | Card + row text | 4.5:1 | #2B2420 / #FFFCF7 **14.91** | #DCD0BF / #221D19 **10.99** |
| `text` on `surface-2` | Field values, secondary button label | 4.5:1 | #2B2420 / #EFE8DC **12.53** | #DCD0BF / #2C2520 **9.92** |
| `text` on `sheet-bg` | Sheet text | 4.5:1 | #2B2420 / #FFFCF7 **14.91** | #DCD0BF / #26201C **10.58** |
| `text` on `band` | Strip labels over the night band | 4.5:1 | #2B2420 / #E6DCCC **11.25** | #DCD0BF / #120F0D **12.56** |
| `text-2` on `bg` | Secondary text on page | 4.5:1 | #665A4E / #F6F1E8 **5.95** | #A89A89 / #191512 **6.61** |
| `text-2` on `surface` | Row meta | 4.5:1 | #665A4E / #FFFCF7 **6.54** | #A89A89 / #221D19 **6.08** |
| `text-2` on `surface-2` | Field labels, time chip | 4.5:1 | #665A4E / #EFE8DC **5.50** | #A89A89 / #2C2520 **5.49** |
| `text-2` on `sheet-bg` | Sheet hints | 4.5:1 | #665A4E / #FFFCF7 **6.54** | #A89A89 / #26201C **5.86** |
| `text-3` on `bg` | Tertiary: eyebrow, AM/PM, axis | 4.5:1 | #766A5D / #F6F1E8 **4.68** | #988B7C / #191512 **5.46** |
| `text-3` on `surface` | AM/PM in rows, axis labels | 4.5:1 | #766A5D / #FFFCF7 **5.14** | #988B7C / #221D19 **5.02** |
| `text-3` on `nav-bg` | Inactive tab label | 4.5:1 | #766A5D / #FFFCF7 **5.14** | #988B7C / #1D1915 **5.26** |
| `text-3` on `sheet-bg` | Sheet tertiary | 4.5:1 | #766A5D / #FFFCF7 **5.14** | #988B7C / #26201C **4.84** |
| `accent-ink` on `bg` | Links, wordmark, eyebrow accent | 4.5:1 | #97492A / #F6F1E8 **5.65** | #E09A76 / #191512 **7.82** |
| `accent-ink` on `surface` | Ghost buttons on cards | 4.5:1 | #97492A / #FFFCF7 **6.21** | #E09A76 / #221D19 **7.20** |
| `accent-ink` on `accent-soft` | Use-next tag, photo-picker label | 4.5:1 | #97492A / #F5E3D6 **5.10** | #E09A76 / #3A2A20 **5.91** |
| `accent-ink` on `sheet-bg` | Links in sheets | 4.5:1 | #97492A / #FFFCF7 **6.21** | #E09A76 / #26201C **6.93** |
| `on-primary` on `primary-bg` | Primary button label | 4.5:1 | #FFFCF7 / #A6532F **5.26** | #E09A76 / #3A2A20 **5.91** |
| `on-primary` on `primary-press` | Primary pressed label | 4.5:1 | #FFFCF7 / #8F4627 **6.68** | #E09A76 / #46332A **5.12** |
| `on-fab` on `fab-bg` | + glyph (2.25px stroke, non-text) | 3:1 | #FFFCF7 / #A6532F **5.26** | #1C130E / #B9714F **4.82** |
| `fab-bg` on `nav-bg` | + disc vs nav (UI) | 3:1 | #A6532F / #FFFCF7 **5.26** | #B9714F / #1D1915 **4.61** |
| `accent` on `nav-bg` | Active tab icon (UI) | 3:1 | #A6532F / #FFFCF7 **5.26** | #D48660 / #1D1915 **6.14** |
| `accent` on `surface` | Toggle-on track, now-line (UI) | 3:1 | #A6532F / #FFFCF7 **5.26** | #D48660 / #221D19 **5.87** |
| `accent` on `surface-2` | Now-line over strip track (UI) | 3:1 | #A6532F / #EFE8DC **4.42** | #D48660 / #2C2520 **5.30** |
| `accent` on `band` | Now-line over night band (UI) | 3:1 | #A6532F / #E6DCCC **3.97** | #D48660 / #120F0D **6.71** |
| `line-strong` on `surface` | Off toggle: outline + knob on a --surface track; input border (UI) | 3:1 | #958675 / #FFFCF7 **3.45** | #7E7163 / #221D19 **3.52** |
| `toggle-on` on `surface` | Toggle-on track vs row (UI) | 3:1 | #A6532F / #FFFCF7 **5.26** | #9A5E40 / #221D19 **3.22** |
| `toggle-on` on `sheet-bg` | Toggle-on track in sheets (UI) | 3:1 | #A6532F / #FFFCF7 **5.26** | #9A5E40 / #26201C **3.10** |
| `knob` on `toggle-on` | Knob vs on-track (UI) | 3:1 | #FFFCF7 / #A6532F **5.26** | #D3C7B6 / #9A5E40 **3.12** |
| `text` on `accent-soft` | Text on accent tint (picker, privacy chip) | 4.5:1 | #2B2420 / #F5E3D6 **12.24** | #DCD0BF / #3A2A20 **9.02** |
| `line-strong` on `sheet-bg` | Input border in sheets (UI) | 3:1 | #958675 / #FFFCF7 **3.45** | #7E7163 / #26201C **3.39** |
| `pill-text` on `pill-bg` | Live pill title + timer | 4.5:1 | #F6EFE4 / #2B2420 **13.36** | #DCD0BF / #2E2722 **9.67** |
| `pill-text-2` on `pill-bg` | Live pill sub-line | 4.5:1 | #C9BBAB / #2B2420 **8.13** | #A89A89 / #2E2722 **5.35** |
| `pill-btn-text` on `pill-btn-bg` | Finish button label | 4.5:1 | #2B2420 / #F6EFE4 **13.36** | #DCD0BF / #463B33 **7.15** |
| `pill-btn-bg` on `pill-bg` | Finish button edge vs pill (UI) | 3:1 | #F6EFE4 / #2B2420 **13.36** | n/a (dark: ring + luminance step) |
| `pill-feed` on `pill-bg` | Pill icon / ring / Undo (feed) | 4.5:1 | #E8AE6A / #2B2420 **7.77** | #D9A45E / #2E2722 **6.59** |
| `pill-feed` on `pill-well` | Pill icon in its well | 3:1 | #E8AE6A / #40352D **6.06** | #D9A45E / #3B322B **5.62** |
| `pill-sleep` on `pill-bg` | Pill icon (sleep) | 3:1 | #B9AEE2 / #2B2420 **7.42** | #ABA1D8 / #2E2722 **6.17** |
| `pill-pump` on `pill-bg` | Pill icon (pump) | 3:1 | #E39DAF / #2B2420 **7.06** | #D896A8 / #2E2722 **6.19** |
| `pill-warn` on `pill-bg` | Pill warning sub-line | 4.5:1 | #F0C47A / #2B2420 **9.36** | #E2B565 / #2E2722 **7.72** |
| `pill-bg` on `bg` | Pill vs page (UI boundary) | 3:1 | #2B2420 / #F6F1E8 **13.57** | n/a (dark: ring + luminance step) |
| `warn-ink` on `warn-tint` | Expiry-soon / due badge | 4.5:1 | #7F5310 / #FBE9C8 **5.59** | #E2B565 / #352A16 **7.38** |
| `ok-ink` on `ok-tint` | Fresh badge | 4.5:1 | #46663F / #E3ECDD **5.35** | #98BB91 / #1F2A1F **6.99** |
| `danger-ink` on `danger-tint` | Expired badge, soft destructive | 4.5:1 | #A3392A / #F8E0DA **5.25** | #E58F80 / #3A201B **6.11** |
| `danger-ink` on `surface` | Destructive text on cards | 4.5:1 | #A3392A / #FFFCF7 **6.46** | #E58F80 / #221D19 **6.82** |
| `on-danger` on `danger-ink` | Filled destructive (confirm sheet) | 4.5:1 | #FFFCF7 / #A3392A **6.46** | #1C130E / #E58F80 **7.46** |
| `feed-ink` on `feed-card` | feed: label word on since-last card | 4.5:1 | #8A5A12 / #FBEBD0 **5.04** | #D9A45E / #221D19 **7.49** |
| `text` on `feed-card` | feed: numeral on card | 4.5:1 | #2B2420 / #FBEBD0 **13.01** | #DCD0BF / #221D19 **10.99** |
| `text-2` on `feed-card` | feed: detail line + unit on card | 4.5:1 | #665A4E / #FBEBD0 **5.70** | #A89A89 / #221D19 **6.08** |
| `feed-ink` on `feed-well` | feed: icon in card well (UI) | 3:1 | #8A5A12 / #FEF9EF **5.62** | #D9A45E / #33271A **6.52** |
| `feed-ink` on `feed-tint` | feed: icon/label on tint (chips, tiles, wells in rows) | 4.5:1 | #8A5A12 / #FBEBD0 **5.04** | #D9A45E / #33271A **6.52** |
| `text` on `feed-tint` | feed: text on tint (live card, tiles, stat tiles) | 4.5:1 | #2B2420 / #FBEBD0 **13.01** | #DCD0BF / #33271A **9.56** |
| `text-2` on `feed-tint` | feed: secondary text on tint | 4.5:1 | #665A4E / #FBEBD0 **5.70** | #A89A89 / #33271A **5.29** |
| `feed-ink` on `surface` | feed: icon/word on neutral surface | 4.5:1 | #8A5A12 / #FFFCF7 **5.78** | #D9A45E / #221D19 **7.49** |
| `feed-ink` on `sheet-bg` | feed: icon/word in sheet | 4.5:1 | #8A5A12 / #FFFCF7 **5.78** | #D9A45E / #26201C **7.22** |
| `feed-mid` on `surface-2` | feed: strip mark on lane track (UI) | 3:1 | #9C6A1B / #EFE8DC **3.84** | #B8884A / #2C2520 **4.78** |
| `feed-mid` on `band` | feed: strip mark over night band (UI) | 3:1 | #9C6A1B / #E6DCCC **3.45** | #B8884A / #120F0D **6.05** |
| `feed-mid` on `surface` | feed: graphic on card, goal bar (UI) | 3:1 | #9C6A1B / #FFFCF7 **4.57** | #B8884A / #221D19 **5.29** |
| `sleep-ink` on `sleep-card` | sleep: label word on since-last card | 4.5:1 | #5F538C / #ECE7F5 **5.58** | #ABA1D8 / #221D19 **7.01** |
| `text` on `sleep-card` | sleep: numeral on card | 4.5:1 | #2B2420 / #ECE7F5 **12.58** | #DCD0BF / #221D19 **10.99** |
| `text-2` on `sleep-card` | sleep: detail line + unit on card | 4.5:1 | #665A4E / #ECE7F5 **5.52** | #A89A89 / #221D19 **6.08** |
| `sleep-ink` on `sleep-well` | sleep: icon in card well (UI) | 3:1 | #5F538C / #FBF8F7 **6.40** | #ABA1D8 / #272336 **6.39** |
| `sleep-ink` on `sleep-tint` | sleep: icon/label on tint (chips, tiles, wells in rows) | 4.5:1 | #5F538C / #ECE7F5 **5.58** | #ABA1D8 / #272336 **6.39** |
| `text` on `sleep-tint` | sleep: text on tint (live card, tiles, stat tiles) | 4.5:1 | #2B2420 / #ECE7F5 **12.58** | #DCD0BF / #272336 **10.01** |
| `text-2` on `sleep-tint` | sleep: secondary text on tint | 4.5:1 | #665A4E / #ECE7F5 **5.52** | #A89A89 / #272336 **5.54** |
| `sleep-ink` on `surface` | sleep: icon/word on neutral surface | 4.5:1 | #5F538C / #FFFCF7 **6.61** | #ABA1D8 / #221D19 **7.01** |
| `sleep-ink` on `sheet-bg` | sleep: icon/word in sheet | 4.5:1 | #5F538C / #FFFCF7 **6.61** | #ABA1D8 / #26201C **6.76** |
| `sleep-mid` on `surface-2` | sleep: strip mark on lane track (UI) | 3:1 | #7C6DB0 / #EFE8DC **3.69** | #8A7FBE / #2C2520 **4.21** |
| `sleep-mid` on `band` | sleep: strip mark over night band (UI) | 3:1 | #7C6DB0 / #E6DCCC **3.31** | #8A7FBE / #120F0D **5.33** |
| `sleep-mid` on `surface` | sleep: graphic on card, goal bar (UI) | 3:1 | #7C6DB0 / #FFFCF7 **4.39** | #8A7FBE / #221D19 **4.66** |
| `diaper-ink` on `diaper-card` | diaper: label word on since-last card | 4.5:1 | #46663F / #E3ECDD **5.35** | #95B58E / #221D19 **7.38** |
| `text` on `diaper-card` | diaper: numeral on card | 4.5:1 | #2B2420 / #E3ECDD **12.58** | #DCD0BF / #221D19 **10.99** |
| `text-2` on `diaper-card` | diaper: detail line + unit on card | 4.5:1 | #665A4E / #E3ECDD **5.52** | #A89A89 / #221D19 **6.08** |
| `diaper-ink` on `diaper-well` | diaper: icon in card well (UI) | 3:1 | #46663F / #F9F9F2 **6.14** | #95B58E / #202A1F **6.57** |
| `diaper-ink` on `diaper-tint` | diaper: icon/label on tint (chips, tiles, wells in rows) | 4.5:1 | #46663F / #E3ECDD **5.35** | #95B58E / #202A1F **6.57** |
| `text` on `diaper-tint` | diaper: text on tint (live card, tiles, stat tiles) | 4.5:1 | #2B2420 / #E3ECDD **12.58** | #DCD0BF / #202A1F **9.78** |
| `text-2` on `diaper-tint` | diaper: secondary text on tint | 4.5:1 | #665A4E / #E3ECDD **5.52** | #A89A89 / #202A1F **5.42** |
| `diaper-ink` on `surface` | diaper: icon/word on neutral surface | 4.5:1 | #46663F / #FFFCF7 **6.35** | #95B58E / #221D19 **7.38** |
| `diaper-ink` on `sheet-bg` | diaper: icon/word in sheet | 4.5:1 | #46663F / #FFFCF7 **6.35** | #95B58E / #26201C **7.11** |
| `diaper-mid` on `surface-2` | diaper: strip mark on lane track (UI) | 3:1 | #5E8158 / #EFE8DC **3.63** | #779770 / #2C2520 **4.63** |
| `diaper-mid` on `band` | diaper: strip mark over night band (UI) | 3:1 | #5E8158 / #E6DCCC **3.25** | #779770 / #120F0D **5.86** |
| `diaper-mid` on `surface` | diaper: graphic on card, goal bar (UI) | 3:1 | #5E8158 / #FFFCF7 **4.31** | #779770 / #221D19 **5.12** |
| `pump-ink` on `pump-card` | pump: label word on since-last card | 4.5:1 | #9A4258 / #F7E2E6 **5.15** | #D896A8 / #221D19 **7.03** |
| `text` on `pump-card` | pump: numeral on card | 4.5:1 | #2B2420 / #F7E2E6 **12.34** | #DCD0BF / #221D19 **10.99** |
| `text-2` on `pump-card` | pump: detail line + unit on card | 4.5:1 | #665A4E / #F7E2E6 **5.41** | #A89A89 / #221D19 **6.08** |
| `pump-ink` on `pump-well` | pump: icon in card well (UI) | 3:1 | #9A4258 / #FDF7F4 **6.00** | #D896A8 / #36222A **6.23** |
| `pump-ink` on `pump-tint` | pump: icon/label on tint (chips, tiles, wells in rows) | 4.5:1 | #9A4258 / #F7E2E6 **5.15** | #D896A8 / #36222A **6.23** |
| `text` on `pump-tint` | pump: text on tint (live card, tiles, stat tiles) | 4.5:1 | #2B2420 / #F7E2E6 **12.34** | #DCD0BF / #36222A **9.74** |
| `text-2` on `pump-tint` | pump: secondary text on tint | 4.5:1 | #665A4E / #F7E2E6 **5.41** | #A89A89 / #36222A **5.39** |
| `pump-ink` on `surface` | pump: icon/word on neutral surface | 4.5:1 | #9A4258 / #FFFCF7 **6.23** | #D896A8 / #221D19 **7.03** |
| `pump-ink` on `sheet-bg` | pump: icon/word in sheet | 4.5:1 | #9A4258 / #FFFCF7 **6.23** | #D896A8 / #26201C **6.78** |
| `pump-mid` on `surface-2` | pump: strip mark on lane track (UI) | 3:1 | #AD5169 / #EFE8DC **4.15** | #B36F82 / #2C2520 **3.96** |
| `pump-mid` on `band` | pump: strip mark over night band (UI) | 3:1 | #AD5169 / #E6DCCC **3.72** | #B36F82 / #120F0D **5.01** |
| `pump-mid` on `surface` | pump: graphic on card, goal bar (UI) | 3:1 | #AD5169 / #FFFCF7 **4.94** | #B36F82 / #221D19 **4.38** |
| `mem-ink` on `mem-card` | mem: label word on since-last card | 4.5:1 | #2F6378 / #E1ECEF **5.49** | #8DB6C6 / #221D19 **7.66** |
| `text` on `mem-card` | mem: numeral on card | 4.5:1 | #2B2420 / #E1ECEF **12.68** | #DCD0BF / #221D19 **10.99** |
| `text-2` on `mem-card` | mem: detail line + unit on card | 4.5:1 | #665A4E / #E1ECEF **5.56** | #A89A89 / #221D19 **6.08** |
| `mem-ink` on `mem-well` | mem: icon in card well (UI) | 3:1 | #2F6378 / #F9F9F5 **6.26** | #8DB6C6 / #1E2B30 **6.68** |
| `mem-ink` on `mem-tint` | mem: icon/label on tint (chips, tiles, wells in rows) | 4.5:1 | #2F6378 / #E1ECEF **5.49** | #8DB6C6 / #1E2B30 **6.68** |
| `text` on `mem-tint` | mem: text on tint (live card, tiles, stat tiles) | 4.5:1 | #2B2420 / #E1ECEF **12.68** | #DCD0BF / #1E2B30 **9.57** |
| `text-2` on `mem-tint` | mem: secondary text on tint | 4.5:1 | #665A4E / #E1ECEF **5.56** | #A89A89 / #1E2B30 **5.30** |
| `mem-ink` on `surface` | mem: icon/word on neutral surface | 4.5:1 | #2F6378 / #FFFCF7 **6.46** | #8DB6C6 / #221D19 **7.66** |
| `mem-ink` on `sheet-bg` | mem: icon/word in sheet | 4.5:1 | #2F6378 / #FFFCF7 **6.46** | #8DB6C6 / #26201C **7.38** |
| `mem-mid` on `surface-2` | mem: strip mark on lane track (UI) | 3:1 | #4A7F96 / #EFE8DC **3.62** | #6A97A9 / #2C2520 **4.75** |
| `mem-mid` on `band` | mem: strip mark over night band (UI) | 3:1 | #4A7F96 / #E6DCCC **3.25** | #6A97A9 / #120F0D **6.01** |
| `mem-mid` on `surface` | mem: graphic on card, goal bar (UI) | 3:1 | #4A7F96 / #FFFCF7 **4.30** | #6A97A9 / #221D19 **5.26** |
| `pump-mid` on `track-on-card` | pump: goal-bar fill vs its track (UI) | 3:1 | #AD5169 / #E3CFD2 **3.39** | #B36F82 / #352F2A **3.47** |

Supplemental values (computed with the same formula):

- **Dark pill vs dark bg** is `#2E2722` on `#191512` = 1.24:1, and the dark Finish button vs the pill is 1.35:1. Neither boundary is needed to *identify* the control (WCAG 1.4.11 exempts boundaries when the content identifies it). The pill is identified by its icon, live dot, progress ring (6.59:1), text (9.67:1) and a 1px `--pill-ring` inset. The Finish button is identified by its label (7.15:1). In light, both boundaries are 13.36:1.
- **Night luminance ceiling.** `--text` is L = 0.641. Every other night token is dimmer: `--knob` 0.581, the brightest category ink (mem `#8DB6C6`) 0.432, `--accent-ink` 0.403, `--accent` 0.319, `--fab-bg` 0.227. Category inks sit at 7.4–8.3:1 on `--bg`, which is enough for icons and labels and low enough not to flare.
- **Focus ring.** `--accent-ink` is drawn over a 3px `--bg` gap, so it is measured against `--bg`: 5.65:1 light and 7.82:1 dark, on any tint.
- **Selected day (Timeline).** The 2px `--text` ring on `--bg` is 13.57 / 11.94:1, and today's dot uses `--accent`.
- `--line` (≈ 1.3:1) is decorative only. Anything that must be seen as a boundary uses `--line-strong`, a filled shape, or a text label.

---

## 3. Typography

### 3.1 Families and files (3 woff2, 120 KB, zero third-party requests)

| Family | File | Size | Axes | Role |
|---|---|---|---|---|
| **Nunito** (variable, OFL) | `fonts/nunito-latin-wght.woff2` | 39.1 KB | wght 200–1000 | Everything you tap and **every number**. Its digits are fixed-width by default: all ten are 600 units and `:` is 211 (checked with fontTools), so timers don't jitter. |
| **Fraunces** roman (variable, OFL) | `fonts/fraunces-soft-latin-wght-opsz.woff2` | 57.2 KB | opsz 9–144, wght 400–700 (SOFT pinned 100, WONK pinned 0) | Baby name, screen titles, sheet titles, section heads and the onboarding headline: **words only**. |
| **Fraunces** italic (static, OFL) | `fonts/fraunces-soft-latin-italic-400.woff2` | 23.3 KB | static: SOFT 100, WONK 0, opsz 24, wght 400 | Only the age line ("6 weeks"), memory captions, suggested milestones and the onboarding accent line |

- **Provenance.** These are the `@fontsource-variable/nunito@5.3.0` and `@fontsource-variable/fraunces@5.3.0` latin files, fetched from the npm registry tarballs because the jsDelivr CDN refused the connection from the build sandbox (HTTP 403 on CONNECT). They are byte-identical to what jsDelivr serves. Fraunces was instanced with `fontTools.varLib.instancer` 4.67, which dropped it from 121 KB to 57 KB for roman and from 150 KB to 23 KB for italic. Each file begins with the `wOF2` magic bytes. OFL texts are at `fonts/OFL-Nunito.txt` and `fonts/OFL-Fraunces.txt`.
- **Loading.** `@font-face` in tokens.css uses `font-display: swap`. Preload the Nunito file in `<head>` (`<link rel="preload" as="font" type="font/woff2" crossorigin>`), and have the service worker precache all three. Fallbacks are `ui-rounded, system-ui` and `ui-serif, Georgia`.
- Because SOFT and WONK are baked into the file, **no `font-variation-settings` are needed**. Use `font-optical-sizing: auto` (the default) so opsz follows the font size.

### 3.2 The numeral rule

- **Every number a parent reads (times, durations, amounts, counts, timers) is set in Nunito** with `font-variant-numeric: var(--numeric)` (tabular-nums lining-nums). Nunito is natively tabular, and the property keeps system fallbacks tabular too.
- **Fraunces never sets a measured value.** It has proportional digits and no `tnum` feature (verified with fontTools: `GSUB` has only `liga` and `rvrn`). Titles that happen to contain a digit ("Week 6") are static words and are fine.
- Since-last values use the **numeral** style: 42 px Nunito 700 with half-size units (`h`, `m`, `oz`) at 21 px in `--text-2`. Format: `2h 10m` (the hour is never zero-padded; minutes are always two digits once you're past an hour, so `3h 00m`). Under an hour, use `55m`. Under a minute, show the words "Just now".

### 3.3 Type scale

Sizes are in rem in code (1rem = 16px), so iOS text size scales the UI. Cards grow taller rather than truncating. **12 px is the floor everywhere** (verified: 0 text nodes under 12 px in the mockup).

| Token | Family | Size / line-height | Weight (light → dark) | Use |
|---|---|---|---|---|
| `--fs-display` | Nunito tnum | 56 / 1.0, −0.02em | 700 → 670 | Stash total, running timer inside a sheet |
| `--fs-amount` | Nunito tnum | 52 / 1.0 | 700 → 670 | "Use next" amount, NumberStepper value |
| `--fs-numeral` | Nunito tnum | 42 / 44px, −0.02em | 700 → 670 | Since-last values |
| `--fs-unit` | Nunito | 21 | 700 → 670, `--text-2` | Units after a numeral |
| `--fs-timer` | Nunito tnum | 24 / 1.2 | 800 → 770 | Live pill timer |
| `--fs-hero` | Fraunces | 40 / 1.08, −0.015em | 560 → 530 (italic line: 400) | Onboarding headline |
| `--fs-name` | Fraunces | 34 / 1.05 | 560 → 530 | Baby name in the masthead |
| `--fs-title-l` | Fraunces | 32 / 1.08 | 560 → 530 | Screen titles (Timeline day, Memories) |
| `--fs-title-1` | Fraunces | 26 / 1.1 | 560 → 530 | Sheet titles |
| `--fs-title-2` | Fraunces | 22 / 1.1 | 560 → 530 | Section heads ("Today", "Fridge", "Firsts") |
| `--fs-age` | Fraunces italic | 18 | 400 (static) | Age line, `--text-2` |
| `--fs-title-3` | Nunito | 20 / 1.3 | 800 → 770 | Large row amounts (rare) |
| `--fs-stat` | Nunito tnum | 18 / 1.15 | 800 → 770 | Timeline summary values |
| `--fs-headline` | Nunito | 17 / 1.3 | 800 → 770 | Buttons, tile labels, nav-bar title, row amounts |
| `--fs-body` | Nunito | 16 / 1.35 | 800 titles · 600 text → −30 | Row titles, inputs (never below 16, to avoid iOS zoom) |
| `--fs-callout` | Nunito | 15 / 1.35 | 600–800 → −30 | Card labels, links, intro copy |
| `--fs-subhead` | Nunito | 14 / 19px | 600 → 570 | Card detail lines, row meta |
| `--fs-footnote` | Nunito | 13 / 1.35 | 600–800 → −30 | Badges, tile hints, group labels |
| `--fs-caption` | Nunito | 12 / 1.2 | 700–800 → −30 | Tab labels, AM/PM, strip axis, eyebrows (caps +0.07em). **Minimum.** |

**Weights** come from tokens (`--fw-body` 600, `--fw-strong` 700, `--fw-heavy` 800, `--fw-numeral` 700, `--fw-title` 560). In dark mode each drops by 30 on the variable axis to offset light-on-dark halation. The static italic stays at 400.

---

## 4. Spacing, radii, elevation

**Spacing (4pt grid):** `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48 · `--s-16` 64.

- Screen gutter is `--gutter` 20, and 24 in onboarding. Card padding is 14 / 14 / 14 / 16. List rows have 12 px left and 16 px right padding.
- Gaps: card grid 12, tiles 10, stat tiles 8, photo grid 6. A section head has 14 above and 6 below, with a minimum height of 44.

**Radii:**

| Token | px | Use |
|---|---|---|
| `--r-print` | 4 | Mounted photo prints and the cover photo (a printed-photo feel) |
| `--r-xs` | 8 | Strip tracks (7 in SVG), small badges |
| `--r-sm` | 14 | Icon chips in rows, fields |
| `--r-md` | 18 | Stat tiles, day cells |
| `--r-lg` | 22 | Lists, white cards, sheet tiles, strip card |
| `--r-xl` | 24 | Since-last cards, Use-next hero |
| `--r-sheet` | 28 | Sheet top corners |
| `--r-pill` | 9999 | Buttons, chips, live pill, toggles, avatar |

**Elevation.** Light uses one soft shadow per level. Dark uses luminance steps (`bg` < `surface` < `sheet-bg`) and 1px rings, and never a glow.

| Level | Token | Light | Dark | Used by |
|---|---|---|---|---|
| e0 | none | Tinted cards: color is the separation | Neutral surface on bg | Since-last cards, tiles, stat tiles |
| e1 | `--shadow-1` | `0 1px 2px rgba(60,40,20,.05), 0 4px 14px -6px rgba(60,40,20,.10)` | `0 0 0 1px rgba(255,240,220,.03)` | Lists, strip card, round buttons, cover print |
| e2 | `--shadow-2` | `0 10px 30px -8px rgba(43,36,32,.38), 0 2px 6px rgba(43,36,32,.12)` | `0 10px 30px -8px rgba(0,0,0,.70), 0 0 0 1px rgba(255,240,220,.06)` | Live pill, toast, dragged row |
| e3 | `--shadow-sheet` | `0 -12px 40px rgba(30,20,12,.20)` | `0 -12px 40px rgba(0,0,0,.55)` | Sheets |
| + | `--shadow-fab` | `0 6px 16px -4px rgba(166,83,47,.55)` | `none` (no glow at night) | Center + |

**No `backdrop-filter`, no glassmorphism and no gradients on chrome** anywhere (AUDIT §6.6).

---

## 5. Layout

Reference viewport: **390 × 844** (iPhone 14/15). Everything uses `env(safe-area-inset-*)` through the `--safe-*` tokens.

| Element | Spec |
|---|---|
| Status-bar zone | `--safe-top` (47 on the reference device). Content starts below it. `theme-color` meta = `--bg`. |
| **Bottom nav** | `--nav-h` 56 + `--safe-bottom` (34 on the reference device) = 90. Background `--nav-bg`, 1px `--line` top border, grid `1fr 1fr 84px 1fr 1fr`: Today · Timeline · **+** · Stash · Memories. Tabs are ≥ 56 tall with a 26 px icon and a 12 px label. The active tab has an `--accent` icon, a `--text` label at 800 weight and `aria-current="page"`. |
| **Center +** | `--fab-size` 58 circle, `--fab-bg` fill, raised `--fab-raise` 8 above the nav's top edge, with a 4px `--nav-bg` ring and a 30 px plus glyph (2.25 stroke). It is **not a tab**. |
| **Live pill** | Floats above the nav: `left/right: --pill-inset` (16), height `--pill-h` (60), bottom edge 12 px above the + ring (bottom = 104 on the reference device). Shown on **every** tab and on pushed screens such as Settings, where it docks 12 px above the home indicator (bottom 46). Hidden only during onboarding and under an open sheet's scrim. |
| **Toast** | Same slot as the pill. If a pill is showing, the toast stacks 8 px above it. |
| **Scroll area** | Every tab scrolls inside the region between the safe top and the nav. It has `padding-bottom: var(--content-bottom-pad)` so content **at rest at the end of the scroll** never sits under the pill. Only the overflow edge gets a 24 px fade (`mask-image`) directly above the pill, so it applies to content mid-scroll, never to resting content. |
| **Sheets** | Bottom-anchored, full width, `--r-sheet` top corners. Max height `--sheet-max-h` (`100dvh − safe-top − 24`). A quick sheet sizes to its content; a form sheet expands up to the max and scrolls inside. The primary action is pinned to the bottom above `--safe-bottom`. The + stays visible **above** its own sheet as the × (`--z-fab-over-sheet`). |
| **Thumb zone** | At 390 × 844, everything below y ≈ 420 is comfortable one-thumb reach. Primary actions live there: +, pill, Finish, sheet buttons, the lower half of every card, and Wet / Dirty / Both. Top-of-screen controls are secondary (avatar → Settings, day pager, labelled header actions). |
| **Today fits one screen** | Masthead 88 + 2×2 cards (152 + 12 + 152) + section head + the newest rows. No scrolling is needed to answer the four questions. |
| **z-index** | `--z-content` 1 · `--z-fade` 2 · `--z-nav` 30 · `--z-pill` 40 · `--z-toast` 50 · `--z-scrim` 60 · `--z-sheet` 70 · `--z-fab-over-sheet` 80 · `--z-coach` 90 · `--z-splash` 100 |
| **Targets** | `--tap-min` 44. Every interactive element is ≥ 44 × 44 (verified: 0 violations in all 14 rendered frames). Visual size may be smaller when the hit area is extended, e.g. the toggle's 52 × 32 track inside a 56 × 44 button. |
| **Zoom** | At 200% text size the since-last grid falls back to one column and cards grow in height. Nothing truncates except list-row meta, which ellipsizes. |

---

## 6. Components

**Shared rules.**

- Every interactive element is a real `<button>`, `<a>`, `<input>` or `<label>` with a ≥ 44 pt hit area.
- Focus shows on `:focus-visible` as `box-shadow: var(--focus-ring)` (3px `--bg` gap, then 2px `--accent-ink`).
- Pressed: `transform: scale(var(--press-scale))` (.97; cards use .98) over `--dur-press`, plus the press color.
- Disabled: opacity .38, `aria-disabled="true"`, no shadow.
- Icons are `aria-hidden`; the visible word or the button's `aria-label` carries the meaning.

### 6.1 Buttons

| Variant | Anatomy | States |
|---|---|---|
| **Primary** | 52 tall (56 as a block), `--r-pill`, `--primary-bg` fill, `--on-primary` label 17 / 800, optional 22 px leading icon, 8 gap. **One per view.** | default · pressed (`--primary-press`) · focus · disabled · loading (label becomes a 3-dot ellipsis, width locked, `aria-busy`) |
| **Secondary** | 52 tall, `--surface` fill plus a 1px `--line` inset when sitting on a tint; `--surface-2` fill when sitting on a surface. `--text` label. | Same set. Pressed moves the fill one step toward `--surface-2`. |
| **Outline** (header actions) | 44 tall, transparent, 1.5px `--line-strong` inset, 20 px icon + label 15 / 800 ("Add pouch", "Add"). **Replaces every second accent + disc.** | default · pressed (`--surface-2` fill) · focus |
| **Ghost** | 44 tall, no fill, `--accent-ink` label 15 / 800 ("Timeline ›", "I have a backup file") | pressed (`--accent-soft` fill) · focus |
| **Destructive** | Primary shape with `--danger-ink` fill and `--on-danger` label. **Only inside a ConfirmSheet**, never as a first tap. Soft variant (`--danger-tint` + `--danger-ink`) for list actions. | default · pressed · focus |
| **Round icon** | 44 circle, `--surface` + `--shadow-1`, 24 px icon, `aria-label` required (day pager ‹ ›) | default · pressed · disabled (`--text-3`, opacity .6) |

### 6.2 Masthead (Today header), 88 tall

- **Left:** an eyebrow ("WEDNESDAY · OCTOBER 14": 12 / 800 caps, +0.07em, `--text-2`). Below it, the baby name in Fraunces 34 / 560, then a 10 px gap, then the age in Fraunces italic 18 in `--text-2`, baseline-aligned ("6 weeks"; "6 weeks, 3 days" once it isn't a whole week; "3 months" from 13 weeks on).
- **Right:** the **avatar button** is 56 × 56. It holds a 52 photo circle with a 2px `--bg` ring and a 2px `--accent-soft` ring, plus a **24 px gear badge** at the bottom-right (`--surface` fill, 15 px gear, 2px `--bg` ring). `aria-label="Clara's profile and settings"`. It opens Settings. Night: the photo uses `filter: var(--avatar-filter)`.
- With a second baby, the eyebrow becomes a baby switcher ("CLARA ▾"). The date moves into the age line.

### 6.3 QuickLogCard (since-last), 152 tall, half width

- **Anatomy:**
  - Fill is `--c-card` with `--r-xl` and padding 14 / 14 / 14 / 16. **The whole card is one button.**
  - **Top row** (32): 20 px category icon + word (15 / 800, `--c-ink`) on the left. On the right, a 32 px **well** (`--c-well`) holding an 18 px `+`.
  - **Value:** 42 px numeral with half-size units, 10 px below the top row.
  - **Two detail lines** (14 / 600, `--text-2`, key value in `--text` 800): line 1 is "ago · **4 oz** formula", line 2 is the clock time ("at 7:40 AM").
- **Pump** replaces line 2 with the goal bar: a 6 px track in `--track-on-card`, fill in `--c-mid`, and "**12.5** / 24 oz" in 13 / 800.
- **States:**
  - *idle* (above).
  - *running* (sleep, breastfeeding):
    - The fill becomes `--c-tint` with a 1.5px inset `--c-mid` ring (at night that is the only tinted card).
    - The well becomes a **live chip** "● Nap" (28 tall, `--c-well`, 13 / 800).
    - Detail reads "since **8:55 AM**" / "Tap to wake".
    - Tapping logs the wake-up through the End-nap sheet, which comes pre-filled.
  - *due* (feed past the family's usual interval, only if the user enables it): line 2 becomes a `warn` badge with a clock icon and the words "Usually every 3h". Never red, never pulsing.
  - *stale* (nothing logged today): the value reads "—", line 1 reads "No feeds yet", line 2 reads "Tap to log".
  - *pressed:* scale .98.
  - *hidden:* removed through Customize; the grid reflows, and 3 cards span full width at the bottom.
- **Order** defaults to Fed, Asleep/Awake, Diaper, Pumped and can be reordered in Customize.
- **Accessible name** is one sentence, e.g. "Fed 2 hours 10 minutes ago, 4 ounces formula at 7:40 AM. Log a feed."

### 6.4 ListRow (timeline entry), min 64

- **Grid:**
  - time column, 46 wide, right-aligned: 15 / 800 tnum, with AM/PM below in 12 / 700 `--text-3`
  - 40 px chip (`--c-tint`, `--r-sm`, 22 px icon)
  - title (16 / 800) and meta (14 / 600 `--text-2`, ellipsized)
  - trailing amount (17 / 800 + 13 px unit), a badge, or a diaper-type glyph
- Rows sit in a `--surface` list (`--r-lg`, `--shadow-1`). Dividers are 1px `--line`, inset to start at the chip.
- **States:**
  - pressed (`--surface-2`)
  - **live** (chip gets a 2px `--surface` gap and a 1.5px `--c-mid` ring; trailing "● Now" badge)
  - **new** (see §7.6)
  - swipe left reveals Edit · Delete; Delete leads to a toast with Undo
- **One pattern everywhere:** tap a row to open its detail sheet (edit, delete with undo). This fixes AUDIT §2 "Edit vs row tap".

### 6.5 LivePill, 60 tall, dark in both themes

- **Anatomy (left to right):**
  - **44 px icon well** (`--pill-well`). It holds a 2.5px progress ring (track `--pill-ring`, arc `--pill-<cat>`, starting at 12 o'clock), a 22 px category icon, and a 12 px live dot at the top-right (`--pill-<cat>` fill with a 2.5px `--pill-bg` border).
  - **Text block:** title 16 / 800 ("Bottle") over a sub-line 13 / 600 `--pill-text-2` ("good for 1h 48m").
  - **Timer** 24 / 800 Nunito tnum ("12:04"), right-aligned.
  - **Finish button**, 44 tall: `--pill-btn-bg`, label 15 / 800.
  - The 1px `--pill-ring` inset and `--shadow-2`.
- **Behavior:**
  - Tapping the body or the well reopens the activity's sheet, which grows out of the pill.
  - **Finish** ends the timer in one tap and inserts the entry. A bottle asks "How much did Clara drink?" (the baby's name, never a pronoun) inline with the last amount pre-selected. A pump goes straight to its "How much?" step.
- **States:**
  - *running*
  - *warning*: under 10 minutes left, the sub-line turns `--pill-warn` and reads "use within 9 min", with a clock icon. No flashing.
  - *expired*: "Past 2h · discard" in `--pill-warn` with an icon; Finish becomes "Discard".
  - *paused* (breastfeeding): dashed ring, "Paused" label, Finish becomes "Resume".
  - *two running*: the pill shows the most recent activity plus a "+1" chip. Tapping the chip expands a 2-row mini list above the pill.
- **Accessibility:** `role="group"` with `aria-label` reading the whole sentence. The timer is `aria-hidden`, and an `aria-live="polite"` region announces at most once a minute ("Bottle, 13 minutes").

### 6.6 Sheet

- **Anatomy:**
  - `--sheet-bg` with `--r-sheet` top corners and `--shadow-sheet`
  - a 40 × 5 grabber (`--line-strong` at 50%) in a 24 px hit strip
  - a header row: Fraunces 26 title, plus an optional **time chip** on the right ("🕘 Now 9:50 ▾": 44 tall, `--surface-2`, 15 / 800, time in `--text-2`). The time chip opens a wheel time picker so you can back-date an entry without editing it afterwards.
- **States:** opening · open · dragging (follows the finger 1:1, and scrim opacity tracks position) · closing · step N (forward/back) · morph (feed → live timer).
- **Behavior:**
  - Dismiss by swiping down past 25% of its height or faster than 0.5 px/ms, tapping the scrim, tapping ×, or pressing Escape.
  - **Focus is trapped**, then returned to the trigger on close. `role="dialog" aria-modal="true" aria-labelledby` points at the title.
  - The page behind scales to `--page-behind-scale` (.985).
- **Six sheets in the app:** Quick log, Feed (bottle / breastfeed), Pump, Sleep, Diaper detail, Stash pouch. Also Entry detail, ConfirmSheet, Keypad, Time picker and Memory add/edit. All use this one Sheet controller.

### 6.7 Quick-log sheet (from the +)

- **Header:** "Log for Clara" plus the time chip.
- **Tiles:** 2 columns, 10 gap, each ≥ 96 tall. Fill `--c-card`, `--r-lg`, a 36 px well with a 20 px icon, a 17 / 800 label and a 13 px **context line**. Tiles are context-aware:
  - **Bottle:** "Feed a bottle" when idle; "● Running 12:04" (live ring) while a bottle runs.
  - **Breastfeed:** "Start on **left** · last was R".
  - **Pump:** "**12.5** of 24 oz today".
  - **Sleep:** "Start a nap" / "Start night sleep" (classified by clock, with override); "End nap · Asleep **55m**" (sun icon, live ring) while she sleeps.
- **Diaper row** (full width, ≥ 76): "Diaper / One tap" on the left, then three 52 px **one-tap buttons**: Wet (ring), Dirty (dot), Both (ring+dot). Each one **commits immediately**: the button flashes `--c-tint`, the sheet closes into the new row, and a toast offers Undo plus "Add details".
- **Secondary tiles** (row layout, ≥ 68): Memory ("Photo or first"), Stash milk ("Fridge or freezer").
- **Footer hint:** "Tip: hold **+** to log a bottle in one move." Show it until the express gesture has been used twice.
- Hidden trackers drop out, and the grid reflows (with 3 tiles, the last spans full width).

### 6.8 Other components

| Component | Anatomy & sizes | States |
|---|---|---|
| **Toast with Undo** | 52 tall, `--pill-bg`, message 15 / 600 `--pill-text` + "Undo" 44 hit in `--pill-feed` 800 | enter · idle (5 s; paused while touched or focused) · undone → "Restored" (1.2 s) · exit. `role="status"`, polite. **Only for background or reversible actions** (delete, mark used, discard, one-tap diaper). Success inside a sheet replaces the old "Feed logged!" toast. |
| **ConfirmSheet** | Small sheet: title ("Erase everything on this phone?"), one sentence, destructive primary, secondary "Keep it" | Replaces all 22 native `alert` / `confirm` calls. Reversible actions never confirm; they get Undo. |
| **Chip / Badge** | 28 tall, `--r-pill`, 13 / 800, optional 14 px icon, 10 px padding. Variants: category, `ok`, `warn`, `next` (accent-soft / accent-ink), `danger`. | Read-only badges are not buttons. Filter chips are 36 visual with a 44 hit and show a check plus a fill when selected. |
| **ExpiryBadge** | Badge + clock icon + words: `ok` "4 days left" · `warn` "Use by Fri" / "1 day left" · `next` "Best by Mar 2" · `danger` "Expired · discard" | Always words, never color alone. CDC: fridge 4 days; freezer best within 6 months, OK up to 12; thawed milk 24 h in the fridge; a bottle must be used within 2 h of making it (formula) or 1 h after the feed starts. |
| **SegmentedControl** | `--surface-2` track, 44 tall, `--r-pill`; selected segment `--surface` + `--shadow-1`, 800 weight. Used for formula / breast milk, L / R, nap / night, fridge / freezer, oz / mL. | `role="radiogroup"`, arrow keys move. The selection slides over `--dur-fast`. |
| **NumberStepper + Keypad** | Value 52 Nunito tnum + unit, 56 round − / + secondary buttons, quick chips (+0.5 / +1 oz or +15 / +30 mL), 44 tall | Hold −/+ to repeat at 8/s. Tapping the value opens a **Keypad sheet the same size** (no inline input swap, so no layout jump). `role="spinbutton"`, `aria-valuenow`, `aria-valuetext="4 ounces"`. At min or max the button is disabled. |
| **Toggle** | 52 × 32 track inside a 56 × 44 button, 26 px knob. On: `--toggle-on` track + `--knob`. Off: `--surface` track + 1.5px `--line-strong` inset, knob `--line-strong`. | `role="switch"` + `aria-checked`. The whole settings row toggles. The knob slides over `--dur-press`. |
| **DayPager** | Eyebrow "TIMELINE", Fraunces 32 day title ("Today" / "Yesterday" / "Mon, Oct 12"), date sub-line, two 44 round buttons; a 7-day row of 60-tall cells (12 px weekday + 17 / 800 date) | selected (2px `--text` ring on `--surface`) · today (4–5 px `--accent` dot) · future (disabled). Swipe the content horizontally to page. |
| **StatTile** | `--c-card`, `--r-md`, ≥ 82 tall, 20 px icon, value 18 / 800 (tnum, 13 px unit), label 12 / 700 | Tapping filters the list to that category. |
| **TimelineStrip** | `--surface` card. Header "24 hours" + "shaded = 7 PM – 7 AM". SVG at 1:1 scale: 4 lanes × 22 tall (sleep, feed, diaper, pump), 20 px lane icons in `--text-2`, tracks `--surface-2` with r7, night band `--band` (0–7 h, 19–24 h), future hatched (`--line-strong` at 35%), a 2px `--accent` now-line, axis 12 px `--text-3` at 12a/6a/12p/6p/12a, and a **legend** of 8 items with mini swatches. | Tapping a mark scrolls the list to that entry and gives it the new-row highlight. `role="img"` with a summary `aria-label`; the list below is the accessible equivalent. Hidden trackers drop their lane. |
| **Stash split bar** | 12 tall, 3 gap: fridge = solid `--pump-mid`, freezer = 135° stripes of `--pump-mid` / `--pump-tint` with a 1.5px `--pump-mid` inset. Legend: swatch + icon + word + **amount** + pouch count. | `role="img"`, `aria-label="Fridge 9 ounces, freezer 37 ounces"` |
| **UseNextHero** | `--c-card` (pump), `--r-xl`, 16 padding. "Use next" `next` badge plus a location line ("❄ Oldest in freezer"), a 64 × 76 pouch illustration, a 52 px amount, two meta lines, and buttons Thaw (primary) / Thaw & feed (secondary) in a `1fr 1.25fr` grid. | frozen (above) · thawed ("Thawed 1h ago · use within 23h", buttons Feed / Discard) · expired (danger badge, Discard only). |
| **MemoryCover** | A mounted print: 10 px `--surface` mat, 6 px radius, `--shadow-1` + 1px `--line`. The photo uses `--r-print`, height 138–244 depending on the screen, and `filter: var(--photo-filter)`. The caption row has an italic Fraunces 20 title and a 13 / 700 date with age. | Tap opens the memory detail. With no photo, it becomes an EmptyState. |
| **FirstsRow** | min 62: a 40 `--mem-tint` spark chip, title 16 / 800, meta "Fri, Oct 9 · 5 weeks, 2 days", and a 52 px mounted print thumbnail | kept · **suggested** (outlined spark chip in `--line-strong`, italic Fraunces 18 title, "Usually 3–4 months", trailing outline "+ Add") |
| **SettingsRow** | min 56: optional 36 × 44 grip (Customize), 36 icon chip, title 16 / 800 + sub 13, trailing toggle or chevron | default · pressed · **dragging** (lifted: `--shadow-2`, translate 6/−3, `--r-sm`) · disabled |
| **Field** | ≥ 58 tall, `--surface-2`, `--r-sm`, 13 / 700 label above a 17 / 800 value; caret `--accent` | focus (2px `--accent-ink` ring) · error (`--danger-ink` helper text with icon) |
| **EmptyState** | 64 `--c-tint` icon disc, Fraunces 22 title, one `--text-2` sentence, one primary action | e.g. Stash: "No milk stored yet" / "Pumped milk you save will line up here, oldest first." / [Add pouch] |
| **CoachMark** | `--pill-bg` bubble anchored to its target with an 8 px caret, 15 / 600 text, "Got it" ghost button | Shown once, e.g. after the 3rd tap-logged feed: "Hold + to log a bottle in one move." |

---

## 7. Motion contract

**Rule (AUDIT §3): every surface enters from, and exits back to, the thing that summoned it.** Motion explains where something came from and where it went. It is never decoration. Durations are short because a tired parent should never wait on an animation.

### 7.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 120 ms | Press feedback, color changes, toggle knob |
| `--dur-fast` | 200 ms | Fades, scrim, toast, segmented slide |
| `--dur-base` | 280 ms | Tab switch, step change, sheet close, row insert |
| `--dur-morph` | 320 ms | Shared-element moves (timer header ↔ live pill) |
| `--dur-sheet` | 380 ms | Sheet open (spring) |
| `--dur-grow` | 420 ms | Quick-log sheet / express pad growing from the + |
| `--dur-theme` | 600 ms | Theme cross-fade |
| `--dur-highlight` | 1200 ms | New-row tint wash |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Entering |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Exiting (exits run at about 75% of the enter duration) |
| `--ease-std` | `cubic-bezier(.4,0,.2,1)` | Moving between two on-screen states |
| `--ease-spring` | `cubic-bezier(.32,1.2,.5,1)` | ≤ 2% overshoot. Sheets and the pill only. |
| `--move-sm/md/lg/xl` | 8 / 16 / 24 / 32 px | Stagger rise, toast/row, tab, step distances |
| `--press-scale` / `--card-press-scale` / `--page-behind-scale` / `--fab-rotate` | .97 / .98 / .985 / 45deg | |

Components must build transforms **only from these tokens** (e.g. `translateX(var(--move-lg))`). The reduced-motion block then neutralizes them automatically.

### 7.2 Every transition

| # | Moment (AUDIT §3 item) | Origin → destination | Enter | Exit / reverse | `transform-origin` |
|---|---|---|---|---|---|
| 1 | **Any sheet: open / close** (all sheets) | Bottom edge, directly under the trigger | Scrim `opacity 0 → 1` over `--dur-fast` `--ease-out`, starting at t=0. The sheet goes `translateY(100%) → 0` over `--dur-sheet` `--ease-spring`. The page behind scales to `--page-behind-scale`. The trigger plays a 120 ms press first and keeps its pressed tint until it is covered. | `translateY(0 → 100%)` over 240 ms `--ease-in`, with the scrim fading in step. On `transitionend`: `display:none` / `inert`, and focus returns to the trigger. | `50% 100%` |
| 2 | **Drag to dismiss** | Grabber or header | Follows the finger 1:1. Scrim opacity = 1 − progress. | Release past 25% or faster than 0.5 px/ms closes with the remaining distance at `--ease-in`. Otherwise it springs back over `--dur-base` `--ease-spring`. | n/a |
| 3 | **Quick-log grows from +** | Center of the + | The sheet is clipped from `clip-path: circle(29px at 50% calc(100% - 69px))` to `circle(150% at 50% calc(100% - 69px))` (69 px = `--nav-total + --fab-raise - --fab-size / 2` on the reference device) over `--dur-grow` `--ease-out`, while the scrim fades in. The + rotates `--fab-rotate` into × over `--dur-base` **and stays in place** as the close button (`--z-fab-over-sheet`, ring color becomes `--sheet-bg`). Tiles fade in and rise `--move-sm`, staggered 20 ms, starting at 120 ms. **No decorative rings remain.** | The circle collapses back into the × over `--dur-base` `--ease-in`, then the × rotates back to + and the scrim fades. | The + center |
| 4 | **Express gesture (hold +)** | The + | After a 450 ms hold, the radial pad grows out of the + using the same clip-path over `--dur-grow`, with a haptic tick. Pad targets fan out at `--move-md`. | On release or cancel, it collapses into the + over `--dur-fast` `--ease-in`. A logged bottle then plays the row insert (#9). | The + center |
| 5 | **Feed sheet → live bottle timer** | Same sheet, morphing | "Start timer": the amount hero shrinks (FLIP, `--dur-morph` `--ease-std`) into the timer header, and the content cross-fades (`--dur-fast`). The sheet's height animates over `--dur-base`. **No second sheet.** | Reverse when you go Back. | The hero's center |
| 6 | **Timer sheet ↔ live pill** | Timer header ↔ pill | Dismissing a running-timer sheet shrinks the timer header into the pill (shared-element FLIP, `--dur-morph` `--ease-spring`) while the sheet slides away (#1). A timer started in the background makes the pill rise `--move-md` and fade in over `--dur-base`. | Tapping the pill grows the sheet out of the pill's rect (FLIP from the pill to the sheet header). **Finish** shrinks the pill into the newly inserted timeline row if it is on screen (`--dur-morph`, scale to the row's chip rect), and otherwise into the Today tab icon, which gets a one-shot dot. | The pill's well |
| 7 | **Step forward / back** (feed flow, onboarding) | Reading direction | Forward: the outgoing step goes to `−var(--move-xl)` and fades (`--dur-fast` `--ease-in`); the incoming step goes from `+var(--move-xl)` to 0 (`--dur-base` `--ease-out`). The sheet's height animates to fit over `--dur-base` `--ease-std`. | Back mirrors it. | n/a |
| 8 | **In-sheet success** (replaces the feed toast) | Inside the sheet | The primary button becomes a check plus "Logged" (`--dur-fast`), holds for 400 ms, then the sheet closes (#1). | Then #9 runs. **No toast** for a foreground success. | n/a |
| 9 | **New row inserted** | The closed sheet's trigger moves into the list | After the sheet finishes closing, the list makes room (height 0 → 64 over `--dur-base` `--ease-out`). The row slides from `−var(--move-md)` and fades in. Its chip scales .6 → 1. A `--c-tint` wash holds, then fades over `--dur-highlight`. The matching card's value cross-fades per digit to "Just now" (`--dur-fast`). | **Delete:** the row collapses (height → 0, `--dur-fast`), then the Undo toast rises (#10). **Undo** re-inserts the row with #9. | Row's left edge |
| 10 | **Toast** | Just above the element it reports on (pill or nav) | `translateY(var(--move-md)) + opacity 0 → 0 / 1` over `--dur-fast` `--ease-out`. | Fades and drops `--move-sm` over 160 ms `--ease-in`. **Never from the top of the screen.** | `50% 100%` |
| 11 | **Tab switch** | Nav order: Today → Timeline → Stash → Memories | Moving right: the incoming content goes from `translateX(var(--move-lg))` to 0 with opacity 0 → 1 over `--dur-base` `--ease-out`; the outgoing content only fades (160 ms). Moving left mirrors this. The nav, + and pill never move. Scroll position is restored per tab. | Mirror | n/a |
| 12 | **History accordion** (removed) | n/a | Replaced by the DayPager. Paging days slides the day content ±`--move-lg` with a cross-fade (`--dur-base`). The selected-day ring moves between cells over `--dur-fast` `--ease-std`. | Mirror | n/a |
| 13 | **Inline tap-to-type edits** (removed) | The value | Tapping a number opens the **Keypad sheet** (#1). The value then cross-fades in place (`--dur-fast`), at the same size, with no layout jump. | n/a | n/a |
| 14 | **Goal bar / fill** | Current value | Width animates only **on value change** (`--dur-base` `--ease-std`), never on a periodic re-render. | n/a | Left edge |
| 15 | **Theme change** (auto at 7 PM, or manual) | Whole UI | Root tokens cross-fade over `--dur-theme`, implemented as a `transition` on `background-color, color, border-color, fill` for the root and surfaces, enabled only while switching. **Deferred while any sheet is open**, then applied on close. | n/a | n/a |
| 16 | **Card / row → its sheet** | The tapped card or row | The card plays a 120 ms press (scale .98). The sheet then opens with #1. Its header icon chip FLIPs from the card's icon position over `--dur-morph`, so the eye follows. | On close, the chip FLIPs back to the card. | The card's icon |
| 17 | **Live dot / timers** | n/a | Digits swap without motion (tabular). The live dot is static; in light only, it may play a 2 s ease-in-out ring pulse at most every 4 s. **Never at night** and never with reduced motion. | n/a | n/a |
| 18 | **One-tap diaper** | The tapped button | The button fills `--c-tint` (`--dur-press`). Then the sheet collapses into the + (#3 reverse), the row inserts (#9) and the toast offers Undo (#10). | Undo removes the row (#9 delete). | Button center |
| 19 | **Thaw** (Stash) | The Use-next hero | The pouch art cross-fades from the freezer variant to the thawed variant (`--dur-base`). The badge text changes. The hero keeps its place; the freezer list removes the pouch's row (collapse `--dur-fast`). | Undo restores it. | n/a |
| 20 | **Scroll to a strip mark / "+N more"** | The tapped mark | Smooth scroll (`scroll-behavior: smooth`) to the row, offset by the header, then the row highlight (#9 wash only). | n/a | n/a |

### 7.3 Reduced motion

Triggered by `@media (prefers-reduced-motion: reduce)` **or** the in-app Settings → Comfort → **Reduce motion** toggle (`:root[data-motion="reduce"]`), which defaults to following the system. tokens.css then sets:

- `--move-*` to 0, `--press-scale`, `--card-press-scale` and `--page-behind-scale` to 1, and `--fab-rotate` to 0deg.
- Transform durations to 150 ms, every easing to linear, and `--dur-highlight` to 600 ms.

Components must also:

- **Remove clip-path growth and FLIPs.** Sheets, the express pad and the pill appear in place with an **opacity cross-fade ≤ 150 ms**. The scrim still fades.
- Swap the + ↔ × icon instantly, without rotation.
- Drop all stagger, parallax, the page-behind scale, pulses, shakes and bounces. Drag-to-dismiss still works, with no spring.
- **Keep** the new-row tint wash (it is color, not motion) at 600 ms, so the "where did it go" cue survives.
- Use `scroll-behavior: auto`.

---

## 8. Night mode rules

1. **Warm charcoal only.** No blue-black; every neutral has R > G > B. `--bg` is `#191512`.
2. **The luminance ceiling is `--text` `#DCD0BF`.** Nothing is brighter: no pure white anywhere, including knobs (`#D3C7B6`), carets, text on photos and status-bar icons.
3. **Neutral cards, color only in icons and wells.** `--<cat>-card` is `--surface` and `--<cat>-well` is the tint. A running activity's card is the only tinted card.
4. **One lit object.** Only the + carries an accent **fill**, and it is dimmed (`--fab-bg #B9714F`, no glow, `--shadow-fab: none`). Primary buttons become soft ember (`--primary-bg #3A2A20` with `#E09A76` label). Toggles dim (`--toggle-on #9A5E40`).
5. **Weights drop by 30** through the weight tokens (halation compensation).
6. **Photos at 78% brightness and 85% saturation** (`--photo-filter`); the avatar is at 82%.
7. **Shadows become luminance steps** plus 1px rings. Sheets are `--sheet-bg`, one step above the surfaces.
8. **The live pill keeps its shape and position** at night (`#2E2722`, with a 1px ring), so it is recognizable at any hour.
9. **Nothing moves to get attention.** No pulses; timer warnings are text and icon only.
10. **Auto-switch** follows the system scheme or the user's clock window (default 7 PM to 7 AM), uses the 600 ms token cross-fade, and never flips while a sheet is open.
11. **Sound is off by default from 7 PM to 8 AM** (off entirely by default; haptics where supported).
12. `<meta name="theme-color">` updates to `--bg` on every theme change, and the status bar is light-content at night.

---

## 9. Iconography

- **Inline SVG `<symbol>` sprite** in `index.html`, used through `<use href="#i-name">`. No icon font, no external file, no network request. Every icon is `aria-hidden="true"`.
- **24 × 24 grid** with a 2px safe margin. **1.75px stroke**, `stroke-linecap: round`, `stroke-linejoin: round`, no fills, `currentColor` only. Exceptions: the grip dots, the diaper-type glyphs (dirty dot, both's center dot) and status dots are filled. The center + uses 2.25px.
- **Render sizes:** 14 (in badges), 18 (inline with text, diaper-type glyphs), 20 (card labels, tiles, stat tiles, lane icons), 22 (row chips, pill), 24 (default), 26 (tabs), 30 (+).
- **Color:** a category icon takes its category ink (`--c-ink`, or `--pill-<cat>` on the pill). A UI icon takes `--text-2`. The active tab icon takes `--accent`.
- **One metaphor per concept, reused everywhere** (card, row, tile, strip lane, Customize, pill): bottle, breast, pump, pouch, moon / sun, diaper, wet / dirty / both, spark, camera, book (Memories tab), home (Today tab), timeline (list with dots), fridge, snow, thaw (drop over waves), clock, check, chevrons, grip, gear, shield, lock, phone, export, motion.
- Shapes are simple and rounded. No anatomy beyond the abstract breast glyph, no faces, no bows, vines or hearts as decoration.
- An icon is never the only label on a primary action. Icon-only buttons (avatar, pager arrows, close ×) always have an `aria-label`.

---

## 10. Copy voice

**Warm, short, factual, never anxious.** Talk like a calm friend holding the other baby.

| Do | Don't |
|---|---|
| "Fed 2h 10m ago" | "Feeding overdue!" |
| "Usually every 3h" (only if the family turns on hints) | "Late feed" |
| "Use within 9 min" | "WARNING: bottle expiring" |
| "Tap to wake" | "Stop sleep session" |
| "Logged" (inside the sheet) | "Feed Logged Successfully!" |
| "Deleted · Undo" | "Are you sure you want to delete this entry?" |
| "Hidden trackers keep their data." | "Disabling will remove…" |
| "No milk stored yet" | "Inventory empty" |
| "Free. Private. Everything stays on this phone." | Any mention of accounts, cloud, sync or premium |

- **Formats:**
  - Durations: `2h 10m`, `3h 00m`, `55m`, "Just now".
  - Clock times: `7:40 AM` (follow the device's 12/24-hour setting).
  - Amounts: `4 oz`, `3.5 oz`, `120 mL` (no trailing `.0`; mL is always an integer).
  - Dates: `Wed, Oct 14`; "Today" and "Yesterday" in lists.
  - Age: "6 weeks", "6 weeks, 3 days", "3 months".
- **Words:** say "Fed", "Asleep / Awake", "Diaper", "Pumped" on cards; "Bottle", "Breastfeed", "Pump", "Nap", "Night sleep" as actions; "Stash", "Fridge", "Freezer", "Pouch" for milk; "Memories" and "Firsts". Refer to the baby by name ("Log for Clara"). Never use "user" or "session".
- **Never assume the baby's gender.** Product copy uses the baby's name or "they/their": "How much did Clara drink?", "Clara's photo can become the app icon", "while Clara sleeps". The sample data in this doc and the mockups says "she/her" only because the sample baby is called Clara; that wording must not reach the shipped strings.
- **Hidden trackers disappear everywhere.** Turning a tracker off in Customize removes its Today card, its quick-log tile, its timeline row and, for Memories and Stash, its nav tab. (Frame 7 shows the toggle off only to demonstrate the off state.)
- **Sentence case** everywhere, except 12 px eyebrows and group labels, which are caps with tracking.

---

## 11. Accessibility contract

- **Contrast:** §2.4, with every pair passing in both themes.
- **Targets:** ≥ 44 × 44 for everything (toggles extend their hit area; whole cards and whole settings rows are buttons).
- **No clickable `<div>`s.** Use `<button>`, `<a>`, `<input>`, `<label>`.
- **ARIA patterns:**
  - Sheets: `role="dialog" aria-modal="true" aria-labelledby`, with focus trap and restore.
  - Toggles: `role="switch" aria-checked`.
  - Segmented controls: `role="radiogroup"` with arrow-key navigation.
  - Steppers: `role="spinbutton"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and `aria-valuetext="4 ounces"`.
  - DayPager: `role="tablist"` with `aria-selected`.
  - Active tab: `aria-current="page"`.
  - Strip and split bar: `role="img"` with a summary `aria-label`.
  - Toast: `role="status"`.
  - Live pill: `role="group"` with a full-sentence label.
  - Timers: `aria-live="polite"` at most once a minute.
- **State is never color-only:** running = live chip with words plus a ring; diaper type = shape; nap vs night = outline vs solid; fridge vs freezer = pattern, icon and word; expiry = words; off toggle = position plus outline.
- **Reduced motion:** §7.3, covering both the system setting and the in-app toggle.
- **Zoom:** rem sizes. At 200% the cards stack to one column.

---

## 12. Privacy surface (AUDIT §6.8)

- **Onboarding screen 1:** "Free. Private." plus the clay italic line "Everything stays on this phone." Then three hairline promises:
  - "**No account.** No ads, no analytics."
  - "**Works offline,** even at 3am."
  - "**Yours to keep.** Export or erase any time."
  - Photo note: "Her photo and name never leave this phone. On iPhone, her photo can become the app icon." The icon claim appears only on iOS Safari before install (AUDIT §6.4).
  - "I have a backup file" restore link.
- **Settings → Customize → Privacy & your data:** "✓ 0 network requests · 14.2 MB". The count is live: requests the page has made since load, from `performance.getEntriesByType('resource')` filtered to other origins. The size comes from `navigator.storage.estimate()`.
- **Design constraints that keep this true:** self-hosted fonts, an inline icon sprite, no remote images or embeds, CSS that is CSP-compatible (no inline `style=""` in production; dynamic widths come from CSS custom properties set through the CSSOM, which CSP allows), and no inline scripts.

---

## 13. Screen layouts (390 × 844)

Coordinates are for the reference device (safe top 47, safe bottom 34). Every tab screen has the bottom nav (§5), the + and the live pill whenever something is running.

### Frame 1: Today (light)

1. **Masthead** (y 47–135): eyebrow "WEDNESDAY · OCTOBER 14"; "Clara" plus the italic "6 weeks"; avatar with gear on the right.
2. **Since-last grid** (y ≈ 137–465): a 2 × 2 grid of QuickLogCards with 12 gap.
   - **Fed** `2h 10m` · "ago · **4 oz** formula" · "at 7:40 AM"
   - **Asleep** (running) `55m` · live chip "● Nap" · "since **8:55 AM**" · "Tap to wake"
   - **Diaper** `3h 00m` · "ago · **wet**" · "at 6:50 AM · 3 today"
   - **Pumped** `2h 40m` · "ago · **3.5 oz** · 7:10" · goal bar 52% · "**12.5** / 24 oz"
3. **Section head:** "Today" (Fraunces 22) plus a ghost "Timeline ›".
4. **Today list,** newest first:
   - 8:55 AM Nap · "Asleep · 55m so far" · "● Now" (live)
   - 7:40 AM Bottle · formula · "Finished in 18 min" · 4 oz
   - 7:10 AM Pumped · "16 min · to fridge" · 3.5 oz
   - 6:50 AM Diaper · Wet (ring glyph)
5. **Live pill:** "Bottle · good for 1h 48m · **12:04** · [Finish]".
6. **Nav:** Today is active.

### Frame 2: Today (night)

Identical markup under `data-theme="dark"`:

- Cards turn neutral `--surface`, with category color only in the label word, the icon and the well.
- The running Asleep card is the only tinted one.
- The + is dimmed with no glow, and weights drop by 30.
- The pill keeps its shape.

### Frame 3: Quick-log sheet

- **Behind:** Today, scaled to .985 under the scrim.
- **The sheet** grows from the + and its top sits at ≈ y 214. It contains:
  - The header "Log for Clara" plus the time chip "Now 9:50 ▾".
  - Tile grid row 1: **Bottle** "● Running 12:04" (live ring) · **Breastfeed** "Start on **left** · last was R".
  - Tile grid row 2: **Pump** "**12.5** of 24 oz today" · **End nap** "Asleep **55m**" (sun icon, live ring).
  - The **Diaper row**: "Diaper / One tap" + [○ Wet] [● Dirty] [◉ Both].
  - The row tiles **Memory** "Photo or first" and **Stash milk** "Fridge or freezer".
  - The hint "Tip: hold **+** to log a bottle in one move."
- **The + has turned into the ×** and stays in place above the sheet. No decorative rings.

### Frame 4: Timeline

1. **Page header:** eyebrow "TIMELINE", "Today" (Fraunces 32), "Wednesday, October 14", pager ‹ (enabled) › (disabled on today).
2. **Week row:** Th 8 … We 14. Selected = ring; today = accent dot.
3. **Stat tiles:** **7 oz** "3 feeds" · **6h 45m** "slept" · **3** "diapers" · **12.5 oz** "pumped".
4. **24h strip:** "24 hours / shaded = 7 PM – 7 AM".
   - Sleep: solid night blocks 12:00–2:00 AM and 2:40–6:30 AM; the running **outlined** nap 8:55 AM → now.
   - Feeds: bottle ticks at 2:10 AM and 7:40 AM; a **hollow** breastfeed tick at 5:05 AM.
   - Diapers: a dirty dot at 2:25 AM; wet rings at 5:20 AM and 6:50 AM.
   - Pumps: diamonds at 12:50 AM, 4:20 AM and 7:10 AM.
   - Now-line at 9:50 AM, future hatched, axis labels.
   - Legend: Night sleep · Nap · Bottle · Breast · Pump · Wet · Dirty · Both.
5. **"The day"** + "10 entries · newest first", then the same ListRows as Today, continuing down the day.

### Frame 5: Stash

1. **Header:** eyebrow "MILK STASH", **46 oz** (56 px Nunito), and the outline action **"+ Add pouch"** (no accent disc). Sub-line "About 11 bottles of 4 oz".
2. **Split bar:** fridge 9 (solid) | freezer 37 (striped). Legend: "▪ 🧊 Fridge **9 oz** · 2" and "▨ ❄ Freezer **37 oz** · 8".
3. **Use-next hero** (pump card):
   - "✦ Use next" + "❄ Oldest in freezer"
   - pouch art, **4 oz**, "Pumped **Sep 2** · frozen 6 weeks" / "Best by **Mar 2** · 4½ months left"
   - [Thaw] (primary) [Thaw & feed] (secondary)
4. **Fridge** section head with "9 oz" and "Keeps 4 days". Rows, oldest first: **5.5 oz** "Yesterday, 8:20 PM" `ok` "3 days left"; **3.5 oz** "Today, 7:10 AM" `ok` "4 days left".
5. **Freezer** section (below the fold): "37 oz · 8 pouches", oldest first.

### Frame 6: Memories (keepsake book)

1. **Header:** eyebrow "CLARA'S BOOK", "Memories", outline action "📷 Add".
2. **Cover print:** a mounted photo plus the italic caption "The first real smile" and "Fri, Oct 9 · 5 weeks".
3. **Firsts** + "3 of 12 kept":
   - First real smile · "Fri, Oct 9 · 5 weeks, 2 days" · print
   - Head up in tummy time · "Mon, Sep 28 · 3 weeks, 5 days" · print
   - First bath at home · "Sun, Sep 6 · 4 days" · print
   - Suggested: *Laughs out loud* · "Usually 3–4 months" · [+ Add]
4. **Below the fold:** "Week 6 · Oct 7–13", a 3-column photo grid (6 gap, `--r-print`), then earlier weeks.
5. **The live pill persists here** (fixing Editorial Soft's omission).

### Frame 7: Settings → Customize

1. **Nav bar:** "‹ Settings" (ghost, accent-ink) and the centered title "Customize".
2. **Intro:** "Choose what shows on Today and in +. Drag to reorder. Hidden trackers keep their data."
3. **TRACKERS** (all on by default): Bottle feeds · Breastfeeding · Sleep (shown **mid-drag**) · Pumping "Goal 24 oz a day" · Milk stash · Diapers · Milestones & memories (shown **off**: "Hidden · photos kept").
4. **COMFORT & PRIVACY:**
   - **Reduce motion**: "Fades instead of slides", a toggle that follows the system until changed.
   - **Privacy & your data**: "✓ 0 network requests · 14.2 MB", chevron.
5. **The live pill is docked** above the home indicator.

The rest of **Settings** (one level up, reached from the avatar) contains:

- **Clara** (name, birthdate, photo; "Add a baby")
- **Customize**
- **Feeding & goals** (methods, pump goal, units oz/mL)
- **Appearance** (Auto / Light / Dark, night window)
- **Comfort** (Reduce motion, Sounds, Haptics)
- **Reminders** (.ics pump reminders)
- **Backup & sharing** (export, import with merge, share today's summary, weekly backup nudge)
- **Privacy & your data**
- **About** (source link, feedback with no tracking)

### Frame 8: Onboarding, screen 1

1. **Top:** wordmark "Nurture" (Fraunces 26, accent-ink) and step dots (1 of 4: Baby → Feeding → Goals (only if pumping) → Install).
2. **Headline:** "Free. Private." plus the clay italic "Everything stays on this phone."
3. **Three hairline promise rows** (§12).
4. **"Who are we caring for?"** A 104 photo picker (dashed accent ring, camera + "Add photo", + badge) beside the fields **Baby's name** "Clara" and **Born** "Wed, Sep 2, 2026 ▾".
5. **Lock note:** "Her photo and name never leave this phone. On iPhone, her photo can become the app icon."
6. **Footer:** [Continue] (primary block) and the ghost "I have a backup file".

### Night set (frames 3N–8N)

The same markup with `data-theme="dark"`, proving the theming is tokens-only:

- Sheet tiles are neutral, with only the running tiles tinted.
- The Stash Thaw button is soft ember, so only the + is lit.
- Memories photos are dimmed.
- Customize toggles are dimmed.
- Onboarding's Continue is soft ember.

---

## 14. What changed from today's app (AUDIT cross-reference)

| Audit item | Resolution |
|---|---|
| §4 3-screen-tall Pump-first home | Today = four since-last cards + the newest rows, on one screen. Pumping is one card. |
| §4 crowded header, §2 theme/unit chips | Masthead: date, name, age, avatar → Settings. Theme and units live in Settings only. |
| §2 three doors to "log a pump", duplicate Log feed | One + and one card per category. The pump tile opens one sheet: Start timer (primary) / Log past pump. |
| §2 banner tap starts a timer | Banners open the sheet; only the sheet's primary button starts. |
| §2 every feed stamped "now" | The time chip in every sheet header. |
| §2 pump output before stop | Stop → "How much?" step; the pill's Finish leads to the same step. |
| §2 Use-next has the same tiny buttons | UseNextHero with primary Thaw. |
| §2 Edit vs row tap | One ListRow pattern: tap → detail sheet. |
| §2 History accordion / "Show previous days" | DayPager + strip + day list. |
| §3 everything from thin air | Motion contract §7, #1–#20. |
| §4 22 native dialogs | ConfirmSheet for destructive actions; Toast + Undo for reversible ones. |
| §5 tiny targets, clickable divs, no focus | §6 shared rules: ≥ 44, real elements, two-layer focus ring. |
| §6.6 glassmorphism, bows, vines | Flat tints, one shadow tier, no blur, no decoration. |
| §6.8 Google Fonts leak | 3 self-hosted woff2; 0 external requests verified in Playwright. |

---

## 15. Judge findings and how they were resolved

| Finding (judge) | Resolution |
|---|---|
| Night First light pill reads as just another card (3am) | Dark pill in both themes (Calm Oat) with a 24 px right-aligned timer and a progress ring. |
| No Finish on the pill: 2 taps to end a bottle (3am) | 44 px Finish inside the pill (Editorial Soft). |
| Bright, glowing night + (3am, polish) | `--fab-bg #B9714F`, `--shadow-fab: none`. |
| Two lit objects at night on Stash (3am, a11y) | `--primary-bg` is soft ember at night, and toggles dim. Only the + is a lit fill. |
| Duplicate accent + discs top-right (3am, polish) | Labelled outline header actions ("Add pouch", "Add"). |
| Frozen concentric rings in the sheet (3am, polish) | Removed. The grow-from-+ is motion only (§7 #3). |
| Night First Pumped card lost "ago" and the amount (polish) | "ago · **3.5 oz** · 7:10" plus the goal bar. |
| Night First stash data contradicted the sample (polish) | Fridge = 5.5 oz (yesterday 8:20 PM) + 3.5 oz (today 7:10 AM) = 9 oz. Pumps today 4.5 + 4.5 + 3.5 = 12.5 oz. |
| Night First light-mode color coding weak (polish) | Light cards use Calm Oat's flat tints; neutral cards are night only. |
| Nap vs night by lightness only, 2.86:1 / 2.41:1 (a11y, **fatal**) | Night = solid, nap = 2px outline. `--sleep-mid` is ≥ 3.31:1 on the track and the band in both themes. A legend is included. |
| Activity strip has no legend (polish) | An 8-item legend with mini swatches, plus a header note for the shaded band. |
| Fraunces `tabular-nums` claim (all) | Removed. Every number is Nunito (natively tabular); Fraunces is words only (§3.2). |
| 34 px proportional serif numerals (3am, **fatal** for Editorial Soft) | 42 px Nunito tnum with half-size units. |
| 11 px micro labels (3am, a11y, **fatal**) | The 12 px floor, verified (0 nodes under 12 px). |
| 10.8 px "/ 24 oz" in Calm Oat | 13 px. |
| 344 KB, 3-file font payload with full-axis italic (a11y, **fatal**) | 3 files, 120 KB: Nunito 39 KB, Fraunces roman instanced to 57 KB, italic as a static 23 KB file. |
| 160 KB unsubsetted fonts, `font-display: block`, no licenses (Calm Oat) | Instanced, `swap`, OFL files shipped. |
| 150 px fade washing out resting content (a11y, **fatal**) | 24 px edge mask on overflow only. Resting content gets bottom padding clear of the pill. |
| Live pill missing on Memories (polish) | Pill on every tab and docked on pushed screens. |
| Diaper 3 taps from + (3am) | One-tap Wet / Dirty / Both row in the + sheet. |
| ~20 component-level theme overrides (Night First) | Tokens-only dark theme with semantic tokens (`--<cat>-card`, `--<cat>-well`, `--fab-bg`, `--primary-bg`, `--toggle-on`). |
| "transform-origin at the trigger's x" has no effect on translateY (Calm Oat motion) | Origins restated per transition (§7.2). The card-to-sheet link is an icon FLIP (#16). |
| Pill collapses into the + rather than into the new row | Finish shrinks the pill into the inserted row, or into the Today tab icon if the row is off screen (#6). |
| Weekday wrong for Oct 14, 2026 (two candidates) | "Wednesday". Born Wed, Sep 2 = exactly 6 weeks. |
| Milestone age off by one (Editorial Soft) | Ages computed from Sep 2: Oct 9 = 5w 2d, Sep 28 = 3w 5d, Sep 6 = 4 days. |
| Calm Oat Memories clip-art | Mounted photo prints (placeholders read as photos). Keepsake structure from Editorial Soft. |
| Reorder grips at 36 × 44 (Editorial Soft) | The grip shows a 36 px column but its hit area is 44 × 44 (it overlaps 8 px into the gap before the chip). Long-pressing anywhere on the row also starts a drag. |

---

## 16. Open questions for the owner

1. **"Use next" rule.** The sample makes the oldest *freezer* pouch "use next" while fridge milk (3 and 4 days left) waits. CDC guidance favors using fresh or fridge milk first. Proposed production rule: rank fridge milk that will expire within 24 h first, otherwise the oldest frozen pouch. Confirm?
2. **The live bottle example** ("Bottle · 12:04 · good for 1h 48m") runs while Clara is asleep. We read it as a *prepared-bottle safety timer* (2 h formula window), not an active feed. Should "made a bottle" and "feeding now" be two distinct states, with the 1 h after-first-sip rule shown once feeding starts?
3. **"Due" hints** (e.g. "Usually every 3h") are off by default to keep the tone calm. Turn them on by default for newborns under 8 weeks?
4. **Night auto-switch:** follow the system (default), or default to the 7 PM to 7 AM clock window?
