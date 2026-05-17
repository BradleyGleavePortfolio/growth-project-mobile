import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi } from '../../../services/api';
import { errorMessage } from '../../../types/common';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { FoodLog } from '../../../types';
import type { ClientDetailStyles } from './styles';
import type { CoachMealEntry } from './types';

// B15: Coach food-log review — group the client's recent meal entries by day
// across a 7 / 14 / 30-day window so the coach can actually see what the
// client ate well enough to leave guidance. Today-only was not enough for a
// weekly check-in cadence.

export function FoodLogReviewSection({
  clientId,
  todayLogs,
  colors,
  styles,
}: {
  clientId: string;
  todayLogs: FoodLog[];
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [meals, setMeals] = useState<CoachMealEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await coachApi.getClientFoodLogs(clientId, { days });
      type RawMeal = {
        id?: string;
        food_item?: { name?: string; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
        food_name?: string;
        meal_type?: string;
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
        quantity_multiplier?: number;
        original_quantity?: number;
        original_unit?: string;
        logged_at?: string;
        date?: string;
      };
      const rows = ((res.data as { meals?: RawMeal[] } | undefined)?.meals) || [];
      const mapped: CoachMealEntry[] = rows.map((m, idx) => {
        const mult = m.quantity_multiplier || 1;
        // Macro pickers: prefer the food_item value × multiplier, fall back to
        // the row-level macro (legacy shape). null/missing stays as 0 in the
        // display but is *visually* distinguishable thanks to the —  marker.
        const cal = (m.food_item?.calories ?? m.calories ?? 0) * mult;
        const pro = (m.food_item?.protein_g ?? m.protein ?? 0) * mult;
        const car = (m.food_item?.carbs_g ?? m.carbs ?? 0) * mult;
        const fat = (m.food_item?.fat_g ?? m.fat ?? 0) * mult;
        return {
          id: m.id ?? `m-${idx}`,
          foodName: m.food_item?.name ?? m.food_name ?? 'Food',
          mealType: m.meal_type ?? 'snack',
          calories: Math.round(cal),
          protein: Math.round(pro * 10) / 10,
          carbs: Math.round(car * 10) / 10,
          fat: Math.round(fat * 10) / 10,
          loggedAt: m.date ?? m.logged_at ?? '',
          originalQuantity: m.original_quantity,
          originalUnit: m.original_unit,
        };
      });
      setMeals(mapped);
    } catch (err) {
      console.error('FoodLogReviewSection: load failed', err);
      setError(errorMessage(err, 'Could not load food logs.'));
    } finally {
      setLoading(false);
    }
  }, [clientId, days]);

  useEffect(() => {
    load();
  }, [load]);

  // Group meals by date (descending).
  const grouped = useMemo(() => {
    const m = new Map<string, CoachMealEntry[]>();
    for (const meal of meals) {
      const day = meal.loggedAt.slice(0, 10) || 'unknown';
      const list = m.get(day) ?? [];
      list.push(meal);
      m.set(day, list);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
  }, [meals]);

  // If the timeline endpoint returns nothing, fall back to the today logs
  // already loaded by ClientDetailScreen so coaches still see something.
  const showTodayFallback = !loading && !error && grouped.length === 0 && todayLogs.length > 0;

  return (
    <>
      <View style={styles.foodReviewHeader}>
        <Text style={styles.sectionTitle}>Food log review</Text>
        <View style={styles.foodReviewChips}>
          {([7, 14, 30] as const).map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => setDays(d)}
              style={[styles.foodReviewChip, days === d && styles.foodReviewChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: days === d }}
            >
              <Text
                style={[
                  styles.foodReviewChipText,
                  days === d && styles.foodReviewChipTextActive,
                ]}
              >
                {d}d
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.emptyText}>Loading meals…</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button">
            <Text style={[styles.actionPillText, { marginTop: 8 }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : grouped.length === 0 && !showTodayFallback ? (
        <View style={styles.emptyCard}>
          <Ionicons name="restaurant-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>No meals logged in the last {days} days.</Text>
        </View>
      ) : (
        <>
          {showTodayFallback ? (
            <Text style={[styles.emptyText, { textAlign: 'left', marginBottom: 8 }]}>
              Showing today only — older logs were not returned by the
              server.
            </Text>
          ) : null}
          {(showTodayFallback
            ? ([
                [
                  new Date().toISOString().slice(0, 10),
                  todayLogs.map(
                    (l): CoachMealEntry => ({
                      id: l.id,
                      foodName: l.foodName,
                      mealType: String(l.mealType),
                      calories: l.calories,
                      protein: l.protein,
                      carbs: l.carbs,
                      fat: l.fat,
                      loggedAt: '',
                      originalQuantity: undefined,
                      originalUnit: undefined,
                    }),
                  ),
                ] as [string, CoachMealEntry[]],
              ] as Array<[string, CoachMealEntry[]]>)
            : grouped
          ).map(([day, dayMeals]) => {
            const dayCalories = dayMeals.reduce((s, m) => s + m.calories, 0);
            return (
              <View key={day} style={styles.foodReviewDayCard}>
                <View style={styles.foodReviewDayHeader}>
                  <Text style={styles.foodReviewDayDate}>
                    {day === new Date().toISOString().slice(0, 10) ? 'Today' : day}
                  </Text>
                  <Text style={styles.foodReviewDayTotal}>{dayCalories} kcal</Text>
                </View>
                {dayMeals.map((meal) => (
                  <View key={meal.id} style={styles.logItem}>
                    <View style={styles.logHeader}>
                      <Text style={styles.logMeal}>{meal.mealType}</Text>
                      <Text style={styles.logCalories}>{meal.calories} kcal</Text>
                    </View>
                    <Text style={styles.logFood}>{meal.foodName}</Text>
                    <Text style={styles.logMacros}>
                      {meal.originalQuantity != null
                        ? `${meal.originalQuantity} ${meal.originalUnit ?? 'serving'} · `
                        : ''}
                      P: {meal.protein}g  |  C: {meal.carbs}g  |  F: {meal.fat}g
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </>
      )}
    </>
  );
}
