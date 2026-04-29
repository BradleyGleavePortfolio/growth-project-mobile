/**
 * NotificationsScreen — API-first via React Query (Fix #2 pass 2).
 *
 * The screen used to read from a local SQLite `notifications` table layered
 * on top of server-side nudges. The local table is now ignored entirely:
 * coach nudges from the backend are the single source of truth, the
 * unread-count badge comes from `useUnreadNudgeCount`, and marking-read
 * uses an optimistic mutation via `useMarkNudgeRead`.
 *
 * Cached for 30s with offline fallback through the persisted React Query
 * cache, so the inbox still renders something useful when the network blips.
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { IoniconName } from '../../types/common';

import {
  ApiNudge,
  useNudges,
  useMarkNudgeRead,
} from '../../hooks/useApi';

function makeTYPE_CONFIG(colors: ThemeColors): Record<string, { icon: string; color: string }> {
  return {
  reminder: { icon: 'alarm-outline', color: colors.warning },
  milestone: { icon: 'document-outline', color: colors.warning },
  coach: { icon: 'person-outline', color: colors.primary },
  system: { icon: 'information-circle-outline', color: colors.info },
  tip: { icon: 'bulb-outline', color: colors.primaryLight },
};
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const TYPE_CONFIG = useMemo(() => makeTYPE_CONFIG(colors), [colors]);
  const { data: nudges = [], isLoading, isRefetching, refetch } = useNudges(100);
  const markRead = useMarkNudgeRead();

  const onRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handlePress = (nudge: ApiNudge) => {
    if (!nudge.read_at) {
      markRead.mutate(nudge.id);
    }
  };

  // We intentionally don't expose "delete" — server-side nudges are the
  // record of coach communication; users mark them read instead.
  // (Long-press could be reused later for "snooze" once that exists.)

  const handleMarkAllRead = () => {
    const unread = nudges.filter((n) => !n.read_at);
    unread.forEach((n) => markRead.mutate(n.id));
  };

  const formatTime = (iso: string): string => {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const sorted = [...nudges].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const unreadCount = sorted.filter((n) => !n.read_at).length;

  const renderItem = ({ item }: { item: ApiNudge }) => {
    const config = TYPE_CONFIG.coach;
    const isUnread = !item.read_at;
    return (
      <TouchableOpacity
        style={[styles.notifCard, isUnread && styles.notifCardUnread]}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.iconCircle, { backgroundColor: config.color + '18' }]}>
          <Ionicons name={config.icon as IoniconName} size={20} color={config.color} />
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifTop}>
            <Text
              style={[styles.notifTitle, isUnread && styles.notifTitleUnread]}
              numberOfLines={1}
            >
              {item.title || 'From your coach'}
            </Text>
            <Text style={styles.notifTime}>{formatTime(item.created_at)}</Text>
          </View>
          <Text style={styles.notifBody} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        {isUnread && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            onPress={handleMarkAllRead}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <Ionicons name="notifications" size={16} color={colors.primary} />
          <Text style={styles.unreadBannerText}>
            {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      <FlatList
        data={sorted}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {isLoading ? 'Loading…' : 'No notifications yet'}
            </Text>
            <Text style={styles.emptyText}>
              Nudges from your coach and reminders will show up here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '500', color: colors.textPrimary },
  markAllText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  unreadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 12,
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  unreadBannerText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  notifCardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 2, // radius.md
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  notifContent: { flex: 1, gap: 4 },
  notifTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notifTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: 8 },
  notifTitleUnread: { fontWeight: '500' },
  notifTime: { fontSize: 11, color: colors.textMuted },
  notifBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textSecondary },

  });
