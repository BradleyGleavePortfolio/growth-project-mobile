/**
 * KeepTail (FX-CHURN, agent 170): the plan-ended line in pieces so a package name or "ended today" never splits.
 * Used by P1, K2, K3's context chip and the Clients lookup's plan-ended rows.
 */
import React from 'react';
import { PixelRatio, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { LineParts } from './planEndedData';

/**
 * "{lead} · {tail}", broken where RENEWAL3 breaks it (r2b.py:148, `%s · <span class="nw">%s</span>`): each word of the
 * lead is its own piece, the last word carries the dot ("ago ·"), and the tail is one piece, so "12-week block" or
 * "ended today" never splits. The row wraps only between pieces: the dot ends line 1 whenever "ago ·" fits there, it
 * moves down only with its word, and it never starts a line or sits alone, at any width or text size (FX5-859, LO B1).
 * The characters are the approved words exactly: no no-break characters are added. Each gap is one space wide. P1, K2
 * and the lookup rows read their own label; K3's chip reads the line as one (`DraftSheets.tsx`).
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
      {keepTailPieces(parts).map((piece, i) => (
        <Text key={i} style={[style, kt.part]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{piece}</Text>
      ))}
    </View>
  );
}

/** The pieces KeepTail draws: the lead's words, the last one with the dot, then the tail whole. */
export function keepTailPieces({ lead, tail }: LineParts): string[] {
  const words = lead.split(' ').filter(Boolean);
  const last = words.pop();
  return [...words, last ? `${last} ·` : '·', tail];
}

const kt = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', minWidth: 0 },
  part: { flexShrink: 1 },
});
