// src/components/command-center/CoachLtvDashboard.tsx
//
// LTV Dashboard — Coach Command Center add-on.
//
// Surfaced as a new section within OverviewScreen (inserted below the
// existing KPI tiles) or rendered standalone as a dedicated "LTV" tab.
//
// Data source: GET /coach/command-center/ltv-metrics
// Wired via commandCenterApi.getLtvMetrics() (defined below the component).
//
// Design:
//   - Big number display for RPCM and LTV (Baremetrics-style hero numbers)
//   - MRR trend arrow + semantic colour (green/amber/red)
//   - Zero-churn streak badge (Duolingo-style gamification)
//   - All-time peak RPCM record indicator
//   - "Next milestone" nudge card
//   - LTV:CAC placeholder (shows LTV, notes CAC requires manual input)
//   - Skeleton loading state
//   - Pull-to-refresh
//
// Doctrine: numbers over adjectives. We never fabricate data.
// Every section shows an honest empty-state if data is unavailable.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography, radius, shadows } from '../../theme/tokens';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LtvNextMilestone {
  clients_needed: number;
  mrr_target_cents: number;
  mrr_target_label: string;
}

export interface LtvMetrics {
  mrr_cents: number;
  mrr_label: string;
  active_client_count: number;
  revenue_per_client_month_cents: number;
  revenue_per_client_month_label: string;
  avg_client_lifespan_months: number;
  /** True when avg lifespan uses the 6-month industry-average stub (< 3 cancellations) */
  lifespan_is_estimate?: boolean;
  /** Explains why the lifespan is estimated; only present when lifespan_is_estimate is true */
  lifespan_estimate_note?: string | null;
  estimated_ltv_cents: number;
  estimated_ltv_label: string;
  churn_rate_pct: number;
  net_revenue_retention_pct: number;
  projected_annual_revenue_cents: number;
  projected_annual_revenue_label: string;
  mrr_trend: 'up' | 'flat' | 'down';
  mrr_30d_ago_cents: number;
  zero_churn_streak_months: number;
  all_time_peak_rpcm_cents: number;
  all_time_peak_rpcm_label: string;
  /** True when all-time peak RPCM is a heuristic estimate rather than a persisted record */
  peak_rpcm_is_estimate?: boolean;
  is_new_rpcm_record: boolean;
  ltv_cac_ratio: number | null;
  /** True when NRR is approximated from churn rate rather than actual expansion MRR */
  nrr_is_stub: boolean;
  next_milestone: LtvNextMilestone;
  currency: string;
  computed_at: string;
}

// ─── Mock data flag ─────────────────────────────────────────────────────────────
// Same pattern as commandCenterApi.ts — driven by env var.
const RAW = (process.env.EXPO_PUBLIC_USE_MOCK_COMMAND_CENTER || '').trim().toLowerCase();
const USING_MOCK = RAW === '1' || RAW === 'true';

const MOCK_LTV: LtvMetrics = {
  mrr_cents: 250000,
  mrr_label: '$2,500',
  active_client_count: 12,
  revenue_per_client_month_cents: 20833,
  revenue_per_client_month_label: '$208',
  avg_client_lifespan_months: 7.2,
  estimated_ltv_cents: 150000,
  estimated_ltv_label: '$1,500',
  churn_rate_pct: 8.3,
  net_revenue_retention_pct: 91.7,
  projected_annual_revenue_cents: 3000000,
  projected_annual_revenue_label: '$30,000',
  mrr_trend: 'up',
  mrr_30d_ago_cents: 230000,
  zero_churn_streak_months: 3,
  all_time_peak_rpcm_cents: 22500,
  all_time_peak_rpcm_label: '$225',
  is_new_rpcm_record: false,
  ltv_cac_ratio: null,
  nrr_is_stub: false,
  next_milestone: {
    clients_needed: 2,
    mrr_target_cents: 300000,
    mrr_target_label: '$3,000 / mo',
  },
  currency: 'usd',
  computed_at: new Date().toISOString(),
};

