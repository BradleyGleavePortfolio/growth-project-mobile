/**
 * HapticPressable — UX Psychology Report #3 "Haptics + State Feedback Everywhere"
 *
 * A drop-in Pressable replacement that:
 *   1. Fires haptic feedback based on intent (light / medium / heavy / success / warning / error)
 *   2. Animates scale + opacity on press for tactile visual confirmation
 *   3. Forwards all Pressable props unchanged
 *   4. Silently no-ops on web / unsupported devices (try/catch)
 *
 * Usage:
 *   <HapticPressable intent="medium" onPress={...} style={...}>
 *     <Text>Log Workout</Text>
 *   </HapticPressable>
 */

import React, { useRef, useCallback } from 'react';
import {
  Pressable,
  Animated,
  PressableProps,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { HapticService } from '../ui/haptics/haptics.service';
import { useReduceMotion } from '../screens/client/wearables/components/useReduceMotion';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HapticIntent = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export interface HapticPressableProps extends Omit<PressableProps, 'style'> {
  /** Haptic + visual weight of the interaction */
  intent?: HapticIntent;
  /** Static or function style — same shape as Pressable style prop */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  children?: React.ReactNode;
  /** Scale factor when pressed (default 0.97) */
  pressScale?: number;
  /** Opacity when pressed (default 0.85) */
  pressOpacity?: number;
  /** Disable built-in scale/opacity animation */
  disableAnimation?: boolean;
}

// ─── Haptic dispatcher ────────────────────────────────────────────────────────
// Routed through HapticService so the client and coach Settings "Haptics"
// switch is honoured everywhere (DESIGN-QA-128 U1, DS-THEME-133). HapticService
// already no-ops when the switch is off and swallows unsupported hardware.

const DISPATCH: Record<HapticIntent, keyof typeof HapticService> = {
  light:   'softImpact',
  medium:  'mediumImpact',
  heavy:   'heavyImpact',
  success: 'success',
  warning: 'warning',
  error:   'error',
};

function fireHaptic(intent: HapticIntent): void {
  const fn = HapticService[DISPATCH[intent]] as (() => Promise<void>) | undefined;
  void fn?.();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HapticPressable({
  intent = 'light',
  style,
  children,
  onPress,
  onPressIn,
  onPressOut,
  pressScale = 0.97,
  pressOpacity = 0.85,
  disableAnimation = false,
  accessibilityRole,
  ...rest
}: HapticPressableProps) {
  // GLOBAL reduce-motion gate (R4 P2): every HapticPressable — the client Roman
  // entry row included — reads the OS "Reduce Motion" preference from the shared
  // useReduceMotion() hook and suppresses the press scale/opacity animation when
  // it is on. Haptics, the button role, and all forwarded props are untouched;
  // only the decorative scale/opacity motion is gated. The explicit
  // `disableAnimation` prop continues to force-off animation regardless.
  const reduceMotion = useReduceMotion();
  const animationDisabled = disableAnimation || reduceMotion;

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const animateIn = useCallback(() => {
    if (animationDisabled) return;
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: pressScale,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }),
      Animated.timing(opacityAnim, {
        toValue: pressOpacity,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animationDisabled, pressScale, pressOpacity, scaleAnim, opacityAnim]);

  const animateOut = useCallback(() => {
    if (animationDisabled) return;
    Animated.parallel([
      // Calm release: a 120 ms timing, never a spring (doctrine 5).
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animationDisabled, scaleAnim, opacityAnim]);

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      animateIn();
      onPressIn?.(e);
    },
    [animateIn, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      animateOut();
      onPressOut?.(e);
    },
    [animateOut, onPressOut],
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      fireHaptic(intent);
      onPress?.(e);
    },
    [intent, onPress],
  );

  // Resolve style — support both static styles and function styles (pressed state)
  const resolvedStyle = useCallback(
    ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
      const base = typeof style === 'function' ? style({ pressed }) : style;
      return base;
    },
    [style],
  );

  return (
    <Animated.View
      style={{ transform: [{ scale: scaleAnim }], opacity: opacityAnim }}
    >
      <Pressable
        accessibilityRole={accessibilityRole ?? (onPress || rest.onLongPress ? 'button' : undefined)}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={resolvedStyle}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
