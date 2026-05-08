/**
 * SkeletonWorkoutRow — placeholder matching a workout assignment row.
 *
 * Layout:
 *   [icon square] [routine name line / sets×reps line] [completed badge]
 *
 * Used on WorkoutScreen and any list that renders individual workout rows
 * while assignment data is loading.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Skeleton } from './Skeleton';

export function SkeletonWorkoutRow() {
  const { tokens } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: tokens.colors.cream,
          borderRadius: tokens.radius.lg,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Exercise icon block */}
      <Skeleton width={40} height={40} borderRadius={tokens.radius.lg} />

      {/* Name + sets×reps */}
      <View style={styles.textBlock}>
        <Skeleton width="60%" height={14} borderRadius={tokens.radius.md} />
        <View style={styles.gap} />
        <Skeleton width="35%" height={11} borderRadius={tokens.radius.md} />
      </View>

      {/* Completed badge chip */}
      <Skeleton width={56} height={22} borderRadius={999} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 12,
  },
  textBlock: {
    flex: 1,
  },
  gap: {
    height: 6,
  },
});

export default SkeletonWorkoutRow;
