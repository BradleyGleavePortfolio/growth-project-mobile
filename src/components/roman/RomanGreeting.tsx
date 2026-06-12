/**
 * RomanGreeting — the FACE+VOICE empty state for an empty Roman chat.
 *
 * Operator rule (P0 if violated): Roman's face renders with every Roman-voiced
 * string. Here the bundled RomanAvatar (neutral crop) sits above the §2.2
 * returning-user greeting so the voice is never disembodied. RomanAvatar is the
 * existing Community component (reused, not forked — brief lane rule); it paints
 * the bundled brand face offline on first frame and falls back to the accessible
 * monogram only on image-load failure.
 *
 * Emotional target (DESIGN_INTELLIGENCE §5.1 step 1): the user should leave this
 * screen feeling WELCOMED and in capable hands — not "informed".
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from '../community/RomanAvatar';
import {
  romanGreeting,
  ROMAN_GREETING_SUBTITLE,
  type RomanGreetingSurface,
} from './romanVoice';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanGreetingProps {
  /** Host surface — selects the client vs coach greeting register (U1). */
  surface: RomanGreetingSurface;
  /** True when Roman has no prior history, so the §2.1 intro is shown (U1). */
  isFirstOpen: boolean;
  firstName?: string | null;
  testID?: string;
}

export default function RomanGreeting({
  surface,
  isFirstOpen,
  firstName,
  testID,
}: RomanGreetingProps): React.ReactElement {
  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar crop="neutral" size={72} testID="roman-greeting-avatar" />
      <Text
        style={styles.greeting}
        accessibilityRole="text"
        // The greeting text already names Roman; the avatar above carries the
        // face. State is conveyed in the visible copy, no extra a11y state here.
      >
        {romanGreeting({ surface, isFirstOpen, firstName })}
      </Text>
      <Text style={styles.subtitle} accessibilityRole="text">
        {ROMAN_GREETING_SUBTITLE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['3xl'],
    gap: spacing.md,
  },
  greeting: {
    ...typography.h3,
    color: colors.ink,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
});
