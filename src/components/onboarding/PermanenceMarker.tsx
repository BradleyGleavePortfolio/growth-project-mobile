/**
 * PermanenceMarker — ED.5 onboarding package/pricing permanence marker.
 *
 * The calm "it is saved, and it will stay saved" affordance for the package +
 * pricing rows during a coach's onboarding. Two parts:
 *   • A persistent checkmark beside the field label — the "permanence marker"
 *     proper. Once a value is saved it stays mounted, including when the coach
 *     navigates back to the row. It is the durable signal that the work landed.
 *   • A transient Roman-voiced line that slides in under the input row for
 *     ~1.6s, then fades. It reassures in Roman's straight register ("Saved. You
 *     can change the package any time.") without shouting — there is no
 *     celebration here, just confirmation (spec ED.5 §3).
 *
 * Copy comes exclusively from `roman/copy.ts` (`romanPermanenceMarker`) so the
 * voice has one home; this component never inlines prose.
 *
 * Flag + accessibility posture:
 *   • `enabled` (default true) gates the whole marker on
 *     `featureFlags.romanOnboardingPolish`. When false NOTHING renders — the
 *     pre-ED.5 rows had no marker at all.
 *   • Reduce Motion keeps the checkmark and still shows the Roman line, but
 *     skips the slide-in: the line simply appears and fades (spec ED.5
 *     §accessibility — "Permanence marker checkmark still appears; only the
 *     slide-in is skipped").
 *
 * Presentation only — the host owns the save; this component just renders the
 * saved confirmation once `saved` turns true.
 */
import React, { useEffect, useState } from 'react';
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
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  romanPermanenceMarker,
  type RomanPermanenceMarkerKind,
} from '../../lib/roman/copy';

/** How long the transient Roman line stays before it fades (spec ED.5 §3). */
export const PERMANENCE_LINE_VISIBLE_MS = 1600;
/** Fade in/out duration for the transient line. */
export const PERMANENCE_LINE_FADE_MS = 220;

export interface PermanenceMarkerProps {
  /**
   * Which affordance this marker confirms — selects the Roman copy stem.
   * 'packageSaved' for the package row, 'priceSaved' for the pricing row.
   */
  kind: RomanPermanenceMarkerKind;
  /**
   * Whether the value has been saved. false → nothing renders. true → the
   * checkmark mounts (and stays), and the transient Roman line plays once.
   */
  saved: boolean;
  /**
   * When false, the marker does not render at all. Host wires this to
   * `featureFlags.romanOnboardingPolish`. Defaults to true.
   */
  enabled?: boolean;
  /** Optional style merged onto the marker container. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Renders the persistent saved-checkmark and the one-shot transient Roman line
 * for a package/pricing row. Honors the ED.5 flag and the OS Reduce Motion
 * setting per the spec.
 */
export default function PermanenceMarker({
  kind,
  saved,
  enabled = true,
  style,
  testID,
}: PermanenceMarkerProps): React.ReactElement | null {
  const { semanticColors: colors } = useTheme();
  const reduceMotion = useReducedMotion();

  // The transient line is mounted only while it is visible or fading; the
  // checkmark persists for as long as `saved` holds.
  const [lineMounted, setLineMounted] = useState(false);
  const lineOpacity = useSharedValue(0);
  const lineTranslateY = useSharedValue(reduceMotion ? 0 : 6);

  const line = romanPermanenceMarker[kind];

  useEffect(() => {
    if (!enabled || !saved) return;

    setLineMounted(true);

    if (reduceMotion) {
      // No slide-in: the line just appears and, after the dwell, fades out.
      lineTranslateY.value = 0;
      lineOpacity.value = 1;
    } else {
      lineTranslateY.value = 6;
      lineOpacity.value = 0;
      lineOpacity.value = withTiming(1, {
        duration: PERMANENCE_LINE_FADE_MS,
        easing: Easing.out(Easing.cubic),
      });
      lineTranslateY.value = withTiming(0, {
        duration: PERMANENCE_LINE_FADE_MS,
        easing: Easing.out(Easing.cubic),
      });
    }

    // Begin the fade-out once the dwell elapses.
    const fadeTimer = setTimeout(() => {
      lineOpacity.value = withTiming(0, { duration: PERMANENCE_LINE_FADE_MS });
    }, PERMANENCE_LINE_VISIBLE_MS);
    // Unmount the transient line after the fade completes; the checkmark stays.
    // Scheduled at the top level (not nested) so the unmount is deterministic.
    const unmountTimer = setTimeout(
      () => setLineMounted(false),
      PERMANENCE_LINE_VISIBLE_MS + PERMANENCE_LINE_FADE_MS,
    );

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
    // Re-run when the saved row changes identity or the flag flips.
  }, [enabled, saved, kind, reduceMotion, lineOpacity, lineTranslateY]);

  const lineStyle = useAnimatedStyle(() => ({
    opacity: lineOpacity.value,
    transform: [{ translateY: lineTranslateY.value }],
  }));

  // Flag off, or nothing saved yet → render nothing (pre-ED.5 behaviour).
  if (!enabled || !saved) return null;

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.checkRow}>
        {/* Persistent permanence marker — stays for as long as `saved` holds. */}
        <Ionicons
          name="checkmark-circle-outline"
          size={18}
          color={colors.accentText}
          accessibilityRole="image"
          accessibilityLabel="Saved"
          testID={testID ? `${testID}-check` : undefined}
        />
      </View>
      {lineMounted ? (
        <Animated.View style={lineStyle}>
          <Text
            style={[styles.line, { color: colors.textMuted }]}
            accessibilityRole="text"
            accessibilityLabel={line}
            testID={testID ? `${testID}-line` : undefined}
          >
            {line}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  line: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
});
