/**
 * SkeletonProfileHeader — client/coach profile header placeholder.
 *
 * Layout:
 *   [large avatar circle]
 *   [name line — wide]
 *   [role/subtitle line — narrow]
 *   [two stat chips side by side]
 *
 * Matches the header block rendered in ClientDetailScreen and
 * ProfileScreen while profile data is loading.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Skeleton } from './Skeleton';

export function SkeletonProfileHeader() {
  const { tokens } = useTheme();

  return (
    <View
      style={styles.container}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Avatar */}
      <Skeleton width={72} height={72} borderRadius={999} />

      <View style={styles.gap} />

      {/* Name */}
      <Skeleton width={160} height={18} borderRadius={tokens.radius.md} />

      <View style={styles.gapSm} />

      {/* Role / subtitle */}
      <Skeleton width={96} height={12} borderRadius={tokens.radius.md} />

      <View style={styles.gapMd} />

      {/* Stat chips */}
      <View style={styles.chipRow}>
        <View
          style={[
            styles.chip,
            {
              backgroundColor: tokens.colors.cream,
              borderRadius: tokens.radius.lg,
            },
          ]}
        >
          <Skeleton width={36} height={18} borderRadius={tokens.radius.md} />
          <View style={styles.gapSm} />
          <Skeleton width={52} height={10} borderRadius={tokens.radius.md} />
        </View>

        <View
          style={[
            styles.chip,
            {
              backgroundColor: tokens.colors.cream,
              borderRadius: tokens.radius.lg,
            },
          ]}
        >
          <Skeleton width={36} height={18} borderRadius={tokens.radius.md} />
          <View style={styles.gapSm} />
          <Skeleton width={52} height={10} borderRadius={tokens.radius.md} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  gap: {
    height: 12,
  },
  gapSm: {
    height: 6,
  },
  gapMd: {
    height: 16,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 12,
  },
  chip: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    minWidth: 88,
  },
});

export default SkeletonProfileHeader;
