/**
 * WorkoutsCard — windowed workout summary (brief §4.1 #3).
 *
 * Summarises the WORKOUT_DURATION_MIN series into total exercise minutes +
 * session count, with per-session chips for the most recent workouts. Sessions
 * are the individual raw samples (each sample is one logged workout). When
 * there are none we render a value-first prompt.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
  withAlpha,
} from '../../../../theme/tokens';
import { relativeTime } from '../relativeTime';
import type { SampleSeries } from '../../../../api/wearablesSamplesApi';
import { toneTokens, type BucketTone } from '../wearablesTheme';
import WearableCard from '../components/WearableCard';

interface Props {
  readonly workoutSeries: SampleSeries | undefined;
  readonly tone: BucketTone;
  readonly onPress?: () => void;
  /** Injected for deterministic relative-time rendering in tests. */
  readonly now?: number;
}

const MAX_CHIPS = 4;

export default function WorkoutsCard({ workoutSeries, tone, onPress, now }: Props) {
  const toneTk = toneTokens(tone);

  const { totalMin, count, recent } = useMemo(() => {
    const samples = workoutSeries?.samples ?? [];
    const total = samples.reduce((acc, s) => acc + s.value, 0);
    // Most-recent first for the chips.
    const sorted = [...samples].sort(
      (a, b) => Date.parse(b.start_at) - Date.parse(a.start_at),
    );
    return {
      totalMin: Math.round(total),
      count: samples.length,
      recent: sorted.slice(0, MAX_CHIPS),
    };
  }, [workoutSeries]);

  return (
    <WearableCard title="Workouts" icon="barbell-outline" accent={toneTk.accent} onPress={onPress}>
      {count === 0 ? (
        <Text style={styles.prompt}>
          No workouts in this window yet. Logged sessions from your tracker will
          appear here.
        </Text>
      ) : (
        <>
          <View style={styles.row}>
            <View>
              <Text style={[styles.value, { color: colors.ink }]}>
                {totalMin} min
              </Text>
              <Text style={styles.caption}>Total exercise</Text>
            </View>
            <View style={styles.countPill}>
              <Text style={[styles.countText, { color: toneTk.accent }]}>
                {count} {count === 1 ? 'session' : 'sessions'}
              </Text>
            </View>
          </View>
          <View style={styles.chips}>
            {recent.map((s) => (
              <View
                key={`${s.start_at}-${s.provider}`}
                style={[styles.chip, { borderColor: withAlpha(toneTk.accent, 0.3) }]}
              >
                <Text style={styles.chipText}>
                  {Math.round(s.value)}m · {relativeTime(s.start_at, now) ?? 'recent'}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </WearableCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  value: {
    ...typography.h2,
    fontFamily: 'CormorantGaramond_500Medium',
  },
  caption: {
    ...typography.caption,
    color: colors.charcoal,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  countPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.camel, 0.12),
  },
  countText: {
    ...typography.caption,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    ...typography.caption,
    color: colors.charcoal,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  prompt: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
});
