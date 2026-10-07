import React from 'react';
import { View, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '../../theme/index';
import { useTheme } from '../../theme/useTheme';
import { QuietText as Text } from '../../ui/progress/QuietBar';
import { FoodLog, MealType } from '../../types';
import type { IoniconName } from '../../types/common';
import { foodMacroLine, type MacroDisplayMode } from '../../macros/macroDisplay';

interface Props {
  label: string;
  icon: string;
  mealType: MealType;
  logs: FoodLog[];
  mealCalories: number;
  onAddPress: (mealType: MealType) => void;
  onDeletePress: (log: FoodLog) => void;
  // F-2: invoked on tap when the parent wants to surface an edit flow for a
  // logged entry. Optional so older parents that haven't wired editing yet
  // keep working unchanged.
  onEditPress?: (log: FoodLog) => void;
  /** 'simple' during a never-tracker's first week: protein only per entry. */
  macroMode?: MacroDisplayMode;
}

export default function MealSectionCard({
  label,
  icon,
  mealType,
  logs,
  mealCalories,
  onAddPress,
  onDeletePress,
  onEditPress,
  macroMode = 'full',
}: Props) {
  const styles = makeStyles(useTheme().semanticColors);
  return (
    <View style={styles.mealSection}>
      <View style={styles.mealHeader}>
        <View style={styles.mealHeaderLeft}>
          <Ionicons name={icon as IoniconName} size={18} color={Colors.primary} />
          <Text style={styles.mealTitle}>{label}</Text>
        </View>
        <Text style={styles.mealCals}>
          {mealCalories > 0 ? `${Math.round(mealCalories)} kcal` : ''}
        </Text>
      </View>

      {logs.length === 0 && (
        <Text style={styles.emptyMealText}>No foods logged. Use Add Food below.</Text>
      )}
      {logs.length > 0 && onEditPress ? <Text style={styles.emptyMealText}>Tap an entry to edit, move or delete it.</Text> : null}

      {logs.map((log) => {
        // F-3: prefer the original entered quantity/unit pair when the
        // backend row carries it. Falls back to the multiplier × serving
        // legacy rendering for older rows.
        const hasOriginal =
          typeof log.originalQuantity === 'number' &&
          !!log.originalUnit &&
          (log.originalUnit || '').trim().length > 0;
        const qtyLabel = hasOriginal
          ? `${log.originalQuantity} ${log.originalUnit}`
          : log.quantity > 1
            ? `×${log.quantity}`
            : '';
        return (
          <HapticPressable
            key={log.id}
            intent="light"
            style={styles.foodItem}
            // F-2: tap = edit (when wired by parent), long-press = delete.
            // Falling back to delete-on-long-press preserves the legacy
            // gesture so existing users do not lose the path they know.
            onPress={onEditPress ? () => onEditPress(log) : undefined}
            onLongPress={() => onDeletePress(log)}
            accessibilityLabel={
              onEditPress
                ? `${log.foodName}, ${qtyLabel || 'one serving'}. Tap to edit, long-press to delete.`
                : `${log.foodName}, ${qtyLabel || 'one serving'}. Long-press to delete.`
            }
          >
            <View style={styles.foodItemLeft}>
              <Text style={styles.foodName}>
                {log.foodName}
                {qtyLabel ? (
                  <Text style={styles.foodQuantityMuted}> · {qtyLabel}</Text>
                ) : null}
              </Text>
              <Text style={styles.foodMacros}>
                {foodMacroLine(log, macroMode)}
              </Text>
            </View>
            <Text style={styles.foodCals}>{Math.round(log.calories)}</Text>
          </HapticPressable>
        );
      })}

      <HapticPressable
        intent="medium"
        style={styles.addFoodButton}
        onPress={() => onAddPress(mealType)}
      >
        <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
        <Text style={styles.addFoodText}>Add Food</Text>
      </HapticPressable>
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  mealSection: {
    marginHorizontal: Spacing.lg,
    marginBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    paddingVertical: Spacing.md,
  },
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  mealHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark,
  },
  mealCals: {
    fontSize: 13,
    fontWeight: '600',
    color: sc.textMuted,
  },
  foodItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
  },
  foodItemLeft: {
    flex: 1,
    marginRight: 12,
  },
  foodName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark,
  },
  foodQuantityMuted: {
    fontSize: 13,
    fontWeight: '400',
    color: sc.textMuted,
  },
  foodMacros: {
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 2,
  },
  foodCals: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.dark,
  },
  addFoodButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    marginTop: 4,
  },
  addFoodText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  emptyMealText: {
    fontSize: 13,
    color: sc.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
