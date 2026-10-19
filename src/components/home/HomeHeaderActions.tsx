/**
 * HomeHeaderActions — top-of-Home row with the things a client must always
 * be able to reach in one tap:
 *
 *   - With a coach: "Message <coach first name>" (falls back to "Message
 *     your coach") → HomeStack `Messages`, with the unread count.
 *   - A notification bell with the unread badge → HomeStack `NotificationCenter`
 *     (the old headerRight bell never rendered because the Home stack is
 *     headerShown:false).
 *   - When Roman chat is enabled, a compact avatar → MoreTab / RomanChat.
 *
 * B25 (owner, 10-08): a client with no coach was told "Message your coach".
 * Coachless clients get everything except direct coaching, so there is no
 * coach action at all: the leading slot becomes "Ask Roman" (avatar and
 * label, same RomanChat destination, no second avatar) when Roman chat is
 * on, and stays empty otherwise.
 *
 * `layout="rings"` (UI-1 rings Home): a coachless client sees Roman locked
 * ("Opens with a coach") instead of "Ask Roman" (139-15). The tap opens Roman's
 * existing lock screen (Join a coach), never a chat (owner 10-17: no dead tap).
 * A coached client's Roman avatar moves to "Ask Roman" under Roman's line.
 *
 * The coach name comes from `GET /v1/clients/me/coach` (same endpoint as
 * CoachIntroductionBanner); any failure keeps the generic label.
 *
 * C3B-S2 (MOCK-C3 Style B, `featureFlags.c3StyleB`): with Roman chat on, the
 * coach entry, the Roman avatar and "Ask Roman" all open the Messages list
 * (HomeStack `MessagesInbox`), where the coach and Roman sit side by side.
 * Flag off, or Roman chat off, every entry keeps its own destination.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import api from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientUnreadCount } from '../../hooks/useClientUnreadCount';
import NotificationBadge from '../NotificationBadge';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, typography } from '../../theme/tokens';
import { logger } from '../../utils/logger';
import { featureFlags } from '../../config/featureFlags';
import RomanAvatar from '../roman/RomanAvatar';

export function messageCoachLabel(coachName?: string | null): string {
  const first = typeof coachName === 'string' ? coachName.trim().split(/\s+/)[0] : '';
  return first ? `Message ${first}` : 'Message your coach';
}

/** Roman's monogram, dimmed, with an ink lock badge: Roman opens with a coach (139-15). */
export function LockedRomanAvatar({ size = 28 }: { size?: number }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={{ width: size, height: size }} testID="roman-locked-avatar">
      <View style={styles.dimmed}><RomanAvatar size={size} /></View>
      <View style={[styles.lock, { backgroundColor: sc.textPrimary, borderColor: sc.bgPrimary }]}>
        <Ionicons name="lock-closed" size={10} color={sc.bgPrimary} />
      </View>
    </View>
  );
}

