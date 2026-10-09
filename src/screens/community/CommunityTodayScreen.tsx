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
import { Text, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityToday } from '../../hooks/useCommunity';
import HapticPressable from '../../components/HapticPressable';
import { Headline, Lede, Overline, PrimaryButton, QuietSection, Screen } from '../../ui';
import { QuietError, QuietLoading } from '../../ui/states/QuietStates';
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
  // The Community tab container owns the top inset and the tab bar the bottom.
  const page = (children: React.ReactNode, footer?: React.ReactNode) => (
    <Screen edges={[]} footer={footer} testID="community-today-screen">
      <View style={styles.header}>
        <Overline>Today</Overline>
        <Headline level="h1">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Headline>
      </View>
      {children}
    </Screen>
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
    return page(<QuietLoading label="Loading community Today" rows={3} testID="community-today-loading" />);
  }

  // A `useCommunityToday` LOAD FAILURE must render a calm retryable error,
  // never the "nothing waiting today" / "visit the Hall" onboarding empty state
  // — collapsing a failed today query into the empty state silently hides the
  // failure and sends members to another surface while the root today object is
  // unavailable (R65 #36/#44). Resolve the error branch BEFORE the empty state.
  if (!today.isLoading && today.isError) {
    return page(
      <QuietError
        layout="inline"
        message="Today did not load. Check your connection, then try again."
        onRetry={() => void today.refetch()}
        testID="community-today-error"
      />,
    );
  }

  // Empty state describes only this successful Today response.
  if (isEmpty) {
    const noMembership = data?.empty_reason === 'no_membership';
    const actionLabel = noMembership ? (hasCoach ? 'Send your coach a message' : undefined) : hallLabel;
    const onAction = noMembership ? (hasCoach ? goToMessages : undefined) : (hallLabel ? goToHall : undefined);
    return page(
      <QuietSection testID="community-today-empty">
        <Text style={[styles.narrative, { color: semanticColors.textPrimary }]}>
          {noMembership ? 'No cohort yet' : 'No updates in Today'}
        </Text>
        <Lede>
          {noMembership ? 'A community space is not available for this account.' : 'No posts, events or challenges are shown here.'}
        </Lede>
      </QuietSection>,
      actionLabel && onAction ? (
        <PrimaryButton label={actionLabel} onPress={onAction} testID="community-today-empty-action" />
      ) : undefined,
    );
  }

  const canCompose =
    data?.feature_flag_state === 'enabled' && data.empty_reason !== 'no_membership' && featureFlags.communityHall;
  const members = data?.cohort ? `${data.cohort.member_count} ${data.cohort.member_count === 1 ? 'member' : 'members'}` : '';

  return page(
    <>
      {data?.cohort ? (
        <TodayItem
          overline="Your cohort"
          title={data.cohort.name}
          meta={members}
          onPress={() => navigation.navigate('CommunitySpace', { space: 'cohort', cohortId: data.cohort?.id })}
          testID="community-today-cohort"
        />
      ) : null}
      {data?.pinned_post ? (
        <TodayItem
          overline="Pinned post"
          title={data.pinned_post.title}
          titleLines={2}
          onPress={() => navigation.navigate('CommunityThread', { postId: data.pinned_post!.id })}
          testID="community-today-pinned"
        />
      ) : null}
      {data?.event ? (
        <TodayItem
          overline="Upcoming event"
          title={data.event.title}
          meta={new Date(data.event.starts_at).toLocaleString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
          })}
          onPress={() => goToEvent(data.event!.id)}
          testID="community-today-event"
        />
      ) : null}
      {data?.challenge ? (
        <TodayItem
          overline="Challenge"
          title={data.challenge.title}
          meta={`Ends ${new Date(data.challenge.ends_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`}
          onPress={() => goToChallenge(data.challenge!.id)}
          testID="community-today-challenge"
        />
      ) : null}
    </>,
    canCompose ? (
      <PrimaryButton
        label="New post"
        onPress={() => navigation.navigate('CommunityComposer', { mode: 'post' })}
        testID="community-today-compose"
      />
    ) : undefined,
  );
}

// ─── one Today item: overline, serif title, muted meta, chevron ─────────────

function TodayItem({ overline, title, titleLines, meta, onPress, testID }: {
  overline: string; title: string; titleLines?: number; meta?: string; onPress: () => void; testID: string;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <QuietSection style={styles.item}>
      <HapticPressable
        intent="light"
        disableAnimation
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[overline, title, meta].filter(Boolean).join(', ')}
        testID={testID}
        style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
      >
        <View style={styles.itemText}>
          <Overline>{overline}</Overline>
          <Text numberOfLines={titleLines} style={[styles.itemTitle, { color: semanticColors.textPrimary }]}>{title}</Text>
          {meta ? <Text style={[styles.itemMeta, { color: semanticColors.textMuted }]}>{meta}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={semanticColors.textMuted} />
      </HapticPressable>
    </QuietSection>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.xs },
  narrative: { ...typography.h2, marginBottom: spacing.sm },
  item: { marginBottom: 0 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  itemText: { flex: 1, gap: spacing.xs },
  itemTitle: { ...typography.h3 },
  itemMeta: { ...typography.bodySmall, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
});
