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
 *
 * Data-integrity (R1 visual P1 #2 — clinician-facing): the band MUST branch on
 * the query's loading / error states. A failed fetch is NEVER allowed to render
 * the green "no notable shifts" reassurance — that would lie to a coach reading
 * a real client's data.
 *
 * The band shares ONE hour-rounded window with the embedded HealthFitnessScreen
 * so they hit a single React Query cache key instead of double-fetching
 * (R1 code P1 #2 / P2 #1).
 *
 * Surface chrome reuses the wearables `WearableCard` (R1 visual P1 #4) so the
 * band sits on the same bone/cream material as the screen it caps — no coach↔
 * wearables palette seam — and carries no inline hex / off-grid spacing.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { metricMeta, toneTokens } from '../../client/wearables/wearablesTheme';
import { seriesPoints, deltaPct } from '../../client/wearables/seriesSummary';
import type {
  SamplesResponse,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';
import { colors, radius, semantic, spacing, typography } from '../../../theme/tokens';
import WearableCard from '../../client/wearables/components/WearableCard';
import HealthFitnessScreen from '../../client/wearables/HealthFitnessScreen';
import { WearableInsightPanel } from './WearableInsightPanel';

const WINDOW_DAYS = 30;

/**
 * Round a timestamp DOWN to the start of its hour so the rolling-window cache
 * key is stable across re-mounts within the same hour and matches the window
 * the embedded HealthFitnessScreen reuses (R1 code P1 #2 / P2 #1).
 */
function roundToHour(d: Date): Date {
  const r = new Date(d);
  r.setMinutes(0, 0, 0);
  return r;
}

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
  styles,
}: {
  clientId: string;
  /** Coach theme palette (kept for prop-compat with the tab host). */
  colors?: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const toneTk = toneTokens('warm');

  // Single hour-rounded window shared with the embedded HealthFitnessScreen so
  // both reads collapse to one React Query cache key (R1 code P1 #2 / P2 #1).
  const window = useMemo(() => {
    const to = roundToHour(new Date());
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
      <WearableCard
        title="Signal scan"
        icon="pulse-outline"
        accent={toneTk.accent}
        style={bandStyles.card}
      >
        {renderBand({
          isLoading: query.isLoading,
          isError: query.isError,
          anomalies,
        })}
      </WearableCard>

      <WearableInsightPanel side="coach" bucket="HEALTH_FITNESS" clientId={clientId} />

      <HealthFitnessScreen clientId={clientId} window={window} />
    </>
  );
}

/**
 * Render the band body with explicit loading / error / empty / populated
 * branches. The error branch is intentionally neutral (no green, no "all
 * clear") — a failed fetch must never read as reassurance (R1 visual P1 #2).
 */
function renderBand({
  isLoading,
  isError,
  anomalies,
}: {
  isLoading: boolean;
  isError: boolean;
  anomalies: readonly Anomaly[];
}) {
  if (isLoading) {
    return (
      <View style={bandStyles.skeleton} accessibilityLabel="Loading coach insights" />
    );
  }

  if (isError) {
    return (
      <View style={bandStyles.row}>
        <Ionicons name="cloud-offline-outline" size={18} color={colors.stone} />
        <Text style={bandStyles.neutralText} accessibilityRole="alert">
          Couldn&apos;t load insights — pull to refresh.
        </Text>
      </View>
    );
  }

  if (anomalies.length === 0) {
    return (
      <View style={bandStyles.row}>
        <Ionicons
          name="checkmark-circle-outline"
          size={18}
          color={semantic.success.fg}
        />
        <Text style={bandStyles.bodyText}>
          No notable shifts in this client&apos;s fitness signals over the last{' '}
          {WINDOW_DAYS} days.
        </Text>
      </View>
    );
  }

  return (
    <>
      {anomalies.map((a) => {
        const rising = a.deltaPct >= 0;
        return (
          <View key={a.metric} style={bandStyles.anomalyRow}>
            <Ionicons
              name={rising ? 'trending-up-outline' : 'trending-down-outline'}
              size={18}
              color={semantic.warning.fg}
            />
            <Text style={bandStyles.primaryText}>
              {a.label} {rising ? 'up' : 'down'}{' '}
              {Math.abs(a.deltaPct).toFixed(0)}% over {WINDOW_DAYS} days
            </Text>
          </View>
        );
      })}
    </>
  );
}

const bandStyles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  skeleton: {
    height: 20,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    opacity: 0.55,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  anomalyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bodyText: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
  },
  neutralText: {
    ...typography.body,
    color: colors.charcoal,
    flex: 1,
  },
  primaryText: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
});
