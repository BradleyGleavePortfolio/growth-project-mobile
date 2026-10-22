/**
 * RENEWAL-M H1 (RENEWAL3 style B): "Join TGP's Top Rated Coach" from the renewal pop-up or banner: the house coach's
 * name and packages (the account the server names). A package opens #836's sheet with it picked (H2); after payment
 * it says he is now the client's coach (H3), the server moves the client to him (HOUSE-JOIN-BE) and Home returns.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import PackageSelectionSheet from '../../components/PackageSelectionSheet';
import { Monogram } from '../../components/renewal/CoachMonogram';
import { oneToOneCoachingLabel } from '../../config/purchaseSurfaces';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import type { HomeStackParamList } from '../../navigation/ClientNavigator';
import { houseCoachPackagesPath, readHousePackages } from '../../lib/planRenewal';
import { priceLabel, type PurchasablePackage } from '../../lib/planTerms';
import { patchUserCache } from '../../lib/userCache';
import api from '../../services/api';
import { forestPop as fp, lightTokens, radius, typography } from '../../theme/tokens';
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';

export const HOUSE_COACH_COPY = { eyebrow: "TGP's Top Rated Coach", back: 'Back', loading: 'Loading packages', what: 'Packages' };

type Props = NativeStackScreenProps<HomeStackParamList, 'HouseCoach'>;

export default function HouseCoachScreen({ route, navigation }: Props): React.ReactElement {
  const { coach } = route.params;
  const insets = useSafeAreaInsets();
  const { refreshEntitlement } = useEntitlement();
  const [list, setList] = useState<PurchasablePackage[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<unknown>(houseCoachPackagesPath(coach.id)).then((res) => {
      const rows = readHousePackages(res?.data);
      if (rows.length) setList(rows);
      else setError(new Error('empty'));
    }, setError);
  }, [coach.id]);
  useEffect(load, [load]);

  // The renewal block names him by first name only (CONTRACT 6328688356); see the PR's Found, not fixed.
  const name = coach.firstName;
  const joined = () => { setPicked(null); void patchUserCache({ coach_id: coach.id }); void refreshEntitlement(); navigation.popToTop(); };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={[s.mast, { paddingTop: insets.top + 4 }]}>
          <HapticPressable intent="light" style={s.back} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={HOUSE_COACH_COPY.back} testID="house-coach-back">
            <Ionicons name="chevron-back" size={26} color={fp.onDeep} />
          </HapticPressable>
          <Monogram name={name} />
          <Text style={s.eyebrow}>{HOUSE_COACH_COPY.eyebrow}</Text>
          <Text style={s.name} accessibilityRole="header">{name}</Text>
        </View>
        <View style={s.body}>
          {list ? (
            <>
              <Text style={s.overline}>{oneToOneCoachingLabel(name)}</Text>
              {list.map((p) => (
                <HapticPressable key={p.id} intent="light" style={s.row} onPress={() => setPicked(p.id)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${priceLabel(p)}`} testID={`house-package-${p.id}`}>
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
      </ScrollView>
      {picked ? (
        <PackageSelectionSheet visible skipSnoozeCheck house={{ id: coach.id, name }} initialPackageId={picked} onDismiss={() => setPicked(null)} onPaymentSuccess={joined} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: lightTokens.bgPrimary }, flex: { flex: 1 },
  mast: { backgroundColor: fp.deep, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingHorizontal: 20, paddingBottom: 22, alignItems: 'center' },
  back: { alignSelf: 'flex-start', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  eyebrow: { ...typography.eyebrow, color: fp.gold, marginTop: 14, textAlign: 'center' },
  name: { ...typography.h1, color: fp.onDeep, marginTop: 4, textAlign: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 24 },
  overline: { ...typography.eyebrow, color: fp.n700, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, backgroundColor: fp.surface, borderColor: fp.sageLine, borderWidth: 1, borderRadius: radius.card, paddingVertical: 14, paddingHorizontal: 18, marginTop: 10 },
  pkg: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 17, lineHeight: 22, color: fp.ink },
  price: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 20, lineHeight: 26, color: fp.forest, marginTop: 2 },
});

