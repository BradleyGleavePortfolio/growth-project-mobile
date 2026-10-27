/**
 * KeepTail (FX-CHURN, agent 170): the plan-ended line in pieces so a package name or "ended today" never splits.
 * Used by P1, K2, K3's context chip and the Clients lookup's plan-ended rows.
 */
import React from 'react';
import { PixelRatio, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { LineParts } from './planEndedData';

/**
 * "{lead} · {tail}" with the tail kept whole: it moves to the next line as one piece rather than splitting inside
 * "12-week block" or "ended today" (RENEWAL3 r3.py's `nw` span). The dot travels with the tail: the two share one row
 * that never wraps, so a break before the dot carries it down with the package and the dot never sits alone on a line,
 * at any width or text size (FX4-859, m#866 B2). The characters are the approved words exactly: no no-break characters
 * are added, so nothing reads or looks different from the owner's text. Each gap is one space wide. The dot is only
 * drawn: a screen reader reads the lead and the tail (P1, K2 and the lookup rows read their own label).
 */
export function KeepTail({ parts, style, box, maxFontSizeMultiplier, testID }: {
  parts: LineParts; style: StyleProp<TextStyle>; box?: StyleProp<ViewStyle>; maxFontSizeMultiplier?: number; testID?: string;
}) {
  if (!parts.tail) return <Text style={style} maxFontSizeMultiplier={maxFontSizeMultiplier} testID={testID}>{parts.lead}</Text>;
  const size = StyleSheet.flatten(style)?.fontSize ?? 14;
  const scale = Math.min(PixelRatio.getFontScale(), maxFontSizeMultiplier ?? Number.POSITIVE_INFINITY);
  const gap = { columnGap: Math.round(size * 0.28 * scale) };
  return (
    <View style={[kt.row, gap, box]} testID={testID}>
      <Text style={[style, kt.part]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{parts.lead}</Text>
      <View style={[kt.tail, gap]} testID={testID ? `${testID}-tail` : undefined}>
        <Text style={[style, kt.dot]} maxFontSizeMultiplier={maxFontSizeMultiplier} accessibilityElementsHidden importantForAccessibility="no">·</Text>
        <Text style={[style, kt.part]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{parts.tail}</Text>
      </View>
    </View>
  );
}
const kt = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', minWidth: 0 },
  tail: { flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  part: { flexShrink: 1 },
  dot: { flexShrink: 0 },
});
