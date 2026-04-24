import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { coachApi } from '../../services/api';
import { Colors } from '../../constants/colors';

const POLL_MS = 30000;

interface UnreadByClient {
  [clientId: string]: number;
}

export default function MessagesScreen() {
  const navigation = useNavigation<any>();
  const currentUser = useCurrentUser();
  const { clients, loadClients } = useCoachStore();
  const [unreadByClient, setUnreadByClient] = useState<UnreadByClient>({});
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadUnread = useCallback(async () => {
    try {
      const res = await coachApi.getUnreadCounts();
      const raw = res.data || {};
      const byClient: UnreadByClient = raw.by_client || raw.byClient || {};
      setUnreadByClient(byClient);
    } catch (err) {
      // Silent — keep previous counts
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadClients(currentUser.id);
    }
  }, [currentUser?.id]);

  useFocusEffect(
    useCallback(() => {
      loadUnread();
      pollRef.current = setInterval(loadUnread, POLL_MS);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    }, [loadUnread]),
  );

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await Promise.all([loadClients(currentUser.id), loadUnread()]);
    setRefreshing(false);
  }, [currentUser?.id, loadUnread]);

  const activeClients = clients.filter((c) => c.status === 'active');
  const totalUnread = Object.values(unreadByClient).reduce((a, b) => a + (b || 0), 0);

  const list = activeClients
    .filter((c) =>
      !searchQuery.trim()
        ? true
        : `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim(),
      unread: unreadByClient[c.id] || 0,
    }))
    // Surface threads with unread messages first.
    .sort((a, b) => b.unread - a.unread);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Messages</Text>
          {totalUnread > 0 && (
            <Text style={styles.unreadSummary}>
              {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search clients..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search clients"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubble-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Clients</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? 'No clients match your search.' : 'Active clients will appear here.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.convoCard}
            onPress={() =>
              navigation.navigate('ClientsStack', {
                screen: 'ClientMessages',
                params: { clientId: item.id, clientName: item.name },
              })
            }
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Open messages with ${item.name}${item.unread ? `, ${item.unread} unread` : ''}`}
          >
            <View style={styles.convoAvatar}>
              <Text style={styles.convoAvatarText}>
                {item.name.split(' ').map((n) => n[0]).join('')}
              </Text>
            </View>
            <View style={styles.convoInfo}>
              <Text style={[styles.convoName, item.unread > 0 && styles.convoNameUnread]}>
                {item.name}
              </Text>
              <Text style={styles.convoPreview} numberOfLines={1}>
                {item.unread > 0 ? `${item.unread} new message${item.unread !== 1 ? 's' : ''}` : 'Tap to open conversation'}
              </Text>
            </View>
            {item.unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unread}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  unreadSummary: { fontSize: 13, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  searchContainer: { paddingHorizontal: 24, marginBottom: 8 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.textPrimary },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  convoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  convoAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  convoAvatarText: { color: Colors.textOnPrimary, fontSize: 16, fontWeight: '700' },
  convoInfo: { flex: 1, gap: 4 },
  convoName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  convoNameUnread: { fontWeight: '800' },
  convoPreview: { fontSize: 13, color: Colors.textSecondary },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: { color: Colors.textOnPrimary, fontSize: 12, fontWeight: '700' },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 40 },
});
