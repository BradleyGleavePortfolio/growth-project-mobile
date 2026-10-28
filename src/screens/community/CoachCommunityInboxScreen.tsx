/**
 * CoachCommunityInboxScreen — aggregated unanswered items across the coach's
 * cohorts (v1-6). Consumes `GET /community/me/coach-inbox`.
 *
 * Each row shows the client avatar (with a monogram badge fallback), a snippet
 * and a relative age. The server has no route to dismiss a row: an item leaves
 * the inbox when the coach replies in that space (the server stamps
 * `coach_replied_at`, and the inbox lists only unanswered items).
 *
 * K2 Style B. Branches (UX P0.2): skeleton while loading; an honest error card
 * when nothing has loaded; an offline card when offline with nothing cached;
 * and — on a genuinely empty inbox — the dark caught-up page (Roman's face in
 * his gold ring above his line, from the voice policy). Rows from blocked
 * people never show. Touch targets are >= 44pt; gutters are 24pt.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { describeCommunityFailure } from '../../api/communityErrors';
import { useTheme } from '../../theme/useTheme';
import { spacing, colors, semantic, layout, radius } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import RomanAvatar from '../../components/roman/RomanAvatar';
import {
  CoachRomanEmptyState,
  MonogramBadge,
} from '../../components/community/coach';
import { useNetworkStatus, isEffectivelyOnline } from '../../hooks/useNetworkStatus';
import CoachAckBadge, {
  resolveAckBadgeVisibility,
  inboxRowAck,
  type AckBadgeInput,
} from '../../components/community/CoachAckBadge';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import type { CoachCommunityNav } from './coachCommunityNavTypes';
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
import type { CoachInboxItem, RomanCopyPayload } from '../../api/coachCommunityApi';

/** What the inbox uses from navigation; tests pass only `navigate`. */
type InboxNav = Pick<CoachCommunityNav, 'navigate'> & {
  goBack?: () => void;
  canGoBack?: () => boolean;
  setOptions?: (options: {
    headerStyle?: { backgroundColor: string };
    headerTintColor?: string;
  }) => void;
};

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
function InboxTriageBanner({
  clearInbox = false,
}: {
  clearInbox?: boolean;
}): React.ReactElement | null {
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
  const card = (
    <AiTriageCard
      status={status}
      triage={triage.data}
      onRetry={() => triage.refetch()}
      retrying={triage.isRefetching}
      refusal={triage.isError ? aiRefusalOf(triage.error) : null}
      testID="coach-community-inbox-ai-triage"
    />
  );
  if (!clearInbox) return card;
  // A clear inbox shows the triage card only when it has items (K2 B_caught_up).
  return status === 'ready' ? <View style={styles.triageHeader}>{card}</View> : null;
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
}: { navigation?: InboxNav } = {}): React.ReactElement {
  const inbox = useCoachInbox();
  const emptyState = useCoachEmptyStatePayload('coach_community_inbox_empty');
  const network = useNetworkStatus();

  // UX F6: a subtle, proportionate closure moment on a successful acknowledge,
  // reusing the established CompletionToast pattern (no new infrastructure).
  const { toast, show: showToast } = useCompletionToast();
  const onAcknowledged = useCallback(() => {
    showToast('Acknowledged.');
  }, [showToast]);

  // Owner rule: a blocked person disappears from the inbox at once (next to the
  // server filter); an unblock refetches so their rows come back.
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
  // Offline: NetInfo, or react-query pausing a fetch while it thinks so.
  const offline = inbox.fetchStatus === 'paused' || !isEffectivelyOnline(network);

  // K2: the dark caught-up page gets a forest bar; every other state keeps bone.
  const caughtUp =
    !hasItems &&
    !offline &&
    !inbox.isLoading &&
    !inbox.isError &&
    emptyState.status === 'ready';
  const setOptions = navigation?.setOptions;
  useLayoutEffect(() => {
    setOptions?.({
      headerStyle: { backgroundColor: caughtUp ? colors.forest : colors.bone },
      headerTintColor: caughtUp ? colors.bone : colors.ink,
    });
  }, [caughtUp, setOptions]);

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
      <InboxRow
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

  // A failed refetch keeps the rows shown; the full error only when there are none.
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
    // The empty inbox pulls to refresh; it also retries Roman's words if they failed.
    const onEmptyRefresh = (): void => {
      void inbox.refetch();
      if (emptyState.status === 'error') emptyState.retry();
    };
    if (caughtUp && emptyState.status === 'ready') {
      const canGoBack =
        navigation?.goBack != null && navigation.canGoBack?.() !== false;
      return (
        <InboxCaughtUp
          payload={emptyState.payload}
          onBack={canGoBack ? () => navigation?.goBack?.() : undefined}
          onRefresh={onEmptyRefresh}
          refreshing={inbox.isRefetching}
        />
      );
    }
    // Policy loading or failed: the light page (never Roman's words without his face).
    return (
      <View style={styles.page} testID="coach-community-inbox-screen">
        <ScrollView
          testID="coach-community-inbox-empty-scroll"
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={inbox.isRefetching}
              onRefresh={onEmptyRefresh}
              tintColor={colors.forest}
            />
          }
        >
          <InboxTitle />
          {TRIAGE_ENABLED ? <InboxTriageBanner clearInbox /> : null}
          <CoachRomanEmptyState
            result={emptyState}
            testID="coach-community-inbox-empty"
          />
        </ScrollView>
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
  onDark,
}: {
  subtitle?: string;
  flush?: boolean;
  onDark?: boolean;
}): React.ReactElement {
  return (
    <View style={flush ? styles.titleBlockFlush : styles.titleBlock}>
      <Text
        accessibilityRole="header"
        style={[styles.title, onDark ? styles.titleOnDark : null]}
      >
        Inbox
      </Text>
      <Text style={[styles.dateLine, onDark ? styles.dateLineOnDark : null]}>
        {subtitle ?? inboxDateLine()}
      </Text>
    </View>
  );
}

