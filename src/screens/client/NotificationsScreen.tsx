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
import { typography } from '../../theme/tokens';

import {
  ApiNudge,
  useNudges,
  useMarkNudgeRead,
} from '../../hooks/useApi';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: nudges = [], isLoading, isError, isRefetching, refetch } = useNudges(100);
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
    const isUnread = !item.read_at;
    return (
      <TouchableOpacity
        style={styles.notifCard}
        disabled={!isUnread}
        accessibilityRole={isUnread ? 'button' : 'text'}
        accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${item.title || 'From your coach'}. ${item.body}`}
        accessibilityHint={isUnread ? 'Mark as read' : undefined}
        onPress={() => handlePress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.iconCircle}>
          <Ionicons name="person-outline" size={20} color={colors.textMuted} accessibilityElementsHidden />
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifTop}>
            <Text
              style={[styles.notifTitle, isUnread && styles.notifTitleUnread]}
            >
              {item.title || 'From your coach'}
            </Text>
            <Text style={styles.notifTime}>{formatTime(item.created_at)}</Text>
          </View>
          <Text style={styles.notifBody}>
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
            style={styles.headerAction}
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <Ionicons name="notifications-outline" size={16} color={colors.primary} accessibilityElementsHidden />
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
              {isLoading ? 'Loading notifications…' : isError
                ? 'Could not load notifications. Pull down to try again.' : 'No notifications.'}
            </Text>
            <Text style={styles.emptyText}>
              Pull down to refresh.
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
  title: { ...typography.h1, color: colors.textPrimary },
  headerAction: { minHeight: 44, justifyContent: 'center' },
  markAllText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: colors.primary },
  unreadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 12,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },
  unreadBannerText: { ...typography.bodySmall, fontSize: 13, color: colors.primary, fontVariant: ['tabular-nums'] },
  listContent: { paddingHorizontal: 24, paddingBottom: 100, flexGrow: 1 },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    paddingVertical: 20,
    gap: 12,
  },
  iconCircle: {
    width: 20,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  notifContent: { flex: 1, gap: 4 },
  notifTop: {
    gap: 6,
  },
  notifTitle: { ...typography.bodySmall, fontSize: 15, color: colors.textPrimary },
  notifTitleUnread: { fontFamily: 'Inter_500Medium', fontWeight: '500' },
  notifTime: { ...typography.bodySmall, fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  notifBody: { ...typography.bodySmall, fontSize: 13, color: colors.textSecondary },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: { ...typography.bodyMd, color: colors.textPrimary, textAlign: 'center' },
  emptyText: { ...typography.bodySmall, color: colors.textSecondary },

  });
