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
 *
 * Convenience composites (same file):
 *   <SkeletonRow />           — one full-width row (title + subtitle)
 *   <SkeletonList count={5} /> — N stacked <SkeletonRow> items
 *   <SkeletonScreen />        — full-screen centered list placeholder
 */

import React, { useEffect } from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';
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

  // bone = Colors.background — lighter shimmer stays close to bone, darker shimmer
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

// ─── SkeletonRow ─────────────────────────────────────────────────────────────

/**
 * SkeletonRow — one list item placeholder: a wide title bar and a
 * narrower subtitle bar beneath it, separated by a small gap.
 */
export function SkeletonRow() {
  return (
    <View style={compositeStyles.row}>
      <Skeleton width="72%" height={14} borderRadius={3} />
      <View style={compositeStyles.rowGap} />
      <Skeleton width="48%" height={11} borderRadius={3} />
    </View>
  );
}

// ─── SkeletonList ────────────────────────────────────────────────────────────

export interface SkeletonListProps {
  /** Number of placeholder rows to render. Defaults to 6. */
  count?: number;
}

/**
 * SkeletonList — renders `count` <SkeletonRow> items with a divider gap
 * between each, suitable for replacing a FlatList / ScrollView while data
 * loads.
 */
export function SkeletonList({ count = 6 }: SkeletonListProps) {
  return (
    <View style={compositeStyles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

// ─── SkeletonScreen ──────────────────────────────────────────────────────────

export interface SkeletonScreenProps {
  /** Number of placeholder rows. Defaults to 7. */
  count?: number;
  testID?: string;
}

/**
 * SkeletonScreen — full-screen loading placeholder. Fills flex:1, pads
 * the content area, and renders a <SkeletonList>. Drop it anywhere a
 * full-screen `ActivityIndicator` spinner previously lived.
 *
 * Usage:
 *   if (isLoading) return <SkeletonScreen />;
 */
export function SkeletonScreen({ count = 7, testID }: SkeletonScreenProps) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={[compositeStyles.screen, { backgroundColor: colors.background }]}
      accessibilityLabel="Loading"
      accessibilityRole="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SkeletonList count={count} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});

const compositeStyles = StyleSheet.create({
  row: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  rowGap: {
    height: 6,
  },
  list: {
    flex: 1,
    paddingTop: 8,
  },
  screen: {
    flex: 1,
    paddingTop: 24,
  },
});

export default Skeleton;
