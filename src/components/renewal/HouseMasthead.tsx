/**
 * RENEWAL3 style B: the deep masthead every page of the house coach path shares (the switch confirm page, H1 and the
 * package page): Back, an optional gold monogram, a gold eyebrow and a serif title, then any hero line. While the page is
 * focused the status bar is the masthead's deep with light icons (StatusBarBand), as the frames draw it (.surf .sb).
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../HapticPressable';
import { useStatusBarBand } from '../StatusBarBand';
import { Monogram, renewalTone } from './CoachMonogram';
import { forestPop as fp, radius, typography } from '../../theme/tokens';

const ANDROID = Platform.OS === 'android';
export const HOUSE_MAST_COPY = { back: 'Back' };

type Props = { eyebrow: string; title: string; monogram?: string; onBack: () => void; children?: React.ReactNode };

export function HouseMasthead({ eyebrow, title, monogram, onBack, children }: Props): React.ReactElement {
  const top = useSafeAreaInsets().top;
  useStatusBarBand(fp.deep);
  return (
    <View style={[s.mast, ANDROID && s.mastAndroid, { paddingTop: top, paddingBottom: monogram ? 24 : ANDROID ? 20 : 22 }]}>
      <View style={s.backWrap}>
        <HapticPressable intent="light" style={s.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={HOUSE_MAST_COPY.back} testID="house-coach-back">
          <Ionicons name="chevron-back" size={26} color={fp.onDeep} />
        </HapticPressable>
      </View>
      {monogram ? <View style={s.mono}><Monogram name={monogram} /></View> : null}
      <Text style={[s.eyebrow, { marginTop: monogram ? 14 : 2 }]}>{eyebrow}</Text>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

/**
 * The one filled action of a house path page, pinned under the scroll (Forest Pop: forest is the filled action). The
 * pages sit above the client tab bar, whose height already holds the bottom inset (ClientNavigator tabBarStyle, 64 plus
 * the inset), so the foot adds no inset of its own (m#860 FIX R3, Opus C4).
 */
export const houseFoot = StyleSheet.create({
  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine },
  primary: { minHeight: 52, borderRadius: radius.button, backgroundColor: fp.forest, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  primaryText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, color: fp.onDeep, textAlign: 'center' },
  card: { backgroundColor: renewalTone.white, borderColor: fp.sageLine, borderWidth: 1, borderRadius: radius.card, marginHorizontal: 20, marginTop: 24, paddingHorizontal: 16 },
});

const s = StyleSheet.create({
  // r2b.py .dmast (0 20 22, Android 0 16 20; H1 24 on both), its 52 pt Back row, .cm 6 below it, .gol (Inter 600 11/14, 1.6 tracking) and .dh.
  mast: { backgroundColor: fp.deep, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingHorizontal: 20, alignItems: 'center' },
  mastAndroid: { paddingHorizontal: 16 },
  backWrap: { alignSelf: 'flex-start', minHeight: 52, justifyContent: 'center', marginLeft: -10 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mono: { marginTop: 6 },
  eyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 14, letterSpacing: 1.6, color: fp.gold, textAlign: 'center' },
  title: { ...typography.h1, letterSpacing: 0, color: renewalTone.white, marginTop: 6, textAlign: 'center' },
});
