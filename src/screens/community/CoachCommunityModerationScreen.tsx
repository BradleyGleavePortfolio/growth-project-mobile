/**
 * CoachCommunityModerationScreen — the flagged-content review queue (v1-6).
 * Consumes the existing moderation endpoints: `GET /community/moderation/flagged`
 * (read), `POST /community/posts/:id/hide`, and
 * `POST /community/messages/:id/hide` (decision).
 *
 * Each row shows the offending content verbatim, the author, the cohort, a
 * coarse reason label, and the single real decision: HIDE. The destructive Hide
 * path routes through a confirmation modal (hard gate §2.3 — no one-tap hide)
 * and is optimistic with rollback (see useHideFlagged).
 *
 * APPROVE REMOVED (fixer R1 / G10.2 Option A): the v1-6 backend exposes no
 * durable approve/clear endpoint, so an "Approve" action could only ever be a
 * client-side dismissal masquerading as a backend decision (a silent no-op).
 * Per the decacorn rule the action was removed; it can return when a real
 * approve endpoint ships.
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
  CoachEmptyState,
  CoachErrorState,
  ConfirmModal,
  relativeAge,
} from '../../components/community/coach';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import {
  useCoachFlagged,
  useHideFlagged,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import type { CoachFlaggedItem } from '../../api/coachCommunityApi';
import type { CoachCommunityNav } from './coachCommunityNavTypes';

export default function CoachCommunityModerationScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CoachCommunityNav>();
  const flagged = useCoachFlagged();
  const hide = useHideFlagged();
  const emptyPayload = useCoachEmptyStatePayload(
    'coach_community_moderation_empty',
  );
  const completion = useCompletionToast();

  const [pendingHide, setPendingHide] = useState<CoachFlaggedItem | null>(null);

  const items = flagged.data ?? [];
  const isEmpty = !flagged.isLoading && !flagged.isError && items.length === 0;

  const onConfirmHide = useCallback(() => {
    if (!pendingHide) return;
    hide.mutate(pendingHide, {
      onSuccess: () => completion.show('Hidden.'),
      onSettled: () => setPendingHide(null),
    });
  }, [pendingHide, hide, completion]);

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
            <HapticPressable
              intent="warning"
              onPress={() => setPendingHide(item)}
              accessibilityRole="button"
              accessibilityLabel={`Hide content from ${item.author_name}`}
              testID={`coach-community-flagged-hide-${item.id}`}
              style={[
                styles.hideAction,
                {
                  backgroundColor: semantic.danger.bg,
                  borderColor: semantic.danger.border,
                },
              ]}
            >
              <Text style={[styles.hideLabel, { color: semantic.danger.fg }]}>
                Hide
              </Text>
            </HapticPressable>
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
        <CoachEmptyState
          payload={emptyPayload}
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

      {/* Hide confirmation (destructive — hard gate, no one-tap hide). */}
      <ConfirmModal
        visible={pendingHide != null}
        title="Hide this content"
        body={
          pendingHide
            ? `Hide this ${pendingHide.target_type} from ${pendingHide.author_name}? It is removed from the room for everyone.`
            : undefined
        }
        confirmLabel="Hide"
        busy={hide.isPending}
        onConfirm={onConfirmHide}
        onCancel={() => setPendingHide(null)}
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
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  hideAction: {
    minHeight: 44,
    minWidth: 96,
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
