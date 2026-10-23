/**
 * Roman's mark for the plan-ended asks (RENEWAL3, ctx#149 r2a.py `.rmk`: K2's "Ask Roman to write", K3's sheet head, L2's
 * row button): a deep disc, a gold ring and a gold serif R. Only these use it; RomanAvatar elsewhere is unchanged.
 * Decorative: the button or header beside it names Roman.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { forestPop } from '../../../theme/tokens';

export function RomanMark({ size = 25 }: { size?: number }) {
  return (
    <View
      style={[rm.disc, { width: size, height: size, borderRadius: size / 2 }]} testID="roman-mark"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    >
      <Text style={[rm.r, { fontSize: Math.round(size * 0.56), lineHeight: size - 3 }]} maxFontSizeMultiplier={1}>R</Text>
    </View>
  );
}
const rm = StyleSheet.create({
  disc: { backgroundColor: forestPop.deep, borderWidth: 1.5, borderColor: forestPop.gold, alignItems: 'center', justifyContent: 'center' },
  r: { fontFamily: 'CormorantGaramond_500Medium', color: forestPop.gold, textAlign: 'center', includeFontPadding: false },
});
