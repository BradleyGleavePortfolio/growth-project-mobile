/**
 * GOAL-937-M (owner #197-E3): the drawn "Safety" tag of the deep-gold safety card (TAN-MOCK ctx#441, third panel;
 * contrast.py:68 and :80 @ 3e43773e): a shield outline then the word, deep-gold fill, cream words, under the card's line.
 * The same pill shape Needs you draws for its Safety count (NeedsYouList.tsx:286-289).
 * Hidden from screen readers: every surface that draws it already says which safety alert it is in its own words
 * and label, so what VoiceOver and TalkBack read does not change. Not pressable.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, voiceFaces } from '../../theme/tokens';
import { safetyGold } from '../../theme/safetyGold';

export default function SafetyChip({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[s.chip, style]}
      testID="safety-tag"
    >
      <Ionicons name="shield-outline" size={13} color={safetyGold.chipText} />
      <Text maxFontSizeMultiplier={1.3} style={s.word}>Safety</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radius.chip,
    backgroundColor: safetyGold.chipFill,
  },
  word: { fontFamily: voiceFaces.semibold, fontSize: 13, lineHeight: 16, color: safetyGold.chipText },
});
