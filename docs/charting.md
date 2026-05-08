# Charting Convention Guide

This document defines when to use each chart variant, the theming rules, and performance notes for the TGP chart library (`src/ui/charts`).

---

## Chart variants

### TgpLineChart

**Use for:** Continuous trends over time (e.g. weight history, macro adherence over 30 days).

**When to choose it:**
- Data has 5 or more points ordered by date or index.
- The trend direction (up/down) is the primary signal.
- The user may want to inspect individual values via pan gesture.

**When NOT to use it:**
- Fewer than 2 data points (component renders an empty state automatically).
- Categorical comparisons — use TgpBarChart instead.

---

### TgpBarChart

**Use for:** Discrete categorical comparisons (e.g. weekly session counts, macro group totals).

**When to choose it:**
- Data is categorical or grouped (one bar per category).
- Absolute magnitude per category matters as much as relative differences.

**When NOT to use it:**
- Time-series data with many points — use TgpLineChart or TgpAreaChart.
- Inline cards — use TgpSparkline.

---

### TgpAreaChart

**Use for:** Trends where the volume under the curve carries meaning (e.g. cumulative calories, step count accumulation).

**When to choose it:**
- The "total area" metaphor reinforces the data story.
- Pan gesture cross-hair is useful for exploration.

**When NOT to use it:**
- Datasets where the filled region causes visual clutter (overlapping series).

---

### TgpSparkline

**Use for:** Inline micro-charts inside stat cards, list rows, or header tiles.

**Rules:**
- No labels, no axes, no tooltips — purely momentum/direction cue.
- Maximum width: 120 px. Recommended: 60–80 px.
- Never use as a standalone chart; always pair with a numeric label adjacent to it.

---

## Theming rules

All chart wrappers read colors from `useTheme().colors` (ThemeProvider). This ensures they automatically adapt to free/founder tier overrides and any future dark-mode support.

| Element               | Token                      | Fallback value |
|-----------------------|----------------------------|---------------|
| Line / bar fill       | `colors.primary`           | `#2C4A36`     |
| Area fill             | `colors.primaryPale`       | `#D6E4DA`     |
| Grid lines            | `colors.border`            | `#B08D57`     |
| Axis labels           | `colors.textMuted`         | `#B1A89F`     |
| Tooltip background    | `#F5EFE4` (bone — hardcoded) | —           |
| Tooltip text          | `#1A1A18` (ink — hardcoded)  | —           |
| Tooltip border        | `#4A0404` (oxblood — hardcoded) | —        |

**Why are tooltip colors hardcoded?**  
The Quiet Luxury tooltip treatment (bone/ink/oxblood) is a design constant — it must remain consistent regardless of tier overrides. The three token values are design primitives, not semantic roles.

**themeOverride prop:**  
All chart components accept a `themeOverride?: Partial<ThemeColors>` prop for one-off overrides (e.g. using `colors.carbs` as the line color on a macro breakdown chart). Prefer passing a `color` prop on TgpSparkline for simpler cases.

**No hardcoded colors anywhere else.** If a new semantic color is needed, add it to `src/constants/colors.ts` and `ThemeProvider` first.

---

## Skia conflict — status and upgrade path

**Current state:** The wrappers in `src/ui/charts` use `react-native-svg` as the rendering backend, not Victory Native XL / Skia. This is a deliberate fallback due to a peer-dependency conflict:

- Expo SDK 55 bundles `@shopify/react-native-skia` v2.x (requires React Native >= 0.79).
- `victory-native` v41 (the XL rewrite) declares a peer dependency of `@shopify/react-native-skia >=1.2.3` but the v41 package was written against the v1 API surface. The v2 module exports are incompatible.
- Attempting to install both results in `npm error ERESOLVE` during `npm ci`.

**Upgrade path (when victory-native ships Skia-v2 support):**
1. Run `npx expo install victory-native @shopify/react-native-skia`.
2. Replace the `react-native-svg` render internals in each `Tgp*` wrapper with the equivalent Victory Native XL component (`CartesianChart`, `Line`, `Area`, `Bar`).
3. The public props interface (`data`, `height`, `themeOverride`) stays identical — screens importing from `src/ui/charts` need no changes.
4. Remove the `react-native-svg` fallback comments.

See GitHub issue: https://github.com/FormidableLabs/victory-native-xl/issues/616

---

## Performance notes

### SVG path (current)
- Rendered on the JS thread via `react-native-svg`.
- Suitable for charts with up to ~200 data points.
- Pan gesture uses `Gesture.Pan().runOnJS(true)` — tooltip state updates synchronously on JS thread, which may cause a one-frame lag on older devices.
- For a smoother experience before Skia is available, limit displayed points (the period selector in ProgressScreen already does this).

### Skia path (future)
- Rendered on the UI thread via Fabric + Skia Canvas.
- Targets 60 fps on mid-range devices.
- Pan gesture can run on the worklet thread without `runOnJS`.
- Enable by replacing internals as described in the upgrade path above.

### General rules
- Never nest a chart inside a `FlatList` row without a fixed `height` prop.
- For `TgpSparkline`, keep `data.length` under 30 points; resample on the server if needed.
- Use `useMemo` on chart data derivations upstream (the wrappers memo internally, but avoid re-creating the `data` array on every render in the parent).
