/**
 * CrossPillarClientDetailScreen — unified per-client EHR view.
 *
 * Three tabs:
 *   1. Body — fitness 7d activity (food logs, workouts, coach messages),
 *      coach pointer, archived state.
 *   2. Wealth — finance net-worth roll-up, debt/asset/cash totals, last
 *      EOD, 7d activity (EOD, what-if, coach notes). Renders an
 *      "unavailable" pill if the finance call degraded.
 *   3. Both — side-by-side metrics + a holistic-insights panel that
 *      auto-detects a small set of correlations on the available data.
 *      Insights are computed locally on this screen so the API stays a
 *      pure read.
 *
 * The route param is `email` today (the durable identity key). When a
 * shared `account_id` ships, the route param swaps without changing the
 * screen.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { crossPillarApi } from '../../../services/api';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { Typography } from '../../../theme';
import type { CrossPillarClientResponse } from '../../../types/crossPillar';
import type { CrossPillarStackParamList } from './CrossPillarNavigator';

type Nav = NativeStackNavigationProp<CrossPillarStackParamList, 'CrossPillarClientDetail'>;
type Route = RouteProp<CrossPillarStackParamList, 'CrossPillarClientDetail'>;

type Tab = 'body' | 'wealth' | 'both';

const TABS: { id: Tab; label: string }[] = [
  { id: 'body',   label: 'Body' },
  { id: 'wealth', label: 'Wealth' },
  { id: 'both',   label: 'Both' },
];

export default function CrossPillarClientDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { email, name } = route.params;

  const [data, setData] = useState<CrossPillarClientResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('both');

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const { data } = await crossPillarApi.getClient(email);
        setData(data);
      } catch (err: unknown) {
        setError(toMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [email],
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={colors.textSecondary}
        />
      }
    >
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>CLIENT</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={styles.eyebrow}>UNIFIED PROFILE</Text>
      <Text style={styles.headline}>{name || email}</Text>
      <Text style={styles.lede}>{email}</Text>

      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${t.label} tab`}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Couldn't load profile</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => load('initial')} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : data ? (
        <>
          {tab === 'body' ? <BodyPanel data={data} styles={styles} /> : null}
          {tab === 'wealth' ? <WealthPanel data={data} styles={styles} /> : null}
          {tab === 'both' ? <BothPanel data={data} styles={styles} colors={colors} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function BodyPanel({
  data,
  styles,
}: {
  data: CrossPillarClientResponse;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (!data.fitness) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyTitle}>Not signed up for Body</Text>
        <Text style={styles.emptyBody}>
          This client only exists on the Wealth side under {data.email}.
        </Text>
      </View>
    );
  }
  const f = data.fitness;
  return (
    <View style={styles.panel}>
      <Stat styles={styles} label="ROLE"          value={f.role.toUpperCase()} />
      <Stat styles={styles} label="JOINED"        value={dateString(f.created_at)} />
      <Stat
        styles={styles}
        label="ARCHIVED"
        value={f.archived_at ? dateString(f.archived_at) : 'No'}
      />
      <Text style={styles.sectionLabel}>LAST 7 DAYS</Text>
      <Stat styles={styles} label="FOOD LOGS"      value={String(f.activity_last_7d.food_logs)} />
      <Stat styles={styles} label="WORKOUTS"       value={String(f.activity_last_7d.workouts)} />
      <Stat styles={styles} label="COACH MESSAGES" value={String(f.activity_last_7d.coach_messages)} />
    </View>
  );
}

// ─── Wealth ───────────────────────────────────────────────────────────────────

function WealthPanel({
  data,
  styles,
}: {
  data: CrossPillarClientResponse;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (data.finance.status !== 'ok' || !data.finance.data) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.emptyTitle}>
          {data.finance.status === 'not_found' ? 'Not signed up for Wealth' : 'Wealth temporarily unavailable'}
        </Text>
        <Text style={styles.emptyBody}>
          {data.finance.status === 'not_found'
            ? `This client is in Body under ${data.email} but has no Wealth account.`
            : `Status: ${data.finance.status}. ${data.finance.detail ?? ''}`}
        </Text>
      </View>
    );
  }
  const f = data.finance.data;
  return (
    <View style={styles.panel}>
      <Stat styles={styles} label="NET WORTH"     value={formatMoneyOrDash(f.net_worth)} />
      <Stat styles={styles} label="ASSETS"        value={formatMoneyOrDash(f.asset_total)} />
      <Stat styles={styles} label="DEBT"          value={formatMoneyOrDash(f.debt_total)} />
      <Stat styles={styles} label="CASH"          value={formatMoneyOrDash(f.cash_total)} />
      <Stat styles={styles} label="VELOCITY"      value={f.wealth_velocity_score ?? '—'} />
      <Stat
        styles={styles}
        label="LAST EOD"
        value={f.last_eod_date ? dateString(f.last_eod_date) : 'Never'}
      />
      <Text style={styles.sectionLabel}>LAST 7 DAYS</Text>
      <Stat styles={styles} label="EOD SUBMISSIONS" value={String(f.activity_last_7d.eod_submissions)} />
      <Stat styles={styles} label="WHAT-IF SCENARIOS" value={String(f.activity_last_7d.what_if_scenarios)} />
      <Stat styles={styles} label="COACH NOTES"     value={String(f.activity_last_7d.coach_notes)} />
    </View>
  );
}

// ─── Both ─────────────────────────────────────────────────────────────────────

function BothPanel({
  data,
  styles,
  colors,
}: {
  data: CrossPillarClientResponse;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const insights = useMemo(() => deriveInsights(data), [data]);
  return (
    <>
      <View style={styles.gridRow}>
        <View style={styles.gridCol}>
          <Text style={styles.colHeader}>BODY</Text>
          {data.fitness ? (
            <>
              <Stat styles={styles} label="FOOD LOGS 7d"  value={String(data.fitness.activity_last_7d.food_logs)} />
              <Stat styles={styles} label="WORKOUTS 7d"   value={String(data.fitness.activity_last_7d.workouts)} />
              <Stat styles={styles} label="MESSAGES 7d"   value={String(data.fitness.activity_last_7d.coach_messages)} />
            </>
          ) : (
            <Text style={styles.absentText}>Not on Body</Text>
          )}
        </View>
        <View style={styles.gridDivider} />
        <View style={styles.gridCol}>
          <Text style={styles.colHeader}>WEALTH</Text>
          {data.finance.status === 'ok' && data.finance.data ? (
            <>
              <Stat styles={styles} label="NET WORTH"   value={formatMoneyOrDash(data.finance.data.net_worth)} />
              <Stat styles={styles} label="EOD 7d"      value={String(data.finance.data.activity_last_7d.eod_submissions)} />
              <Stat styles={styles} label="VELOCITY"    value={data.finance.data.wealth_velocity_score ?? '—'} />
            </>
          ) : (
            <Text style={styles.absentText}>
              {data.finance.status === 'not_found' ? 'Not on Wealth' : 'Wealth unavailable'}
            </Text>
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>HOLISTIC INSIGHTS</Text>
      {insights.length === 0 ? (
        <View style={styles.insightEmpty}>
          <Ionicons name="leaf-outline" size={18} color={colors.textMuted} />
          <Text style={styles.insightEmptyText}>
            Not enough cross-pillar signal yet. Insights appear when this client
            has activity in both Body and Wealth in the last 7 days.
          </Text>
        </View>
      ) : (
        insights.map((i, idx) => (
          <View key={`insight-${idx}`} style={styles.insight}>
            <Ionicons name={i.icon} size={18} color={colors.textPrimary} />
            <Text style={styles.insightText}>{i.text}</Text>
          </View>
        ))
      )}
    </>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

interface Insight {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}

function deriveInsights(data: CrossPillarClientResponse): Insight[] {
  const out: Insight[] = [];
  const fit = data.fitness?.activity_last_7d;
  const fin = data.finance.status === 'ok' ? data.finance.data?.activity_last_7d : null;

  if (fit && fin) {
    if (fit.workouts >= 3 && fin.eod_submissions >= 5) {
      out.push({
        icon: 'trending-up',
        text: 'Strong week on both pillars — workouts + EODs are both compounding.',
      });
    }
    if (fit.workouts === 0 && fin.eod_submissions === 0) {
      out.push({
        icon: 'flag-outline',
        text: 'Quiet on both pillars in the last 7 days. A check-in may help.',
      });
    }
    if (fit.coach_messages > 0 && fin.coach_notes === 0) {
      out.push({
        icon: 'chatbubbles-outline',
        text: 'Active in Body messages, no Wealth coach notes yet — opportunity for cross-pillar context.',
      });
    }
  }

  if (data.finance.status === 'ok' && data.finance.data) {
    const f = data.finance.data;
    if (f.net_worth !== null && f.debt_total !== null && f.debt_total > 0 && f.net_worth < 0) {
      out.push({
        icon: 'alert-circle-outline',
        text: 'Net worth below zero — debt pay-down may be the highest-leverage focus.',
      });
    }
  }

  return out;
}

function Stat({
  styles,
  label,
  value,
}: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  value: string | number;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{String(value)}</Text>
    </View>
  );
}

function dateString(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function formatMoneyOrDash(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function toMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'Something went wrong.');
  }
  return 'Something went wrong.';
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 80 },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 16,
    },
    backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', ...Typography.label, color: colors.textSecondary },
    eyebrow: { ...Typography.label, color: colors.textSecondary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      lineHeight: 32,
      color: colors.textPrimary,
      marginTop: 4,
    },
    lede: { ...Typography.caption, color: colors.textMuted, marginTop: 4, marginBottom: 24 },
    tabRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    tabBtnActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale ?? colors.surface,
    },
    tabText: { ...Typography.label, color: colors.textSecondary },
    tabTextActive: { color: colors.primary },
    panel: {
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    sectionLabel: {
      ...Typography.label,
      color: colors.textMuted,
      letterSpacing: 1.5,
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 16,
    },
    stat: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    statLabel: { ...Typography.label, color: colors.textMuted },
    statValue: {
      fontFamily: 'JetBrainsMono_400Regular',
      fontSize: 14,
      color: colors.textPrimary,
    },
    gridRow: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
    },
    gridCol: { flex: 1, paddingVertical: 8 },
    gridDivider: { width: 0.5, backgroundColor: colors.border },
    colHeader: {
      ...Typography.label,
      color: colors.textMuted,
      letterSpacing: 1.5,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    absentText: {
      ...Typography.caption,
      color: colors.textMuted,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontStyle: 'italic',
    },
    insight: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 8,
    },
    insightText: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textPrimary,
    },
    insightEmpty: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
    },
    insightEmptyText: {
      flex: 1,
      ...Typography.caption,
      color: colors.textMuted,
      fontStyle: 'italic',
    },
    loadingBlock: { paddingVertical: 48, alignItems: 'center' },
    emptyBlock: {
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      gap: 8,
    },
    emptyTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    emptyBody: { ...Typography.caption, color: colors.textMuted },
    errorBlock: {
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      gap: 8,
    },
    errorTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    errorBody: { ...Typography.caption, color: colors.textMuted },
    retryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.primary },
  });
