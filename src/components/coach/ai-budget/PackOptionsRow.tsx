/**
 * PackOptionsRow — shared $10 / $25 / $99 / Custom button row.
 *
 * Used by the 80% tutorial card 4, the 100% hard-pause modal, and the
 * credit-pack checkout entry point. Single component keeps the four pack
 * choices presentationally consistent — if the operator ever moves a tier
 * the change lands in one place.
 *
 * Custom pack opens a numeric input flow inside `CreditPackCheckoutScreen`;
 * the bounds ($10–$500) are enforced there + on the backend.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import HapticPressable from '../../HapticPressable';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import { formatCents } from '../../../api/types/coachAIBudget';

export interface PackOptionsRowProps {
  /** Pack option face-values in cents (server-provided). */
  options: number[];
  onSelect: (amountCents: number | 'custom') => void;
  style?: ViewStyle;
  testID?: string;
}

export function PackOptionsRow({
  options,
  onSelect,
  style,
  testID,
}: PackOptionsRowProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.row, style]} testID={testID ?? 'ai-pack-options'}>
      {options.map((cents) => (
        <HapticPressable
          key={cents}
          intent="medium"
          onPress={() => onSelect(cents)}
          accessibilityRole="button"
          accessibilityLabel={`Buy ${formatCents(cents)} credit pack`}
          style={styles.btn}
          testID={`ai-pack-option-${cents}`}
        >
          <Text style={styles.btnText}>{formatCents(cents)}</Text>
        </HapticPressable>
      ))}
      <HapticPressable
        intent="medium"
        onPress={() => onSelect('custom')}
        accessibilityRole="button"
        accessibilityLabel="Buy custom credit pack"
        style={[styles.btn, styles.btnGhost]}
        testID="ai-pack-option-custom"
      >
        <Text style={[styles.btnText, styles.btnGhostText]}>Custom</Text>
      </HapticPressable>
    </View>
  );
}

export default PackOptionsRow;

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    btn: {
      flexGrow: 1,
      minWidth: 70,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: {
      color: colors.textOnPrimary,
      fontWeight: '600',
      letterSpacing: 0.4,
      fontSize: 15,
    },
    btnGhost: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    btnGhostText: {
      color: colors.primary,
    },
  });
}
