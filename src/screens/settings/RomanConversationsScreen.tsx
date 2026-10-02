/**
 * Settings > Privacy > Roman and AI > Your conversations with Roman
 * (also opened from the Roman chat header).
 *
 * Owner 2026-10-01 20:32 + ruling OR-110-1: Roman chats are kept until the
 * client deletes them or their account, so this screen lists every chat of
 * the signed-in user (any day, newest first, paged by the backend cursor),
 * opens one, deletes one (confirm sheet: permanent), and deletes all (typed
 * DELETE confirm). Deletes are optimistic and roll back when the server does
 * not confirm. Roman chats are never visible to coaches; this screen only
 * ever shows the signed-in user's own chats (useRomanChats).
 *
 * Backend: #635 GET /roman/sessions, DELETE /roman/sessions[/:id]. These
 * routes are not behind the Roman chat switch, so this screen is reachable
 * whatever that switch says.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { RomanChatsApi, RomanChatSummary } from '../../api/romanChatsApi';
import { isEffectivelyOnline, useNetworkStatus } from '../../hooks/useNetworkStatus';
import { logger } from '../../utils/logger';
import { useRomanChats, type RomanChatsNotice } from './useRomanChats';
import RomanChatsConfirmSheet from './RomanChatsConfirmSheet';
import {
  chatDateLabel,
  messageCountLabel,
  ROMAN_CHATS_COPY,
  supportMailto,
  type RomanChatsFailureView,
} from './romanChatsCopy';

/** Params of the transcript screen (RomanConversationScreen). */
export interface RomanConversationParams {
  id: string;
  ownerId: string;
  startedAt: string;
  surface: RomanChatSummary['surface'];
  messageCount: number;
}

export interface RomanConversationsScreenProps {
  navigation: NavigationProp<ParamListBase>;
  api?: RomanChatsApi;
  sessionUserId?: () => string | null;
}

export function openSupport(reference: string | null): void {
  Linking.openURL(supportMailto(reference)).catch((err) => {
    // The address is already in the message text, so the person still has it.
    logger.warn('RomanConversations.openSupport', err);
  });
}

