/**
 * Style C v2 progress marks (MOCK-C1V2 index-v2 sections 4-7): the week ring,
 * the day mark and the personal-best star. They only draw: the caller passes
 * every spoken label, so no wording lives here. Grounds: light (page, white and
 * sage cards) by default; `onDark` on surface.masthead (Today, Summary, the
 * History "This week" card, the Best ever and star tiles); `onBand` on
 * surface.forestBand (the rest band): the ring with done segments only, in leaf
 * (4.98:1). Planned (2.89:1) and the missed number (4.19:1) fail on the band, so
 * the ring's types refuse them there. Motion stays at 300 ms or less and plays
 * once per real event: the caller passes `event` (one key per confirmation, e.g.
 * the sent workout's id), and a key already played this session mounts drawn.
 * Reduce Motion swaps the ring draw for a 150 ms fade and the fades for an
 * instant change. The parts fire no haptic: the Send to Sam tap does. See
 * docs/charting.md (Style C v2 marks).
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

/** Events already played this session, by part, so a remount or a return mounts them drawn. */
const played = new Set<string>();

/**
 * 0 to 1 (decelerate) once per real event: the first part to get a new `event`
 * key plays it (Reduce Motion: `rmMs`); a key already played shows at 1. A
 * layout effect, so the reset lands before paint and never flashes the mark.
 */
function useAppear(part: string, event: string | undefined, ms: number, rmMs: number) {
  const reduce = useReduceMotion();
  const key = event == null ? null : `${part}:${event}`;
  const v = useRef(new Animated.Value(key == null || played.has(key) ? 1 : 0)).current;
  useLayoutEffect(() => {
    if (key == null) return;
    if (played.has(key)) {
      v.setValue(1);
      return;
    }
    played.add(key);
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1, duration: reduce ? rmMs : ms, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: false,
    }).start();
  }, [key, reduce, ms, rmMs, v]);
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

interface RingBase {
  size: number;
  /** Spoken summary, e.g. the "{n} of {total} done" wording once approved. */
  label: string;
  /** The segment that just turned done draws in, once per `event`. The Send to Sam tap fires the haptic. */
  drawIndex?: number;
  /** The real event the draw confirms: one key per confirmation (e.g. the sent workout's id). */
  event?: string;
  /** Centre content: the caller's own text. */
  children?: React.ReactNode;
  testID?: string;
}

/** One segment per planned session, in week order, from 12 o'clock clockwise. */
export type SegmentedRingProps = RingBase & (
  | { segments: ReadonlyArray<SegmentState>; onDark?: boolean; onBand?: never }
  /** surface.forestBand (the rest band): done segments only, in leaf. */
  | { segments: ReadonlyArray<'done'>; onBand: true; onDark?: never }
);

export function SegmentedRing({ segments, size, label, onDark, onBand, drawIndex, event, children, testID }: SegmentedRingProps) {
  const m = marks(useTheme().semanticColors, onDark || onBand);
  const drawn = drawIndex != null && segments[drawIndex] === 'done' ? drawIndex : null;
  const { v, reduce } = useAppear('ring', drawn == null ? undefined : event, DRAW_MS, RM_FADE_MS);
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
  /** The real event that set this state (the done fill at Send to Sam): it fades in over 200 ms once; Reduce Motion: instant. */
  event?: string;
  testID?: string;
}

export function DayMark({ state, day, label, onDark, event, testID }: DayMarkProps) {
  const m = marks(useTheme().semanticColors, onDark);
  const { v } = useAppear('day', event, FADE_MS, 0);
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
  /** The new best it marks: fades in over 200 ms once, no scale or bounce; Reduce Motion: instant. */
  event?: string;
  testID?: string;
}

export function PeakStar({ size = 16, label, onDark, event, testID }: PeakStarProps) {
  const d = useTheme().semanticColors.data;
  const { v } = useAppear('star', event, FADE_MS, 0);
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
