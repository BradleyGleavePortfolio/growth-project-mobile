import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { colors, gold, layout, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import HapticPressable from '../HapticPressable';
import { QuietOverline } from '../../ui/sections/QuietSection';
import { PrimaryButton, TextLink } from '../../ui';
import { SearchResult, unitOptionsFor } from '../../utils/log/types';
import { calcMacros, parseQuantityInput } from '../../utils/log/macros';
import PortionRuler from './PortionRuler';
import SheetGrip from './SheetGrip';

interface Props {
  visible: boolean;
  selectedFood: SearchResult | null;
  quantityInput: string;
  selectedUnit: string;
  onQuantityChange: (value: string) => void;
  onUnitChange: (unit: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  saving?: boolean;
  /** The confirm button and its no-quantity hint; the food log's by default. */
  confirmLabel?: string;
  emptyHint?: string;
  /** A message under the portion (screen readers hear it); `blocked` keeps the confirm off. */
  notice?: string | null;
  blocked?: boolean;
  /** The meal this food goes to ("For Lunch"); the coach picker passes its slot name ("For Pre-workout"). */
  mealLabel?: string;
}

export default function QuantityPickerModal({ visible, ...props }: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { if (!props.saving) props.onCancel(); }}
    >
      <QuantityPickerContent {...props} />
    </Modal>
  );
}

// Search and portion selection can share one native sheet without asking
// UIKit to present a sibling modal while Add Food is already presented.
// STYLEC-916 (C2 C_portion): grip, meal overline, serif name, unit tabs, the
// amount over a 10 g ruler, one summary line, then one filled action.
const UNIT_ORDER = ['g', 'oz', 'serving', 'cup', 'tbsp', 'tsp'];

