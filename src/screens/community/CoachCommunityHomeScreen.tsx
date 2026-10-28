/**
 * CoachCommunityHomeScreen — the top-level coach community landing (v1-6).
 *
 * Composes the dashboard counts (built in coachCommunityApi.getDashboard) into three
 * at-a-glance cards: unread inbox count, active cohort count, and today's
 * flagged moderation items. Each card routes into the matching surface.
 *
 * K2 Style B (#172-10, as the inbox). THREE distinct branches (UX P0.2): skeleton cards; an
 * honest CoachErrorState on a load failure (never a calm/empty masquerade); and
 * — when the dashboard is genuinely quiet (no unread, no cohorts, nothing
 * flagged) — the operator-locked Roman-voiced empty state. The empty-state copy
 * and avatar crop come from the backend voice policy (face + voice contract),
 * resolved via useCoachEmptyStatePayload. Every branch pulls to refresh;
 * touch targets are >= 44pt.
 *
 * Card hierarchy (UX-05 fix): when at least one card has a non-zero count, the
 * highest-urgency non-zero card is PROMOTED to a "Start here" treatment — a
 * leading "NEXT" eyebrow, an accent border + tint, and a larger value — and it
 * is ordered first. Urgency priority is unread inbox > flagged moderation >
 * active cohorts. When every count is zero the three cards stay equal-weight
 * (and in practice the quiet branch above renders the empty state instead).
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { spacing, radius, withAlpha, colors, layout } from '../../theme/tokens';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../components/HapticPressable';
import { featureFlags } from '../../config/featureFlags';
import { CoachRomanEmptyState, CoachErrorState } from '../../components/community/coach';
import {
  useCoachDashboard,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import type { CoachCommunityNav } from './coachCommunityNavTypes';

// K2 Style B: one light palette in both themes, named by role.
const semanticColors = {
  bgPrimary: colors.bone,
  bgSurface: colors.cream,
  border: 'transparent',
  accent: colors.forest,
  textPrimary: colors.ink,
  textMuted: colors.graphite,
};

/** The serif page title (K2), on every branch. */
function HomeTitle(): React.ReactElement {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      Community
    </Text>
  );
}

