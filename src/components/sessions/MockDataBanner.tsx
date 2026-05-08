// MockDataBanner — shown on every sessions screen when the adapter is
// returning preview data instead of live backend data.
//
// Doctrine: the banner must be honest in plain English. It never disguises
// that the data is sample data. No emoji. No hype.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/tokens';
import { __USING_MOCK_DATA } from '../../services/sessions/sessionsClient';
import { sessionsFlags } from '../../config/sessionsFlags';

// Show the banner when the feature flag is ON (user sees a screen) but the
// HTTP adapter is still backed by mock data, not a live backend.
export function shouldShowMockBanner(): boolean {
  return sessionsFlags.SESSIONS_ENABLED && __USING_MOCK_DATA;
}

export default function MockDataBanner() {
  if (!shouldShowMockBanner()) return null;
  return (
    <View
      style={styles.banner}
      accessibilityRole="none"
      testID="mock-data-banner"
    >
      <Text style={styles.text}>
        Preview mode — this screen shows sample data. Live data will appear
        once the backend scheduling service is connected.
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
