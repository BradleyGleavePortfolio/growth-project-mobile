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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { messagesApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { subscribeToMessages } from '../../services/realtime';
import { Colors } from '../../constants/colors';

interface Message {
  id: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  body: string;
  created_at: string;
  read_at?: string | null;
}

// Realtime now drives most refreshes. Keep a 60s safety poll as a backstop in
// case the WebSocket is dropped (background → foreground transitions, mobile
// data dead zones). Without realtime this used to be 15s.
const FALLBACK_POLL_MS = 60000;

export default function MessagesScreen() {
  const navigation = useNavigation<any>();
  const currentUser = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [noCoach, setNoCoach] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await messagesApi.list({ limit: 100 });
      setMessages(normalizeList(res.data));
      setError('');
      setNoCoach(false);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (err?.response?.status === 409 || code === 'NO_COACH_ASSIGNED') {
        setNoCoach(true);
        setMessages([]);
      } else {
        console.error('client MessagesScreen: load failed', err);
        setError('Could not load messages. Pull to retry.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async () => {
    try {
      await messagesApi.markRead();
    } catch {
      /* no-op */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then(() => markRead());

      // Realtime: subscribe to message-arrived pings so the screen refreshes
      // immediately when the coach replies. Falls back gracefully if the
      // WebSocket fails to connect.
      const unsubscribe = currentUser?.id
        ? subscribeToMessages(currentUser.id, () => {
            load().then(() => markRead());
          })
        : () => {};

      // Backstop poll — if Realtime drops we still catch up within a minute.
      pollRef.current = setInterval(() => {
        load();
      }, FALLBACK_POLL_MS);

      return () => {
        unsubscribe();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    }, [load, markRead, currentUser?.id]),
  );

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    Keyboard.dismiss();
    try {
      const res = await messagesApi.send(text);
      const created = normalizeMessage(res.data);
      setInputText('');
      setMessages((prev) => mergeById(prev, [created]));
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (err?.response?.status === 409 || code === 'NO_COACH_ASSIGNED') {
        setNoCoach(true);
      } else {
        Alert.alert('Failed to send', err?.response?.data?.message || 'Message could not be sent.');
      }
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

  if (noCoach) {
    return (
      <View style={styles.noCoachContainer}>
        <View style={styles.noCoachHeader}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.noCoachTitle}>Messages</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.noCoachBody}>
          <Ionicons name="person-add-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.noCoachHeadline}>No coach yet</Text>
          <Text style={styles.noCoachText}>
            You don't have a coach yet. Ask your coach for an invite code and use it when you sign up,
            or talk to support about linking an existing account.
          </Text>
        </View>
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
        <Text style={styles.chatHeaderName}>Your Coach</Text>
        <View style={{ width: 24 }} />
      </View>

      {error ? (
        <TouchableOpacity style={styles.errorBanner} onPress={load}>
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
              Start a conversation with your coach
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isMe = item.sender_role === 'client';
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
                  isMe ? styles.messageBubbleRowRight : styles.messageBubbleRowLeft,
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    isMe ? styles.messageBubbleMe : styles.messageBubbleCoach,
                  ]}
                >
                  <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
                    {item.body}
                  </Text>
                  <Text style={[styles.messageTime, isMe && styles.messageTimeMe]}>
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
    .sort((a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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

function mergeById(existing: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  existing.forEach((m) => map.set(m.id, m));
  incoming.forEach((m) => map.set(m.id, m));
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  noCoachContainer: { flex: 1, backgroundColor: Colors.background },
  noCoachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  noCoachTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  noCoachBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 12 },
  noCoachHeadline: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  noCoachText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
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
  chatHeaderName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  chatList: { padding: 16, paddingBottom: 8 },
  chatEmpty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  chatEmptyText: { fontSize: 14, color: Colors.textMuted },
  dateSep: { alignItems: 'center', marginVertical: 16 },
  dateSepText: { fontSize: 12, color: Colors.textMuted, backgroundColor: Colors.background, paddingHorizontal: 12 },
  messageBubbleRow: { marginBottom: 6 },
  messageBubbleRowRight: { alignItems: 'flex-end' },
  messageBubbleRowLeft: { alignItems: 'flex-start' },
  messageBubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  messageBubbleMe: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  messageBubbleCoach: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messageText: { fontSize: 15, color: Colors.textPrimary, lineHeight: 21 },
  messageTextMe: { color: Colors.textOnPrimary },
  messageTime: { fontSize: 11, color: Colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  messageTimeMe: { color: 'rgba(255,255,255,0.7)' },
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
