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
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../../navigation/ClientNavigator';
import { messagesApi, profileApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import CoachCodeSheet from '../../components/coachless/CoachCodeSheet';
import { subscribeToMessages } from '../../services/realtime';
import { cacheStorage } from '../../storage/mmkv';
import { useThreadColors, type ThreadColors } from '../../components/messaging/thread/useThreadColors';
import { typography, radius, layout } from '../../theme/tokens';
import { useScreenInsets } from '../../ui';
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
  pending?: boolean;
  parent_message_id?: string | null;
  /** messaging v2 (flag ON); absent on legacy rows. */
  v2?: ThreadV2Fields;
}

const CLIENT_SCOPE: ThreadScope = { role: 'client' };

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
  const colors = useThreadColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The Screen wrapper's inset top (insets.top + 12), applied to the thread
  // headers so the surface band runs up under the status bar on both platforms.
  const insets = useScreenInsets();
  const headerTop = { paddingTop: insets.top + layout.statusBarGap };
  const textOnPrimaryDim = colors.textMuted;
  const textOnPrimaryFaint = colors.textMuted;
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'Messages'>>();
  const currentUser = useCurrentUser();
  const { flags } = useFeatureFlags();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean>(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [noCoach, setNoCoach] = useState(false);
  const [showCoachCode, setShowCoachCode] = useState(false);
  useEffect(() => {
    if (!route.params?.openCoachCode) return;
    setShowCoachCode(true);
    navigation.setParams({ openCoachCode: undefined });
  }, [route.params?.openCoachCode, navigation]);
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
  const [muteMenu, setMuteMenu] = useState(false);

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

  const load = useCallback(async (): Promise<Message[]> => {
    try {
      const res = await messagesApi.list({ limit: PAGE_LIMIT });
      const list = normalizeList(res.data, currentUser?.id);
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
      return list;
    } catch (err) {
      const code = errorCode(err);
      if (errorStatus(err) === 409 || code === 'NO_COACH_ASSIGNED') {
        setNoCoach(true);
        setMessages([]);
      } else {
        console.error('client MessagesScreen: load failed', err);
        setError('Messages could not be loaded. Tap to try again.');
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, loadCoachReview]);

  const onThreadChanged = useCallback(() => {
    void load();
  }, [load]);
  const thread = useThreadV2(noCoach ? null : CLIENT_SCOPE, onThreadChanged);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const res = await messagesApi.list({ before: oldest.created_at, limit: PAGE_LIMIT });
      const page = normalizeList(res.data, currentUser?.id);
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
  }, [loadingOlder, hasMoreOlder, messages, currentUser?.id]);

  // v2: read up to the newest coach message actually loaded, so a message
  // that lands after this fetch is never marked read unseen.
  const markRead = useCallback(async (list?: Message[]) => {
    try {
      if (thread.enabled) {
        const lastIncoming = [...(list ?? [])].reverse().find((m) => m.sender_role === 'coach' && !m.pending);
        if (list && !lastIncoming) return;
        await messagingV2Api.markReadUpTo(CLIENT_SCOPE, lastIncoming?.id ?? null);
      } else {
        await messagesApi.markRead();
      }
    } catch {
      /* no-op */
    }
  }, [thread.enabled]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().then((list) => markRead(list));

      const unsubscribe = currentUser?.id
        ? subscribeToMessages(
            currentUser.id,
            () => {
              load().then((list) => markRead(list));
            },
            thread.enabled
              ? () => {
                  void load();
                  void thread.refresh();
                }
              : undefined,
          )
        : () => {};

      pollRef.current = setInterval(() => {
        load();
      }, FALLBACK_POLL_MS);

      return () => {
        unsubscribe();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, markRead, currentUser?.id, thread.enabled]),
  );

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    Keyboard.dismiss();
    const reply = replyTarget;
    if (thread.enabled) {
      await sendV2(text, newClientMessageId(), reply?.id ?? null);
      setSending(false);
      return;
    }
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
        created = normalizeMessage(res.data, currentUser?.id);
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

  // v2 idempotent send: the device key is kept on a failed (pending) bubble,
  // so "Send again" replays the same key and can never post a duplicate.
  const sendV2 = async (text: string, key: string, replyToId: string | null, pendingId?: string) => {
    const uid = currentUser?.id;
    const persist = (next: Message[]) => {
      if (uid) cacheStorage.set(cacheKeyFor(uid), JSON.stringify(next));
      return next;
    };
    try {
      const row = await messagingV2Api.sendMessage(CLIENT_SCOPE, { body: text, clientMessageId: key, replyToId });
      const created = normalizeMessage(row, uid);
      setInputText((t) => (pendingId ? t : ''));
      if (!pendingId) setReplyTarget(null);
      setMessages((prev) => persist(mergeById(prev.filter((m) => m.id !== pendingId), [created])));
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      const e = toMessagingError(err);
      if (e.code === 'NO_COACH_ASSIGNED') {
        setNoCoach(true);
      } else if (e.kind === 'contract') {
        // 2xx with a shape this build does not read: the server took the
        // message, so never offer a resend; refetch the thread instead.
        if (pendingId) setMessages((prev) => persist(prev.filter((m) => m.id !== pendingId)));
        else {
          setInputText('');
          setReplyTarget(null);
        }
        void load();
      } else if (e.kind === 'network' || e.status >= 500 || e.status === 429) {
        if (pendingId) {
          Alert.alert('Message not sent', e.userMessage);
          return;
        }
        const pendingMsg = normalizeMessage({ id: `pending_${key}`, sender_id: uid, sender_role: 'client', body: text, client_message_id: key }, uid);
        setMessages((prev) => persist([...prev, { ...pendingMsg, pending: true, parent_message_id: replyToId }]));
        setInputText('');
        setReplyTarget(null);
      } else {
        // Refused for a reason the user can act on (blocked, quote gone, ...):
        // keep the typed text so nothing is lost.
        thread.report('Message not sent', err);
      }
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
        'Your report has been submitted.',
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

  // Keep the sheet mounted while the thread reloads so its welcome and next
  // step remain visible after the existing sheet connects the account.
  const coachCodeSheet = showCoachCode ? (
    <CoachCodeSheet
      key="coach-code-sheet"
      visible
      onClose={() => setShowCoachCode(false)}
      onAttached={(result) => {
        setCoachName(result.coach.name);
        setCoachId(result.coach.id);
        void load();
      }}
      onChoosePlan={() => navigation.getParent()?.navigate('MoreTab', { screen: 'ClientPackages' })}
      onMessageCoach={() => void load()}
    />
  ) : null;

  // Render skeleton while messages are loading OR while we are still waiting
  // on the initial server block-list hydration. The latter is critical: if we
  // rendered cached messages before GET /users/blocks resolved, a user blocked
  // on another device could briefly appear before being filtered out.
  if ((loading && visibleMessages.length === 0) || !serverHydrationComplete) {
    return (
      <>
      <View style={styles.container}>
        <View style={[styles.chatHeader, headerTop]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.chatHeaderName}>Messages</Text>
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
      {coachCodeSheet}
      </>
    );
  }

  if (noCoach) {
    return (
      <>
      <View style={styles.noCoachContainer}>
        <View style={[styles.noCoachHeader, headerTop]}>
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
          <Text style={styles.noCoachHeadline}>No coach connected</Text>
          {/* Owner 2026-10-01 13:28: a client without a coach is a complete
              state. This screen says what is missing and offers a working
              next step instead of a sign-up-time instruction. */}
          <Text style={styles.noCoachText}>
            {flags.coachless_home
              ? 'Enter a coach code to connect and start messaging. Need help finding a coach? Contact support.'
              : 'You are not connected to a coach yet, so there is no one to message here. Contact support for help finding a coach.'}
          </Text>
          {flags.coachless_home && (
            <TouchableOpacity
              onPress={() => setShowCoachCode(true)}
              accessibilityRole="button"
              accessibilityLabel="Enter a coach code"
              testID="messages-no-coach-code"
              style={[styles.noCoachAction, styles.noCoachPrimary]}
            >
              <Text style={[styles.noCoachActionText, styles.noCoachPrimaryText]}>Enter a coach code</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => navigation.getParent()?.navigate('MoreTab', { screen: 'SupportInbox' })}
            accessibilityRole="button"
            accessibilityLabel="Contact support"
            testID="messages-no-coach-support"
            style={[styles.noCoachAction, flags.coachless_home ? undefined : styles.noCoachPrimary]}
          >
            <Text style={[styles.noCoachActionText, !flags.coachless_home && styles.noCoachPrimaryText]}>Contact support</Text>
          </TouchableOpacity>
        </View>
      </View>
      {coachCodeSheet}
      </>
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
    <>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.chatHeader, headerTop]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={openContactView}
          disabled={!coachId}
          accessibilityRole={coachId ? 'button' : undefined}
          accessibilityState={{ disabled: !coachId }}
          accessibilityLabel={coachId ? `View ${coachName || 'coach'} contact details` : coachName || 'Your Coach'}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.chatHeaderCenter}
        >
          <Text style={styles.chatHeaderName}>{coachName || 'Your Coach'}</Text>
          {coachId ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
        </TouchableOpacity>
        {thread.enabled ? <MuteBell muted={thread.muted} onPress={() => setMuteMenu(true)} /> : <View style={{ width: 24 }} />}
      </View>

      {thread.enabled ? (
        <PinnedBar pins={thread.pins} onOpen={(id) => jumpToMessage(flatListRef.current, visibleMessages, id)} />
      ) : null}

      {error ? (
        <TouchableOpacity style={styles.errorBanner} onPress={load} accessibilityRole="button" accessibilityLabel="Retry loading messages">
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
              style={{ minHeight: 44, paddingVertical: 12, alignItems: 'center' }}
            >
              {loadingOlder ? (
                <View style={styles.loadingOlderDot} />
              ) : (
                <Text style={{ ...typography.bodySmall, color: colors.primaryText, fontSize: 13 }}>
                  Load older
                </Text>
              )}
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          !error ? <View style={styles.chatEmpty}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
            <Text style={styles.chatEmptyText}>Start a conversation with your coach</Text>
          </View> : null
        }
        renderItem={({ item, index }) => {
          const isMe = item.sender_role === 'client';
          const next = visibleMessages[index + 1];
          const showTimestamp = !next || next.sender_role !== item.sender_role ||
            new Date(next.created_at).toDateString() !== new Date(item.created_at).toDateString() ||
            new Date(next.created_at).getTime() - new Date(item.created_at).getTime() > 5 * 60 * 1000;
          const showDateSep =
            index === 0 ||
            new Date(item.created_at).toDateString() !==
              new Date(visibleMessages[index - 1].created_at).toDateString();

          let receiptNode: React.ReactNode = null;
          if (isMe) {
            if (item.pending && item.v2?.client_message_id) {
              // v2: a pending bubble is a send that failed; it waits for the
              // user (long press, Send again with the same key).
              receiptNode = (
                <View style={styles.receiptRow}>
                  <Ionicons name="alert-circle-outline" size={11} color={textOnPrimaryDim} />
                  <Text style={styles.receiptText}>Not sent. Long press to send again</Text>
                </View>
              );
            } else if (item.pending) {
              receiptNode = (
                <View style={styles.receiptRow}>
                  <Ionicons name="time-outline" size={10} color={textOnPrimaryFaint} />
                  <Text style={styles.receiptTextPending}>Not sent</Text>
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
            ...bubbleV2Fields(item.v2, currentUser?.id, parent),
          };

          return (
            <View>
              {showDateSep && (
                <View style={styles.dateSep}>
                  <View style={styles.dateLine} />
                  <Text style={styles.dateSepText}>
                    {new Date(item.created_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                  <View style={styles.dateLine} />
                </View>
              )}
              <MessageBubble
                message={bubbleMsg}
                isMe={isMe}
                receipt={receiptNode}
                showTimestamp={showTimestamp}
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
          accessibilityState={{ disabled: !inputText.trim() || sending, busy: sending }}
        >
          <Ionicons
            name="send-outline"
            size={20}
            color={inputText.trim() && !sending ? colors.textOnPrimary : colors.textOnDisabled}
          />
        </TouchableOpacity>
      </View>

      {thread.enabled ? (
        <ThreadV2Menus
          thread={thread}
          target={actionTarget}
          isMine={actionTarget?.sender_role === 'client'}
          onClose={() => setActionTarget(null)}
          onReply={handleReply}
          onCopy={() => void handleCopy()}
          onReport={handleOpenReport}
          onRetry={(m) => {
            const key = m.v2?.client_message_id;
            if (key) void sendV2(m.body, key, actionTarget?.parent_message_id ?? null, m.id);
          }}
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
          canReport={!!actionTarget && actionTarget.sender_role !== 'client'}
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
    {coachCodeSheet}
    </>
  );
}

function normalizeList(raw: unknown, selfId?: string): Message[] {
  const wrapper = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as { messages?: unknown[] })
    : null;
  const arr: unknown[] = Array.isArray(raw) ? raw : (wrapper?.messages ?? []);
  return arr
    .map((r) => normalizeMessage(r, selfId))
    .filter((m: Message) => !!m.id)
    .sort((a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function normalizeMessage(raw: unknown, selfId?: string): Message {
  const r = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  return {
    id: String(r.id ?? ''),
    // The thread routes carry sender_id, not sender_role: the side comes from
    // sender_id against the signed-in client.
    sender_role: resolveSenderRole(r, selfId, 'client'),
    sender_id: typeof r.sender_id === 'string' ? r.sender_id : undefined,
    body: String(r.body ?? ''),
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    read_at: (r.read_at as string | null | undefined) ?? null,
    parent_message_id: typeof r.parent_message_id === 'string' ? r.parent_message_id : null,
    v2: readThreadV2Fields(r),
  };
}

export function reconcilePending(prev: Message[], serverList: Message[]): Message[] {
  const oldestServerTs = serverList.length > 0
    ? new Date(serverList[0].created_at).getTime()
    : null;
  return prev.filter((m) => {
    if (!m.pending) return false;
    const key = m.v2?.client_message_id; // v2 unsent row: leaves only when the server returns this key
    if (key) return !serverList.some((s) => s.v2?.client_message_id === key);
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

const makeStyles = (colors: ThreadColors) => {
  const textOnPrimaryDim = colors.textMuted;
  const textOnPrimaryFaint = colors.textMuted;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  noCoachContainer: { flex: 1, backgroundColor: colors.background },
  noCoachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  noCoachTitle: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 20, lineHeight: 25, letterSpacing: 0.4, fontWeight: '500', color: colors.textPrimary },
  noCoachBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 12 },
  noCoachHeadline: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, lineHeight: 28, letterSpacing: 0.4, fontWeight: '500', color: colors.textPrimary },
  noCoachText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  noCoachAction: {
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
  },
  noCoachActionText: { ...typography.bodyMd, color: colors.primaryText },
  noCoachPrimary: { backgroundColor: colors.primary },
  noCoachPrimaryText: { color: colors.textOnPrimary },
  errorBanner: { minHeight: 44, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 8, paddingHorizontal: 16 },
  errorBannerText: { ...typography.bodySmall, color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chatHeaderCenter: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chatHeaderName: { ...typography.h2, color: colors.textPrimary },
  skeletonContainer: { flex: 1, padding: 16 },
  skeletonRow: { marginBottom: 12 },
  skeletonBubble: {
    height: 44,
    borderRadius: radius.card,
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  loadingOlderDot: {
    width: 8,
    height: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
    opacity: 0.5,
  },
  chatList: { padding: 16, paddingBottom: 8 },
  chatEmpty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  chatEmptyText: { ...typography.bodySmall, color: colors.textMuted },
  dateSep: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dateSepText: { ...typography.eyebrow, color: colors.textMuted, paddingHorizontal: 12 },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  receiptText: {
    ...typography.bodySmall, fontSize: 13,
    color: textOnPrimaryDim,
  },
  receiptTextPending: {
    ...typography.bodySmall, fontSize: 13,
    color: textOnPrimaryFaint,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 36,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...typography.body,
    color: colors.textPrimary,
    maxHeight: 100,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.disabledBg },
  });
};
