/**
 * CoachCommunityInboxScreen — aggregated unanswered items across the coach's
 * cohorts (v1-6). Consumes `GET /community/coach/inbox` (paged) and
 * `POST /community/coach/inbox/:id/ack`.
 *
 * Each row shows the client avatar (with a monogram badge fallback), a snippet,
 * a relative age, and an acknowledge button. Acks are optimistic with rollback
 * (see useAckInboxItem).
 *
 * Batch acknowledge (UX P1.3 — dual affordance):
 *   - A visible "Select" toggle in the header enters multi-select mode; rows
 *     show a checkbox and a footer "Mark N as read" button appears. This is the
 *     discoverable, sighted-user path.
 *   - A long-press on a row still marks every visible item in that client's
 *     cohort thread as read — retained as a power-user shortcut.
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a calm/empty masquerade); and — on a
 * genuinely empty inbox — the operator-locked Roman-voiced empty state whose
 * copy + crop come from the backend voice policy (face + voice contract).
 * Touch targets are >= 44pt.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  CoachRomanEmptyState,
  CoachErrorState,
  MonogramBadge,
  relativeAge,
} from '../../components/community/coach';
import CoachAckBadge from '../../components/community/CoachAckBadge';
import {
  useCoachInbox,
  useAckInboxItem,
  useCoachAckState,
  useCoachEmptyStatePayload,
  coachCommunityKeys,
} from '../../hooks/useCoachCommunity';
import { useCoachAckActions } from '../../hooks/useCoachAckActions';
import { featureFlags } from '../../config/featureFlags';
import { useQueryClient } from '@tanstack/react-query';
import { AckStateSchema } from '../../api/coachCommunityApi';
import type {
  CoachInboxItem,
  AckStateDto,
} from '../../api/coachCommunityApi';

// v2-2 kill switch: when OFF the inbox renders exactly as the v1-6 surface
// (no ack badge, no "Mark acked" quick-action). Read once at module scope —
// the flag is build-time and never flips mid-session.
const ACKS_ENABLED = featureFlags.communityAcks;

export default function CoachCommunityInboxScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const inbox = useCoachInbox();
  const ack = useAckInboxItem();
  const emptyState = useCoachEmptyStatePayload('coach_community_inbox_empty');
  const qc = useQueryClient();

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Memoise the row list so its identity is stable across renders — otherwise
  // the `?? []` fallback allocates a fresh array each render and churns the
  // useCallback deps below (and the FlatList data prop).
  const items = useMemo(() => inbox.data?.items ?? [], [inbox.data?.items]);

  // v2-2: seed the per-message ack cache from any ack envelope the backend
  // attached to an inbox row (additive `ack` field, present only when
  // FEATURE_COMMUNITY_ACKS is on server-side). The inbox payload is the source
  // of truth; this only PRIMES the cache so the badge has a value before any
  // optimistic action. Validated at the boundary so a drifted shape is dropped
  // rather than fed into the badge. No-op when the flag is off or no ack is
  // present. We never overwrite a value already in the cache (an in-flight
  // optimistic state must win until it reconciles).
  useEffect(() => {
    if (!ACKS_ENABLED) return;
    for (const item of items) {
      const raw = (item as { ack?: unknown }).ack;
      if (raw == null) continue;
      const key = coachCommunityKeys.ackState(item.id);
      if (qc.getQueryData<AckStateDto>(key) != null) continue;
      const parsed = AckStateSchema.safeParse(raw);
      if (parsed.success) {
        qc.setQueryData<AckStateDto>(key, parsed.data);
      }
    }
  }, [items, qc]);
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

  const toggleSelectMode = useCallback(() => {
    setSelecting((prev) => {
      if (prev) setSelected(new Set());
      return !prev;
    });
  }, []);

  const toggleRowSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onMarkSelectedRead = useCallback(() => {
    selected.forEach((id) => ack.mutate(id));
    setSelected(new Set());
    setSelecting(false);
  }, [selected, ack]);

  const renderItem = useCallback(
    ({ item }: { item: CoachInboxItem }) => (
      <InboxRow
        item={item}
        selecting={selecting}
        checked={selected.has(item.id)}
        surface={semanticColors.bgSurface}
        border={semanticColors.border}
        titleColor={semanticColors.textPrimary}
        metaColor={semanticColors.textMuted}
        accent={semanticColors.accent}
        onAccent={semanticColors.textOnAccent}
        onAck={onAck}
        onMarkThreadRead={onMarkThreadRead}
        onToggleSelected={toggleRowSelected}
      />
    ),
    [
      semanticColors,
      selecting,
      selected,
      onAck,
      onMarkThreadRead,
      toggleRowSelected,
    ],
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

  if (inbox.isError) {
    return (
      <View
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-inbox-screen"
      >
        <CoachErrorState
          message="Could not load your inbox. Pull to retry."
          onRetry={() => inbox.refetch()}
          retrying={inbox.isRefetching}
          testID="coach-community-inbox-error"
        />
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View
        style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-inbox-screen"
      >
        <CoachRomanEmptyState
          result={emptyState}
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
      <View style={[styles.toolbar, { borderBottomColor: semanticColors.border }]}>
        <HapticPressable
          intent="light"
          onPress={toggleSelectMode}
          accessibilityRole="button"
          accessibilityLabel={
            selecting ? 'Cancel selection' : 'Select items to mark as read'
          }
          accessibilityState={{ selected: selecting }}
          testID="coach-community-inbox-select-toggle"
          style={styles.toolbarButton}
        >
          <Text style={[styles.toolbarLabel, { color: semanticColors.accent }]}>
            {selecting ? 'Cancel' : 'Select'}
          </Text>
        </HapticPressable>
      </View>

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

      {selecting ? (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: semanticColors.bgSurface,
              borderTopColor: semanticColors.border,
            },
          ]}
        >
          <HapticPressable
            intent="success"
            onPress={onMarkSelectedRead}
            disabled={selected.size === 0}
            accessibilityRole="button"
            accessibilityLabel={`Mark ${selected.size} as read`}
            accessibilityState={{ disabled: selected.size === 0 }}
            testID="coach-community-inbox-mark-selected"
            style={[
              styles.footerButton,
              {
                backgroundColor:
                  selected.size === 0
                    ? semanticColors.disabledBg
                    : semanticColors.accent,
              },
            ]}
          >
            <Text
              style={[
                styles.footerLabel,
                {
                  color:
                    selected.size === 0
                      ? semanticColors.textOnDisabled
                      : semanticColors.textOnAccent,
                },
              ]}
            >
              {`Mark ${selected.size} as read`}
            </Text>
          </HapticPressable>
        </View>
      ) : null}
    </View>
  );
}

function InboxRow({
  item,
  selecting,
  checked,
  surface,
  border,
  titleColor,
  metaColor,
  accent,
  onAccent,
  onAck,
  onMarkThreadRead,
  onToggleSelected,
}: {
  item: CoachInboxItem;
  selecting: boolean;
  checked: boolean;
  surface: string;
  border: string;
  titleColor: string;
  metaColor: string;
  accent: string;
  onAccent: string;
  onAck: (id: string) => void;
  onMarkThreadRead: (item: CoachInboxItem) => void;
  onToggleSelected: (id: string) => void;
}): React.ReactElement {
  return (
    <HapticPressable
      intent="light"
      onPress={selecting ? () => onToggleSelected(item.id) : undefined}
      onLongPress={selecting ? undefined : () => onMarkThreadRead(item)}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityLabel={`${item.client_name} in ${item.cohort_name}: ${item.snippet}`}
      accessibilityHint={
        selecting
          ? 'Tap to select this item'
          : 'Long press to mark this cohort thread as read'
      }
      accessibilityState={selecting ? { checked } : undefined}
      testID={`coach-community-inbox-row-${item.id}`}
      style={[styles.row, { backgroundColor: surface, borderColor: border }]}
    >
      {selecting ? (
        <View
          testID={`coach-community-inbox-check-${item.id}`}
          style={[
            styles.checkbox,
            {
              borderColor: accent,
              backgroundColor: checked ? accent : 'transparent',
            },
          ]}
        >
          {checked ? (
            <Text style={[styles.checkmark, { color: onAccent }]}>✓</Text>
          ) : null}
        </View>
      ) : null}
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
        {ACKS_ENABLED && !selecting ? (
          <CoachAckRow item={item} />
        ) : null}
      </View>
      {selecting ? null : (
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
      )}
    </HapticPressable>
  );
}

/**
 * v2-2 ack signals for a single inbox row: the CoachAckBadge (current state +
 * SLA chip, read from the per-message ack cache) and a "Mark acked"
 * quick-action that fires the optimistic `markAcked` mutation. Rendered only
 * when EXPO_PUBLIC_FF_COMMUNITY_ACKS is on (the parent gates this with
 * ACKS_ENABLED), so the v1-6 inbox is untouched when the flag is off.
 *
 * Extracted into its own component because it owns hooks (`useCoachAckState`,
 * `useCoachAckActions`) that must not be conditionally called inside the parent
 * row's render — here they live behind the flag gate at the row level, which is
 * stable for the lifetime of the build.
 */