export default function CoachCommunityHomeScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const dashboard = useCoachDashboard();
  const emptyState = useCoachEmptyStatePayload('coach_community_home_empty');
  const data = dashboard.data;

  const isQuiet =
    !dashboard.isLoading &&
    !dashboard.isError &&
    data != null &&
    data.unread_inbox_count === 0 &&
    data.active_cohort_count === 0 &&
    data.flagged_today_count === 0;

  // The pull also retries Roman's words when they failed ("Pull to retry").
  const pull = (
    <RefreshControl
      refreshing={dashboard.isRefetching}
      onRefresh={() => {
        void dashboard.refetch();
        if (emptyState.status === 'error') emptyState.retry();
      }}
      tintColor={colors.forest}
    />
  );

  if (dashboard.isLoading) {
    return (
      <View
        style={[styles.flex, styles.content, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-home-screen"
      >
        <HomeTitle />
        <View
          accessible
          accessibilityLabel="Loading your community summary"
          testID="coach-community-home-loading"
          style={styles.skeletons}
        >
          {[0, 1, 2].map((n) => (
            <View key={n} style={styles.skeletonCard} />
          ))}
        </View>
      </View>
    );
  }

  if (dashboard.isError) {
    return (
      <ScrollView
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        contentContainerStyle={[styles.content, styles.grow]}
        refreshControl={pull}
        testID="coach-community-home-screen"
      >
        <HomeTitle />
        <CoachErrorState
          message="Could not load your community summary. Pull to retry."
          onRetry={() => dashboard.refetch()}
          retrying={dashboard.isRefetching}
          testID="coach-community-home-error"
        />
      </ScrollView>
    );
  }

  if (isQuiet) {
    return (
      <ScrollView
        contentContainerStyle={[styles.content, styles.grow]}
        style={{ backgroundColor: semanticColors.bgPrimary }}
        refreshControl={pull}
        testID="coach-community-home-screen"
      >
        <HomeTitle />
        <CoachRomanEmptyState
          result={emptyState}
          testID="coach-community-home-empty"
        />
      </ScrollView>
    );
  }

  // Build the three cards in their fixed identity, then order + promote by
  // urgency. Priority when counts tie at non-zero: inbox > moderation > cohorts.
  const cards: HomeCard[] = [
    {
      key: 'inbox',
      priority: 0,
      label: 'Unread in your inbox',
      value: data?.unread_inbox_count ?? 0,
      onPress: () => navigation.navigate('CoachCommunityInbox'),
      testID: 'coach-community-home-inbox-card',
    },
    {
      key: 'moderation',
      priority: 1,
      label: 'Flagged today',
      value: data?.flagged_today_count ?? 0,
      onPress: () => navigation.navigate('CoachCommunityModeration'),
      testID: 'coach-community-home-moderation-card',
    },
    {
      key: 'cohorts',
      priority: 2,
      label: 'Active cohorts',
      value: data?.active_cohort_count ?? 0,
      onPress: () => navigation.navigate('CoachCommunityCohorts'),
      testID: 'coach-community-home-cohorts-card',
    },
  ];

  // The promoted card is the non-zero card with the lowest priority number. If
  // every count is zero, nothing is promoted and the cards stay equal-weight.
  const promoted = cards
    .filter((c) => c.value > 0)
    .sort((a, b) => a.priority - b.priority)[0];
  const promotedKey = promoted?.key ?? null;

  // Order: promoted card first (if any), then the rest in their natural
  // priority order so the layout is stable.
  const ordered = [...cards].sort((a, b) => {
    if (a.key === promotedKey) return -1;
    if (b.key === promotedKey) return 1;
    return a.priority - b.priority;
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: semanticColors.bgPrimary }}
      refreshControl={pull}
      testID="coach-community-home-screen"
    >
      <HomeTitle />

      {ordered.map((card) => (
        <StatCard
          key={card.key}
          label={card.label}
          value={card.value}
          promoted={card.key === promotedKey}
          surface={semanticColors.bgSurface}
          promotedSurface={withAlpha(semanticColors.accent, 0.08)}
          border={semanticColors.border}
          accent={semanticColors.accent}
          labelColor={semanticColors.textMuted}
          valueColor={semanticColors.textPrimary}
          onPress={card.onPress}
          testID={card.testID}
        />
      ))}

      {/* F9 (discovery): a visible entry point into the events surface, gated on
          the events flag so nothing about events appears when it is off (F1).
          Events have no dashboard count, so this is a navigation card rather
          than a StatCard. */}
      {featureFlags.communityEvents ? (
        <HapticPressable
          intent="light"
          onPress={() => navigation.navigate('CoachCommunityEvents')}
          accessibilityRole="button"
          accessibilityLabel="Events: schedule and manage live sessions"
          testID="coach-community-home-events-card"
          style={[
            styles.navCard,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
            },
          ]}
        >
          <Ionicons
            name="calendar-outline"
            size={24}
            color={semanticColors.accent}
          />
          <View style={styles.navCardText}>
            <Text style={[styles.navCardTitle, { color: semanticColors.textPrimary }]}>
              Events
            </Text>
            <Text style={[styles.navCardSub, { color: semanticColors.textMuted }]}>
              Schedule and manage live sessions
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={semanticColors.textMuted}
          />
        </HapticPressable>
      ) : null}
    </ScrollView>
  );
}

interface HomeCard {
  key: 'inbox' | 'moderation' | 'cohorts';
  /** Urgency rank; lower wins promotion when non-zero. */
  priority: number;
  label: string;
  value: number;
  onPress: () => void;
  testID: string;
}

function StatCard({
  label,
  value,
  promoted = false,
  surface,
  promotedSurface,
  border,
  accent,
  labelColor,
  valueColor,
  onPress,
  testID,
}: {
  label: string;
  value: number;
  /** When true, this is the "Start here" card: eyebrow + accent border + tint. */
  promoted?: boolean;
  surface: string;
  promotedSurface: string;
  border: string;
  accent: string;
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
      // "Next" prefix gives screen-reader users the same start-here cue sighted
      // users get from the eyebrow + accent treatment.
      accessibilityLabel={`${promoted ? 'Next: ' : ''}${label}: ${value}`}
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: promoted ? promotedSurface : surface,
          borderColor: promoted ? accent : border,
          borderWidth: promoted ? 1.5 : StyleSheet.hairlineWidth,
        },
        promoted && styles.cardPromoted,
      ]}
    >
      {promoted ? (
        <Text
          style={[styles.cardEyebrow, { color: accent }]}
          testID={testID ? `${testID}-next` : undefined}
        >
          NEXT
        </Text>
      ) : null}
      <Text
        style={[
          styles.cardValue,
          promoted && styles.cardValuePromoted,
          { color: valueColor },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.cardLabel, { color: labelColor }]}>{label}</Text>
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  grow: { flexGrow: 1 },
  heading: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 36,
    lineHeight: 46,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  skeletons: { gap: spacing.sm },
  skeletonCard: {
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    opacity: 0.7,
  },
  card: {
    minHeight: 88,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  cardPromoted: {
    minHeight: 108,
  },
  cardEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  cardValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 36,
    lineHeight: 46,
  },
  cardValuePromoted: {
    fontSize: 44,
    lineHeight: 56,
  },
  cardLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
  },
  navCard: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  navCardText: {
    flex: 1,
    gap: 2,
  },
  navCardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  navCardSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
});
