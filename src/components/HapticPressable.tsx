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
import * as Haptics from 'expo-haptics';

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

async function fireHaptic(intent: HapticIntent): Promise<void> {
  try {
    switch (intent) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    // Silently ignore — web or unsupported hardware
  }
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
  ...rest
}: HapticPressableProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const animateIn = useCallback(() => {
    if (disableAnimation) return;
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
  }, [disableAnimation, pressScale, pressOpacity, scaleAnim, opacityAnim]);

  const animateOut = useCallback(() => {
    if (disableAnimation) return;
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 40,
        bounciness: 3,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [disableAnimation, scaleAnim, opacityAnim]);

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
