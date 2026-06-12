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
import CoachAckBadge, {
  resolveAckBadgeVisibility,
} from '../../components/community/CoachAckBadge';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import {
  useCoachInbox,
  useAckInboxItem,
  useCoachAckState,
  useCoachEmptyStatePayload,
  coachCommunityKeys,
} from '../../hooks/useCoachCommunity';
import {
  useCoachAckActions,
  isIllegalAckTransition,
} from '../../hooks/useCoachAckActions';
import { featureFlags } from '../../config/featureFlags';
import AiTriageCard from '../../components/community/AiTriageCard';
import { useInboxTriage } from '../../hooks/useInboxTriage';
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

// v2-4 kill switch: when OFF the inbox renders with NO triage card and never
// fetches /community/ai-triage. Read once at module scope — the flag is
// build-time and never flips mid-session, so the number/order of hooks is
// stable for the lifetime of the build (the triage hook lives behind this gate
// at the component level, never conditionally inside a render).
const TRIAGE_ENABLED = featureFlags.communityAiTriage;

/**
 * AI triage summary banner, pinned above the inbox list. Owns the
 * `useInboxTriage` read so the hook is gated behind TRIAGE_ENABLED at the
 * component boundary (the parent only mounts this when the flag is on). The
 * card is a READ surface — it never sends or replies. A 404 (server flag off),
 * any HTTP failure, or a Zod drift surfaces as the card's calm, typed error
 * state; the human inbox below is always unaffected.
 */
function InboxTriageBanner(): React.ReactElement {
  const triage = useInboxTriage();
  // Typed state machine: loading | error | empty | ready. `empty` is derived
  // explicitly here from the server's `is_empty` flag so the card never has to
  // infer "nothing to triage" from a populated `ready` payload (the card keeps
  // an all-zero guard only as defensive validation).
  const status = triage.isLoading
    ? 'loading'
    : triage.isError
      ? 'error'
      : triage.data?.is_empty === true
        ? 'empty'
        : 'ready';
  return (
    <AiTriageCard
      status={status}
      triage={triage.data}
      onRetry={() => triage.refetch()}
      retrying={triage.isRefetching}
      testID="coach-community-inbox-ai-triage"
    />
  );
}

/**
 * Build the inbox row's accessibility label. When the ack flag is on we append
 * the ack/SLA state to the base triage summary, `Overdue` FIRST after the
 * client name so a screen-reader coach hears the urgent status before the
 * routine snippet (UX F4). The visibility rules mirror `CoachAckBadge` exactly
 * (single source of truth via `resolveAckBadgeVisibility`), so the label never
 * announces a default/untouched (`none` + `within`) signal the badge hides.
 */
function buildRowAccessibilityLabel(
  item: CoachInboxItem,
  ack: AckStateDto | undefined,
): string {
  const base = `${item.client_name} in ${item.cohort_name}: ${item.snippet}`;
  if (!ACKS_ENABLED || ack == null) return base;
  const { showStatePill, slaState, breached } = resolveAckBadgeVisibility(ack);
  const SLA_PHRASE: Record<'warning' | 'breached', string> = {
    warning: 'Due soon',
    breached: 'Overdue',
  };
  const STATE_PHRASE: Record<string, string> = {
    seen: 'Seen',
    acked: 'Acknowledged',
    replied: 'Replied',
  };
  const slaPhrase =
    slaState === 'warning' || slaState === 'breached'
      ? SLA_PHRASE[slaState]
      : null;
  const statePhrase = showStatePill ? STATE_PHRASE[ack.state] ?? null : null;

  // Overdue-first: when breached, the SLA phrase leads the whole label (right
  // after the client name); otherwise the ack/SLA phrases trail the snippet.
  if (breached && slaPhrase != null) {
    const trailing = statePhrase != null ? ` ${statePhrase}.` : '';
    return `${item.client_name}. ${slaPhrase}. ${base}.${trailing}`;
  }
  const parts = [slaPhrase, statePhrase].filter((p): p is string => p != null);
  return parts.length > 0
    ? `${base}. ${parts.map((p) => `${p}.`).join(' ')}`
    : base;
}

