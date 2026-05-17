import React, { useState, useCallback, useRef, useMemo } from 'react';
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
import { useFocusEffect, useRoute, useNavigation, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';
import { coachApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { subscribeToMessages } from '../../services/realtime';

import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';

interface Message {
  id: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  body: string;
  created_at: string;
  read_at?: string | null;
}

// Realtime drives most refreshes; this is just a backstop. Was 15s.
const FALLBACK_POLL_MS = 60000;

export default function ClientMessagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<RouteProp<ClientsStackParamList, 'ClientMessages'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { clientId, clientName, initialDraft } = route.params;
  const currentUser = useCurrentUser();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  // Coach AI v1: support a templated check-in prefill from the insight
  // screen. The composer respects this only once on mount so navigating
  // back-and-forth doesn't clobber an in-progress draft.
  const [inputText, setInputText] = useState<string>(initialDraft ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PAGE_LIMIT = 100;

  const loadInitial = useCallback(async () => {
    try {
      const res = await coachApi.getClientMessages(clientId, { limit: PAGE_LIMIT });
      const list: Message[] = normalizeList(res.data);
      setMessages(list);
      setHasMoreOlder(list.length >= PAGE_LIMIT);
      setError('');
    } catch (err) {
      console.error('ClientMessagesScreen: load failed', err);
      setError('Could not load messages. Pull to retry.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const res = await coachApi.getClientMessages(clientId, {
        before: oldest.created_at,
        limit: PAGE_LIMIT,
      });
      const page: Message[] = normalizeList(res.data);
      if (page.length === 0) {
        setHasMoreOlder(false);
      } else {
        setMessages((prev) => mergeById(page, prev));
        setHasMoreOlder(page.length >= PAGE_LIMIT);
      }
    } catch (err) {
      console.error('ClientMessagesScreen: loadOlder failed', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [clientId, loadingOlder, hasMoreOlder, messages]);

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

      // Subscribe to BOTH ends of the conversation:
      //  - the client's channel (refresh when the client posts)
      //  - the coach's own channel (refresh when their own send is mirrored
      //    back, e.g. delivered ack)
      const unsubClient = subscribeToMessages(clientId, () => {
        loadSinceNewest().then(markRead);
      });
      const unsubSelf = currentUser?.id
        ? subscribeToMessages(currentUser.id, loadSinceNewest)
        : () => {};

      pollRef.current = setInterval(loadSinceNewest, FALLBACK_POLL_MS);
      return () => {
        unsubClient();
        unsubSelf();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    }, [loadInitial, loadSinceNewest, markRead, clientId, currentUser?.id]),
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
    } catch (err) {
      Alert.alert('Failed to send', errorMessage(err, 'Message could not be sent.'));
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
        <ActivityIndicator size="large" color={colors.primary} />
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
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
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
        ListHeaderComponent={
          hasMoreOlder && messages.length > 0 ? (
            <TouchableOpacity
              onPress={loadOlder}
              disabled={loadingOlder}
              accessibilityRole="button"
              accessibilityLabel="Load older messages"
              style={{ paddingVertical: 12, alignItems: 'center' }}
            >
              {loadingOlder ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
                  Load older
                </Text>
              )}
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.chatEmpty}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
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
          placeholderTextColor={colors.textMuted}
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
            color={inputText.trim() && !sending ? colors.textOnPrimary : colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function normalizeList(raw: unknown): Message[] {
  const wrapper = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as { messages?: unknown[] })
    : null;
  const arr: unknown[] = Array.isArray(raw) ? raw : (wrapper?.messages ?? []);
  return arr
    .map(normalizeMessage)
    .filter((m: Message) => !!m.id)
    .sort(byCreatedAtAsc);
}

function normalizeMessage(raw: unknown): Message {
  const r = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  return {
    id: String(r.id ?? ''),
    sender_role: r.sender_role === 'coach' ? 'coach' : 'client',
    sender_id: typeof r.sender_id === 'string' ? r.sender_id : undefined,
    body: String(r.body ?? ''),
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    read_at: (r.read_at as string | null | undefined) ?? null,
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  errorBanner: { backgroundColor: colors.error + '22', paddingVertical: 8, paddingHorizontal: 16 },
  errorBannerText: { color: colors.error, fontSize: 13, textAlign: 'center' },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatAvatarText: { color: colors.textOnPrimary, fontSize: 13, fontWeight: '500' },
  chatHeaderName: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  chatHeaderStatus: { fontSize: 12, color: colors.textSecondary },
  chatList: { padding: 16, paddingBottom: 8 },
  chatEmpty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  chatEmptyText: { fontSize: 14, color: colors.textMuted },
  dateSep: { alignItems: 'center', marginVertical: 16 },
  dateSepText: { fontSize: 12, color: colors.textMuted, backgroundColor: colors.background, paddingHorizontal: 12 },
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
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  messageBubbleClient: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  messageTextCoach: { color: colors.textOnPrimary },
  messageTime: { fontSize: 11, color: colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  messageTimeCoach: { color: 'rgba(255,255,255,0.7)' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 36,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.surface },

  });
