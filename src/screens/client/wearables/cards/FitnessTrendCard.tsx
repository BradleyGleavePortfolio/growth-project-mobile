/**
 * FitnessTrendCard — the Revolut glow-drag chart card (brief §4.1 #5 / §4.2).
 *
 * Wraps {@link RevolutGlowChart} with the card chrome + a live selected-day
 * readout that updates as the user scrubs. The readout lives OUTSIDE the SVG
 * (React state, updated only on day-snap — not per frame) so it can use the
 * app's typography and the chart stays jank-free.
 *
 * Defaults to a steps trend (the headline H&F momentum metric); the metric is
 * configurable so the same card can show active energy etc.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../../../theme/tokens';
import type {
  SampleSeries,
  WearableMetricType,
} from '../../../../api/wearablesSamplesApi';
import { metricMeta, toneTokens, type BucketTone } from '../wearablesTheme';
import { relativeTime } from '../relativeTime';
import RevolutGlowChart, {
  type GlowChartPoint,
} from '../charts/RevolutGlowChart';
import WearableCard from '../components/WearableCard';

interface Props {
  readonly series: SampleSeries | undefined;
  readonly metric: WearableMetricType;
  readonly tone: BucketTone;
  readonly reduceMotion: boolean;
  readonly onPress?: () => void;
  readonly now?: number;
}

export default function FitnessTrendCard({
  series,
  metric,
  tone,
  reduceMotion,
  onPress,
  now,
}: Props) {
  const toneTk = toneTokens(tone);
  const meta = metricMeta(metric);
  const [selected, setSelected] = useState<number | null>(null);

  const chartData = useMemo<GlowChartPoint[]>(() => {
    const source =
      series?.buckets && series.buckets.length > 0
        ? series.buckets.map((b) => ({ value: b.agg, label: b.bucket_start }))
        : (series?.samples ?? []).map((s) => ({ value: s.value, label: s.start_at }));
    return source;
  }, [series]);

  const unit = series?.unit ?? '';

  const readout = useMemo(() => {
    if (chartData.length === 0) return null;
    const idx =
      selected !== null && selected >= 0 && selected < chartData.length
        ? selected
        : chartData.length - 1;
    const point = chartData[idx];
    return {
      value: meta.format(point.value, unit),
      when: relativeTime(point.label, now) ?? meta.shortLabel,
      isLive: selected !== null,
    };
  }, [chartData, selected, meta, unit, now]);

  return (
    <WearableCard
      title={`${meta.shortLabel} Trend`}
      icon={meta.icon}
      accent={toneTk.accent}
      onPress={onPress}
    >
      {readout === null ? (
        <Text style={styles.prompt}>
          Your {meta.label.toLowerCase()} trend will appear here once your tracker
          has synced a few days of data.
        </Text>
      ) : (
        <>
          <View style={styles.readoutRow}>
            <Text style={[styles.value, { color: colors.ink }]}>
              {readout.value}
            </Text>
            <Text style={styles.when}>
              {readout.isLive ? readout.when : `Latest · ${readout.when}`}
            </Text>
          </View>
          <RevolutGlowChart
            data={chartData}
            tone={tone}
            reduceMotion={reduceMotion}
            onSelect={setSelected}
            accessibilityLabel={`${meta.label} trend. Drag to scrub by day.`}
          />
        </>
      )}
    </WearableCard>
  );
}

const styles = StyleSheet.create({
  readoutRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  value: {
    ...typography.h2,
    fontFamily: 'CormorantGaramond_500Medium',
  },
  when: {
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
