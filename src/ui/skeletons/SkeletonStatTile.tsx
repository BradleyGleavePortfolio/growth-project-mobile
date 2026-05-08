/**
 * SkeletonStatTile — placeholder for a dashboard stat card.
 *
 * Layout mirrors the `metricCard` shape used in CoachHomeScreen:
 *   [icon circle]
 *   [large number line]
 *   [label line]
 *
 * Designed to be rendered 2 × 2 in the metrics grid while
 * `dashboardLoading` is true.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Skeleton } from './Skeleton';

export function SkeletonStatTile() {
  const { tokens } = useTheme();

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: tokens.colors.cream,
          borderRadius: tokens.radius.lg,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Icon area */}
      <Skeleton width={40} height={40} borderRadius={999} />

      <View style={styles.spacer} />

      {/* Value */}
      <Skeleton width={48} height={22} borderRadius={tokens.radius.md} />

      <View style={styles.gapSm} />

      {/* Label */}
      <Skeleton width={64} height={11} borderRadius={tokens.radius.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    margin: 4,
    minWidth: 80,
  },
  spacer: {
    height: 10,
  },
  gapSm: {
    height: 6,
  },
});

export default SkeletonStatTile;
