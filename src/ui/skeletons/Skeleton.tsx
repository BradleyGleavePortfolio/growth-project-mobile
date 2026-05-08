/**
 * Skeleton — primitive animated placeholder block.
 *
 * Pulses opacity between a lighter and slightly darker variant of the
 * theme `bone` token over 1 500 ms using `react-native-reanimated` directly.
 * No third-party skeleton library is required.
 *
 * Props:
 *   width        — numeric px or DimensionValue (e.g. '100%')
 *   height       — numeric px
 *   borderRadius — optional; defaults to radius.md (2)
 *
 * Usage:
 *   <Skeleton width={200} height={16} />
 *   <Skeleton width="100%" height={48} borderRadius={4} />
 */

import React, { useEffect } from 'react';
import { DimensionValue, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';

export interface SkeletonProps {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  testID?: string;
}

/**
 * Skeleton primitive — renders one animated placeholder rectangle.
 */
export function Skeleton({ width, height, borderRadius = 2, testID }: SkeletonProps) {
  const { tokens } = useTheme();

  // bone = '#F5EFE4' — lighter shimmer stays close to bone, darker shimmer
  // steps slightly toward cream (#F1E8D5). We express this purely via opacity
  // over a cream-tinted background so we never hardcode hex values.
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1.0, {
        duration: 1500,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,   // infinite
      true, // reverse (ping-pong)
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        animatedStyle,
        {
          width,
          height,
          borderRadius: borderRadius ?? tokens.radius.md,
          // surface token (cream) is the skeleton fill — no hex
          backgroundColor: tokens.colors.cream,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});

export default Skeleton;
