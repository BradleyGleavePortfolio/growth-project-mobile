/**
 * S2's three pack tiles in the CREDIT-S hybrid: one row of equal tiles
 * ("$10", "$25", "$99"), the chosen one drawn in forest with a check. A
 * radio group to a screen reader; each tile is spoken as "{amount} pack"
 * (S2-3). A tap gives the selection haptic through HapticService. On the ink
 * Suggested card (`onInk`) forest barely shows against the card, so the chosen
 * tile takes a 2 pt `data.frameOnDark` ring (5.1:1 on ink, about 3:1 on cream).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { formatCents } from '../../../api/types/coachAIBudget';
import { packTileLabel } from './creditCopy';

export default function CreditPackTiles({
  packs,
  selected,
  onSelect,
  onInk = false,
}: {
  packs: readonly number[];
  selected: number | null;
  onSelect: (cents: number) => void;
  onInk?: boolean;
}) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" testID="credit-pack-tiles">
      {packs.map((cents) => {
        const on = cents === selected;
        return (
          <Pressable
            key={cents}
            onPress={() => {
              void HapticService.selection();
              onSelect(cents);
            }}
            accessibilityRole="radio"
            accessibilityLabel={packTileLabel(cents)}
            accessibilityState={{ selected: on, checked: on }}
            testID={`credit-pack-${cents}`}
            style={({ pressed }) => [
              styles.tile,
              {
                borderColor: on ? (onInk ? sc.data.frameOnDark : sc.accent) : sc.border,
                borderWidth: on ? (onInk ? 2 : 1.5) : StyleSheet.hairlineWidth,
                backgroundColor: on ? sc.bgPrimary : sc.bgSurface,
              },
              pressed && styles.pressed,
            ]}
          >
            {on ? <Ionicons name="checkmark" size={16} color={sc.accentText} style={styles.check} /> : null}
            <Text style={[styles.amount, { color: sc.textPrimary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {formatCents(cents)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minHeight: layout.buttonHeight,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  check: { marginRight: spacing.xs },
  amount: { ...typography.bodyMd, fontSize: 17, fontVariant: ['tabular-nums'] },
});
