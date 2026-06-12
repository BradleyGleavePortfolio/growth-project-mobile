/**
 * RomanVoiceLogReadback — §2.9 Voice-logging confirmation (client app).
 *
 * Roman parses a spoken set and reads it back. The readback must be
 * unambiguous and instant; the copy stays short and literal (no quip on the
 * default per spec §2.9).
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 47 — co-located with the §2.9
 * copy from src/lib/roman/copy.ts. Per the spec §4 table ("small avatar or
 * none — keep UI minimal") the avatar is rendered at a SMALL size.
 *
 * Mascot expression: neutral default; slight smile on a logged PR via voice
 * (celebration). On a parse error the mascot stays neutral.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanVoiceLog, type RomanVoiceMode } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanVoiceLogReadbackProps {
  /** Parsed weight in pounds. */
  weight: number;
  /** Parsed rep count. */
  reps: number;
  /** default | celebration (voice PR) | error (could not parse). */
  mode: RomanVoiceMode;
  testID?: string;
}

export default function RomanVoiceLogReadback({
  weight,
  reps,
  mode,
  testID,
}: RomanVoiceLogReadbackProps): React.ReactElement {
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  const line = romanVoiceLog({ weight, reps, mode });
  return (
    <View style={styles.row} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: small avatar co-located with the §2.9 readback copy. */}
      <RomanAvatar crop={crop} size={24} testID="roman-voicelog-avatar" />
      <Text style={styles.copy} accessibilityRole="text">
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  copy: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
});
