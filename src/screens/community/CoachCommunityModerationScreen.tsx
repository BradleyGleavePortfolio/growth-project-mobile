/**
 * CoachCommunityModerationScreen — the flagged-content review queue (v1-6).
 * Consumes the backend moderation contract: `GET /community/moderation/flagged`
 * (read) and `PATCH /community/moderation/items/:id` (decision). The old
 * `POST /community/{posts,messages}/:id/hide` routes never existed server-side.
 *
 * Each row shows the offending content verbatim, the author, the cohort, a
 * coarse reason label, and four real decisions (Apple App Review 1.2):
 *   Hide    — remove the content for everyone
 *   Warn    — notify the author; they keep access
 *   Ban     — remove the author from the community space and hide the content
 *   Dismiss — close the report with no action (a real server decision)
 * Every decision routes through a confirmation modal (hard gate §2.3 — no
 * one-tap action) and is optimistic with rollback (see useModerateFlagged).
 * "Approve" (a client-only no-op) stays removed (fixer R1 / G10.2 Option A).
 *
 * When a flagged item targets a POST, the content area opens the post-detail
 * surface (with the flagged badge) so the coach can read the full thread before
 * deciding. A flagged VOICE NOTE carries a player (a 15-minute signed link;
 * pull to refresh mints a new one), because audio cannot be text-filtered and
 * the reviewer has to listen. Member WINS show their title and text. Every
 * row shows the 24-hour review commitment ("Review within 5h", or "Past 24
 * hours" once overdue).
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a celebratory "all clear" masquerade); and
 * — when the queue is genuinely clear — the operator-locked Roman-voiced empty
 * state with the SMILE crop, copy + crop sourced from the backend voice policy
 * (face + voice contract). A CompletionToast confirms a successful Hide (G11).
 * Touch targets are >= 44pt.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, semantic } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import {
  CoachRomanEmptyState,
  CoachErrorState,
  ConfirmModal,
  relativeAge,
} from '../../components/community/coach';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import {
  useCoachFlagged,
  useModerateFlagged,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import type {
  CoachFlaggedItem,
  CoachModerationAction,
  CoachModerationOutcome,
} from '../../api/coachCommunityApi';
import VoiceNotePlayer from '../../components/community/VoiceNotePlayer';

/** Reviewer-facing noun for each reported content type. */
export const TARGET_NOUN: Record<CoachFlaggedItem['target_type'], string> = {
  post: 'post',
  message: 'message',
  voice_note: 'voice note',
  win: 'win',
};

/**
 * The 24-hour commitment, per report: "Review within 5h" while there is time,
 * "Past 24 hours, review now" once overdue. Empty when the server did not send
 * a respond-by time (older backend).
 */
export function reviewDueLabel(
  item: Pick<CoachFlaggedItem, 'respond_by' | 'overdue'>,
  nowMs: number = Date.now(),
): string {
  if (!item.respond_by) return '';
  const due = Date.parse(item.respond_by);
  if (Number.isNaN(due)) return '';
  if (item.overdue || due <= nowMs) return 'Past 24 hours, review now';
  const minutes = Math.max(1, Math.ceil((due - nowMs) / 60_000));
  if (minutes < 60) return `Review within ${minutes}m`;
  return `Review within ${Math.ceil(minutes / 60)}h`;
}

interface PendingDecision {
  item: CoachFlaggedItem;
  action: CoachModerationAction;
}

const DECISIONS: ReadonlyArray<{
  action: CoachModerationAction;
  label: string;
  destructive: boolean;
}> = [
  { action: 'dismiss', label: 'Dismiss', destructive: false },
  { action: 'warn', label: 'Warn', destructive: false },
  { action: 'hide', label: 'Hide', destructive: true },
  { action: 'ban', label: 'Ban', destructive: true },
];

/**
 * Confirmation copy after a decision, from what the backend actually did
 * (B-314-6). A stored notice is the member's record (they read it in
 * Community safety); a push is only ever attempted on top, so the copy never
 * says a warning was "sent" or "delivered".
 */
