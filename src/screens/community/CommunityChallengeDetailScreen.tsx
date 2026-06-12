/**
 * CommunityChallengeDetailScreen — the full-screen detail for one community
 * challenge (v3-1). Route param: `challengeId`.
 *
 * BEHAVIORAL DESIGN (DESIGN_INTELLIGENCE Part III + §5.1 Screen Design Protocol):
 *   - The screen leads with the participant's OWN progress in real metric units
 *     — a competence signal (§3.7), never a "behind"/"losing" framing (§3.4).
 *   - The cohort-LOCAL leaderboard (Strava §3.2) is STRICTLY OPT-IN: it is shown
 *     only when the coach enabled it for the challenge AND the caller has opted
 *     in. Until then the surface offers a calm, no-pressure opt-in affordance and
 *     never reveals anyone's standing — zero shame, zero public failure (§3.4).
 *   - One primary action (Hick's Law): Join when not joined, otherwise Log
 *     progress via the ChallengeProgressSheet. Encouragement comments are a
 *     secondary, social-proof surface, reportable for moderation.
 *
 * FLAG POSTURE: this route is only registered in CommunityNavigator when
 * `featureFlags.communityChallenges` is true, so when the flag is OFF the screen
 * never enters the tree. As a defense-in-depth guard the body still renders a
 * neutral "not available" state if it is somehow reached with the flag off.
 *
 * DATA: uses `communityChallengesApi` directly via react-query (the shared
 * `useCommunity` hooks are out of this slice's scope). Every mutation invalidates
 * the relevant query so the UI reflects the server's monotonic truth. Tokens
 * only (no raw hex); line Ionicons only (no emoji); reduced-motion aware via the
 * progress sheet; real loading / empty / error states (no spinner-only screens).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { featureFlags } from '../../config/featureFlags';
import { ThreadHeader, ComposerInput } from '../../components/community';
import type { ComposerInputHandle } from '../../components/community/ComposerInput';
import HapticPressable from '../../components/HapticPressable';
import ChallengeProgressSheet from '../../components/community/ChallengeProgressSheet';
import ChallengeCommentsEmptyState from '../../components/community/ChallengeCommentsEmptyState';
import {
  communityChallengesApi,
  CHALLENGE_COMMENTS_PAGE_LIMIT,
  CHALLENGE_LEADERBOARD_PAGE_LIMIT,
  type CommunityChallenge,
  type CommunityChallengeComment,
  type CommunityChallengeLeaderboardRow,
  type CommunityChallengeParticipation,
} from '../../api/communityChallengesApi';
import { CommunityApiError } from '../../api/communityApi';
import { generateIdempotencyKey } from '../../utils/idempotency';
import type { CommunityRoute } from './communityNavTypes';

const COMMENT_MAX = 2000; // mirror backend CreateChallengeCommentDto

/** A human, non-shaming reason for an error surface (no raw error leakage). */
function describeError(err: unknown): string {
  if (err instanceof CommunityApiError) {
    switch (err.kind) {
      case 'forbidden':
        return 'This challenge belongs to a cohort you are not part of.';
      case 'gone':
        return 'This challenge is no longer available.';
      case 'conflict':
        return 'Your progress was updated elsewhere. We have refreshed it for you.';
      case 'network':
        return 'We could not reach the server. Check your connection and try again.';
      case 'contract':
        return 'Something looks off on our end. Please try again shortly.';
      default:
        return 'We could not load this challenge. Please try again.';
    }
  }
  return 'We could not load this challenge. Please try again.';
}

