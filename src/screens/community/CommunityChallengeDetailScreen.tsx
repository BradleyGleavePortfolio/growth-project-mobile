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
  // comment). No silent swallow (FIFTY_FAILURES #36): every mutation has an
  // onError that sets this, and the banner is dismissible.
  const [actionError, setActionError] = useState<string | null>(null);
  // Imperative handle to the composer so the empty-state CTA can focus it.
  const composerRef = useRef<ComposerInputHandle>(null);

  const detail = useQuery({
    queryKey: ['community', 'challenge', challengeId],
    queryFn: () => communityChallengesApi.getChallenge(challengeId),
    enabled: !!challengeId && featureFlags.communityChallenges,
  });

  const comments = useQuery({
    // The page limit is part of the key so a bounded page is cached distinctly
    // (Category 3 — no unbounded comment fetches).
    queryKey: [
      'community',
      'challenge',
      challengeId,
      'comments',
      CHALLENGE_COMMENTS_PAGE_LIMIT,
    ],
    queryFn: () =>
      communityChallengesApi.listComments(challengeId, {
        limit: CHALLENGE_COMMENTS_PAGE_LIMIT,
      }),
    enabled: !!challengeId && featureFlags.communityChallenges,
  });

  const participation = detail.data?.participation ?? null;
  const joined = participation !== null;
  const optedIn = participation?.leaderboard_opted_in ?? false;
  const leaderboardEnabled = detail.data?.challenge.leaderboard_enabled ?? false;

  // Leaderboard is fetched ONLY once the caller has opted in (and the coach
  // enabled it). Off by default — we never request standings without consent.
  const leaderboard = useQuery({
    queryKey: [
      'community',
      'challenge',
      challengeId,
      'leaderboard',
      CHALLENGE_LEADERBOARD_PAGE_LIMIT,
    ],
    queryFn: () =>
      communityChallengesApi.getLeaderboard(challengeId, {
        limit: CHALLENGE_LEADERBOARD_PAGE_LIMIT,
      }),
    enabled:
      !!challengeId &&
      featureFlags.communityChallenges &&
      leaderboardEnabled &&
      optedIn,
  });

  // A failed optimistic write rolls the UI back AND must be ANNOUNCED to
  // assistive tech, not just shown (P1 — the rollback banner had no live
  // region). We announce the rollback copy whenever `actionError` transitions
  // to a non-null value; the banner itself also carries
  // `accessibilityLiveRegion="polite"` so a screen reader already focused near
  // it re-reads on mount. The two together cover both focus positions.
  useEffect(() => {
    if (actionError) {
      AccessibilityInfo.announceForAccessibility(actionError);
    }
  }, [actionError]);

  // The TRUE-EMPTY surface is only shown once the comments query has actually
  // resolved to zero rows, so a load error never masquerades as "empty" (F8).
  // The original P0 was that this surface rendered LOCAL Roman copy from
  // `romanVoice.ts`; the brief's remedy is a backend payload, but the binding
  // backend (PR #390 head) serves NO empty-state payload for this participant
  // surface and the Roman voice-policy has no `challenge_comments_empty` key.
  // Per the brief ("missing payload => honest state, never local fallback") the
  // honest resolution is a NEUTRAL, non-Roman-voiced empty state derived from
  // this query result -- no local Roman copy, no invented backend endpoint.
  const commentsResolvedEmpty =
    comments.isSuccess && (comments.data?.length ?? 0) === 0;

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

  // ── Optimistic JOIN (P1) ────────────────────────────────────────────────
  // Joining writes a provisional participation row into the detail cache
  // immediately so the primary action and progress affordance flip without
  // waiting for the round-trip. onError restores the exact previous cache
  // (rollback) AND surfaces+announces the failure; onSettled reconciles with
  // the server's monotonic truth. A 409 (already joined) is treated as success
  // for UX purposes — we simply reconcile.
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
      // Roll the cache back to the pre-mutation snapshot (never leave optimistic
      // state dangling — #30), then surface + announce the failure (#36).
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
      // + leaderboard so the next attempt starts from the true value
      // (FIFTY_FAILURES #30: never leave optimistic state dangling). The sheet
      // owns the inline error surface, so we do NOT raise the banner here; we
      // let mutateAsync reject into the sheet's calm catch.
      if (err instanceof CommunityApiError && err.kind === 'conflict') {
        invalidateDetail();
        invalidateLeaderboard();
      }
    },
  });

  // ── Optimistic leaderboard OPT-IN / OPT-OUT (P1) ───────────────────────────
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
    mutationFn: (commentId: string) =>
      communityChallengesApi.reportComment(
        challengeId,
        commentId,
        'inappropriate',
      ),
    onMutate: () => setActionError(null),
    onSuccess: () =>
      setActionError('Thanks -- our team will take a look at this.'),
    onError: (err: unknown) => setActionError(describeError(err)),
  });

  const handleSubmitProgress = useCallback(
    async (value: number): Promise<{ completed: boolean }> => {
      // Rejects on failure so the sheet keeps the draft + shows its calm inline
      // error; resolves with the server-confirmed completion so the sheet can
      // stage the completion peak (UX finding 4). The sheet, not the screen,
      // owns dismissal now.
      const result = await progressMutation.mutateAsync(value);
      return { completed: result.completed };
    },
    [progressMutation],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focus();
  }, []);

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
            <Text style={[styles.retryLabel, { color: semanticColors.accent }]}>
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

  const commentData = comments.data ?? [];
  // F8: a LOAD ERROR and a TRUE EMPTY are different states and must never be
  // conflated. A load error gets a calm retry (the composer stays available);
  // a true empty (server confirmed zero rows) gets a NEUTRAL, non-Roman empty
  // state with a real CTA (no local Roman copy, no invented backend payload).
  const commentsLoadError = comments.isError;
  const commentsTrueEmpty = commentsResolvedEmpty;
  const hasComments = commentData.length > 0;

  // Neutral, non-Roman UI copy for the true-empty surface. This is a plain UI
  // affordance string, NOT Roman voice and NOT sourced from `romanVoice.ts`.
  const EMPTY_COMMENTS_MESSAGE =
    'No encouragement notes yet. Be the first to leave one.';

  const renderComment = ({ item }: { item: CommunityChallengeComment }) => {
    const mine = item.author_user_id === client?.id;
    return (
      <View
        // List-item membership: the parent comments FlatList carries
        // `accessibilityRole="list"`. RN's typed AccessibilityRole union has no
        // 'listitem' (only the 'list' container role), so we keep each row an
        // addressable accessible View inside the list rather than forcing an
        // unsupported role via an unsafe cast (R0). (P1 — list/listitem.)
        style={[styles.comment, { borderColor: semanticColors.border }]}
        testID={`community-challenge-comment-${item.id}`}
      >
        <Text style={[styles.commentBody, { color: semanticColors.textPrimary }]}>
          {item.body}
        </Text>
        {!mine ? (
          <HapticPressable
            intent="light"
            onPress={() => reportMutation.mutate(item.id)}
            accessibilityRole="button"
            accessibilityLabel="Report this comment"
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
      // List-item membership via the parent leaderboard FlatList's
      // `accessibilityRole="list"` (RN has no typed 'listitem' role; see the
      // comment row note). (P1 — list/listitem.)
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
            // F7: a NEUTRAL, equal-weight choice -- not a single nudge toward
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
                  <Text style={[styles.optInLabel, { color: semanticColors.accent }]}>
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
          ) : leaderboard.isError || !leaderboard.data ? (
            <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
              We could not load the leaderboard right now.
            </Text>
          ) : leaderboard.data.rows.length === 0 ? (
            <Text style={[styles.muted, { color: semanticColors.textMuted }]}>
              No one has shared progress yet. You are first — nicely done.
            </Text>
          ) : (
            <View>
              {/* Virtualized leaderboard list (was an in-memory .map — Category
                  3 / N+1 render gate). The rows are bounded by the page limit
                  the query requests, and FlatList virtualizes them. It lives
                  inside the comments list's header, so vertical scroll is
                  delegated to the parent (scrollEnabled=false) to avoid nested
                  scroll conflicts while keeping windowed rendering. The
                  container carries the `list` role; each row is an addressable
                  item within it. */}
              <FlatList
                data={leaderboard.data.rows}
                accessibilityRole="list"
                scrollEnabled={false}
                removeClippedSubviews
                renderItem={({ item }) => renderLeaderboardRow(item)}
                keyExtractor={(row) => row.user_id}
                testID="community-challenge-leaderboard-list"
              />
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

  // F1/F8: the footer below the comments list. Three honest, distinct states:
  //   1. comments LOAD ERROR  -> calm retry; the composer below stays usable.
  //   2. comments TRUE EMPTY  -> a NEUTRAL (non-Roman) empty state with a REAL
  //      focus CTA. No local Roman copy (the P0) and no invented backend
  //      payload (there is none on the binding backend branch).
  //   3. has comments         -> no footer.
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
        <Text style={[styles.retryLabel, { color: semanticColors.accent }]}>
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
          // P1: the rollback / failure banner is announced to assistive tech.
          // `polite` re-reads the contents to a screen reader on mount; the
          // imperative announceForAccessibility in the effect above covers the
          // case where focus is elsewhere on the screen.
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
        renderItem={renderComment}
        ListHeaderComponent={Header}
        ListFooterComponent={commentsFooter}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        testID="community-challenge-comments"
      />

      <ComposerInput
        ref={composerRef}
        onSubmit={(body) => commentMutation.mutate(body)}
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
    // >=48dp touch target (F5 / WCAG 2.5.5, design checklist §6.2). The icon is
    // visually small but the hit area is a full 48dp square.
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
