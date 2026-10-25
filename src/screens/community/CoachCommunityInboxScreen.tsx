/**
 * CoachCommunityInboxScreen — aggregated unanswered items across the coach's
 * cohorts (v1-6). Consumes `GET /community/me/coach-inbox`.
 *
 * Each row shows the client avatar (with a monogram badge fallback), a snippet
 * and a relative age. The server has no route to dismiss a row: an item leaves
 * the inbox when the coach replies in that space (the server stamps
 * `coach_replied_at`, and the inbox lists only unanswered items).
 *
 * Styled to K2 Style B (round 2 restyle): bone page, serif page title and
 * date line, warm cream row cards, filled serif-monogram avatars, clock times,
 * skeleton loading and a calm inline card for errors. Branches (UX P0.2):
 * skeleton while loading; an honest error card when nothing has loaded (a
 * failed refresh keeps the rows already shown); an offline card when the phone
 * is offline with nothing cached; and — on a genuinely empty inbox — the
 * operator-locked Roman-voiced empty state whose copy + crop come from the
 * backend voice policy. Rows from blocked people never show. Touch targets are
 * >= 44pt.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing, colors, semantic, brand } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import {
  CoachRomanEmptyState,
  MonogramBadge,
} from '../../components/community/coach';
import CoachAckBadge, {
  resolveAckBadgeVisibility,
  inboxRowAck,
  type AckBadgeInput,
} from '../../components/community/CoachAckBadge';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import type { CoachCommunityNav } from './coachCommunityNavTypes';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { formatDuration } from '../../components/community/voiceFormat';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import {
  useCoachInbox,
  useCoachAckState,
  useCoachEmptyStatePayload,
} from '../../hooks/useCoachCommunity';
import {
  useCoachAckActions,
  isIllegalAckTransition,
} from '../../hooks/useCoachAckActions';
import { featureFlags } from '../../config/featureFlags';
import AiTriageCard from '../../components/community/AiTriageCard';
import { useInboxTriage } from '../../hooks/useInboxTriage';
import { aiRefusalOf } from '../../lib/ai/aiRefusal';
import type { CoachInboxItem } from '../../api/coachCommunityApi';

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
  ack: AckBadgeInput | undefined,
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

export default function CoachCommunityInboxScreen({
  navigation,
}: { navigation?: Pick<CoachCommunityNav, 'navigate'> } = {}): React.ReactElement {
  const inbox = useCoachInbox();
  const emptyState = useCoachEmptyStatePayload('coach_community_inbox_empty');

  // UX F6: a subtle, proportionate closure moment on a successful acknowledge,
  // reusing the established CompletionToast pattern (no new infrastructure).
  const { toast, show: showToast } = useCompletionToast();
  const onAcknowledged = useCallback(() => {
    showToast('Acknowledged.');
  }, [showToast]);

  // Owner rule: a blocked person disappears from the inbox at once. Rows from
  // anyone in the blocked list are filtered here (defence in depth next to the
  // server filter). When the list shrinks (an unblock), refetch so rows the
  // server dropped come back.
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const blockedIds = useMemo(() => new Set(blocked.map((b) => b.id)), [blocked]);
  const blockedCount = blocked.length;
  const lastBlockedCount = useRef(blockedCount);
  const { refetch } = inbox;
  useEffect(() => {
    if (blockedCount < lastBlockedCount.current) void refetch?.();
    lastBlockedCount.current = blockedCount;
  }, [blockedCount, refetch]);

  // Memoise the row list so its identity is stable across renders — otherwise
  // the `?? []` fallback allocates a fresh array each render and churns the
  // useCallback deps below (and the FlatList data prop).
  const items = useMemo(
    () =>
      (inbox.data?.items ?? []).filter((i) => !blockedIds.has(i.client_user_id)),
    [inbox.data?.items, blockedIds],
  );
  const hasItems = items.length > 0;
  // react-query pauses a fetch while the phone is offline.
  const offline = inbox.fetchStatus === 'paused';

  const openItem = useCallback(
    (item: CoachInboxItem) => {
      // Post rows open the post. Message rows have no destination on main yet
      // (the space chat screen ships separately), so they are not tappable.
      if (item.type === 'post') {
        navigation?.navigate('CoachCommunityPostDetail', { postId: item.id });
      }
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: CoachInboxItem }) => (
      <InboxRowOrVoice
        item={item}
        onOpen={item.type === 'post' ? () => openItem(item) : undefined}
        onAcknowledged={onAcknowledged}
      />
    ),
    [openItem, onAcknowledged],
  );

  if (!hasItems && offline) {
    return (
      <View style={styles.page} testID="coach-community-inbox-screen">
        <InboxTitle />
        <InboxNoticeCard
          message="You are offline. Your inbox loads when you reconnect."
          testID="coach-community-inbox-offline"
        />
      </View>
    );
  }

  if (inbox.isLoading) {
    return (
      <View style={styles.page} testID="coach-community-inbox-screen">
        <InboxTitle subtitle="Loading your inbox" />
        <View
          accessible
          accessibilityLabel="Loading your inbox"
          testID="coach-community-inbox-loading"
          style={styles.skeletonList}
        >
          {[0, 1, 2, 3].map((n) => (
            <View key={n} style={styles.skeletonCard} />
          ))}
        </View>
      </View>
    );
  }

  // A failed refetch or next page keeps the rows already shown; the full error
  // shows only when there is nothing to show.
  if (inbox.isError && !hasItems) {
    return (
      <View style={styles.page} testID="coach-community-inbox-screen">
        <InboxTitle />
        <InboxNoticeCard
          message="Your inbox did not load. Check your connection, then try again."
          onRetry={() => inbox.refetch()}
          retrying={inbox.isRefetching}
          testID="coach-community-inbox-error"
        />
      </View>
    );
  }

  if (!hasItems) {
    return (
      <View style={styles.page} testID="coach-community-inbox-screen">
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
    <View style={styles.page} testID="coach-community-inbox-screen">
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <InboxTitle flush />
            {inbox.isError ? (
              <InboxNoticeCard
                message="Your inbox did not refresh. Showing what loaded before."
                onRetry={() => inbox.refetch()}
                retrying={inbox.isRefetching}
                testID="coach-community-inbox-refresh-error"
                flush
              />
            ) : null}
            {TRIAGE_ENABLED ? <InboxTriageBanner /> : null}
          </View>
        }
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
          if (inbox.hasNextPage && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        testID="coach-community-inbox-list"
        ListFooterComponent={
          inbox.isFetchingNextPage ? (
            <ActivityIndicator
              color={colors.forest}
              style={styles.pageSpinner}
              testID="coach-community-inbox-next-page"
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
            onRefresh={() => inbox.refetch()}
            tintColor={colors.forest}
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

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Sunday 25 October" — the K2 date line under the page title. */
export function inboxDateLine(now: Date = new Date()): string {
  return `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

/**
 * Row time in the K2 style: a clock time for today ("6:41 am"), the weekday
 * within the last week ("Wed"), else the date ("14 Oct").
 */
export function inboxRowTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  if (then.toDateString() === now.toDateString()) {
    const h = then.getHours();
    const mm = String(then.getMinutes()).padStart(2, '0');
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
  }
  const days = (now.getTime() - then.getTime()) / 86_400_000;
  if (days >= 0 && days < 7) return DAYS[then.getDay()].slice(0, 3);
  return `${then.getDate()} ${MONTHS[then.getMonth()].slice(0, 3)}`;
}

function InboxTitle({
  subtitle,
  flush,
}: {
  subtitle?: string;
  flush?: boolean;
}): React.ReactElement {
  return (
    <View style={flush ? styles.titleBlockFlush : styles.titleBlock}>
      <Text accessibilityRole="header" style={styles.title}>
        Inbox
      </Text>
      <Text style={styles.dateLine}>{subtitle ?? inboxDateLine()}</Text>
    </View>
  );
}

/** K2 inline card: a calm line and, when there is one, a "Try again" button. */
function InboxNoticeCard({
  message,
  onRetry,
  retrying,
  testID,
  flush,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  testID: string;
  flush?: boolean;
}): React.ReactElement {
  return (
    <View
      style={[styles.noticeCard, flush ? null : styles.noticeCardInset]}
      testID={testID}
    >
      <Text accessibilityRole="alert" style={styles.noticeText}>
        {message}
      </Text>
      {onRetry ? (
        <HapticPressable
          intent="light"
          onPress={onRetry}
          disabled={retrying}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          accessibilityState={{ disabled: !!retrying, busy: !!retrying }}
          testID={`${testID}-retry`}
          style={styles.noticeButton}
        >
          {retrying ? (
            <ActivityIndicator color={colors.forest} />
          ) : (
            <Text style={styles.noticeButtonLabel}>Try again</Text>
          )}
        </HapticPressable>
      ) : null}
    </View>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

/** Filled forest circle with serif initials (K2); a photo when there is one. */
function InboxAvatar({
  item,
}: {
  item: CoachInboxItem;
}): React.ReactElement {
  const testID = `coach-community-inbox-avatar-${item.id}`;
  if (item.avatar_url) {
    return (
      <MonogramBadge
        name={item.client_name}
        avatarUrl={item.avatar_url}
        size={44}
        testID={testID}
      />
    );
  }
  return (
    <View style={styles.monogram} testID={testID}>
      <Text style={styles.monogramText} allowFontScaling={false}>
        {initialsOf(item.client_name)}
      </Text>
    </View>
  );
}

type InboxRowProps = React.ComponentProps<typeof InboxRow>;

/**
 * VOICE-INBOX (#167-4): a voice row (the API sends one only with
 * communityVoiceNotes on, and only with its note) reads "Voice note · 0:42"
 * and opens the note; every other row is the typed row.
 */
function InboxRowOrVoice(props: InboxRowProps): React.ReactElement {
  const { voice } = props.item;
  return props.item.kind === 'voice' && voice ? (
    <VoiceInboxRow {...props} noteId={voice.note_id} durationMs={voice.duration_ms} />
  ) : (
    <InboxRow {...props} />
  );
}

/**
 * The voice row is the same card; its one pressable element opens the note
 * (no outer pressable wrapping an accessible row — one element, one label).
 */
function VoiceInboxRow({
  noteId,
  durationMs,
  item,
  ...props
}: InboxRowProps & { noteId: string; durationMs: number }): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const labelled = { ...item, snippet: `Voice note · ${formatDuration(durationMs)}` };
  return (
    <InboxRow
      {...props}
      item={labelled}
      onOpen={() => openInboxVoiceNote(navigation, noteId)}
    />
  );
}

/** Where a voice row opens: the voice note today; the space chat (#167-3) re-points this one line. */
export function openInboxVoiceNote(navigation: CoachCommunityNav, noteId: string): void {
  navigation.navigate('CommunityVoiceNoteDetail', { voiceNoteId: noteId });
}

/** Voice B Studio strip: a forest play disc and a still waveform (decorative). */
const WAVE = [6, 12, 18, 10, 22, 14, 8, 20, 16, 24, 12, 18, 9, 15, 21, 11, 7, 17, 13, 19];
function VoiceStrip({ id }: { id: string }): React.ReactElement {
  return (
    <View
      style={styles.voiceStrip}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.voicePlay}>
        <Ionicons
          name="play"
          size={16}
          color={colors.bone}
          testID={`coach-community-inbox-voice-${id}`}
        />
      </View>
      <View style={styles.voiceWave}>
        {WAVE.map((h, n) => (
          <View key={n} style={[styles.voiceBar, { height: h }]} />
        ))}
      </View>
    </View>
  );
}

function InboxRow({
  item,
  onOpen,
  onAcknowledged,
}: {
  item: CoachInboxItem;
  onOpen?: () => void;
  onAcknowledged: () => void;
}): React.ReactElement {
  // ACKS_ENABLED is a build-time constant, so the number/order of hooks is
  // stable for the entire lifetime of a build — a hook guarded by it never
  // changes its called/not-called status at runtime, which keeps the
  // flag-off path (and its invariance test) from touching any ack hook. When
  // the flag is on, the per-message ack cache wins once an action fills it;
  // before that the row's own `ack` summary drives the badge AND the label.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const cached = ACKS_ENABLED ? useCoachAckState(item.id) : undefined;
  // Only typed message rows carry coach acks.
  const acks = ACKS_ENABLED && item.type === 'message' && item.kind === 'text';
  const ack = acks ? inboxRowAck(cached, item.ack) : undefined;
  const breached = ack != null && resolveAckBadgeVisibility(ack).breached;
  const label = buildRowAccessibilityLabel(item, ack);
  const rowTestID = `coach-community-inbox-row-${item.id}`;

  const content = (
    <>
      <InboxAvatar item={item} />
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.client_name}
          </Text>
          <Text style={styles.rowTime}>{inboxRowTime(item.created_at)}</Text>
        </View>
        <Text style={styles.rowCohort} numberOfLines={1}>
          {item.cohort_name}
        </Text>
        {item.kind === 'voice' ? <VoiceStrip id={item.id} /> : null}
        <Text style={styles.rowSnippet} numberOfLines={2}>
          {item.snippet}
        </Text>
      </View>
    </>
  );

  // The row's text is one accessible element; the Acknowledge control sits
  // beside it as its own element, never inside it.
  return (
    <View
      style={[styles.card, breached ? styles.cardBreached : null]}
      testID={`coach-community-inbox-card-${item.id}`}
    >
      {onOpen ? (
        <HapticPressable
          intent="light"
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={rowTestID}
          style={styles.rowMain}
        >
          {content}
        </HapticPressable>
      ) : (
        <View
          accessible
          accessibilityLabel={label}
          testID={rowTestID}
          style={styles.rowMain}
        >
          {content}
        </View>
      )}
      {acks ? (
        <CoachAckRow item={item} ack={ack} onAcknowledged={onAcknowledged} />
      ) : null}
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
  ack,
  onAcknowledged,
}: {
  item: CoachInboxItem;
  ack: AckBadgeInput | undefined;
  onAcknowledged: () => void;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  const actions = useCoachAckActions(item.id);
  const pending = actions.markAcked.isPending;
  // `ack` is the cache once filled, else the row's own summary.
  const reached = ack?.state;
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
        ack={ack}
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
            borderColor: colors.forest,
            opacity: pending || alreadyAcked ? 0.5 : 1,
          },
        ]}
      >
        <Text
          style={styles.markAckedLabel}
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

// K2 Style B tokens: bone page (owner #166-2), warm cream cards, forest accent,
// ink text. Serif roles keep lineHeight >= 1.25 x fontSize (Android descenders).
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bone },
  pageSpinner: { paddingVertical: spacing.lg },
  triageHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  titleBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  titleBlockFlush: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 36,
    lineHeight: 46,
    color: colors.ink,
  },
  dateLine: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.charcoal,
  },
  listHeader: { gap: spacing.sm, marginBottom: spacing.xs },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  skeletonList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  skeletonCard: {
    height: 88,
    borderRadius: 16,
    backgroundColor: colors.cream,
    opacity: 0.7,
  },
  noticeCard: {
    backgroundColor: colors.cream,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
  },
  noticeCardInset: { marginHorizontal: spacing.lg },
  noticeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  noticeButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  noticeButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: colors.forest,
  },
  card: {
    backgroundColor: colors.cream,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  cardBreached: { borderColor: semantic.warning.border },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
  },
  monogram: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 23,
    color: colors.bone,
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
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },
  rowCohort: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    color: colors.charcoal,
  },
  rowSnippet: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingLeft: 44 + spacing.md,
  },
  markAckedButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: colors.bone,
  },
  markAckedLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    color: colors.forest,
  },
  voiceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  voicePlay: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceWave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar: { width: 3, borderRadius: 2, backgroundColor: brand[300] },
  ackConflict: {
    flexBasis: '100%',
    fontSize: 12,
    lineHeight: 16,
  },
});
