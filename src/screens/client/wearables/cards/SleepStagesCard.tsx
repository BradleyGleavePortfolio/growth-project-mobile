/**
 * SleepStagesCard — a stacked horizontal bar of the night's sleep stages.
 *
 * Bradley LAW: labels are PLAIN LANGUAGE ONLY — "REM", "Deep sleep",
 * "Light sleep", "Awake". No clinical sleep-stage codes anywhere.
 *
 * CALM framing: the headline reads as reassurance + context, never a bare score
 * (e.g. "Solid restorative night — 6h 48m asleep"), and a low value is never
 * coloured red.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { SrCard } from './SrCard';
import { RECOVERY_PALETTE } from '../recoveryTheme';
import { formatMinutes, type SleepStagesView, type SleepStageSlice } from '../recoveryData';

export interface SleepStagesCardProps {
  stages: SleepStagesView | null;
  colors: ThemeColors;
  revealDelay?: number;
}

/** Cool stage colours — all within the indigo→slate family, never alarming. */
const STAGE_COLORS: Record<SleepStageSlice['key'], string> = {
  rem: '#6E5BB8', // indigo-violet
  deep: '#3F4A7A', // deep indigo
  light: '#8E96BE', // slate-indigo
  awake: '#C7CBDA', // pale slate
};

export function SleepStagesCard({ stages, colors, revealDelay = 0 }: SleepStagesCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Reassurance-first headline. Asleep = everything except "Awake".
  const asleepMin =
    stages?.slices.filter((s) => s.key !== 'awake').reduce((sum, s) => sum + s.minutes, 0) ?? 0;
  const headline =
    stages && asleepMin > 0
      ? `Solid restorative night — ${formatMinutes(asleepMin)} asleep`
      : "We'll map your sleep stages once your tracker syncs a night";

  return (
    <SrCard title="Sleep stages" icon="bed-outline" colors={colors} revealDelay={revealDelay} testID="sleep-stages-card">
      <Text style={styles.headline} testID="sleep-stages-headline">
        {headline}
      </Text>

      {stages && stages.slices.length > 0 ? (
        <>
          <View style={styles.bar} accessibilityRole="image" accessibilityLabel={accessibilityFor(stages)}>
            {stages.slices.map((slice) => (
              <View
                key={slice.key}
                testID={`sleep-stage-${slice.key}`}
                style={{
                  flex: Math.max(slice.fraction, 0.001),
                  backgroundColor: STAGE_COLORS[slice.key],
                }}
              />
            ))}
          </View>
          <View style={styles.legend}>
            {stages.slices.map((slice) => (
              <View key={slice.key} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: STAGE_COLORS[slice.key] }]} />
                <Text style={styles.legendLabel}>{slice.label}</Text>
                <Text style={styles.legendValue}>{formatMinutes(slice.minutes)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <View style={[styles.bar, { backgroundColor: RECOVERY_PALETTE.track }]} testID="sleep-stages-empty-bar" />
      )}
    </SrCard>
  );
}

function accessibilityFor(stages: SleepStagesView): string {
  const parts = stages.slices.map((s) => `${s.label} ${formatMinutes(s.minutes)}`);
  return `Sleep stages: ${parts.join(', ')}`;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    headline: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
    bar: {
      flexDirection: 'row',
      height: 14,
      borderRadius: 7,
      overflow: 'hidden',
    },
    legend: { marginTop: 14, gap: 8 },
    legendItem: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    legendLabel: { fontSize: 13, color: colors.textPrimary, flex: 1 },
    legendValue: { fontSize: 13, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  });
}

export default SleepStagesCard;
