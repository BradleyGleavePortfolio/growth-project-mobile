/**
 * StripeConnectCard — ED.5 onboarding Stripe Connect flip card.
 *
 * Two faces on one card, owned by the Stripe Connect onboarding step:
 *   • FRONT (placeholder) — the "Connect your payouts" prompt with a Connect
 *     affordance. This is what a coach sees before they have linked Stripe.
 *   • BACK  (connected)   — revealed when the Stripe Connect deep-link returns
 *     successfully. Shows the linked account (card brand + last-4) and a calm
 *     connected confirmation.
 *
 * Motion (spec ED.5 §2): a 180° flip about the Y axis. Reanimated `rotateY`
 * driven by a `useSharedValue` interpolated from a 0 → 1 progress value;
 * 360ms ease-in-out cubic. The front face shows for progress < 0.5, the back
 * for >= 0.5, each counter-rotated so its text never renders mirrored. With
 * `backfaceVisibility: 'hidden'` only the forward-facing side is visible at any
 * angle, so the flip reads as a single card turning over.
 *
 * Flag + accessibility posture:
 *   • `enabled` (default true) gates the flip on
 *     `featureFlags.romanOnboardingPolish`. When false the card renders the
 *     correct STATIC face for `connected` (no flip), matching the pre-ED.5 hard
 *     swap between a placeholder and a connected card.
 *   • Reduce Motion collapses the flip to an instant face swap — the connected
 *     face still appears, only the rotation is skipped (spec ED.5 §accessibility).
 *   • The flip animation never blocks the hardware back button: it animates a
 *     view transform only and registers no BackHandler (spec ED.5 §a11y note).
 *
 * Presentation only — this card holds no Stripe SDK calls, no network, and no
 * deep-link wiring. The host screen owns the deep-link return and flips
 * `connected` to true; this component only renders the result.
 */
