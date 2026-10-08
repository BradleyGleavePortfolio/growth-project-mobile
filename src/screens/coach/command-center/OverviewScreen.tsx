// Coach Command Center — Overview screen.
//
// The landing screen for coaches. Shows KPI tiles for the current roster:
// active clients, check-in rate, at-risk count, win streaks, unread
// messages, and open alerts (the Action Queue).
//
// State machine:
//   loading → (data | error)
//   Pull-to-refresh transitions refreshing → data/error.
// QA-COACH-HOME-131: the header (setup checklist, Money card) renders in every
// state and mounts once; numbers are ink, and a need is said in words.
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
  TouchableOpacity,
} from 'react-native';
import { colors, spacing, typography } from '../../../theme/tokens';
import {
  commandCenterApi,
  CommandCenterOverview,
} from '../../../services/commandCenterApi';
import KpiTile from '../../../components/command-center/KpiTile';
import CoachLtvDashboard from '../../../components/command-center/CoachLtvDashboard';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';
import LoadFailedNotice from '../../../components/coach/LoadFailedNotice';
import { SkeletonScreen } from '../../../ui/skeletons/Skeleton';

type LoadState = 'loading' | 'refreshing' | 'data' | 'error';

/** Said under the at-risk number instead of colouring it red. */
function attentionWords(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? 'Needs attention' : 'Need attention';
}

interface Props {
  onNavigateToAtRisk?: () => void;
  onNavigateToWinStreaks?: () => void;
  onNavigateToInbox?: () => void;
  onNavigateToActionQueue?: () => void;
  /** S-COACH — Home cards (setup checklist, Money) shown above the roster. */
  header?: React.ReactNode;
}

export default function OverviewScreen({
  onNavigateToAtRisk,
  onNavigateToWinStreaks,
  onNavigateToInbox,
  onNavigateToActionQueue,
  header,
}: Props) {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CommandCenterOverview | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    setState(isRefresh ? 'refreshing' : 'loading');
    try {
      const res = await commandCenterApi.getOverview();
      setData(res.data);
      setState('data');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const onRefresh = useCallback(() => load(true), [load]);

  // QA-COACH-HOME-131 (U1, C7): the header is the only way to Stripe setup
  // and Money, so it renders while the numbers load or fail. The leading
  // children match the data return below, so the header mounts once.
  if (data === null) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        testID="command-center-overview"
        refreshControl={
          <RefreshControl refreshing={state === 'refreshing'} onRefresh={onRefresh} tintColor={colors.forest} />
        }
      >
        <CommandCenterMockDataBanner />
        {header}
        <Text style={styles.heading}>Command Center</Text>
        <Text style={styles.subheading}>Your roster at a glance</Text>
        {state === 'error' ? (
          <LoadFailedNotice
            message="Roster numbers could not load."
            onRetry={() => load(false)}
            testID="command-center-overview-error"
          />
        ) : (
          <SkeletonScreen count={4} testID="command-center-overview-loading" />
        )}
      </ScrollView>
    );
  }

  const d = data;
  // HUNT-05-124 U-H05-2: a coach with no clients yet has no check-in rate.
  // Show a neutral dash instead of a red 0%, and no "of 0" under Active today.
  const noClients = d !== null && d.roster_size === 0;

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
      {header}

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
          subtext={d && !noClients ? `of ${d.roster_size}` : undefined}
          testID="command-center-kpi-active-today"
          style={styles.tileFlex}
        />
      </View>

      {/* Check-in rate */}
      <View style={styles.tileRow}>
        <KpiTile
          label="Check-in rate (7 days)"
          value={d && !noClients ? `${Math.round(d.check_in_rate_7day * 100)}%` : '—'}
          testID="command-center-kpi-checkin-rate"
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
            subtext={attentionWords(d?.at_risk_count ?? 0)}
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
          <KpiTile label="Active streaks" value={d?.win_streak_count ?? '—'} />
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
          <KpiTile label="Unread messages" value={d?.unread_messages ?? '—'} />
        </TouchableOpacity>
        <View style={styles.tileSpacer} />
        {/* FU-CHECKIN-126 (U-A13-5): the Action Queue lists open alerts, so
            the tile that opens it shows that same number. The old "Pending
            actions" tile counted every unreviewed check-in ever, a number
            the Action Queue never showed. */}
        <TouchableOpacity
          style={styles.tileFlex}
          onPress={onNavigateToActionQueue}
          accessibilityRole="button"
          accessibilityLabel={`${d?.open_alerts ?? 0} open alerts. View action queue.`}
          testID="command-center-kpi-open-alerts"
        >
          <KpiTile
            label="Open alerts"
            value={d?.open_alerts ?? '—'}
            subtext={d && d.open_alerts > 0 ? 'Waiting in Actions' : undefined}
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
  ltvSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.camel,
  },
});