export default function HomeHeaderActions({ layout = 'classic' }: { layout?: 'classic' | 'rings' } = {}) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const unreadCount = useClientUnreadCount();
  const [coachName, setCoachName] = useState<string | null>(null);
  const coachId = (currentUser as { coach_id?: string | null } | null)?.coach_id ?? null;

  useEffect(() => {
    if (!coachId) {
      setCoachName(null);
      return undefined;
    }
    let mounted = true;
    api
      .get<{ name?: string }>('/v1/clients/me/coach')
      .then((res) => {
        if (mounted && typeof res?.data?.name === 'string') setCoachName(res.data.name);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [coachId]);

  // Unread coach messages on the message entry (AUDIT-03-125 U2): without it a
  // client on Home had no sign the coach replied. GET /messages/unread-count
  // is live in production; refreshed on Home focus, foreground and every 30 s.
  const [unreadMessages, setUnreadMessages] = useState(0);
  const refreshUnreadMessages = useCallback(() => {
    if (!coachId) {
      setUnreadMessages(0);
      return;
    }
    api
      .get<{ total?: number }>('/messages/unread-count')
      .then((res) => {
        const n = Number(res?.data?.total ?? 0);
        setUnreadMessages(Number.isFinite(n) && n > 0 ? n : 0);
      })
      .catch((error: unknown) => logger.warn('homeHeader.unread-messages', { error: String(error) }));
  }, [coachId]);
  useFocusEffect(refreshUnreadMessages);
  useEffect(() => {
    const id = setInterval(refreshUnreadMessages, 30000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshUnreadMessages();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refreshUnreadMessages]);

  const label = messageCoachLabel(coachName);
  const messageLabel =
    unreadMessages > 0 ? `${label}, ${unreadMessages > 99 ? '99+' : unreadMessages} unread` : label;
  const bellLabel =
    unreadCount > 0
      ? `Notifications, ${unreadCount > 99 ? '99+' : unreadCount} unread`
      : 'Notifications';

  const toList = featureFlags.c3StyleB && featureFlags.romanChat;
  const openMessages = () => navigation.navigate(toList ? 'MessagesInbox' : 'Messages');
  const openRoman = () =>
    toList ? navigation.navigate('MessagesInbox') : navigation.navigate('MoreTab', { screen: 'RomanChat', initial: false });
  const hasCoach = !!coachId;
  // useCurrentUser reads the cache asynchronously (first render is null): choose
  // coach or Roman only once the user is known, so a coached client never sees
  // "Ask Roman" flash first (U1 on m#618).
  const userKnown = currentUser !== null;

  const rings = layout === 'rings';

  return (
    <View style={[styles.row, rings && styles.ringsRow]}>
      {hasCoach ? (
        <Pressable
          onPress={openMessages}
          accessibilityRole="button"
          accessibilityLabel={messageLabel}
          testID="home-message-coach"
          style={({ pressed }) => [
            styles.message,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={24} color={sc.textPrimary} />
          <Text style={[rings ? typography.bodyMd : typography.bodySmall, styles.messageText, { color: sc.textPrimary }]}>
            {label}
          </Text>
          <NotificationBadge count={unreadMessages} />
        </Pressable>
      ) : userKnown && rings && featureFlags.romanChat ? (
        <Pressable onPress={openRoman} accessibilityRole="button" accessibilityLabel="Roman. Opens with a coach"
          testID="home-roman-locked-header" style={({ pressed }) => [styles.message, { opacity: pressed ? 0.85 : 1 }]}>
          <LockedRomanAvatar />
          <View style={styles.lockedText}>
            <Text style={[typography.bodyMd, styles.lockedName, { color: sc.textPrimary }]}>Roman</Text>
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>Opens with a coach</Text>
          </View>
        </Pressable>
      ) : userKnown && featureFlags.romanChat ? (
        <Pressable
          onPress={openRoman}
          accessibilityRole="button"
          accessibilityLabel="Chat with Roman"
          testID="home-roman-chat"
          style={({ pressed }) => [styles.message, { opacity: pressed ? 0.85 : 1 }]}
        >
          <RomanAvatar crop="neutral" size={32} testID="home-roman-avatar" />
          <Text style={[typography.bodySmall, styles.messageText, { color: sc.textPrimary }]}>Ask Roman</Text>
        </Pressable>
      ) : (
        <View style={styles.message} testID="home-leading-empty" />
      )}
      {/* Rings layout: Roman's door is "Ask Roman" under Roman's line, not the header. */}
      {hasCoach && featureFlags.romanChat && !rings ? (
        <Pressable
          onPress={openRoman}
          accessibilityRole="button"
          accessibilityLabel="Chat with Roman"
          testID="home-roman-chat"
          style={styles.bell}
        >
          <RomanAvatar crop="neutral" size={32} testID="home-roman-avatar" />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => navigation.navigate('NotificationCenter')}
        accessibilityRole="button"
        accessibilityLabel={bellLabel}
        testID="home-notification-bell"
        hitSlop={8}
        style={styles.bell}
      >
        <Ionicons name="notifications-outline" size={24} color={sc.textPrimary} />
        <NotificationBadge count={unreadCount} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    minHeight: 44,
    flexShrink: 1,
    marginRight: 12,
    position: 'relative',
  },
  messageText: { marginLeft: 8, flexShrink: 1 },
  ringsRow: { marginBottom: 20 },
  lockedText: { marginLeft: 12, flexShrink: 1 },
  lockedName: { lineHeight: 22 },
  // Paler, as drawn, while Roman's "R" keeps 4.5:1 on its gold circle.
  dimmed: { opacity: 0.8 },
  lock: {
    position: 'absolute', right: -5, bottom: -5, width: 18, height: 18, borderRadius: radius.chip, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', position: 'relative' },
});
