import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { messagesApi, profileApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { subscribeToMessages } from '../../services/realtime';
import { cacheStorage } from '../../storage/mmkv';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage, errorStatus, errorCode } from '../../types/common';

interface Message {
  id: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  body: string;
  created_at: string;
  read_at?: string | null;
  pending?: boolean;
}

// Realtime now drives most refreshes. Keep a 60s safety poll as a backstop in
// case the WebSocket is dropped (background → foreground transitions, mobile
// data dead zones). Without realtime this used to be 15s.
const FALLBACK_POLL_MS = 60000;
const CACHE_KEY = 'messages_thread_client';

export default function MessagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const textOnPrimaryDim = colors.textOnPrimary + 'B3';   // 70% opacity
  const textOnPrimaryFaint = colors.textOnPrimary + '80'; // 50% opacity
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // null = unknown (haven't loaded yet); true = at least one page returned
  // exactly the requested limit, meaning more messages may exist; false = the
  // last fetch came back short, so we've reached the start of the thread.
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [noCoach, setNoCoach] = useState(false);
  const [coachName, setCoachName] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PAGE_LIMIT = 100;

  // A. MMKV hydration on mount — synchronous read so the screen never shows
  // blank on cold load (MMKV is synchronous; shim returns undefined).
  useEffect(() => {
    const cached = cacheStorage.getString(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          setLoading(false);
        }
      } catch {
        // Corrupt cache — ignore, real load will follow.
      }
    }
  }, []);

  // B. Load real coach name from profile.
  useEffect(() => {
    profileApi.get().then((res) => {
      const profile = res?.data as Record<string, unknown> | undefined;
      const name = typeof profile?.coach_name === 'string' ? profile.coach_name : '';
      if (name) setCoachName(name);
    }).catch(() => {
      // Silent — fall back to 'Your Coach'
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await messagesApi.list({ limit: PAGE_LIMIT });
      const list = normalizeList(res.data);
      setMessages((prev) => {
        // Preserve any pending (local-only) messages that haven't been
        // replaced by a real server message yet.
        const pending = prev.filter(
          (m) => m.pending && !list.some((s) => s.body === m.body),
        );
        return mergeById(list, pending);
      });
      setHasMoreOlder(list.length >= PAGE_LIMIT);
      setError('');
      setNoCoach(false);
      // Write to MMKV cache after successful load.
      setMessages((current) => {
        cacheStorage.set(CACHE_KEY, JSON.stringify(current));
        return current;
      });
    } catch (err) {
      const code = errorCode(err);
      if (errorStatus(err) === 409 || code === 'NO_COACH_ASSIGNED') {
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

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const res = await messagesApi.list({ before: oldest.created_at, limit: PAGE_LIMIT });
      const page = normalizeList(res.data);
      if (page.length === 0) {
        setHasMoreOlder(false);
      } else {
        setMessages((prev) => mergeById(page, prev));
        setHasMoreOlder(page.length >= PAGE_LIMIT);
      }
    } catch (err) {
      console.error('client MessagesScreen: loadOlder failed', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasMoreOlder, messages]);

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
      setMessages((prev) => {
        const next = mergeById(prev, [created]);
        cacheStorage.set(CACHE_KEY, JSON.stringify(next));
        return next;
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      const code = errorCode(err);
      if (errorStatus(err) === 409 || code === 'NO_COACH_ASSIGNED') {
        setNoCoach(true);
      } else {
        // F. Offline send queue: add as local-only pending message instead of alert.
        const pendingMsg: Message = {
          id: `pending_${Date.now()}`,
          sender_role: 'client',
          body: text,
          created_at: new Date().toISOString(),
          read_at: null,
          pending: true,
        };
        setMessages((prev) => {
          const next = [...prev, pendingMsg];
          cacheStorage.set(CACHE_KEY, JSON.stringify(next));
          return next;
        });
        setInputText('');
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
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

  // E. Loading skeleton — 3 fake message rows.
  if (loading && messages.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.chatHeader}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.chatHeaderName}>
            {coachName || 'Your Coach'}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.skeletonContainer}>
          {/* Row 1 — left, 70% */}
          <View style={[styles.skeletonRow, { alignItems: 'flex-start' }]}>
            <View style={[styles.skeletonBubble, { width: '70%' }]} />
          </View>
          {/* Row 2 — right, 55% */}
          <View style={[styles.skeletonRow, { alignItems: 'flex-end' }]}>
            <View style={[styles.skeletonBubble, { width: '55%' }]} />
          </View>
          {/* Row 3 — left, 70% */}
          <View style={[styles.skeletonRow, { alignItems: 'flex-start' }]}>
            <View style={[styles.skeletonBubble, { width: '70%' }]} />
          </View>
        </View>
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
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.noCoachTitle}>Messages</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.noCoachBody}>
          <Ionicons name="person-add-outline" size={48} color={colors.textMuted} />
          <Text style={styles.noCoachHeadline}>No coach yet</Text>
          <Text style={styles.noCoachText}>
            You don't have a coach yet. Ask your coach for an invite code and use it when you sign up,
            or talk to support about linking an existing account.
          </Text>
        </View>
      </View>
    );
  }

  // Find index of last client message for "Sent" receipt logic.
  const lastClientMsgIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_role === 'client') return i;
    }
    return -1;
  })();

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
        <View style={styles.chatHeaderCenter}>
          {coachName ? (
            <View style={styles.onlineDot} />
          ) : null}
          <Text style={styles.chatHeaderName}>
            {coachName || 'Your Coach'}
          </Text>
        </View>
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
                <View style={styles.loadingOlderDot} />
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

          // C. Read receipts — only for client messages.
          let receiptNode: React.ReactNode = null;
          if (isMe) {
            if (item.pending) {
              // F. Pending indicator.
              receiptNode = (
                <View style={styles.receiptRow}>
                  <Ionicons name="time-outline" size={10} color={textOnPrimaryFaint} />
                  <Text style={styles.receiptTextPending}>Sending</Text>
                </View>
              );
            } else if (item.read_at) {
              receiptNode = (
                <View style={styles.receiptRow}>
                  <Ionicons name="checkmark-done" size={12} color={textOnPrimaryDim} />
                  <Text style={styles.receiptText}>Read</Text>
                </View>
              );
            } else if (index === lastClientMsgIdx) {
              receiptNode = (
                <View style={styles.receiptRow}>
                  <Ionicons name="checkmark" size={12} color={textOnPrimaryFaint} />
                  <Text style={styles.receiptTextPending}>Sent</Text>
                </View>
              );
            }
          }

          return (
            <View style={item.pending ? { opacity: 0.5 } : undefined}>
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
                  {receiptNode}
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
    .sort((a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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

function mergeById(existing: Message[], incoming: Message[]): Message[] {
  const map = new Map<string, Message>();
  existing.forEach((m) => map.set(m.id, m));
  incoming.forEach((m) => map.set(m.id, m));
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

const makeStyles = (colors: ThemeColors) => {
  const textOnPrimaryDim = colors.textOnPrimary + 'B3';   // 70% opacity
  const textOnPrimaryFaint = colors.textOnPrimary + '80'; // 50% opacity
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  noCoachContainer: { flex: 1, backgroundColor: colors.background },
  noCoachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  noCoachTitle: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, lineHeight: 24, letterSpacing: 0.4, fontWeight: '500', color: colors.textPrimary },
  noCoachBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 12 },
  noCoachHeadline: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, lineHeight: 26, letterSpacing: 0.4, fontWeight: '500', color: colors.textPrimary },
  noCoachText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
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
  chatHeaderCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  chatHeaderName: { fontFamily: 'Inter_500Medium', fontSize: 15, fontWeight: '500', letterSpacing: 0.2, color: colors.textPrimary },
  // E. Loading skeleton
  skeletonContainer: { flex: 1, padding: 16 },
  skeletonRow: { marginBottom: 12 },
  skeletonBubble: {
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  loadingOlderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    opacity: 0.5,
  },
  chatList: { padding: 16, paddingBottom: 8 },
  chatEmpty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  chatEmptyText: { fontSize: 14, color: colors.textMuted },
  dateSep: { alignItems: 'center', marginVertical: 16 },
  dateSepText: { fontSize: 12, color: colors.textMuted, backgroundColor: colors.background, paddingHorizontal: 12 },
  messageBubbleRow: { marginBottom: 6 },
  messageBubbleRowRight: { alignItems: 'flex-end' },
  messageBubbleRowLeft: { alignItems: 'flex-start' },
  messageBubble: { maxWidth: '78%', borderRadius: 4, paddingHorizontal: 14, paddingVertical: 10 },
  messageBubbleMe: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  messageBubbleCoach: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  messageTextMe: { color: colors.textOnPrimary },
  messageTime: { fontSize: 11, color: colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  messageTimeMe: { color: textOnPrimaryDim },
  // C. Read receipt styles
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  receiptText: {
    fontSize: 10,
    color: textOnPrimaryDim,
  },
  receiptTextPending: {
    fontSize: 10,
    color: textOnPrimaryFaint,
  },
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
    borderRadius: 2, // radius.md
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.textPrimary,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.surface },
  });
};
