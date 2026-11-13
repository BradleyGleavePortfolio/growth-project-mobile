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
import { colors, gold, layout, radius, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import HapticPressable from '../HapticPressable';
import { QuietOverline } from '../../ui/sections/QuietSection';
import { PrimaryButton, TextLink } from '../../ui';
import { SearchResult, unitOptionsFor } from '../../utils/log/types';
import { calcMacros, parseQuantityInput } from '../../utils/log/macros';
import PortionRuler from './PortionRuler';
import { fitTitle, fitUnitTabs, sheetRoom } from './portionFit';

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
  /**
   * FOOD-DAY-STYLEC-M (C2 C_portion, C2-S-32): what the day has left before this plate (target minus eaten).
   * Passed only by the Food tab behind featureFlags.foodPlanChecklist; without it no "After this plate" line.
   */
  dayLeft?: { kcal: number; protein: number } | null;
  /** C2-S-33: "Add another food" logs this plate and keeps the add sheet open; it takes Cancel's place. */
  onAddAnother?: () => void;
  /**
   * GOAL-930-M (C2 C_error): a save from this sheet failed. The card shows its title and words, and the primary
   * repeats the action that failed (`retry`; the caller names the primary through confirmLabel, "Try again").
   * Passed only by the Food tab behind featureFlags.foodPlanChecklist; absent, the sheet draws as before.
   */
  saveFailure?: { title: string; message: string; retry: 'confirm' | 'addAnother' } | null;
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
  dayLeft,
  onAddAnother,
  saveFailure,
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
  const screenSize = useWindowDimensions();
  const room = sheetRoom(screenSize.width);
  const title = fitTitle(selectedFood?.name ?? '', room, screenSize.fontScale || 1, typography.h1.letterSpacing);
  const tabs = fitUnitTabs(units, room, screenSize.fontScale || 1);
  // No-break spaces keep each number with its unit when the line wraps (320 pt, 130% text).
  const summary = `${shown(previewMacros.calories)}\u00A0kcal, ${shown(previewMacros.protein)}\u00A0g protein, `
    + `${shown(previewMacros.carbs)}\u00A0g carbs, ${shown(previewMacros.fat)}\u00A0g fat.`;
  // C2-S-32: the plate as the summary shows it (rounded) taken from what the day has left. Once the plate passes
  // the target there is no drawn sentence, so no line; protein still to go never reads below 0.
  const plateKcal = Math.round(previewMacros.calories);
  const afterKcal = dayLeft ? Math.round(dayLeft.kcal) - plateKcal : -1;
  const afterProtein = dayLeft ? Math.max(0, Math.round(dayLeft.protein) - Math.round(previewMacros.protein)) : 0;
  const afterPlate = dayLeft && quantity != null && Number.isFinite(plateKcal) && afterKcal >= 0
    ? `After this plate: ${afterKcal.toLocaleString('en-US')} kcal left and ${afterProtein.toLocaleString('en-US')} g protein to go.`
    : null;

  return (
    <KeyboardAvoidingView
      style={styles.quantityModalContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.quantityModalContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.gripWrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View testID="sheet-grip" style={styles.grip} />
        </View>
        {mealLabel ? <QuietOverline style={styles.mealLine}>For {mealLabel}</QuietOverline> : null}
        <Text style={[styles.quantityFoodName, { fontSize: title.fontSize, lineHeight: title.lineHeight }]}
          allowFontScaling={false} accessibilityRole="header" accessibilityLabel={selectedFood?.name}>{title.text}</Text>
        {selectedFood?.brand ? (
          <Text style={styles.quantityFoodBrand}>{selectedFood.brand}</Text>
        ) : null}

        {/* PORTION-WRAP-M: one row of tabs at every phone width and text size (portionFit); wraps only if a window is narrower than any phone. */}
        <View style={[styles.unitTabs, { columnGap: tabs.gap, flexWrap: tabs.wrap ? 'wrap' : 'nowrap',
          justifyContent: tabs.spread ? 'space-between' : 'flex-start', marginHorizontal: -tabs.bleed }]}>
          {units.map((u) => (
            <HapticPressable
              key={u}
              intent="light"
              disableAnimation
              accessibilityRole="tab"
              accessibilityLabel={`Portion unit ${u}`}
              accessibilityState={{ selected: selectedUnit === u }}
              style={[styles.unitTab, { minWidth: tabs.minWidth, paddingHorizontal: tabs.padding }, selectedUnit === u && styles.unitTabActive]}
              onPress={() => onUnitChange(u)}
            >
              <Text allowFontScaling={false} style={[styles.unitTabText, { fontSize: Math.min(15 * (screenSize.fontScale || 1), tabs.fontSize) },
                selectedUnit === u && styles.unitTabTextActive]}>{u}</Text>
            </HapticPressable>
          ))}
        </View>

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
        {afterPlate ? <Text style={styles.afterPlate} testID="portion-after-plate">{afterPlate}</Text> : null}
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
        {/* GOAL-930-M (C_error .c-err): the failed save stays on screen with the portion, announced once. */}
        {saveFailure ? (
          <View accessible accessibilityRole="alert" style={styles.failure} testID="portion-save-failure">
            <Text style={styles.failureTitle}>{saveFailure.title}</Text>
            <Text style={styles.failureText}>{saveFailure.message}</Text>
          </View>
        ) : null}

        <PrimaryButton
          label={confirmLabel}
          disabled={quantity == null || blocked}
          loading={saving}
          onPress={onConfirm}
          testID="quantity-log-food"
          style={[styles.quantityLogButton, saveFailure || (afterPlate && !selectedFood?.serving_size
            && !['cup', 'tbsp', 'tsp'].includes(selectedUnit) && !notice) ? styles.afterPlateButton : undefined]}
        />
        {onAddAnother ? (
          <TextLink label="Add another food" tone="accent" disabled={saving || quantity == null || blocked} onPress={onAddAnother}
            testID="quantity-add-another" />
        ) : (
          <TextLink label="Cancel" tone="accent" disabled={saving} onPress={onCancel} />
        )}
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
  gripWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 14,
  },
  grip: {
    width: 36,
    height: 5,
    borderRadius: radius.control,
    backgroundColor: sc.border,
  },
  mealLine: {
    fontFamily: 'Inter_600SemiBold',
    color: sc.textMuted,
    marginTop: 0,
    marginBottom: 2,
  },
  quantityFoodName: {
    ...typography.h1,
    fontSize: 24,
    lineHeight: 30,
    color: sc.textPrimary,
  },
  quantityFoodBrand: {
    fontSize: 14,
    color: colors.graphite,
    marginTop: 2,
  },
  unitTabs: {
    flexDirection: 'row',
    marginTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: sc.border,
  },
  unitTab: {
    minHeight: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  unitTabActive: {
    borderBottomColor: gold[300],
  },
  unitTabText: {
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.textMuted,
  },
  unitTabTextActive: {
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.textPrimary,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: 12,
  },
  quantityInput: {
    minWidth: 48,
    minHeight: layout.buttonHeight,
    paddingVertical: 0,
    paddingHorizontal: 4,
    fontFamily: typography.h3.fontFamily,
    fontSize: 48,
    lineHeight: 60,
    color: sc.textPrimary,
    textAlign: 'center',
    fontVariant: ['oldstyle-nums'],
  },
  amountUnit: {
    fontFamily: typography.body.fontFamily,
    fontSize: 16,
    color: sc.textMuted,
    marginLeft: 6,
  },
  summary: {
    fontSize: 14,
    lineHeight: 20.02,
    color: sc.textMuted,
    marginTop: 4,
    marginBottom: 4,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  // C_portion: the after-this-plate line sits under the summary in ink, at the summary's size (C_portion draws both lines as one meta size).
  afterPlate: {
    fontSize: 14,
    lineHeight: 20.02,
    color: sc.textPrimary,
    marginTop: 0,
    marginBottom: 10,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  servingSizeInfo: {
    fontSize: 14,
    lineHeight: 20.02,
    color: sc.textMuted,
    marginTop: 4,
  },
  quantityLogButton: {
    marginTop: 10,
    marginBottom: 0,
  },
  afterPlateButton: {
    marginTop: 0,
  },
  // C_error.html :137-138 (.c-err): a 3 pt warning-ink left edge on the warning fill, corners 0 12 12 0, padding 10 12,
  // margin 10 0 (the 10 below is the button's space), Inter 15/21.75 in ink, the title bold on its own line (Inter 600,
  // the boldest weight the app loads).
  failure: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warningInk,
    backgroundColor: colors.warningBg,
    borderTopRightRadius: radius.button,
    borderBottomRightRadius: radius.button,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginVertical: 10,
  },
  failureTitle: {
    fontFamily: typography.micro.fontFamily,
    fontSize: 15,
    lineHeight: 21.75,
    color: sc.textPrimary,
  },
  failureText: {
    fontFamily: typography.body.fontFamily,
    fontSize: 15,
    lineHeight: 21.75,
    color: sc.textPrimary,
  },
});
