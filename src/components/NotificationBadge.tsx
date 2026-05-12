// Phase 9 — NotificationBadge component.
//
// Renders a small badge showing an unread count on top of any icon.
// Count is capped at "99+" per spec. Uses theme accent (forest) as background.
// Renders nothing when count is 0 or below.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface NotificationBadgeProps {
  /** The raw unread count. Values <= 0 render nothing. */
  count: number;
}

/**
 * Small circular badge that sits in the top-right corner of its parent.
 * The parent must have `position: 'relative'` (or equivalent layout).
 *
 * Usage:
 *   <View style={{ position: 'relative' }}>
 *     <BellIcon />
 *     <NotificationBadge count={unreadCount} />
 *   </View>
 */
export default function NotificationBadge({ count }: NotificationBadgeProps): React.ReactElement | null {
  const { colors } = useTheme();

  if (count <= 0) return null;

  const label = count > 99 ? '99+' : String(count);
  // Wide badge for "99+" (3 chars), small circle for 1-2 char counts.
  const isWide = label.length > 2;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.primary },
        isWide && styles.badgeWide,
      ]}
      accessibilityLabel={`${label} unread notifications`}
      accessibilityRole="text"
    >
      <Text style={[styles.label, { color: colors.textOnPrimary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeWide: {
    minWidth: 28,
    paddingHorizontal: 5,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.3,
    fontWeight: '600',
    textAlign: 'center',
  },
});
