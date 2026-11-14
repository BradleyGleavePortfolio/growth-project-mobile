/**
 * RomanQuoteStrip: the quote on a client turn sent as a reply (ROMAN-HOLD-M), one copy for the
 * Roman room and the read-only history. The people's chat reply strip (MessageBubble replyStub)
 * and its label, reused. Both draw it inside the room's bubble (ROMAN-HISTORY-LOOK-M) and pass no place or fill.
 * Its text shrinks, never grows (LO-958R1 C1): a short quote's card is no wider than its words on a phone too.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

export default function RomanQuoteStrip({ quote, testID, fill, style }: {
  quote: string; testID?: string; fill?: string; style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { semanticColors: c } = useTheme();
  return (
    <View
      style={[styles.quote, { backgroundColor: fill ?? c.bgPrimary }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Replying to: ${quote}`}
      testID={testID}
    >
      <View style={[styles.quoteBar, { backgroundColor: c.accent }]} />
      <Text style={[styles.quoteText, { color: c.textMuted }]} numberOfLines={2}>
        {quote}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.control,
    paddingVertical: 6, paddingHorizontal: spacing.sm, marginBottom: 6,
  },
  quoteBar: { width: 2, alignSelf: 'stretch', borderRadius: radius.control },
  quoteText: { ...typography.bodySmall, flexShrink: 1, fontSize: 13 },
});
