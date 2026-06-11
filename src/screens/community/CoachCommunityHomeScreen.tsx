/**
 * CoachCommunityHomeScreen — the top-level coach community landing (v1-6).
 *
 * Composes the dashboard envelope (`GET /community/coach/dashboard`) into three
 * at-a-glance cards: unread inbox count, active cohort count, and today's
 * flagged moderation items. Each card routes into the matching surface.
 *
 * The screen has THREE distinct branches (UX P0.2): a loading spinner; an
 * honest CoachErrorState on a load failure (never a calm/empty masquerade); and
 * — when the dashboard is genuinely quiet (no unread, no cohorts, nothing
 * flagged) — the operator-locked Roman-voiced empty state. The empty-state copy
 * and avatar crop come from the backend voice policy (face + voice contract),
 * resolved via useCoachEmptyStatePayload. Colours come from semanticColors;
 * touch targets are >= 44pt.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CoachEmptyState, CoachErrorState } from '../../components/community/coach';
import {
  useCoachDashboard,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import type { CoachCommunityNav } from './coachCommunityNavTypes';

export default function CoachCommunityHomeScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CoachCommunityNav>();
  const dashboard = useCoachDashboard();
  const emptyPayload = useCoachEmptyStatePayload('coach_community_home_empty');
  const data = dashboard.data;

  const isQuiet =
    !dashboard.isLoading &&
    !dashboard.isError &&
    data != null &&
    data.unread_inbox_count === 0 &&
    data.active_cohort_count === 0 &&
    data.flagged_today_count === 0;

  if (dashboard.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-home-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-home-loading"
        />
      </View>
    );
  }

  if (dashboard.isError) {
    return (
      <View
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-home-screen"
      >
        <CoachErrorState
          message="Could not load your community summary. Pull to retry."
          onRetry={() => dashboard.refetch()}
          retrying={dashboard.isRefetching}
          testID="coach-community-home-error"
        />
      </View>
    );
  }

  if (isQuiet) {
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        style={{ backgroundColor: semanticColors.bgPrimary }}
        testID="coach-community-home-screen"
      >
        <CoachEmptyState
          payload={emptyPayload}
          testID="coach-community-home-empty"
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: semanticColors.bgPrimary }}
      testID="coach-community-home-screen"
    >
      <Text style={[styles.heading, { color: semanticColors.textPrimary }]}>
        Community
      </Text>

      <StatCard
        label="Unread in your inbox"
        value={data?.unread_inbox_count ?? 0}
        surface={semanticColors.bgSurface}
        border={semanticColors.border}
        labelColor={semanticColors.textMuted}
        valueColor={semanticColors.textPrimary}
        onPress={() => navigation.navigate('CoachCommunityInbox')}
        testID="coach-community-home-inbox-card"
      />
      <StatCard
        label="Active cohorts"
        value={data?.active_cohort_count ?? 0}
        surface={semanticColors.bgSurface}
        border={semanticColors.border}
        labelColor={semanticColors.textMuted}
        valueColor={semanticColors.textPrimary}
        onPress={() => navigation.navigate('CoachCommunityCohorts')}
        testID="coach-community-home-cohorts-card"
      />
      <StatCard
        label="Flagged today"
        value={data?.flagged_today_count ?? 0}
        surface={semanticColors.bgSurface}
        border={semanticColors.border}
        labelColor={semanticColors.textMuted}
        valueColor={semanticColors.textPrimary}
        onPress={() => navigation.navigate('CoachCommunityModeration')}
        testID="coach-community-home-moderation-card"
      />
    </ScrollView>
  );
}

function StatCard({
  label,
  value,
  surface,
  border,
  labelColor,
  valueColor,
  onPress,
  testID,
}: {
  label: string;
  value: number;
  surface: string;
  border: string;
  labelColor: string;
  valueColor: string;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
      style={[styles.card, { backgroundColor: surface, borderColor: border }]}
    >
      <Text style={[styles.cardValue, { color: valueColor }]}>{value}</Text>
      <Text style={[styles.cardLabel, { color: labelColor }]}>{label}</Text>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heading: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  card: {
    minHeight: 88,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  cardValue: {
    fontSize: 32,
    fontWeight: '600',
  },
  cardLabel: {
    fontSize: 14,
  },
});