export function moderationDoneCopy(
  action: CoachModerationAction,
  outcome: CoachModerationOutcome | undefined,
): string {
  const stored = outcome?.memberNotice?.stored === true;
  switch (action) {
    case 'dismiss':
      return 'Report dismissed.';
    case 'hide':
      return stored
        ? 'Hidden. The member can read why in Community safety in the app.'
        : 'Hidden. The member was not given a notice, so tell them directly if they need to know why.';
    case 'warn':
      return stored
        ? 'Warning saved. The member reads it in Community safety in the app.'
        : 'The report is closed, but the warning was not saved for the member. Message them directly with the warning.';
    case 'ban':
      return stored
        ? 'Member removed. They can read why in Community safety in the app.'
        : 'Member removed. They were not given a notice, so tell them directly if they need to know why.';
  }
}

function confirmCopy(d: PendingDecision): {
  title: string;
  body: string;
  confirm: string;
} {
  const what = `this ${TARGET_NOUN[d.item.target_type]} from ${d.item.author_name}`;
  switch (d.action) {
    case 'hide':
      return {
        title: 'Hide this content',
        body: `Hide ${what}? It is removed from the room for everyone.`,
        confirm: 'Hide',
      };
    case 'warn':
      return {
        title: 'Warn this member',
        body: `Warn ${d.item.author_name} about ${what}? They keep their access, and the warning is saved for them to read in Community safety.`,
        confirm: 'Warn',
      };
    case 'ban':
      return {
        title: 'Ban this member',
        body: `Remove ${d.item.author_name} from this community space and hide ${what}? They lose access to every room and message in the space.`,
        confirm: 'Ban',
      };
    default:
      return {
        title: 'Dismiss this report',
        body: `Close the report on ${what} without taking action?`,
        confirm: 'Dismiss',
      };
  }
}
import type { CoachCommunityNav } from './coachCommunityNavTypes';
import { describeCommunityFailure } from '../../api/communityErrors';

