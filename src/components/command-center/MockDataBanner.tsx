// MockDataBanner — shown on every Coach Command Center screen when
// __USING_MOCK_DATA is true. Identical role to the sessions MockDataBanner.
//
// Doctrine: honest plain English. No emoji. No hype.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/tokens';
import { __USING_MOCK_DATA } from '../../services/commandCenterApi';

export function shouldShowMockBanner(): boolean {
  return __USING_MOCK_DATA;
}

export default function CommandCenterMockDataBanner() {
  if (!shouldShowMockBanner()) return null;
  return (
    <View
      style={styles.banner}
      accessibilityRole="none"
      testID="command-center-mock-banner"
    >
      <Text style={styles.text}>
        Preview mode — this screen shows sample data. Live data will appear
        once the Phase 8 backend service is connected.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.cream,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.camel,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: {
    ...typography.bodySmall,
    color: colors.charcoal,
    textAlign: 'center',
  },
});
