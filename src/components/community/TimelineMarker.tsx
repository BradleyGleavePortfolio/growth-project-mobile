/**
 * TimelineMarker — a "this lives on the client's plan timeline" marker
 * (product plan §2.2: every message lives on a timeline of the client's plan,
 * not in a chat blob). Renders a small dated divider used between feed sections
 * (e.g. "This week", "Workout feedback"). Read-only in v1-5.
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing } from '../../theme/tokens';

export interface TimelineMarkerProps {
  /** Marker label, e.g. "This week" or "Workout feedback". */
  label: string;
  testID?: string;
}

export default function TimelineMarker({
  label,
  testID,
}: TimelineMarkerProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View style={styles.row} testID={testID} accessibilityRole="text">
      <View style={[styles.line, { backgroundColor: semanticColors.border }]} />
      <Text style={[styles.label, { color: semanticColors.textMuted }]}>
        {label}
      </Text>
      <View style={[styles.line, { backgroundColor: semanticColors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
