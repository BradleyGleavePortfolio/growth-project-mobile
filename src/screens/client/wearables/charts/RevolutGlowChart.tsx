/**
 * RevolutGlowChart — the glow-drag chart primitive (brief §4.2, _uiux_paper
 * "Revolut Playbook").
 *
 * A draggable thumb scrubs across a timeline; the selected datum lifts above
 * the line with a soft glow. Reusable for both buckets via the `tone` prop
 * (`warm` = H&F clay/amber, `cool` = S&R forest).
 *
 * Performance contract (#11 — NO jank):
 *   - The thumb position + glow are driven by Reanimated SHARED VALUES on the
 *     UI thread via `useAnimatedStyle`. We do NOT call `setState` on every
 *     gesture frame — that would marshal a JS round-trip per finger movement
 *     and drop frames.
 *   - React state changes ONLY when the snapped DAY index changes (at most
 *     once per day-column crossed), via a `runOnJS` callback guarded by a
 *     shared "last emitted index" value. A 90-point drag emits ≤90 JS calls
 *     total, not one per frame.
 *
 * Accessibility / reduce-motion (#50 graceful degradation):
 *   - `reduceMotion` (passed in) disables the glow shadow and the thumb's
 *     spring — the thumb snaps instantly. The chart STILL renders and stays
 *     fully scrubbable; we never hide data behind an animation.
 *   - Haptic selection feedback fires on snap-to-day, gated behind an
 *     availability check so it fails closed on web (no throw).
 *
 * This primitive renders ONLY the line + thumb + glow. The caller supplies the
 * data and renders its own header / selected-value readout (so the readout can
 * live outside the SVG and use the app's typography).
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
  Line as SvgLine,
} from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, withAlpha } from '../../../../theme/tokens';
import { toneTokens, type BucketTone } from '../wearablesTheme';
import { smoothAreaPath, smoothLinePath, type PathPoint } from './smoothPath';

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
  tone,
  height = 120,
  reduceMotion,
  onSelect,
  accessibilityLabel = 'Interactive trend chart',
}: RevolutGlowChartProps) {
  const toneTk = toneTokens(tone);
  const width = useSharedValue(0);
  const thumbX = useSharedValue(0);
  const thumbY = useSharedValue(0);
  const glowOpacity = useSharedValue(0);
  // Tracks the last day-index we emitted to JS so we only cross-thread when the
  // snapped column actually changes (NOT every gesture frame).
  const lastIndex = useSharedValue(-1);

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
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const range = hi - lo || 1;
    return { minY: lo, rangeY: range, count: data.length };
  }, [data]);

  const plotH = height - PAD_Y * 2;

  const handleSelectIndex = useCallback(
    (index: number | null) => {
      if (index !== null) selectionHaptic();
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
      const ratio = Math.min(1, Math.max(0, (x - PAD_X) / usable));
      return Math.round(ratio * (count - 1));
    },
    [count, width],
  );

  const applyIndex = useCallback(
    (index: number) => {
      'worklet';
      if (count === 0) return;
      const usable = Math.max(1, width.value - PAD_X * 2);
      const x = PAD_X + (count <= 1 ? 0 : (index / (count - 1)) * usable);
      const value = data[index]?.value ?? minY;
      const y = PAD_Y + plotH - ((value - minY) / rangeY) * plotH;
      // Spring for polish; instant when reduce-motion is on.
      if (reduceMotion) {
        thumbX.value = x;
        thumbY.value = y;
      } else {
        thumbX.value = withSpring(x, { damping: 18, stiffness: 220 });
        thumbY.value = withSpring(y, { damping: 18, stiffness: 220 });
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
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          'worklet';
          glowOpacity.value = reduceMotion ? 0 : withTiming(0.6, { duration: 120 });
          applyIndex(indexForX(e.x));
        })
        .onUpdate((e) => {
          'worklet';
          applyIndex(indexForX(e.x));
        })
        .onFinalize(() => {
          'worklet';
          glowOpacity.value = reduceMotion ? 0 : withTiming(0, { duration: 200 });
          lastIndex.value = -1;
          runOnJS(handleSelectIndex)(null);
        }),
    [applyIndex, indexForX, glowOpacity, reduceMotion, lastIndex, handleSelectIndex],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: thumbX.value - THUMB / 2 },
      { translateY: thumbY.value - THUMB / 2 },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [
      { translateX: thumbX.value - GLOW / 2 },
      { translateY: thumbY.value - GLOW / 2 },
    ],
  }));

  // Line + area paths in a 0..100 normalized coordinate space (the Svg uses
  // viewBox="0 0 100 100" + preserveAspectRatio="none", so the path stretches
  // to the measured container width without us reading width.value on the JS
  // thread). `vectorEffect="non-scaling-stroke"` keeps the stroke crisp despite
  // the non-uniform scale. We render a MONOTONE-CUBIC bezier (smoothPath) over
  // a soft gradient area fill — the Revolut peak-moment treatment (Mobile
  // Design Intel doc), replacing the prior tutorial-grade <Polyline>.
  const { linePath, areaPath } = useMemo(() => {
    if (count < 2) return { linePath: '', areaPath: '' };
    const pts: PathPoint[] = data.map((d, i) => {
      const xRatio = count <= 1 ? 0 : i / (count - 1);
      const x = xRatio * 100;
      const y =
        ((PAD_Y + plotH - ((d.value - minY) / rangeY) * plotH) / height) * 100;
      return { x, y };
    });
    // Baseline at the chart bottom (matches the hairline at y=99) so the fill
    // reads as area-under-the-curve rather than a floating ribbon.
    return {
      linePath: smoothLinePath(pts),
      areaPath: smoothAreaPath(pts, 99),
    };
  }, [data, count, minY, rangeY, plotH, height]);

  return (
    <View
      style={[styles.container, { height }]}
      onLayout={onLayout}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            pointerEvents="none"
          >
            <Defs>
              {/* Soft top-down gradient: accent at 18% fading to fully
                  transparent at the baseline (Revolut area treatment). */}
              <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={toneTk.accent} stopOpacity={0.18} />
                <Stop offset="1" stopColor={toneTk.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {count > 1 && (
              <>
                {/* Gradient area UNDERNEATH the line. */}
                <Path d={areaPath} fill="url(#chartFill)" stroke="none" />
                {/* Smooth monotone-cubic line ON TOP. */}
                <Path
                  d={linePath}
                  fill="none"
                  stroke={toneTk.accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
            {count === 1 && (
              <Circle cx="50" cy="50" r={1.6} fill={toneTk.accent} />
            )}
            {/* baseline hairline */}
            <SvgLine
              x1="0"
              y1="99"
              x2="100"
              y2="99"
              stroke={withAlpha(colors.ink, 0.06)}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          </Svg>

          {/* Glow halo behind the thumb (disabled under reduce-motion via opacity 0). */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glow,
              {
                width: GLOW,
                height: GLOW,
                borderRadius: GLOW / 2,
                backgroundColor: toneTk.glow,
                shadowColor: toneTk.accent,
              },
              glowStyle,
            ]}
          />
          {/* The draggable thumb. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                backgroundColor: toneTk.accent,
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
const GLOW = 34;

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
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Soft glow per _uiux_paper: blur radius 18, opacity driven by glowStyle.
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 0,
  },
});