import React, { useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Flip timing constants (spec ED.5 §2). Exported so the test can pin them. */
export const STRIPE_FLIP_DURATION_MS = 360;
/** Rotation, in degrees, the card travels to reveal its connected face. */
export const STRIPE_FLIP_DEGREES = 180;

export interface StripeConnectCardProps {
  /**
   * Whether the Stripe Connect deep-link has returned successfully. false →
   * front (placeholder) face; true → flips to (or, when motion is suppressed,
   * shows) the back (connected) face.
   */
  connected: boolean;
  /** Fired when the coach taps Connect on the front face. */
  onConnect: () => void;
  /** Card brand on the linked account, e.g. "Visa". Shown on the connected face. */
  brand?: string;
  /** Last four digits of the linked account. Shown on the connected face. */
  last4?: string;
  /**
   * When false, the flip is skipped and the card renders the static face for
   * the current `connected` value. Host wires this to
   * `featureFlags.romanOnboardingPolish`. Defaults to true.
   */
  enabled?: boolean;
  /** Optional style merged onto the card container. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The placeholder front face: a calm Connect prompt. Tapping the affordance
 * fires `onConnect`; the host then runs the Stripe Connect flow and, on a
 * successful deep-link return, flips the card by setting `connected`.
 */
function FrontFace({
  onConnect,
  colors,
  testID,
}: {
  onConnect: () => void;
  colors: ReturnType<typeof useTheme>['semanticColors'];
  testID?: string;
}): React.ReactElement {
  return (
    <View
      style={styles.faceContent}
      accessibilityRole="summary"
      accessibilityLabel="Connect your payouts with Stripe"
      testID={testID ? `${testID}-front` : undefined}
    >
      <Ionicons name="card-outline" size={28} color={colors.accentText} />
      <Text style={[styles.faceTitle, { color: colors.textPrimary }]}>
        Connect your payouts
      </Text>
      <Text style={[styles.faceBody, { color: colors.textMuted }]}>
        Link Stripe so your clients can pay you directly.
      </Text>
      <HapticPressable
        intent="medium"
        onPress={onConnect}
        accessibilityRole="button"
        accessibilityLabel="Connect Stripe"
        testID={testID ? `${testID}-connect` : undefined}
        style={[styles.cta, { backgroundColor: colors.accent }]}
      >
        <Text style={[styles.ctaLabel, { color: colors.textOnAccent }]}>
          Connect Stripe
        </Text>
      </HapticPressable>
    </View>
  );
}

/**
 * The connected back face: a calm confirmation of the linked account. Names
 * the card brand + last-4 only when both are present; otherwise states the
 * connection without inventing account digits.
 */
function BackFace({
  brand,
  last4,
  colors,
  testID,
}: {
  brand?: string;
  last4?: string;
  colors: ReturnType<typeof useTheme>['semanticColors'];
  testID?: string;
}): React.ReactElement {
  const hasAccount =
    brand != null && brand.trim() !== '' && last4 != null && last4.trim() !== '';
  return (
    <View
      style={styles.faceContent}
      accessibilityRole="summary"
      accessibilityLabel={
        hasAccount
          ? `Stripe connected. ${brand} ending ${last4}.`
          : 'Stripe connected.'
      }
      testID={testID ? `${testID}-back` : undefined}
    >
      {/* U+2713 check glyph — a typographic mark, not a pictograph emoji. */}
      <Ionicons name="checkmark-circle" size={28} color={colors.accentText} />
      <Text style={[styles.faceTitle, { color: colors.textPrimary }]}>
        Payouts connected
      </Text>
      {hasAccount ? (
        <Text
          style={[styles.faceBody, { color: colors.textMuted }]}
          testID={testID ? `${testID}-account` : undefined}
        >
          {brand} ending {last4}
        </Text>
      ) : (
        <Text style={[styles.faceBody, { color: colors.textMuted }]}>
          Your account is linked and ready.
        </Text>
      )}
    </View>
  );
}

/**
 * The Stripe Connect flip card. Renders the front face until `connected` turns
 * true, then flips 180° to the connected face (or swaps instantly when the
 * flag is off or Reduce Motion is on).
 */
export default function StripeConnectCard({
  connected,
  onConnect,
  brand,
  last4,
  enabled = true,
  style,
  testID,
}: StripeConnectCardProps): React.ReactElement {
  const { semanticColors: colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const animate = enabled && !reduceMotion;

  // 0 = front showing, 1 = back showing. Seed at the resting position for the
  // current `connected` value so a static/flag-off mount paints the right face.
  const progress = useSharedValue(connected ? 1 : 0);

  useEffect(() => {
    const target = connected ? 1 : 0;
    if (!animate) {
      // Instant face swap, no rotation.
      progress.value = target;
      return;
    }
    progress.value = withTiming(target, {
      duration: STRIPE_FLIP_DURATION_MS,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [connected, animate, progress]);

  const frontStyle = useAnimatedStyle(() => {
    const deg = interpolate(progress.value, [0, 1], [0, STRIPE_FLIP_DEGREES]);
    return {
      transform: [{ perspective: 800 }, { rotateY: `${deg}deg` }],
      opacity: progress.value < 0.5 ? 1 : 0,
    };
  });

  const backStyle = useAnimatedStyle(() => {
    const deg = interpolate(
      progress.value,
      [0, 1],
      [-STRIPE_FLIP_DEGREES, 0],
    );
    return {
      transform: [{ perspective: 800 }, { rotateY: `${deg}deg` }],
      opacity: progress.value < 0.5 ? 0 : 1,
    };
  });

  return (
    <View style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }, style]} testID={testID}>
      <Animated.View style={[styles.face, frontStyle]} pointerEvents={connected ? 'none' : 'auto'}>
        <FrontFace onConnect={onConnect} colors={colors} testID={testID} />
      </Animated.View>
      <Animated.View
        style={[styles.face, styles.faceAbsolute, backStyle]}
        pointerEvents={connected ? 'auto' : 'none'}
      >
        <BackFace brand={brand} last4={last4} colors={colors} testID={testID} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    padding: 24,
    minHeight: 180,
    justifyContent: 'center',
  },
  face: {
    backfaceVisibility: 'hidden',
  },
  faceAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 24,
    justifyContent: 'center',
  },
  faceContent: {
    alignItems: 'center',
    gap: 10,
  },
  faceTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    fontWeight: '500',
    textAlign: 'center',
  },
  faceBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  cta: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 2,
    alignItems: 'center',
  },
  ctaLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    fontWeight: '500',
  },
});
