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
import { Colors, Radius } from '../../theme/index';

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
}

export default function ManualFoodEntryForm({ fields, onFieldChange, onBack, onSubmit }: Props) {
  return (
    <ScrollView
      style={styles.modalBody}
      contentContainerStyle={styles.manualForm}
      keyboardShouldPersistTaps="handled"
    >
      <HapticPressable intent="light" style={styles.backToSearch} onPress={onBack}>
        <Ionicons name="arrow-back" size={18} color={Colors.primary} />
        <Text style={styles.backToSearchText}>Back to Search</Text>
      </HapticPressable>

      <TextInput
        style={styles.input}
        placeholder="Food name"
        placeholderTextColor={Colors.textMuted}
        value={fields.foodName}
        onChangeText={(v) => onFieldChange('foodName', v)}
      />

      <View style={styles.row}>
        <View style={styles.halfInput}>
          <Text style={styles.inputLabel}>Calories</Text>
          <TextInput
            style={styles.inputSmall}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            value={fields.calories}
            onChangeText={(v) => onFieldChange('calories', v)}
          />
        </View>
        <View style={styles.halfInput}>
          <Text style={styles.inputLabel}>Protein (g)</Text>
          <TextInput
            style={styles.inputSmall}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            value={fields.protein}
            onChangeText={(v) => onFieldChange('protein', v)}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.halfInput}>
          <Text style={styles.inputLabel}>Carbs (g)</Text>
          <TextInput
            style={styles.inputSmall}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            value={fields.carbs}
            onChangeText={(v) => onFieldChange('carbs', v)}
          />
        </View>
        <View style={styles.halfInput}>
          <Text style={styles.inputLabel}>Fat (g)</Text>
          <TextInput
            style={styles.inputSmall}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            value={fields.fat}
            onChangeText={(v) => onFieldChange('fat', v)}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.halfInput}>
          <Text style={styles.inputLabel}>Quantity</Text>
          <TextInput
            style={styles.inputSmall}
            placeholder="1"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            value={fields.quantity}
            onChangeText={(v) => onFieldChange('quantity', v)}
          />
        </View>
        <View style={styles.halfInput}>
          <Text style={styles.inputLabel}>Unit</Text>
          <TextInput
            style={styles.inputSmall}
            placeholder="serving"
            placeholderTextColor={Colors.textMuted}
            value={fields.unit}
            onChangeText={(v) => onFieldChange('unit', v)}
          />
        </View>
      </View>

      <HapticPressable intent="success" style={styles.logButton} onPress={onSubmit}>
        <Ionicons name="add-circle" size={22} color={Colors.white} />
        <Text style={styles.logButtonText}>Log Food</Text>
      </HapticPressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
  },
  manualForm: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  backToSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  backToSearchText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.dark,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  inputSmall: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.dark,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  halfInput: {
    flex: 1,
  },
  logButton: {
    backgroundColor: Colors.primary,
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logButtonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '500',
  },
});
