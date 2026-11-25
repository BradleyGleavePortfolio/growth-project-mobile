/**
 * Roman's mark for the plan-ended asks (RENEWAL3, ctx#149 r2a.py `.rmk`: K2's "Ask Roman to write", K3's sheet head, L2's
 * row button): a deep disc, a gold ring and a gold serif R. The coach Home's Roman card uses it too (NEEDS-YOU-R2 `.rav`, LS-934 B4).
 * Decorative: the button or header beside it names Roman.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { forestPop } from '../../../theme/tokens';

const RING = 1.5;

/**
 * `size` is the deep disc and `r` the R, as RENEWAL3 draws them: K2's button `.rmk` 22 with R 13 (the default), L2's
 * row button 24 with R 14, K3's head 32 with R 17 and a 2 pt deep gap. The gold ring sits outside the disc and the gap.
 */
export function RomanMark({ size = 22, r = 13, gap = 0, testID = 'roman-mark' }: { size?: number; r?: number; gap?: number; testID?: string }) {
  const outer = size + 2 * (gap + RING);
  return (
    <View
      style={[rm.disc, { width: outer, height: outer, borderRadius: outer / 2 }]} testID={testID}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    >
      <Text style={[rm.r, { fontSize: r, lineHeight: outer - 2 * RING }]} maxFontSizeMultiplier={1}>R</Text>
    </View>
  );
}
const rm = StyleSheet.create({
  // The gap between the disc and the ring is the disc's own deep (K3's 0 0 0 2px #1C3023), so one deep circle draws both.
  disc: { backgroundColor: forestPop.deep, borderWidth: RING, borderColor: forestPop.gold, alignItems: 'center', justifyContent: 'center' },
  r: { fontFamily: 'CormorantGaramond_500Medium', color: forestPop.gold, textAlign: 'center', includeFontPadding: false },
});
