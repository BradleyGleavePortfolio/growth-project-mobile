import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { coachApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';

interface Message {
  id: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  body: string;
  created_at: string;
  read_at?: string | null;
}

const POLL_MS = 15000;

export default function ClientMessagesScreen() {
  const route = useRoute<RouteProp<ClientsStackParamList, 'ClientMessages'>>();
  const navigation = useNavigation<any>();
  const { clientId, clientName } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      const res = await coachApi.getClientMessages(clientId, { limit: 100 });
      const list: Message[] = normalizeList(res.data);
      setMessages(list);
      setError('');
    } catch (err: any) {
      console.error('ClientMessagesScreen: load failed', err);
      setError('Could not load messages. Pull to retry.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const loadSinceNewest = useCallback(async () => {
    // We just refetch the tail window; backend supports `before` not `after`,
    // and the message volumes are small — simpler to refetch top 100 than to
    // keep cursors on both ends.
    try {
      const res = await coachApi.getClientMessages(clientId, { limit: 100 });
      const list: Message[] = normalizeList(res.data);
      setMessages((prev) => mergeById(prev, list));
    } catch (err) {
      // Silent — poll retries next tick.
    }
  }, [clientId]);

  const markRead = useCallback(async () => {
    try {
      await coachApi.markClientThreadRead(clientId);
    } catch {
      /* no-op */
    }
  }, [clientId]);

  useFocusEffect(
    useCallback(() => {
      loadInitial().then(markRead);
      pollRef.current = setInterval(loadSinceNewest, POLL_MS);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    }, [loadInitial, loadSinceNewest, markRead]),
  );

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    Keyboard.dismiss();
    try {
      const res = await coachApi.sendClientMessage(clientId, text);
      const created: Message = normalizeMessage(res.data);
      setInputText('');
      setMessages((prev) => mergeById(prev, [created]));
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err: any) {
      Alert.alert('Failed to send', err?.response?.data?.message || 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.chatHeader}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.chatHeaderInfo}>
          <View style={styles.chatAvatar}>
            <Text style={styles.chatAvatarText}>
              {clientName.split(' ').map((n) => n[0]).join('')}
            </Text>
          </View>
          <View>
            <Text style={styles.chatHeaderName}>{clientName}</Text>
            <Text style={styles.chatHeaderStatus}>Client</Text>
          </View>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {error ? (
        <TouchableOpacity style={styles.errorBanner} onPress={loadInitial}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </TouchableOpacity>
      ) : null}

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
              Start a conversation with {clientName.split(' ')[0]}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isCoach = item.sender_role === 'coach';
          const showDateSep =
            index === 0 ||
            new Date(item.created_at).toDateString() !==
              new Date(messages[index - 1].created_at).toDateString();
          return (
            <View>
              {showDateSep && (
                <View style={styles.dateSep}>
                  <Text style={styles.dateSepText}>
                    {new Date(item.created_at).toLocaleDateString('en-US', {
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
                  <Text style={[styles.messageText, isCoach && styles.messageTextCoach]}>
                    {item.body}
                  </Text>
                  <Text style={[styles.messageTime, isCoach && styles.messageTimeCoach]}>
                    {formatTime(item.created_at)}
                  </Text>
                </View>
              </View>
            </View>
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
          maxLength={2000}
          accessibilityLabel="Message text"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Ionicons
            name="send"
            size={20}
            color={inputText.trim() && !sending ? Colors.textOnPrimary : Colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function normalizeList(raw: any): Message[] {
  const arr = Array.isArray(raw) ? raw : raw?.messages || [];
  return arr
    .map(normalizeMessage)
    .filter((m: Message) => !!m.id)
    .sort(byCreatedAtAsc);
}

function normalizeMessage(raw: any): Message {
  return {
    id: String(raw.id),
    sender_role: raw.sender_role === 'coach' ? 'coach' : 'client',
    sender_id: raw.sender_id,
    body: String(raw.body ?? ''),
    created_at: raw.created_at || new Date().toISOString(),
    read_at: raw.read_at ?? null,
  };
}

function byCreatedAtAsc(a: Message, b: Message): number {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function mergeById(existing: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  existing.forEach((m) => map.set(m.id, m));
  incoming.forEach((m) => map.set(m.id, m));
  return Array.from(map.values()).sort(byCreatedAtAsc);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  errorBanner: { backgroundColor: Colors.error + '22', paddingVertical: 8, paddingHorizontal: 16 },
  errorBannerText: { color: Colors.error, fontSize: 13, textAlign: 'center' },
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
  chatAvatarText: { color: Colors.textOnPrimary, fontSize: 13, fontWeight: '700' },
  chatHeaderName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  chatHeaderStatus: { fontSize: 12, color: Colors.textSecondary },
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
  messageTextCoach: { color: Colors.textOnPrimary },
  messageTime: { fontSize: 11, color: Colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  messageTimeCoach: { color: 'rgba(255,255,255,0.7)' },
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
