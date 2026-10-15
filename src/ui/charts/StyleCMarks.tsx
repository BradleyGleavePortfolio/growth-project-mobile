/**
 * Style C v2 progress marks (MOCK-C1V2 index-v2 sections 4-7): the week ring,
 * the day mark and the personal-best star. They only draw: the caller passes
 * every spoken label, so no wording lives here. `onDark` means drawn on
 * surface.masthead, the one dark surface they support (on surface.forestBand
 * plannedOnDark and the missed number fall below 3:1 and 4.5:1). Motion stays
 * at 300 ms or less; Reduce Motion swaps the ring draw for a 150 ms fade and
 * the fades for an instant change. The parts fire no haptic: the screen that
 * sets `drawIndex` fires it. See docs/charting.md (Style C v2 marks).
 */
import React, { useLayoutEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import { colors, motion, typography, type SemanticTokens } from '../../theme/tokens';
import { useReduceMotion } from '../../screens/client/wearables/components/useReduceMotion';

export type SegmentState = 'done' | 'planned' | 'missed';
export type DayState = SegmentState | 'today' | 'rest';

const DRAW_MS = 300;
const FADE_MS = 200;
const RM_FADE_MS = 150;
const GAP_DEG = 10;
const DAY = 36;
const STAR = 'M12 3.1L14.4 9.4L21 9.7L15.8 13.8L17.6 20.3L12 16.6L6.4 20.3L8.2 13.8L3 9.7L9.6 9.4Z';
const AnimatedPath = Animated.createAnimatedComponent(Path);

function marks(t: SemanticTokens, onDark?: boolean) {
  const d = t.data;
  return onDark
    ? { done: d.leaf, onDone: colors.ink, planned: d.plannedOnDark, missed: d.missedOnDark, text: t.textOnAccent, muted: t.textOnMastheadMuted }
    : { done: d.forest, onDone: t.textOnAccent, planned: d.planned, missed: d.missed, text: t.textPrimary, muted: t.textMuted };
}

/**
 * 0 to 1 (decelerate) each time `event` takes a new non-null value, so a second
 * event on a mounted part plays too; Reduce Motion uses `rmMs`. A layout effect,
 * so the reset lands before paint and a draw that starts after mount never
 * flashes the finished mark first.
 */
function useAppear(event: string | number | null, ms: number, rmMs: number) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(event == null ? 1 : 0)).current;
  useLayoutEffect(() => {
    if (event == null) return;
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1, duration: reduce ? rmMs : ms, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: false,
    }).start();
  }, [event, reduce, ms, rmMs, v]);
  return { v, reduce };
}

function arc(c: number, r: number, from: number, sweep: number): string {
  const at = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  if (sweep >= 360) return `M${at(from)}A${r} ${r} 0 1 1 ${at(from + 180)}A${r} ${r} 0 1 1 ${at(from)}`;
  return `M${at(from)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${at(from + sweep)}`;
}

export interface SegmentedRingProps {
  /** One segment per planned session, in week order, from 12 o'clock clockwise. */
  segments: ReadonlyArray<SegmentState>;
  size: number;
  /** Spoken summary, e.g. the "{n} of {total} done" wording once approved. */
  label: string;
  onDark?: boolean;
  /** The segment that just turned done draws in; each new index draws once. The screen fires the haptic. */
  drawIndex?: number;
  /** Centre content: the caller's own text. */
  children?: React.ReactNode;
  testID?: string;
}

export function SegmentedRing({ segments, size, label, onDark, drawIndex, children, testID }: SegmentedRingProps) {
  const m = marks(useTheme().semanticColors, onDark);
  const drawn = drawIndex != null && segments[drawIndex] === 'done' ? drawIndex : null;
  const { v, reduce } = useAppear(drawn, DRAW_MS, RM_FADE_MS);
  const thick = size / 10;
  const thin = Math.max(1.5, size / 64);
  const r = (size - thick) / 2;
  const step = 360 / Math.max(segments.length, 1);
  const sweep = segments.length > 1 ? step - GAP_DEG : 360;
  const len = (Math.PI * r * sweep) / 180;
  return (
    <View
      testID={testID} accessible accessibilityRole="image" accessibilityLabel={label}
      style={[styles.center, { width: size, height: size }]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {segments.map((s, i) => {
          const seg = {
            d: arc(size / 2, r, i * step + (step - sweep) / 2, sweep), fill: 'none',
            stroke: m[s], strokeWidth: s === 'done' ? thick : thin,
            strokeDasharray: s === 'missed' ? [thin * 2, thin * 2] : undefined,
          };
          if (i !== drawn) return <Path key={i} {...seg} />;
          return reduce
            ? <AnimatedPath key={i} {...seg} opacity={v} />
            : <AnimatedPath key={i} {...seg} strokeDasharray={[len, len]} strokeDashoffset={v.interpolate({ inputRange: [0, 1], outputRange: [len, 0] })} />;
        })}
      </Svg>
      {children}
    </View>
  );
}

export interface DayMarkProps {
  state: DayState;
  /** Date of the month. Done shows a check instead; the label still says the date. */
  day: number;
  /** Spoken label, e.g. "12, missed" once approved. */
  label: string;
  onDark?: boolean;
  /** Each new state fades in over 200 ms (the done fill at Send to Sam); Reduce Motion: instant. */
  animate?: boolean;
  testID?: string;
}

export function DayMark({ state, day, label, onDark, animate = false, testID }: DayMarkProps) {
  const m = marks(useTheme().semanticColors, onDark);
  const { v } = useAppear(animate ? state : null, FADE_MS, 0);
  const w = state === 'today' ? 3 : 1.5;
  const ring = state === 'today' ? m.done : state === 'planned' ? m.planned : m.missed;
  return (
    <Animated.View
      testID={testID} accessible accessibilityRole="text" accessibilityLabel={label}
      style={[styles.center, { width: DAY, height: DAY, opacity: v }]}
    >
      {state !== 'rest' && (
        <Svg width={DAY} height={DAY} style={StyleSheet.absoluteFill}>
          {state === 'done' ? (
            <>
              <Circle cx={DAY / 2} cy={DAY / 2} r={DAY / 2} fill={m.done} />
              <Path d="M11.5 18.5l4.5 4.5 8.5-9" stroke={m.onDone} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </>
          ) : (
            <Circle
              cx={DAY / 2} cy={DAY / 2} r={(DAY - w) / 2} fill="none" stroke={ring} strokeWidth={w}
              strokeDasharray={state === 'missed' ? [3, 3] : undefined}
            />
          )}
        </Svg>
      )}
      {state !== 'done' && (
        <Text maxFontSizeMultiplier={1.3} style={[styles.day, { color: state === 'missed' ? m.missed : state === 'rest' ? m.muted : m.text }]}>
          {day}
        </Text>
      )}
    </Animated.View>
  );
}

export interface PeakStarProps {
  size?: number;
  /** Spoken label when the star stands alone ("New best" once approved). Omit it when words sit beside the star. */
  label?: string;
  onDark?: boolean;
  /** Fade in over 200 ms, no scale or bounce; Reduce Motion: instant. */
  animate?: boolean;
  testID?: string;
}

export function PeakStar({ size = 16, label, onDark, animate = false, testID }: PeakStarProps) {
  const d = useTheme().semanticColors.data;
  const { v } = useAppear(animate ? 1 : null, FADE_MS, 0);
  return (
    <Animated.View
      testID={testID} style={{ opacity: v }} accessible={!!label} accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label} aria-hidden={!label}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={STAR} fill={d.peak} stroke={onDark ? d.peak : d.peakInk} strokeWidth={1.5} strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  day: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
});
