/**
 * RomanGreeting — the FACE+VOICE launch state for an empty Roman chat.
 *
 * Operator rule (P0 if violated): Roman's face renders with every Roman-voiced
 * string. Here RomanAvatar (neutral) sits beside the launch line so the voice
 * is never disembodied. RomanAvatar is the
 * existing Community component (reused, not forked — brief lane rule); it paints
 * the bundled brand face offline on first frame and falls back to the accessible
 * monogram only on image-load failure.
 *
 * Emotional target (DESIGN_INTELLIGENCE §5.1 step 1): the user should leave this
 * screen feeling WELCOMED and in capable hands — not "informed".
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanGreeting, romanLaunchLine, type RomanGreetingSurface } from './romanVoice';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

export interface RomanGreetingProps {
  /** Host surface — selects the client vs coach greeting register (U1). */
  surface: RomanGreetingSurface;
  /** True when Roman has no prior history, so the §2.1 intro is shown (U1). */
  isFirstOpen: boolean;
  firstName?: string | null;
  /** Local hour for the time-of-day greeting (tests pass it). */
  hour?: number;
  testID?: string;
}

/**
 * B30 / prototype 69 launch state: Roman's whole portrait (B27: never
 * cropped) beside one serif line. Client: the greeting and what Roman can
 * explain with the client's own numbers; coach: the coach register.
 */
export default function RomanGreeting({
  surface,
  isFirstOpen,
  firstName,
  hour = new Date().getHours(),
  testID,
}: RomanGreetingProps): React.ReactElement {
  const { semanticColors: c } = useTheme();
  const line =
    surface === 'client'
      ? romanLaunchLine({ surface, isFirstOpen, firstName, hour })
      : romanGreeting({ surface, isFirstOpen, firstName });
  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar crop="neutral" size={40} testID="roman-greeting-avatar" />
      <Text style={[styles.line, { color: c.textPrimary }]} accessibilityRole="text">
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  line: {
    // Serif reading text, as Roman's replies (19 on 28, over the 1.2x floor).
    fontFamily: typography.h2.fontFamily,
    fontSize: 19,
    lineHeight: 28,
    letterSpacing: 0.2,
    flex: 1,
    paddingTop: 4,
  },
});
