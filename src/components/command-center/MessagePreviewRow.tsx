// MessagePreviewRow — single row for the Command Center Inbox screen.
//
// Displays a client name, message preview, timestamp, and unread badge.
// Unread count must be a number, never "several" or "many".
//
// Doctrine: no emoji. No raw PII beyond display_name.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { colors, spacing, typography, radius } from '../../theme/tokens';

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface MessagePreviewRowProps {
  clientName: string;
  preview: string;
  lastMessageAt: string;
  unreadCount: number;
  isCoachTurn: boolean;
  onPress: () => void;
  testID?: string;
  style?: ViewStyle;
}

export default function MessagePreviewRow({
  clientName,
  preview,
  lastMessageAt,
  unreadCount,
  isCoachTurn,
  onPress,
  testID,
  style,
}: MessagePreviewRowProps) {
  const relTime = formatRelativeTime(lastMessageAt);

  return (
    <TouchableOpacity
      onPress={onPress}
      testID={testID ?? 'command-center-inbox-row'}
      accessibilityRole="button"
      accessibilityLabel={
        `Message thread with ${clientName}. ` +
        (unreadCount > 0 ? `${unreadCount} unread. ` : '') +
        (isCoachTurn ? 'Awaiting your reply. ' : '') +
        `Last message ${relTime}.`
      }
      style={[styles.row, style]}
      activeOpacity={0.75}
    >
      {/* Left: avatar initial */}
      <View
        style={styles.avatar}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <Text style={styles.avatarText}>
          {clientName.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Centre: name + preview */}
      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text
            style={[styles.clientName, unreadCount > 0 && styles.clientNameUnread]}
            numberOfLines={1}
          >
            {clientName}
          </Text>
          <Text style={styles.timestamp}>{relTime}</Text>
        </View>
        <Text
          style={[styles.preview, unreadCount > 0 && styles.previewUnread]}
          numberOfLines={2}
        >
          {isCoachTurn && unreadCount === 0
            ? `You: ${preview}`
            : preview}
        </Text>
      </View>

      {/* Right: unread badge */}
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {unreadCount > 99 ? '99+' : String(unreadCount)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bone,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    ...typography.bodyMd,
    color: colors.forest,
    fontSize: 16,
  },
  content: {
    flex: 1,
    marginRight: spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  clientName: {
    ...typography.bodySmall,
    color: colors.charcoal,
    flex: 1,
    marginRight: spacing.xs,
  },
  clientNameUnread: {
    color: colors.ink,
    fontFamily: 'Inter_600SemiBold',
  },
  timestamp: {
    ...typography.micro,
    color: colors.stone,
  },
  preview: {
    ...typography.bodySmall,
    color: colors.stone,
    lineHeight: 18,
  },
  previewUnread: {
    color: colors.charcoal,
  },
  badge: {
    backgroundColor: colors.forest,
    borderRadius: 12,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    ...typography.micro,
    color: colors.bone,
    lineHeight: 14,
  },
});
