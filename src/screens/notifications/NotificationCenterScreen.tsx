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
//   - Neutral empty state and notification preferences

import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SkeletonList } from '../../ui/skeletons/Skeleton';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { Headline, Overline, QuietTextButton, Screen, ScreenTopBar, TextLink } from '../../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography } from '../../theme/tokens';
import {
  AppNotification,
  NotificationPage,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../services/notificationsApi';
import { routeInAppNotification } from '../../services/pushTapRouter';

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : days < 7 ? `${days}d ago`
    : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Deep-link routing table ──────────────────────────────────────────────────
// Maps notification.actionScreen to a navigate() call. Keep in sync with
// README.md#deep-link-routing-table.
//
// S-SCHED-2: rows route through the push router's role-aware, allow-listed
// table first (a client booking row opens Calendar > session, a coach row
// opens the booking inbox, flag-off destinations land here). Only when the
// app navigator is not ready does the screen fall back to a direct navigate.

type NavWithNavigate = Pick<NavigationProp<ParamListBase>, 'navigate'>;

export function routeNotification(
  notification: AppNotification,
  nav: NavWithNavigate,
): void {
  const screen = notification.actionScreen;
  if (!screen) return;
  if (routeInAppNotification(screen, notification.actionParams)) return;
  // Param types are enforced by the navigator param lists. actionScreen values
  // come from a constrained server enum, not user input.
  nav.navigate(screen, notification.actionParams);
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
  | { type: 'LOAD_MORE_ERROR' }
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
      return { ...state, isLoadingMore: true, error: null };
    case 'LOAD_MORE_ERROR':
      return { ...state, isLoadingMore: false, error: 'Could not load more notifications.' };
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
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
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
      dispatch({ type: 'LOAD_FIRST_ERROR', error: 'Could not load notifications. Check the connection, then try again.' });
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
      dispatch({ type: 'LOAD_MORE_ERROR' });
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
    [navigation],
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
      <HapticPressable intent="light" onPress={() => handlePress(item)} style={styles.row}
        disabled={item.read && !item.actionScreen}
        accessibilityRole={item.read && !item.actionScreen ? 'text' : 'button'}
        accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}`}
        accessibilityHint={item.actionScreen ? 'Open notification' : item.read ? undefined : 'Mark as read'}>
        <View style={styles.rowContent}>
          <View style={styles.rowTitleLine}>
            {!item.read && <View style={styles.unreadDot} accessibilityLabel="Unread" />}
            <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]}>{item.title}</Text>
            <Text style={styles.rowTime}>{relativeTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.rowBody}>{item.body}</Text>
        </View>
      </HapticPressable>
    ),
    [handlePress, styles],
  );

  // A failed load says what happened and offers a quiet retry in place.
  const ListFooter = state.isLoadingMore ? (
    <ActivityIndicator
      color={colors.primary}
      style={styles.loadingMore}
      accessibilityLabel="Loading more notifications"
    />
  ) : state.error && state.notifications.length > 0 ? (
    <View style={styles.inlineError} accessibilityLiveRegion="polite">
      <Text style={styles.emptyBody}>{state.error}</Text>
      <QuietTextButton label="Try again" onPress={() => { void loadMore(); }} testID="notification-more-retry" />
    </View>
  ) : null;

  const ListEmpty = !state.isLoadingFirst ? (
    <View style={styles.emptyContainer} accessibilityLiveRegion="polite">
      <Text style={styles.emptyTitle}>{state.error ?? 'No notifications.'}</Text>
      {state.error ? (
        <QuietTextButton label="Try again" onPress={() => { void loadFirst(); }} testID="notification-retry" />
      ) : (
        <Text style={styles.emptyBody}>Coach notes, reminders and milestones arrive here.</Text>
      )}
    </View>
  ) : null;

  return (
    <Screen
      edges={['top']}
      scroll={false}
      testID="notification-center"
      contentStyle={styles.frame}
      header={(
        <ScreenTopBar
          onBack={() => navigation.goBack()}
          backLabel="Go back"
          trailing={state.unreadCount > 0 ? (
            <TextLink label="Mark all read" size="small" tone="accent" underline={false}
              accessibilityHint="Marks every notification as read" onPress={() => { void handleMarkAllRead(); }} />
          ) : undefined}
        />
      )}
    >
      <View style={styles.titleBlock}>
        <Headline level="h1">Notifications</Headline>
        <Overline style={styles.overline}>
          {state.unreadCount > 0
            ? `${state.unreadCount} unread notification${state.unreadCount !== 1 ? 's' : ''}`
            : 'Nothing unread'}
        </Overline>
        <TextLink label="Notification preferences" size="small" align="start"
          onPress={() => navigation.navigate('NotificationPreferences')} />
      </View>

      {state.isLoadingFirst && <SkeletonList count={8} />}

      {!state.isLoadingFirst && (
        <FlatList
          testID="notification-list"
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
              testID="notification-refresh"
              refreshing={state.isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    frame: { paddingHorizontal: 0 },
    titleBlock: { paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 12 },
    overline: { marginTop: 4, marginBottom: 8, fontVariant: ['tabular-nums'] },
    row: { minHeight: layout.rowMinHeight, paddingVertical: 18,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    rowContent: { flex: 1, gap: 6 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: { ...typography.bodySmall, fontSize: 15, color: colors.textPrimary, flex: 1 },
    rowTitleUnread: { fontFamily: 'Inter_500Medium', fontWeight: '500' },
    rowBody: { ...typography.bodySmall, fontSize: 14, color: colors.textSecondary },
    rowTime: { ...typography.bodySmall, fontSize: 13, color: colors.textMuted, fontVariant: ['tabular-nums'] },
    unreadDot: { width: 6, height: 6, borderRadius: radius.chip, backgroundColor: colors.primary },
    listContent: {
      paddingHorizontal: layout.gutter,
      paddingBottom: 40,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      flexGrow: 1,
    },
    loadingMore: { paddingVertical: 20 },
    inlineError: { paddingVertical: 16, gap: 4 },
    emptyContainer: { flex: 1, paddingTop: 48, gap: 8 },
    emptyTitle: { ...typography.h3, color: colors.textPrimary },
    emptyBody: { ...typography.bodySmall, color: colors.textSecondary },
  });
