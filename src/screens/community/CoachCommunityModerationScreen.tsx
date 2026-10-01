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
 * deciding.
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a celebratory "all clear" masquerade); and
 * — when the queue is genuinely clear — the operator-locked Roman-voiced empty
 * state with the SMILE crop, copy + crop sourced from the backend voice policy
 * (face + voice contract). A CompletionToast confirms a successful Hide (G11).
 * Touch targets are >= 44pt.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
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
import type { CoachFlaggedItem, CoachModerationAction } from '../../api/coachCommunityApi';

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

const DONE_COPY: Record<CoachModerationAction, string> = {
  hide: 'Hidden.',
  warn: 'Warning sent.',
  ban: 'Member removed.',
  dismiss: 'Report dismissed.',
};

function confirmCopy(d: PendingDecision): { title: string; body: string; confirm: string } {
  const what = `this ${d.item.target_type} from ${d.item.author_name}`;
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
        body: `Send ${d.item.author_name} a warning about ${what}? They keep their access.`,
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
  const isEmpty = !flagged.isLoading && !flagged.isError && items.length === 0;

  const onConfirm = useCallback(() => {
    if (!pending) return;
    const { action } = pending;
    moderate.mutate(pending, {
      onSuccess: () => completion.show(DONE_COPY[action]),
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
          <Text
            style={[styles.meta, { color: semanticColors.textMuted }]}
            numberOfLines={1}
          >
            {(item.cohort_name ? `${item.cohort_name} · ` : '') +
              `${item.target_type} · ${item.reason}`}
          </Text>
          <HapticPressable
            intent="light"
            onPress={isPost ? () => onOpenPost(item) : undefined}
            disabled={!isPost}
            accessibilityRole={isPost ? 'button' : 'text'}
            accessibilityLabel={
              isPost
                ? `Open post from ${item.author_name}`
                : `Flagged ${item.target_type} from ${item.author_name}`
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
    [semanticColors, onOpenPost],
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
          message="Could not load the review queue. Pull to retry."
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
