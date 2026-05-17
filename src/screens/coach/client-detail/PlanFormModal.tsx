import React from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import { emptyItemDraft, type CoachMealPlan, type PlanItemDraft } from './types';

export function PlanFormModal({
  visible,
  onClose,
  editingPlan,
  planTitle,
  setPlanTitle,
  planNotes,
  setPlanNotes,
  planItems,
  setPlanItems,
  planFormError,
  planSaving,
  onSubmit,
  colors,
  styles,
}: {
  visible: boolean;
  onClose: () => void;
  editingPlan: CoachMealPlan | null;
  planTitle: string;
  setPlanTitle: (s: string) => void;
  planNotes: string;
  setPlanNotes: (s: string) => void;
  planItems: PlanItemDraft[];
  setPlanItems: React.Dispatch<React.SetStateAction<PlanItemDraft[]>>;
  planFormError: string;
  planSaving: boolean;
  onSubmit: () => void;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.planModalContainer}>
        <View style={styles.planModalHeader}>
          <Text style={styles.planModalTitle}>
            {editingPlan ? 'Edit meal plan' : 'New meal plan'}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.planModalContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.planFieldLabel}>Title</Text>
          <TextInput
            style={styles.planInput}
            placeholder="e.g. Cutting Week 1"
            placeholderTextColor={colors.textMuted}
            value={planTitle}
            onChangeText={setPlanTitle}
            maxLength={120}
            accessibilityLabel="Plan title"
          />

          <Text style={styles.planFieldLabel}>Notes (optional)</Text>
          <TextInput
            style={[styles.planInput, styles.planInputMulti]}
            placeholder="Overall guidance for this plan..."
            placeholderTextColor={colors.textMuted}
            value={planNotes}
            onChangeText={setPlanNotes}
            multiline
            maxLength={1000}
            accessibilityLabel="Plan notes"
          />

          <View style={styles.planItemsHeader}>
            <Text style={styles.planFieldLabel}>Items</Text>
            <TouchableOpacity
              onPress={() => setPlanItems((prev) => [...prev, emptyItemDraft()])}
              style={styles.planAddItemBtn}
              accessibilityRole="button"
              accessibilityLabel="Add meal item"
            >
              <Ionicons name="add" size={14} color={colors.primary} />
              <Text style={styles.planAddItemText}>Add item</Text>
            </TouchableOpacity>
          </View>

          {planItems.map((it, idx) => (
            <View key={idx} style={styles.planItemCard}>
              <View style={styles.planItemTopRow}>
                <Text style={styles.planItemIndex}>#{idx + 1}</Text>
                {planItems.length > 1 && (
                  <TouchableOpacity
                    onPress={() =>
                      setPlanItems((prev) => prev.filter((_, i) => i !== idx))
                    }
                    accessibilityRole="button"
                    accessibilityLabel="Remove item"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={styles.planItemInput}
                placeholder="Meal name (e.g. Chicken & rice)"
                placeholderTextColor={colors.textMuted}
                value={it.name}
                onChangeText={(t) =>
                  setPlanItems((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, name: t } : p)),
                  )
                }
                maxLength={120}
                accessibilityLabel={`Item ${idx + 1} name`}
              />
              <View style={styles.planItemRow}>
                <TextInput
                  style={[styles.planItemInput, { flex: 1 }]}
                  placeholder="kcal"
                  placeholderTextColor={colors.textMuted}
                  value={it.calories}
                  onChangeText={(t) =>
                    setPlanItems((prev) =>
                      prev.map((p, i) => (i === idx ? { ...p, calories: t } : p)),
                    )
                  }
                  keyboardType="number-pad"
                  maxLength={6}
                  accessibilityLabel={`Item ${idx + 1} calories`}
                />
                <TextInput
                  style={[styles.planItemInput, { flex: 1 }]}
                  placeholder="protein (g)"
                  placeholderTextColor={colors.textMuted}
                  value={it.protein}
                  onChangeText={(t) =>
                    setPlanItems((prev) =>
                      prev.map((p, i) => (i === idx ? { ...p, protein: t } : p)),
                    )
                  }
                  keyboardType="number-pad"
                  maxLength={5}
                  accessibilityLabel={`Item ${idx + 1} protein`}
                />
              </View>
              <TextInput
                style={styles.planItemInput}
                placeholder="time of day (breakfast / lunch / dinner / snack)"
                placeholderTextColor={colors.textMuted}
                value={it.time_of_day}
                onChangeText={(t) =>
                  setPlanItems((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, time_of_day: t } : p)),
                  )
                }
                maxLength={32}
                autoCapitalize="none"
                accessibilityLabel={`Item ${idx + 1} time of day`}
              />
              <TextInput
                style={[styles.planItemInput, styles.planInputMulti]}
                placeholder="Notes (optional)"
                placeholderTextColor={colors.textMuted}
                value={it.notes}
                onChangeText={(t) =>
                  setPlanItems((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, notes: t } : p)),
                  )
                }
                multiline
                maxLength={300}
                accessibilityLabel={`Item ${idx + 1} notes`}
              />
            </View>
          ))}

          {planFormError ? (
            <Text style={styles.planFormError} accessibilityLiveRegion="assertive">
              {planFormError}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.planSubmitBtn, planSaving && { opacity: 0.6 }]}
            onPress={onSubmit}
            disabled={planSaving}
            accessibilityRole="button"
            accessibilityLabel={editingPlan ? 'Save changes' : 'Create plan'}
          >
            <Text style={styles.planSubmitText}>
              {planSaving ? 'Saving…' : editingPlan ? 'Save changes' : 'Create plan'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
