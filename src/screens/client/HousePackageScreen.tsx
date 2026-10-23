/**
 * SWITCH-CONFIRM-M (owner #166-5): one house coach package before payment: its price, how it bills, how long a
 * one-time plan lasts and what is included (the coach's own description: the server sends no separate list, OPERATOR
 * RULING agent 166). Its one button opens #836's sheet unchanged with this package picked (H2); the sheet pays and shows
 * that he is now the client's coach (H3), the server moves the client after payment, and Home returns.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import PackageSelectionSheet from '../../components/PackageSelectionSheet';
import { renewalTone } from '../../components/renewal/CoachMonogram';
import { HouseMasthead, houseFoot } from '../../components/renewal/HouseMasthead';
import { oneToOneCoachingLabel } from '../../config/purchaseSurfaces';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import type { HomeStackParamList } from '../../navigation/ClientNavigator';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { houseCoachName, noteHouseJoinPending } from '../../lib/planRenewal';
import { planTerms } from '../../lib/planTerms';
import { patchUserCache } from '../../lib/userCache';
import { authEvents } from '../../utils/authEvents';
import { logger } from '../../utils/logger';
import { forestPop as fp, lightTokens, typography } from '../../theme/tokens';
import { CLIENT_PLAN_COPY } from './packageDetail/ClientPlanPresentation';

export const HOUSE_PACKAGE_COPY = {
  length: 'Length',
  weeks: (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'} from the day you pay`,
  select: 'Select this plan',
};

type Props = NativeStackScreenProps<HomeStackParamList, 'HousePackage'>;

export default function HousePackageScreen({ route, navigation }: Props): React.ReactElement {
  const { coach, pkg } = route.params;
  const bottom = useSafeAreaInsets().bottom;
  const { refreshEntitlement } = useEntitlement();
  const userId = useCurrentUser()?.id;
  const [sheet, setSheet] = useState(false);
  const terms = planTerms(pkg);
  const sections = ([
    [CLIENT_PLAN_COPY.billing, [terms.firstCharge, terms.renewal]],
    [HOUSE_PACKAGE_COPY.length, [pkg.weeks ? HOUSE_PACKAGE_COPY.weeks(pkg.weeks) : null]],
    [CLIENT_PLAN_COPY.included, [pkg.description]],
  ] as const).map(([title, lines]) => [title, lines.filter((l): l is string => !!l)] as const).filter(([, lines]) => lines.length > 0);
  const name = houseCoachName(coach); // "Bradley Gleave" here, on the sheet and on H3 (owner W-168-HC)
  // m#853 FIX R1 B3: only a confirmed payment makes him the coach here; Home re-reads the account (authEvents 'login',
  // as AddCoachCodeScreen does) after the cached coach changes. A slow or pending confirmation waits for the server:
  // it is noted, and Home moves the cached coach once the server names him (planRenewal settleHouseJoin, FIX R2 B1).
  const joined = (paid: boolean) => {
    setSheet(false);
    if (paid) {
      void patchUserCache({ coach_id: coach.id })
        .catch((err: unknown) => logger.warn('HousePackage', 'user cache patch after joining failed', err))
        .then(() => authEvents.emit('login'));
    } else if (userId) {
      void noteHouseJoinPending(userId, coach.id);
    }
    void refreshEntitlement();
    navigation.popToTop();
  };

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <HouseMasthead eyebrow={oneToOneCoachingLabel(name)} title={pkg.name} onBack={() => navigation.goBack()}>
          <Text style={s.price} testID="house-package-price">{terms.price}</Text>
        </HouseMasthead>
        {sections.length ? (
          <View style={houseFoot.card}>
            {sections.map(([title, lines], i) => (
              <View key={title} style={[s.section, i > 0 && s.rule]} testID={`house-package-section-${i}`}>
                <Text style={s.overline} accessibilityRole="header">{title}</Text>
                {lines.map((line) => <Text key={line} style={s.line}>{line}</Text>)}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={[houseFoot.foot, { paddingBottom: bottom + 8 }]}>
        <HapticPressable intent="medium" style={houseFoot.primary} onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel={`${HOUSE_PACKAGE_COPY.select}, ${pkg.name}, ${terms.price}`} testID="house-package-select">
          <Text style={houseFoot.primaryText}>{HOUSE_PACKAGE_COPY.select}</Text>
        </HapticPressable>
      </View>
      {sheet ? (
        <PackageSelectionSheet visible skipSnoozeCheck house={{ id: coach.id, name }} initialPackageId={pkg.id} onDismiss={() => setSheet(false)} onPaymentSuccess={joined} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: lightTokens.bgPrimary },
  price: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 22, lineHeight: 28, color: fp.onDeep, marginTop: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  section: { paddingVertical: 16 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fp.sageLine },
  overline: { ...typography.eyebrow, lineHeight: 14, color: renewalTone.graphite, marginBottom: 6 },
  line: { ...typography.body, color: fp.ink, marginTop: 2 },
});
