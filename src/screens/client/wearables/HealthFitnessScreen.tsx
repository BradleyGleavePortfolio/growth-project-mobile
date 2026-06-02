/**
 * HealthFitnessScreen — the Health & Fitness bucket "Fitness Overview"
 * (brief §4.1).
 *
 * Layout (≤5 primary chunks above the fold):
 *   1. ThreeRingHero   (Move / Exercise / Stand)
 *   2. HeartCard
 *   3. WorkoutsCard
 *   4. BodyCard
 *   5. FitnessTrendCard (Revolut glow-drag chart)
 *
 * The FreshnessChip floats top-right of the hero (rendered by the shell header
 * for the client surface — passed in here only for the coach embed).
 *
 * State handling (brief §4.5 / Bradley LAW):
 *   - Loading >150ms → skeleton-of-the-real-layout (the empty rings + faded
 *     card frames), NEVER a spinner.
 *   - Total empty (no connected source / zero data) → HealthFitnessEmptyState
 *     (real rings at 0% + connect CTA), NEVER "Coming soon".
 *   - Error with cached data → an inline banner "Showing your last synced data
 *     from <relative>" above the (cached) content.
 *   - Error with no cache → a typed retry card ("Couldn't reach health server.
 *     We'll keep your data safe — try again.").
 *
 * The screen reads its own window (last 30 days, day granularity) and is
 * `clientId`-aware so the coach embed reuses it for a client.
 */