/**
 * K2 closure (DESIGN_TRAINING 7.7): Roman's face (voice-policy crop) in his gold
 * ring above his serif line, and a cream button back to Community.
 */
function InboxCaughtUp({
  payload,
  onBack,
  onRefresh,
  refreshing,
}: {
  payload: RomanCopyPayload;
  onBack?: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.ReactElement {
  const crop = payload.avatar_crop === 'smile' ? 'smile' : 'neutral';
  return (
    <View style={styles.caughtUpPage} testID="coach-community-inbox-screen">
      <StatusBar style="light" />
      <ScrollView
        testID="coach-community-inbox-empty-scroll"
        contentContainerStyle={styles.emptyScroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.bone}
          />
        }
      >
        <InboxTitle onDark />
        {TRIAGE_ENABLED ? <InboxTriageBanner clearInbox /> : null}
        <View style={styles.caughtUpBody} testID="coach-community-inbox-empty">
          <View style={styles.caughtUpRing}>
            <RomanAvatar
              crop={crop}
              size={64}
              testID="coach-community-inbox-empty-avatar"
            />
          </View>
          <Text style={styles.caughtUpText}>{payload.text}</Text>
        </View>
      </ScrollView>
      {onBack ? (
        <HapticPressable
          intent="light"
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to Community"
          testID="coach-community-inbox-empty-back"
          style={styles.caughtUpButton}
        >
          <Text style={styles.caughtUpButtonLabel}>Back to Community</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

/** K2 inline card: a calm line and, when there is one, a "Try again" button. */
export function InboxNoticeCard({
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

/** A coach create or Acknowledge that failed says why, in the shared community words. */
export function alertCoachFailure(err: unknown): void {
  const f = describeCommunityFailure(err, 'moderate');
  Alert.alert(f.title, f.message);
}

/** Up to two initials for a filled serif monogram (K2). */
export function initialsOf(name: string): string {
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
  // the flag is on, the per-message ack cache and the row's own `ack` summary
  // merge (inboxRowAck, later wins) and drive the badge AND the label.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const cached = ACKS_ENABLED ? useCoachAckState(item.id) : undefined;
  // Coach acks are per message: typed and photo rows carry them; a voice
  // row's id is the note's id, and posts have none.
  const acks = ACKS_ENABLED && item.type === 'message' && item.kind !== 'voice';
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
        {/* A row that opens (a post) clamps to two lines; a message row has
            nowhere to open yet, so it shows the whole text (at most 200). */}
        <Text style={styles.rowSnippet} numberOfLines={onOpen ? 2 : undefined}>
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
  // `ack` is the cache merged with the row's own summary (later wins).
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

  // Once acknowledged (or replied) the badge already says so, so the button
  // goes: the word never shows twice and no disabled button is left behind.
  return (
    <View style={styles.ackRow}>
      <CoachAckBadge
        ack={ack}
        labelledByRow
        testID={`coach-community-inbox-ack-badge-${item.id}`}
      />
      {alreadyAcked ? null : (
        <HapticPressable
          intent="light"
          onPress={() =>
            actions.markAcked.mutate(undefined, {
              onSuccess: onAcknowledged,
              // A 409 keeps its calm inline line below; any other refusal says why.
              onError: (e) => {
                if (!isIllegalAckTransition(e)) alertCoachFailure(e);
              },
            })
          }
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel={`Acknowledge message from ${item.client_name}`}
          accessibilityState={{ disabled: pending, busy: pending }}
          testID={`coach-community-inbox-mark-acked-${item.id}`}
          style={[styles.markAckedButton, pending ? styles.markAckedPending : null]}
        >
          <Text style={styles.markAckedLabel}>Acknowledge</Text>
        </HapticPressable>
      )}
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
// ink text, graphite small grey text (owner #168-13), 24pt gutters, semantic
// radii. Serif roles keep lineHeight >= 1.25 x fontSize (Android descenders).
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bone },
  pageSpinner: { paddingVertical: spacing.lg },
  triageHeader: {
    paddingHorizontal: layout.gutter,
    paddingBottom: spacing.md,
  },
  titleBlock: {
    paddingHorizontal: layout.gutter,
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
  titleOnDark: { color: colors.bone },
  dateLine: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 21,
    color: colors.graphite,
  },
  dateLineOnDark: { color: colors.cream },
  listHeader: { gap: spacing.sm, marginBottom: spacing.xs },
  listContent: {
    paddingHorizontal: layout.gutter,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  skeletonList: { paddingHorizontal: layout.gutter, gap: spacing.sm },
  skeletonCard: {
    height: 88,
    borderRadius: radius.card,
    backgroundColor: colors.cream,
    opacity: 0.7,
  },
  noticeCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  noticeCardInset: { marginHorizontal: layout.gutter },
  noticeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  noticeButton: {
    minHeight: 48,
    borderRadius: radius.button,
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
    borderRadius: radius.card,
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
    borderRadius: radius.chip,
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
    color: colors.graphite,
  },
  rowCohort: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    color: colors.graphite,
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
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: colors.forest,
    backgroundColor: colors.bone,
  },
  markAckedPending: { opacity: 0.5 },
  markAckedLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    color: colors.forest,
  },
  ackConflict: {
    flexBasis: '100%',
    fontSize: 12,
    lineHeight: 16,
  },
  // K2 caught-up page: forest, Roman in his gold ring, his serif line, a cream button.
  caughtUpPage: {
    flex: 1,
    backgroundColor: colors.forest,
    paddingBottom: spacing.xl,
  },
  caughtUpBody: {
    flex: 1,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  emptyScroll: { flexGrow: 1 },
  caughtUpRing: {
    width: 80,
    height: 80,
    borderRadius: radius.chip,
    borderWidth: 2,
    borderColor: colors.romanAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caughtUpText: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 40,
    color: colors.bone,
  },
  caughtUpButton: {
    marginHorizontal: layout.gutter,
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  caughtUpButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    lineHeight: 22,
    color: colors.forest,
  },
});

// Cohorts and a cohort draw the same K2 page, title, monogram and card.
export { styles as k2Styles };
