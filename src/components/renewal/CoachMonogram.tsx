/**
 * RENEWAL-M (RENEWAL3, style B): the coach's gold-ringed monogram on deep, and H3: the deep closing moment after the
 * house coach's package is paid. A leaf check that grows in once (320 ms, static under Reduce Motion), the success
 * title, "{name} is now your coach." beside his monogram, the success sentence and one Continue. One success haptic.
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../HapticPressable';
import { PACKAGE_PAYMENT_COPY } from '../../lib/packagePayment';
import { forestPop as fp, motion, radius, typography } from '../../theme/tokens';
import { HapticService } from '../../ui/haptics/haptics.service';

export function Monogram({ name, size = 64 }: { name: string; size?: number }): React.ReactElement {
  const initials = name.trim().split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[s.mono, { width: size, height: size, borderRadius: size / 2 }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[s.monoText, { fontSize: size * 0.38, lineHeight: size * 0.5 }]} maxFontSizeMultiplier={1}>{initials}</Text>
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
    <View style={s.joined} testID="payment-success" accessibilityLiveRegion="polite">
      <View style={s.handle} />
      <Animated.View style={[s.check, { opacity: grow, transform: [{ scale }] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="house-joined-check">
        <Ionicons name="checkmark" size={30} color={fp.leaf} />
      </Animated.View>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      <View style={s.row} testID="payment-new-coach">
        <Monogram name={name} size={44} />
        <Text style={s.text}>{`${name} is now your coach.`}</Text>
      </View>
      <Text style={s.body}>{body}</Text>
      <HapticPressable intent="medium" style={s.cta} onPress={onContinue} accessibilityRole="button" testID="payment-continue">
        <Text style={s.ctaText}>{PACKAGE_PAYMENT_COPY.continue}</Text>
      </HapticPressable>
    </View>
  );
}

const s = StyleSheet.create({
  mono: { alignSelf: 'center', backgroundColor: fp.forest, borderWidth: 2, borderColor: fp.gold, alignItems: 'center', justifyContent: 'center' },
  monoText: { ...typography.h2, color: fp.gold },
  joined: { flexGrow: 1, backgroundColor: fp.deep, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32, alignItems: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: fp.forest, marginBottom: 24 },
  check: { width: 64, height: 64, borderRadius: 32, backgroundColor: fp.forest, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h1, color: fp.onDeep, textAlign: 'center', marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: fp.forest, borderRadius: radius.card, padding: 14, marginTop: 20 },
  text: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', flex: 1, color: fp.onDeep },
  body: { ...typography.body, color: fp.onDeepMuted, textAlign: 'center', marginTop: 16 },
  cta: { alignSelf: 'stretch', minHeight: 52, borderRadius: radius.button, backgroundColor: fp.leaf, borderWidth: 1, borderColor: fp.moss, alignItems: 'center', justifyContent: 'center', marginTop: 24, paddingHorizontal: 16 },
  ctaText: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: fp.ink },
});
