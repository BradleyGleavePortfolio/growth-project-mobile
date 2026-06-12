/**
 * RomanChatScreen — the Roman Phase 1 chat surface (client + coach).
 *
 * One screen serves both ROMAN_SURFACES (roman.dto.ts L18). The host surface is
 * passed as a route param (`surface`) — ClientNavigator passes 'client',
 * CoachNavigator passes 'coach' — so there is no client-side role-guessing and
 * the value is always one the backend @IsIn(ROMAN_SURFACES) accepts.
 *
 * FACE+VOICE (operator rule, P0): Roman's face renders with every Roman-voiced
 * string — the header carries his avatar, the empty state (RomanGreeting), each
 * assistant bubble, the typing indicator, and every typed state. No new
 * client-side Roman prose exists beyond romanVoice.ts, which is sourced from the
 * identity spec (cited there per string).
 *
 * Typed states (brief §3): loading skeleton, "Roman unavailable" (404 flag-off
 * — calm, no retry loop), offline, generic error, send-failure (message stays
 * in the composer for retry), and rate-limited (calm backoff copy).
 *
 * Emotional target (DESIGN_INTELLIGENCE §5.1): the user leaves feeling attended
 * to and in capable hands. Primary path (Hick's Law §4.4): a single composer +
 * send — no competing actions on the surface.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import RomanAvatar from '../../components/roman/RomanAvatar';
import RomanGreeting from '../../components/roman/RomanGreeting';
import RomanMessageBubble from '../../components/roman/RomanMessageBubble';
import RomanTypingIndicator from '../../components/roman/RomanTypingIndicator';
import RomanComposer from '../../components/roman/RomanComposer';
import RomanState from '../../components/roman/RomanState';
import { Skeleton } from '../../ui/skeletons/Skeleton';
import {
  romanRateLimited,
  ROMAN_LOADING_OLDER,
  ROMAN_REPLY_ANNOUNCE_PREFIX,
  ROMAN_SEND_FAILED,
} from '../../components/roman/romanVoice';
import { useRomanChat } from './useRomanChat';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import type { RomanMessage, RomanSurface } from '../../api/romanApi';
import { colors, radius, spacing, typography, withAlpha } from '../../theme/tokens';

export interface RomanChatScreenProps {
  /** Host surface; defaults to 'client' when a route omits it. */
  surface?: RomanSurface;
}

function LoadingSkeleton(): React.ReactElement {
  return (
    <View style={styles.skeletonWrap} testID="roman-loading-skeleton">
      <Skeleton width="70%" height={18} testID="roman-skeleton-line-1" />
      <Skeleton width="55%" height={18} />
      <Skeleton width="80%" height={18} />
    </View>
  );
}

