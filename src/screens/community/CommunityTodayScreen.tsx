/**
 * CommunityTodayScreen — the "today" object (product plan §2.6): the universal
 * home for what's happening for the calling client today. Aggregates the
 * pinned post / event / challenge + the client's cohort context.
 *
 * Entry point for the Community tab. When the client has no membership or no
 * today content, we render a factual empty state with an available action.
 * Standardized on semanticColors and typography tokens.
 */
import React from 'react';
import { Text, View, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, typography } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityToday } from '../../hooks/useCommunity';
import HapticPressable from '../../components/HapticPressable';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { featureFlags } from '../../config/featureFlags';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  /** When embedded in the Tab container the screen omits its own SafeArea. */
  embedded?: boolean;
}

export default function CommunityTodayScreen(_props: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const rootNavigation = useNavigation<NavigationProp<ParamListBase>>();
  const client = useCurrentUser();
  // C-F6-1: "Send your coach a message" only renders for a client with a coach.
  const hasCoach = Boolean(client?.coach_id);
  const today = useCommunityToday();

  const data = today.data;
  const dateTitle = (
    <Text style={[styles.heading, { color: semanticColors.textPrimary }]}>
      {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
    </Text>
  );
  const isEmpty =
    !today.isLoading &&
    !today.isError &&
    data != null &&
    !data.cohort &&
    !data.event &&
    !data.pinned_post &&
    !data.challenge;

  // C-F6-1: with community DMs off the button opened nothing. It now opens the
  // 1:1 coach Messages screen in the Home stack (the m#389 no-workspace path).
  const goToMessages = () => {
    if (featureFlags.communityDm) {
      navigation.navigate('CommunityDmList');
    } else {
      rootNavigation.navigate('Home', { screen: 'Messages' });
    }
  };
  const goToHall = () => {
    if (featureFlags.communityHall) {
      navigation.navigate('CommunitySpace', { space: 'hall' });
    } else {
      goToMessages();
    }
  };
  // Behind the events flag the Today event card opens the event's own detail
  // screen; when the flag is off we fall back to the Hall so the card never
  // strands the member (the event route is not registered then).
  const goToEvent = (eventId: string) => {
    if (featureFlags.communityEvents) {
      navigation.navigate('CommunityEventDetail', { eventId });
    } else {
      goToHall();
    }
  };
  // The Today challenge card opens the challenge detail when the
  // challenges feature is on. With the flag OFF the detail route is not even
  // registered, so we fall back to the Hall rather than navigate to a missing
  // route (the card is never a dead end).
  const goToChallenge = (challengeId: string) => {
    if (featureFlags.communityChallenges) {
      navigation.navigate('CommunityChallengeDetail', { challengeId });
    } else {
      goToHall();
    }
  };
  const hallLabel = featureFlags.communityHall
    ? 'Visit the Hall'
    : featureFlags.communityDm ? 'Messages' : hasCoach ? 'Send your coach a message' : undefined;

  if (today.isLoading) {
    return (
      <View testID="community-today-screen" accessibilityLabel="Loading community Today"
        accessibilityState={{ busy: true }} style={{ flex: 1, backgroundColor: semanticColors.bgPrimary }}>
        <SkeletonScreen count={3} />
      </View>
    );
  }

  // A `useCommunityToday` LOAD FAILURE must render a calm retryable error,
  // never the "nothing waiting today" / "visit the Hall" onboarding empty state
  // — collapsing a failed today query into the empty state silently hides the
  // failure and sends members to another surface while the root today object is
  // unavailable (R65 #36/#44). Resolve the error branch BEFORE the empty state.
  if (!today.isLoading && today.isError) {
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        style={{ backgroundColor: semanticColors.bgPrimary }}
        testID="community-today-screen"
      >
        {dateTitle}
        <View style={styles.errorBox} testID="community-today-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Today did not load. Check your connection, then try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => today.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-today-retry"
            style={[styles.retry, { backgroundColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.textOnAccent }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </ScrollView>
    );
  }

  // Empty state describes only this successful Today response.
  if (isEmpty) {
    const noMembership = data?.empty_reason === 'no_membership';
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        style={{ backgroundColor: semanticColors.bgPrimary }}
        testID="community-today-screen"
      >
        {dateTitle}
        <TodayEmptyState
          body={noMembership ? 'A community space is not available for this account.' : 'No posts, events or challenges are shown here.'}
          title={noMembership ? 'No cohort yet' : 'No updates in Today'}
          actionLabel={
            noMembership
              ? hasCoach
                ? 'Send your coach a message'
                : undefined
              : hallLabel
          }
          onAction={noMembership ? (hasCoach ? goToMessages : undefined) : (hallLabel ? goToHall : undefined)}
          testID="community-today-empty"
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: semanticColors.bgPrimary }}
      testID="community-today-screen"
    >
      {dateTitle}
      {data?.cohort ? <CardLabel color={semanticColors.textMuted}>Your spaces</CardLabel> : null}

      {data?.cohort ? (
        <Card
          border={semanticColors.border}
          onPress={() =>
            navigation.navigate('CommunitySpace', {
              space: 'cohort',
              cohortId: data.cohort?.id,
            })
          }
          testID="community-today-cohort"
        >
          <CardLabel color={semanticColors.textMuted}>Your cohort</CardLabel>
          <CardTitle color={semanticColors.textPrimary}>
            {data.cohort.name}
          </CardTitle>
          <CardMeta color={semanticColors.textMuted}>
            {data.cohort.member_count} members
          </CardMeta>
        </Card>
      ) : null}

      {data?.pinned_post ? <CardLabel color={semanticColors.textMuted}>Today</CardLabel> : null}
      {data?.pinned_post ? (
        <Card
          border={semanticColors.border}
          onPress={() =>
            navigation.navigate('CommunityThread', {
              postId: data.pinned_post!.id,
            })
          }
          testID="community-today-pinned"
        >
          <CardLabel color={semanticColors.textMuted}>Pinned post</CardLabel>
          <CardTitle color={semanticColors.textPrimary} numberOfLines={2}>
            {data.pinned_post.title}
          </CardTitle>
        </Card>
      ) : null}

      {data?.event ? <CardLabel color={semanticColors.textMuted}>Events</CardLabel> : null}
      {data?.event ? (
        <Card
          border={semanticColors.border}
          onPress={() => goToEvent(data.event!.id)}
          testID="community-today-event"
        >
          <CardLabel color={semanticColors.textMuted}>Upcoming event</CardLabel>
          <CardTitle color={semanticColors.textPrimary}>
            {data.event.title}
          </CardTitle>
          <CardMeta color={semanticColors.textMuted}>{new Date(data.event.starts_at).toLocaleString()}</CardMeta>
        </Card>
      ) : null}

      {data?.challenge ? (
        <Card
          border={semanticColors.border}
          onPress={() => goToChallenge(data.challenge!.id)}
          testID="community-today-challenge"
        >
          <CardLabel color={semanticColors.textMuted}>Challenge</CardLabel>
          <CardTitle color={semanticColors.textPrimary}>
            {data.challenge.title}
          </CardTitle>
          <CardMeta color={semanticColors.textMuted}>Ends {new Date(data.challenge.ends_at).toLocaleDateString()}</CardMeta>
        </Card>
      ) : null}
      {data?.feature_flag_state === 'enabled' && data.empty_reason !== 'no_membership' && featureFlags.communityHall ? (
        <HapticPressable intent="medium" accessibilityRole="button" accessibilityLabel="New post"
          testID="community-today-compose" onPress={() => navigation.navigate('CommunityComposer', { mode: 'post' })}
          style={[styles.retry, { backgroundColor: semanticColors.accent }]}>
          <Text style={[styles.retryLabel, { color: semanticColors.textOnAccent }]}>New post</Text>
        </HapticPressable>
      ) : null}
    </ScrollView>
  );
}