import React, { useCallback, useMemo } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import {
  colors,
  radius,
  semantic,
  spacing,
  typography,
} from '../../../theme/tokens';
import {
  useWearableSamples,
} from '../../../hooks/useWearableSamples';
import type {
  SampleSeries,
  SamplesResponse,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';
import { useReduceMotion } from './components/useReduceMotion';
import {
  metricMeta,
  toneForBucket,
  toneTokens,
} from './wearablesTheme';
import { relativeTime } from './relativeTime';
import { seriesPoints, summariseValue, ringProgress } from './seriesSummary';
import ThreeRingHero, { type RingDatum } from './cards/ThreeRingHero';
import HeartCard from './cards/HeartCard';
import WorkoutsCard from './cards/WorkoutsCard';
import BodyCard from './cards/BodyCard';
import FitnessTrendCard from './cards/FitnessTrendCard';
import HealthFitnessEmptyState from './empty/HealthFitnessEmptyState';

/** Daily activity goals for the three rings (sensible defaults; CPO-tunable). */
const RING_GOALS = {
  activeKcal: 500,
  exerciseMin: 30,
  steps: 10000,
} as const;

const WINDOW_DAYS = 30;

interface Props {
  /** Coach embed reads a client's data; omitted on the client's own surface. */
  readonly clientId?: string;
  /**
   * HK-5b later mounts a collapsible AI insight panel here. Typed slot reserved
   * now (brief §4.1) so adding it is additive and never reshapes the layout.
   */
  readonly aiPanelSlot?: React.ReactNode;
}

function findSeries(
  data: SamplesResponse | undefined,
  metric: WearableMetricType,
): SampleSeries | undefined {
  return data?.series.find((s) => s.metric === metric);
}

export default function HealthFitnessScreen({ clientId, aiPanelSlot }: Props) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const reduceMotion = useReduceMotion();
  const tone = toneForBucket('HEALTH_FITNESS');
  const toneTk = toneTokens(tone);

  // Window: last WINDOW_DAYS, day granularity (server aggregates).
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

  const { data, isLoading, isError, refetch, isRefetching } = query;

  const goToConnections = useCallback(() => {
    navigation.navigate('Connections');
  }, [navigation]);

  const goToMetricDetail = useCallback(
    (metric: WearableMetricType) => {
      navigation.navigate('WearableMetricDetail', {
        metric,
        bucket: 'HEALTH_FITNESS',
        clientId,
      });
    },
    [navigation, clientId],
  );

  // Derive ring data from active energy / workout minutes / steps.
  const rings = useMemo<readonly [RingDatum, RingDatum, RingDatum]>(() => {
    const activePts = seriesPoints(findSeries(data, 'ACTIVE_ENERGY_KCAL'));
    const exercisePts = seriesPoints(findSeries(data, 'WORKOUT_DURATION_MIN'));
    const stepsPts = seriesPoints(findSeries(data, 'STEPS'));
    // Latest day's value for the ring fill (today vs goal).
    const latest = (pts: { y: number }[]) =>
      pts.length === 0 ? null : pts[pts.length - 1].y;
    return [
      {
        progress: ringProgress(latest(activePts), RING_GOALS.activeKcal),
        color: colors.camel,
        label: 'Move',
      },
      {
        progress: ringProgress(latest(exercisePts), RING_GOALS.exerciseMin),
        color: colors.mutedGold,
        label: 'Exercise',
      },
      {
        progress: ringProgress(latest(stepsPts), RING_GOALS.steps),
        color: colors.forest,
        label: 'Stand',
      },
    ];
  }, [data]);

  const centerValue = useMemo(() => {
    const activePts = seriesPoints(findSeries(data, 'ACTIVE_ENERGY_KCAL'));
    const value = summariseValue(activePts.slice(-1), 'latest');
    return value === null ? '—' : metricMeta('ACTIVE_ENERGY_KCAL').format(value, 'kcal');
  }, [data]);

  const hasAnyData = useMemo(
    () => (data?.series ?? []).some((s) => s.sample_count > 0),
    [data],
  );

  // ── Loading skeleton (NOT a spinner) ──
  if (isLoading) {
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        accessibilityLabel="Loading your fitness overview"
      >
        <View style={styles.heroBlock}>
          <ThreeRingHero
            rings={[
              { progress: 0, color: colors.camel, label: 'Move' },
              { progress: 0, color: colors.mutedGold, label: 'Exercise' },
              { progress: 0, color: colors.forest, label: 'Stand' },
            ]}
            centerValue="—"
            centerLabel="Active kcal"
            tone={tone}
            reduceMotion={reduceMotion}
            empty={false}
          />
        </View>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCard} accessibilityElementsHidden />
        ))}
      </ScrollView>
    );
  }

  // ── Error with NO cached data → typed retry card ──
  if (isError && !data) {
    return (
      <View style={styles.errorWrap}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.stone} />
        <Text style={styles.errorTitle} accessibilityRole="alert">
          Couldn&apos;t reach health server
        </Text>
        <Text style={styles.errorBody}>
          We&apos;ll keep your data safe — try again.
        </Text>
        <Text
          style={[styles.retry, { color: toneTk.accent }]}
          accessibilityRole="button"
          onPress={() => void refetch()}
        >
          Try again
        </Text>
      </View>
    );
  }

  // ── No connected source / zero data → value-first empty state ──
  if (!hasAnyData) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <HealthFitnessEmptyState
          tone={tone}
          reduceMotion={reduceMotion}
          onConnect={goToConnections}
        />
        {aiPanelSlot}
      </ScrollView>
    );
  }

  // ── Populated overview (with optional stale-data banner) ──
  const staleSince = isError ? relativeTime(data?.window.to ?? null) : null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={toneTk.accent}
        />
      }
    >
      {staleSince && (
        <View style={styles.staleBanner} accessibilityRole="alert">
          <Ionicons name="time-outline" size={14} color={semantic.warning.fg} />
          <Text style={styles.staleText}>
            Showing your last synced data from {staleSince}
          </Text>
        </View>
      )}

      <View style={styles.heroBlock}>
        <ThreeRingHero
          rings={rings}
          centerValue={centerValue}
          centerLabel="Active kcal"
          tone={tone}
          reduceMotion={reduceMotion}
          empty={false}
        />
      </View>

      <HeartCard
        rhrSeries={findSeries(data, 'RESTING_HEART_RATE_BPM')}
        tone={tone}
        onPress={() => goToMetricDetail('RESTING_HEART_RATE_BPM')}
      />
      <WorkoutsCard
        workoutSeries={findSeries(data, 'WORKOUT_DURATION_MIN')}
        tone={tone}
        onPress={() => goToMetricDetail('WORKOUT_DURATION_MIN')}
      />
      <BodyCard
        weightSeries={findSeries(data, 'BODY_WEIGHT_KG')}
        bodyFatSeries={findSeries(data, 'BODY_FAT_PCT')}
        tone={tone}
        onPress={() => goToMetricDetail('BODY_WEIGHT_KG')}
      />
      <FitnessTrendCard
        series={findSeries(data, 'STEPS')}
        metric="STEPS"
        tone={tone}
        reduceMotion={reduceMotion}
        onPress={() => goToMetricDetail('STEPS')}
      />

      {aiPanelSlot}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  heroBlock: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  skeletonCard: {
    height: 96,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    opacity: 0.55,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: semantic.warning.bg,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  staleText: {
    ...typography.bodySmall,
    color: semantic.warning.fg,
    flex: 1,
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    ...typography.h3,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  errorBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
  retry: {
    ...typography.bodyMd,
    marginTop: spacing.md,
  },
});
