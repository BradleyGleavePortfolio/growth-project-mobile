/**
 * RomanQuoteStrip: the quote on a client turn sent as a reply (ROMAN-HOLD-M), one copy for the
 * Roman room and the read-only history. The people's chat reply strip (MessageBubble replyStub)
 * and its label, reused.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

export default function RomanQuoteStrip({ quote, testID }: { quote: string; testID?: string }): React.ReactElement {
  const { semanticColors: c } = useTheme();
  return (
    <View
      style={[styles.quote, { backgroundColor: c.bgPrimary }]}
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
  quoteText: { ...typography.bodySmall, flex: 1, fontSize: 13 },
});