export default function CommunityChallengeDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const route = useRoute<CommunityRoute<'CommunityChallengeDetail'>>();
  const challengeId = route.params?.challengeId ?? '';
  const client = useCurrentUser();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  // A calm, surfaced banner for a failed write action (join / opt-in / report /
  // comment). Every mutation has an onError that sets this, and the banner is
  // dismissible, so a failure is never silently swallowed.
  const [actionError, setActionError] = useState<string | null>(null);
  // The comment id whose report is currently in flight, so its report control
  // can be disabled to block a double-submit while the request is pending.
  const [reportingId, setReportingId] = useState<string | null>(null);
  // One stable Idempotency-Key per comment-report intent, so a double-tap or
  // retry of the same report deduplicates server-side rather than minting a
  // fresh key each tap. Keyed by comment id; persists across renders.
  const reportKeys = useRef<Map<string, string>>(new Map());
  // Imperative handle to the composer so the empty-state CTA can focus it.
  const composerRef = useRef<ComposerInputHandle>(null);

  const detail = useQuery({
    queryKey: ['community', 'challenge', challengeId],
    queryFn: () => communityChallengesApi.getChallenge(challengeId),
    enabled: !!challengeId && featureFlags.communityChallenges,
  });

  // Comments are cursor-paginated: the page limit is part of the key (a
  // distinct page size is a distinct cache entry) and the cursor is threaded
  // through pageParam, so older notes stay reachable via fetchNextPage.
  const comments = useInfiniteQuery({
    queryKey: [
      'community',
      'challenge',
      challengeId,
      'comments',
      CHALLENGE_COMMENTS_PAGE_LIMIT,
    ],
    queryFn: ({ pageParam }) =>
      communityChallengesApi.listComments(challengeId, {
        limit: CHALLENGE_COMMENTS_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!challengeId && featureFlags.communityChallenges,
  });

  const commentData = useMemo(
    () => comments.data?.pages.flatMap((p) => p.comments) ?? [],
    [comments.data],
  );

  const participation = detail.data?.participation ?? null;
  const joined = participation !== null;
  const optedIn = participation?.leaderboard_opted_in ?? false;
  const leaderboardEnabled = detail.data?.challenge.leaderboard_enabled ?? false;

  // Leaderboard is fetched ONLY once the caller has opted in (and the coach
  // enabled it). Off by default — we never request standings without consent.
  // Cursor-paginated so a long cohort board pages in rather than fetching
  // unbounded; the first page carries `available`/`opted_in`.
  const leaderboard = useInfiniteQuery({
    queryKey: [
      'community',
      'challenge',
      challengeId,
      'leaderboard',
      CHALLENGE_LEADERBOARD_PAGE_LIMIT,
    ],
    queryFn: ({ pageParam }) =>
      communityChallengesApi.getLeaderboard(challengeId, {
        limit: CHALLENGE_LEADERBOARD_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled:
      !!challengeId &&
      featureFlags.communityChallenges &&
      leaderboardEnabled &&
      optedIn,
  });

  const leaderboardRows = useMemo(
    () => leaderboard.data?.pages.flatMap((p) => p.rows) ?? [],
    [leaderboard.data],
  );

  // A failed optimistic write rolls the UI back and is also announced to
  // assistive tech, not just shown, so a swallowed failure can never go
  // unnoticed. The banner itself also carries a polite live region.
  useEffect(() => {
    if (actionError) {
      AccessibilityInfo.announceForAccessibility(actionError);
    }
  }, [actionError]);

  // The comments and leaderboard lists carry a list role + label, and also
  // announce their loaded count once the async data settles so a screen reader
  // hears the surface populate. A ref tracks the last announced count so an
  // unrelated re-render never re-announces.
  const commentsCount = commentData.length;
  const lastCommentsAnnounced = useRef<number | null>(null);
  useEffect(() => {
    if (!comments.isSuccess) return;
    if (lastCommentsAnnounced.current === commentsCount) return;
    lastCommentsAnnounced.current = commentsCount;
    AccessibilityInfo.announceForAccessibility(
      commentsCount > 0
        ? `Encouragement notes loaded, ${commentsCount} ${
            commentsCount === 1 ? 'item' : 'items'
          }`
        : 'Encouragement notes loaded, none yet',
    );
  }, [comments.isSuccess, commentsCount]);

  const leaderboardCount = leaderboardRows.length;
  const lastLeaderboardAnnounced = useRef<number | null>(null);
  useEffect(() => {
    if (!leaderboard.isSuccess) return;
    if (lastLeaderboardAnnounced.current === leaderboardCount) return;
    lastLeaderboardAnnounced.current = leaderboardCount;
    AccessibilityInfo.announceForAccessibility(
      leaderboardCount > 0
        ? `Leaderboard loaded, ${leaderboardCount} ${
            leaderboardCount === 1 ? 'row' : 'rows'
          }`
        : 'Leaderboard loaded, no rows yet',
    );
  }, [leaderboard.isSuccess, leaderboardCount]);

  // The true-empty surface is only shown once the comments query has actually
  // resolved to zero rows, so a load error never masquerades as "empty". The
  // copy is a neutral UI string, not a localized voice payload.
  const commentsResolvedEmpty = comments.isSuccess && commentData.length === 0;

  const detailKey = useMemo(
    () => ['community', 'challenge', challengeId] as const,
    [challengeId],
  );

  const invalidateDetail = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: detailKey });
  }, [queryClient, detailKey]);

  const invalidateLeaderboard = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['community', 'challenge', challengeId, 'leaderboard'],
    });
  }, [queryClient, challengeId]);

  /** The exact shape react-query caches for the detail query. */
  type DetailCache = {
    challenge: CommunityChallenge;
    participation: CommunityChallengeParticipation | null;
  };

  // Optimistic join: write a provisional participation row into the detail
  // cache immediately so the primary action and progress affordance flip
  // without waiting for the round-trip. onError restores the exact previous
  // cache and surfaces + announces the failure; onSettled reconciles with the
  // server's monotonic truth. A 409 (already joined) simply reconciles.
  const joinMutation = useMutation({
    mutationFn: () => communityChallengesApi.join(challengeId),
    onMutate: async (): Promise<{ previous: DetailCache | undefined }> => {
      setActionError(null);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<DetailCache>(detailKey);
      if (previous && previous.participation === null) {
        const optimistic: CommunityChallengeParticipation = {
          challenge_id: challengeId,
          user_id: client?.id ?? '',
          progress_value: 0,
          target_value: previous.challenge.target_value,
          progress_fraction: previous.challenge.target_value ? 0 : null,
          completed: false,
          completed_at: null,
          last_logged_at: null,
          leaderboard_opted_in: false,
        };
        queryClient.setQueryData<DetailCache>(detailKey, {
          ...previous,
          participation: optimistic,
        });
      }
      return { previous };
    },
    onError: (err: unknown, _vars, context) => {
      // Roll the cache back to the pre-mutation snapshot, then surface and
      // announce the failure so it is never silently swallowed.
      if (context?.previous !== undefined) {
        queryClient.setQueryData<DetailCache>(detailKey, context.previous);
      }
      setActionError(describeError(err));
    },
    onSettled: () => invalidateDetail(),
  });

  const progressMutation = useMutation({
    mutationFn: (value: number) =>
      communityChallengesApi.updateProgress(challengeId, value),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      invalidateDetail();
      invalidateLeaderboard();
    },
    onError: (err: unknown) => {
      // On a 409 the server's monotonic total moved under us -- re-fetch detail
      // + leaderboard so the next attempt starts from the true value. The sheet
      // owns the inline error surface, so we do NOT raise the banner here; we
      // let mutateAsync reject into the sheet's calm catch.
      if (err instanceof CommunityApiError && err.kind === 'conflict') {
        invalidateDetail();
        invalidateLeaderboard();
      }
    },
  });

  // ── Optimistic leaderboard opt-in / opt-out ──────────────────────────────
  // Flipping the opt-in toggle updates the cached participation immediately so
  // the leaderboard block reveals/hides without a round-trip. onError restores
  // the snapshot (rollback) and surfaces+announces the failure; onSettled
  // reconciles detail + leaderboard with the server.
  const optInMutation = useMutation({
    mutationFn: (next: boolean) =>
      communityChallengesApi.setLeaderboardOptIn(challengeId, next),
    onMutate: async (
      next: boolean,
    ): Promise<{ previous: DetailCache | undefined }> => {
      setActionError(null);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<DetailCache>(detailKey);
      if (previous && previous.participation) {
        queryClient.setQueryData<DetailCache>(detailKey, {
          ...previous,
          participation: {
            ...previous.participation,
            leaderboard_opted_in: next,
          },
        });
      }
      return { previous };
    },
    onError: (err: unknown, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<DetailCache>(detailKey, context.previous);
      }
      setActionError(describeError(err));
    },
    onSettled: () => {
      invalidateDetail();
      invalidateLeaderboard();
    },
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      communityChallengesApi.addComment(challengeId, body),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['community', 'challenge', challengeId, 'comments'],
      });
    },
    onError: (err: unknown) => setActionError(describeError(err)),
  });

  const reportMutation = useMutation({
    mutationFn: (commentId: string) => {
      let key = reportKeys.current.get(commentId);
      if (!key) {
        key = generateIdempotencyKey();
        reportKeys.current.set(commentId, key);
      }
      return communityChallengesApi.reportComment(
        challengeId,
        commentId,
        'inappropriate',
        undefined,
        key,
      );
    },
    onMutate: (commentId: string) => {
      setActionError(null);
      setReportingId(commentId);
    },
    onSuccess: () =>
      setActionError('Thanks -- our team will take a look at this.'),
    onError: (err: unknown) => setActionError(describeError(err)),
    onSettled: () => setReportingId(null),
  });

  const onReport = useCallback(
    (commentId: string) => {
      // Guard the double-submit: ignore taps while any report is in flight.
      if (reportMutation.isPending) return;
      reportMutation.mutate(commentId);
    },
    [reportMutation],
  );

  const handleSubmitProgress = useCallback(
    async (value: number): Promise<{ completed: boolean }> => {
      // Rejects on failure so the sheet keeps the draft + shows its calm inline
      // error; resolves with the server-confirmed completion so the sheet can
      // stage the completion peak. The sheet, not the screen, owns dismissal.
      const result = await progressMutation.mutateAsync(value);
      return { completed: result.completed };
    },
    [progressMutation],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focus();
  }, []);

  const onCommentsEndReached = useCallback(() => {
    if (comments.hasNextPage && !comments.isFetchingNextPage) {
      void comments.fetchNextPage();
    }
  }, [comments]);

  const onLeaderboardEndReached = useCallback(() => {
    if (leaderboard.hasNextPage && !leaderboard.isFetchingNextPage) {
      void leaderboard.fetchNextPage();
    }
  }, [leaderboard]);

  const handlePrimaryAction = useCallback(() => {
    if (!joined) {
      joinMutation.mutate(undefined, { onSuccess: () => setSheetOpen(true) });
      return;
    }
    setSheetOpen(true);
  }, [joined, joinMutation]);

  const primaryLabel = useMemo(() => {
    if (joinMutation.isPending) return 'Joining…';
    if (!joined) return 'Join this challenge';
    if (participation?.completed) return 'Log more progress';
    return 'Log progress';
  }, [joined, joinMutation.isPending, participation?.completed]);

  // ── Flag-off defense-in-depth ────────────────────────────────────────────
  if (!featureFlags.communityChallenges) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-challenge-detail-screen"
      >
        <ThreadHeader title="Challenge" testID="community-challenge-header" />
        <View style={styles.center}>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Challenges are not available right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (detail.isLoading) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-challenge-detail-screen"
      >
        <ThreadHeader title="Challenge" testID="community-challenge-header" />
        <View
          style={styles.center}
          accessibilityState={{ busy: true }}
          testID="community-challenge-loading"
        >
          <ActivityIndicator
            color={semanticColors.accent}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading the challenge"
          />
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            Loading the challenge…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (detail.isError || !detail.data) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-challenge-detail-screen"
      >
        <ThreadHeader title="Challenge" testID="community-challenge-header" />
        <View style={styles.center} testID="community-challenge-error">
          <Ionicons
            name="alert-circle-outline"
            size={28}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.errorTitle, { color: semanticColors.textPrimary }]}>
            We could not load this challenge
          </Text>
          <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
            {describeError(detail.error)}
          </Text>
          <HapticPressable
            intent="light"
            onPress={() => void detail.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="community-challenge-retry"
            style={[styles.retry, { borderColor: semanticColors.accent }]}
          >
            <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
              Try again
            </Text>
          </HapticPressable>
        </View>
      </SafeAreaView>
    );
  }

  const challenge = detail.data.challenge;
  const target = challenge.target_value;
  const unit = challenge.unit ?? '';
  const value = participation?.progress_value ?? 0;
  const fraction =
    target !== null && target > 0
      ? Math.min(Math.max(value / target, 0), 1)
      : null;
  const progressText =
    target === null
      ? `${value}${unit ? ` ${unit}` : ''} logged`
      : `${value} of ${target}${unit ? ` ${unit}` : ''}`;

  // A load error and a true-empty are distinct states and must never be
  // conflated: a load error gets a calm retry (the composer stays available); a
  // true empty (server-confirmed zero rows) gets a neutral empty state + CTA.
  const commentsLoadError = comments.isError;
  const commentsTrueEmpty = commentsResolvedEmpty;
  const hasComments = commentData.length > 0;

  const EMPTY_COMMENTS_MESSAGE =
    'No encouragement notes yet. Be the first to leave one.';

  const renderComment = ({ item }: { item: CommunityChallengeComment }) => {
    const mine = item.author_user_id === client?.id;
    // Disable this row's report control while any report is in flight; the
    // tapped row also shows a busy state so a double-tap cannot fire twice.
    const reporting = reportMutation.isPending;
    const reportingThis = reportingId === item.id;
    return (
      <View
        // The wrapper carries `listitem` semantics so assistive tech receives
        // the list structure (the parent FlatList carries the `list` role),
        // while the inner report control keeps `button`. RN types the W3C
        // `role` prop (not `accessibilityRole`) for list/listitem.
        role="listitem"
        style={[styles.comment, { borderColor: semanticColors.border }]}
        testID={`community-challenge-comment-${item.id}`}
      >
        <Text style={[styles.commentBody, { color: semanticColors.textPrimary }]}>
          {item.body}
        </Text>
        {!mine ? (
          <HapticPressable
            intent="light"
            onPress={() => onReport(item.id)}
            disabled={reporting}
            accessibilityRole="button"
            accessibilityLabel="Report this comment"
            accessibilityState={{ disabled: reporting, busy: reportingThis }}
            testID={`community-challenge-comment-${item.id}-report`}
            style={styles.reportButton}
          >
            <Ionicons
              name="flag-outline"
              size={16}
              color={semanticColors.textMuted}
            />
          </HapticPressable>
        ) : null}
      </View>
    );
  };

  const renderLeaderboardRow = (row: CommunityChallengeLeaderboardRow) => (
    <View
      key={row.user_id}
      // The outer wrapper carries `listitem` semantics so assistive tech
      // receives the list structure (the parent leaderboard FlatList carries
      // `accessibilityRole="list"`). RN types the W3C `role` prop (not
      // `accessibilityRole`) for list/listitem; this matches the EventCard
      // precedent (see the comment row note).
      role="listitem"
      style={[
        styles.lbRow,
        { borderColor: semanticColors.border },
        row.is_self ? { backgroundColor: semanticColors.bgSurface } : null,
      ]}
      testID={`community-challenge-lb-${row.user_id}`}
    >
      <Text style={[styles.lbRank, { color: semanticColors.textMuted }]}>
        {row.rank}
      </Text>
      <Text style={[styles.lbName, { color: semanticColors.textPrimary }]}>
        {row.is_self ? 'You' : 'A cohort member'}
      </Text>
      <Text style={[styles.lbValue, { color: semanticColors.textPrimary }]}>
        {row.progress_value}
        {unit ? ` ${unit}` : ''}
      </Text>
    </View>
  );

  const Header = (
    <View style={styles.headerBlock}>
      {challenge.description ? (
        <Text style={[styles.description, { color: semanticColors.textPrimary }]}>
          {challenge.description}
        </Text>
      ) : null}

      {/* The participant's OWN progress, first and foremost. */}
      <View style={styles.progressBlock}>
        <Text style={[styles.sectionLabel, { color: semanticColors.textMuted }]}>
          Your progress
        </Text>
        {fraction !== null ? (
          <View
            style={[styles.track, { backgroundColor: semanticColors.bgSurface }]}
            accessibilityRole="progressbar"
            accessibilityLabel={`Your progress: ${Math.round(fraction * 100)} percent`}
            testID="community-challenge-progress-track"
          >
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: semanticColors.accent,
                  width: `${fraction * 100}%`,
                },
              ]}
              testID="community-challenge-progress-fill"
            />
          </View>
        ) : null}
        <Text style={[styles.progressText, { color: semanticColors.textPrimary }]}>
          {joined ? progressText : 'Join to start logging your progress.'}
          {participation?.completed ? '  ·  Goal reached' : ''}
        </Text>
      </View>

      <HapticPressable
        intent={joined ? 'medium' : 'success'}
        onPress={handlePrimaryAction}
        disabled={joinMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        testID="community-challenge-primary-action"
        style={[styles.cta, { backgroundColor: semanticColors.accent }]}
      >
        <Text style={[styles.ctaLabel, { color: semanticColors.textOnAccent }]}>
          {primaryLabel}
        </Text>
      </HapticPressable>

      {/* Strictly opt-in, cohort-local leaderboard (Strava §3.2). */}
      {leaderboardEnabled ? (
        <View style={styles.lbBlock} testID="community-challenge-leaderboard">
          <Text style={[styles.sectionLabel, { color: semanticColors.textMuted }]}>
            Cohort leaderboard
          </Text>
          {!joined ? (
            <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
              Join the challenge to take part in the leaderboard.
            </Text>
          ) : !optedIn ? (
            // A neutral, equal-weight choice -- not a single nudge toward
            // sharing. Privacy is the stated default and is offered FIRST; both
            // options are the same visual weight (no primary/secondary framing)
            // so opting out is as easy as opting in (§3.4, no pressure).
            <View style={styles.optInBlock}>
              <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
                Private is the default. Sharing puts your progress on your
                cohort's leaderboard; logging works either way, and you can
                change this any time.
              </Text>
              <View style={styles.optInChoiceRow}>
                <HapticPressable
                  intent="light"
                  onPress={() => optInMutation.mutate(false)}
                  disabled={optInMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Keep my progress private"
                  testID="community-challenge-keep-private"
                  style={[
                    styles.optInChoice,
                    { borderColor: semanticColors.border },
                  ]}
                >
                  <Text style={[styles.optInLabel, { color: semanticColors.textPrimary }]}>
                    Keep private
                  </Text>
                </HapticPressable>
                <HapticPressable
                  intent="medium"
                  onPress={() => optInMutation.mutate(true)}
                  disabled={optInMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Share my progress with my cohort"
                  testID="community-challenge-optin"
                  style={[
                    styles.optInChoice,
                    { borderColor: semanticColors.accent },
                  ]}
                >
                  <Text style={[styles.optInLabel, { color: semanticColors.accentText }]}>
                    {optInMutation.isPending ? 'Updating…' : 'Share progress'}
                  </Text>
                </HapticPressable>
              </View>
            </View>
          ) : leaderboard.isLoading ? (
            <View
              style={styles.lbLoading}
              accessibilityState={{ busy: true }}
              testID="community-challenge-lb-loading"
            >
              <ActivityIndicator
                color={semanticColors.accent}
                accessibilityRole="progressbar"
                accessibilityLabel="Loading the leaderboard"
              />
            </View>
          ) : leaderboard.isError ? (
            <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
              We could not load the leaderboard right now.
            </Text>
          ) : leaderboardRows.length === 0 ? (
            <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
              No one has shared progress yet. You are first — nicely done.
            </Text>
          ) : (
            <View>
              {/* The leaderboard FlatList virtualizes the rows but delegates
                  vertical scroll to the parent comments list
                  (scrollEnabled=false) to avoid nested-scroll conflicts; the
                  cursor-paginated "Show more" control below loads further
                  pages since onEndReached cannot fire inside a non-scrolling
                  nested list. */}
              <FlatList
                data={leaderboardRows}
                accessibilityRole="list"
                accessibilityLabel={
                  leaderboardRows.length > 0
                    ? `Leaderboard, ${leaderboardRows.length} ${
                        leaderboardRows.length === 1 ? 'row' : 'rows'
                      }`
                    : 'Leaderboard, empty'
                }
                accessibilityLiveRegion="polite"
                scrollEnabled={false}
                removeClippedSubviews
                renderItem={({ item }) => renderLeaderboardRow(item)}
                keyExtractor={(row) => row.user_id}
                testID="community-challenge-leaderboard-list"
              />
              {leaderboard.hasNextPage ? (
                <HapticPressable
                  intent="light"
                  onPress={onLeaderboardEndReached}
                  disabled={leaderboard.isFetchingNextPage}
                  accessibilityRole="button"
                  accessibilityLabel="Show more leaderboard rows"
                  accessibilityState={{ busy: leaderboard.isFetchingNextPage }}
                  testID="community-challenge-leaderboard-load-more"
                  style={styles.optOutButton}
                >
                  <Text style={[styles.optOutLabel, { color: semanticColors.accentText }]}>
                    {leaderboard.isFetchingNextPage ? 'Loading…' : 'Show more'}
                  </Text>
                </HapticPressable>
              ) : null}
              <HapticPressable
                intent="light"
                onPress={() => optInMutation.mutate(false)}
                disabled={optInMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Stop sharing my progress on the leaderboard"
                testID="community-challenge-optout"
                style={styles.optOutButton}
              >
                <Text style={[styles.optOutLabel, { color: semanticColors.textMuted }]}>
                  Stop sharing my progress
                </Text>
              </HapticPressable>
            </View>
          )}
        </View>
      ) : null}

      <Text
        style={[styles.sectionLabel, styles.commentsHeading, { color: semanticColors.textMuted }]}
      >
        Encouragement
      </Text>
    </View>
  );

  // The footer below the comments list has four states: load error (calm
  // retry, composer stays usable), true-empty (neutral empty state + focus
  // CTA), a load-more spinner while paging, or nothing.
  const commentsFooter = commentsLoadError ? (
    <View style={styles.emptyComments} testID="community-challenge-comments-load-error">
      <Ionicons
        name="cloud-offline-outline"
        size={24}
        color={semanticColors.textMuted}
      />
      <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
        We could not load the encouragement notes. Your message will still send.
      </Text>
      <HapticPressable
        intent="light"
        onPress={() => void comments.refetch()}
        accessibilityRole="button"
        accessibilityLabel="Try loading the notes again"
        testID="community-challenge-comments-retry"
        style={[styles.retry, { borderColor: semanticColors.accent }]}
      >
        <Text style={[styles.retryLabel, { color: semanticColors.accentText }]}>
          Try again
        </Text>
      </HapticPressable>
    </View>
  ) : commentsTrueEmpty ? (
    <View style={styles.emptyComments}>
      <ChallengeCommentsEmptyState
        message={EMPTY_COMMENTS_MESSAGE}
        actionLabel="Leave the first note"
        onAction={focusComposer}
        testID="community-challenge-comments-empty"
      />
    </View>
  ) : comments.isFetchingNextPage ? (
    <View style={styles.emptyComments} testID="community-challenge-comments-load-more">
      <ActivityIndicator
        color={semanticColors.accent}
        accessibilityRole="progressbar"
        accessibilityLabel="Loading more notes"
      />
    </View>
  ) : null;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-challenge-detail-screen"
    >
      <ThreadHeader title={challenge.title} testID="community-challenge-header" />

      {actionError ? (
        <HapticPressable
          intent="light"
          onPress={() => setActionError(null)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this message"
          // The failure banner is announced to assistive tech: `polite`
          // re-reads it on mount, and the effect's announceForAccessibility
          // covers focus that is elsewhere on the screen.
          accessibilityLiveRegion="polite"
          testID="community-challenge-action-error"
          style={[styles.banner, { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border }]}
        >
          <Text style={[styles.bannerText, { color: semanticColors.textPrimary }]}>
            {actionError}
          </Text>
          <Ionicons name="close" size={16} color={semanticColors.textMuted} />
        </HapticPressable>
      ) : null}

      <FlatList
        data={hasComments ? commentData : []}
        accessibilityRole="list"
        accessibilityLabel={
          commentData.length > 0
            ? `Encouragement notes, ${commentData.length} ${
                commentData.length === 1 ? 'item' : 'items'
              }`
            : 'Encouragement notes, empty'
        }
        accessibilityLiveRegion="polite"
        renderItem={renderComment}
        ListHeaderComponent={Header}
        ListFooterComponent={commentsFooter}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={onCommentsEndReached}
        onEndReachedThreshold={0.4}
        testID="community-challenge-comments"
      />

      <ComposerInput
        ref={composerRef}
        onSubmit={async (body) => {
          await commentMutation.mutateAsync(body);
        }}
        maxLength={COMMENT_MAX}
        sending={commentMutation.isPending}
        placeholder="Send a word of encouragement…"
        testID="community-challenge-composer"
      />

      <ChallengeProgressSheet
        visible={sheetOpen}
        challenge={challenge}
        participation={participation}
        onSubmit={handleSubmitProgress}
        onClose={() => setSheetOpen(false)}
        submitting={progressMutation.isPending}
        testID="community-challenge-progress-sheet"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  muted: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
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
  headerBlock: { gap: spacing.md, marginBottom: spacing.md },
  description: { fontSize: 15, lineHeight: 22 },
  progressBlock: { gap: spacing.xs },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  track: {
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  fill: { height: '100%', borderRadius: radius.pill },
  progressText: { fontSize: 15, fontWeight: '600', marginTop: spacing.xs },
  cta: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { fontSize: 15, fontWeight: '600' },
  lbBlock: { gap: spacing.sm, marginTop: spacing.sm },
  optInBlock: { gap: spacing.sm },
  optInChoiceRow: { flexDirection: 'row', gap: spacing.sm },
  optInChoice: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    minHeight: 48,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  optInButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optInLabel: { fontSize: 14, fontWeight: '600' },
  lbLoading: { paddingVertical: spacing.lg, alignItems: 'center' },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lbRank: { fontSize: 14, fontWeight: '600', minWidth: 24 },
  lbName: { flex: 1, fontSize: 14 },
  lbValue: { fontSize: 14, fontWeight: '600' },
  optOutButton: { paddingVertical: spacing.md, minHeight: 48, justifyContent: 'center' },
  optOutLabel: { fontSize: 13, fontWeight: '500' },
  commentsHeading: { marginTop: spacing.md },
  comment: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  commentBody: { flex: 1, fontSize: 14, lineHeight: 20 },
  reportButton: {
    // >=48dp touch target (WCAG 2.5.5). The icon is visually small but the hit
    // area is a full 48dp square.
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyComments: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
});