export default function CoachCommunityModerationScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CoachCommunityNav>();
  const flagged = useCoachFlagged();
  const moderate = useModerateFlagged();
  const emptyState = useCoachEmptyStatePayload(
    'coach_community_moderation_empty',
  );
  const completion = useCompletionToast();

  const [pending, setPending] = useState<PendingDecision | null>(null);

  const items = flagged.data ?? [];
  // Stable (react-query): a failed voice player fetches fresh signed links.
  const refetchFlagged = flagged.refetch;
  const isEmpty = !flagged.isLoading && !flagged.isError && items.length === 0;
  // Described once per error (an unexpected one is reported to Sentry once).
  const queueFailure = useMemo(
    () => (flagged.isError ? describeCommunityFailure(flagged.error, 'load_queue') : null),
    [flagged.isError, flagged.error],
  );

  const onConfirm = useCallback(() => {
    if (!pending) return;
    const { action } = pending;
    moderate.mutate(pending, {
      onSuccess: (outcome) => completion.show(moderationDoneCopy(action, outcome)),
      // The hook rolls the optimistic removal back; say what happened.
      onError: (err: unknown) => {
        const failure = describeCommunityFailure(err, 'moderate');
        Alert.alert(failure.title, failure.message);
      },
      onSettled: () => setPending(null),
    });
  }, [pending, moderate, completion]);

  const onOpenPost = useCallback(
    (item: CoachFlaggedItem) => {
      if (item.target_type !== 'post') return;
      navigation.navigate('CoachCommunityPostDetail', {
        postId: item.target_id,
        flagged: true,
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: CoachFlaggedItem }) => {
      const isPost = item.target_type === 'post';
      const noun = TARGET_NOUN[item.target_type];
      const due = reviewDueLabel(item);
      const overdue = due.startsWith('Past');
      const voice = item.target_type === 'voice_note' && !item.removed ? item.media : null;
      return (
        <View
          style={[
            styles.card,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
            },
          ]}
          testID={`coach-community-flagged-row-${item.id}`}
        >
          <View style={styles.cardHeader}>
            <Text
              style={[styles.author, { color: semanticColors.textPrimary }]}
              numberOfLines={1}
            >
              {item.author_name}
            </Text>
            <Text style={[styles.age, { color: semanticColors.textMuted }]}>
              {relativeAge(item.created_at)}
            </Text>
          </View>
          <Text style={[styles.meta, { color: semanticColors.textMuted }]} numberOfLines={1}>
            {(item.cohort_name ? `${item.cohort_name} · ` : '') + `${noun} · ${item.reason}`}
          </Text>
          {due ? (
            <Text
              style={[
                styles.meta,
                {
                  color: overdue ? semantic.danger.fg : semanticColors.textMuted,
                },
              ]}
              testID={`coach-community-flagged-due-${item.id}`}
            >
              {due}
            </Text>
          ) : null}
          <HapticPressable
            intent="light"
            onPress={isPost ? () => onOpenPost(item) : undefined}
            disabled={!isPost}
            accessibilityRole={isPost ? 'button' : 'text'}
            accessibilityLabel={
              isPost
                ? `Open post from ${item.author_name}`
                : `Flagged ${noun} from ${item.author_name}`
            }
            accessibilityHint={isPost ? 'Opens the full post and thread' : undefined}
            testID={`coach-community-flagged-content-${item.id}`}
          >
            <Text style={[styles.content, { color: semanticColors.textPrimary }]}>
              {item.content}
            </Text>
            {isPost ? (
              <Text style={[styles.openHint, { color: semanticColors.accent }]}>
                View post
              </Text>
            ) : null}
          </HapticPressable>
          {voice ? (
            <View style={styles.player} testID={`coach-community-flagged-voice-${item.id}`}>
              <VoiceNotePlayer
                url={voice.url}
                durationMs={voice.duration_ms}
                onPlaybackError={() => void refetchFlagged()}
                testID={`coach-community-flagged-player-${item.id}`}
              />
              <Text style={[styles.meta, { color: semanticColors.textMuted }]}>
                {voice.url
                  ? 'Listen before you decide. If it stops playing, pull down to refresh the queue.'
                  : 'This recording cannot be played right now. Pull down to refresh the queue, then try again.'}
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            {DECISIONS.map((d) => (
              <HapticPressable
                key={d.action}
                intent={d.destructive ? 'warning' : 'light'}
                onPress={() => setPending({ item, action: d.action })}
                accessibilityRole="button"
                accessibilityLabel={`${d.label} ${
                  d.action === 'warn' || d.action === 'ban' ? item.author_name : `content from ${item.author_name}`
                }`}
                testID={`coach-community-flagged-${d.action}-${item.id}`}
                style={[
                  styles.hideAction,
                  d.destructive
                    ? { backgroundColor: semantic.danger.bg, borderColor: semantic.danger.border }
                    : { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
                ]}
              >
                <Text
                  style={[
                    styles.hideLabel,
                    { color: d.destructive ? semantic.danger.fg : semanticColors.textPrimary },
                  ]}
                >
                  {d.label}
                </Text>
              </HapticPressable>
            ))}
          </View>
        </View>
      );
    },
    [semanticColors, onOpenPost, refetchFlagged],
  );

  if (flagged.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-moderation-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-moderation-loading"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      testID="coach-community-moderation-screen"
    >
      {flagged.isError ? (
        <CoachErrorState
          message={queueFailure?.message ?? ''}
          onRetry={() => flagged.refetch()}
          retrying={flagged.isRefetching}
          testID="coach-community-moderation-error"
        />
      ) : isEmpty ? (
        <CoachRomanEmptyState
          result={emptyState}
          testID="coach-community-moderation-empty"
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={flagged.isRefetching}
              onRefresh={() => flagged.refetch()}
              tintColor={semanticColors.accent}
            />
          }
        />
      )}

      {/* Decision confirmation (hard gate, no one-tap moderation). The testID
          keeps the historical `hide-confirm` name the suites target. */}
      <ConfirmModal
        visible={pending != null}
        title={pending ? confirmCopy(pending).title : ''}
        body={pending ? confirmCopy(pending).body : undefined}
        confirmLabel={pending ? confirmCopy(pending).confirm : 'Confirm'}
        variant={pending && (pending.action === 'hide' || pending.action === 'ban') ? 'destructive' : 'constructive'}
        busy={moderate.isPending}
        onConfirm={onConfirm}
        onCancel={() => setPending(null)}
        testID="coach-community-moderation-hide-confirm"
      />

      <CompletionToast state={completion.toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  author: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  age: {
    fontSize: 12,
  },
  meta: {
    fontSize: 12,
  },
  content: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  player: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  openHint: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  hideAction: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hideLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
