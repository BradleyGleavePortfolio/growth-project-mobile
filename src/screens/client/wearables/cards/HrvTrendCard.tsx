/**
 * HrvTrendCard — 7-day HRV (HRV_MS) trend with full CALM treatment.
 *
 * Copy reports the latest reading without inferring recovery or readiness.
 * The chart uses HK-3a's shared RevolutGlowChart with
 * `tone='cool'`. The reveal is handled by SrCard's CalmSlowReveal.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { SrCard } from './SrCard';
import RevolutGlowChart, { type GlowChartPoint } from '../charts/RevolutGlowChart';
import { useReduceMotion } from '../components/useReduceMotion';
import { RECOVERY_PALETTE } from '../recoveryTheme';
import type { TrendPoint } from '../recoveryData';

export interface HrvTrendCardProps {
  trend: TrendPoint[];
  /** Latest HRV in ms, or null when no data. */
  latestMs: number | null;
  colors: ThemeColors;
  revealDelay?: number;
}

export function HrvTrendCard({ trend, latestMs, colors, revealDelay = 0 }: HrvTrendCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const copy = latestMs === null || trend.length === 0
    ? "Your HRV chart fills in as your mornings sync"
    : `Latest HRV reading: ${Math.round(latestMs)} ms`;
  // GlowChartPoint carries the metric value plus an ISO label for the
  // selected-day readout (the chart formats it). HRV's x-axis is the day
  // timestamp, mirroring FitnessTrendCard's `label: start_at` convention.
  const chartData = useMemo<GlowChartPoint[]>(
    () => trend.map((p) => ({ value: p.value, label: p.at })),
    [trend],
  );

  return (
    <SrCard
      title="Heart-rate variability"
      icon="pulse-outline"
      colors={colors}
      revealDelay={revealDelay}
      testID="hrv-trend-card"
      trailing={
        latestMs !== null ? (
          <Text style={styles.value} testID="hrv-latest">
            {Math.round(latestMs)} <Text style={styles.unit}>ms</Text>
          </Text>
        ) : undefined
      }
    >
      <Text style={styles.copy} testID="hrv-copy">
        {copy}
      </Text>
      {chartData.length > 0 ? (
        <RevolutGlowChart
          data={chartData}
          tone="cool"
          height={120}
          reduceMotion={reduceMotion}
          accessibilityLabel="Heart-rate variability trend. Drag to scrub by day."
        />
      ) : (
        <View style={[styles.emptyChart, { backgroundColor: RECOVERY_PALETTE.track }]} testID="hrv-empty-chart" />
      )}
    </SrCard>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    copy: { fontSize: 14, color: colors.textPrimary, marginBottom: 12, lineHeight: 20 },
    value: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    unit: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    emptyChart: { height: 120, borderRadius: 12 },
  });
}

export default HrvTrendCard;
