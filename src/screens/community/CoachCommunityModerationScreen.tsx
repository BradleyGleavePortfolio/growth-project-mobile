/**
 * CoachCommunityModerationScreen — the flagged-content review queue (v1-6).
 * Consumes the existing moderation endpoints: `GET /community/moderation/flagged`
 * (read), `POST /community/posts/:id/hide`, and
 * `POST /community/messages/:id/hide` (decisions).
 *
 * Each row shows the offending content verbatim, the author, the cohort, a
 * coarse reason label, and two decisions: "hide" (destructive) and "approve"
 * (clears the item from the queue without hiding). Both destructive paths route
 * through a confirmation modal (hard gate §2.3 — no one-tap hide). Hides are
 * optimistic with rollback (see useHideFlagged).
 *
 * The empty state is CELEBRATORY: when the queue is clear (or after the coach
 * clears it) the screen renders the operator-locked Roman-voiced empty state
 * with the SMILE crop ("Nothing flagged. The room is running itself."). No bare
 * spinner. Touch targets are >= 44pt.
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
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import {
  CoachEmptyState,
  COACH_EMPTY_COPY,
  ConfirmModal,
  relativeAge,
} from '../../components/community/coach';
import {
  useCoachFlagged,
  useHideFlagged,
  useApproveFlagged,
} from '../../hooks/useCoachCommunity';
import type { CoachFlaggedItem } from '../../api/coachCommunityApi';

export default function CoachCommunityModerationScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const flagged = useCoachFlagged();
  const hide = useHideFlagged();
  const approve = useApproveFlagged();

  const [pendingHide, setPendingHide] = useState<CoachFlaggedItem | null>(null);
  const [pendingApprove, setPendingApprove] =
    useState<CoachFlaggedItem | null>(null);

  const items = flagged.data ?? [];
  const isEmpty = !flagged.isLoading && !flagged.isError && items.length === 0;

  const onConfirmHide = useCallback(() => {
    if (!pendingHide) return;
    hide.mutate(pendingHide, { onSettled: () => setPendingHide(null) });
  }, [pendingHide, hide]);

  const onConfirmApprove = useCallback(() => {
    if (!pendingApprove) return;
    approve.mutate(pendingApprove, {
      onSettled: () => setPendingApprove(null),
    });
  }, [pendingApprove, approve]);

  const renderItem = useCallback(
    ({ item }: { item: CoachFlaggedItem }) => (
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
          {(item.cohort_name ? `${item.cohort_name} · ` : '') +
            `${item.target_type} · ${item.reason}`}
        </Text>
        <Text style={[styles.content, { color: semanticColors.textPrimary }]}>
          {item.content}
        </Text>
        <View style={styles.actions}>
          <HapticPressable
            intent="light"
            onPress={() => setPendingApprove(item)}
            accessibilityRole="button"
            accessibilityLabel={`Approve content from ${item.author_name}`}
            testID={`coach-community-flagged-approve-${item.id}`}
            style={[styles.action, { borderColor: semanticColors.border }]}
          >
            <Text style={[styles.approveLabel, { color: semanticColors.textPrimary }]}>
              Approve
            </Text>
          </HapticPressable>
          <HapticPressable
            intent="warning"
            onPress={() => setPendingHide(item)}
            accessibilityRole="button"
            accessibilityLabel={`Hide content from ${item.author_name}`}
            testID={`coach-community-flagged-hide-${item.id}`}
            style={[styles.action, { backgroundColor: semanticColors.accent }]}
          >
            <Text style={[styles.hideLabel, { color: semanticColors.textOnAccent }]}>
              Hide
            </Text>
          </HapticPressable>
        </View>
      </View>
    ),
    [semanticColors],
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
      {isEmpty || flagged.isError ? (
        <CoachEmptyState
          crop={COACH_EMPTY_COPY.moderation.crop}
          copy={COACH_EMPTY_COPY.moderation.copy}
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

      {/* Approve confirmation — clears the item from the queue. */}
      <ConfirmModal
        visible={pendingApprove != null}
        title="Approve this content"
        body={
          pendingApprove
            ? `Keep this ${pendingApprove.target_type} from ${pendingApprove.author_name} and clear it from the queue.`
            : undefined
        }
        confirmLabel="Approve"
        busy={approve.isPending}
        onConfirm={onConfirmApprove}
        onCancel={() => setPendingApprove(null)}
        testID="coach-community-moderation-approve-confirm"
      />
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  action: {
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  approveLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  hideLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
