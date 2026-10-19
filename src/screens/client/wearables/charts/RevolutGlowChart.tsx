/**
 * RevolutGlowChart — legacy name for the shared line/bar scrubber.
 *
 * A draggable thumb scrubs across a timeline; the selected datum lifts above
 * a clean forest line or daily-total bars. No area, gradient or glow. The
 * latest (or scrubbed) mark takes the gold flare, set apart by a gap or bone ring.
 *
 * Performance contract (#11 — NO jank):
 *   - The thumb position is driven by Reanimated SHARED VALUES on the
 *     UI thread via `useAnimatedStyle`. We do NOT call `setState` on every
 *     gesture frame — that would marshal a JS round-trip per finger movement
 *     and drop frames.
 *   - React state changes ONLY when the snapped DAY index changes (at most
 *     once per day-column crossed), via a `runOnJS` callback guarded by a
 *     shared "last emitted index" value. A 90-point drag emits ≤90 JS calls
 *     total, not one per frame.
 *
 * Accessibility / reduce-motion (#50 graceful degradation):
 *   - `reduceMotion` (passed in) makes the thumb snap instantly.
 *     The chart STILL renders and stays
 *     fully scrubbable; we never hide data behind an animation.
 *   - Haptic selection feedback fires on snap-to-day, gated behind an
 *     availability check so it fails closed on web (no throw).
 *
 * This primitive renders ONLY the line/bars + thumb. The caller supplies the
 * data and renders its own header / selected-value readout (so the readout can
 * live outside the SVG and use the app's typography).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Path,
  Rect,
  Line as SvgLine,
} from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, withAlpha } from '../../../../theme/tokens';
import { CHART_FLARE as FLARE, type BucketTone } from '../wearablesTheme';
import { smoothLinePath, type PathPoint } from './smoothPath';

export interface GlowChartPoint {
  /** X position is implicit (even spacing by index); Y is the metric value. */
  readonly value: number;
  /** ISO label for the selected-day readout (the caller formats it). */
  readonly label: string;
}

export interface RevolutGlowChartProps {
  readonly data: readonly GlowChartPoint[];
  readonly tone: BucketTone;
  readonly height?: number;
  readonly reduceMotion: boolean;
  /** Bars for daily totals; lines for point-in-time and averaged metrics. */
  readonly variant?: 'line' | 'bar';
  /**
   * Called when the scrubber snaps to a new day index. Index is into `data`.
   * `null` means the scrubber was released / there is no selection.
   */
  readonly onSelect?: (index: number | null) => void;
  readonly accessibilityLabel?: string;
}

const PAD_X = 8;
const PAD_Y = 14;

/** Fire selection haptic, gated so it never throws on web/unsupported. */
function selectionHaptic(): void {
  // expo-haptics' selectionAsync resolves a Promise; on web it rejects rather
  // than throwing synchronously. We attach a no-op rejection handler so an
  // unsupported platform degrades silently to "no haptic" WITHOUT an unhandled
  // rejection — this is the one place a caught error is intentionally a no-op
  // because a missing haptic motor is not a user-facing failure (documented).
  Haptics.selectionAsync().catch(() => {
    /* haptics unavailable on this platform — non-fatal, intentionally ignored */
  });
}

