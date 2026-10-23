/**
 * CoachCommunityInboxScreen — aggregated unanswered items across the coach's
 * cohorts (v1-6). Consumes `GET /community/me/coach-inbox`.
 *
 * Each row shows the client avatar (with a monogram badge fallback), a snippet
 * and a relative age. The server has no route to dismiss a row: an item leaves
 * the inbox when the coach replies in that space (the server stamps
 * `coach_replied_at`, and the inbox lists only unanswered items).
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a calm/empty masquerade); and — on a
 * genuinely empty inbox — the operator-locked Roman-voiced empty state whose
 * copy + crop come from the backend voice policy (face + voice contract).
 * Touch targets are >= 44pt.
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
  useCoachAckState,
  useCoachEmptyStatePayload,
  coachCommunityKeys,
} from '../../hooks/useCoachCommunity';
import {
  useCoachAckActions,
  isIllegalAckTransition,
} from '../../hooks/useCoachAckActions';
import { featureFlags } from '../../config/featureFlags';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { formatDuration } from '../../components/community/voiceFormat';
import type { CoachCommunityNav } from './coachCommunityNavTypes';
import AiTriageCard from '../../components/community/AiTriageCard';
import { useInboxTriage } from '../../hooks/useInboxTriage';
import { aiRefusalOf } from '../../lib/ai/aiRefusal';
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
      refusal={triage.isError ? aiRefusalOf(triage.error) : null}
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
  const emptyState = useCoachEmptyStatePayload('coach_community_inbox_empty');

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

  const isEmpty = !inbox.isLoading && !inbox.isError && items.length === 0;

  const renderItem = useCallback(
    ({ item }: { item: CoachInboxItem }) => (
      <InboxRowOrVoice
        item={item}
        surface={semanticColors.bgSurface}
        border={semanticColors.border}
        titleColor={semanticColors.textPrimary}
        metaColor={semanticColors.textMuted}
        onAcknowledged={onAcknowledged}
      />
    ),
    [semanticColors, onAcknowledged],
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
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListHeaderComponent={TRIAGE_ENABLED ? <InboxTriageBanner /> : null}
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
          if (inbox.hasNextPage && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID="coach-community-inbox-list"
        ListFooterComponent={
          inbox.isFetchingNextPage ? (
            <ActivityIndicator
              color={semanticColors.accent}
              style={styles.pageSpinner}
              testID="coach-community-inbox-next-page"
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
            onRefresh={() => inbox.refetch()}
            tintColor={semanticColors.accent}
          />
        }
      />

      {ACKS_ENABLED ? (
        <CompletionToast
          state={toast}
          testID="coach-community-inbox-completion-toast"
        />
      ) : null}
    </View>
  );
}

type InboxRowProps = React.ComponentProps<typeof InboxRow>;

/**
 * VOICE-INBOX (#167-4): a voice row (the API sends one only with
 * communityVoiceNotes on, and only with its note) reads "Voice note · 0:42"
 * and opens the note; every other row is the typed row, which opens nothing.
 */
function InboxRowOrVoice(props: InboxRowProps): React.ReactElement {
  const { voice } = props.item;
  return props.item.kind === 'voice' && voice ? (
    <VoiceInboxRow {...props} noteId={voice.note_id} durationMs={voice.duration_ms} />
  ) : (
    <InboxRow {...props} />
  );
}

function VoiceInboxRow({
  noteId,
  durationMs,
  item,
  ...props
}: InboxRowProps & { noteId: string; durationMs: number }): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const labelled = { ...item, snippet: `Voice note · ${formatDuration(durationMs)}` };
  return (
    <HapticPressable
      intent="light"
      onPress={() => openInboxVoiceNote(navigation, noteId)}
      accessibilityRole="button"
      accessibilityLabel={buildRowAccessibilityLabel(labelled, undefined)}
    >
      <InboxRow {...props} item={labelled} />
    </HapticPressable>
  );
}

/** Where a voice row opens: the voice note today; the space chat (#167-3) re-points this one line. */
export function openInboxVoiceNote(navigation: CoachCommunityNav, noteId: string): void {
  navigation.navigate('CommunityVoiceNoteDetail', { voiceNoteId: noteId });
}

/** The mic glyph a voice row's line starts with, inline in its text. */
function VoiceGlyph({ id, color }: { id: string; color: string }): React.ReactElement {
  return (
    <Text>
      <Ionicons
        name="mic-outline"
        size={15}
        color={color}
        testID={`coach-community-inbox-voice-${id}`}
      />{' '}
    </Text>
  );
}

function InboxRow({
  item,
  surface,
  border,
  titleColor,
  metaColor,
  onAcknowledged,
}: {
  item: CoachInboxItem;
  surface: string;
  border: string;
  titleColor: string;
  metaColor: string;
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
    <View
      accessible
      accessibilityLabel={buildRowAccessibilityLabel(item, ackState)}
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
          {item.kind === 'voice' ? <VoiceGlyph id={item.id} color={metaColor} /> : null}
          {item.snippet}
        </Text>
        {ACKS_ENABLED && item.type === 'message' && item.kind === 'text' ? (
          <CoachAckRow
            item={item}
            ackState={ackState}
            onAcknowledged={onAcknowledged}
          />
        ) : null}
      </View>
    </View>
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
  // The row's ack summary covers the time before any action fills the cache.
  const reached = ackState?.state ?? item.ack?.state;
  const alreadyAcked = reached === 'acked' || reached === 'replied';

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
  pageSpinner: { paddingVertical: spacing.lg },
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
});
