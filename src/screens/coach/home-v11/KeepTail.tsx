/**
 * KeepTail (FX-CHURN, agent 170): the plan-ended line in pieces so a package name or "ended today" never splits.
 * Used by P1, K2, K3's context chip and the Clients lookup's plan-ended rows.
 */
import React from 'react';
import { PixelRatio, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { LineParts } from './planEndedData';

/**
 * "{lead} · {tail}" with the tail kept whole: it moves to the next line as one piece rather than splitting inside
 * "12-week block" or "ended today" (RENEWAL3 r3.py's `nw` span). The characters are the approved words exactly: no
 * no-break characters are added, so nothing reads or looks different from the owner's text. The gap is one space wide.
 */
export function KeepTail({ parts, style, box, maxFontSizeMultiplier, testID }: {
  parts: LineParts; style: StyleProp<TextStyle>; box?: StyleProp<ViewStyle>; maxFontSizeMultiplier?: number; testID?: string;
}) {
  if (!parts.tail) return <Text style={style} maxFontSizeMultiplier={maxFontSizeMultiplier} testID={testID}>{parts.lead}</Text>;
  const size = StyleSheet.flatten(style)?.fontSize ?? 14;
  const scale = Math.min(PixelRatio.getFontScale(), maxFontSizeMultiplier ?? Number.POSITIVE_INFINITY);
  return (
    <View style={[kt.row, { columnGap: Math.round(size * 0.28 * scale) }, box]} testID={testID}>
      <Text style={[style, kt.part]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{`${parts.lead} ·`}</Text>
      <Text style={[style, kt.part]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{parts.tail}</Text>
    </View>
  );
}
const kt = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', minWidth: 0 }, part: { flexShrink: 1 } });
