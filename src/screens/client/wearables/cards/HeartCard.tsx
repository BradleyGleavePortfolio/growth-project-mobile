/**
 * HeartCard — resting heart rate headline + RHR sparkline (brief §4.1 #2).
 *
 * Reads the RESTING_HEART_RATE_BPM series for the window; shows the windowed
 * average as the headline and a sparkline of the trend. When there is no data
 * we render a value-first prompt (NEVER a fake "0 bpm" or "Coming soon").
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import TgpSparkline from '../../../../ui/charts/TgpSparkline';
import { colors, typography } from '../../../../theme/tokens';
import type { SampleSeries } from '../../../../api/wearablesSamplesApi';
import { metricMeta, toneTokens, type BucketTone } from '../wearablesTheme';
import { seriesPoints, summariseValue } from '../seriesSummary';
import WearableCard from '../components/WearableCard';

interface Props {
  readonly rhrSeries: SampleSeries | undefined;
  readonly tone: BucketTone;
  readonly onPress?: () => void;
}

export default function HeartCard({ rhrSeries, tone, onPress }: Props) {
  const toneTk = toneTokens(tone);
  const meta = metricMeta('RESTING_HEART_RATE_BPM');

  const { headline, spark } = useMemo(() => {
    const points = seriesPoints(rhrSeries);
    const value = summariseValue(points, meta.summary);
    return {
      headline: value === null ? null : meta.format(value, rhrSeries?.unit ?? 'bpm'),
      spark: points,
    };
  }, [rhrSeries, meta]);

  return (
    <WearableCard title="Heart" icon="heart-outline" accent={toneTk.accent} onPress={onPress}>
      {headline === null ? (
        <Text style={styles.prompt}>
          Connect a heart-rate source to see your resting heart rate trend.
        </Text>
      ) : (
        <View style={styles.row}>
          <View>
            <Text style={[styles.value, { color: colors.ink }]}>{headline}</Text>
            <Text style={styles.caption}>Avg resting HR</Text>
          </View>
          {spark.length >= 2 && (
            <TgpSparkline
              data={spark}
              width={110}
              height={36}
              color={toneTk.accent}
              accessibilityLabel="Resting heart rate trend"
            />
          )}
        </View>
      )}
    </WearableCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  prompt: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
});