// ─── tiny presentational helpers (kept local to the today surface) ───────────

function Card({
  children,
  border,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  border: string;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      style={[styles.card, { borderColor: border }]}
    >
      {children}
    </HapticPressable>
  );
}

function TodayEmptyState({ title, body, actionLabel, onAction, testID }: {
  title: string; body: string; actionLabel?: string; onAction?: () => void; testID: string;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View style={styles.errorBox} testID={testID}>
      <Text style={[typography.h2, { color: semanticColors.textPrimary }]}>{title}</Text>
      <Text style={[styles.muted, { color: semanticColors.textMuted }]}>{body}</Text>
      {actionLabel && onAction ? (
        <HapticPressable intent="medium" accessibilityRole="button" accessibilityLabel={actionLabel}
          testID={`${testID}-action`} onPress={onAction}
          style={[styles.retry, { backgroundColor: semanticColors.accent }]}>
          <Text style={[styles.retryLabel, { color: semanticColors.textOnAccent }]}>{actionLabel}</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

function CardLabel({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}): React.ReactElement {
  return <Text style={[styles.cardLabel, { color }]}>{children}</Text>;
}
function CardTitle({
  children,
  color,
  numberOfLines,
}: {
  children: React.ReactNode;
  color: string;
  numberOfLines?: number;
}): React.ReactElement {
  return <Text numberOfLines={numberOfLines} style={[styles.cardTitle, { color }]}>{children}</Text>;
}
function CardMeta({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}): React.ReactElement {
  return <Text style={[styles.cardMeta, { color }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  center: {
    flexGrow: 1,
    padding: spacing.xl,
    gap: spacing['3xl'],
  },
  errorBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing['3xl'],
  },
  muted: { ...typography.bodySmall, textAlign: 'center' },
  retry: {
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { ...typography.bodyMd },
  heading: {
    ...typography.h1,
    marginBottom: spacing.sm,
  },
  card: {
    minHeight: 48,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  cardLabel: {
    ...typography.eyebrow,
  },
  cardTitle: {
    ...typography.bodyMd,
  },
  cardMeta: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
  },
});