export function RevolutGlowChart({
  data,
  height = 120,
  reduceMotion,
  variant = 'line',
  onSelect,
  accessibilityLabel = 'Interactive trend chart',
}: RevolutGlowChartProps) {
  const width = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const thumbY = useSharedValue(0);
  const active = useSharedValue(0);
  // Tracks the last day-index we emitted to JS so we only cross-thread when the
  // snapped column actually changes (NOT every gesture frame).
  const lastIndex = useSharedValue(-1);
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      width.value = e.nativeEvent.layout.width;
    },
    [width],
  );

  // Geometry — recomputed only when data changes, not per frame.
  const { minY, rangeY, count } = useMemo(() => {
    if (data.length === 0) {
      return { minY: 0, rangeY: 1, count: 0 };
    }
    const ys = data.map((d) => d.value);
    const lo = variant === 'bar' ? 0 : Math.min(...ys);
    const hi = variant === 'bar' ? Math.max(1, ...ys) : Math.max(...ys);
    const range = hi - lo || 1;
    return { minY: lo, rangeY: range, count: data.length };
  }, [data, variant]);

  const plotH = height - PAD_Y * 2;

  const handleSelectIndex = useCallback(
    (index: number | null) => {
      if (index !== null) selectionHaptic();
      setSelected(index);
      onSelect?.(index);
    },
    [onSelect],
  );

  // Map a touch X (worklet) to a snapped day index.
  const indexForX = useCallback(
    (x: number): number => {
      'worklet';
      if (count <= 1) return 0;
      const usable = Math.max(1, width.value - PAD_X * 2);
      if (variant === 'bar') {
        return Math.min(count - 1, Math.max(0, Math.floor((x - PAD_X) / usable * count)));
      }
      const ratio = Math.min(1, Math.max(0, (x - PAD_X) / usable));
      return Math.round(ratio * (count - 1));
    },
    [count, width, variant],
  );

  const applyIndex = useCallback(
    (index: number) => {
      'worklet';
      if (count === 0) return;
      const usable = Math.max(1, width.value - PAD_X * 2);
      const ratio = variant === 'bar' ? (index + 0.5) / count : count <= 1 ? 0.5 : index / (count - 1);
      const x = PAD_X + ratio * usable;
      const value = data[index]?.value ?? minY;
      const y = PAD_Y + plotH - ((value - minY) / rangeY) * plotH;
      // Restrained tracking; instant when reduce-motion is on.
      if (reduceMotion) {
        thumbX.value = x;
        thumbY.value = y;
      } else {
        thumbX.value = withTiming(x, { duration: 120 });
        thumbY.value = withTiming(y, { duration: 120 });
      }
      if (index !== lastIndex.value) {
        lastIndex.value = index;
        runOnJS(handleSelectIndex)(index);
      }
    },
    [
      count,
      data,
      minY,
      rangeY,
      plotH,
      reduceMotion,
      thumbX,
      thumbY,
      lastIndex,
      handleSelectIndex,
      width,
      variant,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          'worklet';
          active.value = 1;
          applyIndex(indexForX(e.x));
        })
        .onUpdate((e) => {
          'worklet';
          applyIndex(indexForX(e.x));
        })
        .onFinalize(() => {
          'worklet';
          active.value = 0;
          lastIndex.value = -1;
          runOnJS(handleSelectIndex)(null);
        }),
    [applyIndex, indexForX, active, lastIndex, handleSelectIndex],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [
      { translateX: thumbX.value - THUMB / 2 },
      { translateY: thumbY.value - THUMB / 2 },
    ],
  }));

  // Line/bars in a 0..100 normalized coordinate space (the Svg uses
  // viewBox="0 0 100 100" + preserveAspectRatio="none", so the path stretches
  // to the measured container width without us reading width.value on the JS
  // thread). `vectorEffect="non-scaling-stroke"` keeps the stroke crisp despite
  // the non-uniform scale. The monotone line never invents an overshoot.
  const points = useMemo(() => {
    const pts: PathPoint[] = data.map((d, i) => {
      const xRatio = variant === 'bar' ? (i + 0.5) / count : count <= 1 ? 0.5 : i / (count - 1);
      const x = xRatio * 100;
      const y =
        ((PAD_Y + plotH - ((d.value - minY) / rangeY) * plotH) / height) * 100;
      return { x, y };
    });
    return pts;
  }, [data, count, minY, rangeY, plotH, height, variant]);
  const linePath = useMemo(() => smoothLinePath(points), [points]);
  const baseline = variant === 'bar' ? (height - PAD_Y) / height * 100 : 99;
  const flare = selected ?? count - 1;

  return (
    <View
      style={[styles.container, { height }]}
      onLayout={onLayout}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={{ marginHorizontal: PAD_X, height: '100%' }}>
            <Svg
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              pointerEvents="none"
            >
              {variant === 'bar' ? points.map((point, i) => (
                <Rect
                  key={i}
                  x={point.x - 30 / count}
                  y={point.y}
                  width={60 / count}
                  height={baseline - point.y}
                  fill={i === flare ? FLARE : colors.forest}
                />
              )) : count > 1 ? (
                <Path
                  d={linePath}
                  fill="none"
                  stroke={colors.forest}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {/* baseline hairline */}
              <SvgLine
                x1="0"
                y1={baseline}
                x2="100"
                y2={baseline}
                stroke={withAlpha(colors.ink, 0.06)}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
            </Svg>
            {variant === 'line' && selected === null && count > 0 ? (
              <View
                testID="chart-latest-mark"
                style={[styles.mark, { left: `${points[flare].x}%`, top: `${points[flare].y}%` }]}
              />
            ) : null}
          </View>

          {/* The draggable thumb. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: FLARE,
                borderColor: colors.bone,
              },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

export default RevolutGlowChart;

const THUMB = 12;
const MARK = 10;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 2,
  },
  mark: {
    position: 'absolute',
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    marginLeft: -MARK / 2,
    marginTop: -MARK / 2,
    borderWidth: 2,
    borderColor: colors.bone,
    backgroundColor: FLARE,
  },
});
