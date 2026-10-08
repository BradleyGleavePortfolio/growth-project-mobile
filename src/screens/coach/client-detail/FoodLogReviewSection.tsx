import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FoodReviewUnavailableError, loadCoachFoodReview, type RecordedFoodEntry } from '../../../api/coachFoodReviewApi';
import { useCurrentMacrosForClient } from '../../../hooks/useMacros';
import {
  foodEntryTotals,
  groupRecordedMeals,
  resolveCoachTargets,
  sumFoodEntries,
} from '../../../utils/coach/foodReview';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientProfile } from '../../../types';
import type { ClientDetailStyles } from './styles';
import { formatDate } from '../../../utils/date';

const mealLabels: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
};

export function FoodLogReviewSection({
  clientId,
  profile,
  onOpenMessages,
  onOpenMealPlans,
  colors,
  styles,
}: {
  clientId: string;
  profile?: ClientProfile | null;
  onOpenMessages?: () => void;
  onOpenMealPlans?: () => void;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [meals, setMeals] = useState<RecordedFoodEntry[]>([]);
  const [shared, setShared] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentTarget = useCurrentMacrosForClient(clientId);
  const targets = !currentTarget.isLoading && !currentTarget.isError
    ? resolveCoachTargets(currentTarget.data, profile)
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadCoachFoodReview(clientId, days);
      setMeals(result.meals);
      setShared(result.shared);
    } catch (err) {
      console.error('FoodLogReviewSection: load failed', err);
      setError(err instanceof FoodReviewUnavailableError
        ? err.message
        : 'Food logs could not be loaded. Check the connection, then tap Retry.');
    } finally {
      setLoading(false);
    }
  }, [clientId, days]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => groupRecordedMeals(meals), [meals]);
  const windowTotals = useMemo(() => sumFoodEntries(meals), [meals]);

  return (
    <>
      <View style={styles.foodReviewHeader}>
        <Text style={[styles.sectionTitle, { flex: 1 }]} accessibilityRole="header">Food log review</Text>
        <View style={styles.foodReviewChips}>
          {([7, 14, 30] as const).map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => setDays(d)}
              style={[styles.foodReviewChip, { minHeight: 44, justifyContent: 'center' }, days === d && styles.foodReviewChipActive]}
              accessibilityRole="button"
              accessibilityLabel={`Review the last ${d} days of food logs`}
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

      <View style={styles.actionsRow}>
        {onOpenMessages ? (
          <TouchableOpacity style={styles.actionPill} onPress={onOpenMessages} accessibilityRole="button">
            <Text style={styles.actionPillText}>Send feedback</Text>
          </TouchableOpacity>
        ) : null}
        {onOpenMealPlans ? (
          <TouchableOpacity style={styles.actionPill} onPress={onOpenMealPlans} accessibilityRole="button">
            <Text style={styles.actionPillText}>Meal plans</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.actionPill}
          onPress={() => { void load(); void currentTarget.refetch(); }}
          disabled={loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
        >
          <Text style={styles.actionPillText}>Refresh</Text>
        </TouchableOpacity>
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
      ) : !shared ? (
        <View style={styles.emptyCard}>
          <Ionicons name="lock-closed-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>Food logs are not shared with this coach.</Text>
        </View>
      ) : grouped.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="restaurant-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>No meals logged in the last {days} days.</Text>
        </View>
      ) : (
        <>
          <View style={styles.foodReviewDayCard}>
            <Text style={styles.foodReviewDayDate}>Current daily target</Text>
            {currentTarget.isLoading ? (
              <Text style={styles.logMacros}>Loading target…</Text>
            ) : currentTarget.isError ? (
              <Text style={styles.logMacros}>Target unavailable. Tap Refresh to retry.</Text>
            ) : targets ? (
              <Text style={styles.logMacros}>
                {targets.calories} kcal · P: {targets.protein ?? '—'}g · C: {targets.carbs ?? '—'}g · F: {targets.fat ?? '—'}g
              </Text>
            ) : (
              <Text style={styles.logMacros}>No daily target available.</Text>
            )}
            <Text style={[styles.logMacros, { marginTop: 8 }]}>
              {grouped.length} days with logs · {meals.length} food entries
            </Text>
            <Text style={styles.logMacros}>
              Average per logged day: {Math.round(windowTotals.calories / grouped.length)} kcal · P: {Math.round(windowTotals.protein / grouped.length)}g
            </Text>
            <Text style={[styles.logMacros, { marginTop: 8 }]}>
              Days without logs are not counted as zero intake. Meal-plan completion is not tracked by food logs.
            </Text>
          </View>
          {grouped.map(([day, dayMeals]) => {
            const totals = sumFoodEntries(dayMeals);
            return (
              <View key={day} style={styles.foodReviewDayCard}>
                <View style={styles.foodReviewDayHeader}>
                  <Text style={styles.foodReviewDayDate}>{formatDate(day)}</Text>
                  <Text style={styles.foodReviewDayTotal}>{Math.round(totals.calories)} kcal</Text>
                </View>
                <Text style={[styles.logMacros, { marginBottom: 8 }]}>
                  P: {Math.round(totals.protein)}g · C: {Math.round(totals.carbs)}g · F: {Math.round(totals.fat)}g
                </Text>
                {targets?.calories != null && targets.calories > 0 ? (
                  <Text style={[styles.logMacros, { marginBottom: 8 }]}>
                    {Math.round((totals.calories / targets.calories) * 100)}% of current daily calorie target
                  </Text>
                ) : null}
                {dayMeals.map((meal) => {
                  const macros = foodEntryTotals(meal);
                  return (
                    <View key={meal.id} style={styles.logItem}>
                      <View style={styles.logHeader}>
                        <Text style={styles.logMeal}>{mealLabels[meal.meal_type] ?? 'Meal'}</Text>
                        <Text style={styles.logCalories}>{Math.round(macros.calories)} kcal</Text>
                      </View>
                      <Text style={styles.logFood}>{meal.food_item.name}</Text>
                      <Text style={styles.logMacros}>
                        {meal.original_quantity != null
                          ? `${meal.original_quantity} ${meal.original_unit ?? 'serving'} · `
                          : ''}
                        P: {Math.round(macros.protein * 10) / 10}g  |  C: {Math.round(macros.carbs * 10) / 10}g  |  F: {Math.round(macros.fat * 10) / 10}g
                      </Text>
                      {meal.notes ? <Text style={styles.logMacros}>Client note: {meal.notes}</Text> : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </>
      )}
    </>
  );
}
