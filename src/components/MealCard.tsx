import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { FoodLog, MealType } from '../types';

interface MealCardProps {
  mealType: MealType;
  foods: FoodLog[];
}

const MEAL_ICONS: Record<MealType, string> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snack: 'cafe-outline',
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export default function MealCard({ mealType, foods }: MealCardProps) {
  const [expanded, setExpanded] = useState(false);

  const totalCals = foods.reduce((sum, f) => sum + f.calories, 0);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons
            name={MEAL_ICONS[mealType] as any}
            size={20}
            color={Colors.primary}
          />
          <Text style={styles.mealLabel}>{MEAL_LABELS[mealType]}</Text>
          {foods.length > 0 && (
            <Text style={styles.itemCount}>({foods.length})</Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {totalCals > 0 && (
            <Text style={styles.totalCals}>{totalCals} kcal</Text>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={Colors.textMuted}
          />
        </View>
      </View>

      {expanded && foods.length > 0 && (
        <View style={styles.foodList}>
          {foods.map((food) => (
            <View key={food.id} style={styles.foodRow}>
              <View style={styles.foodInfo}>
                <Text style={styles.foodName}>{food.foodName}</Text>
                <Text style={styles.foodMeta}>
                  {food.quantity} {food.unit}
                </Text>
              </View>
              <View style={styles.foodNutrition}>
                <Text style={styles.foodCals}>{food.calories}</Text>
                <Text style={styles.foodProtein}>{food.protein}g P</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {expanded && foods.length === 0 && (
        <Text style={styles.emptyText}>No foods logged</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  itemCount: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  totalCals: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  foodList: {
    marginTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  foodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  foodInfo: {
    flex: 1,
  },
  foodName: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  foodMeta: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  foodNutrition: {
    alignItems: 'flex-end',
  },
  foodCals: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  foodProtein: {
    fontSize: 12,
    color: Colors.protein,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 12,
    textAlign: 'center',
  },
});
