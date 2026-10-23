/**
 * RENEWAL-M H1 (RENEWAL3 style B): the house coach's full name, what joining him includes, and his packages (the account
 * the server names), reached from SWITCH-CONFIRM-M's confirm page. A package opens its own page (HousePackage), whose
 * button opens #836's sheet (H2); after payment the sheet says he is now the client's coach (H3), the server moves the
 * client (HOUSE-JOIN-BE) and Home returns.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import { HouseMasthead } from '../../components/renewal/HouseMasthead';
import { oneToOneCoachingLabel } from '../../config/purchaseSurfaces';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import type { HomeStackParamList } from '../../navigation/ClientNavigator';
import { houseCoachName, houseCoachPackagesPath, readHousePackages, type HousePackage } from '../../lib/planRenewal';
import { priceLabel } from '../../lib/planTerms';
import api from '../../services/api';
import { forestPop as fp, lightTokens, radius, typography } from '../../theme/tokens';
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';

export const HOUSE_COACH_COPY = { eyebrow: "TGP's Top Rated Coach", back: 'Back', loading: 'Loading packages', what: 'Packages' };
/** W-168-HC, HC-2 to HC-7 (owner-approved, m#853 6353883504): what joining the house coach includes. */
export const HOUSE_INCLUDES_COPY = {
  heading: 'Includes',
  rows: (firstName: string) => ['Personalized workout plans', '1:1 check-ins', `Direct access to ${firstName}`, 'Customized meal plans', 'Advanced AI usage'],
};

type Props = NativeStackScreenProps<HomeStackParamList, 'HouseCoach'>;

export default function HouseCoachScreen({ route, navigation }: Props): React.ReactElement {
  const { coach } = route.params;
  const insets = useSafeAreaInsets();
  const { refreshEntitlement } = useEntitlement();
  const [list, setList] = useState<HousePackage[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<unknown>(houseCoachPackagesPath(coach.id)).then((res) => {
      const rows = readHousePackages(res?.data);
      return rows.length ? setList(rows) : setError(new Error('empty'));
    }, (err: unknown) => {
      setError(err);
      // C1: a 404 is the server closing the house offer; re-read the plan so Home drops the stale choice.
      if ((err as { response?: { status?: number } })?.response?.status === 404) void refreshEntitlement();
    });
  }, [coach.id, refreshEntitlement]);
  useEffect(load, [load]);

  const name = houseCoachName(coach); // "Bradley Gleave", monogram "BG" (owner W-168-HC; backend #1142 full_name)

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <HouseMasthead eyebrow={HOUSE_COACH_COPY.eyebrow} title={name} monogram={name} onBack={() => navigation.goBack()} />
        <View style={s.body}>
          <Text style={s.overline} accessibilityRole="header">{HOUSE_INCLUDES_COPY.heading}</Text>
          <View style={s.card} testID="house-coach-includes">
            {HOUSE_INCLUDES_COPY.rows(coach.firstName).map((line, i) => (
              <View key={line} style={[s.include, i > 0 && s.rule]}>
                <View style={s.dot} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                  <Ionicons name="checkmark" size={16} color={fp.forest} />
                </View>
                <Text style={s.includeText}>{line}</Text>
              </View>
            ))}
          </View>
          <View style={s.next}>
            {list ? (
              <>
                <Text style={s.overline}>{oneToOneCoachingLabel(name)}</Text>
                {list.map((p) => (
                  <HapticPressable key={p.id} intent="light" style={s.row} onPress={() => navigation.navigate('HousePackage', { coach, pkg: p })} accessibilityRole="button" accessibilityLabel={`${p.name}, ${priceLabel(p)}`} testID={`house-package-${p.id}`}>
                    <View style={s.flex}>
                      <Text style={s.pkg}>{p.name}</Text>
                      <Text style={s.price}>{priceLabel(p)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={fp.n700} />
                  </HapticPressable>
                ))}
              </>
            ) : error ? (
              <QuietError message={loadFailureMessage(error, HOUSE_COACH_COPY.what)} onRetry={load} testID="house-coach-error" />
            ) : (
              <QuietLoading label={HOUSE_COACH_COPY.loading} testID="house-coach-loading" />
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: lightTokens.bgPrimary }, flex: { flex: 1 },
  body: { paddingHorizontal: 20, paddingTop: 24 },
  overline: { ...typography.eyebrow, color: fp.n700, marginBottom: 4 },
  next: { marginTop: 28 },
  card: { backgroundColor: fp.surface, borderColor: fp.sageLine, borderWidth: 1, borderRadius: radius.card, paddingHorizontal: 18, marginTop: 6 },
  include: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48, paddingVertical: 10 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine },
  dot: { width: 28, height: 28, borderRadius: 14, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  includeText: { ...typography.body, flex: 1, color: fp.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, backgroundColor: fp.surface, borderColor: fp.sageLine, borderWidth: 1, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 18, marginTop: 10 },
  pkg: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 17, lineHeight: 22, color: fp.ink },
  price: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 20, lineHeight: 26, color: fp.forest, marginTop: 2 },
});

