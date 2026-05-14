import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, colors } from '../../theme/index';
import FoodImage from '../FoodImage';
import { SearchResult, unitOptionsFor } from '../../utils/log/types';
import { calcMacros } from '../../utils/log/macros';

interface Props {
  visible: boolean;
  selectedFood: SearchResult | null;
  quantityInput: string;
  selectedUnit: string;
  onQuantityChange: (value: string) => void;
  onUnitChange: (unit: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function QuantityPickerModal({
  visible,
  selectedFood,
  quantityInput,
  selectedUnit,
  onQuantityChange,
  onUnitChange,
  onConfirm,
  onCancel,
}: Props) {
  const previewMacros = selectedFood
    ? calcMacros(selectedFood, parseFloat(quantityInput) || 0, selectedUnit)
    : { calories: 0, protein: 0, carbs: 0, fat: 0 };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.quantityModalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.quantityModalContent}
          keyboardShouldPersistTaps="handled"
        >
          {selectedFood?.image_url ? (
            <Image
              source={{ uri: selectedFood.image_url }}
              style={styles.quantityFoodImage}
              resizeMode="cover"
            />
          ) : (
            <FoodImage name={selectedFood?.name || '?'} size={120} />
          )}

          <Text style={styles.quantityFoodName}>{selectedFood?.name}</Text>
          {selectedFood?.brand ? (
            <Text style={styles.quantityFoodBrand}>{selectedFood.brand}</Text>
          ) : null}

          <View style={styles.macroPreviewCard}>
            <View style={styles.macroPreviewItem}>
              <Text style={styles.macroPreviewValue}>{previewMacros.calories}</Text>
              <Text style={styles.macroPreviewLabel}>Cal</Text>
            </View>
            <View style={styles.macroPreviewDivider} />
            <View style={styles.macroPreviewItem}>
              <Text style={[styles.macroPreviewValue, { color: Colors.orange }]}>{previewMacros.protein}g</Text>
              <Text style={styles.macroPreviewLabel}>Protein</Text>
            </View>
            <View style={styles.macroPreviewDivider} />
            <View style={styles.macroPreviewItem}>
              <Text style={[styles.macroPreviewValue, { color: Colors.gold }]}>{previewMacros.carbs}g</Text>
              <Text style={styles.macroPreviewLabel}>Carbs</Text>
            </View>
            <View style={styles.macroPreviewDivider} />
            <View style={styles.macroPreviewItem}>
              <Text style={[styles.macroPreviewValue, { color: colors.data.habit }]}>{previewMacros.fat}g</Text>
              <Text style={styles.macroPreviewLabel}>Fat</Text>
            </View>
          </View>

          <Text style={styles.quantitySectionLabel}>Quantity</Text>
          <TextInput
            style={styles.quantityInput}
            value={quantityInput}
            onChangeText={onQuantityChange}
            keyboardType="decimal-pad"
            placeholder="1"
            placeholderTextColor={Colors.textMuted}
          />

          <Text style={styles.quantitySectionLabel}>Unit</Text>
          <View style={styles.unitChipRow}>
            {unitOptionsFor(selectedFood).map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unitChip, selectedUnit === u && styles.unitChipActive]}
                onPress={() => onUnitChange(u)}
              >
                <Text style={[styles.unitChipText, selectedUnit === u && styles.unitChipTextActive]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {selectedFood?.serving_size ? (
            <Text style={styles.servingSizeInfo}>1 serving = {selectedFood.serving_size}</Text>
          ) : null}

          <TouchableOpacity
            style={styles.quantityLogButton}
            onPress={onConfirm}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle" size={22} color={Colors.white} />
            <Text style={styles.quantityLogButtonText}>Log Food</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quantityCancelLink}
            onPress={onCancel}
          >
            <Text style={styles.quantityCancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  quantityModalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  quantityModalContent: {
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  quantityFoodImage: {
    width: 120,
    height: 120,
    borderRadius: Radius.lg,
    marginBottom: 16,
  },
  quantityFoodName: {
    fontSize: 22,
    fontWeight: '500',
    color: Colors.dark,
    textAlign: 'center',
    marginBottom: 4,
  },
  quantityFoodBrand: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  macroPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  macroPreviewItem: {
    flex: 1,
    alignItems: 'center',
  },
  macroPreviewValue: {
    fontSize: 18,
    fontWeight: '500',
    color: Colors.dark,
  },
  macroPreviewLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  macroPreviewDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  quantitySectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  quantityInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: '500',
    color: Colors.dark,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
    width: '100%',
    textAlign: 'center',
  },
  unitChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    width: '100%',
  },
  unitChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  unitChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  unitChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  unitChipTextActive: {
    color: Colors.white,
  },
  servingSizeInfo: {
    fontSize: 13,
    color: Colors.textMuted,
    alignSelf: 'flex-start',
    marginBottom: 20,
    marginTop: 4,
  },
  quantityLogButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    marginTop: 8,
  },
  quantityLogButtonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '500',
  },
  quantityCancelLink: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  quantityCancelText: {
    fontSize: 15,
    color: Colors.textMuted,
    fontWeight: '600',
  },
});