export default function RomanConversationsScreen({
  navigation,
  api,
  sessionUserId,
}: RomanConversationsScreenProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const state = useRomanChats({ api, sessionUserId });
  const {
    phase,
    loadFailure,
    chats,
    hasMore,
    loadingMore,
    deletingAll,
    pendingCount,
    notice,
    ownerId,
    reload,
    loadMore,
    deleteOne,
    deleteAll,
  } = state;
  const [confirmOne, setConfirmOne] = useState<RomanChatSummary | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const network = useNetworkStatus();
  const online = isEffectivelyOnline(network);
  const wasOnline = useRef(online);

  // Back online after an offline load failure: read the list again.
  useEffect(() => {
    if (online && !wasOnline.current && phase === 'error') reload();
    wasOnline.current = online;
  }, [online, phase, reload]);

  // Announce each new notice once.
  const lastNotice = useRef<string | null>(null);
  useEffect(() => {
    const text = notice?.text ?? null;
    if (text && text !== lastNotice.current) AccessibilityInfo.announceForAccessibility(text);
    lastNotice.current = text;
  }, [notice]);

  const open = useCallback(
    (chat: RomanChatSummary) => {
      if (!ownerId) return;
      const params: RomanConversationParams = {
        id: chat.id,
        ownerId,
        startedAt: chat.startedAt,
        surface: chat.surface,
        messageCount: chat.messageCount,
      };
      navigation.navigate('RomanConversation', params);
    },
    [navigation, ownerId],
  );

  const actions = (view: RomanChatsFailureView, retry: (() => void) | undefined, prefix: string) => (
    <View style={styles.actions}>
      {retry && (view.action === 'retry' || view.action === 'retry_support') ? (
        <HapticPressable
          intent="light"
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel={ROMAN_CHATS_COPY.retry}
          style={styles.quiet}
          testID={`${prefix}-retry`}
        >
          <Text style={styles.quietText}>{ROMAN_CHATS_COPY.retry}</Text>
        </HapticPressable>
      ) : null}
      {view.action === 'retry_support' ? (
        <HapticPressable
          intent="light"
          onPress={() => openSupport(view.reference)}
          accessibilityRole="button"
          accessibilityLabel={ROMAN_CHATS_COPY.contactSupport}
          style={styles.quiet}
          testID={`${prefix}-support`}
        >
          <Text style={styles.quietText}>{ROMAN_CHATS_COPY.contactSupport}</Text>
        </HapticPressable>
      ) : null}
    </View>
  );

  const noticeView = (n: RomanChatsNotice | null) =>
    n ? (
      <View style={styles.notice} testID="roman-chats-notice">
        <Text style={styles.noticeText} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {n.text}
        </Text>
        {n.failure ? actions(n.failure, n.retry, 'roman-chats-notice') : null}
      </View>
    ) : null;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RomanChatSummary>) => {
      const when = chatDateLabel(item);
      const count = messageCountLabel(item.messageCount);
      const sub = item.surface === 'coach' ? `${count}. ${ROMAN_CHATS_COPY.coachTools}` : count;
      return (
        <View style={styles.row} role="listitem" testID={`roman-chat-row-${item.id}`}>
          <HapticPressable
            intent="light"
            onPress={() => open(item)}
            disabled={deletingAll}
            accessibilityRole="button"
            accessibilityLabel={`${when}. ${sub}.`}
            accessibilityHint={ROMAN_CHATS_COPY.open}
            style={styles.rowMain}
            testID={`roman-chat-open-${item.id}`}
          >
            <Text style={styles.rowTitle}>{when}</Text>
            <Text style={styles.rowSub}>{sub}</Text>
          </HapticPressable>
          <HapticPressable
            intent="light"
            onPress={() => setConfirmOne(item)}
            disabled={deletingAll}
            accessibilityRole="button"
            accessibilityLabel={`Delete the conversation from ${when}`}
            style={styles.rowDelete}
            testID={`roman-chat-delete-${item.id}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </HapticPressable>
        </View>
      );
    },
    [colors.textSecondary, deletingAll, open, styles],
  );

  const intro = (
    <Text style={styles.body} testID="roman-chats-intro">
      {ROMAN_CHATS_COPY.intro}
    </Text>
  );

  function body(): React.ReactElement {
    if (phase === 'signed_out') {
      return (
        <View style={styles.content}>
          <Text style={styles.body} testID="roman-chats-signed-out">
            {ROMAN_CHATS_COPY.signedOutState}
          </Text>
        </View>
      );
    }
    if (phase === 'loading') {
      return (
        <View style={styles.content}>
          {intro}
          {noticeView(notice)}
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel={ROMAN_CHATS_COPY.loading}
            testID="roman-chats-loading"
          />
        </View>
      );
    }
    if (phase === 'error' && loadFailure) {
      return (
        <View style={styles.content}>
          {intro}
          {noticeView(notice)}
          <View style={styles.card} testID="roman-chats-error">
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {loadFailure.message}
            </Text>
            {actions(loadFailure, reload, 'roman-chats-error')}
          </View>
        </View>
      );
    }
    const empty = chats.length === 0 && !hasMore;
    return (
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        role="list"
        testID="roman-chats-list"
        onEndReachedThreshold={0.4}
        onEndReached={hasMore ? loadMore : undefined}
        ListHeaderComponent={
          <View style={styles.header}>
            {intro}
            {noticeView(notice)}
            {deletingAll ? (
              <ActivityIndicator
                color={colors.primary}
                accessibilityLabel={ROMAN_CHATS_COPY.deleting}
                testID="roman-chats-deleting-all"
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          empty && !deletingAll ? (
            <View style={styles.card} testID="roman-chats-empty">
              <Text style={styles.body}>{ROMAN_CHATS_COPY.empty}</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {loadingMore ? (
              <ActivityIndicator
                color={colors.primary}
                accessibilityLabel={ROMAN_CHATS_COPY.loadingMore}
                testID="roman-chats-loading-more"
              />
            ) : hasMore ? (
              <HapticPressable
                intent="light"
                onPress={loadMore}
                accessibilityRole="button"
                accessibilityLabel={ROMAN_CHATS_COPY.loadMore}
                style={styles.quiet}
                testID="roman-chats-load-more"
              >
                <Text style={styles.quietText}>{ROMAN_CHATS_COPY.loadMore}</Text>
              </HapticPressable>
            ) : null}
            {!empty && !deletingAll ? (
              <HapticPressable
                intent="light"
                onPress={() => setConfirmAll(true)}
                disabled={pendingCount > 0}
                accessibilityRole="button"
                accessibilityLabel={ROMAN_CHATS_COPY.deleteAll}
                accessibilityState={{ disabled: pendingCount > 0 }}
                style={[styles.dangerQuiet, pendingCount > 0 && styles.disabled]}
                testID="roman-chats-delete-all"
              >
                <Text style={styles.dangerQuietText}>{ROMAN_CHATS_COPY.deleteAll}</Text>
              </HapticPressable>
            ) : null}
          </View>
        }
      />
    );
  }

  return (
    // Excluded from analytics autocapture: chat dates and counts stay private.
    <View style={styles.container} testID="roman-chats-screen" ph-no-capture>
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
        <Text style={styles.topTitle} accessibilityRole="header" numberOfLines={1}>
          {ROMAN_CHATS_COPY.title}
        </Text>
        <View style={styles.backBtn} />
      </View>
      {body()}
      <RomanChatsConfirmSheet
        visible={confirmOne !== null}
        title={ROMAN_CHATS_COPY.confirmOneTitle}
        body={confirmOne ? ROMAN_CHATS_COPY.confirmOneBody(chatDateLabel(confirmOne)) : ''}
        confirmLabel={ROMAN_CHATS_COPY.confirmOneAction}
        onCancel={() => setConfirmOne(null)}
        onConfirm={() => {
          const target = confirmOne;
          setConfirmOne(null);
          if (target) deleteOne(target);
        }}
        testID="roman-chats-confirm-one"
      />
      <RomanChatsConfirmSheet
        visible={confirmAll}
        typed
        title={ROMAN_CHATS_COPY.confirmAllTitle}
        body={ROMAN_CHATS_COPY.confirmAllBody}
        confirmLabel={ROMAN_CHATS_COPY.deleteAll}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false);
          deleteAll();
        }}
        testID="roman-chats-confirm-all"
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
    content: { padding: 24, paddingBottom: 48, gap: 12 },
    header: { gap: 16, marginBottom: 4 },
    footer: { gap: 12, marginTop: 12 },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 16,
      gap: 12,
      backgroundColor: colors.surface,
    },
    body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: colors.textPrimary },
    notice: { gap: 8 },
    noticeText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: colors.textPrimary },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      backgroundColor: colors.surface,
    },
    rowMain: { flex: 1, minHeight: 56, paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
    rowTitle: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
    rowSub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
    rowDelete: { width: 48, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
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
