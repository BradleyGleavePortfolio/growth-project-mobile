/**
 * BodyCard — body weight + body-fat trend (brief §4.1 #4).
 *
 * Shows the latest weight as the headline with a weight sparkline, plus the
 * latest body-fat percentage when available. "Latest" reductions because body
 * composition is a point-in-time measurement, not a windowed sum/avg. Renders
 * a value-first prompt when neither series has data.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import TgpSparkline from '../../../../ui/charts/TgpSparkline';
import { colors, spacing, typography } from '../../../../theme/tokens';
import type { SampleSeries } from '../../../../api/wearablesSamplesApi';
import { metricMeta, toneTokens, type BucketTone } from '../wearablesTheme';
import { seriesPoints, summariseValue } from '../seriesSummary';
import WearableCard from '../components/WearableCard';

interface Props {
  readonly weightSeries: SampleSeries | undefined;
  readonly bodyFatSeries: SampleSeries | undefined;
  readonly tone: BucketTone;
  readonly onPress?: () => void;
}

export default function BodyCard({
  weightSeries,
  bodyFatSeries,
  tone,
  onPress,
}: Props) {
  const toneTk = toneTokens(tone);
  const weightMeta = metricMeta('BODY_WEIGHT_KG');
  const fatMeta = metricMeta('BODY_FAT_PCT');

  const { weightHeadline, weightSpark, fatHeadline } = useMemo(() => {
    const wPoints = seriesPoints(weightSeries);
    const wValue = summariseValue(wPoints, weightMeta.summary);
    const fPoints = seriesPoints(bodyFatSeries);
    const fValue = summariseValue(fPoints, fatMeta.summary);
    return {
      weightHeadline:
        wValue === null ? null : weightMeta.format(wValue, weightSeries?.unit ?? 'kg'),
      weightSpark: wPoints,
      fatHeadline:
        fValue === null ? null : fatMeta.format(fValue, bodyFatSeries?.unit ?? '%'),
    };
  }, [weightSeries, bodyFatSeries, weightMeta, fatMeta]);

  const hasAny = weightHeadline !== null || fatHeadline !== null;

  return (
    <WearableCard title="Body" icon="body-outline" accent={toneTk.accent} onPress={onPress}>
      {!hasAny ? (
        <Text style={styles.prompt}>
          Connect a smart scale or tracker to see your weight and body-composition
          trend.
        </Text>
      ) : (
        <View style={styles.row}>
          <View>
            <Text style={[styles.value, { color: colors.ink }]}>
              {weightHeadline ?? '—'}
            </Text>
            <Text style={styles.caption}>
              {fatHeadline !== null ? `Latest weight · ${fatHeadline} body fat` : 'Latest weight'}
            </Text>
          </View>
          {weightSpark.length >= 2 && (
            <TgpSparkline
              data={weightSpark}
              width={110}
              height={36}
              color={toneTk.accent}
              accessibilityLabel="Body weight trend"
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
    gap: spacing.md,
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
    maxWidth: 200,
  },
  prompt: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
});
