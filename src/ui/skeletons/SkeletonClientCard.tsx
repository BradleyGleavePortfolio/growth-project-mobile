/**
 * SkeletonClientCard — placeholder matching the coach client list card shape.
 *
 * Layout mirrors ClientsListScreen's `clientCard`:
 *   [avatar circle] [name line / email line] [status dot + text] [chevron]
 *
 * Rendered in a FlatList while `isLoading` is true on ClientsListScreen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Skeleton } from './Skeleton';

export function SkeletonClientCard() {
  const { tokens } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.colors.cream,
          borderRadius: tokens.radius.lg,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Avatar circle */}
      <Skeleton width={44} height={44} borderRadius={999} />

      {/* Name + email lines */}
      <View style={styles.textBlock}>
        <Skeleton width="55%" height={14} borderRadius={tokens.radius.md} />
        <View style={styles.gap} />
        <Skeleton width="38%" height={11} borderRadius={tokens.radius.md} />
      </View>

      {/* Status badge — dot + short word */}
      <View style={styles.statusBlock}>
        <Skeleton width={8} height={8} borderRadius={999} />
        <View style={{ width: 4 }} />
        <Skeleton width={40} height={11} borderRadius={tokens.radius.md} />
      </View>

      {/* Chevron placeholder */}
      <Skeleton width={16} height={16} borderRadius={tokens.radius.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 12,
  },
  textBlock: {
    flex: 1,
  },
  gap: {
    height: 6,
  },
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
});

export default SkeletonClientCard;