export default function CoachCommunityInboxScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const inbox = useCoachInbox();
  const ack = useAckInboxItem();
  const emptyState = useCoachEmptyStatePayload('coach_community_inbox_empty');
  const qc = useQueryClient();

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // UX F6: a subtle, proportionate closure moment on a successful acknowledge,
  // reusing the established CompletionToast pattern (no new infrastructure).
  const { toast, show: showToast } = useCompletionToast();
  const onAcknowledged = useCallback(() => {
    showToast('Acknowledged.');
  }, [showToast]);

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
        onAcknowledged={onAcknowledged}
      />
    ),
    [
      semanticColors,
      selecting,
      selected,
      onAck,
      onMarkThreadRead,
      toggleRowSelected,
      onAcknowledged,
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
        {TRIAGE_ENABLED ? (
          <View style={styles.triageHeader}>
            <InboxTriageBanner />
          </View>
        ) : null}
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
        ListHeaderComponent={TRIAGE_ENABLED ? <InboxTriageBanner /> : null}
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

      {ACKS_ENABLED ? (
        <CompletionToast
          state={toast}
          testID="coach-community-inbox-completion-toast"
        />
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
  onAcknowledged,
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
  onAcknowledged: () => void;
}): React.ReactElement {
  // ACKS_ENABLED is a build-time constant, so the number/order of hooks is
  // stable for the entire lifetime of a build — a hook guarded by it never
  // changes its called/not-called status at runtime, which keeps the
  // flag-off path (and its invariance test) from touching any ack hook. When
  // the flag is on we read the per-message ack cache here so the row's
  // accessibility label can fold in the ack/SLA routine (UX F4). When off,
  // the label short-circuits to the base.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ackState = ACKS_ENABLED ? useCoachAckState(item.id) : undefined;
  return (
    <HapticPressable
      intent="light"
      onPress={selecting ? () => onToggleSelected(item.id) : undefined}
      onLongPress={selecting ? undefined : () => onMarkThreadRead(item)}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityLabel={buildRowAccessibilityLabel(item, ackState)}
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
          <CoachAckRow
            item={item}
            ackState={ackState}
            onAcknowledged={onAcknowledged}
          />
        ) : null}
      </View>
      {/*
        UX F1 — ONE visible ack action per row. The legacy `Ack` button POSTs
        `/community/coach/inbox/:id/ack`, which DISMISSES the row. The v2-2
        `Acknowledge` action (in CoachAckRow) stamps the ack signal without
        removing the row — genuinely different verbs. When the v2-2 flag is ON
        we keep a single visible primary (Acknowledge) and demote dismissal to
        the existing long-press (which already marks the cohort thread read).
        When the flag is OFF the row is unchanged from v1-6.
      */}
      {!ACKS_ENABLED && !selecting ? (
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
      ) : null}
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
  ackState,
  onAcknowledged,
}: {
  item: CoachInboxItem;
  ackState: AckStateDto | undefined;
  onAcknowledged: () => void;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  const actions = useCoachAckActions(item.id);
  const pending = actions.markAcked.isPending;
  const alreadyAcked =
    ackState?.state === 'acked' || ackState?.state === 'replied';

  // UX F4: the badge is folded into the row's accessibility label, so hide it
  // from the a11y tree here (`labelledByRow`) to avoid a duplicate, decoupled
  // announcement.
  // Code F3 / UX: surface a 409 illegal_transition as an inline, accessible
  // status line. The mutation has already invalidated + refetched the ack
  // state (see useCoachAckActions.onError), so this is a calm "we caught up"
  // message rather than an actionable error.
  const conflict = isIllegalAckTransition(actions.markAcked.error);

  return (
    <View style={styles.ackRow}>
      <CoachAckBadge
        ack={ackState}
        labelledByRow
        testID={`coach-community-inbox-ack-badge-${item.id}`}
      />
      <HapticPressable
        intent="light"
        onPress={() =>
          actions.markAcked.mutate(undefined, { onSuccess: onAcknowledged })
        }
        disabled={pending || alreadyAcked}
        accessibilityRole="button"
        accessibilityLabel={`Acknowledge message from ${item.client_name}`}
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
          {alreadyAcked ? 'Acknowledged' : 'Acknowledge'}
        </Text>
      </HapticPressable>
      {conflict ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.ackConflict, { color: semanticColors.textMuted }]}
          testID={`coach-community-inbox-ack-conflict-${item.id}`}
        >
          Message state changed — refreshed
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  triageHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
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
  ackConflict: {
    flexBasis: '100%',
    fontSize: 12,
    lineHeight: 16,
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
