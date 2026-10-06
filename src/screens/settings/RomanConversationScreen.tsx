/**
 * One past conversation with Roman, read only, with Delete.
 * Opened from "Your conversations with Roman" (RomanConversationsScreen).
 *
 * Reads GET /roman/sessions/:id/messages (newest first, cursor paged; shown
 * oldest first). That route is behind the Roman chat switch on the server,
 * so when it is off the screen says reading is switched off and still offers
 * Delete (DELETE /roman/sessions/:id is not behind the switch).
 *
 * Bound to the account and sign-in that opened it (the list's AccountBinding,
 * Sol A-331-4 / B-331-6): every read and the delete carry it, any auth change
 * (sign-out, sign-in, the same account signing in again) clears the
 * transcript, closes the confirm sheet and stops the delete at once, and an
 * answer that arrives after such a change is dropped before it can change
 * state, tell the list anything, navigate or report.
 * The transcript lives only in this screen's memory (the server sends it
 * no-store); it is never cached, logged or reported.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import RomanMessageBubble from '../../components/roman/RomanMessageBubble';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { romanChatsApi as defaultApi, type RomanChatsApi } from '../../api/romanChatsApi';
import type { RomanMessage } from '../../api/romanApi';
import { bindingIsCurrent, onAuthEpochChange } from '../../services/accountBinding';
import { readUserCacheSync } from '../../lib/userCache';
import { viewAndReport } from './useRomanChats';
import { romanChatsEvents } from './romanChatsEvents';
import { trackErase } from './romanEraseTracker';
import RomanChatsConfirmSheet from './RomanChatsConfirmSheet';
import RomanChatsSupportAction from './RomanChatsSupportAction';
import type { RomanConversationParams } from './RomanConversationsScreen';
import { chatDateLabel, chatIdentity, ROMAN_CHATS_COPY, type RomanChatsFailureView } from './romanChatsCopy';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; view: RomanChatsFailureView; gone: boolean; switchedOff: boolean }
  | { kind: 'other_account' };

export interface RomanConversationScreenProps {
  navigation: NavigationProp<ParamListBase>;
  route: { params: RomanConversationParams };
  api?: RomanChatsApi;
  sessionUserId?: () => string | null;
}

const defaultSessionUserId = () => readUserCacheSync()?.id ?? null;

export default function RomanConversationScreen({
  navigation,
  route,
  api = defaultApi,
  sessionUserId = defaultSessionUserId,
}: RomanConversationScreenProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id, ownerId, binding, startedAt, surface, messageCount } = route.params;
  const when = chatDateLabel({ startedAt });
  const which = chatIdentity({ startedAt, surface, messageCount });

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  /** Oldest first. */
  const [messages, setMessages] = useState<RomanMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<{ view: RomanChatsFailureView; retry?: () => void } | null>(null);
  const mounted = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Still the account and sign-in this transcript was opened under. */
  const isOwner = useCallback(
    () => !!binding && bindingIsCurrent(binding) && sessionUserId() === ownerId,
    [binding, ownerId, sessionUserId],
  );
  /** Bumped by every drop: a delete started before it settles into nothing. */
  const opGen = useRef(0);
  const deletingRef = useRef(false);

  const dropAll = useCallback(() => {
    seq.current += 1;
    opGen.current += 1;
    deletingRef.current = false;
    setMessages([]);
    setCursor(null);
    setNotice(null);
    setConfirm(false);
    setDeleting(false);
    setLoadingEarlier(false);
    setPhase({ kind: 'other_account' });
  }, []);

  /** Tell the list this chat is gone, then go back to it. */
  const leaveGone = useCallback(
    (text: string) => {
      if (!isOwner()) {
        dropAll();
        return;
      }
      romanChatsEvents.emitGone({ ownerId, epoch: binding.epoch, id, notice: text });
      navigation.goBack();
    },
    [binding, dropAll, id, isOwner, navigation, ownerId],
  );

  const load = useCallback(
    async (more: string | null) => {
      if (!isOwner()) {
        dropAll();
        return;
      }
      const mine = ++seq.current;
      if (more) setLoadingEarlier(true);
      else {
        setPhase({ kind: 'loading' });
        setNotice(null);
      }
      const out = await api.readMessages(binding, id, more ? { cursor: more } : {});
      if (!mounted.current || mine !== seq.current) return;
      if (!isOwner() || (!out.ok && out.failure.reason === 'account_changed')) {
        dropAll();
        return;
      }
      setLoadingEarlier(false);
      if (!out.ok) {
        const view = viewAndReport('read', out.failure);
        if (more) {
          setNotice({ view, retry: () => void load(more) });
          return;
        }
        setPhase({
          kind: 'error',
          view,
          gone: out.failure.reason === 'not_found',
          switchedOff: out.failure.reason === 'route_missing',
        });
        return;
      }
      const page = [...out.value.messages].reverse();
      setMessages((prev) => (more ? [...page, ...prev.filter((m) => !page.some((p) => p.id === m.id))] : page));
      setCursor(out.value.nextCursor);
      setPhase({ kind: 'ready' });
    },
    [api, binding, dropAll, id, isOwner],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  // Any auth change ends this transcript's sign-in: drop it at once.
  useEffect(
    () =>
      onAuthEpochChange(() => {
        if (mounted.current) dropAll();
      }),
    [dropAll],
  );

  const doDelete = useCallback(async () => {
    if (deletingRef.current) return;
    if (!isOwner()) {
      dropAll();
      return;
    }
    const gen = opGen.current;
    deletingRef.current = true;
    setDeleting(true);
    setNotice(null);
    const out = await trackErase(binding.subject, api.deleteOne(binding, id));
    // Sol B-331-6: nothing below runs for a sign-in that has ended, not even
    // a report or the notice to the list.
    if (!mounted.current || gen !== opGen.current) return;
    if (!isOwner() || (!out.ok && out.failure.reason === 'account_changed')) {
      dropAll();
      return;
    }
    deletingRef.current = false;
    setDeleting(false);
    if (out.ok) {
      leaveGone(ROMAN_CHATS_COPY.deletedOne);
      return;
    }
    if (out.failure.reason === 'not_found') {
      leaveGone(ROMAN_CHATS_COPY.alreadyGone);
      return;
    }
    const view = viewAndReport('delete_one', out.failure);
    setNotice({ view, retry: () => void doDeleteRef.current() });
  }, [api, binding, dropAll, id, isOwner, leaveGone]);
  const doDeleteRef = useRef(doDelete);
  doDeleteRef.current = doDelete;

  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice.view.message);
  }, [notice]);

  const quietButton = (label: string, onPress: () => void, testID: string) => (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.quiet}
      testID={testID}
    >
      <Text style={styles.quietText}>{label}</Text>
    </HapticPressable>
  );

  const failureActions = (view: RomanChatsFailureView, retry: (() => void) | undefined, prefix: string) => (
    <View style={styles.actions}>
      {retry && (view.action === 'retry' || view.action === 'retry_support')
        ? quietButton(ROMAN_CHATS_COPY.retry, retry, `${prefix}-retry`)
        : null}
      {view.action === 'retry_support' ? (
        <RomanChatsSupportAction
          reference={view.reference}
          testID={`${prefix}-support`}
          buttonStyle={styles.quiet}
          buttonTextStyle={styles.quietText}
          bodyStyle={styles.noticeText}
          linkColor={colors.primary}
        />
      ) : null}
      {view.action === 'back'
        ? quietButton(ROMAN_CHATS_COPY.backToList, () => leaveGone(view.message), `${prefix}-back`)
        : null}
    </View>
  );

  const deleteButton =
    phase.kind === 'ready' || (phase.kind === 'error' && !phase.gone) ? (
      <HapticPressable
        intent="light"
        onPress={() => setConfirm(true)}
        disabled={deleting}
        accessibilityRole="button"
        accessibilityLabel={`Delete the conversation from ${when}`}
        accessibilityState={{ disabled: deleting, busy: deleting }}
        style={[styles.dangerQuiet, deleting && styles.disabled]}
        testID="roman-chat-transcript-delete"
      >
        <Text style={styles.dangerQuietText}>
          {deleting ? ROMAN_CHATS_COPY.deleting : ROMAN_CHATS_COPY.confirmOneAction}
        </Text>
      </HapticPressable>
    ) : null;

  const noticeView = notice ? (
    <View style={styles.notice} testID="roman-chat-transcript-notice">
      <Text style={styles.noticeText} accessibilityLiveRegion="polite" accessibilityRole="alert">
        {notice.view.message}
      </Text>
      {failureActions(notice.view, notice.retry, 'roman-chat-transcript-notice')}
    </View>
  ) : null;

  function body(): React.ReactElement {
    if (phase.kind === 'other_account') {
      return (
        <View style={styles.content}>
          <Text style={styles.body} testID="roman-chat-transcript-other-account">
            {ROMAN_CHATS_COPY.otherAccount}
          </Text>
          {quietButton(ROMAN_CHATS_COPY.back, () => navigation.goBack(), 'roman-chat-transcript-back')}
        </View>
      );
    }
    if (phase.kind === 'loading') {
      return (
        <View style={styles.content}>
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel={ROMAN_CHATS_COPY.transcriptLoading}
            testID="roman-chat-transcript-loading"
          />
        </View>
      );
    }
    if (phase.kind === 'error') {
      return (
        <View style={styles.content}>
          <View style={styles.card} testID="roman-chat-transcript-error">
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {phase.view.message}
            </Text>
            {failureActions(phase.view, () => void load(null), 'roman-chat-transcript-error')}
          </View>
          {noticeView}
          {deleteButton}
        </View>
      );
    }
    return (
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <RomanMessageBubble message={item} testID={`roman-transcript-message-${item.id}`} />}
        role="list"
        contentContainerStyle={styles.list}
        testID="roman-chat-transcript-list"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.caption}>{ROMAN_CHATS_COPY.readOnlyNote}</Text>
            {loadingEarlier ? (
              <ActivityIndicator color={colors.primary} accessibilityLabel={ROMAN_CHATS_COPY.loadingEarlier} />
            ) : cursor ? (
              quietButton(ROMAN_CHATS_COPY.earlier, () => void load(cursor), 'roman-chat-transcript-earlier')
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.body} testID="roman-chat-transcript-empty">
            {ROMAN_CHATS_COPY.transcriptEmpty}
          </Text>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {noticeView}
            {deleteButton}
          </View>
        }
      />
    );
  }

  return (
    <View style={styles.container} testID="roman-chat-transcript-screen" ph-no-capture>
      <View style={styles.topBar}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={ROMAN_CHATS_COPY.back}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.topTitle} accessibilityRole="header" numberOfLines={2}>
          {ROMAN_CHATS_COPY.transcriptTitle(when)}
        </Text>
        <View style={styles.backBtn} />
      </View>
      {body()}
      <RomanChatsConfirmSheet
        visible={confirm && phase.kind !== 'other_account' && isOwner()}
        title={ROMAN_CHATS_COPY.confirmOneTitle}
        body={ROMAN_CHATS_COPY.confirmOneBody(which)}
        confirmLabel={ROMAN_CHATS_COPY.confirmOneAction}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void doDelete();
        }}
        testID="roman-chat-transcript-confirm"
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    topTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 17, color: colors.textPrimary },
    content: { padding: 24, paddingBottom: 48, gap: 16 },
    list: { paddingVertical: 16, paddingBottom: 48 },
    header: { gap: 12, paddingHorizontal: 24, paddingBottom: 8 },
    footer: { gap: 12, paddingHorizontal: 24, paddingTop: 16 },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 16,
      gap: 12,
      backgroundColor: colors.surface,
    },
    body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: colors.textPrimary },
    caption: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    notice: { gap: 8 },
    noticeText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: colors.textPrimary },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quiet: {
      minHeight: 44,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
    },
    quietText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
    dangerQuiet: {
      minHeight: 44,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.error,
      paddingHorizontal: 16,
    },
    dangerQuietText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.error },
    disabled: { opacity: 0.5 },
  });
}
