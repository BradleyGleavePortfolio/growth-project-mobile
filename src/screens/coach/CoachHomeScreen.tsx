import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';

import { getGreeting } from '../../utils/date';

import FadeInView from '../../components/FadeInView';
import { coachApi } from '../../services/api';
import { ptmApi } from '../../services/ptmApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { SkeletonStatTile } from '../../ui/skeletons';
import StripeSetupBanner from '../../components/coach/StripeSetupBanner';
import NewClientBanner from '../../components/coach/NewClientBanner';


interface RedFlagClient {
  id: string;
  name: string;
  trend: string;
}

interface RiskBucketCounts {
  red: number;
  amber: number;
  green: number;
}

export default function CoachHomeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const { clients, isLoading, loadError, loadClients } = useCoachStore();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [refreshing, setRefreshing] = useState(false);
  const [redFlagClients, setRedFlagClients] = useState<RedFlagClient[]>([]);
  const [overdueClients, setOverdueClients] = useState<string[]>([]);
  const [dashboard, setDashboard] = useState<{ logs_today: number; total_kcal: number; logging_rate: number } | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [riskCounts, setRiskCounts] = useState<RiskBucketCounts | null>(null);
  const isOwner = currentUser?.role === 'owner';

  const fetchDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const res = await coachApi.getDashboard();
      setDashboard(res.data);
    } catch (err) {
      console.error('CoachHomeScreen: fetchDashboard failed', err);
      setDashboardError('Could not load dashboard.');
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const detectRedFlags = useCallback(async () => {
    try {
      // Use the pre-aggregated summary endpoint — it scales to 100+ clients
      // via parallel Prisma aggregations rather than loading all client rows.
      // Falls back to the legacy alerts endpoint if the summary endpoint is
      // unavailable (e.g. older backend deployment).
      type SummaryItem = { client_id: string; client_name: string; reason: string };
      type Summary = { attention_needed: SummaryItem[] };

      let attentionNeeded: SummaryItem[] = [];
      try {
        const summaryRes = await coachApi.getDashboardSummary();
        attentionNeeded = (summaryRes.data as Summary)?.attention_needed || [];
      } catch {
        // Summary endpoint not yet available — fall back to legacy alerts.
        const alertsRes = await coachApi.getAlerts();
        type Alert = { type: string; client_id: string; client_name: string; message: string };
        const alerts: Alert[] = (alertsRes.data as Alert[] | undefined) || [];
        attentionNeeded = alerts.map((a) => ({
          client_id: a.client_id,
          client_name: a.client_name,
          reason: a.type === 'weight_increasing' ? 'weight_flag' : 'missed_workout',
        }));
      }

      const flags: RedFlagClient[] = attentionNeeded
        .filter((a) => a.reason === 'weight_flag')
        .map((a) => ({
          id: a.client_id,
          name: a.client_name,
          trend: `${a.client_name} weight has increased 3+ consecutive days`,
        }));
      setRedFlagClients(flags);

      const missed = attentionNeeded
        .filter((a) => a.reason === 'missed_workout')
        .map((a) => a.client_name);
      setOverdueClients(missed);
    } catch (err) {
      // Alerts tile stays empty on failure — not a destructive write.
      console.error('CoachHomeScreen: detectRedFlags failed', err);
    }
  }, []);

  const load = useCallback(async () => {
    if (!currentUser) return;
    await loadClients(currentUser.id);
  }, [currentUser?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // PTM Risk-Board widget — OWNER-gated for Phase 1E because the underlying
  // endpoint is OWNER-only on the backend. A coach-scoped variant lands later.
  useEffect(() => {
    if (!isOwner) return;
    let mounted = true;
    (async () => {
      try {
        const res = await ptmApi.getRiskBoard({ limit: 100 });
        if (!mounted) return;
        const counts: RiskBucketCounts = { red: 0, amber: 0, green: 0 };
        for (const item of res.data.items) counts[item.bucket] += 1;
        setRiskCounts(counts);
      } catch (err) {
        // Widget is supplemental — log and leave the cards hidden on failure.
        console.error('CoachHomeScreen: risk-board widget fetch failed', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isOwner]);

  useEffect(() => {
    if (clients.length > 0) {
      detectRedFlags();
    }
  }, [clients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const activeClients = clients.filter((c) => c.status === 'active').length;
  const logsToday = dashboard?.logs_today ?? 0;
  const totalKcal = dashboard?.total_kcal ?? 0;
  const loggingRateDisplay = dashboard
    ? `${Math.round(dashboard.logging_rate * 100)}%`
    : '--';

  if (isLoading && !refreshing) {
    return (
      <View style={[styles.loadingContainer, styles.skeletonContainer]}>
        <View style={styles.skeletonGrid}>
          <SkeletonStatTile />
          <SkeletonStatTile />
        </View>
        <View style={styles.skeletonGrid}>
          <SkeletonStatTile />
          <SkeletonStatTile />
        </View>
      </View>
    );
  }

  // Audit P1: error/retry surface for the cold-start failure case. If both
  // the clients load and the dashboard load failed AND we have nothing
  // cached to show, render a retry block instead of an empty layout.
  const hasNothing = clients.length === 0 && !dashboard;
  if (hasNothing && (loadError || dashboardError)) {
    return (
      <View style={[styles.loadingContainer, { paddingHorizontal: 32, gap: 12 }]}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>
          {loadError ?? dashboardError}
        </Text>
        <HapticPressable
          intent="medium"
          onPress={() => {
            load();
            fetchDashboard();
          }}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={{
            backgroundColor: colors.primary,
            paddingVertical: 12,
            paddingHorizontal: 24,
            borderRadius: 4,
            marginTop: 8,
          }}
        >
          <Text style={{ color: colors.textOnPrimary, fontWeight: '600', letterSpacing: 1.1, textTransform: 'uppercase' }}>
            Try again
          </Text>
        </HapticPressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Stripe setup banner — only shows when Stripe not yet configured */}
      <StripeSetupBanner />
      {/* Post-Stripe-return detection banner — auto-dismisses after 4s */}
      <NewClientBanner />

      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}, {currentUser?.firstName || 'Coach'}</Text>
          <Text style={styles.subtitle}>Here's your coaching overview</Text>
        </View>
        <View style={styles.headerActions}>
          {/*
            Audit fix Coach #8: header pill that lands the coach on
            the invite-codes screen. Without this, a brand-new coach
            with zero clients had to find Settings -> Invite Codes
            manually. Mirrors the finance app's header-pill pattern.
          */}
          <HapticPressable
            intent="light"
            style={styles.invitePill}
            onPress={() =>
              navigation.navigate('ClientsStack', { screen: 'InviteCodes' })
            }
            accessibilityRole="button"
            accessibilityLabel="Invite codes"
            accessibilityHint="Opens the invite-codes screen so you can add a client"
            testID="coach-home-invite-pill"
          >
            <Ionicons name="person-add-outline" size={16} color={colors.primary} />
            <Text style={styles.invitePillText}>Invite</Text>
          </HapticPressable>
          <HapticPressable
            intent="light"
            style={styles.settingsBtn}
            onPress={() => navigation.navigate('SettingsStack')}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            testID="coach-home-settings-button"
          >
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </HapticPressable>
        </View>
      </View>

      {/* Key Metrics */}
      <FadeInView>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: colors.primaryPale }]}>
              <Ionicons name="people" size={22} color={colors.primary} />
            </View>
            <Text style={styles.metricValue}>{activeClients}</Text>
            <Text style={styles.metricLabel}>Active Clients</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: colors.macroCarbsChipBg }]}>
              <Ionicons name="restaurant" size={22} color={colors.carbs} />
            </View>
            {dashboardLoading ? (
                <SkeletonStatTile />
              ) : (
                <Text style={styles.metricValue}>{logsToday}</Text>
              )}
            <Text style={styles.metricLabel}>Logs Today</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: colors.noticeWarningIconBg }]}>
              <Ionicons name="restaurant-outline" size={22} color={colors.fat} />
            </View>
            {dashboardLoading ? (
                <SkeletonStatTile />
              ) : (
                <Text style={styles.metricValue}>{totalKcal.toLocaleString()}</Text>
              )}
            <Text style={styles.metricLabel}>Total kcal</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: colors.primaryPale }]}>
              <Ionicons name="checkmark-circle" size={22} color={colors.primaryLight} />
            </View>
            {dashboardLoading ? (
                <SkeletonStatTile />
              ) : (
                <Text style={styles.metricValue}>{loggingRateDisplay}</Text>
              )}
            <Text style={styles.metricLabel}>Logging Rate</Text>
          </View>
        </View>
      </FadeInView>

      {/* PTM Risk Board widget — OWNER only in Phase 1E */}
      {isOwner && riskCounts && (
        <FadeInView>
          <Text style={styles.sectionTitle}>Risk Board</Text>
          <HapticPressable
            intent="medium"
            style={styles.riskWidgetRow}
            onPress={() =>
              navigation.navigate('ClientsStack', { screen: 'RiskBoard' })
            }
            accessibilityRole="button"
            accessibilityLabel="Open Risk Board"
          >
            <View style={[styles.riskCard, { borderLeftColor: colors.error }]}>
              <Text style={styles.riskCount}>{riskCounts.red}</Text>
              <Text style={styles.riskLabel}>Red</Text>
            </View>
            <View style={[styles.riskCard, { borderLeftColor: colors.warning }]}>
              <Text style={styles.riskCount}>{riskCounts.amber}</Text>
              <Text style={styles.riskLabel}>Amber</Text>
            </View>
            <View style={[styles.riskCard, { borderLeftColor: colors.success }]}>
              <Text style={styles.riskCount}>{riskCounts.green}</Text>
              <Text style={styles.riskLabel}>Green</Text>
            </View>
          </HapticPressable>
        </FadeInView>
      )}

      {/* Red flag clients */}
      {redFlagClients.length > 0 && (
        <FadeInView>
          <Text style={styles.sectionTitle}>Weight Trend Alerts</Text>
          {redFlagClients.map((rf) => (
            <HapticPressable
              key={rf.id}
              intent="medium"
              style={styles.redFlagCard}
              onPress={() =>
                navigation.navigate('ClientsStack', {
                  screen: 'ClientDetail',
                  params: { clientId: rf.id, clientName: rf.name },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`View client ${rf.name}, weight trending up`}
              testID={`coach-home-red-flag-${rf.id}`}
            >
              <View style={styles.redFlagLeft}>
                <Ionicons name="warning" size={22} color={colors.warning} />
                <View>
                  <Text style={styles.redFlagName}>{rf.name}</Text>
                  <Text style={styles.redFlagTrend}>Weight trending up · {rf.trend}</Text>
                </View>
              </View>
              <View style={styles.viewClientBtn}>
                <Text style={styles.viewClientBtnText}>View</Text>
              </View>
            </HapticPressable>
          ))}
        </FadeInView>
      )}

      {/* Overdue Check-ins */}
      {overdueClients.length > 0 && (
        <FadeInView>
          <Text style={styles.sectionTitle}>Overdue Check-ins</Text>
          <View style={styles.overdueCard}>
            <Text style={styles.overdueSubtitle}>No food log in last 3 days</Text>
            {overdueClients.slice(0, 5).map((name, idx) => (
              <View key={idx} style={styles.overdueRow}>
                <View style={styles.overdueDot} />
                <Text style={styles.overdueName}>{name}</Text>
              </View>
            ))}
            {overdueClients.length > 5 && (
              <Text style={styles.overdueMore}>+{overdueClients.length - 5} more</Text>
            )}
          </View>
        </FadeInView>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <HapticPressable
          intent="medium"
          style={styles.actionCard}
          onPress={() => navigation.navigate('ClientsStack')}
          accessibilityRole="button"
          accessibilityLabel="View clients"
          testID="coach-home-view-clients"
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.primaryPale }]}>
            <Ionicons name="people-outline" size={22} color={colors.primary} />
          </View>
          <Text style={styles.actionText}>View Clients</Text>
        </HapticPressable>
        <HapticPressable
          intent="medium"
          style={styles.actionCard}
          onPress={() => navigation.navigate('Messages')}
          accessibilityRole="button"
          accessibilityLabel="Open messages"
          testID="coach-home-messages"
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.macroCarbsChipBg }]}>
            <Ionicons name="chatbubble-outline" size={22} color={colors.carbs} />
          </View>
          <Text style={styles.actionText}>Messages</Text>
        </HapticPressable>
      </View>

      <View style={styles.actionsRow}>
        <HapticPressable
          intent="medium"
          style={styles.actionCard}
          onPress={() =>
            navigation.navigate('ClientsStack', { screen: 'RiskBoard' })
          }
          accessibilityRole="button"
          accessibilityLabel="Risk Board"
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.primaryPale }]}>
            <Ionicons name="pulse-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionText}>Risk Board</Text>
            <Text style={styles.actionSubtext}>
              Clients sorted by churn risk
            </Text>
          </View>
        </HapticPressable>
      </View>

      {/* When both alert lists are empty we render an explicit "all clear"
          state under Recent Activity. The previous "Activity feed coming
          soon" copy violated the no-placeholder doctrine and made the
          dashboard look unfinished even when data was present. */}
      {redFlagClients.length === 0 && overdueClients.length === 0 && (
        <FadeInView>
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Recent Activity</Text>
          <View style={styles.emptyActivity}>
            <Ionicons name="checkmark-circle-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>No new client signals.</Text>
            <Text style={styles.emptySub}>
              Weight-trend and missed-check-in alerts will appear here when they fire.
            </Text>
          </View>
        </FadeInView>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 60, paddingBottom: 100 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingTop: 24,
    gap: 8,
  },
  skeletonGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  greeting: { fontSize: 26, fontWeight: '500', color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  invitePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primaryPale,
  },
  invitePillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    letterSpacing: 0.2,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 28,
  },
  metricCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    gap: 8,
    flexGrow: 1,
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 2, // radius.md
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricValue: { fontSize: 24, fontWeight: '500', color: colors.textPrimary },
  metricLabel: { fontSize: 12, color: colors.textSecondary },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  // Red Flag Cards
  redFlagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 24,
    marginBottom: 8,
    padding: 14,
    borderRadius: 2, // radius.md
    backgroundColor: colors.noticeWarningBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  redFlagLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  redFlagName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  redFlagTrend: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  viewClientBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.warning,
    borderRadius: 4, // radius.lg
  },
  viewClientBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.noticeWarningText,
  },
  // Overdue Card
  overdueCard: {
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 16,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.noticeCriticalBg,
    borderLeftWidth: 4,
    borderLeftColor: colors.noticeCriticalAccent,
    gap: 8,
  },
  overdueSubtitle: {
    fontSize: 12,
    color: colors.noticeCriticalText,
    fontWeight: '600',
    marginBottom: 4,
  },
  overdueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  overdueDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.noticeCriticalAccent,
  },
  overdueName: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  overdueMore: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 28,
  },
  actionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 2, // radius.md
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  actionSubtext: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  riskWidgetRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 28,
  },
  riskCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 4,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderLeftWidth: 4,
    gap: 4,
  },
  riskCount: {
    fontSize: 24,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  riskLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  clientStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    padding: 14,
    gap: 12,
  },
  csAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  csAvatarText: { color: colors.textOnPrimary, fontSize: 13, fontWeight: '500' },
  csInfo: { flex: 1 },
  csName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  csMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  csStatusDot: { width: 10, height: 10, borderRadius: 999 },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 24,
    marginBottom: 14,
    gap: 12,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  activityContent: { flex: 1 },
  activityText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  activityName: { fontWeight: '600', color: colors.textPrimary },
  activityHighlight: { color: colors.primary },
  activityMeal: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  emptyActivity: {
    paddingVertical: 30,
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
  },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  emptySub: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 18,
  },

  });
