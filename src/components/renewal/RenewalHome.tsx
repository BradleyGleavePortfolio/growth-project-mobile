/**
 * RENEWAL-M (RENEWAL3 style B; OPERATOR RULING v3 6328335815 on backend #1127): client Home after a plan ends, from
 * the server's `renewal` block. Pop-up (M1-M4) on Day 0, 1, 7: a centred card over the dimmed Home, only its choices
 * and "Skip for now" tappable; a plan_renewal tap re-reads the plan and opens it. Banner (B1-B2) while `banner_due`.
 * Own coach opens #836's package sheet; the house coach (only when named) opens the one-coach confirm page first
 * (SWITCH-CONFIRM-M, owner #166-5), then HouseCoach (H1).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import HapticPressable from '../HapticPressable';
import { Monogram, renewalTone } from './CoachMonogram';
import PackageSelectionSheet from '../PackageSelectionSheet';
import { clientPaymentsApi } from '../../api/clientPaymentsApi';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import api from '../../services/api';
import { onPlanRenewalTap } from '../../services/pushTapRouter';
import { settleHouseJoin, takeRenewalPopup, type Renewal, type RenewalCoach } from '../../lib/planRenewal';
import { forestPop as fp, lightTokens, radius, shadows, typography } from '../../theme/tokens';

export const RENEWAL_COPY = {
  title: { 0: 'Your plan ended today', 1: 'Your plan ended yesterday', 7: 'Your plan ended a week ago' },
  body: (first: string) => `Pick a plan to keep working with ${first}.`,
  ownCoach: (first: string) => `View Coach ${first}'s packages`,
  houseCoach: "Join TGP's Top Rated Coach",
  skip: 'Skip for now',
  banner: 'Renew now',
  ended: (date: string) => `ended ${date}`,
};

type Ended = Extract<Renewal, { state: 'ended' }>;

/** The coach's full name and the last package bought, for the pop-up and banner (both optional). */
function useDetails(on: boolean): { name?: string; pkg?: string } {
  const [d, setD] = useState<{ name?: string; pkg?: string }>({});
  useEffect(() => {
    if (!on) return;
    let live = true;
    const coach = api.get<{ name?: unknown }>('/v1/clients/me/coach').then((r) => r?.data?.name, () => undefined);
    void Promise.all([coach, clientPaymentsApi.getPurchases(), clientPaymentsApi.getPackages()]).then(([name, buys, pkgs]) => {
      const last = buys.ok ? [...buys.data].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] : undefined;
      const pkg = last && pkgs.ok ? pkgs.data.find((p) => p.id === last.package_id)?.name : undefined;
      if (live) setD({ name: typeof name === 'string' && name.trim() ? name : undefined, pkg });
    }, () => undefined);
    return () => { live = false; };
  }, [on]);
  return d;
}

function Choices({ r, onOwn, onHouse, banner }: { r: Ended; onOwn: () => void; onHouse: (c: RenewalCoach, from: RenewalCoach | null) => void; banner?: boolean }) {
  const house = r.houseCoach && r.houseCoach.id !== r.coach?.id ? r.houseCoach : null;
  const v = banner ? b : s; // the banner's own sizes (RENEWAL3 .rbn .lbtn / .dbtn2); the pop-up's (.modal) in s
  return (<>
    {r.coach ? (
      <HapticPressable intent="medium" style={[v.btn, v.leaf]} onPress={onOwn} accessibilityRole="button" testID="renewal-own-coach">
        <Text style={[v.btnText, { color: banner ? renewalTone.leafInk : fp.ink }]}>{RENEWAL_COPY.ownCoach(r.coach.firstName)}</Text>
      </HapticPressable>
    ) : null}
    {house ? (
      <HapticPressable intent="light" style={[v.btn, v.quiet]} onPress={() => onHouse(house, r.coach)} accessibilityRole="button" testID="renewal-house-coach">
        <Text style={[v.btnText, { color: fp.onDeep }]}>{RENEWAL_COPY.houseCoach}</Text>
      </HapticPressable>
    ) : null}
  </>);
}

