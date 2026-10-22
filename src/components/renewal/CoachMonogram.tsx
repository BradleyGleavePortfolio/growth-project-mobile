/** RENEWAL-M (RENEWAL3, style B): the coach's gold-ringed monogram on deep, and H3's "{name} is now your coach." */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { forestPop as fp, radius, typography } from '../../theme/tokens';

export function Monogram({ name, size = 64 }: { name: string; size?: number }): React.ReactElement {
  const initials = name.trim().split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[s.mono, { width: size, height: size, borderRadius: size / 2 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[s.monoText, { fontSize: size * 0.38, lineHeight: size * 0.5 }]} maxFontSizeMultiplier={1}>{initials}</Text>
    </View>
  );
}

export function NewCoachLine({ name }: { name?: string }): React.ReactElement | null {
  return name ? (
    <View style={s.row} testID="payment-new-coach">
      <Monogram name={name} size={44} />
      <Text style={s.text}>{`${name} is now your coach.`}</Text>
    </View>
  ) : null;
}

const s = StyleSheet.create({
  mono: { alignSelf: 'center', backgroundColor: fp.forest, borderWidth: 2, borderColor: fp.gold, alignItems: 'center', justifyContent: 'center' },
  monoText: { ...typography.h2, color: fp.gold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: fp.deep, borderRadius: radius.card, padding: 14, marginVertical: 12 },
  text: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', flex: 1, color: fp.onDeep },
});
