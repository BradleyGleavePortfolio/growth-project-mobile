import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { motion, typography } from '../../../theme/tokens';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import type { ActiveWorkoutStyles } from './styles';
import type { workoutSummary } from './sessionQuality';

// DES-R-127: the quiet finish. One fade of at most 300 ms, no scale, no
// particles (QUIET_LUXURY_DOCTRINE section 3).
const FADE_MS = 300;

export default function WorkoutFinishSummary({ summary, styles, historyState, elapsed }: {
  summary: ReturnType<typeof workoutSummary>;
  styles: ActiveWorkoutStyles;
  historyState: 'loading' | 'loaded' | 'unavailable';
  /** Workout time as the top bar shows it. */
  elapsed: string;
}) {
  const { semanticColors: sc } = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) { opacity.setValue(1); return undefined; }
    const fade = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [opacity, reduceMotion]);

  const cells = [
    { label: 'Time', value: elapsed },
    { label: 'Sets', value: summary.sets.toLocaleString() },
    { label: 'Volume', value: `${summary.volume.toLocaleString()} lb` },
  ];
  // A record sentence states its own comparison, so the footnote is only for the other states.
  const historyLine = historyState === 'loading'
    ? 'Loading previous performance…'
    : historyState === 'unavailable'
      ? 'Previous performance unavailable. Sets can still be logged.'
      : summary.records.length === 0 ? 'Recent bests compare the last 50 saved workouts.' : null;

  return <Animated.View testID="workout-finish-summary" style={[styles.exerciseCard, { opacity }]}>
    <Text style={styles.exerciseName}>Session summary</Text>
    <View style={local.row}>
      {cells.map((cell, i) => (
        <View
          key={cell.label}
          accessible
          accessibilityLabel={`${cell.label} ${cell.value}`}
          style={[local.cell, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: sc.border }]}
        >
          <Text testID={`finish-summary-${cell.label.toLowerCase()}`} style={[local.value, { color: sc.textPrimary }]}>{cell.value}</Text>
          <Text style={[local.label, { color: sc.textMuted }]}>{cell.label}</Text>
        </View>
      ))}
    </View>
    <Text style={[local.meta, { color: sc.textMuted }]}>{`${summary.exercises} ${summary.exercises === 1 ? 'exercise' : 'exercises'}`}</Text>
    {summary.records.map((record, i) => (
      <Text key={`${record.name}-${i}`} style={[local.meta, { color: sc.textPrimary }]}>
        {`${record.name} at ${record.weight.toLocaleString()} lb is the heaviest in the last 50 saved workouts.`}
      </Text>
    ))}
    {historyLine ? <Text style={[local.meta, { color: sc.textMuted }]}>{historyLine}</Text> : null}
  </Animated.View>;
}

const local = StyleSheet.create({
  row: { flexDirection: 'row', marginTop: 12 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  value: { ...typography.h2, fontVariant: ['tabular-nums'] },
  label: { fontFamily: typography.bodySmall.fontFamily, fontSize: 13, lineHeight: 18, marginTop: 2 },
  meta: { fontFamily: typography.bodySmall.fontFamily, fontSize: 13, lineHeight: 20, marginTop: 8 },
});
