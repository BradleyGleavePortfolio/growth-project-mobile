import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachStore } from '../../store/coachStore';
import { Colors } from '../../constants/colors';
import {
  CoachMessage,
  ConversationPreview,
  getConversations,
  getMessages,
  sendMessage,
  markConversationRead,
  seedCoachMessagesIfNeeded,
} from '../../db/coachMessagesDb';

type ScreenMode = 'list' | 'chat';

export default function MessagesScreen() {
  const currentUser = useCurrentUser();
  const { clients, loadClients } = useCoachStore();
  const [mode, setMode] = useState<ScreenMode>('list');
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Chat state
  const [activeClient, setActiveClient] = useState<{ id: string; name: string } | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const loadConversations = useCallback(async () => {
    if (!currentUser) return;
    await seedCoachMessagesIfNeeded(currentUser.id);
    const convos = await getConversations(currentUser.id);

    // Also include clients without conversations
    const convoClientIds = new Set(convos.map((c) => c.clientId));
    const activeClients = clients.filter((c) => c.status === 'active');
    const extras: ConversationPreview[] = activeClients
      .filter((c) => !convoClientIds.has(c.id))
      .map((c) => ({
        clientId: c.id,
        clientName: `${c.firstName} ${c.lastName}`,
        lastMessage: '',
        lastMessageTime: '',
        unreadCount: 0,
      }));

    setConversations([...convos, ...extras]);
  }, [currentUser, clients]);

  useEffect(() => {
    if (currentUser) {
      loadClients(currentUser.id);
    }
  }, [currentUser]);

  useEffect(() => {
    if (mode === 'list') {
      loadConversations();
    }
  }, [mode, loadConversations]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  }, [loadConversations]);

  const openChat = async (clientId: string, clientName: string) => {
    if (!currentUser) return;
    setActiveClient({ id: clientId, name: clientName });
    const msgs = await getMessages(currentUser.id, clientId);
    setMessages(msgs);
    await markConversationRead(currentUser.id, clientId);
    setMode('chat');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
  };

  const handleSend = async () => {
    if (!currentUser || !activeClient || !inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    Keyboard.dismiss();

    const msg = await sendMessage({
      coachId: currentUser.id,
      clientId: activeClient.id,
      senderId: currentUser.id,
      senderRole: 'coach',
      text,
    });
    setMessages((prev) => [...prev, msg]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    // Simulate client auto-reply after a short delay
    setTimeout(async () => {
      const replies = [
        'Got it, thanks coach!',
        'Will do! 💪',
        'Thanks for the advice!',
        'That makes sense. I\'ll try that.',
        'Awesome, appreciate the feedback!',
        'On it! I\'ll update you after my next meal.',
      ];
      const reply = await sendMessage({
        coachId: currentUser!.id,
        clientId: activeClient!.id,
        senderId: activeClient!.id,
        senderRole: 'client',
        text: replies[Math.floor(Math.random() * replies.length)],
      });
      setMessages((prev) => [...prev, reply]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }, 1500 + Math.random() * 2000);
  };

  const goBack = () => {
    setMode('list');
    setActiveClient(null);
    setMessages([]);
    setInputText('');
  };

  const formatTime = (iso: string): string => {
    if (!iso) return '';
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatMsgTime = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) =>
        c.clientName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  // ──────────────────────── CHAT VIEW ────────────────────────
  if (mode === 'chat' && activeClient) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.chatHeaderInfo}>
            <View style={styles.chatAvatar}>
              <Text style={styles.chatAvatarText}>
                {activeClient.name.split(' ').map((n) => n[0]).join('')}
              </Text>
            </View>
            <View>
              <Text style={styles.chatHeaderName}>{activeClient.name}</Text>
              <Text style={styles.chatHeaderStatus}>Active client</Text>
            </View>
          </View>
          <View style={{ width: 24 }} />
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.chatEmpty}>
              <Ionicons name="chatbubbles-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.chatEmptyText}>
                Start a conversation with {activeClient.name.split(' ')[0]}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isCoach = item.senderRole === 'coach';
            const showDateSep =
              index === 0 ||
              new Date(item.createdAt).toDateString() !==
                new Date(messages[index - 1].createdAt).toDateString();

            return (
              <>
                {showDateSep && (
                  <View style={styles.dateSep}>
                    <Text style={styles.dateSepText}>
                      {new Date(item.createdAt).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.messageBubbleRow,
                    isCoach ? styles.messageBubbleRowRight : styles.messageBubbleRowLeft,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      isCoach ? styles.messageBubbleCoach : styles.messageBubbleClient,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        isCoach && styles.messageTextCoach,
                      ]}
                    >
                      {item.text}
                    </Text>
                    <Text
                      style={[
                        styles.messageTime,
                        isCoach && styles.messageTimeCoach,
                      ]}
                    >
                      {formatMsgTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
              </>
            );
          }}
        />

        <View style={styles.inputBar}>
          <TextInput
            style={styles.chatInput}
            placeholder="Type a message..."
            placeholderTextColor={Colors.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={20} color={inputText.trim() ? '#fff' : Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ──────────────────────── LIST VIEW ────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Messages</Text>
          {totalUnread > 0 && (
            <Text style={styles.unreadSummary}>
              {totalUnread} unread conversation{totalUnread !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.localBanner}>
        <Ionicons name="phone-portrait-outline" size={14} color="#2D6A4F" />
        <Text style={styles.localBannerText}>Messages are stored locally on this device</Text>
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
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={filteredConversations}
        keyExtractor={(item) => item.clientId}
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
            <Text style={styles.emptyTitle}>No Conversations</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? 'No clients match your search.' : 'Messages with your clients will appear here.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.convoCard}
            onPress={() => openChat(item.clientId, item.clientName)}
            activeOpacity={0.7}
          >
            <View style={styles.convoAvatar}>
              <Text style={styles.convoAvatarText}>
                {item.clientName.split(' ').map((n) => n[0]).join('')}
              </Text>
            </View>
            <View style={styles.convoInfo}>
              <View style={styles.convoTop}>
                <Text style={[styles.convoName, item.unreadCount > 0 && styles.convoNameUnread]}>
                  {item.clientName}
                </Text>
                {item.lastMessageTime ? (
                  <Text style={styles.convoTime}>{formatTime(item.lastMessageTime)}</Text>
                ) : null}
              </View>
              <Text
                style={[styles.convoPreview, item.unreadCount > 0 && styles.convoPreviewUnread]}
                numberOfLines={1}
              >
                {item.lastMessage || 'Start a conversation'}
              </Text>
            </View>
            {item.unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  // ── List Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  unreadSummary: { fontSize: 13, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  localBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 24,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#2D6A4F15',
    borderRadius: 10,
  },
  localBannerText: {
    fontSize: 12,
    color: '#2D6A4F',
    fontWeight: '600',
  },
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
  // ── Conversation Card ──
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
  convoAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  convoInfo: { flex: 1, gap: 4 },
  convoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  convoName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  convoNameUnread: { fontWeight: '800' },
  convoTime: { fontSize: 12, color: Colors.textMuted },
  convoPreview: { fontSize: 13, color: Colors.textSecondary },
  convoPreviewUnread: { color: Colors.textPrimary, fontWeight: '600' },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  // ── Empty State ──
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 40 },
  // ── Chat Header ──
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  chatHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chatHeaderName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  chatHeaderStatus: { fontSize: 12, color: Colors.textSecondary },
  // ── Chat Messages ──
  chatList: { padding: 16, paddingBottom: 8 },
  chatEmpty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  chatEmptyText: { fontSize: 14, color: Colors.textMuted },
  dateSep: { alignItems: 'center', marginVertical: 16 },
  dateSepText: { fontSize: 12, color: Colors.textMuted, backgroundColor: Colors.background, paddingHorizontal: 12 },
  messageBubbleRow: { marginBottom: 6 },
  messageBubbleRowRight: { alignItems: 'flex-end' },
  messageBubbleRowLeft: { alignItems: 'flex-start' },
  messageBubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  messageBubbleCoach: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  messageBubbleClient: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messageText: { fontSize: 15, color: Colors.textPrimary, lineHeight: 21 },
  messageTextCoach: { color: '#fff' },
  messageTime: { fontSize: 11, color: Colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  messageTimeCoach: { color: 'rgba(255,255,255,0.7)' },
  // ── Input Bar ──
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 36,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.surface },
});
