// Phase 9 — NotificationRow component.
//
// A single row in the notification center list. Renders read/unread state,
// a kind-based icon, title, body preview, and relative timestamp.
// Tapping the row calls onPress; the caller is responsible for routing.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import type { AppNotification, NotificationKind } from '../services/notificationsApi';
import type { IoniconName } from '../types/common';

interface NotificationRowProps {
  notification: AppNotification;
  onPress: (notification: AppNotification) => void;
}

// Map each kind to a semantically appropriate icon. No emoji — Ionicons only.
const KIND_ICON: Record<NotificationKind, IoniconName> = {
  coach:       'person-outline',
  milestone:   'document-outline',
  check_in:    'checkmark-circle-outline',
  message:     'chatbubble-outline',
  build_week:  'layers-outline',
  system:      'information-circle-outline',
  reminder:    'alarm-outline',
  tip:         'bulb-outline',
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotificationRow({ notification, onPress }: NotificationRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { read, kind, title, body, createdAt } = notification;
  const iconName = KIND_ICON[kind] ?? 'notifications-outline';

  return (
    <TouchableOpacity
      onPress={() => onPress(notification)}
      activeOpacity={0.72}
      style={[styles.row, !read && styles.rowUnread]}
      accessibilityRole="button"
      accessibilityLabel={`${read ? '' : 'Unread. '}${title}. ${body}`}
      accessibilityHint="Tap to view and mark as read"
    >
      {/* Left icon container */}
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryPale }]}>
        <Ionicons
          name={iconName}
          size={20}
          color={colors.primary}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, !read && styles.titleUnread]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text style={styles.time}>{formatRelativeTime(createdAt)}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      </View>

      {/* Unread indicator dot */}
      {!read && (
        <View
          style={[styles.unreadDot, { backgroundColor: colors.primary }]}
          accessibilityLabel="Unread"
        />
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: 4, // radius.lg
      padding: 14,
      marginBottom: 8,
      gap: 12,
    },
    rowUnread: {
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 2, // radius.md
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 2,
      flexShrink: 0,
    },
    content: {
      flex: 1,
      gap: 4,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textPrimary,
      flex: 1,
      marginRight: 8,
    },
    titleUnread: {
      fontFamily: 'Inter_500Medium',
      fontWeight: '500',
    },
    time: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      lineHeight: 14,
      color: colors.textMuted,
      flexShrink: 0,
    },
    body: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: 6,
      flexShrink: 0,
    },
  });
