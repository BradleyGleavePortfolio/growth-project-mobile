/**
 * Neutral state rendered in place of a purchase that is not a 1:1
 * person-to-person service when the iOS build hides those purchases
 * (see src/config/purchaseSurfaces.ts). No price, no link out, no call to
 * buy elsewhere.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { NON_P2P_HIDDEN_BODY, NON_P2P_HIDDEN_TITLE } from '../../config/purchaseSurfaces';

export default function NonP2PPurchaseHidden({ testID }: { testID?: string }) {
  const { colors, tokens } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]} testID={testID ?? 'non-p2p-purchase-hidden'}>
      <Text style={[styles.title, { color: colors.textPrimary, ...tokens.typography.h2 }]} accessibilityRole="header">
        {NON_P2P_HIDDEN_TITLE}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary, ...tokens.typography.body }]}>
        {NON_P2P_HIDDEN_BODY}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { textAlign: 'center', marginBottom: 12 },
  body: { textAlign: 'center' },
});
