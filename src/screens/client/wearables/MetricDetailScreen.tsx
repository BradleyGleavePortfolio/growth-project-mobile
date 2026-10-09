/**
 * MetricDetailScreen — the SHARED metric drill-down (brief §3b / §4.4).
 *
 * Owned by THIS PR; HK-3b imports it for Sleep & Recovery metrics (it is
 * metric-agnostic — all per-metric presentation comes from `metricMeta`).
 *
 * It reads ALL providers' samples for the window (`preferredOnly=false`) so the
 * "compare sources" chips can show every source that has data, with the active
 * source highlighted. Tapping a chip writes the preferred-source preference
 * (optimistic, with an ACTIONABLE rollback toast — never a generic "Error").
 *
 * Composition (REDO-DEVICES-133, the progress-details reference):
 *   - overline (bucket) + serif title, then the hero number with what it is
 *     ("Total, last 30 days" / "Latest reading, 7 Oct") or the selected day
 *   - a dated change line ("Up 12% from 8 Sep to 7 Oct")
 *   - RevolutGlowChart (tone follows the bucket)
 *   - the Starter goal (DES-H constants, labelled "Starter goal") for the
 *     metrics that have one, with the days it was reached
 *   - "Recent days": dated values, newest first, as hairline rows
 *   - ProviderOverlapChips (only when ≥2 providers overlap)
 *
 * States (Bradley LAW §0.3 / §4.5):
 *   - loading >150ms → skeleton-of-the-real-layout (NOT a spinner)
 *   - error w/o cache → typed retry card
 *   - empty (zero samples) → value-first "connect a source" prompt
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import { layout, radius, semantic, spacing, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import HapticPressable from '../../../components/HapticPressable';
import { Headline, Overline, QuietSection, Screen, TextLink, quietActions } from '../../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../../ui/states/QuietStates';
import { Skeleton } from '../../../ui/skeletons/Skeleton';
import type { WearableProvider } from '../../../api/wearablesConnectionsApi';
import type {
  SampleSeries,
  WearableMetricBucket,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { useReduceMotion } from './components/useReduceMotion';
import { metricMeta, toneForBucket, type MetricSummaryKind } from './wearablesTheme';
import { seriesPoints, summariseValue, deltaPct, type SparkPoint } from './seriesSummary';
import { STARTER_GOALS } from './starterGoals';
import RevolutGlowChart, {
  type GlowChartPoint,
} from './charts/RevolutGlowChart';
import ProviderOverlapChips from './components/ProviderOverlapChips';

type MetricDetailParams = {
  readonly metric: WearableMetricType;
  readonly bucket: WearableMetricBucket;
  readonly clientId?: string;
};

const WINDOW_DAYS = 30;

/**
 * Round a Date down to the top of its hour. Mirrors `HealthFitnessScreen` so
 * the samples queryKey changes at most once per hour instead of on every
 * millisecond of mount time — stable cache reuse across re-renders (P2).
 */
function roundToHour(d: Date): Date {
  const r = new Date(d);
  r.setMinutes(0, 0, 0);
  return r;
}

/**
 * The set of providers that contributed samples in the window, ordered by most
 * recent sample first. The first entry is the recency-based resolveBest
 * fallback (what the server would auto-pick with no explicit preference).
 */
