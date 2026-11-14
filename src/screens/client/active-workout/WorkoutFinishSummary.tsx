import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, motion, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { Overline } from '../../../ui';
import { featureFlags } from '../../../config/featureFlags';
import ShareSheet, { ShareLink, type ShareCardContent } from '../../../components/share/ShareSheet';
import { bestCard } from '../../../components/share/shareCards';
import { getTodayString } from '../../../utils/date';
import type { ActiveWorkoutStyles } from './styles';
import type { workoutSummary } from './sessionQuality';
import WorkoutSummaryC5, { type WorkoutSummaryC5Props } from './WorkoutSummaryC5';

// DES-R-127: the quiet finish. One fade of at most 300 ms, no scale, no
// particles (QUIET_LUXURY_DOCTRINE section 3).
const FADE_MS = 300;

export default function WorkoutFinishSummary({ summary, styles, historyState, elapsed, c5 }: {
  summary: ReturnType<typeof workoutSummary>;
  styles: ActiveWorkoutStyles;
  historyState: 'loading' | 'loaded' | 'unavailable';
  /** Workout time as the top bar shows it. */
  elapsed: string;
  /**
   * WORKOUT-SUMMARY-M: the C1 Style C v2 summary page (frame C5), for a coach-set workout with
   * featureFlags.clientTrainV2 on (ActiveWorkoutScreen decides). Without it, main's card below.
   */
  c5?: Omit<WorkoutSummaryC5Props, 'recordAction'>;
}) {
  const { semanticColors: sc } = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  // SHARE-A (featureFlags.shareSheetV2): a Share link under each record line opens the sheet on its card.
  const [shareCard, setShareCard] = useState<ShareCardContent | null>(null);

  useEffect(() => {
    if (reduceMotion) { opacity.setValue(1); return undefined; }
    const fade = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [opacity, reduceMotion]);

  if (c5) {
    // FIX-974R2 (LS-974R2 B1): the SHARE-A action stays on each record line, as the share glyph at the line's end (a 44 pt
    // button, the same spoken name and the same sheet as main's link), so it takes no row of its own: C2_summary draws
    // the record as one line and the meter and the note above Send.
    return <Animated.View style={[local.page, { opacity }]}>
      <WorkoutSummaryC5
        {...c5}
        recordAction={featureFlags.shareSheetV2 ? (line) => line.weight == null ? null : (
          <Pressable
            testID="summary-share" accessibilityRole="button"
            accessibilityLabel={`Share ${line.exercise} at ${line.weight.toLocaleString()} lb`}
            onPress={() => { void HapticService.softImpact(); setShareCard(bestCard(line.exercise, line.weight ?? 0, getTodayString())); }}
            style={({ pressed }) => [local.share, pressed && local.pressed]}
          >
            <Ionicons name="share-outline" size={20} color={sc.accentText} />
          </Pressable>
        ) : undefined}
      />
      {featureFlags.shareSheetV2 ? <ShareSheet card={shareCard} onClose={() => setShareCard(null)} /> : null}
    </Animated.View>;
  }

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
    <Overline>Session summary</Overline>
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
      <React.Fragment key={`${record.name}-${i}`}>
        <Text style={[local.meta, { color: sc.textPrimary }]}>
          {`${record.name} at ${record.weight.toLocaleString()} lb is the heaviest in the last 50 saved workouts.`}
        </Text>
        {featureFlags.shareSheetV2 ? (
          <ShareLink
            accessibilityLabel={`Share ${record.name} at ${record.weight.toLocaleString()} lb`}
            onPress={() => setShareCard(bestCard(record.name, record.weight, getTodayString()))}
          />
        ) : null}
      </React.Fragment>
    ))}
    {historyLine ? <Text style={[local.meta, { color: sc.textMuted }]}>{historyLine}</Text> : null}
    {featureFlags.shareSheetV2 ? <ShareSheet card={shareCard} onClose={() => setShareCard(null)} /> : null}
  </Animated.View>;
}

const local = StyleSheet.create({
  page: { flex: 1 },
  share: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  row: { flexDirection: 'row', marginTop: 8 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  value: { ...typography.h2, fontVariant: ['tabular-nums'] },
  label: { fontFamily: typography.bodySmall.fontFamily, fontSize: 13, lineHeight: 18, marginTop: 2 },
  meta: { fontFamily: typography.bodySmall.fontFamily, fontSize: 13, lineHeight: 20, marginTop: 8 },
});
