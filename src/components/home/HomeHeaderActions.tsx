/**
 * HomeHeaderActions — top-of-Home row with the two things a clinic client
 * must always be able to reach in one tap:
 *
 *   - "Message <coach first name>" (falls back to "Message your coach")
 *     → HomeStack `Messages` (previously only reachable via More → Membership).
 *   - A notification bell with the unread badge → HomeStack `NotificationCenter`
 *     (the old headerRight bell never rendered because the Home stack is
 *     headerShown:false).
 *
 * The coach name comes from `GET /v1/clients/me/coach` (same endpoint as
 * CoachIntroductionBanner); any failure keeps the generic label.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import api from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientUnreadCount } from '../../hooks/useClientUnreadCount';
import NotificationBadge from '../NotificationBadge';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';

export function messageCoachLabel(coachName?: string | null): string {
  const first = typeof coachName === 'string' ? coachName.trim().split(/\s+/)[0] : '';
  return first ? `Message ${first}` : 'Message your coach';
}

export default function HomeHeaderActions() {
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

  const label = messageCoachLabel(coachName);
  const bellLabel =
    unreadCount > 0
      ? `Notifications, ${unreadCount > 99 ? '99+' : unreadCount} unread`
      : 'Notifications';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => navigation.navigate('Messages')}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="home-message-coach"
        style={({ pressed }) => [
          styles.message,
          { borderColor: sc.border, backgroundColor: sc.bgSurface, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={sc.textPrimary} />
        <Text style={[typography.bodySmall, styles.messageText, { color: sc.textPrimary }]}>
          {label}
        </Text>
      </Pressable>
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
    borderWidth: 0.5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    flexShrink: 1,
    marginRight: 12,
  },
  messageText: { marginLeft: 8, flexShrink: 1 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', position: 'relative' },
});