function providerOverlap(
  series: SampleSeries | undefined,
): { providers: WearableProvider[]; autoProvider: WearableProvider | null } {
  if (!series || series.samples.length === 0) {
    return { providers: [], autoProvider: null };
  }
  const lastSeen = new Map<WearableProvider, number>();
  for (const s of series.samples) {
    const t = Date.parse(s.end_at) || Date.parse(s.start_at) || 0;
    const prev = lastSeen.get(s.provider);
    if (prev === undefined || t > prev) lastSeen.set(s.provider, t);
  }
  const providers = [...lastSeen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
  return { providers, autoProvider: providers[0] ?? null };
}

/**
 * Day buckets start at UTC midnight, so their dates read in UTC (the same
 * rule and format as the Health overview's ActivityBars): "7 Oct", or
 * "Tue 7 Oct" with the weekday.
 */
export function dayLabel(ms: number, withWeekday = false): string {
  return new Date(ms)
    .toLocaleDateString('en-GB', {
      ...(withWeekday ? { weekday: 'short' as const } : {}),
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
    .replace(',', '');
}

/** Sentence case for a title ("Resting Heart Rate" -> "Resting heart rate"); acronyms such as VO₂ stay. */
export function sentenceLabel(label: string): string {
  return label
    .split(' ')
    .map((w, i) => (i === 0 || (w.length > 1 && w === w.toUpperCase()) ? w : w.toLowerCase()))
    .join(' ');
}

/** What the hero number is, in words, so a 30-day total never reads as one day. */
export function heroCaption(kind: MetricSummaryKind, points: readonly SparkPoint[]): string {
  if (kind === 'sum') return `Total, last ${WINDOW_DAYS} days`;
  if (kind === 'avg') return `Average, last ${WINDOW_DAYS} days`;
  const last = points[points.length - 1];
  return last ? `Latest reading, ${dayLabel(last.x)}` : 'Latest reading';
}

/**
 * The change line names the two days it compares (deltaPct is first point vs
 * last point), instead of the old "vs 30d ago".
 */
export function changeLine(points: readonly SparkPoint[]): string {
  const delta = deltaPct(points);
  if (delta === null) return `Last ${WINDOW_DAYS} days`;
  const from = dayLabel(points[0].x);
  const to = dayLabel(points[points.length - 1].x);
  const pct = Math.abs(delta).toFixed(0);
  if (pct === '0') return `Level from ${from} to ${to}`;
  return `${delta > 0 ? 'Up' : 'Down'} ${pct}% from ${from} to ${to}`;
}

const GOAL_UNIT: Record<keyof typeof STARTER_GOALS, string> = {
  ACTIVE_ENERGY_KCAL: 'kcal',
  WORKOUT_DURATION_MIN: 'min',
  STEPS: 'steps',
};

/**
 * DES-H's Starter goal for the metrics that have one. Nobody sets a target
 * on this route, so it is always labelled "Starter goal" (never "Goal").
 */
export function starterGoalFor(
  metric: WearableMetricType,
): { target: number; unit: string } | null {
  if (!Object.prototype.hasOwnProperty.call(STARTER_GOALS, metric)) return null;
  const key = metric as keyof typeof STARTER_GOALS;
  return { target: STARTER_GOALS[key], unit: GOAL_UNIT[key] };
}

/** "Reached on 12 of 28 days with data" — only for per-day buckets, where one point is one day. */
export function goalDetail(points: readonly SparkPoint[], target: number): string | null {
  if (points.length === 0) return null;
  const reached = points.filter((p) => p.y >= target).length;
  const days = points.length === 1 ? 'day' : 'days';
  return `Reached on ${reached} of ${points.length} ${days} with data`;
}

const RECENT_DAYS = 7;

export default function MetricDetailScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<Record<string, MetricDetailParams>, string>>();
  const { metric, bucket, clientId } = route.params;
  const reduceMotion = useReduceMotion();

  const tone = toneForBucket(bucket);
  const meta = metricMeta(metric);
  const title = sentenceLabel(meta.label);
  // Mid-sentence form: "steps", "resting heart rate", "VO₂ max".
  const inline = title
    .split(' ')
    .map((w, i) => (i === 0 && !(w.length > 1 && w === w.toUpperCase()) ? w.toLowerCase() : w))
    .join(' ');
  const { semanticColors: sc } = useTheme();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const window = useMemo(() => {
    // Hour-rounded boundary (matches HealthFitnessScreen): keeps the derived
    // samples queryKey stable within the hour so we don't thrash the cache.
    const to = roundToHour(new Date());
    const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  // preferredOnly=false → ALL providers' samples, so the compare-sources chips
  // see every source that has data for this metric (§3 service contract).
  const query = useWearableSamples({
    bucket,
    metric,
    from: window.from,
    to: window.to,
    granularity: 'day',
    preferredOnly: false,
    clientId,
  });
  const { data, isLoading, isError, refetch } = query;

  const series = useMemo(
    () => data?.series.find((s) => s.metric === metric),
    [data, metric],
  );

  const points = useMemo(() => seriesPoints(series), [series]);

  const chartData = useMemo<GlowChartPoint[]>(
    () => points.map((p) => ({ value: p.y, label: new Date(p.x).toISOString() })),
    [points],
  );

  const { providers, autoProvider } = useMemo(
    () => providerOverlap(series),
    [series],
  );

  // The "provider_used" the server resolved is the explicit preference when
  // present; we treat a mismatch with the recency fallback as "explicit".
  const activeProvider = series?.provider_used ?? autoProvider;
  const isAuto = activeProvider !== null && activeProvider === autoProvider;

  const unit = series?.unit ?? '';
  const selected = selectedIndex !== null ? points[selectedIndex] ?? null : null;

  const headline = useMemo(() => {
    if (selected) return meta.format(selected.y, unit);
    const summary = summariseValue(points, meta.summary);
    return summary === null ? '—' : meta.format(summary, unit);
  }, [selected, points, meta, unit]);

  // The hero's caption: the selected day, or what the number is.
  const caption = selected ? dayLabel(selected.x, true) : heroCaption(meta.summary, points);
  const change = useMemo(() => changeLine(points), [points]);

  const goal = starterGoalFor(metric);
  const perDay = (series?.buckets?.length ?? 0) > 0;
  const goalValue = goal != null ? `${goal.target.toLocaleString('en-US')} ${goal.unit}` : '';
  const goalNote = goal != null && perDay ? goalDetail(points, goal.target) : null;
  const recent = useMemo(() => points.slice(-RECENT_DAYS).reverse(), [points]);

  const onConnect = useCallback(() => {
    navigation.navigate('Connections');
  }, [navigation]);

  const hasData = points.length > 0;
  const bucketLabel = bucket === 'HEALTH_FITNESS' ? 'Fitness' : 'Recovery';

  const titleStack = (
    <View style={styles.titleBlock}>
      <Overline>{bucketLabel}</Overline>
      <Headline level="h1">{title}</Headline>
    </View>
  );

  // ── Loading skeleton of the real layout (NOT a spinner) ──
  if (isLoading) {
    return (
      <Screen edges={['top']} testID="metric-detail-loading">
        {titleStack}
        <QuietLoading label={`Loading ${inline}`} rows={1} />
        <View style={styles.skelChart} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Skeleton width="100%" height={160} borderRadius={radius.card} />
        </View>
      </Screen>
    );
  }

  // ── Error w/o cache → typed retry ──
  if (isError && !data) {
    return (
      <Screen edges={['top']} testID="metric-detail-error">
        {titleStack}
        <QuietError
          layout="inline"
          message={loadFailureMessage(query.error, title)}
          onRetry={() => void refetch()}
          retryHint={`Loads ${inline} again`}
          testID="metric-detail-error-state"
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']} testID="metric-detail">
      {titleStack}

      <QuietSection testID="metric-hero">
        <Overline>{caption}</Overline>
        <Text style={[styles.hero, { color: sc.textPrimary }]} accessibilityLabel={`${caption}: ${headline}`}>
          {headline}
        </Text>
        {hasData && <Text style={[styles.change, { color: sc.textMuted }]}>{change}</Text>}
      </QuietSection>

      {hasData ? (
        <View style={styles.chartWrap}>
          <RevolutGlowChart
            data={chartData}
            tone={tone}
            reduceMotion={reduceMotion}
            onSelect={setSelectedIndex}
            accessibilityLabel={`${title} trend over the last ${WINDOW_DAYS} days`}
          />
        </View>
      ) : (
        <QuietSection testID="metric-empty">
          <Text style={[styles.emptyTitle, { color: sc.textPrimary }]}>No {inline} yet</Text>
          <Text style={[styles.body, { color: sc.textMuted }]}>
            Connect a source that records {inline} to see your
            trend here.
          </Text>
          <TextLink label="Connect a source" onPress={onConnect} tone="accent" underline={false} align="start" />
        </QuietSection>
      )}

      {goal != null && (
        <QuietSection testID="metric-goal">
          <Overline accessibilityRole="header">Goal</Overline>
          <View style={styles.reading} accessible accessibilityLabel={`Starter goal, ${goalValue}${goalNote ? `, ${goalNote}` : ''}`}>
            <View style={styles.goalMain}>
              <Text style={[styles.readingValue, { color: sc.textPrimary }]}>Starter goal</Text>
              {goalNote != null && (
                <Text style={[styles.readingDate, { color: sc.textMuted }]}>{goalNote}</Text>
              )}
            </View>
            <Text style={[styles.readingValue, { color: sc.textPrimary }]}>{goalValue}</Text>
          </View>
        </QuietSection>
      )}

      {recent.length > 0 && (
        <QuietSection testID="metric-recent">
          <Overline accessibilityRole="header">Recent days</Overline>
          {recent.map((p, i) => (
            <View
              key={`${p.x}-${i}`}
              style={[styles.reading, i > 0 && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }]}
              accessible
              accessibilityLabel={`${dayLabel(p.x, true)}, ${meta.format(p.y, unit)}`}
            >
              <Text style={[styles.readingDate, { color: sc.textMuted }]}>{dayLabel(p.x, true)}</Text>
              <Text style={[styles.readingValue, { color: sc.textPrimary }]}>{meta.format(p.y, unit)}</Text>
            </View>
          ))}
        </QuietSection>
      )}

      <ProviderOverlapChips
        metric={metric}
        providers={providers}
        activeProvider={activeProvider}
        isAuto={isAuto}
        tone={tone}
        onError={setToast}
      />

      {toast && (
        <View
          style={[styles.toast, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="alert-circle-outline" size={18} color={semantic.warning.fg} />
          <Text style={[styles.toastText, { color: sc.textPrimary }]}>{toast}</Text>
          <HapticPressable
            intent="light"
            onPress={() => setToast(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            style={({ pressed }) => [quietActions.action, styles.toastDismissCta, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[quietActions.label, { color: sc.accentText }]}>Dismiss</Text>
          </HapticPressable>
        </View>
      )}
    </Screen>
  );
}

// Hero number: the Cormorant display role (lineHeight >= 1.25 x size from the
// token), tabular figures like the progress-details reference.
const styles = StyleSheet.create({
  titleBlock: {
    paddingBottom: layout.sectionGap,
  },
  hero: {
    ...typography.display,
    fontVariant: ['tabular-nums'],
  },
  change: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  chartWrap: {
    marginBottom: layout.sectionGap,
  },
  skelChart: {
    marginTop: spacing.lg,
  },
  emptyTitle: {
    ...typography.h3,
  },
  body: {
    ...typography.body,
    marginTop: spacing.xs,
  },
  reading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.touchMin,
    paddingVertical: 10,
  },
  goalMain: {
    flex: 1,
    gap: 2,
  },
  readingDate: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
  },
  readingValue: {
    ...typography.body,
    fontVariant: ['tabular-nums'],
  },
  // The toast sits on the page surface with a hairline, not a tinted box.
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  toastText: {
    ...typography.bodySmall,
    flex: 1,
  },
  toastDismissCta: {
    marginRight: 0,
  },
});
