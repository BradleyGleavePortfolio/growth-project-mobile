// Phase 9 — NotificationCenterScreen (/notifications route).
//
// Global system-notification center. Distinct from the coach command-center
// inbox (Phase 8) — this screen covers all notification kinds (coach nudges,
// milestones, reminders, build-week gates, system alerts) for both client and
// coach roles.
//
// Features:
//   - Paginated list via infinite scroll (cursor-based)
//   - Pull-to-refresh
//   - Tap to mark read + deep-link routing to the appropriate screen
//   - "Mark all read" action
//   - Empty state: "You're all caught up." (no emoji)

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import NotificationRow from '../../components/NotificationRow';
import {
  AppNotification,
  NotificationPage,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../services/notificationsApi';
import type { IoniconName } from '../../types/common';

// ─── Deep-link routing table ──────────────────────────────────────────────────
// Maps notification.actionScreen to a navigate() call. Keep in sync with
// README.md#deep-link-routing-table.

function routeNotification(
  notification: AppNotification,
  nav: NavigationProp<ParamListBase>,
): void {
  const screen = notification.actionScreen;
  if (!screen) return;
  // Param types are enforced by the navigator param lists. actionScreen values
  // come from a constrained server enum, not user input.
  (nav.navigate as (screen: string, params?: Record<string, string>) => void)(
    screen,
    notification.actionParams,
  );
}

// ─── State machine ────────────────────────────────────────────────────────────

interface State {
  notifications: AppNotification[];
  nextCursor: string | null;
  isLoadingFirst: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  error: string | null;
  unreadCount: number;
}

type Action =
  | { type: 'LOAD_FIRST_START' }
  | { type: 'LOAD_FIRST_SUCCESS'; payload: NotificationPage; unreadCount: number }
  | { type: 'LOAD_FIRST_ERROR'; error: string }
  | { type: 'LOAD_MORE_START' }
  | { type: 'LOAD_MORE_SUCCESS'; payload: NotificationPage }
  | { type: 'REFRESH_START' }
  | { type: 'REFRESH_SUCCESS'; payload: NotificationPage; unreadCount: number }
  | { type: 'MARK_READ'; id: string }
  | { type: 'MARK_ALL_READ' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_FIRST_START':
      return { ...state, isLoadingFirst: true, error: null };
    case 'LOAD_FIRST_SUCCESS':
      return {
        ...state,
        isLoadingFirst: false,
        notifications: action.payload.items,
        nextCursor: action.payload.nextCursor,
        unreadCount: action.unreadCount,
      };
    case 'LOAD_FIRST_ERROR':
      return { ...state, isLoadingFirst: false, error: action.error };
    case 'LOAD_MORE_START':
      return { ...state, isLoadingMore: true };
    case 'LOAD_MORE_SUCCESS':
      return {
        ...state,
        isLoadingMore: false,
        notifications: [...state.notifications, ...action.payload.items],
        nextCursor: action.payload.nextCursor,
      };
    case 'REFRESH_START':
      return { ...state, isRefreshing: true, error: null };
    case 'REFRESH_SUCCESS':
      return {
        ...state,
        isRefreshing: false,
        notifications: action.payload.items,
        nextCursor: action.payload.nextCursor,
        unreadCount: action.unreadCount,
      };
    case 'MARK_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, read: true } : n,
        ),
        unreadCount: Math.max(0, state.unreadCount - (state.notifications.find((n) => n.id === action.id && !n.read) ? 1 : 0)),
      };
    case 'MARK_ALL_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      };
    default:
      return state;
  }
}

