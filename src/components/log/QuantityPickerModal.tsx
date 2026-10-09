import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import { layout, radius, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import FoodImage from '../FoodImage';
import HapticPressable from '../HapticPressable';
import { QuietOverline } from '../../ui/sections/QuietSection';
import { PrimaryButton, TextLink } from '../../ui';
import { SearchResult, unitOptionsFor } from '../../utils/log/types';
import { calcMacros, parseQuantityInput } from '../../utils/log/macros';

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
export function QuantityPickerContent({
  selectedFood,
  quantityInput,
  selectedUnit,
  onQuantityChange,
  onUnitChange,
  onConfirm,
  onCancel,
  saving = false,
}: Omit<Props, 'visible'>) {
  const quantity = parseQuantityInput(quantityInput);
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const previewMacros = selectedFood
    ? calcMacros(selectedFood, quantity ?? 0, selectedUnit)
    : { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const displayMacro = (value: number) => Number.isFinite(value) ? String(value) : '—';

  const macros = [
    { key: 'calories', label: 'Calories', value: displayMacro(previewMacros.calories) },
    { key: 'protein', label: 'Protein', value: `${displayMacro(previewMacros.protein)}g` },
    { key: 'carbs', label: 'Carbs', value: `${displayMacro(previewMacros.carbs)}g` },
    { key: 'fat', label: 'Fat', value: `${displayMacro(previewMacros.fat)}g` },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.quantityModalContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.quantityModalContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          {selectedFood?.image_url ? (
            <Image
              source={{ uri: selectedFood.image_url }}
              style={styles.quantityFoodImage}
              resizeMode="cover"
            />
          ) : (
            <FoodImage name={selectedFood?.name || '?'} size={96} />
          )}
        </View>

        <Text style={styles.quantityFoodName} accessibilityRole="header">{selectedFood?.name}</Text>
        {selectedFood?.brand ? (
          <Text style={styles.quantityFoodBrand}>{selectedFood.brand}</Text>
        ) : null}

        <View style={styles.macroPreviewCard}>
          {macros.map((macro) => (
            <View key={macro.key} style={styles.macroPreviewItem}>
              <QuietOverline style={styles.macroPreviewLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{macro.label}</QuietOverline>
              <Text style={styles.macroPreviewValue}>{macro.value}</Text>
            </View>
          ))}
        </View>

        <QuietOverline style={styles.quantitySectionLabel}>Quantity</QuietOverline>
        <TextInput
          accessibilityLabel="Food quantity"
          style={styles.quantityInput}
          value={quantityInput}
          onChangeText={onQuantityChange}
          keyboardType="decimal-pad"
          placeholder="1"
          placeholderTextColor={sc.textMuted}
        />

        <QuietOverline style={styles.quantitySectionLabel}>Unit</QuietOverline>
        <View style={styles.unitChipRow}>
          {unitOptionsFor(selectedFood).map((u) => (
            <HapticPressable
              key={u}
              intent="light"
              disableAnimation
              accessibilityRole="button"
              accessibilityLabel={`Portion unit ${u}`}
              accessibilityState={{ selected: selectedUnit === u }}
              style={[styles.unitChip, selectedUnit === u && styles.unitChipActive]}
              onPress={() => onUnitChange(u)}
            >
              <Text style={[styles.unitChipText, selectedUnit === u && styles.unitChipTextActive]}>{u}</Text>
            </HapticPressable>
          ))}
        </View>

        {selectedFood?.serving_size ? (
          <Text style={styles.servingSizeInfo}>1 serving = {selectedFood.serving_size}</Text>
        ) : null}
        {['cup', 'tbsp', 'tsp'].includes(selectedUnit) ? (
          <Text style={styles.servingSizeInfo}>Volume weights are estimates. Use grams for a weighed portion.</Text>
        ) : null}
        {quantity == null ? (
          <Text style={styles.servingSizeInfo}>Enter a quantity greater than zero to log this food.</Text>
        ) : null}

        <PrimaryButton
          label="Log food"
          disabled={quantity == null}
          loading={saving}
          onPress={onConfirm}
          testID="quantity-log-food"
          style={styles.quantityLogButton}
        />
        <TextLink label="Cancel" underline={false} disabled={saving} onPress={onCancel} />
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
    paddingTop: 32,
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 20,
  },
  quantityFoodImage: {
    width: 96,
    height: 96,
    borderRadius: radius.card,
  },
  quantityFoodName: {
    ...typography.h1,
    color: sc.textPrimary,
    textAlign: 'center',
  },
  quantityFoodBrand: {
    fontSize: 14,
    color: sc.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  macroPreviewCard: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: layout.sectionPadY,
    marginTop: layout.sectionGap,
    marginBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  macroPreviewItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  macroPreviewLabel: {
    marginBottom: 4,
  },
  macroPreviewValue: {
    ...typography.h2,
    color: sc.textPrimary,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  quantitySectionLabel: {
    marginTop: 20,
    marginBottom: 8,
  },
  quantityInput: {
    minHeight: layout.buttonHeight,
    backgroundColor: sc.bgSurface,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    paddingHorizontal: 16,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 20,
    color: sc.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  unitChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  unitChip: {
    minHeight: layout.touchMin,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  unitChipActive: {
    borderWidth: 1,
    borderColor: sc.accent,
  },
  unitChipText: {
    fontSize: 14,
    color: sc.textMuted,
  },
  unitChipTextActive: {
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.accentText,
  },
  servingSizeInfo: {
    fontSize: 13,
    lineHeight: 19,
    color: sc.textMuted,
    marginTop: 4,
  },
  quantityLogButton: {
    marginTop: 32,
    marginBottom: 8,
  },
});
