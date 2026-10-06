/**
 * CoachlessHomeSlot — the client Home surfaces for a person with no coach
 * (A1-COACHLESS; owner 10-01 13:34 "a simple banner at top of homepage" and
 * 13:41 Roman pitch).
 *
 * Gate: server flag `coachless_home` (GET /me/feature-flags; true only for a
 * student while FEATURE_COACHLESS_HOME is on), then GET /coachless/home
 * (`eligible` only while the client has no coach). Off, attached or a coach
 * account: nothing renders.
 *
 *   - Banner: the server's title, plus the owner's offer line and the
 *     featured coach card only while the featured coach accepts clients.
 *     "Use code <code>" opens the code sheet prefilled; "Enter a coach code"
 *     opens it empty.
 *   - Roman card: scripted (no AI call). Shown only while the server returns
 *     it (featured coach accepting, caps and "Not now" applied server-side).
 *     Each display is recorded once (POST /coachless/roman-card/seen); "Not
 *     now" is persisted (POST /coachless/roman-card/not-now).
 *   - After a join, the welcome moment hands off to the Day 1 plan sheet
 *     (PackageSelectionSheet) with the featured package selected, or to the
 *     coach thread.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';
import { logger } from '../../utils/logger';
import { priceLabel, purchasableFromCoachPackage } from '../../lib/planTerms';
import RomanAvatar from '../roman/RomanAvatar';
import PackageSelectionSheet from '../PackageSelectionSheet';
import CoachCodeSheet from './CoachCodeSheet';
import {
  getCoachlessHome,
  markRomanCardNotNow,
  markRomanCardSeen,
  type CoachlessHome,
} from '../../api/coachlessApi';

export const coachlessHomeKey = ['coachless', 'home'] as const;
/** Lets the code sheet finish closing before the plan sheet opens (two modals cannot animate at once on iOS). */
export const PLAN_SHEET_DELAY_MS = 450;

export default function CoachlessHomeSlot(): React.ReactElement | null {
  const { flags } = useFeatureFlags();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const enabled = flags.coachless_home && !!user && !user.coach_id;

  const query = useQuery({
    queryKey: coachlessHomeKey,
    queryFn: getCoachlessHome,
    enabled,
    staleTime: 60_000,
  });
  const home: CoachlessHome | null =
    query.data && query.data.enabled && query.data.home.eligible ? query.data.home : null;

  const [sheet, setSheet] = useState<{ code: string | null } | null>(null);
  const [plan, setPlan] = useState<{ packageId: string | null } | null>(null);
  const [romanHidden, setRomanHidden] = useState(false);
  const seenFor = useRef<string | null>(null);
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (planTimer.current) clearTimeout(planTimer.current);
    },
    [],
  );

  const roman = home && home.roman_card && home.banner?.code && !romanHidden ? home.roman_card : null;

  // One impression per displayed card (the server applies the caps).
  useEffect(() => {
    if (!roman) return;
    const id = `${roman.code}|${roman.text}`;
    if (seenFor.current === id) return;
    seenFor.current = id;
    track('coachless_roman_card_shown');
    markRomanCardSeen()
      .then((r) => {
        if (!r.visible) setRomanHidden(true);
      })
      .catch((e: unknown) => logger.warn('CoachlessHomeSlot', 'roman card seen not recorded', e));
  }, [roman]);

  const notNow = useCallback(() => {
    setRomanHidden(true);
    track('coachless_roman_card_not_now');
    markRomanCardNotNow()
      .then(() => qc.invalidateQueries({ queryKey: coachlessHomeKey }))
      .catch((e: unknown) => logger.warn('CoachlessHomeSlot', 'roman card not-now not recorded', e));
  }, [qc]);

  const refetchHome = useCallback(() => {
    void qc.invalidateQueries({ queryKey: coachlessHomeKey });
  }, [qc]);

  if (!flags.coachless_home) return null;

  return (
    <>
      {home && home.banner ? (
        <Banner
          home={home}
          onUseCode={(code) => setSheet({ code })}
          onEnterCode={() => setSheet({ code: null })}
        />
      ) : null}
      {roman ? (
        <RomanCard text={roman.text} onEnterCode={() => setSheet({ code: roman.code })} onNotNow={notNow} />
      ) : null}
      {sheet ? (
        <CoachCodeSheet
          visible
          initialCode={sheet.code}
          onClose={() => setSheet(null)}
          onAttached={refetchHome}
          onChoosePlan={(packageId) => {
            planTimer.current = setTimeout(() => setPlan({ packageId }), PLAN_SHEET_DELAY_MS);
          }}
          onMessageCoach={() => navigation.navigate('Messages')}
        />
      ) : null}
      {plan ? (
        <PackageSelectionSheet
          visible
          initialPackageId={plan.packageId}
          onDismiss={() => setPlan(null)}
          onPaymentSuccess={() => setPlan(null)}
        />
      ) : null}
    </>
  );
}

