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
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MoreStackParamList } from '../../navigation/ClientNavigator';
import { messagesApi, profileApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { subscribeToMessages } from '../../services/realtime';
import { cacheStorage } from '../../storage/mmkv';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorStatus, errorCode } from '../../types/common';
import { useBlockedUsersStore, filterOutBlocked } from '../../store/blockedUsersStore';
import { useBlockedUsersHydration } from '../../hooks/useBlockedUsersHydration';
import { messagesModerationApi, ReportReason } from '../../api/messagesApi';
import MessageBubble, { BubbleMessage } from '../../components/messaging/MessageBubble';
import MessageActionSheet from '../../components/messaging/MessageActionSheet';
import ReplyComposer, { ReplyTarget } from '../../components/messaging/ReplyComposer';
import ReportMessageSheet from '../../components/messaging/ReportMessageSheet';
import CompetencePill from '../../components/roman/CompetencePill';
import { featureFlags } from '../../config/featureFlags';
import { track } from '../../lib/analytics';

interface Message {
  id: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  body: string;
  created_at: string;
  read_at?: string | null;
  pending?: boolean;
  parent_message_id?: string | null;
}

// Realtime now drives most refreshes. Keep a 60s safety poll as a backstop in
// case the WebSocket is dropped (background → foreground transitions, mobile
// data dead zones). Without realtime this used to be 15s.
const FALLBACK_POLL_MS = 60000;
// Per-user cache key — see Hunt #2 P0-1 (cross-account thread leak).
export const CACHE_KEY_PREFIX = 'messages_thread_client_';
export function cacheKeyFor(userId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}`;
}

export default function MessagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const textOnPrimaryDim = colors.textOnPrimary + 'B3';
  const textOnPrimaryFaint = colors.textOnPrimary + '80';
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>();
  const currentUser = useCurrentUser();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [noCoach, setNoCoach] = useState(false);
  const [coachName, setCoachName] = useState('');
  const [coachId, setCoachId] = useState('');
  // ED.6 — timestamp of the coach's most-recent review of THIS thread, feeding
  // the CompetencePill at the top of the conversation. Null hides the pill
  // (no review yet, or the backend FEATURE_ROMAN_COACH_REVIEWED_AT flag is OFF).
  // Only fetched when the mobile flag is on, so the network call never fires in
  // the default-OFF state.
  const [coachReviewedAt, setCoachReviewedAt] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // iMessage-grade action state.
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);

  const blockStore = useBlockedUsersStore();
  const blockedIds = useMemo(() => blockStore.blocked.map((b) => b.id), [blockStore.blocked]);

  const PAGE_LIMIT = 100;

  // Hydrate the block store: local MMKV first (instant paint) then layer
  // GET /users/blocks on top so blocks made on another device or after a
  // cache wipe still filter the DM list before the user opens Settings.
  // `serverHydrationComplete` gates the message list render — until the
  // server block list arrives, a sender blocked on another device could
  // otherwise flash through. Fails open on API failure.
  const { serverHydrationComplete } = useBlockedUsersHydration(currentUser?.id);

  useEffect(() => {
    if (!currentUser?.id) return;
    const cached = cacheStorage.getString(cacheKeyFor(currentUser.id));
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          setLoading(false);
        }
      } catch {
        // Corrupt cache — ignore.
      }
    }
  }, [currentUser?.id]);

  useEffect(() => {
    profileApi.get().then((res) => {
      const profile = res?.data as Record<string, unknown> | undefined;
      const name = typeof profile?.coach_name === 'string' ? profile.coach_name : '';
      const id = typeof profile?.coach_id === 'string' ? profile.coach_id : '';
      if (name) setCoachName(name);
      if (id) setCoachId(id);
    }).catch(() => {
      /* silent — fall back to 'Your Coach' */
    });
  }, []);

  // ED.6 — refresh the thread coach-review timestamp. Gated by the mobile flag
  // so no request is made while the feature is OFF; fails open (leaves the pill
  // hidden) so a marker fetch error never degrades the thread.
  const loadCoachReview = useCallback(async () => {
    if (!featureFlags.romanCompetencePill) return;
    try {
      const res = await messagesApi.coachReview();
      setCoachReviewedAt(res.data?.coachReviewedAt ?? null);
    } catch {
      setCoachReviewedAt(null);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await messagesApi.list({ limit: PAGE_LIMIT });
      const list = normalizeList(res.data);
      setMessages((prev) => mergeById(list, reconcilePending(prev, list)));
      setHasMoreOlder(list.length >= PAGE_LIMIT);
      setError('');
      setNoCoach(false);
      void loadCoachReview();
      const uid = currentUser?.id;
      if (uid) {
        setMessages((current) => {
          cacheStorage.set(cacheKeyFor(uid), JSON.stringify(current));
          return current;
        });
      }
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
  }, [currentUser?.id, loadCoachReview]);

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

      const unsubscribe = currentUser?.id
        ? subscribeToMessages(currentUser.id, () => {
            load().then(() => markRead());
          })
        : () => {};

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
    const reply = replyTarget;
    try {
      let created: Message;
      if (reply) {
        // Reply path — pass parent_message_id so backend can record the thread
        // once the field is wired through. Until then we keep the parent
        // reference locally so the bubble renders the quoted preview.
        const res = await messagesModerationApi.sendReply({
          body: text,
          parent_message_id: reply.id,
        });
        created = {
          id: res.id,
          sender_role: res.sender_role,
          sender_id: res.sender_id,
          body: res.body,
          created_at: res.created_at,
          read_at: null,
          parent_message_id: res.parent_message_id ?? reply.id,
        };
      } else {
        const res = await messagesApi.send(text);
        created = normalizeMessage(res.data);
      }
      setInputText('');
      setReplyTarget(null);
      const uid = currentUser?.id;
      setMessages((prev) => {
        const next = mergeById(prev, [created]);
        if (uid) cacheStorage.set(cacheKeyFor(uid), JSON.stringify(next));
        return next;
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      const code = errorCode(err);
      if (errorStatus(err) === 409 || code === 'NO_COACH_ASSIGNED') {
        setNoCoach(true);
      } else {
        const pendingMsg: Message = {
          id: `pending_${Date.now()}`,
          sender_role: 'client',
          body: text,
          created_at: new Date().toISOString(),
          read_at: null,
          pending: true,
          parent_message_id: reply?.id ?? null,
        };
        const uid = currentUser?.id;
        setMessages((prev) => {
          const next = [...prev, pendingMsg];
          if (uid) cacheStorage.set(cacheKeyFor(uid), JSON.stringify(next));
          return next;
        });
        setInputText('');
        setReplyTarget(null);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      }
    } finally {
      setSending(false);
    }
  };

  // ─── Long-press action handlers ────────────────────────────────────────────
  const handleLongPress = useCallback((m: BubbleMessage) => {
    const found = messages.find((x) => x.id === m.id);
    setActionTarget(found ?? null);
  }, [messages]);

  const handleReply = useCallback(() => {
    if (!actionTarget) return;
    setReplyTarget({
      id: actionTarget.id,
      body: actionTarget.body,
      authorLabel:
        actionTarget.sender_role === 'coach'
          ? coachName || 'Your Coach'
          : 'You',
    });
    setActionTarget(null);
  }, [actionTarget, coachName]);

  const handleCopy = useCallback(async () => {
    if (!actionTarget) return;
    try {
      await Clipboard.setStringAsync(actionTarget.body);
    } catch {
      /* non-fatal */
    }
    setActionTarget(null);
  }, [actionTarget]);

  const handleOpenReport = useCallback(() => {
    if (!actionTarget) return;
    setReportTarget(actionTarget);
    setActionTarget(null);
  }, [actionTarget]);

  const handleSubmitReport = useCallback(
    async (payload: { reason: ReportReason; details?: string }) => {
      if (!reportTarget) return;
      await messagesModerationApi.report(reportTarget.id, payload);
      track('dm_message_reported', { reason: payload.reason });
      setReportTarget(null);
      Alert.alert(
        'Reported',
        'Our team will review within 24 hours. Thanks for keeping the community safe.',
      );
    },
    [reportTarget],
  );

  const openContactView = useCallback(() => {
    if (!coachId) return;
    navigation.navigate('ContactView', {
      contactId: coachId,
      displayName: coachName || 'Your Coach',
      role: 'coach',
    });
  }, [navigation, coachId, coachName]);

  // Defence-in-depth filter — strip blocked senders before render.
  const visibleMessages = useMemo(
    () => filterOutBlocked(messages, blockedIds),
    [messages, blockedIds],
  );

  // Render skeleton while messages are loading OR while we are still waiting
  // on the initial server block-list hydration. The latter is critical: if we
  // rendered cached messages before GET /users/blocks resolved, a user blocked
  // on another device could briefly appear before being filtered out.
  if ((loading && visibleMessages.length === 0) || !serverHydrationComplete) {
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
          <Text style={styles.chatHeaderName}>{coachName || 'Your Coach'}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.skeletonContainer}>
          <View style={[styles.skeletonRow, { alignItems: 'flex-start' }]}>
            <View style={[styles.skeletonBubble, { width: '70%' }]} />
          </View>
          <View style={[styles.skeletonRow, { alignItems: 'flex-end' }]}>
            <View style={[styles.skeletonBubble, { width: '55%' }]} />
          </View>
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

  const lastClientMsgIdx = (() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].sender_role === 'client') return i;
    }
    return -1;
  })();

  const parentLookup = new Map<string, Message>();
  visibleMessages.forEach((m) => parentLookup.set(m.id, m));

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
        <TouchableOpacity
          onPress={openContactView}
          accessibilityRole="button"
          accessibilityLabel={`View ${coachName || 'coach'} contact details`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.chatHeaderCenter}
        >
          {coachName ? <View style={styles.onlineDot} /> : null}
          <Text style={styles.chatHeaderName}>{coachName || 'Your Coach'}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      {error ? (
        <TouchableOpacity style={styles.errorBanner} onPress={load}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </TouchableOpacity>
      ) : null}

      {/* ED.6 — coach-is-watching micro-signal at the top of the thread. Gated
          by the mobile flag; the pill itself renders nothing when
          coachReviewedAt is null, so it stays hidden until a coach has actually
          reviewed the thread (and the backend flag has stamped a timestamp). */}
      {featureFlags.romanCompetencePill && !noCoach ? (
        <CompetencePill
          reviewedAt={coachReviewedAt}
          surface="thread"
          placement="top"
          testID="thread-competence-pill"
        />
      ) : null}

      <FlatList
        ref={flatListRef}
        data={visibleMessages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          hasMoreOlder && visibleMessages.length > 0 ? (
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
            <Text style={styles.chatEmptyText}>Start a conversation with your coach</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isMe = item.sender_role === 'client';
          const showDateSep =
            index === 0 ||
            new Date(item.created_at).toDateString() !==
              new Date(visibleMessages[index - 1].created_at).toDateString();

          let receiptNode: React.ReactNode = null;
          if (isMe) {
            if (item.pending) {
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

          const parent =
            item.parent_message_id ? parentLookup.get(item.parent_message_id) : null;

          const bubbleMsg: BubbleMessage = {
            id: item.id,
            body: item.body,
            created_at: item.created_at,
            pending: item.pending,
            read_at: item.read_at,
            parent: parent
              ? { id: parent.id, body: parent.body, sender_role: parent.sender_role }
              : null,
          };

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
              <MessageBubble
                message={bubbleMsg}
                isMe={isMe}
                receipt={receiptNode}
                onLongPress={handleLongPress}
              />
            </View>
          );
        }}
      />

      <ReplyComposer target={replyTarget} onCancel={() => setReplyTarget(null)} />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.chatInput}
          placeholder={replyTarget ? 'Reply…' : 'Type a message...'}
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

      <MessageActionSheet
        visible={!!actionTarget}
        messagePreview={actionTarget?.body}
        onReply={handleReply}
        onCopy={handleCopy}
        onReport={handleOpenReport}
        onClose={() => setActionTarget(null)}
        canReport={!!actionTarget && actionTarget.sender_role !== 'client'}
      />

      <ReportMessageSheet
        visible={!!reportTarget}
        messagePreview={reportTarget?.body ?? ''}
        onSubmit={handleSubmitReport}
        onClose={() => setReportTarget(null)}
      />
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
    parent_message_id: typeof r.parent_message_id === 'string' ? r.parent_message_id : null,
  };
}

export function reconcilePending(prev: Message[], serverList: Message[]): Message[] {
  const oldestServerTs = serverList.length > 0
    ? new Date(serverList[0].created_at).getTime()
    : null;
  return prev.filter((m) => {
    if (!m.pending) return false;
    if (serverList.some((s) => s.body === m.body)) return false;
    if (oldestServerTs !== null) {
      const pendingTs = new Date(m.created_at).getTime();
      if (Number.isFinite(pendingTs) && pendingTs < oldestServerTs) {
        return false;
      }
    }
    return true;
  });
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
  const textOnPrimaryDim = colors.textOnPrimary + 'B3';
  const textOnPrimaryFaint = colors.textOnPrimary + '80';
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
    borderRadius: 2,
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
    borderRadius: 4,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.surface },
  });
};
