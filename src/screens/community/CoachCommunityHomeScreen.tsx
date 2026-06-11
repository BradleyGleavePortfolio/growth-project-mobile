/**
 * CoachCommunityHomeScreen — the top-level coach community landing (v1-6).
 *
 * Composes the dashboard envelope (`GET /community/coach/dashboard`) into three
 * at-a-glance cards: unread inbox count, active cohort count, and today's
 * flagged moderation items. Each card routes into the matching surface.
 *
 * When the dashboard is entirely quiet (no unread, no cohorts, nothing flagged)
 * OR the request errors, the screen renders the operator-locked Roman-voiced
 * empty state with the neutral crop (face + voice contract). No spinner-only
 * empty states. Colours come from semanticColors; touch targets are >= 44pt.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CoachEmptyState, COACH_EMPTY_COPY } from '../../components/community/coach';
import { useCoachDashboard } from '../../hooks/useCoachCommunity';
import type { CoachCommunityNav } from './coachCommunityNavTypes';

export default function CoachCommunityHomeScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CoachCommunityNav>();
  const dashboard = useCoachDashboard();
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

  if (isQuiet || dashboard.isError) {
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        style={{ backgroundColor: semanticColors.bgPrimary }}
        testID="coach-community-home-screen"
      >
        <CoachEmptyState
          crop={COACH_EMPTY_COPY.home.crop}
          copy={COACH_EMPTY_COPY.home.copy}
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

      <HapticPressable
        intent="light"
        onPress={() => navigation.navigate('CoachCommunityLab')}
        accessibilityRole="button"
        accessibilityLabel="Open the drafting lab"
        testID="coach-community-home-lab-link"
        style={[
          styles.labLink,
          { borderColor: semanticColors.border },
        ]}
      >
        <Text style={[styles.labLinkText, { color: semanticColors.textPrimary }]}>
          Open the drafting lab
        </Text>
      </HapticPressable>
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
  labLink: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  labLinkText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
