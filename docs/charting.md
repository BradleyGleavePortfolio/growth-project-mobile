# Charting Convention Guide

This document defines when to use each chart variant, the theming rules, and performance notes for the TGP chart library (`src/ui/charts`).

**Owner rule (10-15): lines or bars only.** No chart draws a filled area,
gradient under a line, or glow. Use forest as the lead on the tan base; the
gold flare (`CHART_FLARE`, gold 700) marks the latest or scrubbed mark or a
record. Keep scrub/tap inspection. Colour-coded neighbours (sleep stages, the
coach deviation band, a flare beside forest) touch at 3:1 or more, or sit apart
on a card gap or ring with each mark 3:1 on the card; `tgpCharts.test.tsx`
walks every such chart.

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

### C8 v2 weight plot (C8V2-2A)

`TgpLineChart.plot` composes custom SVG layers and an optional native-text overlay
with shared measured axes, nearest-day long-press exploration and adjustable
screen-reader actions. Default plots retain their existing rendering and gestures.
The weight consumer adds a decorative upper/lower range ribbon, not a baseline
fill. Single readings remain dots, while the trend begins with the second reading.
Keep full history before period filtering: the 0.1 update runs on weigh-in days
only, and three missing days cause a dashed carry rather than a fabricated change.
Week uses whole-pound ticks; other weight views use two-pound ticks. Fewer labels
at 130% retain that scale. Period changes fade 150 ms and their underline slides
200 ms; both are instant with Reduce Motion.
The caller gates the dark variant with clientProgressV2, off by default.

### TgpBarChart

**Use for:** Discrete categorical comparisons (e.g. weekly session counts, macro group totals).

**When to choose it:**
- Data is categorical or grouped (one bar per category).
- Absolute magnitude per category matters as much as relative differences.

**When NOT to use it:**
- Time-series data with many points — use TgpLineChart.
- Inline cards — use TgpSparkline.

---

### TgpAreaChart

Legacy export retained for compatibility. It now draws an unfilled line and
keeps its existing pan tooltip, axes, labels and empty state. Prefer
TgpLineChart for new continuous trends and TgpBarChart for daily totals.

### Wearable charts

`RevolutGlowChart` is also a legacy name, not a visual treatment: forest
line/bars, the latest bar or line end in the gold flare, and a gold tracking dot
(bone ring) that moves the flare to the scrubbed day; no area or halo. MetricDetailScreen
uses bars for day-bucketed sum metrics and a line for other readings;
FitnessTrendCard uses bars for sum metrics (steps on Health & Fitness).
HRV remains a line. Scrubbing still snaps once per day crossed and clears
the selected readout on release; Reduce Motion snaps the dot instantly.
Heart and Body use the shared unfilled TgpSparkline in forest.
ProgressChartCard keeps its forest line and one gold record star, with no halo.

---

### TgpSparkline

**Use for:** Inline micro-charts inside stat cards, list rows, or header tiles.

**Rules:**
- No labels, no axes, no tooltips — purely momentum/direction cue.
- Maximum width: 120 px. Recommended: 60–80 px.
- Never use as a standalone chart; always pair with a numeric label adjacent to it.
- A single unfilled line; no area behind it.

---

### Style C v2 marks (`StyleCMarks.tsx`)

`SegmentedRing` (one segment per planned session: done thick, planned thin, missed dashed, 10° gaps, centre content from the caller), `DayMark` (done disc with a check, today thick ring, planned thin ring, missed dashed ring, rest number only) and `PeakStar` (gold.300 star, peakInk outline on light ground).

**Rules:**
- They read `semanticColors.data`. Grounds: light (page, white and sage cards) by default; `onDark` on `surface.masthead` (Today, Summary, the History "This week" card, the Best ever and star tiles); `onBand` on `surface.forestBand` (the rest band): `SegmentedRing` with done segments only, in leaf (4.98:1). Planned (2.89:1) and the missed number (4.19:1) fail on the band, so the ring's types refuse them there, and DayMark and PeakStar are not drawn there.
- The caller passes every spoken label (approved wording only). `PeakStar` without a label is hidden from screen readers, so use it beside the words.
- Motion plays once per real event. The caller passes `event`, one key per confirmation (e.g. the sent workout's id), from the tap that confirms it, never derived from stored data. The first time a part gets a new key it plays; a key already played this session mounts drawn, so returning to a confirmed workout never replays it. The ring draws its done `drawIndex` segment in 300 ms (decel); Reduce Motion shows it whole with a 150 ms fade. DayMark's new state and PeakStar fade in over 200 ms, instant with Reduce Motion. No scale, bounce or glow.
- Haptics: the parts fire none. The Send to Sam tap that passes the `event` fires `HapticService.success()` once, so the draw and the haptic are one confirmation.
- DayMark numbers cap at 130% text so a seven-day strip fits 360 pt; the label carries the date.

---

## Theming rules

All chart wrappers read colors from `useTheme().colors` (ThemeProvider). This ensures they automatically adapt to free/founder tier overrides and any future dark-mode support.

| Element               | Token                      | Fallback value |
|-----------------------|----------------------------|---------------|
| Line / bar fill       | `colors.primary`           | `#2C4A36`     |
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
2. Replace the `react-native-svg` render internals in each `Tgp*` wrapper with the equivalent Victory Native XL component (`CartesianChart`, `Line`, `Bar`), keeping the no-area/no-gradient/no-glow rule.
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
