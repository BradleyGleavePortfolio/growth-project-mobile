/**
 * CoachInboxV2 — the one coach inbox on GET /coach/messages/inbox
 * (messaging v2, server flag `messaging_core_v2`).
 *
 * Order comes from the server: the coach's pinned conversations first, then
 * newest activity. Each row shows the last message (deleted, voice and own
 * messages say so), the unread count, and pinned / muted markers. The All /
 * Unread switch is a server filter; search runs over every loaded row and
 * pages through the rest of the inbox so no conversation is missed. Active
 * clients with no messages yet follow the inbox (once it is fully loaded) so
 * every client stays one tap away, as in the legacy list.
 *
 * Long-press a row: pin or unpin the conversation (max 5) and mute it for
 * 1 hour / 8 hours / 1 day / 7 days / until turned back on, or unmute. Mute
 * silences push for that conversation only; new messages still arrive.
 *
 * Refresh: realtime `new-message` and `thread-updated` pings on the coach's
 * channel, focus, pull to refresh and a 60 s backstop poll. A 503
 * `messaging.feature_disabled` (stale flag cache) hands control back to the
 * legacy list through `onFeatureDisabled`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  Pressable,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { rememberClosedClients } from '../../store/closedClientsStore';
import { openInboxChat } from '../../navigation/coachInbox';
import { subscribeToMessages } from '../../services/realtime';
import { useTheme } from '../../theme/ThemeProvider';
import { coachInboxB, layout } from '../../theme/tokens';
import { Screen } from '../../ui';
import { EmptyStateNoClients, EmptyStateNoResults } from '../../ui/empty-states';
import ActionMenu, { ActionMenuOption } from '../../components/messaging/ActionMenu';
import { inboxLine } from '../../components/messaging/threadV2';
import {
  messagingV2Api,
  toMessagingError,
  MUTE_LABELS,
  type InboxThread,
  type MuteDuration,
} from '../../api/messagingV2Api';
import { BroadcastsEntry } from './broadcasts/BroadcastsEntry';
import { CommunityReportsEntry } from './CommunityReportsEntry';
import { CommunityEntry } from './CommunityEntry';
import { InboxSkeleton, InboxTile, RomanDraftsHero, canSeeDrafts, inboxB, useRomanDrafts } from './inboxStyleB';

const FALLBACK_POLL_MS = 60000;
const PAGE_LIMIT = 50;
export const coachInboxKey = (filter: 'all' | 'unread') => ['messaging', 'v2', 'coach-inbox', filter] as const;

type Row =
  | { type: 'thread'; key: string; thread: InboxThread }
  | { type: 'client'; key: string; clientId: string; name: string };

export function inboxPreview(t: InboxThread): string {
  if (t.blocked_by_me) return 'Blocked';
  const m = t.last_message;
  if (!m) return 'No messages yet';
  return m.is_mine ? `You: ${inboxLine(m)}` : inboxLine(m);
}

export function inboxTimeLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const ageMs = now.getTime() - d.getTime();
  if (ageMs >= 0 && ageMs < 6 * 24 * 60 * 60 * 1000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface CoachInboxV2Props {
  onFeatureDisabled: () => void;
}

export default function CoachInboxV2({ onFeatureDisabled }: CoachInboxV2Props) {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const { clients, loadClients } = useCoachStore();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [menuFor, setMenuFor] = useState<InboxThread | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useInfiniteQuery({
    queryKey: coachInboxKey(filter),
    queryFn: ({ pageParam }) => messagingV2Api.getCoachInbox({ cursor: pageParam, limit: PAGE_LIMIT, filter }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const { data, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = query;

  useEffect(() => {
    if (error && toMessagingError(error).isFeatureDisabled) onFeatureDisabled();
  }, [error, onFeatureDisabled]);

  useEffect(() => {
    if (currentUser?.id) loadClients(currentUser.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  // The query fetches on mount; later focuses refetch.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) reload();
      focusedOnce.current = true;
      const unsubscribe = currentUser?.id ? subscribeToMessages(currentUser.id, reload, reload) : () => {};
      const poll = setInterval(reload, FALLBACK_POLL_MS);
      return () => {
        unsubscribe();
        clearInterval(poll);
      };
    }, [reload, currentUser?.id]),
  );

  const searching = searchQuery.trim().length > 0;
  // LO-952 C2: the card's own count from the two caches only, no read (the card itself reads while focused); DRAFTS-COUNT-M
  const heroDrawn = useRomanDrafts(false).total > 0;
  // Search must cover the whole inbox, not only the loaded pages.
  useEffect(() => {
    if (searching && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [searching, hasNextPage, isFetchingNextPage, fetchNextPage, data]);

  // FX-872 (owner 10-23 "Dissapear"): a chat closed by a block on either side is not a row at all, and that client is
  // not offered again as "start a conversation" below. The one block cache drops it the moment I block.
  const blocked = useBlockedUsersStore((st) => st.blocked);
  const { threads, hidden, closed } = useMemo(() => {
    const seen = new Set<string>();
    const closed = new Set<string>();
    const out: InboxThread[] = [];
    for (const page of data?.pages ?? []) {
      for (const id of page.closed_client_ids ?? []) closed.add(id); // FR-872 (Opus B1, Sol B1): blocked by the client
      for (const t of page.items) {
        if (seen.has(t.thread_id)) continue;
        seen.add(t.thread_id);
        if (t.closed || t.blocked_by_me) closed.add(t.client_id);
        else out.push(t);
      }
    }
    const gone = new Set<string>([...closed, ...blocked.map((b) => b.id)]);
    return { threads: out.filter((t) => !gone.has(t.client_id)), hidden: gone, closed };
  }, [data, blocked]);
  // LS-952R2 B1: the same closed clients leave Roman's drafts count, here, on Home and on the drafts screen.
  useEffect(() => {
    if (data) rememberClosedClients(currentUser?.id, 'inbox', closed, query.dataUpdatedAt);
  }, [data, closed, currentUser?.id, query.dataUpdatedAt]);
  const totalUnread = data?.pages[0]?.total_unread ?? 0;

  const rows: Row[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const match = (name: string) => !q || name.toLowerCase().includes(q);
    const out: Row[] = threads
      .filter((t) => match(t.counterpart.display_name))
      .map((t) => ({ type: 'thread', key: `t:${t.thread_id}`, thread: t }));
    if (filter === 'all' && !hasNextPage && data) {
      const withThread = new Set(threads.map((t) => t.client_id));
      for (const c of clients) {
        if (c.status !== 'active' || withThread.has(c.id) || hidden.has(c.id)) continue;
        const name = `${c.firstName} ${c.lastName}`.trim();
        if (match(name)) out.push({ type: 'client', key: `c:${c.id}`, clientId: c.id, name });
      }
    }
    return out;
  }, [threads, hidden, clients, filter, hasNextPage, data, searchQuery]);

  const openThread = useCallback(
    (clientId: string, clientName: string) => openInboxChat(navigation, clientId, clientName),
    [navigation],
  );

  const menuOptions: ActionMenuOption[] = useMemo(() => {
    if (!menuFor) return [];
    const opts: ActionMenuOption[] = [
      menuFor.pinned
        ? { key: 'unpin', label: 'Unpin conversation', icon: 'pin-outline' }
        : { key: 'pin', label: 'Pin conversation', icon: 'pin' },
    ];
    if (menuFor.muted) opts.push({ key: 'mute:off', label: MUTE_LABELS.off, icon: 'notifications-outline' });
    (['1h', '8h', '1d', '7d', 'forever'] as const).forEach((d) =>
      opts.push({ key: `mute:${d}`, label: MUTE_LABELS[d], icon: 'notifications-off-outline' }),
    );
    return opts;
  }, [menuFor]);

  const runAction = useCallback(
    async (thread: InboxThread, key: string) => {
      const scope = { role: 'coach' as const, clientId: thread.client_id };
      setBusy(true);
      try {
        if (key === 'pin' || key === 'unpin') await messagingV2Api.setInboxPin(scope, key === 'pin');
        else if (key.startsWith('mute:')) await messagingV2Api.setMute(scope, key.slice(5) as MuteDuration);
        await refetch();
      } catch (err) {
        const e = toMessagingError(err);
        if (e.isFeatureDisabled) onFeatureDisabled();
        else Alert.alert('Conversation not updated', e.userMessage);
      } finally {
        setBusy(false);
      }
    },
    [refetch, onFeatureDisabled],
  );

  const onSelect = useCallback(
    (key: string) => {
      const target = menuFor;
      setMenuFor(null);
      if (target) void runAction(target, key);
    },
    [menuFor, runAction],
  );

  const renderThread = (t: InboxThread) => {
    const unread = t.unread_count;
    const name = t.counterpart.display_name || 'Client';
    const flags = [t.pinned ? 'pinned' : '', t.muted ? 'muted' : '', unread ? `${unread} unread` : ''].filter(Boolean);
    return (
      <InboxTile
        name={name}
        preview={inboxPreview(t)}
        italic={t.last_message?.kind === 'deleted'}
        time={inboxTimeLabel(t.last_activity_at)}
        unread={unread}
        pinned={t.pinned}
        muted={t.muted}
        onPress={() => openThread(t.client_id, name)}
        onLongPress={() => setMenuFor(t)}
        accessibilityLabel={`Open messages with ${name}${flags.length ? `, ${flags.join(', ')}` : ''}`}
        accessibilityHint="Long press for pin and mute options"
        testID={`inbox-row-${t.client_id}`}
      />
    );
  };

  const renderClient = (clientId: string, name: string) => (
    <InboxTile
      name={name}
      preview="No messages yet. Tap to start the conversation."
      onPress={() => openThread(clientId, name)}
      accessibilityLabel={`Start a conversation with ${name}`}
      testID={`inbox-client-${clientId}`}
    />
  );

  const loadError = error && !data ? toMessagingError(error) : null;

  const empty = isLoading ? (
    // LO-952 C2: the ghost card only while the real one (cached drafts, in the list header) is not drawn
    <InboxSkeleton hero={canSeeDrafts(currentUser?.role) && !searching && !heroDrawn} />
  ) : loadError ? (
    <View style={inboxB.errorCard}>
      <Text style={inboxB.errorTitle}>Inbox did not load</Text>
      <Text style={inboxB.errorBody}>{loadError.userMessage}</Text>
      <TouchableOpacity style={inboxB.retry} onPress={reload} accessibilityRole="button" accessibilityLabel="Try again">
        <Text style={inboxB.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  ) : searching ? (
    <EmptyStateNoResults query={searchQuery} onClearSearch={() => setSearchQuery('')} />
  ) : filter === 'unread' ? (
    <Text style={inboxB.allRead}>No unread conversations. Every message has been read.</Text>
  ) : (
    <EmptyStateNoClients onInvite={() => navigation.navigate('ClientsStack', { screen: 'InviteCodes' })} />
  );

  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.bare} style={inboxB.page} testID="coach-inbox">
      <View style={styles.header}>
        <View style={inboxB.headerRow}>
          <Text style={inboxB.title}>Messages</Text>
          <View style={inboxB.headerEntries}>
            <CommunityEntry />
            <CommunityReportsEntry />
            <BroadcastsEntry />
          </View>
        </View>
        {totalUnread > 0 ? (
          <Text style={inboxB.summary}>
            {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.searchContainer}>
        <View style={[inboxB.search, searchQuery.length > 0 && inboxB.searchOn]}>
          <Ionicons name="search" size={20} color={coachInboxB.muted} />
          <TextInput
            style={inboxB.searchInput}
            placeholder="Search conversations"
            placeholderTextColor={coachInboxB.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search conversations"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={12} style={inboxB.clear}>
              <Ionicons name="close-circle" size={20} color={coachInboxB.muted} />
            </Pressable>
          ) : null}
        </View>
        <View style={inboxB.filters} accessibilityRole="tablist">
          {(['all', 'unread'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[inboxB.chip, filter === f && inboxB.chipOn]}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === f }}
              accessibilityLabel={f === 'all' ? 'All conversations' : 'Unread conversations'}
            >
              <Text style={[inboxB.chipText, filter === f && inboxB.chipTextOn]}>{f === 'all' ? 'All' : 'Unread'}</Text>
            </TouchableOpacity>
          ))}
          {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !isFetchingNextPage}
            onRefresh={() => {
              if (currentUser?.id) loadClients(currentUser.id);
              reload();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={canSeeDrafts(currentUser?.role) && !searching ? <View style={styles.heroWrap}><RomanDraftsHero /></View> : null}
        ListEmptyComponent={empty}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={styles.spinner} color={colors.primary} /> : null}
        renderItem={({ item }) => (item.type === 'thread' ? renderThread(item.thread) : renderClient(item.clientId, item.name))}
      />

      <ActionMenu
        visible={menuFor !== null}
        title={menuFor?.counterpart.display_name}
        options={menuOptions}
        onSelect={onSelect}
        onClose={() => setMenuFor(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Screen (src/ui) owns the top: insets.top + 12; the header adds 12 like the Clients and Settings tabs (B13 B28).
  bare: { paddingHorizontal: 0, paddingBottom: 0 },
  header: { paddingHorizontal: layout.gutter, paddingTop: 12, marginBottom: 12 },
  searchContainer: { paddingHorizontal: layout.gutter, marginBottom: 12, gap: 12 },
  listContent: { paddingHorizontal: layout.gutter, paddingBottom: 100 },
  heroWrap: { marginBottom: 12 },
  spinner: { marginTop: 24 },
});
