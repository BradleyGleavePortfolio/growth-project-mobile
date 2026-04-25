/**
 * usePressFeedback — UX Psychology Report #3 "Haptics + State Feedback Everywhere"
 *
 * A hook version of HapticPressable logic for cases where you cannot swap
 * the component itself (e.g. inside 3rd-party lists, custom Animated.View
 * wrappers, or components with incompatible prop shapes).
 *
 * Usage:
 *   const { handlers, animatedStyle } = usePressFeedback({ intent: 'medium' });
 *   return (
 *     <Animated.View style={animatedStyle}>
 *       <SomeThirdPartyButton {...handlers} />
 *     </Animated.View>
 *   );
 */

import { useRef, useCallback } from 'react';
import { Animated, GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';

export type HapticIntent = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export interface UsePressFeedbackOptions {
  intent?: HapticIntent;
  pressScale?: number;
  pressOpacity?: number;
  onPress?: (e: GestureResponderEvent) => void;
  onPressIn?: (e: GestureResponderEvent) => void;
  onPressOut?: (e: GestureResponderEvent) => void;
}

export interface UsePressFeedbackResult {
  /** Spread these onto the pressable element */
  handlers: {
    onPress: (e: GestureResponderEvent) => void;
    onPressIn: (e: GestureResponderEvent) => void;
    onPressOut: (e: GestureResponderEvent) => void;
  };
  /** Wrap your pressable element in Animated.View with this style */
  animatedStyle: {
    transform: { scale: Animated.Value }[];
    opacity: Animated.Value;
  };
}

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

export function usePressFeedback({
  intent = 'light',
  pressScale = 0.97,
  pressOpacity = 0.85,
  onPress,
  onPressIn,
  onPressOut,
}: UsePressFeedbackOptions = {}): UsePressFeedbackResult {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
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
      onPressIn?.(e);
    },
    [scaleAnim, opacityAnim, pressScale, pressOpacity, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
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
      onPressOut?.(e);
    },
    [scaleAnim, opacityAnim, onPressOut],
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      fireHaptic(intent);
      onPress?.(e);
    },
    [intent, onPress],
  );

  return {
    handlers: {
      onPress: handlePress,
      onPressIn: handlePressIn,
      onPressOut: handlePressOut,
    },
    animatedStyle: {
      transform: [{ scale: scaleAnim }],
      opacity: opacityAnim,
    },
  };
}
