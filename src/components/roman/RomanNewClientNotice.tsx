/**
 * RomanNewClientNotice — §2.5 New client onboarded (coach app).
 *
 * FACE+VOICE: <RomanAvatar /> appears at line 44 — co-located with the §2.5
 * copy from src/lib/roman/copy.ts. Mascot is "optional" per the spec table but
 * INCLUDED per the cross-cutting operator rule.
 *
 * Mascot expression: neutral default; slight smile on a roster milestone
 * (celebration, §3.8). Welcoming a new client is a straight, gracious moment —
 * no quip (spec §2.5).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RomanAvatar from './RomanAvatar';
import { romanNewClient, type RomanVoiceMode } from '../../lib/roman/copy';
import { colors, spacing, typography } from '../../theme/tokens';

export interface RomanNewClientNoticeProps {
  clientName: string;
  /** Roster size after the join — used by the milestone line. */
  clientCount: number;
  /** default | celebration (roster milestone) | error (intake mismatch). */
  mode: RomanVoiceMode;
  testID?: string;
}

export default function RomanNewClientNotice({
  clientName,
  clientCount,
  mode,
  testID,
}: RomanNewClientNoticeProps): React.ReactElement {
  const crop = mode === 'celebration' ? 'smile' : 'neutral';
  const line = romanNewClient({ clientName, clientCount, mode });
  return (
    <View style={styles.row} testID={testID} accessibilityRole="summary">
      {/* FACE+VOICE: avatar co-located with the §2.5 onboarded copy. */}
      <RomanAvatar crop={crop} size={32} testID="roman-newclient-avatar" />
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
