/**
 * RomanTypingIndicator — "Roman is preparing a reply" affordance shown while a
 * turn is in flight.
 *
 * FACE+VOICE: Roman's face renders beside the indicator so the "is typing"
 * state is attributed to Roman, not a faceless spinner.
 *
 * A11y carries STATE (brief §7): the row exposes `accessibilityLabel="Roman is
 * typing"` so a screen reader announces the pending state, not just decoration.
 *
 * Reduced-motion parity (brief §7): the three pulsing dots animate via RN
 * `Animated` only when the OS "Reduce Motion" setting is OFF. When it is ON the
 * dots render static (no looping animation) but the row, copy, and a11y label
 * are identical — the information is conveyed without motion.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { ROMAN_TYPING_A11Y_LABEL, ROMAN_TYPING_LABEL } from './romanVoice';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { logger } from '../../utils/logger';

export interface RomanTypingIndicatorProps {
  testID?: string;
}

const DOT_COUNT = 3;

export default function RomanTypingIndicator({
  testID,
}: RomanTypingIndicatorProps): React.ReactElement {
  const [reduceMotion, setReduceMotion] = useState(false);
  const dots = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.4)),
  ).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch((err) => {
        // Default to motion-on when the query fails; the animation is purely
        // decorative so a failed probe never blocks the indicator. Log the
        // failed platform probe so the swallowed signal is still observable.
        logger.warn('RomanTypingIndicator.reduceMotionQuery', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.4, duration: 400, useNativeDriver: true }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [reduceMotion, dots]);

  return (
    <View
      style={styles.row}
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={ROMAN_TYPING_A11Y_LABEL}
      accessibilityLiveRegion="polite"
    >
      <RomanAvatar crop="neutral" size={32} testID="roman-typing-avatar" />
      <View style={styles.bubble}>
        <Text style={styles.label}>{ROMAN_TYPING_LABEL}</Text>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {dots.map((dot, i) => (
            <Animated.View
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={[styles.dot, { opacity: dot }]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  bubble: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  label: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.stone,
  },
});
