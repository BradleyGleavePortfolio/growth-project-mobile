/**
 * StepTransitionView — ED.5 onboarding step transition primitive.
 *
 * The single source of truth for the onboarding step-to-step transition. Every
 * onboarding step screen nests its content inside this wrapper so the whole
 * flow shares ONE motion language instead of each screen inventing its own.
 *
 * Motion (spec ED.5 §1): on mount the content cross-fades in (opacity 0 → 1)
 * while sliding up 8px (translateY 8 → 0). Duration 220ms, ease-out cubic —
 * a calm, quiet-luxury settle, not a bounce. There is no exit animation: React
 * Navigation unmounts the previous screen, so the entrance is the transition.
 *
 * Flag + accessibility posture:
 *   • `enabled` (default true) lets the host gate the animation on
 *     `featureFlags.romanOnboardingPolish`. When false the children render at
 *     their final resting state with NO animation — byte-identical to the
 *     pre-ED.5 hard cut.
 *   • Reduce Motion (OS setting, via `useReducedMotion`) ALSO collapses the
 *     transition to its final state instantly. Content still updates correctly;
 *     only the movement is skipped (spec ED.5 §accessibility).
 *
 * This is a PRESENTATION-ONLY wrapper: it never touches step content, step
 * logic, navigation, or storage. It only animates the container it is given.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Transition timing constants (spec ED.5 §1). Exported for the test to pin. */
export const STEP_TRANSITION_DURATION_MS = 220;
/** Upward slide distance, in px, the content travels as it fades in. */
export const STEP_TRANSITION_SLIDE_PX = 8;

export interface StepTransitionViewProps {
  /**
   * When false, the transition is skipped and children render at their final
   * resting state (opacity 1, no offset). Host wires this to
   * `featureFlags.romanOnboardingPolish` so the flag-off path is a hard cut.
   * Defaults to true.
   */
  enabled?: boolean;
  /** Optional style merged onto the animated container. */
  style?: StyleProp<ViewStyle>;
  /**
   * A stable key for the current step. Changing it re-runs the entrance
   * transition without the host having to remount the wrapper. Optional —
   * most hosts rely on React Navigation mounting a fresh screen per step.
   */
  transitionKey?: string | number;
  /** Accessibility label for the transitioning region, if the host wants one. */
  accessibilityLabel?: string;
  children: React.ReactNode;
}

/**
 * Wraps onboarding step content in the shared cross-fade + 8px upward slide.
 * Honors both the ED.5 feature flag (`enabled`) and the OS Reduce Motion
 * setting; when either suppresses motion the content is shown at rest with no
 * animation.
 */
export default function StepTransitionView({
  enabled = true,
  style,
  transitionKey,
  accessibilityLabel,
  children,
}: StepTransitionViewProps): React.ReactElement {
  const reduceMotion = useReducedMotion();
  // Motion is only applied when the polish flag is on AND the user has not
  // asked the OS to reduce motion. Either condition collapses to a hard cut.
  const animate = enabled && !reduceMotion;

  // Seed the shared values at the resting state when motion is suppressed so a
  // flag-off / reduce-motion mount paints the final frame immediately.
  const opacity = useSharedValue(animate ? 0 : 1);
  const translateY = useSharedValue(animate ? STEP_TRANSITION_SLIDE_PX : 0);

  useEffect(() => {
    if (!animate) {
      // Pin to the resting state with no animation (instant, deterministic).
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    // Re-seed to the start frame, then settle to rest over 220ms ease-out cubic.
    opacity.value = 0;
    translateY.value = STEP_TRANSITION_SLIDE_PX;
    opacity.value = withTiming(1, {
      duration: STEP_TRANSITION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    translateY.value = withTiming(0, {
      duration: STEP_TRANSITION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    // `transitionKey` lets a host re-trigger the entrance without remounting.
  }, [animate, transitionKey, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // When motion is suppressed there is nothing to animate — render a plain
  // container so the flag-off path carries zero Reanimated overhead.
  if (!animate) {
    return (
      <View
        style={[styles.fill, style]}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.fill, animatedStyle, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
