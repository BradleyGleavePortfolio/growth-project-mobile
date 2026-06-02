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
 * Composition:
 *   - headline value (per the metric's summary kind) + selected-day readout
 *   - RevolutGlowChart (tone follows the bucket)
 *   - ProviderOverlapChips (only when ≥2 providers overlap)
 *
 * States (Bradley LAW §0.3 / §4.5):
 *   - loading >150ms → skeleton-of-the-real-layout (NOT a spinner)
 *   - error w/o cache → typed retry card
 *   - empty (zero samples) → value-first "connect a source" prompt
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import {
  colors,
  radius,
  semantic,
  spacing,
  typography,
} from '../../../theme/tokens';
import type { WearableProvider } from '../../../api/wearablesConnectionsApi';
import type {
  SampleSeries,
  WearableMetricBucket,
  WearableMetricType,
} from '../../../api/wearablesSamplesApi';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { useReduceMotion } from './components/useReduceMotion';
import { metricMeta, toneForBucket, toneTokens } from './wearablesTheme';
import { seriesPoints, summariseValue, deltaPct } from './seriesSummary';
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

export default function MetricDetailScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<Record<string, MetricDetailParams>, string>>();
  const { metric, bucket, clientId } = route.params;
  const reduceMotion = useReduceMotion();

  const tone = toneForBucket(bucket);
  const toneTk = toneTokens(tone);
  const meta = metricMeta(metric);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const window = useMemo(() => {
    const to = new Date();
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

  const headline = useMemo(() => {
    if (selectedIndex !== null && points[selectedIndex]) {
      return meta.format(points[selectedIndex].y, series?.unit ?? '');
    }
    const summary = summariseValue(points, meta.summary);
    return summary === null ? '—' : meta.format(summary, series?.unit ?? '');
  }, [selectedIndex, points, meta, series?.unit]);

  const subline = useMemo(() => {
    if (selectedIndex !== null && chartData[selectedIndex]) {
      const d = new Date(chartData[selectedIndex].label);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const delta = deltaPct(points);
    if (delta === null) return `Last ${WINDOW_DAYS} days`;
    const arrow = delta >= 0 ? '↑' : '↓';
    return `${arrow} ${Math.abs(delta).toFixed(0)}% vs ${WINDOW_DAYS}d ago`;
  }, [selectedIndex, chartData, points]);

  const onConnect = useCallback(() => {
    navigation.navigate('Connections');
  }, [navigation]);

  const hasData = points.length > 0;

  // ── Loading skeleton (NOT a spinner) ──
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title={meta.label} icon={meta.icon} accent={toneTk.accent} />
        <View style={styles.body}>
          <View style={styles.skelHeadline} accessibilityElementsHidden />
          <View style={styles.skelChart} accessibilityElementsHidden />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error w/o cache → typed retry ──
  if (isError && !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title={meta.label} icon={meta.icon} accent={toneTk.accent} />
        <View style={styles.errorWrap}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.stone} />
          <Text style={styles.errorTitle} accessibilityRole="alert">
            Couldn&apos;t load {meta.label.toLowerCase()}
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header title={meta.label} icon={meta.icon} accent={toneTk.accent} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={[styles.subline, { color: toneTk.accent }]}>{subline}</Text>

        {hasData ? (
          <View style={styles.chartWrap}>
            <RevolutGlowChart
              data={chartData}
              tone={tone}
              reduceMotion={reduceMotion}
              onSelect={setSelectedIndex}
              accessibilityLabel={`${meta.label} trend over the last ${WINDOW_DAYS} days`}
            />
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No {meta.label.toLowerCase()} yet</Text>
            <Text style={styles.emptyBody}>
              Connect a source that records {meta.label.toLowerCase()} to see your
              trend here.
            </Text>
            <Text
              style={[styles.retry, { color: toneTk.accent }]}
              accessibilityRole="button"
              onPress={onConnect}
            >
              Connect a source
            </Text>
          </View>
        )}

        <ProviderOverlapChips
          metric={metric}
          providers={providers}
          activeProvider={activeProvider}
          isAuto={isAuto}
          tone={tone}
          onError={setToast}
        />
      </ScrollView>

      {toast && (
        <View style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={16} color={semantic.warning.fg} />
          <Text style={styles.toastText}>{toast}</Text>
          <Text
            style={[styles.toastDismiss, { color: toneTk.accent }]}
            accessibilityRole="button"
            onPress={() => setToast(null)}
          >
            Dismiss
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function Header({
  title,
  icon,
  accent,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accent: string;
}) {
  return (
    <View style={styles.header}>
      <View style={[styles.headerIcon, { borderColor: accent }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing['3xl'],
  },
  headline: {
    ...typography.h1,
    color: colors.ink,
  },
  subline: {
    ...typography.bodyMd,
    fontFamily: 'Inter_500Medium',
  },
  chartWrap: {
    marginTop: spacing.lg,
  },
  emptyWrap: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h4,
    color: colors.ink,
  },
  emptyBody: {
    ...typography.body,
    color: colors.charcoal,
  },
  skelHeadline: {
    height: 40,
    width: '48%',
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    opacity: 0.6,
  },
  skelChart: {
    marginTop: spacing.lg,
    height: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    opacity: 0.55,
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
    textAlign: 'center',
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
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: semantic.warning.bg,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  toastText: {
    ...typography.bodySmall,
    color: semantic.warning.fg,
    flex: 1,
  },
  toastDismiss: {
    ...typography.bodySmall,
    fontFamily: 'Inter_600SemiBold',
  },
});
