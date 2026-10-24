/**
 * RENEWAL-M (RENEWAL3 style B; OPERATOR RULING v3 6328335815 on backend #1127): client Home after a plan ends, from
 * the server's `renewal` block. Pop-up (M1-M4) on Day 0, 1, 7: a centred card over the dimmed Home, only its choices
 * and "Skip for now" tappable; a plan_renewal tap re-reads the plan and opens it. Banner (B1-B2) while `banner_due`.
 * Own coach opens #836's package sheet; the house coach (only when named) opens HouseCoach (H1).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import HapticPressable from '../HapticPressable';
import { Monogram } from './CoachMonogram';
import PackageSelectionSheet from '../PackageSelectionSheet';
import { clientPaymentsApi } from '../../api/clientPaymentsApi';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import api from '../../services/api';
import { onPlanRenewalTap } from '../../services/pushTapRouter';
import { takeRenewalPopup, type Renewal, type RenewalCoach } from '../../lib/planRenewal';
import { forestPop as fp, lightTokens, neutral, radius, typography } from '../../theme/tokens';

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

// RENEWAL3 B1-B2 banner shades with no token yet (src/theme belongs to another lane this wave): the deep-2 fill, its
// 1.5 pt line and the leaf button's label ink. Banner only; the pop-up (M1-M4) keeps today's look.
const SHADE = { deep2: '#26402F', line: '#4A6553', leafInk: '#142019' } as const;

/** Banner monogram (RENEWAL3 .cms): a 40 pt deep-2 disc, a 2 pt deep gap, then a 1.5 pt gold ring; 47 pt painted.
 *  The ring is painted outside the disc's layout box (margin -3.5), as the frame's box-shadow ring: the row lays out 40. */
function BannerMonogram({ name }: { name: string }): React.ReactElement {
  const initials = name.trim().split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
  return (
    <View style={b.ring} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="renewal-banner-monogram">
      <View style={b.disc}><Text style={b.initials} maxFontSizeMultiplier={1}>{initials}</Text></View>
    </View>
  );
}

function Choices({ r, onOwn, onHouse, banner }: { r: Ended; onOwn: () => void; onHouse: (c: RenewalCoach) => void; banner?: boolean }) {
  const house = r.houseCoach && r.houseCoach.id !== r.coach?.id ? r.houseCoach : null;
  const v = banner ? b : s; // the banner's own sizes (RENEWAL3 .rbn); the pop-up's are unchanged
  return (<>
    {r.coach ? (
      <HapticPressable intent="medium" style={[v.btn, v.leaf]} onPress={onOwn} accessibilityRole="button" testID="renewal-own-coach">
        <Text style={[v.btnText, { color: banner ? SHADE.leafInk : fp.ink }]}>{RENEWAL_COPY.ownCoach(r.coach.firstName)}</Text>
      </HapticPressable>
    ) : null}
    {house ? (
      <HapticPressable intent="light" style={[v.btn, v.quiet]} onPress={() => onHouse(house)} accessibilityRole="button" testID="renewal-house-coach">
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
  const navigation = useNavigation<{ navigate: (route: 'HouseCoach', params: { coach: RenewalCoach }) => void }>();
  const [popup, setPopup] = useState<Ended | null>(null);
  const [sheet, setSheet] = useState(false);
  const [tapped, afterClose] = [useRef(false), useRef<(() => void) | null>(null)];
  const r = renewal?.state === 'ended' ? renewal : null;
  const details = useDetails(!!r);

  useEffect(() => onPlanRenewalTap(() => { tapped.current = true; void refreshEntitlement(); }), [refreshEntitlement]);

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
  const house = (coach: RenewalCoach) => close(() => navigation.navigate('HouseCoach', { coach }));
  const name = details.name ?? r.coach?.firstName ?? '';
  const ended = new Date(r.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <>
      {r.bannerDue && r.coach ? (
        <View style={[s.banner, style]} testID="renewal-banner">
          <View style={b.head}>
            <BannerMonogram name={name} />
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
        <View style={s.scrim}>
          {popup ? (
            <View style={s.card} accessibilityViewIsModal testID="renewal-popup">
              <Monogram name={name} />
              <Text style={s.coach}>{name}</Text>
              <Text style={s.title} accessibilityRole="header">{RENEWAL_COPY.title[popup.popupStep ?? 0]}</Text>
              {popup.coach ? <Text style={[s.muted, s.center]}>{RENEWAL_COPY.body(popup.coach.firstName)}</Text> : null}
              {details.pkg ? <View style={s.chip}><View style={s.dot} /><Text style={s.chipText}>{details.pkg}</Text></View> : null}
              <Choices r={popup} onOwn={own} onHouse={house} />
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

const s = StyleSheet.create({
  flex: { flex: 1 }, center: { textAlign: 'center' },
  banner: { backgroundColor: fp.deep, borderRadius: radius.card, padding: 16, marginVertical: 12 },
  muted: { ...typography.body, fontSize: 15, lineHeight: 22, color: fp.onDeepMuted },
  scrim: { flex: 1, backgroundColor: lightTokens.overlay, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: fp.deep, borderRadius: radius.sheet, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 12, alignItems: 'stretch' },
  coach: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, color: fp.gold, textAlign: 'center', marginTop: 12 },
  title: { ...typography.h1, color: fp.onDeep, textAlign: 'center', marginTop: 4, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 8, backgroundColor: fp.forest, borderRadius: radius.chip, paddingVertical: 6, paddingHorizontal: 14, marginTop: 14 },
  chipText: { ...typography.bodyMd, fontSize: 14, lineHeight: 19, color: fp.onDeep },
  btn: { minHeight: 52, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, marginTop: 12 },
  leaf: { backgroundColor: fp.leaf, borderWidth: 1.5, borderColor: fp.moss }, quiet: { backgroundColor: fp.forest, borderWidth: 1, borderColor: fp.brand400 },
  btnText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, textAlign: 'center' },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, skipText: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, color: fp.onDeepMuted },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: fp.leaf },
});

// The banner (RENEWAL3 r3.py .rbn/.cms/.rbt/.rbs; buttons .rbn .lbtn and .rbn .dbtn2): its own sizes, not the pop-up's.
const b = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ring: { width: 47, height: 47, borderRadius: 23.5, borderWidth: 1.5, borderColor: fp.gold, backgroundColor: fp.deep, alignItems: 'center', justifyContent: 'center', margin: -3.5 },
  disc: { width: 40, height: 40, borderRadius: 20, backgroundColor: SHADE.deep2, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 16, lineHeight: 20, color: fp.gold },
  title: { ...typography.h1, fontSize: 26, lineHeight: 32, letterSpacing: 0, color: neutral[0] },
  sub: { ...typography.bodySmall, lineHeight: 20, letterSpacing: 0, color: fp.onDeepMuted },
  btn: { minHeight: 48, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  // The own-coach button always leads the banner (no own coach, no banner): 14 pt under the head.
  leaf: { backgroundColor: fp.leaf, borderWidth: 1.5, borderColor: fp.moss, marginTop: 14 },
  quiet: { backgroundColor: SHADE.deep2, borderWidth: 1.5, borderColor: SHADE.line },
  btnText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, letterSpacing: 0, textAlign: 'center' },
});
