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
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
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
  type CommunityChallengeComment,
  type CommunityChallengeLeaderboardRow,
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
    queryKey: ['community', 'challenge', challengeId, 'comments'],
    queryFn: () => communityChallengesApi.listComments(challengeId),
    enabled: !!challengeId && featureFlags.communityChallenges,
  });

  const participation = detail.data?.participation ?? null;
  const joined = participation !== null;
  const optedIn = participation?.leaderboard_opted_in ?? false;
  const leaderboardEnabled = detail.data?.challenge.leaderboard_enabled ?? false;

  // Leaderboard is fetched ONLY once the caller has opted in (and the coach
  // enabled it). Off by default — we never request standings without consent.
  const leaderboard = useQuery({
    queryKey: ['community', 'challenge', challengeId, 'leaderboard'],
    queryFn: () => communityChallengesApi.getLeaderboard(challengeId),
    enabled:
      !!challengeId &&
      featureFlags.communityChallenges &&
      leaderboardEnabled &&
      optedIn,
  });

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

  const invalidateDetail = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['community', 'challenge', challengeId],
    });
  }, [queryClient, challengeId]);

  const invalidateLeaderboard = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['community', 'challenge', challengeId, 'leaderboard'],
    });
  }, [queryClient, challengeId]);

  const joinMutation = useMutation({
    mutationFn: () => communityChallengesApi.join(challengeId),
    onMutate: () => setActionError(null),
    onSuccess: invalidateDetail,
    onError: (err: unknown) => {
      if (err instanceof CommunityApiError && err.kind === 'conflict') {
        invalidateDetail();
      }
      setActionError(describeError(err));
    },
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

  const optInMutation = useMutation({
    mutationFn: (next: boolean) =>
      communityChallengesApi.setLeaderboardOptIn(challengeId, next),
    onMutate: () => setActionError(null),
    onSuccess: () => {
      invalidateDetail();
      invalidateLeaderboard();
    },
    onError: (err: unknown) => {
      if (err instanceof CommunityApiError && err.kind === 'conflict') {
        invalidateDetail();
      }
      setActionError(describeError(err));
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
        <View style={styles.center} testID="community-challenge-loading">
          <ActivityIndicator color={semanticColors.accent} />
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
            <View style={styles.lbLoading} testID="community-challenge-lb-loading">
              <ActivityIndicator color={semanticColors.accent} />
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
              {leaderboard.data.rows.map(renderLeaderboardRow)}
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
