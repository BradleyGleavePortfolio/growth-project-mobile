/**
 * RomanCheckInNotice — §2.4 Client check-in submitted (coach app).
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 44 — co-located with the §2.4
 * copy from src/lib/roman/copy.ts. The spec marks the mascot "optional" here,
 * but the cross-cutting operator rule ("wire him up for COACH SCREENS TOO" +
 * face-with-voice) requires the avatar, so it is INCLUDED.
 *
 * Mascot expression: neutral default; slight smile on the client's first-ever
 * check-in (celebration, §3.8). This is an operational surface — no quip.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanCheckInReceived, type RomanVoiceMode } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanCheckInNoticeProps {
  clientName: string;
  /** default | celebration (first-ever check-in) | error (attachments failed). */
  mode: RomanVoiceMode;
  testID?: string;
}

export default function RomanCheckInNotice({
  clientName,
  mode,
  testID,
}: RomanCheckInNoticeProps): React.ReactElement {
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  const line = romanCheckInReceived({ clientName, mode });
  return (
    <View style={styles.row} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: avatar co-located with the §2.4 check-in copy. */}
      <RomanAvatar crop={crop} size={32} testID="roman-checkin-avatar" />
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  copy: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
});