const INITIAL_STATE: State = {
  notifications: [],
  nextCursor: null,
  isLoadingFirst: false,
  isLoadingMore: false,
  isRefreshing: false,
  error: null,
  unreadCount: 0,
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationCenterScreen() {
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const loadingMoreRef = useRef(false);

  // Initial load
  const loadFirst = useCallback(async () => {
    dispatch({ type: 'LOAD_FIRST_START' });
    try {
      const [page, count] = await Promise.all([
        fetchNotifications(null, 25),
        fetchUnreadCount(),
      ]);
      dispatch({ type: 'LOAD_FIRST_SUCCESS', payload: page, unreadCount: count });
    } catch {
      dispatch({ type: 'LOAD_FIRST_ERROR', error: 'Could not load notifications. Pull down to try again.' });
    }
  }, []);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  // Infinite scroll — load next page
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !state.nextCursor || state.isLoadingMore) return;
    loadingMoreRef.current = true;
    dispatch({ type: 'LOAD_MORE_START' });
    try {
      const page = await fetchNotifications(state.nextCursor, 25);
      dispatch({ type: 'LOAD_MORE_SUCCESS', payload: page });
    } catch {
      // Fail silently — user can pull to refresh if needed.
    } finally {
      loadingMoreRef.current = false;
    }
  }, [state.nextCursor, state.isLoadingMore]);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    dispatch({ type: 'REFRESH_START' });
    try {
      const [page, count] = await Promise.all([
        fetchNotifications(null, 25),
        fetchUnreadCount(),
      ]);
      dispatch({ type: 'REFRESH_SUCCESS', payload: page, unreadCount: count });
    } catch {
      dispatch({ type: 'REFRESH_SUCCESS', payload: { items: state.notifications, nextCursor: null }, unreadCount: state.unreadCount });
    }
  }, [state.notifications, state.unreadCount]);

  // Tap — mark read + route
  const handlePress = useCallback(
    async (notification: AppNotification) => {
      if (!notification.read) {
        dispatch({ type: 'MARK_READ', id: notification.id });
        try {
          await markNotificationRead(notification.id);
        } catch {
          // Revert is omitted — the optimistic update is acceptable here.
        }
      }
      routeNotification(notification, navigation);
    },
    [navigation.navigate],
  );

  // Mark all read
  const handleMarkAllRead = useCallback(async () => {
    dispatch({ type: 'MARK_ALL_READ' });
    try {
      await markAllNotificationsRead();
    } catch {
      // Silent — the optimistic mark is still useful.
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationRow notification={item} onPress={handlePress} />
    ),
    [handlePress],
  );

  const ListFooter = state.isLoadingMore ? (
    <ActivityIndicator
      color={colors.primary}
      style={styles.loadingMore}
      accessibilityLabel="Loading more notifications"
    />
  ) : null;

  const ListEmpty = !state.isLoadingFirst ? (
    <View style={styles.emptyContainer} accessibilityLiveRegion="polite">
      <Ionicons
        name={'notifications-off-outline' as IoniconName}
        size={44}
        color={colors.textMuted}
        accessibilityElementsHidden
      />
      <Text style={styles.emptyTitle}>
        {state.error ?? "You're all caught up."}
      </Text>
      {!state.error && (
        <Text style={styles.emptyBody}>
          Notifications from your coach and the platform appear here.
        </Text>
      )}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons
            name={'arrow-back-outline' as IoniconName}
            size={24}
            color={colors.textPrimary}
          />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        {state.unreadCount > 0 ? (
          <TouchableOpacity
            onPress={handleMarkAllRead}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
          >
            <Text style={[styles.markAllText, { color: colors.primary }]}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* Unread count banner */}
      {state.unreadCount > 0 && (
        <View style={[styles.unreadBanner, { backgroundColor: colors.primaryPale }]}>
          <Ionicons
            name={'notifications' as IoniconName}
            size={15}
            color={colors.primary}
            accessibilityElementsHidden
          />
          <Text style={[styles.unreadBannerText, { color: colors.primary }]}>
            {state.unreadCount} unread notification{state.unreadCount !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Loading skeleton */}
      {state.isLoadingFirst && (
        <ActivityIndicator
          style={styles.loadingFirst}
          color={colors.primary}
          accessibilityLabel="Loading notifications"
        />
      )}

      {/* List */}
      {!state.isLoadingFirst && (
        <FlatList
          data={state.notifications}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={ListEmpty}
          refreshControl={
            <RefreshControl
              refreshing={state.isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 56,
      paddingBottom: 12,
    },
    title: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 24,
      lineHeight: 29,
      color: colors.textPrimary,
      letterSpacing: 0.5,
    },
    markAllText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      lineHeight: 18,
    },
    headerSpacer: {
      width: 80,
    },
    unreadBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 10,
      borderRadius: 4,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    unreadBannerText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      lineHeight: 18,
    },
    loadingFirst: {
      marginTop: 60,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 40,
      paddingTop: 4,
      flexGrow: 1,
    },
    loadingMore: {
      paddingVertical: 20,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      paddingTop: 80,
      gap: 12,
    },
    emptyTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 17,
      lineHeight: 22,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    emptyBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
  });
