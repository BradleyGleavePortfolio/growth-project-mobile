# Theme

Single source of truth for colour, typography, spacing, radius, and shadow. Imports from this directory are the only sanctioned way to reach a hex value or a font family in the app.

## Purpose

- Codify the quiet-luxury repositioning. Bone background, ink text, forest accent, mutedGold reserved for founding-tier badges. No saturated brand reds, no high-contrast blues.
- Hold the editorial typography contract. Cormorant Garamond for headlines (weight **400**, never 700/800 — that's the biggest amateur tell). Inter for body and UI.
- Expose two equivalent shapes for compatibility: the legacy flat `Colors` / `Typography` / `Spacing` / `Radius` / `Shadow` named exports and the modern `colors.{text,brand,feedback,border,data,background}` semantic groups. Both are derived from the canonical token set in `tokens.ts`.
- Document WCAG AA pairings inline so a contributor knows which token combinations are safe for body text and which are large-text-only.

## Key files

| File | What it does |
| --- | --- |
| `tokens.ts` | Canonical palette (`bone`, `cream`, `ink`, `charcoal`, `stone`, `forest`, `mutedGold`, `camel`, `oxblood`), neutrals 0–1000, brand scale, semantic colours, gold scale, typography scale, spacing, radius, shadows, motion easings. WCAG matrix in the header. |
| `index.ts` | Re-exports the tokens and the legacy named exports (`Colors`, `Typography`, `Spacing`, `Radius`, `Shadow`, `colors`). New code should import from here or directly from `tokens`. |
| `ThemeProvider.tsx` | React context that exposes the resolved tokens to consumers via `useTheme()`. Used sparingly — most components import the tokens directly. |

## Data flow

```
constants/colors.ts (raw palette)       constants/fonts.ts (font names)
        │                                       │
        ▼                                       ▼
        ┌───────────── theme/tokens.ts ─────────────┐
        │   colors, neutral, brand, semantic, gold,  │
        │   typography, spacing, radius, shadows,    │
        │   motion                                   │
        └───────────────────┬────────────────────────┘
                            │
                            ▼
                    theme/index.ts
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
   Colors / Typography   colors           tokens
   Spacing / Radius      (semantic)       (raw)
   Shadow (legacy)
```

Components are free to choose the ergonomic shape — the underlying values are the same. The legacy shape exists only because round 1 of the rewrite did not want a fleet-wide find/replace; new components prefer `colors.text.primary` over `Colors.dark`.

## Typography scale

| Role | Family | Size / line | Weight | Letter spacing |
| --- | --- | --- | --- | --- |
| `display` | CormorantGaramond_400Regular | 44 / 55 | 400 | 0.4 |
| `h1` | CormorantGaramond_400Regular | 32 / 40 | 400 | 0.6 |
| `h2` | CormorantGaramond_400Regular | 24 / 30 | 400 | 0.5 |
| `h3` | CormorantGaramond_500Medium | 20 / 25 | 500 | 0.4 |
| `body` | Inter_400Regular | 16 / 26 | 400 | -0.16 |
| `label` | Inter_500Medium | 11 / 13 | 500 | 1.98 (uppercase) |
| `caption` | Inter_500Medium | 12 / 18 | 500 | 0.96 |
| `button` | Inter_600SemiBold | 14 / 18 | 600 | 1.2 (uppercase) |
| `tabLabel` / `tabLabelActive` | Inter_400Regular / Inter_500Medium | 11 / 14 | 400 / 500 | -0.2 (B26: "Community" fits one of six tabs at 360 pt) |

Serif roles keep lineHeight at least `SERIF_MIN_LINE_RATIO` (1.25) x fontSize: Cormorant's own line box is 1.211 em, so anything tighter clips descenders on Android (B15). `__tests__/serifLineHeight.test.ts` checks every serif role in `tokens`, `theme/index` and `constants/theme`.

## Radius, layout and wheel (DS-PRIMITIVES-133)

| Token | Value | Used by |
| --- | --- | --- |
| `radius.button` | 12 | `ui/buttons/PrimaryButton` (owner 17:07: rounded, not rectangles) |
| `radius.input` | 12 | text fields, unit tabs, segmented controls |
| `radius.card` | 16 | cards, grouped panels |
| `radius.sheet` | 24 | bottom-sheet and modal top corners |
| `radius.chip` / `radius.pill` | 999 | chips |
| `radius.control` | 6 | boxes under 28 pt (checkbox) |
| `radius.sm/md/lg/xl/2xl`, `Radius.*` | 12/12/16/16/24 | legacy names on the rounded scale (DS-THEME-133); new code names the semantic key |
| `layout` | gutter 24, statusBarGap 12, footer gaps, buttonHeight 54, touchMin 44, rowMinHeight 56, section 18 + 24 | `ui/layout/Screen`, buttons, rows, sections |
| `wheel` | 44 pt rows x 5, hairline band, serif 28 / 21 / 18 | consultation wheels (`ui/wheel/WheelBand`) |

Hairlines: `useTheme().colors.border` and `colors.divider` now equal `semanticColors.border` (#DCD5CC light), so there is one hairline colour; camel stays for the founding-tier cue and `AccentRule` only.

Spacing: `tokens.spacing` (lg 16, xl 24) is canonical; the legacy `Spacing` in `index.ts` (md 16, lg 24, xl 32) shares key names with different values and is deprecated for new code. The primitives use `layout`.

The fonts come from `@expo-google-fonts/cormorant-garamond` and `@expo-google-fonts/inter`. They are loaded by `App.tsx` via `expo-font.useFonts` before the splash screen hides — nothing renders until both families are ready.

## Colour pairings (WCAG AA)

Reproduced from the header of `tokens.ts`. Required ratios: 4.5:1 body, 3:1 large.

| Pair | Ratio | Body | Large |
| --- | --- | --- | --- |
| ink on bone | ≈ 16.5 | pass | pass |
| ink on cream | ≈ 15.2 | pass | pass |
| charcoal on bone | ≈ 8.0 | pass | pass |
| forest on bone | ≈ 7.4 | pass | pass |
| stone on bone | ≈ 2.3 | **fail** | pass — caption / meta only ≥ 18 pt |
| mutedGold on bone | ≈ 2.9 | **fail** | pass — badge label ≥ 14 pt bold only |

## Style C v2 surfaces and chart marks (MOCK-C1V2)

`semanticColors.surface`, `semanticColors.data` and `textOnMastheadMuted` hold the Style C v2 roles from index-v2 section 4. Light values are exactly that table; no value failed its own contrast row. Dark keeps the masthead, forest band, leaf greens, gold and on-dark marks (they were drawn for a dark ground) and moves the light-ground roles: `surface.sage` #17211A, `surface.sageLine` #2A3A2F, `data.forest` #527A5E, `data.peakInk` gold.300, `data.missed` #A09B94, `data.trackLight` #24221F. The shared parts that draw them are in `ui/charts/StyleCMarks.tsx` (docs/charting.md).

1. Leaf and fern are for dark ground, or as fills with a moss edge. Never use them as text or as a lone mark on bone or cream.
2. Gold (`data.peak`, gold.300) means a personal best, nothing else. On light ground it always has the `data.peakInk` outline, and it always comes with a star and the words.
3. Solid colours only: no gradients, glow, shimmer or shadow on charts.
4. One forest primary button per screen. Leaf is never a button colour.

The `ui/charts` parts' `onDark` marks are for `surface.masthead` only; on `surface.forestBand` plannedOnDark (2.89) and missedOnDark as text (4.19) fail, so the rest band uses leaf marks only.

WCAG 2.x pairs, locked by `__tests__/contrastStyleC.test.ts` in both schemes (text 4.5:1, marks 3:1). `ink` is `colors.ink` in both schemes; charcoal on sage (8.91) is light only.

| Use | Pair | Light | Dark | Needs |
| --- | --- | --- | --- | --- |
| Masthead secondary text | `textOnMastheadMuted` on `surface.masthead` | 8.30 | 8.30 | text 4.5 |
| Masthead primary text | `textOnAccent` on `surface.masthead` | 13.14 | 13.14 | text 4.5 |
| Seen by Sam, done arcs and discs, today ring | `data.leaf` on `surface.masthead` | 7.12 | 7.12 | text 4.5 |
| Missed ring and number | `data.missedOnDark` on `surface.masthead` | 6.00 | 6.00 | text 4.5 |
| Best ever label and star | `data.peak` on `surface.masthead` | 7.32 | 7.32 | text 4.5 |
| Planned arcs and rings | `data.plannedOnDark` on `surface.masthead` | 4.13 | 4.13 | mark 3 |
| Error card edge | `colors.warningBg` on `surface.masthead` | 12.58 | 12.58 | mark 3 |
| Rest band text | `textOnAccent` on `surface.forestBand` | 9.19 | 9.19 | text 4.5 |
| Rest band secondary text | `textOnMastheadMuted` on `surface.forestBand` | 5.81 | 5.81 | text 4.5 |
| Rest ring, done chip check | `data.leaf` on `surface.forestBand` | 4.98 | 4.98 | mark 3 |
| Sage card text | `textPrimary` on `surface.sage` | 14.25 | 13.32 | text 4.5 |
| Sage card captions | `textMuted` on `surface.sage` | 4.60 | 6.00 | text 4.5 |
| +20 lb, Changed by Sam | `accentText` on `surface.sage` | 8.03 | 5.41 | text 4.5 |
| Done set disc, up icon | `data.forest` on `surface.sage` | 8.03 | 3.39 | mark 3 |
| Sparkline | `data.moss` on `surface.sage` | 4.11 | 3.29 | mark 3 |
| Todo border | `data.planned` on `surface.sage` | 3.25 | 4.17 | mark 3 |
| Gold point outline | `data.peakInk` on `surface.sage` | 6.23 | 8.63 | mark 3 |
| Check in a leaf disc, effort 1-2 | `ink` on `data.leaf` | 8.85 | 8.85 | text 4.5 |
| Effort 3-4 | `ink` on `data.fern` | 6.21 | 6.21 | text 4.5 |
| Effort 5-6 | `textOnAccent` on `data.moss` | 4.70 | 4.70 | text 4.5 |
| Effort 7-8, check in a done disc | `textOnAccent` on `data.forest` | 9.19 | 4.57 | text 4.5 |
| Effort 9-10 | `textOnAccent` on `data.deep` | 13.14 | 13.14 | text 4.5 |
| Progress bar fill | `data.forest` on `data.trackLight` | 7.41 | 3.25 | mark 3 |
| Missed number on the page | `data.missed` on `bgPrimary` / `bgSurface` | 4.92 / 5.54 | 6.84 / 6.29 | text 4.5 |
| Done arcs, selected ring | `data.forest` on `bgPrimary` / `bgSurface` | 8.57 / 9.65 | 3.87 / 3.56 | mark 3 |
| Moss lines, dots, chip edges | `data.moss` on `bgPrimary` / `bgSurface` | 4.39 / 4.94 | 3.75 / 3.45 | mark 3 |
| Planned arcs, unfilled chips | `data.planned` on `bgPrimary` / `bgSurface` | 3.47 / 3.91 | 4.75 / 4.37 | mark 3 |
| Star outline | `data.peakInk` on `bgPrimary` / `bgSurface` | 6.65 / 7.49 | 9.84 / 9.05 | mark 3 |

Decorative, no ratio needed: `surface.sageLine`, `data.trackLight`, and the gold star fill on bone (1.68; the outline carries it).

## App-store / deep-link dependencies

- Splash background and android adaptive icon background must match `bone` (`#F5EFE4`). Both are declared in `app.json` (`expo.splash.backgroundColor` and `expo.android.adaptiveIcon.backgroundColor`).
- Listing screenshots are taken on the active palette; if the palette changes, the screenshots in the Play / App Store listing have to be regenerated.

## Security and tenancy

Not applicable. The theme has no runtime side effects beyond rendering.

## Environment variables

None.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Headlines render in a fallback sans-serif | Cormorant didn't load before the splash hid | Check `App.tsx` font loading; ensure both families are in the `useFonts` call. |
| A new component looks "off" — flatter shadows, sharper radii | The component imported from `react-native` defaults instead of the theme | Replace with `Radius.lg` / `Shadow.card` etc. There should be no inline `borderRadius: 12` in the codebase. |
| Buttons look chunky | Component used `fontWeight: '700'` instead of `Typography.button.fontWeight` (`600`) | Always import the typography token. Manual weights drift quickly. |

## Tests

`__tests__/contrastTokens.test.ts` and `__tests__/contrastStyleC.test.ts` lock the contrast pairs; the rest is a pure data module. Visual regression is covered by manual review in the smoke matrix. Run typecheck to ensure no consumer is using a removed token:

```bash
npm run typecheck
```

## Release notes

- No new fonts were added in the most recent wave; if a future release introduces one, it must come through `@expo-google-fonts` so EAS Build can bundle it without a manual asset step.
- The legacy `Colors.white` is mapped to `bone` (not `#FFFFFF`). Anything that visually needs pure white should use `neutral[0]` and explain why in a comment.
- `mutedGold` is reserved for founding-tier badge typography and the camel hairline. Using it as a fill is the fastest way to make the app look like a 2014 fitness product. If a designer asks for "more gold", push back. Style C v2 does not use mutedGold: it uses gold.300 (`data.peak`) as a small mark for personal bests only, never as a fill behind text.
