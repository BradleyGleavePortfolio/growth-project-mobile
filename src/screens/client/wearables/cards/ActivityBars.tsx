import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SamplesResponse } from '../../../../api/wearablesSamplesApi';
import { useTheme } from '../../../../theme/useTheme';
import QuietBar from '../../../../ui/progress/QuietBar';
import { seriesPoints } from '../seriesSummary';
import { STARTER_GOALS, type ActivityTargets } from '../starterGoals';

const METRICS = [
  { metric: 'ACTIVE_ENERGY_KCAL', label: 'Active energy', unit: 'kcal' },
  { metric: 'WORKOUT_DURATION_MIN', label: 'Exercise minutes', unit: 'min' },
  { metric: 'STEPS', label: 'Steps', unit: 'steps' },
] as const;

interface Props {
  readonly data?: SamplesResponse;
  /** Explicit coach/client targets override Starter goals independently. */
  readonly targets?: ActivityTargets;
}

export default function ActivityBars({ data, targets }: Props) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.wrap}>
      {METRICS.map(({ metric, label, unit }) => {
        const points = seriesPoints(data?.series.find((s) => s.metric === metric));
        const latest = points[points.length - 1];
        const supplied = targets?.[metric];
        const hasTarget = supplied != null && Number.isFinite(supplied) && supplied > 0;
        const target = hasTarget ? supplied : STARTER_GOALS[metric];
        const value = latest ? `${Math.round(latest.y).toLocaleString('en-US')} ${unit}` : '—';
        const date = latest ? new Date(latest.x).toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
        }).replace(',', '') : 'No sample yet';
        return (
          <View key={metric} style={styles.metric}>
            <QuietBar label={label} value={value} current={latest?.y ?? 0} target={target} />
            <View style={styles.meta}>
              <Text style={[styles.detail, { color: sc.textMuted }]}>{date}</Text>
              <Text style={[styles.detail, { color: sc.textMuted }]}>
                {`${hasTarget ? 'Goal' : 'Starter goal'}: ${target.toLocaleString('en-US')} ${unit}`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 24 },
  metric: { gap: 8 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 13, fontVariant: ['tabular-nums'] },
});
