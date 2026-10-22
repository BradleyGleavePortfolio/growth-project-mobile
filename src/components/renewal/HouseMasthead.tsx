/**
 * RENEWAL3 style B: the deep masthead every page of the house coach path shares (the switch confirm page, H1 and the
 * package page): Back, an optional gold monogram, a gold eyebrow and a serif title, then any hero line.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../HapticPressable';
import { Monogram } from './CoachMonogram';
import { forestPop as fp, radius, typography } from '../../theme/tokens';

type Props = { eyebrow: string; title: string; monogram?: string; onBack: () => void; children?: React.ReactNode };

export function HouseMasthead({ eyebrow, title, monogram, onBack, children }: Props): React.ReactElement {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[s.mast, { paddingTop: top + 4 }]}>
      <View style={s.backWrap}>
        <HapticPressable intent="light" style={s.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" testID="house-coach-back">
          <Ionicons name="chevron-back" size={26} color={fp.onDeep} />
        </HapticPressable>
      </View>
      {monogram ? <Monogram name={monogram} /> : null}
      <Text style={[s.eyebrow, { marginTop: monogram ? 14 : 2 }]}>{eyebrow}</Text>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

/** The one filled action of a house path page, pinned under the scroll (Forest Pop: forest is the filled action). */
export const houseFoot = StyleSheet.create({
  foot: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine },
  primary: { minHeight: 52, borderRadius: radius.button, backgroundColor: fp.forest, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  primaryText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, color: fp.onDeep, textAlign: 'center' },
  card: { backgroundColor: fp.surface, borderColor: fp.sageLine, borderWidth: 1, borderRadius: radius.card, marginHorizontal: 20, marginTop: 24, paddingHorizontal: 18 },
});

const s = StyleSheet.create({
  mast: { backgroundColor: fp.deep, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingHorizontal: 20, paddingBottom: 22, alignItems: 'center' },
  backWrap: { alignSelf: 'flex-start', marginLeft: -10 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...typography.eyebrow, color: fp.gold, textAlign: 'center' },
  title: { ...typography.h1, color: fp.onDeep, marginTop: 4, textAlign: 'center' },
});