function CoachAckRow({
  item,
}: {
  item: CoachInboxItem;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  const ackState = useCoachAckState(item.id);
  const actions = useCoachAckActions(item.id);
  const pending = actions.markAcked.isPending;
  const alreadyAcked =
    ackState?.state === 'acked' || ackState?.state === 'replied';

  return (
    <View style={styles.ackRow}>
      <CoachAckBadge
        ack={ackState}
        testID={`coach-community-inbox-ack-badge-${item.id}`}
      />
      <HapticPressable
        intent="light"
        onPress={() => actions.markAcked.mutate()}
        disabled={pending || alreadyAcked}
        accessibilityRole="button"
        accessibilityLabel={`Mark message from ${item.client_name} as acked`}
        accessibilityState={{ disabled: pending || alreadyAcked }}
        testID={`coach-community-inbox-mark-acked-${item.id}`}
        style={[
          styles.markAckedButton,
          {
            borderColor: semanticColors.accent,
            opacity: pending || alreadyAcked ? 0.5 : 1,
          },
        ]}
      >
        <Text
          style={[styles.markAckedLabel, { color: semanticColors.accent }]}
        >
          Mark acked
        </Text>
      </HapticPressable>
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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarButton: {
    minHeight: 44,
    minWidth: 64,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
  },
  toolbarLabel: {
    fontSize: 15,
    fontWeight: '600',
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
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '600',
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
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  markAckedButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  markAckedLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButton: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  footerLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
