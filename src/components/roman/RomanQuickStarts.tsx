/**
 * RomanQuickStarts — the four quick-start chips above the Roman composer
 * (B30, prototype 69-73). Each chip sends its label as a fixed prompt through
 * the screen's normal send path: no new API. The chip last sent carries a
 * forest hairline (prototype 70), and every chip is inert while a turn is in
 * flight so a double tap never fires two turns.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import HapticPressable from '../HapticPressable';
import { ROMAN_QUICK_STARTS } from './romanVoice';
import { radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

export interface RomanQuickStartsProps {
  onPick: (prompt: string) => void;
  /** The prompt last sent from a chip, outlined in forest. */
  selected?: string | null;
  disabled?: boolean;
  testID?: string;
}

export default function RomanQuickStarts({
  onPick,
  selected = null,
  disabled = false,
  testID = 'roman-quick-starts',
}: RomanQuickStartsProps): React.ReactElement {
  const { semanticColors: c } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}
      style={styles.scroller}
      testID={testID}
    >
      {ROMAN_QUICK_STARTS.map((prompt, i) => {
        const on = prompt === selected;
        return (
          <HapticPressable
            key={prompt}
            intent="light"
            onPress={() => onPick(prompt)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={prompt}
            accessibilityHint="Sends this question to Roman"
            accessibilityState={{ disabled, selected: on }}
            style={[styles.chip, { borderColor: on ? c.accent : c.border }]}
            testID={`roman-quick-start-${i}`}
          >
            <Text style={[styles.label, { color: c.textPrimary }]}>{prompt}</Text>
          </HapticPressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Bleed to the screen edges so the row scrolls under the margins.
  scroller: {
    marginHorizontal: -spacing.xl,
    flexGrow: 0,
  },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.chip,
  },
  label: {
    ...typography.bodySmall,
    fontSize: 15,
    lineHeight: 20,
  },
});
