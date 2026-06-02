/**
 * HealthFitnessTab — coach-side Health & Fitness tab for a client (brief §3b).
 *
 * Reuses the SAME client-facing primitives via <HealthFitnessScreen clientId=…>
 * (so the coach sees exactly what the client sees) and layers a COACH-ONLY
 * anomaly band on top: a short, plain-language read of which fitness signals
 * moved meaningfully over the window. Cohort comparisons / anomaly bands are
 * NEVER rendered on the client surface (brief §3b) — only here.
 *
 * The band is derived from the client's own H&F series; it is advisory copy,
 * not a medical claim, and never renders raw values when there is no data
 * (value-first, never "Coming soon").
 */

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { metricMeta } from '../../client/wearables/wearablesTheme';
import { seriesPoints, deltaPct } from '../../client/wearables/seriesSummary';
import type {
  SamplesResponse,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';
import HealthFitnessScreen from '../../client/wearables/HealthFitnessScreen';

const WINDOW_DAYS = 30;

/** Metrics the coach anomaly band scans, with the direction that reads as a flag. */
const WATCHED: ReadonlyArray<{
  metric: WearableMetricType;
  /** A move of this sign+magnitude is worth surfacing. */
  flagWhen: 'rise' | 'fall';
  threshold: number;
}> = [
  { metric: 'RESTING_HEART_RATE_BPM', flagWhen: 'rise', threshold: 8 },
  { metric: 'WORKOUT_DURATION_MIN', flagWhen: 'fall', threshold: 25 },
  { metric: 'BODY_WEIGHT_KG', flagWhen: 'rise', threshold: 3 },
  { metric: 'STEPS', flagWhen: 'fall', threshold: 25 },
];

interface Anomaly {
  readonly metric: WearableMetricType;
  readonly label: string;
  readonly deltaPct: number;
}

function computeAnomalies(data: SamplesResponse | undefined): Anomaly[] {
  if (!data) return [];
  const out: Anomaly[] = [];
  for (const watch of WATCHED) {
    const series = data.series.find((s) => s.metric === watch.metric);
    const delta = deltaPct(seriesPoints(series));
    if (delta === null) continue;
    const flagged =
      watch.flagWhen === 'rise'
        ? delta >= watch.threshold
        : delta <= -watch.threshold;
    if (flagged) {
      out.push({
        metric: watch.metric,
        label: metricMeta(watch.metric).label,
        deltaPct: delta,
      });
    }
  }
  return out;
}

export function HealthFitnessTab({
  clientId,
  colors,
  styles,
}: {
  clientId: string;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const window = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const query = useWearableSamples({
    bucket: 'HEALTH_FITNESS',
    from: window.from,
    to: window.to,
    granularity: 'day',
    clientId,
  });

  const anomalies = useMemo(() => computeAnomalies(query.data), [query.data]);

  return (
    <>
      <Text style={styles.sectionTitle}>Coach insights</Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          marginBottom: 16,
        }}
      >
        {anomalies.length === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
            <Text style={{ color: colors.textSecondary, flex: 1 }}>
              No notable shifts in this client&apos;s fitness signals over the last{' '}
              {WINDOW_DAYS} days.
            </Text>
          </View>
        ) : (
          anomalies.map((a) => {
            const rising = a.deltaPct >= 0;
            return (
              <View
                key={a.metric}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 6,
                }}
              >
                <Ionicons
                  name={rising ? 'trending-up-outline' : 'trending-down-outline'}
                  size={18}
                  color={colors.warning}
                />
                <Text style={{ color: colors.textPrimary, flex: 1 }}>
                  {a.label} {rising ? 'up' : 'down'} {Math.abs(a.deltaPct).toFixed(0)}%
                  {' '}over {WINDOW_DAYS} days
                </Text>
              </View>
            );
          })
        )}
      </View>

      <HealthFitnessScreen clientId={clientId} />
    </>
  );
}
