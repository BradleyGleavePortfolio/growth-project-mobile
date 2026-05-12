// KpiTile — single metric tile for the Coach Command Center Overview screen.
//
// Displays a numeric value with a label. Supports an optional accent colour
// for semantic colouring (e.g. red for alerts, green for active clients).
//
// Doctrine: numbers over adjectives. `value` must be a number or a formatted
// string (e.g. "71%"). No emoji.

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, typography, radius } from '../../theme/tokens';

interface KpiTileProps {
  label: string;
  value: string | number;
  /** Optional semantic colour for the value text. Defaults to ink. */
  valueColor?: string;
  /** Optional descriptor below the value (e.g. "of 14 clients"). */
  subtext?: string;
  testID?: string;
  style?: ViewStyle;
}

export default function KpiTile({
  label,
  value,
  valueColor,
  subtext,
  testID,
  style,
}: KpiTileProps) {
  return (
    <View
      style={[styles.tile, style]}
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}${subtext ? `. ${subtext}` : ''}`}
    >
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[styles.value, valueColor ? { color: valueColor } : undefined]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {subtext ? (
        <Text style={styles.subtext} numberOfLines={1}>
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 88,
    justifyContent: 'space-between',
  },
  label: {
    ...typography.eyebrow,
    color: colors.stone,
    marginBottom: spacing.xs,
  },
  value: {
    ...typography.h2,
    color: colors.ink,
  },
  subtext: {
    ...typography.bodySmall,
    color: colors.stone,
    marginTop: 2,
  },
});
