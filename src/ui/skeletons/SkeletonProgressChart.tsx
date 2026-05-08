/**
 * SkeletonProgressChart — chart screen placeholder (simple bar variant).
 *
 * Renders 6 bars of varying heights to suggest a bar chart while the
 * real chart data is being fetched. Bars are wrapped in a shared card
 * container matching the ProgressScreen / ReportScreen card style.
 *
 * No external chart library is imported — these are plain animated Views.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Skeleton } from './Skeleton';

const BAR_HEIGHTS = [56, 80, 48, 96, 64, 72];

export function SkeletonProgressChart() {
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
      {/* Chart title line */}
      <Skeleton width="45%" height={13} borderRadius={tokens.radius.md} />

      <View style={styles.chartArea}>
        {BAR_HEIGHTS.map((barH, i) => (
          <View key={i} style={[styles.barWrapper, { height: 96 }]}>
            {/* spacer above the bar so short bars sit at bottom */}
            <View style={{ flex: 1 }} />
            <Skeleton width={28} height={barH} borderRadius={tokens.radius.sm} />
          </View>
        ))}
      </View>

      {/* X-axis label row */}
      <View style={styles.labelRow}>
        {BAR_HEIGHTS.map((_, i) => (
          <Skeleton key={i} width={20} height={9} borderRadius={tokens.radius.md} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginBottom: 12,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
    gap: 6,
  },
  barWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
});

export default SkeletonProgressChart;
