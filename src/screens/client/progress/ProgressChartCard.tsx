/**
 * ProgressChartCard — ED.4 Progress Chart animation (client app).
 *
 * CHART LIB CHOICE — react-native-svg + react-native-reanimated (the repo's
 * existing chart engine), NOT victory-native:
 *   `victory-native` is NOT in this repo's dependencies. The repo already
 *   standardised on react-native-svg + reanimated for ALL charts (see
 *   src/ui/charts/index.ts and docs/charting.md §Skia conflict — Victory
 *   Native XL's Skia-v1 requirement conflicts with the Expo-bundled Skia v2,
 *   so the wrappers are SVG-based). Adding victory-native would reintroduce
 *   that peer conflict for one screen. Per the brief ("prefer falling back to
 *   existing chart library … do NOT add a heavyweight new chart dep"), this
 *   builds on the same SVG + Reanimated stack the rest of the app uses.
 *
 * Features (brief ED.4):
 *   - Draw-in animation: the line path draws left→right over ~1.5s on mount via
 *     an animated `strokeDashoffset` (the ThreeRingHero pattern, applied to a
 *     <Path>). Instant when reduce-motion is on.
 *   - Haptic scrubber: dragging the tracking dot fires Haptics.selectionAsync()
 *     on each data-point crossover (the RevolutGlowChart pattern — gated so it
 *     never throws on web; one JS call per column crossed, not per frame).
 *   - Auto-PR flag detection: the PR point (detectPersonalRecord) gets a star
 *     flag with a glow ring.
 *   - Roman commentary on PR: when a PR is present, an inline Roman line
 *     (romanPRDetected) renders at the bottom with RomanAvatar beside it
 *     (FACE+VOICE invariant — the voice is never disembodied).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, {
  Circle,
  Path,
  Polygon,
  Line as SvgLine,
} from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { romanPRDetected } from '../../../lib/roman/copy';
import { useReduceMotion } from '../wearables/components/useReduceMotion';
import {
  detectPersonalRecord,
  type ProgressPoint,
} from './detectPersonalRecord';
import { colors, spacing, typography, withAlpha } from '../../../theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface ProgressChartCardProps {
  /** Ordered series — e.g. top-set weight over sessions. */
  readonly data: readonly ProgressPoint[];
  /** Lift name for the Roman PR line, e.g. "Back Squat". */
  readonly liftName: string;
  /** Chart height in logical px. */
  readonly height?: number;
  readonly testID?: string;
  /** Test-only override for the reduce-motion probe (keeps the draw-in off). */
  readonly reduceMotionOverride?: boolean;
}

const PAD_X = 16;
const PAD_Y = 18;
const FLAG_SIZE = 12;

/** Fire selection haptic, gated so it never throws on web/unsupported. */
function selectionHaptic(): void {
  // expo-haptics' selectionAsync rejects (not throws) on web. We attach a
  // no-op rejection handler so an unsupported platform degrades silently to
  // "no haptic" WITHOUT an unhandled rejection. This is the ONE place a caught
  // error is intentionally a no-op — a missing haptic motor is not a
  // user-facing failure (documented; mirrors RevolutGlowChart).
  Haptics.selectionAsync().catch(() => {
    /* haptics unavailable on this platform — non-fatal, intentionally ignored */
  });
}

