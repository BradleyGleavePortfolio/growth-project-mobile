import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { prepGuideApi, listsApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import FadeInView from '../../components/FadeInView';
import EmptyState from '../../components/EmptyState';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrepRecipe {
  id: string;
  title: string;
  prep_time_min: number;
  cook_time_min: number;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tags: string[];
}

interface AggregatedIngredient {
  name: string;
  quantity: number;
  unit: string;
  recipe_ids: string[];
}

interface PrepGuideData {
  week_start: string;
  recipes: PrepRecipe[];
  aggregated_ingredients: AggregatedIngredient[];
  prep_day_suggestions: string[];
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function getWeekStart(offset = 0): string {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const monday = new Date(today);
  monday.setDate(diff);
  return monday.toISOString().split('T')[0];
}

function formatWeekLabel(weekStart: string): string {
  const date = new Date(weekStart + 'T00:00:00');
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(date)} – ${fmt(end)}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function PrepGuideScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = getWeekStart(weekOffset);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['prep-guide', weekStart],
    queryFn: () => prepGuideApi.getWeeklyGuide(weekStart).then((r) => r.data as PrepGuideData),
    staleTime: 5 * 60 * 1000,
  });

  const addToGroceryMutation = useMutation({
    mutationFn: async (ingredients: AggregatedIngredient[]) => {
      return listsApi.bulkAddItems('grocery', ingredients.map((i) => ({
        name: i.name,
        quantity: Math.round(i.quantity * 10) / 10,
        unit: i.unit || undefined,
      })));
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Invalidate grocery list so it's fresh when user navigates to it
      queryClient.invalidateQueries({ queryKey: ['lists', 'grocery'] });
      Alert.alert(
        'Added to Grocery List',
        `${data?.aggregated_ingredients.length ?? 0} ingredients added to your grocery list.`,
        [
          { text: 'OK' },
          {
            text: 'View List',
            onPress: () => navigation.navigate('GroceryList'),
          },
        ],
      );
    },
    onError: () =>
      Alert.alert('Error', 'Could not add ingredients to grocery list. Please try again.'),
  });

  const handleAddToGrocery = useCallback(() => {
    if (!data?.aggregated_ingredients.length) return;
    Alert.alert(
      'Add to Grocery List?',
      `Add ${data.aggregated_ingredients.length} aggregated ingredients from this week's recipes to your grocery list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: () => addToGroceryMutation.mutate(data.aggregated_ingredients),
        },
      ],
    );
  }, [data, addToGroceryMutation]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Prep Guide</Text>
      </View>

      {/* Week selector */}
      <View style={styles.weekSelector}>
        <TouchableOpacity
          style={styles.weekArrow}
          onPress={() => setWeekOffset((o) => o - 1)}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.primary} />
        </TouchableOpacity>
        <View style={styles.weekLabel}>
          <Text style={styles.weekLabelText}>{formatWeekLabel(weekStart)}</Text>
          {weekOffset === 0 ? (
            <Text style={styles.weekCurrentBadge}>This week</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.weekArrow}
          onPress={() => setWeekOffset((o) => o + 1)}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={Colors.primary}
          />
        }
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Building your prep guide…</Text>
          </View>
        ) : isError ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Couldn't load prep guide"
            subtitle="Pull down to try again."
          />
        ) : !data || data.recipes.length === 0 ? (
          <EmptyState
            icon="clipboard-outline"
            title="No recipes to prep"
            subtitle="Ask your coach to assign a meal plan with recipes to see your weekly prep guide here."
          />
        ) : (
          <>
            {/* Prep day suggestions */}
            {data.prep_day_suggestions.length > 0 ? (
              <FadeInView>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Suggested Prep Days</Text>
                  <View style={styles.prepDayRow}>
                    {data.prep_day_suggestions.map((day) => (
                      <View key={day} style={styles.prepDayBadge}>
                        <Ionicons name="calendar-outline" size={14} color={Colors.primary} />
                        <Text style={styles.prepDayText}>{day}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.prepDayHint}>
                    Prep on these days to keep fresh food ready for the whole week.
                  </Text>
                </View>
              </FadeInView>
            ) : null}

            {/* Recipes to prep */}
            <FadeInView delay={60}>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Recipes to Prep ({data.recipes.length})
                </Text>
                {data.recipes.map((recipe) => (
                  <View key={recipe.id} style={styles.recipeRow}>
                    <View style={styles.recipeIcon}>
                      <Ionicons name="restaurant-outline" size={20} color={Colors.primary} />
                    </View>
                    <View style={styles.recipeInfo}>
                      <Text style={styles.recipeName}>{recipe.title}</Text>
                      <View style={styles.recipeMeta}>
                        <Text style={styles.recipeMetaText}>
                          {recipe.prep_time_min + recipe.cook_time_min} min
                        </Text>
                        <Text style={styles.recipeMetaDot}>·</Text>
                        <Text style={styles.recipeMetaText}>{recipe.servings} servings</Text>
                        <Text style={styles.recipeMetaDot}>·</Text>
                        <Text style={styles.recipeMetaText}>{Math.round(recipe.calories)} kcal</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </FadeInView>

            {/* Aggregated ingredients */}
            <FadeInView delay={100}>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    Aggregated Ingredients ({data.aggregated_ingredients.length})
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.addToGroceryBtn,
                      addToGroceryMutation.isPending && styles.addToGroceryBtnDisabled,
                    ]}
                    onPress={handleAddToGrocery}
                    activeOpacity={0.8}
                    disabled={addToGroceryMutation.isPending}
                  >
                    {addToGroceryMutation.isPending ? (
                      <ActivityIndicator size="small" color={Colors.textOnPrimary} />
                    ) : (
                      <>
                        <Ionicons name="cart-outline" size={14} color={Colors.textOnPrimary} />
                        <Text style={styles.addToGroceryBtnText}>Add all</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                {data.aggregated_ingredients.map((ingredient, i) => (
                  <View key={i} style={styles.ingredientRow}>
                    <View style={styles.ingredientBullet} />
                    <Text style={styles.ingredientText}>
                      {ingredient.quantity > 0 && ingredient.unit
                        ? `${Math.round(ingredient.quantity * 10) / 10} ${ingredient.unit} `
                        : ingredient.quantity > 1
                        ? `${Math.round(ingredient.quantity * 10) / 10}× `
                        : ''}
                      <Text style={styles.ingredientName}>{ingredient.name}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            </FadeInView>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    marginBottom: 12,
    gap: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary },

  weekSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  weekArrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { alignItems: 'center', gap: 2 },
  weekLabelText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  weekCurrentBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
    backgroundColor: Colors.primaryPale,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },

  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 60, gap: 14 },

  loadingContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 15, color: Colors.textMuted },

  section: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },

  prepDayRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  prepDayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryPale,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  prepDayText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  prepDayHint: { fontSize: 12, color: Colors.textMuted, lineHeight: 16 },

  recipeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  recipeIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeInfo: { flex: 1 },
  recipeName: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  recipeMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recipeMetaText: { fontSize: 12, color: Colors.textMuted },
  recipeMetaDot: { fontSize: 12, color: Colors.textMuted },

  addToGroceryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  addToGroceryBtnDisabled: { opacity: 0.6 },
  addToGroceryBtnText: { fontSize: 12, fontWeight: '700', color: Colors.textOnPrimary },

  ingredientRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  ingredientBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 7,
    flexShrink: 0,
  },
  ingredientText: { flex: 1, fontSize: 14, color: Colors.textSecondary, lineHeight: 22 },
  ingredientName: { color: Colors.textPrimary, fontWeight: '600' },
});