function Banner({
  home,
  onUseCode,
  onEnterCode,
}: {
  home: CoachlessHome;
  onUseCode: (code: string) => void;
  onEnterCode: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const banner = home.banner;
  if (!banner) return null;
  const coach = home.featured_coach;
  const pkg = coach?.package ? purchasableFromCoachPackage(coach.package) : null;
  const offerCode = banner.offer_text && banner.code ? banner.code : null;
  return (
    <View
      style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
      testID="coachless-banner"
      accessibilityRole="summary"
    >
      <Text style={[styles.title, { color: sc.textPrimary }]}>{banner.title}</Text>
      {offerCode ? (
        <Text style={[styles.body, { color: sc.textPrimary }]} testID="coachless-offer">
          {banner.offer_text}
        </Text>
      ) : null}
      {offerCode && coach ? (
        <View style={styles.coach} testID="coachless-featured-coach">
          {coach.photo_url ? (
            <Image source={{ uri: coach.photo_url }} style={styles.photo} accessibilityIgnoresInvertColors />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={[styles.coachName, { color: sc.textPrimary }]}>{coach.name}</Text>
            {coach.business_name ? (
              <Text style={[styles.small, { color: sc.textMuted }]}>{coach.business_name}</Text>
            ) : null}
            {coach.package ? (
              <Text style={[styles.small, { color: sc.textMuted }]}>
                {pkg ? `${coach.package.name}, ${priceLabel(pkg)}` : coach.package.name}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      {offerCode ? (
        <Pressable
          onPress={() => onUseCode(offerCode)}
          accessibilityRole="button"
          testID="coachless-use-code"
          style={({ pressed }) => [styles.cta, { backgroundColor: sc.accent, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.ctaText, { color: sc.textOnAccent }]}>{`Use code ${offerCode}`}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onEnterCode}
        accessibilityRole="button"
        testID="coachless-enter-code"
        style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.linkText, { color: sc.textPrimary }]}>
          {offerCode ? 'Enter a different code' : 'Enter a coach code'}
        </Text>
      </Pressable>
    </View>
  );
}

function RomanCard({ text, onEnterCode, onNotNow }: { text: string; onEnterCode: () => void; onNotNow: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} testID="coachless-roman-card">
      <View style={styles.head}>
        <RomanAvatar crop="neutral" size={32} />
        <Text style={[styles.eyebrow, { color: sc.textMuted }]}>FROM ROMAN</Text>
      </View>
      <Text style={[styles.body, { color: sc.textPrimary, marginTop: 12 }]}>{text}</Text>
      <View style={styles.row}>
        <Pressable onPress={onEnterCode} accessibilityRole="button" testID="coachless-roman-yes" style={styles.rowBtn}>
          <Text style={[styles.ctaText, { color: sc.accentText }]}>Enter the code</Text>
        </Pressable>
        <Pressable onPress={onNotNow} accessibilityRole="button" testID="coachless-roman-not-now" style={styles.rowBtn}>
          <Text style={[styles.ctaText, { color: sc.textMuted }]}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 0.5, borderRadius: radius.lg, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { ...typography.eyebrow, marginLeft: 12 },
  title: { ...typography.bodyMd, marginBottom: 6 },
  body: { ...typography.body, marginBottom: 12 },
  small: { ...typography.bodySmall },
  coach: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  coachName: { ...typography.bodyMd },
  photo: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  cta: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  ctaText: { ...typography.bodyMd },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 4 },
  linkText: { ...typography.bodyMd, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', marginTop: 4 },
  rowBtn: { minHeight: 44, justifyContent: 'center', marginRight: 24 },
});
