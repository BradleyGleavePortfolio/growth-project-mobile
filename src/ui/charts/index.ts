/**
 * src/ui/charts — TGP chart component library.
 *
 * All chart wrappers use react-native-svg + react-native-reanimated for
 * 60 fps rendering.  Pan/tap gestures are wired via react-native-gesture-handler.
 *
 * Victory Native XL (D3 + Skia) is the intended charting engine.  Due to a
 * peer-dependency conflict between @shopify/react-native-skia v2.x (bundled by
 * Expo SDK 55) and victory-native v41's requirement for Skia v1, the wrappers
 * currently use react-native-svg as a drop-in SVG fallback.  The public API is
 * identical — swap the internals once victory-native ships Skia-v2 support.
 * See docs/charting.md §Skia conflict for full details.
 *
 * Exports:
 *   TgpLineChart   — Trend line with pan tooltip
 *   TgpBarChart    — Vertical bar chart with tap tooltip
 *   TgpAreaChart   — Filled area chart with pan tooltip
 *   TgpSparkline   — Inline micro-chart for card surfaces
 */

export { default as TgpLineChart }  from './TgpLineChart';
export type { TgpLineChartProps }   from './TgpLineChart';

export { default as TgpBarChart }   from './TgpBarChart';
export type { TgpBarChartProps }    from './TgpBarChart';

export { default as TgpAreaChart }  from './TgpAreaChart';
export type { TgpAreaChartProps }   from './TgpAreaChart';

export { default as TgpSparkline }  from './TgpSparkline';
export type { TgpSparklineProps }   from './TgpSparkline';

// Re-export the shared data type used by all chart variants
export type { ChartDataPoint }      from './TgpLineChart';
