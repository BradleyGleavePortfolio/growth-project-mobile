/**
 * AckSignalChip — coach acknowledgement signal chip (product plan §2.4).
 *
 * Surfaces the explicit "seen" without anxiety-inducing read receipts:
 *   - eye           Coach saw this  (coach opened the thread for >= 3s)
 *   - checkmark      Coach acked     (coach tapped a passive ack)
 *   - chatbubble     Coach replied   (coach typed a reply)
 *
 * Per the quiet-luxury doctrine we use line Ionicons glyphs (never pictograph
 * emoji) so the chrome reads as restrained UI, not stickers.
 *
 * These are COACH-SIDE-ONLY signals shown to the client; the client's own read
 * state is private and never surfaced to the coach. v1-5 renders them as
 * read-only chips (the coach actions that set them are v1-6 coach UI).
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';

export type AckSignal = 'saw' | 'acked' | 'replied';

const SIGNAL_COPY: Record<
  AckSignal,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  saw: { icon: 'eye-outline', label: 'Coach saw this' },
  acked: { icon: 'checkmark-circle-outline', label: 'Coach acked' },
  replied: { icon: 'chatbubble-outline', label: 'Coach replied' },
};

export interface AckSignalChipProps {
  signal: AckSignal;
  testID?: string;
}

export default function AckSignalChip({
  signal,
  testID,
}: AckSignalChipProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const { icon, label } = SIGNAL_COPY[signal];
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
    >
      <Ionicons name={icon} size={12} color={semanticColors.textMuted} />
      <Text style={[styles.label, { color: semanticColors.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
