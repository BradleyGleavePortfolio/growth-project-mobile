// Coach Command Center — Overview screen.
//
// The landing screen for coaches. Shows KPI tiles for the current roster:
// active clients, check-in rate, open alerts, at-risk count, win streaks,
// unread messages, and pending actions.
//
// State machine:
//   idle → loading → (data | error)
//   Pull-to-refresh transitions loading → data/error.
//
// Data source: commandCenterApi.getOverview()
// Status: MOCKED until Phase 8 backend ships.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { colors, spacing, typography, radius } from '../../../theme/tokens';
import {
  commandCenterApi,
  CommandCenterOverview,
} from '../../../services/commandCenterApi';
import KpiTile from '../../../components/command-center/KpiTile';
import CoachLtvDashboard from '../../../components/command-center/CoachLtvDashboard';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'data' | 'error';

interface Props {
  onNavigateToAtRisk?: () => void;
  onNavigateToWinStreaks?: () => void;
  onNavigateToInbox?: () => void;
  onNavigateToActionQueue?: () => void;
}

export default function OverviewScreen({
  onNavigateToAtRisk,
  onNavigateToWinStreaks,
  onNavigateToInbox,
  onNavigateToActionQueue,
}: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<CommandCenterOverview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const load = useCallback(async (isRefresh = false) => {
    setState(isRefresh ? 'refreshing' : 'loading');
    try {
      const res = await commandCenterApi.getOverview();
      setData(res.data);
      setState('data');
    } catch (err) {
      setErrorMessage('Unable to load roster data. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const onRefresh = useCallback(() => load(true), [load]);

  if (state === 'loading') {
    return (
      <View style={styles.centred} testID="command-center-overview">
        <ActivityIndicator color={colors.forest} />
      </View>
    );
  }

  if (state === 'error' && !data) {
    return (
      <View style={styles.centred} testID="command-center-overview">
        <Text style={styles.errorText}>{errorMessage}</Text>
        <TouchableOpacity
          onPress={() => load(false)}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry loading overview"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const d = data;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="command-center-overview"
      refreshControl={
        <RefreshControl
          refreshing={state === 'refreshing'}
          onRefresh={onRefresh}
          tintColor={colors.forest}
        />
      }
    >
      <CommandCenterMockDataBanner />

      <Text style={styles.heading}>Command Center</Text>
      <Text style={styles.subheading}>Your roster at a glance</Text>

      {/* Roster summary row */}
      <View style={styles.tileRow}>
        <KpiTile
          label="Total clients"
          value={d?.roster_size ?? '—'}
          testID="command-center-kpi-roster-size"
          style={styles.tileFlex}
        />
        <View style={styles.tileSpacer} />
        <KpiTile
          label="Active today"
          value={d?.active_today ?? '—'}
          subtext={d ? `of ${d.roster_size}` : undefined}
          valueColor={colors.forest}
          testID="command-center-kpi-active-today"
          style={styles.tileFlex}
        />
      </View>

      {/* Check-in rate */}
      <View style={styles.tileRow}>
        <KpiTile
          label="Check-in rate (7 days)"
          value={d ? `${Math.round(d.check_in_rate_7day * 100)}%` : '—'}
          valueColor={
            d && d.check_in_rate_7day >= 0.7
              ? colors.forest
              : d && d.check_in_rate_7day >= 0.5
              ? colors.mutedGold
              : colors.error
          }
          testID="command-center-kpi-checkin-rate"
          style={styles.tileFlex}
        />
        <View style={styles.tileSpacer} />
        <KpiTile
          label="Open alerts"
          value={d?.open_alerts ?? '—'}
          valueColor={d && d.open_alerts > 0 ? colors.error : colors.forest}
          testID="command-center-kpi-open-alerts"
          style={styles.tileFlex}
        />
      </View>

      {/* At-risk + win streaks */}
      <View style={styles.tileRow}>
        <TouchableOpacity
          style={styles.tileFlex}
          onPress={onNavigateToAtRisk}
          accessibilityRole="button"
          accessibilityLabel={`${d?.at_risk_count ?? 0} clients need your attention. View at-risk list.`}
          testID="command-center-kpi-at-risk"
        >
          <KpiTile
            label="Clients at risk"
            value={d?.at_risk_count ?? '—'}
            valueColor={d && d.at_risk_count > 0 ? colors.error : colors.forest}
          />
        </TouchableOpacity>
        <View style={styles.tileSpacer} />
        <TouchableOpacity
          style={styles.tileFlex}
          onPress={onNavigateToWinStreaks}
          accessibilityRole="button"
          accessibilityLabel={`${d?.win_streak_count ?? 0} clients on active streaks. View win streaks.`}
          testID="command-center-kpi-win-streaks"
        >
          <KpiTile
            label="Active streaks"
            value={d?.win_streak_count ?? '—'}
            valueColor={colors.forest}
          />
        </TouchableOpacity>
      </View>

      {/* Inbox + action queue */}
      <View style={styles.tileRow}>
        <TouchableOpacity
          style={styles.tileFlex}
          onPress={onNavigateToInbox}
          accessibilityRole="button"
          accessibilityLabel={`${d?.unread_messages ?? 0} unread messages. View inbox.`}
          testID="command-center-kpi-unread-messages"
        >
          <KpiTile
            label="Unread messages"
            value={d?.unread_messages ?? '—'}
            valueColor={d && d.unread_messages > 0 ? colors.forest : colors.stone}
          />
        </TouchableOpacity>
        <View style={styles.tileSpacer} />
        <TouchableOpacity
          style={styles.tileFlex}
          onPress={onNavigateToActionQueue}
          accessibilityRole="button"
          accessibilityLabel={`${d?.pending_actions ?? 0} actions pending. View action queue.`}
          testID="command-center-kpi-pending-actions"
        >
          <KpiTile
            label="Pending actions"
            value={d?.pending_actions ?? '—'}
            valueColor={d && d.pending_actions > 0 ? colors.mutedGold : colors.stone}
          />
        </TouchableOpacity>
      </View>

      {/* ── Revenue & LTV dashboard ────────────────────────────────────── */}
      {/* Added: feat/coach-ltv-dashboard — see CoachLtvDashboard.tsx */}
      <View style={styles.ltvSection}>
        <CoachLtvDashboard
          apiGet={(_path: string) => commandCenterApi.getLtvMetrics()}
          inlineMode
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  centred: {
    flex: 1,
    backgroundColor: colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  heading: {
    ...typography.h1,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  subheading: {
    ...typography.body,
    color: colors.stone,
    marginBottom: spacing.xl,
  },
  tileRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  tileFlex: {
    flex: 1,
  },
  tileSpacer: {
    width: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  retryButton: {
    backgroundColor: colors.forest,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
  },
  ltvSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.camel,
  },
  retryText: {
    ...typography.caption,
    color: colors.bone,
    textAlign: 'center',
  },
});
