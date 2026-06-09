/**
 * UnreadBadge — compact unread count pill for the Community tab + sub-tabs.
 *
 * Standardized on semanticColors / tokens.ts (NOT legacy ThemeColors). Renders
 * nothing when count <= 0. Caps display at "99+". The parent must provide a
 * `position: 'relative'` layout when used as a corner badge.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';

export interface UnreadBadgeProps {
  /** Raw unread count. Values <= 0 render nothing. */
  count: number;
  /** When true, absolutely position in the top-right of the parent. */
  corner?: boolean;
  testID?: string;
}

export default function UnreadBadge({
  count,
  corner = true,
  testID,
}: UnreadBadgeProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  if (count <= 0) return null;

  const label = count > 99 ? '99+' : String(count);
  const isWide = label.length > 2;

  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        corner && styles.corner,
        isWide && styles.wide,
        { backgroundColor: semanticColors.accent },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${label} unread`}
    >
      <Text
        style={[styles.label, { color: semanticColors.textOnAccent }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  corner: {
    position: 'absolute',
    top: -4,
    right: -6,
  },
  wide: {
    minWidth: 28,
    paddingHorizontal: 5,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.3,
    fontWeight: '600',
    textAlign: 'center',
  },
});
