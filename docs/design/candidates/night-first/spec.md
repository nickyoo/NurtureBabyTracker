# Nurture: "Night First" design system

**Direction:** designed for 3am first. The dark theme is the hero: warm charcoal, dimmed warm off-white text, low-luminance desaturated accents. The light theme is the same system printed on warm paper. Hierarchy comes from **size and luminance**, not borders, boxes or glass. The goal is that the app feels like a night-light.

Files in this folder:

- `mockup.html`: 8 static phone frames (390×844). No JS and no external requests; fonts load from `fonts/`.
- `frame-1.png` … `frame-8.png`: element screenshots at 2×.
- `fonts/`: self-hosted woff2 plus OFL licenses.

---

## 1. Principles

1. **One glance, one number.** Every Today card answers a single "how long since" question with a 42px tabular numeral. Units (`h`, `m`, `oz`) render at half size in `text-2`, so the digits are what you see first.
2. **Nothing brighter than it must be.** In night mode the brightest pixel is `text-1` (#DCD0BF, relative luminance ≈0.63). There is no pure white, no saturated fill bigger than the + button, and photos are dimmed to 78%.
3. **Luminance is elevation.** Dark surfaces step up in warm-grey luminance (`bg → surface → raised → fill`) and don't use shadows or borders. Light mode uses the same steps plus one soft shadow tier.
4. **Color is never alone.** Every category color travels with an icon *and* a word. In the timeline strip it also travels with a **shape**: blocks for sleep, ticks for feeds, ring or dot for diapers, diamonds for pumps.
5. **Everything enters from and exits to what summoned it** (AUDIT §3). See the Motion contract in §8.
6. **Fully private, visibly.** No third-party requests. Fonts are local and the privacy row is one tap from Customize. Onboarding says it once, plainly.

---

## 2. Typefaces (self-hosted)

| Role | Family | File | Size | Why |
|---|---|---|---|---|
| UI + **all numerals** | **Figtree** (variable 300–900, OFL) | `fonts/figtree-latin-wght-normal.woff2` | 20 KB | Friendly, open apertures at small sizes, and it ships a real `tnum` feature, so timers and "since" numbers don't jitter as they tick. |
| Titles, baby name, onboarding headline | **Fraunces** (variable wght + SOFT, OFL) | `fonts/fraunces-latin-soft-normal.woff2` | 62 KB | A soft "bedtime story" serif that carries over from the current brand. Always set with `font-variation-settings:"SOFT" 100`. |

- Fraunces has **no `tnum`** (its digits are proportional; verified with fontTools). For that reason **numerals are never set in Fraunces**.
- Both files have the woff2 magic `wOF2` and are latin-only. Together they come to 82 KB. Preload both and have the service worker cache them. No Google Fonts.
- `@font-face { font-display: swap; }` with the fallback `system-ui`.

---

## 3. Color tokens

Tokens live on `:root` / `[data-theme="dark"]`. The dark set is the **source**: the light set was derived from it by inverting luminance onto warm paper while keeping the hues.

### 3.1 Neutrals + accent

| Token | Dark (hero) | Light | Use |
|---|---|---|---|
| `--bg` | `#191512` | `#F4EFE7` | App background. Warm charcoal, never blue-black / warm paper |
| `--surface` | `#221D19` | `#FBF8F3` | Cards, list groups |
| `--raised` | `#2A2420` | `#FFFDF9` | Sheets, live pill (light), lifted rows |
| `--sunken` | `#14110F` | `#ECE5DA` | Chips, night band in the strip |
| `--fill` | `#332C26` | `#E8E0D3` | Secondary buttons, tracks, live pill (dark), grabber |
| `--text-1` | `#DCD0BF` | `#2A231E` | Primary text and numerals. In dark this is the **luminance ceiling** |
| `--text-2` | `#A69989` | `#655849` | Meta, units, inactive tabs |
| `--text-3` | `#8E8275` | `#786B5E` | **Non-text only**: grips, chevrons, dashed rings, off-toggle ring |
| `--accent` | `#CF8C64` | `#A4552E` | The one warm accent (ember / clay): + button, primary button, active tab icon, links, toggle-on |
| `--accent-ink` | `#CF8C64` | `#8A4423` | Accent-colored **text on an accent tint** (light needs a deeper ink) |
| `--on-accent` | `#1E1713` | `#FFF9F3` | Label on an accent fill. In dark the label is dark: an ember lamp with dark text, not a glowing white label |
| `--danger` | `#D98474` | `#B23B2A` | Destructive actions, expired milk |
| `--ok` | `#8DAE87` | `#4A7643` | "Fresh" expiry badges (same hue as diaper; always paired with a clock icon + text) |
| `--warn` | `#C9A064` | `#8F6312` | "Use soon" badges (paired with text) |
| `--scrim` | `rgba(10,7,5,.62)` | `rgba(30,20,14,.46)` | Sheet backdrop at full open |

### 3.2 Category colors

Tint = category color mixed over `--surface` at **16% (dark)** / **13% (light)**. Tints are used for icon wells, running cards and quick-action buttons.

| Category | Dark | Dark tint | Light | Light tint | Paired signal |
|---|---|---|---|---|---|
| Feed (bottle, formula, breast milk, breastfeeding) | `#C9A064` honey | `#3D3225` | `#8F6312` | `#EDE5D6` | bottle / heart icon · "Fed" · **tick** in the strip |
| Sleep | `#9C9AD0` dusk lavender | `#363136` | `#5A58A8` | `#E6E3E9` | moon · "Asleep/Awake" · **block** (night = solid, nap = 55%) |
| Diaper | `#8DAE87` sage | `#33342B` | `#4A7643` | `#E4E7DC` | diaper icon · "Wet/Dirty/Both" · **ring = wet, dot = dirty, dot+ring = both** |
| Pump + Stash | `#C78FA9` mauve | `#3C2F30` | `#9A4A70` | `#EEE1E2` | flange / pouch icon · "Pumped" · **diamond** |
| Milestone / Memory | `#80AABA` slate-sky | `#313433` | `#2D6C84` | `#E0E6E5` | sparkle / camera icon · milestone name |

Hue spacing: accent ≈ 22°, feed ≈ 36°, pump ≈ 332°, sleep ≈ 242°, diaper ≈ 111°, milestone ≈ 197°. Feed and accent sit close together on purpose (both warm). The accent is reserved for *actions* (+, primary, links), and feed for *data*, so the two never meet in the same role.

### 3.3 Contrast, computed (WCAG 2.1 relative luminance)

Computed with a script over the exact hex values used in `mockup.html`. Targets: ≥4.5:1 for body text, ≥3:1 for large text, icons and UI boundaries.

| Pair (fg / bg) | Used for | Light | Dark | Target |
|---|---|---|---|---|
| `text1` / `bg` | Primary text, titles, numerals | #2A231E on #F4EFE7 → **13.51:1** | #DCD0BF on #191512 → **11.94:1** | ≥4.5:1 |
| `text1` / `surface` | Card text / since-last numerals | #2A231E on #FBF8F3 → **14.60:1** | #DCD0BF on #221D19 → **10.99:1** | ≥4.5:1 |
| `text1` / `raised` | Sheet + live pill text | #2A231E on #FFFDF9 → **15.23:1** | #DCD0BF on #2A2420 → **10.07:1** | ≥4.5:1 |
| `text2` / `bg` | Secondary text on page | #655849 on #F4EFE7 → **6.02:1** | #A69989 on #191512 → **6.51:1** | ≥4.5:1 |
| `text2` / `surface` | Card meta, row meta | #655849 on #FBF8F3 → **6.51:1** | #A69989 on #221D19 → **5.99:1** | ≥4.5:1 |
| `text2` / `raised` | Sheet hints, live-pill sub (light) | #655849 on #FFFDF9 → **6.79:1** | #A69989 on #2A2420 → **5.50:1** | ≥4.5:1 |
| `text2` / `fill` | Live-pill sub (dark), neutral badge | #655849 on #E8E0D3 → **5.26:1** | #A69989 on #332C26 → **4.93:1** | ≥4.5:1 |
| `text1` / `fill` | Secondary button label | #2A231E on #E8E0D3 → **11.81:1** | #DCD0BF on #332C26 → **9.04:1** | ≥4.5:1 |
| `text1` / `sunken` | Time chip label | #2A231E on #ECE5DA → **12.36:1** | #DCD0BF on #14110F → **12.37:1** | ≥4.5:1 |
| `text3` / `surface` | Grip/chevron icons, decorative separators (non-text) | #786B5E on #FBF8F3 → **4.88:1** | #8E8275 on #221D19 → **4.45:1** | ≥3:1 |
| `text3` / `bg` | Dashed photo ring (non-text) | #786B5E on #F4EFE7 → **4.52:1** | #8E8275 on #191512 → **4.84:1** | ≥3:1 |
| `accent` / `bg` | Link / back button / active nav icon | #A4552E on #F4EFE7 → **4.68:1** | #CF8C64 on #191512 → **6.56:1** | ≥4.5:1 |
| `accent` / `surface` | Toggle-on track vs card (UI) | #A4552E on #FBF8F3 → **5.06:1** | #CF8C64 on #221D19 → **6.03:1** | ≥3:1 |
| `onaccent` / `accent` | + button, primary button label | #FFF9F3 on #A4552E → **5.13:1** | #1E1713 on #CF8C64 → **6.39:1** | ≥4.5:1 |
| `accentink` / `accent-tint` | "Use next" pill text | #8A4423 on #F0E3D9 → **5.69:1** | #CF8C64 on #3E2F25 → **4.63:1** | ≥4.5:1 |
| `text2` / `sunken` | Time-chip icon, night band labels | #655849 on #ECE5DA → **5.51:1** | #A69989 on #14110F → **6.75:1** | ≥4.5:1 |
| `onaccent` / `accent` | Toggle-on knob (light) vs track | #FFF9F3 on #A4552E → **5.13:1** | #1E1713 on #CF8C64 → **6.39:1** | ≥3:1 |
| `feed` / `surface` | Feed icon on card | #8F6312 on #FBF8F3 → **5.00:1** | #C9A064 on #221D19 → **6.91:1** | ≥3:1 |
| `sleep` / `surface` | Sleep icon on card | #5A58A8 on #FBF8F3 → **5.84:1** | #9C9AD0 on #221D19 → **6.32:1** | ≥3:1 |
| `diaper` / `surface` | Diaper icon on card | #4A7643 on #FBF8F3 → **5.00:1** | #8DAE87 on #221D19 → **6.79:1** | ≥3:1 |
| `pump` / `surface` | Pump icon on card | #9A4A70 on #FBF8F3 → **5.53:1** | #C78FA9 on #221D19 → **6.30:1** | ≥3:1 |
| `milestone` / `surface` | Milestone icon on card | #2D6C84 on #FBF8F3 → **5.52:1** | #80AABA on #221D19 → **6.66:1** | ≥3:1 |
| `feed` / `feed-tint` | Feed icon in tinted well | #8F6312 on #EDE5D6 → **4.24:1** | #C9A064 on #3D3225 → **5.17:1** | ≥3:1 |
| `sleep` / `sleep-tint` | Sleep icon in tinted well / running card | #5A58A8 on #E6E3E9 → **4.87:1** | #9C9AD0 on #363136 → **4.82:1** | ≥3:1 |
| `diaper` / `diaper-tint` | Diaper icon in well | #4A7643 on #E4E7DC → **4.23:1** | #8DAE87 on #33342B → **5.12:1** | ≥3:1 |
| `pump` / `pump-tint` | Pump icon in well | #9A4A70 on #EEE1E2 → **4.60:1** | #C78FA9 on #3C2F30 → **4.83:1** | ≥3:1 |
| `milestone` / `milestone-tint` | Milestone icon in well | #2D6C84 on #E0E6E5 → **4.63:1** | #80AABA on #313433 → **5.02:1** | ≥3:1 |
| `text1` / `sleep-tint` | Numerals on running Sleep card | #2A231E on #E6E3E9 → **12.17:1** | #DCD0BF on #363136 → **8.38:1** | ≥4.5:1 |
| `text2` / `sleep-tint` | Meta on running Sleep card | #655849 on #E6E3E9 → **5.43:1** | #A69989 on #363136 → **4.57:1** | ≥4.5:1 |
| `text1` / `diaper-tint` | Wet/Dirty/Both labels | #2A231E on #E4E7DC → **12.35:1** | #DCD0BF on #33342B → **8.29:1** | ≥4.5:1 |
| `text1` / `ok-tint` | Expiry badge text | #2A231E on #E4E7DC → **12.35:1** | #DCD0BF on #33342B → **8.29:1** | ≥4.5:1 |
| `danger` / `surface` | Destructive text/icon | #B23B2A on #FBF8F3 → **5.58:1** | #D98474 on #221D19 → **5.97:1** | ≥4.5:1 |
| `feed` / `bg` | Timeline-strip feed ticks | #8F6312 on #F4EFE7 → **4.63:1** | #C9A064 on #191512 → **7.51:1** | ≥3:1 |
| `sleep` / `bg` | Timeline-strip sleep blocks | #5A58A8 on #F4EFE7 → **5.40:1** | #9C9AD0 on #191512 → **6.87:1** | ≥3:1 |

Additional computed pairs:

- Photo caption chip: `#FBF3EA` on `rgba(28,20,15,.58)` over the *lightest* placeholder photo (`#F4D9C6`) blends to `#77675C`, which gives **4.93:1**.
- Toggle **off** track (`--fill`) against `--surface` is only 1.24:1 (light) / 1.22:1 (dark). So the off state gets a 1.5px inset `--text-3` ring: **4.88:1 / 4.45:1** ✓. The on track is the accent: 5.06:1 / 6.03:1 against the surface ✓.
- Dark toggle knob (`#DCD0BF`) on the on-track is 1.82:1. That is acceptable because the state is carried by **knob position plus track color** (≥3:1 against the surface), never by the knob alone. The knob is deliberately not white at night.
- `--text-3` is ≥4.45:1 everywhere it appears, but it is **not used for text**. It is kept for glyphs so that it can be dimmed further in a future "deep night" mode without breaking a text pair.

---

## 4. Type scale

Figtree unless noted. `font-variant-numeric: tabular-nums` on **every** time, amount, count and timer.

| Token | Family | Size / line-height | Weight (light → dark) | Use |
|---|---|---|---|---|
| `display-xl` | Figtree tnum | 68 / 1.0, −0.04em | 600 → 570 | Stash total, running timer in a sheet |
| `display-l` | Figtree tnum | 52 / 1.0, −0.03em | 600 → 570 | "Use next" amount |
| `numeral` | Figtree tnum | 42 / 1.0, −0.03em | 600 → 570 | Since-last numbers. Unit glyphs at 20/600 in `text-2` |
| `title-xl` | Fraunces SOFT 100 | 40 / 1.08, −0.02em | 500 → 470 | Onboarding headline |
| `title-l` | Fraunces SOFT 100 | 32 / 1.1, −0.015em | 500 → 470 | Screen titles (Timeline, Stash, Memories) |
| `title-m` | Fraunces SOFT 100 | 24–26 / 1.1 | 500 → 470 | Baby name, sheet title |
| `title-s` | Fraunces SOFT 100 | 21–22 / 1.2 | 500 → 470 | Section headers ("So far today", "Fridge") |
| `headline` | Figtree | 17 / 1.3 | 650 → 620 | Tile labels, buttons, nav-bar title |
| `body-strong` | Figtree | 16 / 1.35 | 600 → 570 | Row titles, live pill |
| `body` | Figtree | 15–16 / 1.45 | 450 | Intro copy |
| `meta` | Figtree | 14 / 1.35 | 450–500 | Row meta, card sub, section meta (always `text-2`) |
| `footnote` | Figtree | 13 / 1.3 | 500–650 | Badges, tile hints, help text |
| `label` | Figtree | 12 / 1.2, +0.01em | 600 | Tab labels, strip axis, legend. **The minimum size anywhere** |

**Night weight shift:** in dark, weights drop by 30 (`--wght-adj:-30`, via the variable axis) to offset light-on-dark halation. Numerals at 570 in the dark read the same as 600 in the light.

---

## 5. Spacing · radii · elevation

**Spacing (4pt grid):** `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`.

- Page gutter is 20, and 24 in onboarding. Card padding is 16 (the top edge of since-last cards is 14 to optically balance the 32px + affordance).
- The grid gap is 12, and 10 inside sheets. Section header top margin is 26 with a 44px minimum height.
- Rows are at least 56–62px tall. Tap targets are **≥44×44**. Toggles are 51×31 visually, with an invisible ::after hit-slop to 55×45.

**Radii:**

| Token | px | Use |
|---|---|---|
| `r-xs` | 8 | small badges |
| `r-sm` | 14 | segmented buttons, photo thumbs |
| `r-md` | 16–18 | inputs, day chips, lifted row |
| `r-lg` | 20 | tiles, list groups |
| `r-xl` | 24 | cards |
| `r-sheet` | 32 | sheet top corners |
| `r-full` | 9999 | pills, buttons, wells, avatar |

**Elevation:** one shadow tier per level, and none in dark.

| Level | Light | Dark |
|---|---|---|
| e0 page | `--bg` | `--bg` |
| e1 card | `--surface` + `0 1px 2px rgba(70,45,25,.05)` | `--surface`, no shadow |
| e2 pill / lifted row | `--raised` + `0 10px 28px -10px rgba(70,45,25,.30)` | `--fill` (live pill) / `--raised` + `0 12px 28px -12px rgba(0,0,0,.7)` |
| e3 sheet | `--raised` + `0 -12px 40px -12px rgba(40,25,15,.35)` | `--raised` over the scrim |

There is no glassmorphism or `backdrop-filter` anywhere. The audit flagged it as a performance and contrast liability.

---

## 6. Layout (390×844 reference)

- **Status bar** 47px (safe-area-inset-top). **Home indicator zone** 34px (safe-area-inset-bottom).
- **Bottom nav** is 64px + 34px safe area, sits on `--bg` with no top border, and has a 96px `--bg` gradient fade above it. Tabs: Today · Timeline · **+** · Stash · Memories, in a `1fr 1fr 84px 1fr 1fr` grid. The + is 60px, raised 6px, accent fill. In dark it has a 6px `--bg` moat and a faint 28px ember glow (the only glow in the system).
- **Live pill** floats 12px above the nav. It is 56px tall, the full width minus the 20px gutters, `r-full`.
- **Today:** header 72px (52px avatar button with a gear badge that opens Settings, then baby name + age/date). Below it a **2×2 since-last grid** of 146px cards with a 12px gap, then "So far today" and the timeline list (newest first). The first scroll position shows all four cards plus 3 rows. The home screen is no longer three screens tall.

---

## 7. Components and states

All components are real `<button>`/`<a>`/`<input>` elements, have **≥44pt hit areas**, and show a focus ring: `outline: 2px solid var(--accent); outline-offset: 3px` (4.68:1 / 6.56:1 against the bg).

| Component | Anatomy | States |
|---|---|---|
| **Button: primary** | 52h (56h block), r-full, `--accent` fill, `--on-accent` label 16/650, optional 20px icon | default · pressed (scale .97, fill darkens 6% light / lightens 6% dark) · focus ring · disabled (`--fill` bg, `--text-3` glyph, label `text-2`) · loading (label swaps to a 3-dot pulse, width locked) |
| **Button: secondary** | `--fill` bg, `text-1` label | same set; pressed bg moves one step toward `--sunken` |
| **Button: ghost** | no bg, `--accent` label (links, nav-bar back) | pressed: `--accent-tint` bg; focus |
| **Button: destructive** | primary shape with a `--danger` fill and `--on-accent` label. Only appears inside a confirm sheet, never as a first tap | default · pressed · focus |
| **QuickLogCard** (since-last) | category icon + label, top-right 32px tinted + affordance, 42px numeral with half-size units, meta line *or* goal bar | idle · **running** (whole card takes the category tint, + becomes a "● Nap" live chip, meta reads "tap to wake") · pressed (scale .98) · overdue (meta turns `--warn` with a clock icon and the text "overdue", never color alone) · hidden (removed via Customize) |
| **Sheet** | `--raised`, r-sheet top, 40×5 grabber, title in Fraunces 24 + optional time chip ("Now · 9:50 ▾") | opening · open · dragging (follows the finger; dismiss past 30% or at velocity >0.5 px/ms) · closing · **morph** (feed → live timer: the amount hero shrinks into the timer header). Focus is trapped, then restored to the trigger |
| **Toast w/ Undo** | 52h `--raised` pill above the live pill / nav, message 15/500 + "Undo" ghost button | enter · idle (5s, paused on touch or focus) · undo pressed → reverts and shows "Restored" · exit. `role=status`, polite |
| **LivePill** | 38px tinted well with a 2px progress ring in the category color, "Bottle · 12:04 · good for 1h 48m", chevron-up | running · warning (at <15 min the sub text reads "use within 14m" in `--warn` with a clock icon) · expired ("Discard bottle" in `--danger` + icon) · **multiple** (stack of 2 → the pill shows "2 running" and expands into a mini-list) |
| **ListRow** | 40px tinted well, title 16/600, meta 14 `text-2`, trailing tnum value. Today's wells sit on a 2px connector line | default · pressed (`--surface` bg) · **live** (2px ring around the well) · **new** (see Motion: slide-in + 1.2s tint wash) · swipe → Delete with Undo toast |
| **Chip** | 44h, r-full, `--sunken` bg, icon + label (time chip, filter chips) | default · selected (`--fill` bg + `text-1` label + check) · focus |
| **SegmentedControl** | 48h buttons in category tint, label 15/650 (Wet / Dirty / Both). Each button **commits** on tap | default · pressed · **committed** (button flashes the category color then the sheet closes into the new row) |
| **NumberStepper** | 56px − / + buttons around a 52px tnum value; long-press repeats; tap the value → numeric keypad sheet of the **same size** (no layout jump) | default · at min/max (button disabled + `text-3`) · editing |
| **Toggle** | 51×31 track, 27px knob, hit-slop 55×45 | off (`--fill` + `--text-3` inset ring) · on (`--accent`, knob right) · focus · disabled |
| **EmptyState** | 64px tinted icon well, title-s, one sentence, one primary action | e.g. Stash empty: "No milk stored yet" + "Add milk" |
| **TimelineStrip** | 4 lanes × 22px (sleep · feed · diaper · pump), lane icons on the left, night band (19:00–07:00) in `--sunken`, 6-hour dashed grid, axis labels 12/600 | default · tap a mark → scrolls the list to that entry and highlights it · today (adds a 2px `--accent` "now" line) |
| **Avatar** | photo circle (44 in the header, 112 in onboarding); in Today a gear badge marks it as the Settings entry | photo · empty (dashed `--text-3` ring + camera + "Add photo") · dimmed at night (brightness .82) |

---

## 8. Motion contract

**Rule:** every surface enters from, and exits back to, the thing that summoned it. Durations are short because a sleepy parent shouldn't wait for animation.

| Token | Value |
|---|---|
| `--dur-1` | 120ms (press, color) |
| `--dur-2` | 200ms (fades, toast) |
| `--dur-3` | 280ms (sheet, tab) |
| `--dur-4` | 420ms (morphs, radial grow) |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` (entrances) |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` (exits) |
| `--ease-spring` | `cubic-bezier(.3,1.3,.5,1)` (≤4% overshoot, sheets only) |

| Interaction | Origin → destination | Spec |
|---|---|---|
| **Sheet open** | from the bottom edge, or from the trigger when it sits at the bottom | `translateY(100%) → 0`, 280ms spring. **Backdrop** fades 0 → scrim alpha over 200ms ease-out, starting at the same time. The page behind scales to .985 (no blur). |
| **Sheet close** | back to its origin | `translateY → 100%`, 220ms ease-in. Backdrop fades in 200ms. `display:none` on `transitionend`. Drag-to-dismiss uses finger velocity. |
| **Quick-log grows from +** | the center of the + button (195, 772) | Sheet `clip-path: circle(30px at 50% calc(100% - 72px)) → circle(150% …)`, 420ms ease-out. The + rotates 45° into × over 280ms **and stays put** as the close button. Tiles fade/translate 8px up, staggered 20ms. Close plays the reverse into the ×, which then rotates back into +. |
| **Express gesture (hold +)** | the + | A radial pad grows from the + center the same way, and collapses into it on release. |
| **Tab switch** | nav order | Moving right (Today → Timeline) slides content 24px left with a cross-fade; moving left reverses. 240ms ease-out. The nav never moves. |
| **Step forward / back** (sheet flows) | — | Forward: outgoing −24px + fade, incoming from +24px. Back mirrors it. 240ms. The sheet height animates to fit (280ms). |
| **Toast** | rises from just above the element it reports on (the live pill or nav) | `translateY(12px) + opacity 0 → 0`, 200ms ease-out. Exits by fading + 8px down, 160ms ease-in. Never from the top of the screen. |
| **New row inserted** | the sheet that created it | After the sheet closes, the list makes room (height 0 → 62, 240ms) and the row slides in from 16px above, then holds a category-tint wash that fades over 1.2s. Today's matching card numeral **counts down to "0m"** (cross-fade per digit, 200ms). |
| **Live pill appear** | the sheet's timer header | When a timer sheet is dismissed, the timer header **shrinks into the pill** (shared-element FLIP, 320ms). If it starts in the background, the pill rises 16px + fades in (240ms). It disappears by collapsing into the + (scale .6 + fade, 200ms). |
| **Theme change** | — | Tokens transition over 600ms. **Never while a sheet is open** (it waits for close). |
| **Timers** | — | Digits swap without motion (tnum, so nothing shifts). `aria-live` announces once per minute at most. |

**Reduced motion** (`prefers-reduced-motion: reduce`): every transform, clip-path and scale is removed. Each surface keeps only an **opacity cross-fade of 120ms**. Sheets appear in place, the backdrop still fades, and the new-row tint wash stays (it is color, not motion) but its duration drops to 600ms. Nothing pulses.

---

## 9. Icons

- 24×24 grid with a 2px safe margin. **1.75px stroke**, round caps and joins, no fills (exceptions: the grip dots and the status bar). Inside a 44px+ button the icon renders at 20–24px. The + and × use a 2.25px stroke.
- One metaphor per category, reused everywhere (card, row, tile, strip lane, Customize): bottle, heart (breastfeed), flange (pump), pouch (stash), moon (sleep), diaper, sparkle (milestone), camera (memory).
- Icons inherit `currentColor`. A category icon takes the category color, and a UI icon takes `text-2`.
- Ship them as one inline SVG `<symbol>` sprite with `<use href>`, so there is no icon font and no network request.
- An icon is never the only label on a primary action. Icon-only buttons (calendar, avatar, chevrons) get an `aria-label`.

---

## 10. Night-mode rules

1. **Warm charcoal only.** No blue-black; every neutral has R > G > B.
2. **Luminance ceiling = `text-1` (#DCD0BF).** No pure white, including toggle knobs, text on photos and the cursor.
3. **One lit object per screen.** At night only the + button (or the single primary action in a sheet) is filled with the accent, and nothing else glows.
4. **Desaturate and dim the categories.** They are pastel-dim, and the brightest category is about 7.5:1 against the bg (enough for 3:1 icons, low enough not to flare).
5. **Weights drop 30** on the variable axes (halation compensation).
6. **Photos at 78% brightness, 85% saturation.** The avatar is at 82%.
7. **Shadows become luminance steps.** The only "glow" is a 28px, 28%-alpha ember halo under the +.
8. **Auto-switch** follows the system or the user's schedule (default 7pm–7am), never while a sheet is open, and uses the 600ms token transition.
9. **Sound is off by default at night.** Use haptics where supported.
10. **Status bar style** is light-content on `--bg`, with `theme-color` set to `#191512`.

---

## 11. Accessibility checklist (built into the components)

- Every text pair in §3.3 passes its target. Unit glyphs are `text-2` at ≥20px (large).
- Every target is at least 44×44, including the + affordance on cards: the **whole card** is the button, and the + is decoration with an `aria-label` on the card.
- State never depends on color alone. Running states use a label ("● Nap"), expiry badges say "3d 17h left", diaper types use shapes, and toggles show position plus a ring.
- Sheets trap focus and return it to the trigger. The live pill is a button that reopens its sheet.
- Timers use `aria-live="polite"` at most once a minute. The live pill's `aria-label` reads the whole sentence.

---

## 12. Privacy surface

- Onboarding screen 1: *"Free. Private. Everything stays on this phone."* plus three proof lines (no account · no ads/analytics · works offline) and "Photo and name never leave this phone."
- Settings → Customize ends with **Privacy & your data**: "On this phone only · 0 network requests". It leads to the plain-language screen in AUDIT §6.8.
- Design constraints that keep this true: self-hosted fonts, an inline SVG sprite, no remote images or embeds, and CSP-compatible styles (in production, move the mockup's inline `style` widths to classes or CSS custom properties set from JS).

---

## 13. Trade-offs and open questions

- **Feed vs accent hue proximity** (36° vs 22°). This is acceptable because their roles never overlap. If judges want more separation, feed could move to a wheat-yellow (≈45°) at the cost of reading less "milky".
- **Live pill on every tab** costs 68px of scroll viewport. The alternative is to fold it into the nav's + (a ring around the +), which is less legible at 3am.
- **"Use next" = oldest frozen pouch** follows the sample data. The production FIFO rule should rank fridge milk that expires before the thaw would finish ahead of frozen milk.
