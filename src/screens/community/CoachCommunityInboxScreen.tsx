/**
 * CoachCommunityInboxScreen — aggregated unanswered items across the coach's
 * cohorts (v1-6). Consumes `GET /community/coach/inbox` (paged) and
 * `POST /community/coach/inbox/:id/ack`.
 *
 * Each row shows the client avatar (with a monogram badge fallback), a snippet,
 * a relative age, and an acknowledge button. A long-press on a row marks every
 * item in that client's cohort thread as read (a batch ack of the visible
 * sibling items). Acks are optimistic with rollback (see useAckInboxItem).
 *
 * Empty + error states render the operator-locked Roman-voiced empty state
 * (neutral crop) — never a bare spinner. Touch targets are >= 44pt.
 */
import React, { useCallback, useMemo } from 'react';
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
  MonogramBadge,
  relativeAge,
} from '../../components/community/coach';
import {
  useCoachInbox,
  useAckInboxItem,
} from '../../hooks/useCoachCommunity';
import type { CoachInboxItem } from '../../api/coachCommunityApi';

export default function CoachCommunityInboxScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const inbox = useCoachInbox();
  const ack = useAckInboxItem();

  // Memoise the row list so its identity is stable across renders — otherwise
  // the `?? []` fallback allocates a fresh array each render and churns the
  // useCallback deps below (and the FlatList data prop).
  const items = useMemo(() => inbox.data?.items ?? [], [inbox.data?.items]);
  const isEmpty = !inbox.isLoading && !inbox.isError && items.length === 0;

  const onAck = useCallback(
    (id: string) => {
      ack.mutate(id);
    },
    [ack],
  );

  // Long-press: mark all visible items in the same cohort thread as read.
  const onMarkThreadRead = useCallback(
    (item: CoachInboxItem) => {
      items
        .filter((i) => i.cohort_id === item.cohort_id)
        .forEach((i) => ack.mutate(i.id));
    },
    [items, ack],
  );

  const renderItem = useCallback(
    ({ item }: { item: CoachInboxItem }) => (
      <InboxRow
        item={item}
        surface={semanticColors.bgSurface}
        border={semanticColors.border}
        titleColor={semanticColors.textPrimary}
        metaColor={semanticColors.textMuted}
        accent={semanticColors.accent}
        onAccent={semanticColors.textOnAccent}
        onAck={onAck}
        onMarkThreadRead={onMarkThreadRead}
      />
    ),
    [semanticColors, onAck, onMarkThreadRead],
  );

  if (inbox.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-inbox-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-inbox-loading"
        />
      </View>
    );
  }

  if (isEmpty || inbox.isError) {
    return (
      <View
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-inbox-screen"
      >
        <CoachEmptyState
          crop={COACH_EMPTY_COPY.inbox.crop}
          copy={COACH_EMPTY_COPY.inbox.copy}
          testID="coach-community-inbox-empty"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      testID="coach-community-inbox-screen"
    >
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching}
            onRefresh={() => inbox.refetch()}
            tintColor={semanticColors.accent}
          />
        }
      />
    </View>
  );
}

function InboxRow({
  item,
  surface,
  border,
  titleColor,
  metaColor,
  accent,
  onAccent,
  onAck,
  onMarkThreadRead,
}: {
  item: CoachInboxItem;
  surface: string;
  border: string;
  titleColor: string;
  metaColor: string;
  accent: string;
  onAccent: string;
  onAck: (id: string) => void;
  onMarkThreadRead: (item: CoachInboxItem) => void;
}): React.ReactElement {
  return (
    <HapticPressable
      intent="light"
      onLongPress={() => onMarkThreadRead(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.client_name} in ${item.cohort_name}: ${item.snippet}`}
      accessibilityHint="Long press to mark this cohort thread as read"
      testID={`coach-community-inbox-row-${item.id}`}
      style={[styles.row, { backgroundColor: surface, borderColor: border }]}
    >
      <MonogramBadge
        name={item.client_name}
        avatarUrl={item.avatar_url}
        size={40}
        testID={`coach-community-inbox-avatar-${item.id}`}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text
            style={[styles.rowName, { color: titleColor }]}
            numberOfLines={1}
          >
            {item.client_name}
          </Text>
          <Text style={[styles.rowAge, { color: metaColor }]}>
            {relativeAge(item.created_at)}
          </Text>
        </View>
        <Text
          style={[styles.rowCohort, { color: metaColor }]}
          numberOfLines={1}
        >
          {item.cohort_name}
        </Text>
        <Text
          style={[styles.rowSnippet, { color: titleColor }]}
          numberOfLines={2}
        >
          {item.snippet}
        </Text>
      </View>
      <HapticPressable
        intent="success"
        onPress={() => onAck(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Acknowledge message from ${item.client_name}`}
        testID={`coach-community-inbox-ack-${item.id}`}
        style={[styles.ackButton, { backgroundColor: accent }]}
      >
        <Text style={[styles.ackLabel, { color: onAccent }]}>Ack</Text>
      </HapticPressable>
    </HapticPressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  rowAge: {
    fontSize: 12,
  },
  rowCohort: {
    fontSize: 12,
  },
  rowSnippet: {
    fontSize: 14,
    lineHeight: 19,
  },
  ackButton: {
    minHeight: 44,
    minWidth: 56,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  ackLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
