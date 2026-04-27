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
| `display` | CormorantGaramond_400Regular | 44 / 46 | 400 | 0.4 |
| `h1` | CormorantGaramond_400Regular | 32 / 35 | 400 | 0.6 |
| `h2` | CormorantGaramond_400Regular | 24 / 29 | 400 | 0.5 |
| `h3` | CormorantGaramond_500Medium | 20 / 24 | 500 | 0.4 |
| `body` | Inter_400Regular | 16 / 26 | 400 | -0.16 |
| `label` | Inter_500Medium | 11 / 13 | 500 | 1.98 (uppercase) |
| `caption` | Inter_500Medium | 12 / 18 | 500 | 0.96 |
| `button` | Inter_600SemiBold | 14 / 18 | 600 | 1.2 (uppercase) |

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

There are no unit tests for the theme — it's a pure data module. Visual regression is covered by manual review in the smoke matrix. Run typecheck to ensure no consumer is using a removed token:

```bash
npm run typecheck
```

## Release notes

- No new fonts were added in the most recent wave; if a future release introduces one, it must come through `@expo-google-fonts` so EAS Build can bundle it without a manual asset step.
- The legacy `Colors.white` is mapped to `bone` (not `#FFFFFF`). Anything that visually needs pure white should use `neutral[0]` and explain why in a comment.
- `mutedGold` is reserved for founding-tier badge typography and the camel hairline. Using it as a fill is the fastest way to make the app look like a 2014 fitness product. If a designer asks for "more gold", push back.