export default function RomanChatScreen({
  surface = 'client',
}: RomanChatScreenProps): React.ReactElement {
  const user = useCurrentUser();
  const {
    phase,
    isFirstOpen,
    messages,
    sending,
    sendError,
    nextCursor,
    loadingOlder,
    reload,
    loadOlder,
    send,
    clearSendError,
  } = useRomanChat(surface);
  const [draft, setDraft] = useState('');

  const listRef = useRef<FlatList<RomanMessage>>(null);
  // Last assistant message id we announced to assistive tech, so a re-render
  // does not re-announce the same reply (U4).
  const lastAnnouncedId = useRef<string | null>(null);

  const scrollToLatest = useCallback(() => {
    // Guard: scrollToEnd is a no-op (and warns) on an empty list.
    if (messages.length === 0) return;
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  // Scroll to the newest turn whenever the thread grows (send + receive), and
  // when the keyboard opens, so the latest message is never stranded (U3).
  useEffect(() => {
    scrollToLatest();
  }, [messages.length, sending, scrollToLatest]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', scrollToLatest);
    return () => show.remove();
  }, [scrollToLatest]);

  // Announce a freshly arrived Roman reply for screen-reader users, deduped by
  // message id so the same reply is announced at most once (U4).
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      if (m.id !== lastAnnouncedId.current) {
        lastAnnouncedId.current = m.id;
        AccessibilityInfo.announceForAccessibility(
          `${ROMAN_REPLY_ANNOUNCE_PREFIX}${m.content}`,
        );
      }
      break;
    }
  }, [messages]);

  const onSend = useCallback(async () => {
    const text = draft;
    const outcome = await send(text);
    // Clear the composer ONLY when the turn actually persisted; on a send
    // failure the draft is preserved so the user can retry without retyping
    // (brief §3 / F5 RomanSendOutcome).
    if (outcome === 'sent') setDraft('');
  }, [draft, send]);

  const onChangeDraft = useCallback(
    (text: string) => {
      setDraft(text);
      // A stale send-error must not linger while the user edits the draft (U2).
      if (sendError != null) clearSendError();
    },
    [sendError, clearSendError],
  );

  // Re-send the current draft from the visible retry affordance (U2).
  const onRetrySend = useCallback(() => {
    void onSend();
  }, [onSend]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RomanMessage>) => (
      <RomanMessageBubble message={item} testID={`roman-message-${item.id}`} />
    ),
    [],
  );

  const header = (
    <View style={styles.header}>
      <RomanAvatar crop="neutral" size={36} testID="roman-header-avatar" />
      <Text style={styles.headerTitle} accessibilityRole="header">
        Roman
      </Text>
    </View>
  );

  if (phase === 'loading') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="roman-chat-screen">
        {header}
        <LoadingSkeleton />
      </SafeAreaView>
    );
  }

  if (phase === 'unavailable' || phase === 'offline' || phase === 'error') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="roman-chat-screen">
        {header}
        <RomanState
          kind={phase}
          onRetry={phase === 'unavailable' ? undefined : reload}
          testID="roman-chat-state"
        />
      </SafeAreaView>
    );
  }

  const isEmpty = messages.length === 0;
  const sendErrorCopy =
    sendError == null
      ? null
      : sendError.kind === 'rateLimited'
        ? romanRateLimited(sendError.retryAfterSeconds)
        : ROMAN_SEND_FAILED;

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="roman-chat-screen">
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {isEmpty ? (
          <View style={styles.flex}>
            <RomanGreeting
              surface={surface}
              isFirstOpen={isFirstOpen}
              firstName={user?.firstName}
              testID="roman-empty-greeting"
            />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            onEndReachedThreshold={0.4}
            onEndReached={nextCursor != null ? loadOlder : undefined}
            onContentSizeChange={scrollToLatest}
            ListFooterComponent={
              loadingOlder ? (
                <View style={styles.olderNote} testID="roman-loading-older">
                  <RomanAvatar crop="neutral" size={24} />
                  <Text style={styles.olderNoteText} accessibilityRole="text">
                    {ROMAN_LOADING_OLDER}
                  </Text>
                </View>
              ) : null
            }
            testID="roman-message-list"
          />
        )}

        {sending ? <RomanTypingIndicator testID="roman-typing" /> : null}

        {sendErrorCopy != null ? (
          <View style={styles.sendError} testID="roman-send-error">
            <RomanAvatar crop="neutral" size={28} />
            <Text style={styles.sendErrorText} accessibilityRole="text">
              {sendErrorCopy}
            </Text>
            {sendError?.kind !== 'rateLimited' ? (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={onRetrySend}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel="Send again"
                accessibilityState={{ disabled: sending }}
                testID="roman-send-retry"
              >
                <Text style={styles.retryLabel}>Send again</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <RomanComposer
          value={draft}
          onChangeText={onChangeDraft}
          onSend={onSend}
          sending={sending}
          testID="roman-composer"
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.stone,
  },
  headerTitle: {
    ...typography.h4,
    color: colors.ink,
  },
  listContent: {
    paddingVertical: spacing.md,
  },
  skeletonWrap: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  olderNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  olderNoteText: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
  sendError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sendErrorText: {
    ...typography.bodySmall,
    color: colors.charcoal,
    flex: 1,
  },
  retryButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: withAlpha(colors.forest, 0.45),
    backgroundColor: withAlpha(colors.forest, 0.08),
  },
  retryLabel: {
    ...typography.bodyMd,
    color: colors.forest,
  },
});