/** `style` places the banner in its screen (rings Home sets its own top and bottom); the pop-up ignores it. */
export default function RenewalHome({ style }: { style?: StyleProp<ViewStyle> } = {}): React.ReactElement | null {
  const { renewal, refreshEntitlement } = useEntitlement();
  const userId = useCurrentUser()?.id;
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const navigation = useNavigation<{ navigate: (route: 'HouseCoachConfirm', params: { coach: RenewalCoach; from: RenewalCoach | null }) => void }>();
  const [popup, setPopup] = useState<Ended | null>(null);
  const [sheet, setSheet] = useState(false);
  const [tapped, afterClose] = [useRef(false), useRef<(() => void) | null>(null)];
  const r = renewal?.state === 'ended' ? renewal : null;
  const details = useDetails(!!r);

  useEffect(() => onPlanRenewalTap(() => { tapped.current = true; void refreshEntitlement(); }), [refreshEntitlement]);
  // m#860 FIX R2 (Sol B1): a house payment still confirming at Continue settles on Home, on return and on each
  // entitlement read (foreground, popToTop), once the server names the house coach for this account.
  useEffect(() => { if (focused && userId) void settleHouseJoin(userId); }, [focused, userId, renewal]);

  useEffect(() => {
    if (!r || r.popupStep === null || !focused || !userId) return;
    const tap = tapped.current;
    tapped.current = false;
    let live = true;
    void takeRenewalPopup(userId, r, tap).then((open) => live && open && setPopup(r));
    return () => { live = false; };
  }, [r, focused, userId]);

  // B2: a paid plan makes the block 'active' before Continue; the open sheet stays until it is closed.
  const sheetEl = sheet ? <PackageSelectionSheet visible skipSnoozeCheck onDismiss={() => setSheet(false)} onPaymentSuccess={() => { setSheet(false); void refreshEntitlement(); }} /> : null;
  if (!r) return sheetEl;
  // iOS shows no second modal while the pop-up is still closing, so its next step waits for onDismiss.
  const runNext = () => { const next = afterClose.current; afterClose.current = null; next?.(); };
  const close = (next?: () => void) => {
    if (!popup) return next?.();
    afterClose.current = next ?? null; setPopup(null);
    if (Platform.OS !== 'ios') runNext();
  };
  const own = () => close(() => setSheet(true));
  const house = (coach: RenewalCoach, from: RenewalCoach | null) => close(() => navigation.navigate('HouseCoachConfirm', { coach, from }));
  const name = details.name ?? r.coach?.firstName ?? '';
  const ended = new Date(r.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <>
      {r.bannerDue && r.coach ? (
        <View style={[s.banner, style]} testID="renewal-banner">
          <View style={b.head}>
            <Monogram name={name} size={40} ring={1.5} />
            <View style={s.flex}>
              <Text style={b.title} accessibilityRole="header">{RENEWAL_COPY.banner}</Text>
              {/* "ended Oct 21" stays on one line (RENEWAL3 .nw): no-break spaces inside it, same words. */}
              <Text style={b.sub}>{[details.pkg, RENEWAL_COPY.ended(ended).replace(/ /g, '\u00A0')].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
          <Choices r={r} onOwn={own} onHouse={house} banner />
        </View>
      ) : null}
      <Modal visible={!!popup} transparent animationType="fade" statusBarTranslucent onRequestClose={() => close()} onDismiss={runNext} testID="renewal-modal">
        <View style={[s.scrim, ANDROID && s.scrimAndroid]}>
          {popup ? (
            <View style={[s.card, ANDROID && s.cardAndroid]} accessibilityViewIsModal testID="renewal-popup">
              <View style={s.cm}><Monogram name={name} /></View>
              <Text style={s.coach}>{name}</Text>
              <Text style={s.title} accessibilityRole="header">{RENEWAL_COPY.title[popup.popupStep ?? 0]}</Text>
              {popup.coach ? <Text style={s.body}>{RENEWAL_COPY.body(popup.coach.firstName)}</Text> : null}
              {details.pkg ? <View style={s.chip}><View style={s.dot} /><Text style={s.chipText}>{details.pkg}</Text></View> : null}
              <View style={s.choices}><Choices r={popup} onOwn={own} onHouse={house} /></View>
              <HapticPressable intent="light" style={s.skip} onPress={() => close()} accessibilityRole="button" testID="renewal-skip">
                <Text style={s.skipText}>{RENEWAL_COPY.skip}</Text>
              </HapticPressable>
            </View>
          ) : null}
        </View>
      </Modal>
      {sheetEl}
    </>
  );
}

// r2b.py / r3.py style B: .modal, .cm, .cmn, .dh, .dbd, .plp, .lbtn (22 below), .dbtn2 (10 below, quiet fill); the
// banner .rbn with .cms, .rbt 26/32, .rbs 14/20 and 48 pt choices (14 and 8 below). .android .modal is 16 from the
// edges with 24/18/10 inside; the frame's lift is the theme's modal shadow (shadows.lg).
const ANDROID = Platform.OS === 'android';
const s = StyleSheet.create({
  flex: { flex: 1 },
  banner: { backgroundColor: fp.deep, borderRadius: radius.card, padding: 16, marginVertical: 12 },
  scrim: { flex: 1, backgroundColor: lightTokens.overlay, justifyContent: 'center', padding: 20 }, scrimAndroid: { paddingHorizontal: 16 },
  card: { backgroundColor: fp.deep, borderRadius: radius.sheet, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 12, alignItems: 'stretch', ...shadows.lg },
  cardAndroid: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 10 },
  cm: { marginTop: 6 }, // r2b.py .cm: 6 below the card's 28, the ring drawn 4 outside the 64 disc
  coach: { ...typography.bodyMd, fontSize: 14, lineHeight: 19, letterSpacing: 0.3, color: fp.gold, textAlign: 'center', marginTop: 12 },
  title: { ...typography.h1, letterSpacing: 0, color: renewalTone.white, textAlign: 'center', marginTop: 6 },
  body: { ...typography.body, lineHeight: 24, color: fp.onDeepMuted, textAlign: 'center', marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 8, backgroundColor: renewalTone.quiet, borderRadius: radius.chip, paddingVertical: 6, paddingHorizontal: 14, marginTop: 14 },
  chipText: { ...typography.bodyMd, fontSize: 13.5, lineHeight: 18, letterSpacing: 0, color: fp.onDeep },
  choices: { marginTop: 12 },
  btn: { minHeight: 52, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, marginTop: 10 },
  leaf: { backgroundColor: fp.leaf, borderWidth: 1.5, borderColor: fp.moss }, quiet: { backgroundColor: renewalTone.quiet, borderWidth: 1.5, borderColor: renewalTone.quietLine },
  btnText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, textAlign: 'center' },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, skipText: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, color: fp.onDeepMuted },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: fp.leaf },
});

// The banner (RENEWAL3 r3.py .rbn/.cms/.rbt/.rbs; buttons .rbn .lbtn and .rbn .dbtn2): its own sizes, not the pop-up's.
const b = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 }, // the shared Monogram lays out its 40 pt disc; the ring is painted outside
  title: { ...typography.h1, fontSize: 26, lineHeight: 32, letterSpacing: 0, color: renewalTone.white },
  sub: { ...typography.bodySmall, lineHeight: 20, letterSpacing: 0, color: fp.onDeepMuted },
  btn: { minHeight: 48, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  // The own-coach button always leads the banner (no own coach, no banner): 14 pt under the head.
  leaf: { backgroundColor: fp.leaf, borderWidth: 1.5, borderColor: fp.moss, marginTop: 14 },
  quiet: { backgroundColor: renewalTone.quiet, borderWidth: 1.5, borderColor: renewalTone.quietLine },
  btnText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, letterSpacing: 0, textAlign: 'center' },
});
