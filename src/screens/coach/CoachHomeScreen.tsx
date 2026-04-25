import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { Colors } from '../../constants/colors';
import { colors } from '../../theme';
import { getGreeting } from '../../utils/date';
import FadeInView from '../../components/FadeInView';
import { coachApi } from '../../services/api';

interface RedFlagClient {
  id: string;
  name: string;
  trend: string;
}

export default function CoachHomeScreen() {
  const currentUser = useCurrentUser();
  const { clients, isLoading, loadClients } = useCoachStore();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [redFlagClients, setRedFlagClients] = useState<RedFlagClient[]>([]);
  const [overdueClients, setOverdueClients] = useState<string[]>([]);
  const [dashboard, setDashboard] = useState<{ logs_today: number; total_kcal: number; logging_rate: number } | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const res = await coachApi.getDashboard();
      setDashboard(res.data);
    } catch (err) {
      console.error('CoachHomeScreen: fetchDashboard failed', err);
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const detectRedFlags = useCallback(async () => {
    try {
      const alertsRes = await coachApi.getAlerts();
      const alerts: any[] = alertsRes.data || [];
      const flags: RedFlagClient[] = alerts
        .filter((a: any) => a.type === 'weight_increasing')
        .map((a: any) => ({
          id: a.client_id,
          name: a.client_name,
          trend: a.message,
        }));
      setRedFlagClients(flags);

      const missed = alerts
        .filter((a: any) => a.type === 'missed_workouts')
        .map((a: any) => a.client_name);
      setOverdueClients(missed);
    } catch (err) {
      // Alerts tile stays empty on failure — not a destructive write.
      console.error('CoachHomeScreen: loadClients alerts failed', err);
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
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
          tintColor={Colors.primary}
          colors={[Colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}, {currentUser?.firstName || 'Coach'}</Text>
          <Text style={styles.subtitle}>Here's your coaching overview</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="settings-outline" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Key Metrics */}
      <FadeInView>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: Colors.primaryPale }]}>
              <Ionicons name="people" size={22} color={Colors.primary} />
            </View>
            <Text style={styles.metricValue}>{activeClients}</Text>
            <Text style={styles.metricLabel}>Active Clients</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: colors.feedback.infoBg }]}>
              <Ionicons name="restaurant" size={22} color={Colors.carbs} />
            </View>
            {dashboardLoading ? (
                <View style={{ width: 40, height: 28, backgroundColor: Colors.surface, borderRadius: 4, opacity: 0.4 }} />
              ) : (
                <Text style={styles.metricValue}>{logsToday}</Text>
              )}
            <Text style={styles.metricLabel}>Logs Today</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: Colors.noticeWarningIconBg }]}>
              <Ionicons name="flame" size={22} color={Colors.fat} />
            </View>
            {dashboardLoading ? (
                <View style={{ width: 60, height: 28, backgroundColor: Colors.surface, borderRadius: 4, opacity: 0.4 }} />
              ) : (
                <Text style={styles.metricValue}>{totalKcal.toLocaleString()}</Text>
              )}
            <Text style={styles.metricLabel}>Total kcal</Text>
          </View>
          <View style={styles.metricCard}>
            <View style={[styles.metricIcon, { backgroundColor: Colors.primaryPale }]}>
              <Ionicons name="checkmark-circle" size={22} color={Colors.primaryLight} />
            </View>
            {dashboardLoading ? (
                <View style={{ width: 44, height: 28, backgroundColor: Colors.surface, borderRadius: 4, opacity: 0.4 }} />
              ) : (
                <Text style={styles.metricValue}>{loggingRateDisplay}</Text>
              )}
            <Text style={styles.metricLabel}>Logging Rate</Text>
          </View>
        </View>
      </FadeInView>

      {/* ⚠️ Red Flag Clients */}
      {redFlagClients.length > 0 && (
        <FadeInView>
          <Text style={styles.sectionTitle}>⚠️ Weight Trend Alerts</Text>
          {redFlagClients.map((rf) => (
            <TouchableOpacity
              key={rf.id}
              style={styles.redFlagCard}
              onPress={() =>
                navigation.navigate('ClientsStack', {
                  screen: 'ClientDetail',
                  params: { clientId: rf.id, clientName: rf.name },
                })
              }
              activeOpacity={0.8}
            >
              <View style={styles.redFlagLeft}>
                <Ionicons name="warning" size={22} color={Colors.warning} />
                <View>
                  <Text style={styles.redFlagName}>{rf.name}</Text>
                  <Text style={styles.redFlagTrend}>Weight trending up · {rf.trend}</Text>
                </View>
              </View>
              <View style={styles.viewClientBtn}>
                <Text style={styles.viewClientBtnText}>View</Text>
              </View>
            </TouchableOpacity>
          ))}
        </FadeInView>
      )}

      {/* Overdue Check-ins */}
      {overdueClients.length > 0 && (
        <FadeInView>
          <Text style={styles.sectionTitle}>📅 Overdue Check-ins</Text>
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
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('ClientsStack')}
          activeOpacity={0.7}
        >
          <View style={[styles.actionIcon, { backgroundColor: Colors.primaryPale }]}>
            <Ionicons name="people-outline" size={22} color={Colors.primary} />
          </View>
          <Text style={styles.actionText}>View Clients</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('Messages')}
          activeOpacity={0.7}
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.feedback.infoBg }]}>
            <Ionicons name="chatbubble-outline" size={22} color={Colors.carbs} />
          </View>
          <Text style={styles.actionText}>Messages</Text>
        </TouchableOpacity>
      </View>

      {/* Client Status Today — hidden until the backend exposes a per-client
          "logged today?" flag. The previous implementation hard-coded
          hasLogged = false and showed "No activity today" for every client,
          which was misleading. */}

      {/* Recent Activity Feed */}
      <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Recent Activity</Text>
      <View style={styles.emptyActivity}>
        <Ionicons name="time-outline" size={32} color={Colors.textMuted} />
        <Text style={styles.emptyText}>Activity feed coming soon</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingTop: 60, paddingBottom: 100 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  greeting: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 4 },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
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
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 8,
    flexGrow: 1,
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricValue: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary },
  metricLabel: { fontSize: 12, color: Colors.textSecondary },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
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
    borderRadius: 12,
    backgroundColor: Colors.noticeWarningBg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
  },
  redFlagLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  redFlagName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  redFlagTrend: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  viewClientBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: Colors.warning,
    borderRadius: 10,
  },
  viewClientBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.noticeWarningText,
  },
  // Overdue Card
  overdueCard: {
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: Colors.noticeCriticalBg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.noticeCriticalAccent,
    gap: 8,
  },
  overdueSubtitle: {
    fontSize: 12,
    color: Colors.noticeCriticalText,
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
    backgroundColor: Colors.noticeCriticalAccent,
  },
  overdueName: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  overdueMore: {
    fontSize: 12,
    color: Colors.textMuted,
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
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  clientStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  csAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  csAvatarText: { color: Colors.textOnPrimary, fontSize: 13, fontWeight: '700' },
  csInfo: { flex: 1 },
  csName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  csMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  csStatusDot: { width: 10, height: 10, borderRadius: 5 },
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
    backgroundColor: Colors.primary,
    marginTop: 6,
  },
  activityContent: { flex: 1 },
  activityText: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  activityName: { fontWeight: '600', color: Colors.textPrimary },
  activityHighlight: { color: Colors.primary },
  activityMeal: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  emptyActivity: {
    paddingVertical: 30,
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
  },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
});
