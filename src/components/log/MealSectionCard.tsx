import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '../../theme/index';
import { FoodLog, MealType } from '../../types';
import type { IoniconName } from '../../types/common';

interface Props {
  label: string;
  icon: string;
  mealType: MealType;
  logs: FoodLog[];
  mealCalories: number;
  onAddPress: (mealType: MealType) => void;
  onDeletePress: (log: FoodLog) => void;
}

export default function MealSectionCard({
  label,
  icon,
  mealType,
  logs,
  mealCalories,
  onAddPress,
  onDeletePress,
}: Props) {
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
        <Text style={styles.emptyMealText}>No foods logged yet</Text>
      )}

      {logs.map((log) => (
        <HapticPressable
          key={log.id}
          intent="light"
          style={styles.foodItem}
          onLongPress={() => onDeletePress(log)}
        >
          <View style={styles.foodItemLeft}>
            <Text style={styles.foodName}>
              {log.foodName}
              {log.quantity > 1 && (
                <Text style={styles.foodQuantityMuted}>
                  {' '}· ×{log.quantity}
                </Text>
              )}
            </Text>
            <Text style={styles.foodMacros}>
              P: {Math.round(log.protein)}g · C: {Math.round(log.carbs)}g · F: {Math.round(log.fat)}g
            </Text>
          </View>
          <Text style={styles.foodCals}>{Math.round(log.calories)}</Text>
        </HapticPressable>
      ))}

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

const styles = StyleSheet.create({
  mealSection: {
    marginHorizontal: Spacing.lg,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
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
    color: Colors.textMuted,
  },
  foodItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  foodItemLeft: {
    flex: 1,
    marginRight: 12,
  },
  foodName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark,
  },
  foodQuantityMuted: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.textMuted,
  },
  foodMacros: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  foodCals: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.dark,
  },
  addFoodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 4,
  },
  addFoodText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  emptyMealText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
