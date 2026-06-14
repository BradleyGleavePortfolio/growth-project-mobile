/**
 * CompetencePill — ED.6 "coach-is-watching" micro-signal (Roman, client app).
 *
 * A small, calm pill shown on client-facing surfaces where the coach has
 * reviewed the client's submission. It is the proof-of-attention signal the
 * spec calls for: "Your coach reviewed this 2 hours ago." in Roman's composed
 * butler register — never hype, never effusive (brief §Why this matters,
 * §Voice rules).
 *
 * Behaviour (brief §Component):
 *   - `reviewedAt === null` → renders nothing. Absence is itself information;
 *     this is NOT an empty-state surface (brief §Scope: "When NEVER reviewed:
 *     pill is hidden").
 *   - The relative-time copy + voice live in `src/lib/roman/copy.ts`
 *     (`romanCoachReview`), so the pill owns layout only and the sentence has
 *     exactly one home. The STRAIGHT voice is always used (a micro-signal is
 *     never a moment for a quip).
 *
 * Design tokens (brief §Design tokens — sage warmth):
 *   - Background: the warm surface (no card, no shadow) with a single hairline
 *     border — top or bottom depending on `placement` — so the pill reads as a
 *     quiet seam in the layout rather than a floating chip.
 *   - Text: near-black serif (Cormorant Garamond) at small size.
 *   - A small sage monogram dot (Roman's mark) anchors the line.
 *
 * Feature flag: the rendering decision is made by the CALLER (the screen),
 * which checks `featureFlags.romanCompetencePill` before mounting the pill.
 * Keeping the flag check at the call site (rather than inside the component)
 * means the component stays a pure presentational unit that is trivial to unit
 * test against each relative-time bucket, while the screens own the gate. The
 * flag-off doctrine pin asserts the screens never mount it when the flag is OFF.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { colors } from '../../theme/tokens';
import {
  romanCoachReview,
  type CoachReviewSurface,
} from '../../lib/roman/copy';

export interface CompetencePillProps {
  /**
   * ISO-8601 timestamp of the coach's most-recent review, or null. When null
   * the pill renders nothing (the absence is the signal).
   */
  reviewedAt: string | null;
  /**
   * Which surface the pill sits on. `checkIn` → "Your coach reviewed this …",
   * `thread` → "Your coach reviewed this thread …". Defaults to `checkIn`.
   */
  surface?: CoachReviewSurface;
  /**
   * Where the hairline border sits relative to the pill content. `top` for a
   * pill placed ABOVE the body it annotates (e.g. the top of a message thread);
   * `bottom` for a pill placed BELOW the body (e.g. under a check-in detail).
   * Defaults to `top`.
   */
  placement?: 'top' | 'bottom';
  /**
   * Reference "now" for relative-time bucketing. Injected in tests for
   * determinism; defaults to the real wall clock.
   */
  now?: Date;
  testID?: string;
}

// Sage monogram dot. `forest` is the primary brand accent (the "sage-green
// variant" the brief names); the ink glyph sits on it. Tokenized — no raw hex.
const SAGE = colors.forest;
const DOT_INK = colors.bone ?? '#F5EFE4';

export default function CompetencePill({
  reviewedAt,
  surface = 'checkIn',
  placement = 'top',
  now,
  testID,
}: CompetencePillProps): React.ReactElement | null {
  const { semanticColors } = useTheme();

  // Brief §Behavior: null hides the pill entirely (no surface).
  if (reviewedAt == null) return null;

  const label = romanCoachReview({ reviewedAt, surface, now });

  const borderStyle =
    placement === 'bottom'
      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: semanticColors.border }
      : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: semanticColors.border };

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.row, { backgroundColor: semanticColors.bgSurface }, borderStyle]}
    >
      <View style={styles.dot} accessibilityElementsHidden importantForAccessibility="no">
        <Text style={styles.dotMark}>R</Text>
      </View>
      <Text style={[styles.text, { color: semanticColors.textPrimary }]}>{label}</Text>
    </View>
  );
}

const DOT_SIZE = 16;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: SAGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotMark: {
    color: DOT_INK,
    fontSize: DOT_SIZE * 0.56,
    // Cormorant matches Roman's serif register; weight stays <= 600 to respect
    // the quiet-luxury doctrine pin (no 700/800).
    fontFamily: 'CormorantGaramond_500Medium',
    fontWeight: '500',
    lineHeight: DOT_SIZE,
  },
  text: {
    flex: 1,
    // Near-black serif at small size (brief §Design tokens).
    fontFamily: 'CormorantGaramond_400Regular',
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
});
