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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { subscribeToMessages } from '../../services/realtime';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { EmptyStateNoClients, EmptyStateNoResults } from '../../ui/empty-states';
import ActionMenu, { ActionMenuOption } from '../../components/messaging/ActionMenu';
import {
  messagingV2Api,
  toMessagingError,
  MUTE_LABELS,
  type InboxThread,
  type MuteDuration,
} from '../../api/messagingV2Api';
import { BroadcastsEntry } from './broadcasts/BroadcastsEntry';
import { CommunityReportsEntry } from './CommunityReportsEntry';

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
  const body = m.kind === 'deleted' ? 'Message deleted' : m.kind === 'voice' ? 'Voice note' : m.preview || 'Message';
  return m.is_mine ? `You: ${body}` : body;
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

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export interface CoachInboxV2Props {
  onFeatureDisabled: () => void;
}

export default function CoachInboxV2({ onFeatureDisabled }: CoachInboxV2Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  // Search must cover the whole inbox, not only the loaded pages.
  useEffect(() => {
    if (searching && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [searching, hasNextPage, isFetchingNextPage, fetchNextPage, data]);

  const threads = useMemo(() => {
    const seen = new Set<string>();
    const out: InboxThread[] = [];
    for (const page of data?.pages ?? []) {
      for (const t of page.items) {
        if (seen.has(t.thread_id)) continue;
        seen.add(t.thread_id);
        out.push(t);
      }
    }
    return out;
  }, [data]);
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
        if (c.status !== 'active' || withThread.has(c.id)) continue;
        const name = `${c.firstName} ${c.lastName}`.trim();
        if (match(name)) out.push({ type: 'client', key: `c:${c.id}`, clientId: c.id, name });
      }
    }
    return out;
  }, [threads, clients, filter, hasNextPage, data, searchQuery]);

  const openThread = useCallback(
    (clientId: string, clientName: string) =>
      navigation.navigate('ClientsStack', { screen: 'ClientMessages', params: { clientId, clientName } }),
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
      <TouchableOpacity
        style={styles.convoCard}
        onPress={() => openThread(t.client_id, name)}
        onLongPress={() => setMenuFor(t)}
        delayLongPress={350}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Open messages with ${name}${flags.length ? `, ${flags.join(', ')}` : ''}`}
        accessibilityHint="Long press for pin and mute options"
        testID={`inbox-row-${t.client_id}`}
      >
        <View style={styles.convoAvatar}>
          <Text style={styles.convoAvatarText}>{initials(name)}</Text>
        </View>
        <View style={styles.convoInfo}>
          <View style={styles.convoTopLine}>
            <Text style={[styles.convoName, unread > 0 && styles.convoNameUnread]} numberOfLines={1}>
              {name}
            </Text>
            {t.pinned ? <Ionicons name="pin" size={13} color={colors.textMuted} accessibilityLabel="Pinned" /> : null}
            {t.muted ? (
              <Ionicons name="notifications-off-outline" size={13} color={colors.textMuted} accessibilityLabel="Muted" />
            ) : null}
            <Text style={styles.convoTime}>{inboxTimeLabel(t.last_activity_at)}</Text>
          </View>
          <Text
            style={[styles.convoPreview, t.last_message?.kind === 'deleted' && styles.convoPreviewItalic]}
            numberOfLines={1}
          >
            {inboxPreview(t)}
          </Text>
        </View>
        {unread > 0 ? (
          <View style={[styles.unreadBadge, t.muted && styles.unreadBadgeMuted]}>
            <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderClient = (clientId: string, name: string) => (
    <TouchableOpacity
      style={styles.convoCard}
      onPress={() => openThread(clientId, name)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Start a conversation with ${name}`}
      testID={`inbox-client-${clientId}`}
    >
      <View style={styles.convoAvatar}>
        <Text style={styles.convoAvatarText}>{initials(name)}</Text>
      </View>
      <View style={styles.convoInfo}>
        <Text style={styles.convoName}>{name}</Text>
        <Text style={styles.convoPreview}>No messages yet. Tap to start the conversation.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );

  const loadError = error && !data ? toMessagingError(error) : null;

  const empty = isLoading ? (
    <ActivityIndicator style={styles.spinner} color={colors.primary} />
  ) : loadError ? (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>Inbox did not load</Text>
      <Text style={styles.errorBody}>{loadError.userMessage}</Text>
      <TouchableOpacity style={styles.retry} onPress={reload} accessibilityRole="button" accessibilityLabel="Try again">
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  ) : searching ? (
    <EmptyStateNoResults query={searchQuery} onClearSearch={() => setSearchQuery('')} />
  ) : filter === 'unread' ? (
    <Text style={styles.allRead}>No unread conversations. Every message has been read.</Text>
  ) : (
    <EmptyStateNoClients onInvite={() => navigation.navigate('ClientsStack', { screen: 'InviteCodes' })} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Messages</Text>
          <View style={styles.headerEntries}>
            <CommunityReportsEntry />
            <BroadcastsEntry />
          </View>
        </View>
        {totalUnread > 0 ? (
          <Text style={styles.unreadSummary}>
            {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search conversations"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.filters} accessibilityRole="tablist">
          {(['all', 'unread'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipOn]}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === f }}
              accessibilityLabel={f === 'all' ? 'All conversations' : 'Unread conversations'}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>{f === 'all' ? 'All' : 'Unread'}</Text>
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
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 24, paddingTop: 60, marginBottom: 8 },
    // Title + Reports + Broadcasts can be wider than a phone: wrap, never clip.
    headerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    headerEntries: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    title: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 32, lineHeight: 35, letterSpacing: 0.6, fontWeight: '400', color: colors.textPrimary },
    unreadSummary: { fontSize: 13, color: colors.primary, fontWeight: '600', marginTop: 2 },
    searchContainer: { paddingHorizontal: 24, marginBottom: 8, gap: 10 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 2,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary },
    filters: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    filterChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
    filterTextOn: { color: colors.textOnPrimary },
    listContent: { paddingHorizontal: 16, paddingBottom: 100 },
    convoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 4, padding: 14, marginBottom: 8, gap: 12 },
    convoAvatar: { width: 48, height: 48, borderRadius: 4, backgroundColor: colors.primaryDark, justifyContent: 'center', alignItems: 'center' },
    convoAvatarText: { fontFamily: 'Inter_600SemiBold', color: colors.textOnPrimary, fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
    convoInfo: { flex: 1, gap: 4 },
    convoTopLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    convoName: { flexShrink: 1, fontFamily: 'Inter_500Medium', fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    convoNameUnread: { fontFamily: 'Inter_600SemiBold', fontWeight: '600' },
    convoTime: { marginLeft: 'auto', fontSize: 12, color: colors.textMuted },
    convoPreview: { fontSize: 13, color: colors.textSecondary },
    convoPreviewItalic: { fontStyle: 'italic' },
    unreadBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 4,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 6,
    },
    unreadBadgeMuted: { backgroundColor: colors.textMuted },
    unreadBadgeText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '500' },
    spinner: { marginTop: 24 },
    errorBox: { padding: 24, alignItems: 'center', gap: 8 },
    errorTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    errorBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    retry: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 4, backgroundColor: colors.primary },
    retryText: { color: colors.textOnPrimary, fontWeight: '600' },
    allRead: { padding: 24, textAlign: 'center', fontSize: 14, color: colors.textSecondary },
  });