// ─── API call ───────────────────────────────────────────────────────────────────
// Imported from commandCenterApi after the backend PR merges. Defined inline
// here to keep the component self-contained for the PR.
async function fetchLtvMetrics(
  apiGet: (path: string) => Promise<{ data: LtvMetrics }>,
): Promise<LtvMetrics> {
  if (USING_MOCK) {
    await new Promise((r) => setTimeout(r, 600));
    return MOCK_LTV;
  }
  const res = await apiGet('/coach/command-center/ltv-metrics');
  return res.data;
}

// ─── Trend arrow ───────────────────────────────────────────────────────────────

const TREND_ARROW: Record<'up' | 'flat' | 'down', string> = {
  up: '↑',
  flat: '→',
  down: '↓',
};

const TREND_COLOR: Record<'up' | 'flat' | 'down', string> = {
  up: colors.forest,    // #2C4A36
  flat: colors.mutedGold, // #C5A253
  down: colors.error,   // #B91C1C
};

const TREND_LABEL: Record<'up' | 'flat' | 'down', string> = {
  up: 'Growing',
  flat: 'Holding',
  down: 'Declining',
};

// ─── Sub-components ─────────────────────────────────────────────────────────────

interface HeroNumberProps {
  label: string;
  value: string;
  sub?: string;
  badge?: React.ReactNode;
  testID?: string;
}

function HeroNumber({ label, value, sub, badge, testID }: HeroNumberProps) {
  return (
    <View style={heroStyles.container} testID={testID}>
      <Text style={heroStyles.label}>{label}</Text>
      <View style={heroStyles.valueRow}>
        <Text style={heroStyles.value} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {badge ?? null}
      </View>
      {sub ? <Text style={heroStyles.sub}>{sub}</Text> : null}
    </View>
  );
}

const heroStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    minHeight: 108,
    justifyContent: 'space-between',
    ...shadows.md,
  },
  label: {
    ...typography.eyebrow,
    color: colors.stone,
    marginBottom: spacing.xs,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  value: {
    fontSize: 36,
    fontWeight: '600',
    color: colors.ink,
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  sub: {
    ...typography.caption,
    color: colors.stone,
    marginTop: 2,
  },
});

// ─── Streak Badge ─────────────────────────────────────────────────────────────