export function QuantityPickerContent({
  selectedFood,
  quantityInput,
  selectedUnit,
  onQuantityChange,
  onUnitChange,
  onConfirm,
  onCancel,
  saving = false,
  confirmLabel = 'Log food',
  emptyHint = 'Enter a quantity greater than zero to log this food.',
  notice,
  blocked = false,
  mealLabel,
}: Omit<Props, 'visible'>) {
  const quantity = parseQuantityInput(quantityInput);
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  // The amount field is as wide as its digits (Cormorant figures are about 0.5 em) so the unit sits beside it.
  const amountWidth = Math.ceil(Math.max(1, quantityInput.length) * 28 * Math.min(useWindowDimensions().fontScale || 1, 1.3)) + 12;
  const previewMacros = selectedFood
    ? calcMacros(selectedFood, quantity ?? 0, selectedUnit)
    : { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const shown = (value: number) => Number.isFinite(value) ? String(Math.round(value)) : '—';
  const units = [...unitOptionsFor(selectedFood)].sort((a, b) => UNIT_ORDER.indexOf(a) - UNIT_ORDER.indexOf(b));
  // No-break spaces keep each number with its unit when the line wraps (320 pt, 130% text).
  const summary = `${shown(previewMacros.calories)}\u00A0kcal, ${shown(previewMacros.protein)}\u00A0g protein, `
    + `${shown(previewMacros.carbs)}\u00A0g carbs, ${shown(previewMacros.fat)}\u00A0g fat.`;

  return (
    <KeyboardAvoidingView
      style={styles.quantityModalContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.quantityModalContent}
        keyboardShouldPersistTaps="handled"
      >
        <SheetGrip />
        {mealLabel ? <QuietOverline style={styles.mealLine}>For {mealLabel}</QuietOverline> : null}
        <Text style={styles.quantityFoodName} accessibilityRole="header">{selectedFood?.name}</Text>
        {selectedFood?.brand ? (
          <Text style={styles.quantityFoodBrand}>{selectedFood.brand}</Text>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.unitTabs}
          contentContainerStyle={styles.unitTabRow} keyboardShouldPersistTaps="handled">
          {units.map((u) => (
            <HapticPressable
              key={u}
              intent="light"
              disableAnimation
              accessibilityRole="tab"
              accessibilityLabel={`Portion unit ${u}`}
              accessibilityState={{ selected: selectedUnit === u }}
              style={[styles.unitTab, selectedUnit === u && styles.unitTabActive]}
              onPress={() => onUnitChange(u)}
            >
              <Text style={[styles.unitTabText, selectedUnit === u && styles.unitTabTextActive]}>{u}</Text>
            </HapticPressable>
          ))}
        </ScrollView>

        <View style={styles.amountRow}>
          <TextInput
            accessibilityLabel="Food quantity"
            style={[styles.quantityInput, { width: amountWidth }]}
            value={quantityInput}
            onChangeText={onQuantityChange}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={sc.textMuted}
            maxFontSizeMultiplier={1.3}
          />
          <Text style={styles.amountUnit} importantForAccessibility="no" accessibilityElementsHidden>{selectedUnit}</Text>
        </View>
        <PortionRuler value={quantity} unit={selectedUnit} label="Quantity" disabled={saving}
          onChange={(next) => onQuantityChange(String(next))} />

        {quantity != null ? <Text style={styles.summary} testID="portion-summary">{summary}</Text> : null}
        {selectedFood?.serving_size ? (
          <Text style={styles.servingSizeInfo}>1 serving = {selectedFood.serving_size}</Text>
        ) : null}
        {['cup', 'tbsp', 'tsp'].includes(selectedUnit) ? (
          <Text style={styles.servingSizeInfo}>Volume weights are estimates. Use grams for a weighed portion.</Text>
        ) : null}
        {quantity == null ? (
          <Text style={styles.servingSizeInfo}>{emptyHint}</Text>
        ) : null}
        {notice ? <Text accessibilityRole="alert" style={styles.servingSizeInfo}>{notice}</Text> : null}

        <PrimaryButton
          label={confirmLabel}
          disabled={quantity == null || blocked}
          loading={saving}
          onPress={onConfirm}
          testID="quantity-log-food"
          style={styles.quantityLogButton}
        />
        <TextLink label="Cancel" tone="accent" disabled={saving} onPress={onCancel} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  quantityModalContainer: {
    flex: 1,
    backgroundColor: sc.bgPrimary,
  },
  quantityModalContent: {
    paddingHorizontal: layout.gutter,
    paddingBottom: 40,
  },
  mealLine: {
    color: colors.graphite,
    marginTop: 8,
    marginBottom: 2,
  },
  quantityFoodName: {
    ...typography.h1,
    fontSize: 30,
    lineHeight: 38,
    color: sc.textPrimary,
  },
  quantityFoodBrand: {
    fontSize: 14,
    color: colors.graphite,
    marginTop: 2,
  },
  unitTabs: {
    flexGrow: 0,
    marginTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: sc.border,
  },
  unitTabRow: {
    gap: 8,
  },
  unitTab: {
    minHeight: layout.touchMin,
    minWidth: 64,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  unitTabActive: {
    borderBottomColor: gold[300],
  },
  unitTabText: {
    fontSize: 16,
    color: colors.graphite,
  },
  unitTabTextActive: {
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.textPrimary,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: 20,
  },
  quantityInput: {
    minWidth: 48,
    minHeight: layout.buttonHeight,
    paddingVertical: 0,
    paddingHorizontal: 4,
    fontFamily: typography.display.fontFamily,
    fontSize: 56,
    lineHeight: 70,
    color: sc.textPrimary,
    textAlign: 'center',
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  amountUnit: {
    fontSize: 18,
    color: colors.graphite,
    marginLeft: 6,
  },
  summary: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.graphite,
    marginTop: 12,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  servingSizeInfo: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.graphite,
    marginTop: 4,
  },
  quantityLogButton: {
    marginTop: 24,
    marginBottom: 8,
  },
});
