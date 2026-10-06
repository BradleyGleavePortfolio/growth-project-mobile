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
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { coachApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { subscribeToMessages } from '../../services/realtime';

import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { useBlockedUsersStore, filterOutBlocked } from '../../store/blockedUsersStore';
import { useBlockedUsersHydration } from '../../hooks/useBlockedUsersHydration';
import { messagesModerationApi, ReportReason } from '../../api/messagesApi';
import MessageBubble, { BubbleMessage } from '../../components/messaging/MessageBubble';
import MessageActionSheet from '../../components/messaging/MessageActionSheet';
import ReplyComposer, { ReplyTarget } from '../../components/messaging/ReplyComposer';
import ReportMessageSheet from '../../components/messaging/ReportMessageSheet';
import { track } from '../../lib/analytics';
import { MuteBell, PinnedBar, ThreadV2Menus, jumpToMessage } from '../../components/messaging/ThreadV2Parts';
import {
  bubbleV2Fields,
  newClientMessageId,
  readThreadV2Fields,
  resolveSenderRole,
  type ThreadV2Fields,
} from '../../components/messaging/threadV2';
import { useThreadV2 } from '../../hooks/useThreadV2';
import { messagingV2Api, toMessagingError, type ThreadScope } from '../../api/messagingV2Api';

interface Message {
  id: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  body: string;
  created_at: string;
  read_at?: string | null;
  parent_message_id?: string | null;
  /** messaging v2 (flag ON); absent on legacy rows. */
  v2?: ThreadV2Fields;
}

// Realtime drives most refreshes; this is just a backstop. Was 15s.
const FALLBACK_POLL_MS = 60000;

export default function ClientMessagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<RouteProp<ClientsStackParamList, 'ClientMessages'>>();
  const navigation = useNavigation<NativeStackNavigationProp<ClientsStackParamList>>();
  const { clientId, clientName, initialDraft } = route.params;
  const currentUser = useCurrentUser();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [inputText, setInputText] = useState<string>(initialDraft ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // iMessage-grade action state.
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [muteMenu, setMuteMenu] = useState(false);
  // v2 idempotent send: a failed send keeps its device key for the same text,
  // so tapping Send again replays it and can never post a duplicate.
  const unsentRef = useRef<{ text: string; key: string } | null>(null);

  const blockStore = useBlockedUsersStore();
  const blockedIds = useMemo(() => blockStore.blocked.map((b) => b.id), [blockStore.blocked]);

  // Hydrate the block store: local MMKV first (instant paint) then layer
  // GET /users/blocks on top so blocks made on another device or after a
  // cache wipe still filter the DM list before the user opens Settings.
  // `serverHydrationComplete` gates the message list render — until the
  // server block list arrives, a sender blocked on another device could
  // otherwise flash through. Fails open on API failure.
  const { serverHydrationComplete } = useBlockedUsersHydration(currentUser?.id);

  const PAGE_LIMIT = 100;

  const loadInitial = useCallback(async (): Promise<Message[]> => {
    try {
      const res = await coachApi.getClientMessages(clientId, { limit: PAGE_LIMIT });
      const list: Message[] = normalizeList(res.data, clientId);
      setMessages(list);
      setHasMoreOlder(list.length >= PAGE_LIMIT);
      setError('');
      return list;
    } catch (err) {
      console.error('ClientMessagesScreen: load failed', err);
      setError('Could not load messages. Pull to retry.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const scope: ThreadScope = useMemo(() => ({ role: 'coach', clientId }), [clientId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const res = await coachApi.getClientMessages(clientId, {
        before: oldest.created_at,
        limit: PAGE_LIMIT,
      });
      const page: Message[] = normalizeList(res.data, clientId);
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

  const loadSinceNewest = useCallback(async (): Promise<Message[]> => {
    try {
      const res = await coachApi.getClientMessages(clientId, { limit: 100 });
      const list: Message[] = normalizeList(res.data, clientId);
      setMessages((prev) => mergeById(prev, list));
      return list;
    } catch {
      /* silent — poll retries next tick */
      return [];
    }
  }, [clientId]);

  const onThreadChanged = useCallback(() => {
    void loadSinceNewest();
  }, [loadSinceNewest]);
  const thread = useThreadV2(scope, onThreadChanged);

  // v2: read up to the newest client message in the page just fetched, so a
  // message that lands after the fetch is never marked read unseen.
  const markRead = useCallback(async (list?: Message[]) => {
    try {
      if (thread.enabled) {
        const lastIncoming = [...(list ?? [])].reverse().find((m) => m.sender_role === 'client');
        if (!lastIncoming) return;
        await messagingV2Api.markReadUpTo(scope, lastIncoming.id);
      } else {
        await coachApi.markClientThreadRead(clientId);
      }
    } catch {
      /* no-op */
    }
  }, [clientId, scope, thread.enabled]);

  useFocusEffect(
    useCallback(() => {
      loadInitial().then(markRead);

      const unsubClient = subscribeToMessages(clientId, () => {
        loadSinceNewest().then(markRead);
      });
      // A client message lands on the coach's own channel: it is on screen,
      // so it is read (AUDIT-03-125 U1; was a refetch that left it unread).
      const refetchAndRead = () => {
        void loadSinceNewest().then(markRead);
      };
      const unsubSelf = currentUser?.id
        ? subscribeToMessages(
            currentUser.id,
            refetchAndRead,
            thread.enabled
              ? (ping) => {
                  // The backend's public-channel ping carries no ids, so every
                  // ping refreshes this thread; an older ID-bearing ping for a
                  // different client is skipped.
                  if (ping.threadClientId !== null && ping.threadClientId !== clientId) return;
                  void loadSinceNewest();
                  void thread.refresh();
                }
              : undefined,
          )
        : () => {};

      pollRef.current = setInterval(refetchAndRead, FALLBACK_POLL_MS);
      return () => {
        unsubClient();
        unsubSelf();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadInitial, loadSinceNewest, markRead, clientId, currentUser?.id, thread.enabled]),
  );

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    Keyboard.dismiss();
    if (thread.enabled) {
      const key = unsentRef.current?.text === text ? unsentRef.current.key : newClientMessageId();
      try {
        const row = await messagingV2Api.sendMessage(scope, { body: text, clientMessageId: key, replyToId: replyTarget?.id ?? null });
        unsentRef.current = null;
        setInputText('');
        setReplyTarget(null);
        setMessages((prev) => mergeById(prev, [normalizeMessage(row, clientId)]));
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      } catch (err) {
        const e = toMessagingError(err);
        if (e.kind === 'contract') {
          // 2xx with a shape this build does not read: the server took the
          // message, so never offer a resend; refetch the thread instead.
          unsentRef.current = null;
          setInputText('');
          setReplyTarget(null);
          void loadSinceNewest();
        } else {
          if (e.kind === 'network' || e.status >= 500 || e.status === 429) unsentRef.current = { text, key };
          thread.report('Message not sent', err);
        }
      } finally {
        setSending(false);
      }
      return;
    }
    try {
      const res = await coachApi.sendClientMessage(clientId, text);
      const created: Message = normalizeMessage(res.data, clientId);
      if (replyTarget) {
        // The legacy coach send endpoint doesn't carry parent_message_id yet,
        // so the parent is captured locally on the message until the backend
        // adds the field (same Apple-1.2 backend ticket).
        created.parent_message_id = replyTarget.id;
      }
      setInputText('');
      setReplyTarget(null);
      setMessages((prev) => mergeById(prev, [created]));
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      Alert.alert('Failed to send', errorMessage(err, 'Message could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  const handleLongPress = useCallback((m: BubbleMessage) => {
    const found = messages.find((x) => x.id === m.id);
    setActionTarget(found ?? null);
  }, [messages]);

  const handleReply = useCallback(() => {
    if (!actionTarget) return;
    setReplyTarget({
      id: actionTarget.id,
      body: actionTarget.body,
      authorLabel: actionTarget.sender_role === 'coach' ? 'You' : clientName,
    });
    setActionTarget(null);
  }, [actionTarget, clientName]);

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
      track('dm_message_reported', { reason: payload.reason, surface: 'coach' });
      setReportTarget(null);
      Alert.alert(
        'Reported',
        'The safety team reviews reports within 24 hours. Thank you for keeping the community safe.',
      );
    },
    [reportTarget],
  );

  const visibleMessages = useMemo(
    () => filterOutBlocked(messages, blockedIds),
    [messages, blockedIds],
  );

  const parentLookup = new Map<string, Message>();
  visibleMessages.forEach((m) => parentLookup.set(m.id, m));

  // Block the message list render until messages have loaded AND the initial
  // server block-list hydration has resolved. Without the second gate, a
  // sender blocked on another device could appear briefly between the
  // messages payload landing and GET /users/blocks resolving.
  if (loading || !serverHydrationComplete) {
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
        <TouchableOpacity
          onPress={() => {
            navigation.navigate('ContactView', {
              contactId: clientId,
              displayName: clientName,
              role: 'client',
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={`View ${clientName} contact details`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.chatHeaderInfo}
        >
          <View style={styles.chatAvatar}>
            <Text style={styles.chatAvatarText}>
              {clientName.split(' ').map((n) => n[0]).join('')}
            </Text>
          </View>
          <View>
            <Text style={styles.chatHeaderName}>{clientName}</Text>
            <Text style={styles.chatHeaderStatus}>Client · Tap for details</Text>
          </View>
        </TouchableOpacity>
        {thread.enabled ? <MuteBell muted={thread.muted} onPress={() => setMuteMenu(true)} /> : <View style={{ width: 24 }} />}
      </View>

      {thread.enabled ? (
        <PinnedBar pins={thread.pins} onOpen={(id) => jumpToMessage(flatListRef.current, visibleMessages, id)} />
      ) : null}

      {error ? (
        <TouchableOpacity style={styles.errorBanner} onPress={loadInitial}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </TouchableOpacity>
      ) : null}

      <FlatList
        ref={flatListRef}
        data={visibleMessages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.chatList}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        onScrollToIndexFailed={({ averageItemLength, index }) =>
          flatListRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true })
        }
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
              new Date(visibleMessages[index - 1].created_at).toDateString();

          const parent =
            item.parent_message_id ? parentLookup.get(item.parent_message_id) : null;

          const bubbleMsg: BubbleMessage = {
            id: item.id,
            body: item.body,
            created_at: item.created_at,
            read_at: item.read_at,
            ...bubbleV2Fields(item.v2, clientId, parent),
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
                isMe={isCoach}
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

      {thread.enabled ? (
        <ThreadV2Menus
          thread={thread}
          target={actionTarget}
          isMine={!!currentUser?.id && actionTarget?.sender_id === currentUser.id}
          onClose={() => setActionTarget(null)}
          onReply={handleReply}
          onCopy={() => void handleCopy()}
          onReport={handleOpenReport}
          muteOpen={muteMenu}
          onMuteClose={() => setMuteMenu(false)}
        />
      ) : (
        <MessageActionSheet
          visible={!!actionTarget}
          messagePreview={actionTarget?.body}
          onReply={handleReply}
          onCopy={handleCopy}
          onReport={handleOpenReport}
          onClose={() => setActionTarget(null)}
          canReport={!!actionTarget && actionTarget.sender_role !== 'coach'}
          canReply={false}
        />
      )}

      <ReportMessageSheet
        visible={!!reportTarget}
        messagePreview={reportTarget?.body ?? ''}
        onSubmit={handleSubmitReport}
        onClose={() => setReportTarget(null)}
      />
    </KeyboardAvoidingView>
  );
}

function normalizeList(raw: unknown, clientId: string): Message[] {
  const wrapper = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as { messages?: unknown[] })
    : null;
  const arr: unknown[] = Array.isArray(raw) ? raw : (wrapper?.messages ?? []);
  return arr
    .map((r) => normalizeMessage(r, clientId))
    .filter((m: Message) => !!m.id)
    .sort(byCreatedAtAsc);
}

export function normalizeMessage(raw: unknown, clientId: string): Message {
  const r = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  return {
    id: String(r.id ?? ''),
    // The thread routes carry sender_id, not sender_role: anything not sent
    // by the client is the coach side (head coach or a teammate).
    sender_role: resolveSenderRole(r, clientId, 'client'),
    sender_id: typeof r.sender_id === 'string' ? r.sender_id : undefined,
    body: String(r.body ?? ''),
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    read_at: (r.read_at as string | null | undefined) ?? null,
    parent_message_id: typeof r.parent_message_id === 'string' ? r.parent_message_id : null,
    v2: readThreadV2Fields(r),
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
