/**
 * CommunityTodayScreen — the "today" object (product plan §2.6): the universal
 * home for what's happening for the calling client today. Aggregates the
 * coach's one post / one event / one prompt + the client's cohort context.
 *
 * Entry point for the Community tab. When the client has no membership or no
 * today content, we render a Roman-voiced empty state with a PRIMARY ACTION
 * (no spinner-only states, UX HARD gate). Standardized on semanticColors.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityToday } from '../../hooks/useCommunity';
import HapticPressable from '../../components/HapticPressable';
import { CommunityEmptyState } from '../../components/community';
import { featureFlags } from '../../config/featureFlags';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  /** When embedded in the Tab container the screen omits its own SafeArea. */
  embedded?: boolean;
}

export default function CommunityTodayScreen({
  embedded,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const client = useCurrentUser();
  const today = useCommunityToday();

  const data = today.data;
  const isEmpty =
    !today.isLoading &&
    !today.isError &&
    data != null &&
    !data.cohort &&
    !data.event &&
    !data.pinned_post &&
    !data.challenge;

  const goToMessages = () => {
    if (featureFlags.communityDm) navigation.navigate('CommunityDmList');
  };
  const goToHall = () => {
    if (featureFlags.communityHall) {
      navigation.navigate('CommunitySpace', { space: 'hall' });
    } else {
      goToMessages();
    }
  };
  // F9 (discovery): behind the events flag, the Today event card opens the
  // event's own detail screen. When the flag is off we fall back to the Hall so
  // the card never strands the member (and registers no event route — F1).
  const goToEvent = (eventId: string) => {
    if (featureFlags.communityEvents) {
      navigation.navigate('CommunityEventDetail', { eventId });
    } else {
      goToHall();
    }
  };
  // F6 (discovery): the Today challenge card opens the challenge detail when the
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

  // Empty state: friendly Roman copy + a primary action (never a bare spinner).
  if (isEmpty || today.isError) {
    const noMembership = data?.empty_reason === 'no_membership';
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        style={{ backgroundColor: semanticColors.bgPrimary }}
        testID="community-today-screen"
      >
        <CommunityEmptyState
          stem={noMembership ? 'noCohorts' : 'todayEmpty'}
          firstName={client?.firstName ?? client?.name ?? null}
          title={noMembership ? 'No cohort yet' : 'Nothing waiting today'}
          actionLabel={
            noMembership ? 'Send your coach a message' : 'Visit the Hall'
          }
          onAction={noMembership ? goToMessages : goToHall}
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
      <Text style={[styles.heading, { color: semanticColors.textPrimary }]}>
        Today
      </Text>

      {data?.cohort ? (
        <Card
          color={semanticColors.bgSurface}
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

      {data?.pinned_post ? (
        <Card
          color={semanticColors.bgSurface}
          border={semanticColors.border}
          onPress={() =>
            navigation.navigate('CommunityThread', {
              postId: data.pinned_post!.id,
            })
          }
          testID="community-today-pinned"
        >
          <CardLabel color={semanticColors.textMuted}>From your coach</CardLabel>
          <CardTitle color={semanticColors.textPrimary}>
            {data.pinned_post.title}
          </CardTitle>
        </Card>
      ) : null}

      {data?.event ? (
        <Card
          color={semanticColors.bgSurface}
          border={semanticColors.border}
          onPress={() => goToEvent(data.event!.id)}
          testID="community-today-event"
        >
          <CardLabel color={semanticColors.textMuted}>Upcoming event</CardLabel>
          <CardTitle color={semanticColors.textPrimary}>
            {data.event.title}
          </CardTitle>
        </Card>
      ) : null}

      {data?.challenge ? (
        <Card
          color={semanticColors.bgSurface}
          border={semanticColors.border}
          onPress={() => goToChallenge(data.challenge!.id)}
          testID="community-today-challenge"
        >
          <CardLabel color={semanticColors.textMuted}>Challenge</CardLabel>
          <CardTitle color={semanticColors.textPrimary}>
            {data.challenge.title}
          </CardTitle>
        </Card>
      ) : null}
    </ScrollView>
  );
}

// ─── tiny presentational helpers (kept local to the today surface) ───────────

function Card({
  children,
  color,
  border,
  onPress,
  testID,
}: {
  children: React.ReactNode;
  color: string;
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
      style={[styles.card, { backgroundColor: color, borderColor: border }]}
    >
      {children}
    </HapticPressable>
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
}: {
  children: React.ReactNode;
  color: string;
}): React.ReactElement {
  return <Text style={[styles.cardTitle, { color }]}>{children}</Text>;
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
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  heading: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  card: {
    minHeight: 48,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardMeta: {
    fontSize: 13,
  },
});
