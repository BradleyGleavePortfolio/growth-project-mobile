/**
 * RENEWAL-M (RENEWAL3, style B): the coach's gold-ringed monogram on deep, and H3: the deep closing moment after the
 * house coach's package is paid. A leaf check that grows in once (320 ms, static under Reduce Motion), the success
 * title, "{name} is now your coach." beside his monogram, the success sentence and one Continue. One success haptic.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { PACKAGE_PAYMENT_COPY } from '../../lib/packagePayment';
import { forestPop as fp, motion, radius, typography } from '../../theme/tokens';
import { HapticService } from '../../ui/haptics/haptics.service';

/**
 * RENEWAL3 style B quiet fills on deep (r2b.py .cm, .plp, .dbtn2; r3.py .okc, .nowc, .cms): no theme token holds them
 * yet (src/theme is the GREY-TEXT lane's this wave), so they live here once. graphite is #168-13's small grey text on
 * light (owner: "use a nice dark grey like #2c2c2c"), colors.graphite once m#875 merges. leafInk is the banner's label on
 * leaf (r3.py .rbn .lbtn).
 */
export const renewalTone = { quiet: '#26402F', quietLine: '#4A6553', white: '#FFFFFF', graphite: '#2C2C2C', mute: '#4F5D54', leafInk: '#142019' } as const;

/**
 * The coach's monogram: initials in Cormorant on a quiet fill, a deep gap, then the gold ring outside (r2b.py .cm: 64
 * plus a 2 pt gap and a 2 pt ring, 72 across; r3.py .cms: 40 plus 2 and 1.5, 47 across). The frames paint the gap and
 * ring as box-shadow, so they take no room: the layout box is the disc (64 or 40) and the ring is drawn outside it by
 * a negative margin (m#860 FIX R3, Sol B1 / Opus C1, C2), and every place lines up as the frame does.
 */
export function Monogram({ name, size = 64, ring = 2 }: { name: string; size?: number; ring?: number }): React.ReactElement {
  const initials = name.trim().split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
  const outer = size + 4 + ring * 2;
  const bleed = -(2 + ring); // painted outside the disc's layout box
  const font = size >= 64 ? 24 : Math.round(size * 0.4);
  return (
    <View style={[s.ring, { width: outer, height: outer, borderRadius: outer / 2, borderWidth: ring, margin: bleed }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="coach-monogram">
      <View style={[s.mono, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[s.monoText, { fontSize: font, lineHeight: Math.round(font * 1.25) }]} maxFontSizeMultiplier={1}>{initials}</Text>
      </View>
    </View>
  );
}

const CHECK_MS = 320;

export function HouseJoined({ name, title, body, onContinue }: { name: string; title: string; body: string; onContinue: () => void }): React.ReactElement {
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => { void HapticService.success(); }, []);
  useEffect(() => {
    let live = true;
    // No motion until the Reduce Motion answer is known; then once.
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;
      if (reduce) grow.setValue(1);
      else Animated.timing(grow, { toValue: 1, duration: CHECK_MS, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true }).start();
    }, () => live && grow.setValue(1));
    return () => { live = false; grow.stopAnimation(); };
  }, [grow]);
  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  return (
    <View style={[s.joined, Platform.OS === 'android' && s.joinedAndroid]} testID="payment-success" accessibilityLiveRegion="polite">
      <View style={s.handle} />
      <View style={s.moment}>
        <Animated.View style={[s.check, { opacity: grow, transform: [{ scale }] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="house-joined-check">
          <Ionicons name="checkmark" size={30} color={fp.leaf} />
        </Animated.View>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        <View style={s.row} testID="payment-new-coach">
          <Monogram name={name} size={40} ring={1.5} />
          <Text style={s.text}>{`${name} is now your coach.`}</Text>
        </View>
        <Text style={s.body}>{body}</Text>
        <HapticPressable intent="medium" style={s.cta} onPress={onContinue} accessibilityRole="button" testID="payment-continue">
          <Text style={s.ctaText}>{PACKAGE_PAYMENT_COPY.continue}</Text>
        </HapticPressable>
      </View>
    </View>
  );
}

// H3 follows r3.py house_done(): grab 40 x 5, .dp 6/24/34, .okc 60, .dh 32/40 untracked white, .nowc 12 radius and
// 12/14 padding on the quiet fill, .nct 16/21, .dbd 16/24, .lbtn 1.5 moss edge 22 below. The #836 sheet opens full
// height (PackageSelectionSheet, pageSheet), so the moment sits at the bottom of it as the frame's sheet does.
const s = StyleSheet.create({
  ring: { alignSelf: 'center', borderColor: fp.gold, backgroundColor: fp.deep, alignItems: 'center', justifyContent: 'center' },
  mono: { backgroundColor: renewalTone.quiet, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', color: fp.gold, textAlign: 'center' },
  joined: { flexGrow: 1, backgroundColor: fp.deep, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 34 },
  joinedAndroid: { paddingHorizontal: 18, paddingBottom: 24 }, // .android .dp
  moment: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 6 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: renewalTone.quietLine, marginBottom: 12 },
  check: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: renewalTone.quiet, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  title: { ...typography.h1, letterSpacing: 0, color: renewalTone.white, textAlign: 'center', marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: renewalTone.quiet, borderRadius: radius.button, paddingVertical: 12, paddingHorizontal: 14, marginTop: 16 },
  text: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, letterSpacing: 0, flex: 1, color: renewalTone.white },
  body: { ...typography.body, lineHeight: 24, color: fp.onDeepMuted, textAlign: 'center', marginTop: 14 },
  cta: { alignSelf: 'stretch', minHeight: 52, borderRadius: radius.button, backgroundColor: fp.leaf, borderWidth: 1.5, borderColor: fp.moss, alignItems: 'center', justifyContent: 'center', marginTop: 22, paddingVertical: 12, paddingHorizontal: 16 },
  ctaText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 21, letterSpacing: 0, color: fp.ink, textAlign: 'center' },
});
