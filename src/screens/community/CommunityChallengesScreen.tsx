/**
 * CommunityChallengesScreen — the discovery surface for community challenges
 * (v3-1). Lists the workspace's challenges as ChallengeCards; tapping a card
 * opens its detail (where the caller's own participation is loaded).
 *
 * Each row foregrounds the challenge itself (a calm "Join" affordance), not a
 * ranking. Loading / empty / error states are distinct, and the workspace
 * prerequisite (useCommunityMe) is resolved BEFORE any challenge empty state so
 * a still-loading or failed prerequisite is never shown as "no challenges yet".
 * The list is cursor-paginated (useInfiniteQuery + onEndReached) so older
 * challenges stay reachable without an unbounded fetch.
 *
 * Registered in CommunityNavigator only when `featureFlags.communityChallenges`
 * is true; a defense-in-depth guard renders a neutral "not available" state if
 * it is somehow reached with the flag off. Tokens only; line Ionicons only.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useCommunityMe } from '../../hooks/useCommunity';
import { ThreadHeader, ChallengeCard } from '../../components/community';
import HapticPressable from '../../components/HapticPressable';
import {
  communityChallengesApi,
  CHALLENGES_PAGE_LIMIT,
  type CommunityChallenge,
} from '../../api/communityChallengesApi';
import type { CommunityNav } from './communityNavTypes';

interface Props {
  embedded?: boolean;
  /**
   * Workspace id — challenges are workspace-scoped on the backend. When the
   * Community tab embeds this surface it passes the resolved id; when the route
   * is reached on its own (e.g. a deep link) the prop is absent and the screen
   * resolves the id itself from `useCommunityMe`.
   *
   * `undefined` means "not provided, resolve it here"; an explicit `null` means
   * "the parent's prerequisite is still loading/errored" and is treated as
   * not-yet-resolved, never as a real empty workspace.
   */
  workspaceId?: string | null;
}