export default function ProgressChartCard({
  data,
  liftName,
  height = 220,
  testID,
  reduceMotionOverride,
}: ProgressChartCardProps): React.ReactElement {
  const probedReduceMotion = useReduceMotion();
  const reduceMotion = reduceMotionOverride ?? probedReduceMotion;

  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const lastEmitted = useRef<number>(-1);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const pr = useMemo(() => detectPersonalRecord(data), [data]);

  // Geometry in measured pixel space (recomputed only when data/size change).
  const geom = useMemo(() => {
    if (data.length === 0 || width === 0) {
      return { points: [] as Array<{ x: number; y: number }>, path: '' };
    }
    const ys = data.map((d) => d.y);
    const xs = data.map((d) => d.x);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeY = maxY - minY || 1;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rangeX = maxX - minX || 1;
    const plotW = Math.max(1, width - PAD_X * 2);
    const plotH = Math.max(1, height - PAD_Y * 2);

    const points = data.map((d) => ({
      x: PAD_X + ((d.x - minX) / rangeX) * plotW,
      y: PAD_Y + plotH - ((d.y - minY) / rangeY) * plotH,
    }));
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');
    return { points, path };
  }, [data, width, height]);

  // ── Draw-in: animate strokeDashoffset from full length → 0 over ~1.5s. ──
  // We over-estimate the path length as the bounding diagonal × point count
  // upper bound; any value ≥ the true length fully hides the line at offset =
  // length, so the reveal is correct without measuring the SVG path on JS.
  const pathLength = useMemo(() => {
    if (geom.points.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < geom.points.length; i += 1) {
      const dx = geom.points[i].x - geom.points[i - 1].x;
      const dy = geom.points[i].y - geom.points[i - 1].y;
      len += Math.hypot(dx, dy);
    }
    return len;
  }, [geom.points]);

  const drawProgress = useSharedValue(reduceMotion ? 1 : 0);
  React.useEffect(() => {
    if (reduceMotion) {
      drawProgress.value = 1;
      return;
    }
    drawProgress.value = 0;
    drawProgress.value = withTiming(1, {
      duration: 1500,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [reduceMotion, drawProgress, pathLength]);

  const animatedLineProps = useAnimatedProps(() => ({
    strokeDashoffset: pathLength * (1 - drawProgress.value),
  }));

  // ── Haptic scrubber: snap to nearest column, haptic on each crossover. ──
  const emitIndex = useCallback(
    (index: number | null) => {
      if (index !== null && index !== lastEmitted.current) {
        selectionHaptic();
      }
      lastEmitted.current = index ?? -1;
      setSelectedIndex(index);
    },
    [],
  );

  const indexForX = useCallback(
    (touchX: number): number => {
      if (geom.points.length === 0) return 0;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < geom.points.length; i += 1) {
        const d = Math.abs(geom.points[i].x - touchX);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
      return nearest;
    },
    [geom.points],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin((e) => emitIndex(indexForX(e.x)))
        .onUpdate((e) => emitIndex(indexForX(e.x)))
        .onFinalize(() => emitIndex(null)),
    [emitIndex, indexForX],
  );

  const selectedPoint =
    selectedIndex != null ? geom.points[selectedIndex] : null;
  const prPoint = pr ? geom.points[pr.index] : null;

  const showChart = geom.points.length >= 2;

  return (
    <View style={styles.card} testID={testID}>
      <View
        style={[styles.plot, { height }]}
        onLayout={onLayout}
        accessibilityRole="image"
        accessibilityLabel={`${liftName} progress chart`}
      >
        {showChart && (
          <GestureDetector gesture={pan}>
            <View style={StyleSheet.absoluteFill}>
              <Svg width={width} height={height}>
                {/* The line. Under reduce-motion we render a PLAIN <Path>
                    (fully drawn, no AnimatedComponent) so the chart never
                    depends on the animation runtime. Otherwise the animated
                    strokeDashoffset reveals it left→right (~1.5s). */}
                {reduceMotion ? (
                  <Path
                    testID="progress-line"
                    d={geom.path}
                    fill="none"
                    stroke={colors.forest}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : (
                  <AnimatedPath
                    testID="progress-line"
                    d={geom.path}
                    fill="none"
                    stroke={colors.forest}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={pathLength}
                    animatedProps={animatedLineProps}
                  />
                )}

                {/* PR flag: glow ring + star at the record point. */}
                {prPoint && (
                  <>
                    <Circle
                      testID="progress-pr-glow"
                      cx={prPoint.x}
                      cy={prPoint.y}
                      r={11}
                      fill={withAlpha(colors.mutedGold, 0.22)}
                    />
                    <Circle
                      cx={prPoint.x}
                      cy={prPoint.y}
                      r={6}
                      fill={withAlpha(colors.mutedGold, 0.4)}
                    />
                    <Polygon
                      testID="progress-pr-flag"
                      points={starPoints(prPoint.x, prPoint.y, FLAG_SIZE / 2)}
                      fill={colors.mutedGold}
                    />
                  </>
                )}

                {/* Scrubber: vertical guide + tracking dot at the snapped column. */}
                {selectedPoint && (
                  <>
                    <SvgLine
                      x1={selectedPoint.x}
                      y1={PAD_Y}
                      x2={selectedPoint.x}
                      y2={height - PAD_Y}
                      stroke={withAlpha(colors.forest, 0.4)}
                      strokeWidth={1}
                      strokeDasharray="3,3"
                    />
                    <Circle
                      testID="progress-scrubber-dot"
                      cx={selectedPoint.x}
                      cy={selectedPoint.y}
                      r={5}
                      fill={colors.forest}
                      stroke={colors.bone}
                      strokeWidth={2}
                    />
                  </>
                )}
              </Svg>
            </View>
          </GestureDetector>
        )}
        {!showChart && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Not enough data yet.</Text>
          </View>
        )}
      </View>

      {/* Roman commentary on PR detection — FACE + VOICE in the same tree. */}
      {pr && (
        <View style={styles.romanRow} testID="progress-pr-commentary">
          <RomanAvatar crop="smile" size={28} testID="progress-pr-avatar" />
          <Text style={styles.romanText} testID="progress-pr-text">
            {romanPRDetected({ liftName, weight: pr.point.y })}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Build a 5-point star polygon centered at (cx,cy) with the given outer radius. */
function starPoints(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    // Start at the top point (-90°) and step every 36°.
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cream,
    borderRadius: 4,
    padding: spacing.md,
  },
  plot: {
    width: '100%',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.stone,
    fontSize: 13,
  },
  romanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  romanText: {
    flex: 1,
    color: colors.charcoal,
    fontSize: typography.bodySmall.fontSize,
    lineHeight: 20,
  },
});
