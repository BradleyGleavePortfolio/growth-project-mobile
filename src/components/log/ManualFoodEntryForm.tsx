import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
} from 'react-native';
import HapticPressable from '../HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { QuietOverline } from '../../ui/sections/QuietSection';
import { PrimaryButton } from '../../ui';

export interface ManualFields {
  foodName: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  quantity: string;
  unit: string;
}

interface Props {
  fields: ManualFields;
  onFieldChange: (field: keyof ManualFields, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  saving?: boolean;
}

export default function ManualFoodEntryForm({ fields, onFieldChange, onBack, onSubmit, saving = false }: Props) {
  const missingMacros = !fields.protein.trim() || !fields.carbs.trim() || !fields.fat.trim();
  const missingCalories = !fields.calories.trim();
  const nutritionMessage = missingMacros
    ? 'Enter protein, carbs and fat. Use 0 if there is none.'
    : missingCalories ? 'Enter calories. Use 0 if there is none.' : null;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const field = (key: keyof ManualFields, label: string, placeholder: string, keyboardType?: 'numeric' | 'decimal-pad') => (
    <View style={styles.halfInput}>
      <QuietOverline style={styles.inputLabel}>{label}</QuietOverline>
      <TextInput
        style={styles.inputSmall}
        placeholder={placeholder}
        placeholderTextColor={sc.textMuted}
        keyboardType={keyboardType}
        value={fields[key]}
        onChangeText={(v) => onFieldChange(key, v)}
      />
    </View>
  );
  return (
    <ScrollView
      style={styles.modalBody}
      contentContainerStyle={styles.manualForm}
      keyboardShouldPersistTaps="handled"
    >
      <HapticPressable intent="light" style={styles.backToSearch} onPress={onBack} accessibilityRole="button">
        <Ionicons name="chevron-back" size={18} color={sc.accentText} />
        <Text style={styles.backToSearchText}>Back to search</Text>
      </HapticPressable>
      <Text style={styles.title} accessibilityRole="header">Food details</Text>
      <Text style={styles.portionHelp}>Enter nutrition for the whole portion below, not per serving.</Text>

      <QuietOverline style={styles.inputLabel}>Food name</QuietOverline>
      <TextInput
        style={styles.input}
        placeholder="Food name"
        placeholderTextColor={sc.textMuted}
        value={fields.foodName}
        onChangeText={(v) => onFieldChange('foodName', v)}
      />

      <View style={styles.row}>
        {field('calories', 'Calories', '0', 'numeric')}
        {field('protein', 'Protein (g)', '0', 'numeric')}
      </View>
      <View style={styles.row}>
        {field('carbs', 'Carbs (g)', '0', 'numeric')}
        {field('fat', 'Fat (g)', '0', 'numeric')}
      </View>
      <View style={styles.row}>
        {field('quantity', 'Portion quantity', '1', 'decimal-pad')}
        {field('unit', 'Unit', 'serving')}
      </View>

      {nutritionMessage && <Text style={styles.portionHelp} accessibilityRole="alert">{nutritionMessage}</Text>}
      <PrimaryButton
        label="Log food"
        onPress={onSubmit}
        disabled={missingMacros || missingCalories}
        loading={saving}
        testID="manual-log-food"
        style={styles.logButton}
      />
    </ScrollView>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  portionHelp: { color: sc.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 16, fontFamily: 'Inter_400Regular' },
  modalBody: {
    flex: 1,
  },
  manualForm: {
    paddingHorizontal: layout.gutter,
    paddingTop: 8,
    paddingBottom: 40,
  },
  backToSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: layout.touchMin,
    gap: 4,
    marginLeft: -4,
  },
  backToSearchText: {
    fontSize: 14,
    fontFamily: typography.bodyMd.fontFamily,
    color: sc.accentText,
  },
  title: {
    ...typography.h1,
    color: sc.textPrimary,
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    minHeight: layout.buttonHeight,
    backgroundColor: sc.bgSurface,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: sc.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    marginBottom: 16,
  },
  inputSmall: {
    minHeight: 48,
    backgroundColor: sc.bgSurface,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: sc.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
    fontVariant: ['tabular-nums'],
  },
  inputLabel: {
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  halfInput: {
    flex: 1,
  },
  logButton: {
    marginTop: 16,
  },
});
