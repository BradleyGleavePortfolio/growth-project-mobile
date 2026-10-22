/**
 * SWITCH-CONFIRM-M (owner #166-5): the first page of the house coach path ("Join TGP's Top Rated Coach" from the
 * renewal pop-up or banner). It says a client has one coach at a time in v1 and that the current coach stops being
 * theirs once they pay. Continue opens the house coach's packages (H1); Not now goes back and changes nothing. Nothing
 * here calls the server: the move happens only after payment, on the server (HOUSE-JOIN-BE).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import { HouseMasthead, houseFoot } from '../../components/renewal/HouseMasthead';
import type { HomeStackParamList } from '../../navigation/ClientNavigator';
import { forestPop as fp, lightTokens, typography } from '../../theme/tokens';
import { HOUSE_COACH_COPY } from './HouseCoachScreen';

export const HOUSE_CONFIRM_COPY = {
  title: 'One coach at a time',
  oneCoach: 'For now, each TGP client has one coach at a time.',
  stops: (name: string | null) => `${name ?? 'Your current coach'} stops being your coach once you pay, and no longer sees your logs.`,
  continue: 'Continue',
  notNow: 'Not now',
};

type Props = NativeStackScreenProps<HomeStackParamList, 'HouseCoachConfirm'>;

export default function HouseCoachConfirmScreen({ route, navigation }: Props): React.ReactElement {
  const { coach, from } = route.params;
  const bottom = useSafeAreaInsets().bottom;
  const points: [keyof typeof Ionicons.glyphMap, string][] = [
    ['person-outline', HOUSE_CONFIRM_COPY.oneCoach],
    ['eye-off-outline', HOUSE_CONFIRM_COPY.stops(from?.firstName ?? null)],
  ];
  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <HouseMasthead eyebrow={HOUSE_COACH_COPY.eyebrow} title={HOUSE_CONFIRM_COPY.title} monogram={coach.firstName} onBack={() => navigation.goBack()} />
        <View style={houseFoot.card}>
          {points.map(([icon, text], i) => (
            <View key={icon} style={[s.point, i > 0 && s.rule]}>
              <View style={s.dot}><Ionicons name={icon} size={20} color={fp.forest} /></View>
              <Text style={s.text} testID={`house-confirm-point-${i}`}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[houseFoot.foot, { paddingBottom: bottom + 8 }]}>
        <HapticPressable intent="medium" style={houseFoot.primary} onPress={() => navigation.navigate('HouseCoach', { coach })} accessibilityRole="button" accessibilityLabel={HOUSE_CONFIRM_COPY.continue} testID="house-confirm-continue">
          <Text style={houseFoot.primaryText}>{HOUSE_CONFIRM_COPY.continue}</Text>
        </HapticPressable>
        <HapticPressable intent="light" style={s.quiet} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={HOUSE_CONFIRM_COPY.notNow} testID="house-confirm-not-now">
          <Text style={s.quietText}>{HOUSE_CONFIRM_COPY.notNow}</Text>
        </HapticPressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: lightTokens.bgPrimary },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 16 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine },
  dot: { width: 36, height: 36, borderRadius: 18, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.body, flex: 1, color: fp.ink, paddingTop: 5 },
  quiet: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  quietText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: fp.forest },
});