export default function CommunityChallengesScreen({
  embedded,
  workspaceId: workspaceIdProp,
}: Props): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();

  // Resolve the workspace id internally when it was not threaded through props.
  // The hook is always called (Rules of Hooks); an explicit prop, when present,
  // wins so embedded callers avoid a second fetch.
  const me = useCommunityMe();
  const usingOwnMe = workspaceIdProp === undefined;
  const workspaceId = usingOwnMe
    ? (me.data?.workspace_id ?? null)
    : workspaceIdProp;

  // The workspace prerequisite must SUCCEED before we can decide "no challenges".
  // When this screen owns the `me` query it reads its state directly; when the
  // parent owns it, an explicit `null` prop means the parent's prerequisite has
  // not resolved yet, so a null id is treated as still-pending (never a real
  // empty workspace). The challenge empty state is reached only once a non-null
  // workspace id exists.
  const prerequisiteLoading = usingOwnMe ? me.isLoading : workspaceIdProp === null;
  const prerequisiteError = usingOwnMe ? me.isError : false;

  const challenges = useInfiniteQuery({
    // The page limit is part of the key so a different page size is a distinct
    // cache entry; the cursor is threaded through pageParam under one key.
    queryKey: ['community', 'challenges', workspaceId ?? '∅', CHALLENGES_PAGE_LIMIT],
    queryFn: ({ pageParam }) => {
      // Enabled only when workspaceId is non-null, so this guard is unreachable
      // at runtime; it narrows `string | null` -> `string` without a cast.
      if (!workspaceId) throw new Error('workspaceId is required');
      return communityChallengesApi.listChallenges(workspaceId, {
        limit: CHALLENGES_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!workspaceId && featureFlags.communityChallenges,
  });

  const data = useMemo(
    () => challenges.data?.pages.flatMap((p) => p.challenges) ?? [],
    [challenges.data],
  );

  const open = (challenge: CommunityChallenge) =>
    navigation.navigate('CommunityChallengeDetail', { challengeId: challenge.id });

  const onEndReached = useCallback(() => {
    if (challenges.hasNextPage && !challenges.isFetchingNextPage) {
      void challenges.fetchNextPage();
    }
  }, [challenges]);

  // Announce the loaded count once the data lands so a screen-reader user knows
  // the surface populated. A ref tracks the last announced count so only an
  // actual transition speaks. The FlatList also carries an explicit
  // `accessibilityLabel` + `accessibilityLiveRegion="polite"` below.
  const challengeCount = data.length;
  const lastAnnouncedCount = useRef<number | null>(null);
  useEffect(() => {
    if (!challenges.isSuccess) return;
    if (lastAnnouncedCount.current === challengeCount) return;
    lastAnnouncedCount.current = challengeCount;
    AccessibilityInfo.announceForAccessibility(
      challengeCount > 0
        ? `Challenges loaded, ${challengeCount} ${challengeCount === 1 ? 'item' : 'items'}`
        : 'Challenges loaded, none yet',
    );
  }, [challenges.isSuccess, challengeCount]);

  const Container: React.ComponentType<{ children: React.ReactNode }> = embedded
    ? ({ children }) => <View style={styles.flex}>{children}</View>
    : ({ children }) => (
        <SafeAreaView
          style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
          edges={['top']}
        >
          {children}
        </SafeAreaView>
      );

  // Defense-in-depth: never reachable with the flag off (the route is not
  // registered), but render a neutral state rather than a blank screen.
  if (!featureFlags.communityChallenges) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Challenges are not available right now.
          </Text>
        </View>
      </Container>
    );
  }

  // The workspace prerequisite is resolved BEFORE any challenge state so a
  // still-loading or failed prerequisite is never mistaken for an empty
  // workspace. Loading shows a busy state; an error shows a calm retry.
  if (prerequisiteLoading) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-challenges-prereq-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading challenges"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading challenges…
          </Text>
        </View>
      </Container>
    );
  }

  if (prerequisiteError) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center} testID="community-challenges-prereq-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load challenges. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void me.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-challenges-prereq-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  if (challenges.isLoading) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-challenges-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading challenges"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading challenges…
          </Text>
        </View>
      </Container>
    );
  }

  if (challenges.isError) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center} testID="community-challenges-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            We could not load challenges. Please try again.
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void challenges.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-challenges-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </Container>
    );
  }

  if (data.length === 0) {
    return (
      <Container>
        <ThreadHeader title="Challenges" testID="community-challenges-header" />
        <View style={styles.center} testID="community-challenges-empty">
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            No challenges yet. Your coach will add one when it is time.
          </Text>
        </View>
      </Container>
    );
  }

  return (
    <Container>
      <ThreadHeader title="Challenges" testID="community-challenges-header" />
      <FlatList
        data={data}
        accessibilityRole="list"
        accessibilityLabel={
          data.length > 0
            ? `Challenges, ${data.length} ${data.length === 1 ? 'item' : 'items'}`
            : 'Challenges, empty'
        }
        accessibilityLiveRegion="polite"
        renderItem={({ item }) => (
          // The outer wrapper carries `listitem` semantics so assistive tech
          // receives the list structure, while the inner ChallengeCard keeps
          // `button` (the tap target) without role collision. RN types the W3C
          // `role` prop (not `accessibilityRole`) for list/listitem; this
          // matches the EventCard precedent.
          <View role="listitem" testID={`community-challenge-listitem-${item.id}`}>
            <ChallengeCard
              challenge={item}
              participation={null}
              onPress={open}
              testID={`community-challenge-card-${item.id}`}
            />
          </View>
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          challenges.isFetchingNextPage ? (
            <View style={styles.loadMore} testID="community-challenges-load-more">
              <ActivityIndicator
                color={semanticColors.accent}
                accessibilityRole="progressbar"
                accessibilityLabel="Loading more challenges"
              />
            </View>
          ) : null
        }
        testID="community-challenges-list"
      />
    </Container>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  muted: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: {
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  loadMore: { paddingVertical: spacing.lg, alignItems: 'center' },
});
