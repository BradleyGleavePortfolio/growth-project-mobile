/**
 * FirstPaymentWowScreen — ED.3, "THE moment" (spec §2.6, coach app).
 *
 * The single most important emotional beat in the coach app: the first time
 * money lands. A full-screen overlay that fires ONCE per coach (MMKV gate,
 * firstPaymentGate) when a first-payment INSERT arrives over Supabase realtime
 * (useFirstPaymentRealtime). It carries:
 *
 *   - a one-shot particle burst (ParticleBurst — pure Reanimated; Skia is not
 *     in deps),
 *   - the Roman mascot prominent with the "knowing slight smile" expression —
 *     rendered via RomanAvatar `crop="smile"`, the repo's idiom for the
 *     spec §3.8 milestone smile (the celebratory-ring smile crop). A subtle
 *     scale-in (1.0 → 1.05 → 1.0) spring runs on mount per the brief,
 *   - the spec §2.6 CELEBRATION copy (full warmth; carries the one permitted
 *     exclamation), sourced from src/lib/roman/copy.ts romanFirstPayment, and
 *   - a single Roman-tone dismiss button ("Thank you, Roman") that closes the
 *     gate and returns the coach home.
 *
 * FACE+VOICE invariant: RomanAvatar (the smile crop) sits in the same tree as
 * the romanFirstPayment string — the voice is never disembodied (operator
 * rule, mirrored from RomanGreeting).
 *
 * Once-only contract: this component does not gate itself — the OWNER (the
 * coach shell overlay) only mounts it when the gate is unseen, and calls
 * `markFirstPaymentSeen` on dismiss. The screen exposes `onDismiss` so the
 * owner controls navigation + gate write atomically.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import ParticleBurst from '../../../components/roman/ParticleBurst';
import HapticPressable from '../../../components/HapticPressable';
import { romanFirstPayment } from '../../../lib/roman/copy';
import { useReduceMotion } from '../../client/wearables/components/useReduceMotion';
import { colors, spacing, typography, radius } from '../../../theme/tokens';

/** Roman-tone dismiss label (brief permits "I understand" / "Thank you, Roman"). */
export const FIRST_PAYMENT_DISMISS_LABEL = 'Thank you, Roman';

export interface FirstPaymentWowScreenProps {
  /** Coach name in the operator-chosen form (spec §6). */
  readonly coachName: string;
  /** Pre-formatted currency string, e.g. "$240.00". */
  readonly amount: string;
  /** Paying client's display name. */
  readonly clientName: string;
  /** Called when the coach dismisses — owner closes the gate + navigates home. */
  readonly onDismiss: () => void;
  readonly testID?: string;
}

export default function FirstPaymentWowScreen({
  coachName,
  amount,
  clientName,
  onDismiss,
  testID,
}: FirstPaymentWowScreenProps): React.ReactElement {
  const reduceMotion = useReduceMotion();

  // Mascot scale-in: 1.0 → 1.05 → 1.0 over ~1.2s (brief). Instant when
  // reduce-motion is on (the moment still lands through copy + face).
  const scale = useSharedValue(reduceMotion ? 1 : 0.92);
  React.useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withSequence(
      withTiming(1.05, { duration: 700, easing: Easing.out(Easing.cubic) }),
      withTiming(1.0, { duration: 500, easing: Easing.inOut(Easing.quad) }),
    );
  }, [reduceMotion, scale]);

  const mascotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Spec §2.6 CELEBRATION variant — the one permitted exclamation lives here.
  const message = romanFirstPayment({
    coachName,
    amount,
    clientName,
    mode: 'celebration',
  });

  return (
    <View style={styles.container} testID={testID} accessibilityViewIsModal>
      <ParticleBurst reduceMotion={reduceMotion} testID="first-payment-particles" />

      <View style={styles.content}>
        <Animated.View style={mascotStyle}>
          {/* FACE+VOICE: the "knowing slight smile" mascot beside the voice. */}
          <RomanAvatar crop="smile" size={132} testID="first-payment-avatar" />
        </Animated.View>

        <Text
          style={styles.message}
          accessibilityRole="text"
          testID="first-payment-message"
        >
          {message}
        </Text>

        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel={FIRST_PAYMENT_DISMISS_LABEL}
          onPress={onDismiss}
          style={styles.button}
          testID="first-payment-dismiss"
        >
          <Text style={styles.buttonLabel}>{FIRST_PAYMENT_DISMISS_LABEL}</Text>
        </HapticPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bone,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    zIndex: 1000,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 420,
  },
  message: {
    marginTop: spacing.xl,
    color: colors.ink,
    fontSize: typography.body.fontSize,
    lineHeight: 26,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xl,
    backgroundColor: colors.forest,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  buttonLabel: {
    color: colors.bone,
    fontSize: 16,
    fontWeight: '600',
  },
});