function ZeroChurnBadge({ months }: { months: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  if (months === 0) return null;

  return (
    <Animated.View
      style={[badgeStyles.container, { opacity: fadeAnim }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${months}-month zero-churn streak`}
    >
      <Text style={badgeStyles.streakLabel}>STREAK</Text>
      <Text style={badgeStyles.count}>{months}</Text>
      <Text style={badgeStyles.label}>mo</Text>
    </Animated.View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.forest,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streakLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.bone,
    letterSpacing: 1.2,
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.bone,
  },
  label: {
    fontSize: 11,
    color: colors.bone,
    opacity: 0.85,
  },
});

// ─── Record Badge ──────────────────────────────────────────────────────────────

function RecordBadge() {
  return (
    <View style={recStyles.container}>
      <Text style={recStyles.text}>RECORD</Text>
    </View>
  );
}

const recStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.mutedGold,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.bone,
    letterSpacing: 1.1,
  },
});

// ─── Trend Chip ────────────────────────────────────────────────────────────────

function TrendChip({ trend, deltaLabel }: { trend: 'up' | 'flat' | 'down'; deltaLabel: string }) {
  const color = TREND_COLOR[trend];
  return (
    <View style={[trendStyles.chip, { borderColor: color }]}>
      <Text style={[trendStyles.arrow, { color }]}>{TREND_ARROW[trend]}</Text>
      <Text style={[trendStyles.text, { color }]}>{deltaLabel}</Text>
    </View>
  );
}

const trendStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  arrow: { fontSize: 13, fontWeight: '600' },
  text: { fontSize: 12, fontWeight: '600' },
});

// ─── Stat Row ──────────────────────────────────────────────────────────────────

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={statRowStyles.row}>
      <View style={{ flex: 1 }}>
        <Text style={statRowStyles.label}>{label}</Text>
        {hint ? <Text style={statRowStyles.hint}>{hint}</Text> : null}
      </View>
      <Text style={statRowStyles.value}>{value}</Text>
    </View>
  );
}

const statRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.camel,
  },
  label: {
    ...typography.body,
    color: colors.charcoal,
  },
  hint: {
    ...typography.caption,
    color: colors.stone,
    marginTop: 1,
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
});

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonLtvDashboard() {
  const shimmer = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    ).start();
  }, [shimmer]);

  return (
    <Animated.View
      style={{ opacity: shimmer }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Section header placeholder */}
      <View style={[skStyles.line, { width: 140, height: 12, marginBottom: spacing.lg }]} />

      {/* Hero row */}
      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
        <View style={[skStyles.heroCard]}>
          <View style={[skStyles.line, { width: 60, height: 10, marginBottom: spacing.sm }]} />
          <View style={[skStyles.line, { width: 90, height: 36, marginBottom: 6 }]} />
          <View style={[skStyles.line, { width: 70, height: 9 }]} />
        </View>
        <View style={[skStyles.heroCard]}>
          <View style={[skStyles.line, { width: 60, height: 10, marginBottom: spacing.sm }]} />
          <View style={[skStyles.line, { width: 90, height: 36, marginBottom: 6 }]} />
          <View style={[skStyles.line, { width: 70, height: 9 }]} />
        </View>
      </View>

      {/* Stats block */}
      <View style={skStyles.statsCard}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={{ paddingVertical: 10, borderBottomWidth: i < 4 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.camel }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={[skStyles.line, { width: 120, height: 12 }]} />
              <View style={[skStyles.line, { width: 50, height: 12 }]} />
            </View>
          </View>
        ))}
      </View>

      {/* Milestone card */}
      <View style={[skStyles.milestoneCard, { height: 80, marginTop: spacing.md }]} />
    </Animated.View>
  );
}

const skStyles = StyleSheet.create({
  line: {
    backgroundColor: colors.camel,
    borderRadius: 4,
    opacity: 0.3,
  },
  heroCard: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 108,
    opacity: 0.6,
  },
  statsCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    opacity: 0.6,
  },
  milestoneCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    opacity: 0.6,
  },
});

// ─── Main component ─────────────────────────────────────────────────────────────

interface CoachLtvDashboardProps {
  /** Injected api.get — matches the signature used in commandCenterApi.ts. */
  apiGet: (path: string) => Promise<{ data: unknown }>;
  /** If true, renders the component inline (no ScrollView wrapper). */
  inlineMode?: boolean;
}

export default function CoachLtvDashboard({
  apiGet,
  inlineMode = false,
}: CoachLtvDashboardProps) {
  const [metrics, setMetrics] = useState<LtvMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setLoading(true);
      setError(null);
      try {
        const data = await fetchLtvMetrics(
          apiGet as (path: string) => Promise<{ data: LtvMetrics }>,
        );
        setMetrics(data);
      } catch (err) {
        setError('Unable to load LTV metrics. Check your connection.');
        if (__DEV__) console.warn('[CoachLtvDashboard]', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiGet],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  // Delta label for trend chip (e.g. "+$200" or "-$100")
  const deltaLabel = useMemo(() => {
    if (!metrics) return '';
    const delta = metrics.mrr_cents - metrics.mrr_30d_ago_cents;
    const sign = delta >= 0 ? '+' : '';
    const dollars = Math.abs(delta) / 100;
    return `${sign}$${Math.round(dollars)}`;
  }, [metrics]);

  const content = loading ? (
    <SkeletonLtvDashboard />
  ) : error && !metrics ? (
    <View
      style={errorStyles.container}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={error}
    >
      <Text style={errorStyles.message}>{error}</Text>
      <TouchableOpacity
        style={errorStyles.retryBtn}
        onPress={() => load(false)}
        accessibilityRole="button"
        accessibilityLabel="Retry loading LTV metrics"
      >
        <Text style={errorStyles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  ) : metrics ? (
    <LtvContent
      metrics={metrics}
      deltaLabel={deltaLabel}
    />
  ) : null;

  if (inlineMode) {
    return <View testID="ltv-dashboard">{content}</View>;
  }

  return (
    <ScrollView
      testID="ltv-dashboard"
      contentContainerStyle={scrollStyles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.forest}
        />
      }
    >
      {content}
    </ScrollView>
  );
}

// ─── LTV Content (separated for testability) ───────────────────────────────────

function LtvContent({
  metrics,
  deltaLabel,
}: {
  metrics: LtvMetrics;
  deltaLabel: string;
}) {
  const mrr = metrics.mrr_cents / 100;
  const mrrFormatted = metrics.mrr_label;
  const hasRevenue = metrics.mrr_cents > 0;

  return (
    <View>
      {/* ── Section header ─────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Revenue & LTV</Text>
        {hasRevenue && (
          <TrendChip
            trend={metrics.mrr_trend}
            deltaLabel={deltaLabel}
          />
        )}
      </View>
      <Text style={styles.sectionSubtitle}>
        {TREND_LABEL[metrics.mrr_trend]} · {metrics.active_client_count} active{' '}
        {metrics.active_client_count === 1 ? 'client' : 'clients'}
      </Text>

      {/* ── Hero numbers ───────────────────────────────────────────────── */}
      <View style={styles.heroRow}>
        <HeroNumber
          label="Rev / client / mo"
          value={metrics.revenue_per_client_month_label}
          sub={`MRR: ${mrrFormatted}`}
          badge={metrics.is_new_rpcm_record ? <RecordBadge /> : undefined}
          testID="ltv-hero-rpcm"
        />
        <View style={styles.heroSpacer} />
        <HeroNumber
          label={metrics.lifespan_is_estimate ? 'Avg client LTV (est.)' : 'Avg client LTV'}
          value={metrics.estimated_ltv_label}
          sub={`${(metrics.avg_client_lifespan_months ?? 0).toFixed(1)} mo avg life`}
          testID="ltv-hero-ltv"
        />
      </View>

      {/* ── Zero-churn streak ──────────────────────────────────────────── */}
      {metrics.zero_churn_streak_months > 0 && (
        <View style={styles.streakRow} testID="ltv-streak-badge">
          <ZeroChurnBadge months={metrics.zero_churn_streak_months} />
          <Text style={styles.streakCaption}>
            {metrics.zero_churn_streak_months === 1
              ? '1 month of zero churn'
              : `${metrics.zero_churn_streak_months} consecutive months of zero churn`}
            {metrics.zero_churn_streak_months >= 6
              ? ' — exceptional retention!'
              : metrics.zero_churn_streak_months >= 3
              ? ' — keep it up'
              : ''}
          </Text>
        </View>
      )}

      {/* ── All-time peak ─────────────────────────────────────────────── */}
      {metrics.all_time_peak_rpcm_cents > 0 && (
        <View style={styles.peakRow}>
          <Text style={styles.peakLabel}>
            All-time peak RPCM:{' '}
            <Text style={styles.peakValue}>{metrics.all_time_peak_rpcm_label}</Text>
          </Text>
        </View>
      )}

      {/* ── Estimate disclaimer banner ──────────────────────────────────── */}
      {(metrics.lifespan_is_estimate || metrics.nrr_is_stub || metrics.peak_rpcm_is_estimate) && (
        <View style={styles.estimateDisclaimer} testID="ltv-estimate-disclaimer">
          <Text style={styles.estimateDisclaimerText}>
            Some metrics are based on available data and may not reflect exact figures.
            Values marked “(est.)” will update automatically as more data is collected.
          </Text>
        </View>
      )}

      {/* ── Stats block ─────────────────────────────────────────────────── */}
      <View style={styles.statsCard} testID="ltv-stats-card">
        <Text style={styles.statsTitle}>Metrics detail</Text>
        <StatRow
          label="MRR"
          value={mrrFormatted}
          hint="Monthly Recurring Revenue"
        />
        <StatRow
          label="Churn rate"
          value={`${metrics.churn_rate_pct}%`}
          hint="Recurring clients canceled this month"
        />
        <StatRow
          label={metrics.nrr_is_stub ? 'Net Revenue Retention (est.)' : 'Net Revenue Retention'}
          value={`${metrics.net_revenue_retention_pct}%`}
          hint={
            metrics.nrr_is_stub
              ? 'Approximated from churn rate — connect billing for an exact figure'
              : metrics.net_revenue_retention_pct >= 100
              ? 'Expansion > churn — strong'
              : 'Below 100% — churn is outpacing growth'
          }
        />
        <StatRow
          label={
            metrics.lifespan_is_estimate
              ? 'Avg client lifespan (est.)'
              : 'Avg client lifespan'
          }
          value={`${(metrics.avg_client_lifespan_months ?? 0).toFixed(1)} mo`}
          hint={
            metrics.lifespan_is_estimate && metrics.lifespan_estimate_note
              ? metrics.lifespan_estimate_note
              : 'Mean duration of active recurring subscriptions'
          }
        />
        <StatRow
          label="Projected annual revenue"
          value={metrics.projected_annual_revenue_label}
          hint="Current MRR × 12 (flat projection)"
        />
        <StatRow
          label="LTV:CAC ratio"
          value="—"
          hint="Add your CAC in Settings to unlock this"
        />
      </View>

      {/* ── Next milestone card ───────────────────────────────────────── */}
      {metrics.next_milestone.clients_needed > 0 && (
        <View style={styles.milestoneCard} testID="ltv-milestone-card">
          <Text style={styles.milestoneHeading}>Next milestone</Text>
          <Text style={styles.milestoneBody}>
            <Text style={styles.milestoneHighlight}>
              {metrics.next_milestone.clients_needed} more{' '}
              {metrics.next_milestone.clients_needed === 1 ? 'client' : 'clients'}
            </Text>{' '}
            at your current ARPC of{' '}
            <Text style={styles.milestoneHighlight}>
              {metrics.revenue_per_client_month_label}/mo
            </Text>{' '}
            puts you at{' '}
            <Text style={styles.milestoneHighlight}>
              {metrics.next_milestone.mrr_target_label}
            </Text>{' '}
            MRR.
          </Text>
        </View>
      )}

      {/* ── CAC placeholder note ──────────────────────────────────────── */}
      <View style={styles.cacNote}>
        <Text style={styles.cacNoteText}>
          LTV:CAC requires your client acquisition cost.{' '}
          <Text style={styles.cacNoteLink}>Add CAC in Settings →</Text>
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.ink,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.stone,
    marginBottom: spacing.md,
  },

  // Hero row
  heroRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  heroSpacer: { width: spacing.md },

  // Streak
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  streakCaption: {
    ...typography.caption,
    color: colors.charcoal,
    flex: 1,
  },

  // Peak
  peakRow: {
    marginBottom: spacing.sm,
  },
  peakLabel: {
    ...typography.caption,
    color: colors.stone,
  },
  peakValue: {
    color: colors.ink,
    fontWeight: '600',
  },

  // Stats card
  statsCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...shadows.md,
  },
  statsTitle: {
    ...typography.eyebrow,
    color: colors.stone,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },

  // Milestone card
  milestoneCard: {
    backgroundColor: colors.forest,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  milestoneHeading: {
    ...typography.eyebrow,
    color: colors.bone,
    opacity: 0.75,
    marginBottom: spacing.xs,
  },
  milestoneBody: {
    fontSize: 15,
    color: colors.bone,
    lineHeight: 22,
  },
  milestoneHighlight: {
    fontWeight: '600',
    color: colors.bone,
  },

  // CAC note
  cacNote: {
    marginBottom: spacing.xl,
  },
  cacNoteText: {
    ...typography.caption,
    color: colors.stone,
    lineHeight: 16,
  },
  cacNoteLink: {
    color: colors.forest,
    fontWeight: '500',
  },
  // Estimate disclaimer banner — shown when any metric is approximate.
  estimateDisclaimer: {
    backgroundColor: colors.camel + '33', // 20% opacity camel
    borderLeftWidth: 3,
    borderLeftColor: colors.mutedGold,
    borderRadius: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  estimateDisclaimerText: {
    ...typography.caption,
    color: colors.charcoal,
    lineHeight: 16,
  },
});

// Error styles
const errorStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.xl,
  },
  message: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryBtn: {
    backgroundColor: colors.forest,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  retryText: {
    ...typography.caption,
    color: colors.bone,
  },
});

const scrollStyles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
});
