import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Pressable,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { rememberUnreadCounts } from '../../store/closedClientsStore';
import { coachApi } from '../../services/api';
import { subscribeToMessages } from '../../services/realtime';
import { useTheme } from '../../theme/ThemeProvider';
import { coachInboxB, layout } from '../../theme/tokens';
import { Screen } from '../../ui';
import { EmptyStateNoClients, EmptyStateNoResults } from '../../ui/empty-states';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import CoachInboxV2 from './CoachInboxV2';
import { openInboxChat, useInboxTap, type InboxTap } from '../../navigation/coachInbox';
import { UUID } from '../../navigation/incomingLinks';
import { BroadcastsEntry } from './broadcasts/BroadcastsEntry';
import { CommunityReportsEntry } from './CommunityReportsEntry';
import { CommunityEntry } from './CommunityEntry';
import { InboxTile, RomanDraftsHero, canSeeDrafts, inboxB } from './inboxStyleB';

// Backstop poll — Realtime broadcasts drive most refreshes now. Was 30s.
const FALLBACK_POLL_MS = 60000;

interface UnreadByClient {
  [clientId: string]: number;
}

/**
 * Coach Messages tab. Server flag `messaging_core_v2` ON: the one inbox on
 * the v2 routes (CoachInboxV2). OFF, or when the server answers 503
 * messaging.feature_disabled to a stale flag cache: the legacy client list
 * below. COACH-ROW-CHAT-PUSH-M: a message notification opens this screen with
 * its client's id (route clientId); once the switches have answered, the list
 * that is drawn opens that client's chat from her row (useInboxTap).
 */
export default function MessagesScreen({ route, navigation }: { route?: { params?: { clientId?: string } }; navigation?: InboxTap['screen'] }) {
  const { flags, isLoading } = useFeatureFlags();
  const [v2Refused, setV2Refused] = useState(false);
  const onFeatureDisabled = useCallback(() => setV2Refused(true), []);
  const id = route?.params?.clientId;
  const tap = navigation && !isLoading && typeof id === 'string' && UUID.test(id) ? { clientId: id, screen: navigation } : undefined;
  if (flags.messaging_core_v2 && !v2Refused) return <CoachInboxV2 onFeatureDisabled={onFeatureDisabled} tap={tap} />;
  return <LegacyCoachMessages tap={tap} />;
}

const nameOf = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

function LegacyCoachMessages({ tap }: { tap?: InboxTap }) {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const { clients, loadClients } = useCoachStore();
  const [unreadByClient, setUnreadByClient] = useState<UnreadByClient>({});
  const [closedIds, setClosedIds] = useState<string[]>([]); // FR-872: b#1153 closed_client_ids (blocked either way)
  const [unreadRead, setUnreadRead] = useState(false); // R7: closedIds is known once this read answered or failed
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadUnread = useCallback(async () => {
    try {
      const res = await coachApi.getUnreadCounts();
      const raw = res.data || {};
      const byClient: UnreadByClient = raw.by_client || raw.byClient || {};
      setUnreadByClient(byClient);
      const closed: string[] = Array.isArray(raw.closed_client_ids) ? raw.closed_client_ids : []; // absent on an older server
      setClosedIds(closed);
      rememberUnreadCounts(currentUser?.id, res); // LS-952R2 B1, LS-952R3 B3: Roman's drafts count leaves them out too
    } catch (err) {
      // Silent — keep previous counts
    }
    setUnreadRead(true);
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser) {
      loadClients(currentUser.id);
    }
  }, [currentUser?.id]);

  useFocusEffect(
    useCallback(() => {
      loadUnread();

      // Subscribe to message-arrived pings on the coach's own private topic
      // (messages:user:<id>): the backend pings both people in every chat.
      const unsubscribe = currentUser?.id
        ? subscribeToMessages(currentUser.id, loadUnread)
        : () => {};

      pollRef.current = setInterval(loadUnread, FALLBACK_POLL_MS);
      return () => {
        unsubscribe();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    }, [loadUnread, currentUser?.id]),
  );

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await Promise.all([loadClients(currentUser.id), loadUnread()]);
    setRefreshing(false);
  }, [currentUser?.id, loadUnread]);

  // FX-872 (owner 10-23 "Dissapear"): a client blocked either way is not a chat row (the one block cache, src/lib/blockSync.ts).
  const blocked = useBlockedUsersStore((st) => st.blocked);
  const gone = (id: string) => closedIds.includes(id) || blocked.some((b) => b.id === id);
  const activeClients = clients.filter((c) => c.status === 'active' && !gone(c.id));
  // COACH-ROW-CHAT-PUSH-M: a notification's client opens as her row does, looked for before search; a blank name is no row.
  useInboxTap(tap, {
    ready: unreadRead,
    rowName: (clientId) => nameOf(activeClients.find((c) => c.id === clientId) ?? { firstName: '', lastName: '' }) || undefined,
    reread: onRefresh,
    open: (clientId, name) => openInboxChat(navigation, clientId, name),
  });
  const totalUnread = Object.entries(unreadByClient)
    .filter(([id]) => !gone(id)) // counted 0 once blocked
    .reduce((a, [, n]) => a + (n || 0), 0);

  const list = activeClients
    .filter((c) =>
      !searchQuery.trim()
        ? true
        : `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .map((c) => ({
      id: c.id,
      name: nameOf(c),
      unread: unreadByClient[c.id] || 0,
    }))
    // Surface threads with unread messages first.
    .sort((a, b) => b.unread - a.unread);

  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.bare} style={inboxB.page} testID="coach-messages">
      <View style={styles.header}>
        <View style={inboxB.headerRow}>
          <Text style={inboxB.title}>Messages</Text>
          <View style={inboxB.headerEntries}>
            <CommunityEntry />
            <CommunityReportsEntry />
            <BroadcastsEntry />
          </View>
        </View>
        {totalUnread > 0 && (
          <Text style={inboxB.summary}>
            {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
          </Text>
        )}
      </View>

      <View style={styles.searchContainer}>
        <View style={[inboxB.search, searchQuery.length > 0 && inboxB.searchOn]}>
          <Ionicons name="search" size={20} color={coachInboxB.muted} />
          <TextInput
            style={inboxB.searchInput}
            placeholder="Search clients..."
            placeholderTextColor={coachInboxB.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search clients"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={12} style={inboxB.clear}>
              <Ionicons name="close-circle" size={20} color={coachInboxB.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={canSeeDrafts(currentUser?.role) && !searchQuery.trim() ? <View style={styles.heroWrap}><RomanDraftsHero /></View> : null}
        ListEmptyComponent={
          searchQuery
            ? <EmptyStateNoResults query={searchQuery} onClearSearch={() => setSearchQuery('')} />
            : (
              // Audit fix CR-4: wire onInvite so the empty-state CTA
              // actually renders a button. Without this, EmptyState
              // guards on ctaLabel && onCta and the button never
              // mounts. Routes through the ClientsStack to InviteCodes.
              <EmptyStateNoClients
                onInvite={() =>
                  navigation.navigate('ClientsStack', { screen: 'InviteCodes' })
                }
              />
            )
        }
        renderItem={({ item }) => (
          <InboxTile
            name={item.name}
            preview={item.unread > 0 ? `${item.unread} new message${item.unread !== 1 ? 's' : ''}` : 'Tap to open conversation'}
            unread={item.unread}
            onPress={() => openInboxChat(navigation, item.id, item.name)}
            accessibilityLabel={`Open messages with ${item.name}${item.unread ? `, ${item.unread} unread` : ''}`}
          />
        )}
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
});
