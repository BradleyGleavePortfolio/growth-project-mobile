/**
 * Two small pieces the plan-ended screens share (the Home's list K1-K3 and the Clients lookup's filter L2).
 *
 * WholeLine draws an approved line exactly as written, in pieces that never break inside: RN3-30 "Plan ended 3 days ago ·
 * 12-week block" comes as "Plan ended 3 days ago · " and "12-week block", so on a narrow screen or at large text the whole
 * package moves to the next line (RENEWAL3 L2, its mockup's nowrap package) instead of breaking at its space or hyphen. The
 * characters are the approved ones: no non-breaking spaces or hyphens are put in (LO-866 B2).
 *
 * RomanRingMark is Roman's mark as RENEWAL3 K2, K3 and L2 draw it: a forest disc with a gold ring and a gold serif R.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { forestPop } from '../../../theme/tokens';

export function WholeLine({ parts, style, boxStyle, testID }: { parts: readonly string[]; style: StyleProp<TextStyle>; boxStyle?: StyleProp<ViewStyle>; testID?: string }) {
  if (parts.length <= 1) return <Text style={style} testID={testID}>{parts[0] ?? ''}</Text>;
  return (
    <View style={[ws.wrap, boxStyle]} testID={testID}>
      {parts.map((p, i) => <Text key={i} style={[style, ws.part]}>{p}</Text>)}
    </View>
  );
}

/** The line a WholeLine draws, as one string (tests and screen-reader labels read it whole). */
export const wholeText = (parts: readonly string[]) => parts.join('');

export function RomanRingMark({ size = 26, testID }: { size?: number; testID?: string }) {
  return (
    <View
      style={[rs.disc, { width: size, height: size, borderRadius: size / 2 }]}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID={testID}
    >
      <Text style={[rs.r, { fontSize: Math.round(size * 0.56), lineHeight: Math.round(size * 0.72) }]} maxFontSizeMultiplier={1}>R</Text>
    </View>
  );
}

const ws = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0, flexShrink: 1 },
  part: { flexShrink: 1, maxWidth: '100%' },
});

const rs = StyleSheet.create({
  disc: { backgroundColor: forestPop.deep, borderWidth: 1.5, borderColor: forestPop.gold, alignItems: 'center', justifyContent: 'center' },
  r: { fontFamily: 'CormorantGaramond_500Medium', color: forestPop.gold, textAlign: 'center', includeFontPadding: false },
});
