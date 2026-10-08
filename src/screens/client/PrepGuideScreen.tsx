import React, { useState, useCallback, useMemo } from 'react';
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
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { prepGuideApi, listsApi } from '../../services/api';

import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';
import { getLocalWeekStart } from '../../utils/date';
import { RecipeAllergenFields, recipeAllergenSummary } from '../../lib/recipeAllergens';

function EmptyState({ title, subtitle }: { icon: string; title: string; subtitle: string }) {
  const { semanticColors: sc } = useTheme();
  return <View style={{ padding: 24, gap: 12 }}><Text style={[typography.h2, { color: sc.textPrimary }]}>{title}</Text><Text style={[typography.bodySmall, { color: sc.textMuted }]}>{subtitle}</Text></View>;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrepRecipe extends RecipeAllergenFields {
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
  // 'plan' = recipes from the client's assigned meal plan; 'library' = recipes the account can see, none
  // from a meal plan. Missing (a backend before NUTR-BE) = unknown: neutral copy, no plan claim either way.
  source?: 'plan' | 'library';
  // true only when the server filters recipes by week_start; NUTR-BE sends false for both sources.
  week_filter_applied?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ─── Helper ───────────────────────────────────────────────────────────────────
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
  const { semanticColors: sc } = useTheme();
  const colors = useMemo(() => ({
    background: sc.bgPrimary, surface: sc.bgPrimary, primary: sc.accent,
    textPrimary: sc.textPrimary, textMuted: sc.textMuted, textSecondary: sc.textMuted,
    textOnPrimary: sc.textOnAccent, border: sc.border, primaryPale: sc.bgPrimary,
  }), [sc]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const queryClient = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = getLocalWeekStart(weekOffset);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['prep-guide', weekStart],
    queryFn: () => prepGuideApi.getWeeklyGuide(weekStart).then((r) => r.data as PrepGuideData),
    staleTime: 5 * 60 * 1000,
  });

  const fromPlan = data?.source === 'plan';
  const fromLibrary = data?.source === 'library';
  // The week arrows only change anything when the server filters by week; once off the current week
  // the selector stays so the client can always get back.
  const showWeek = data?.week_filter_applied === true || weekOffset !== 0;

  const addToGroceryMutation = useMutation({
    mutationFn: (ingredients: AggregatedIngredient[]) =>
      listsApi
        .bulkAdd(
          'grocery',
          ingredients.map((i) => ({
            name: i.name,
            quantity: Math.round(i.quantity * 10) / 10,
            unit: i.unit || undefined,
          })),
        )
        .then((r) => r.data?.added ?? ingredients.length),
    onSuccess: (added) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Invalidate grocery list so it's fresh when user navigates to it
      queryClient.invalidateQueries({ queryKey: ['lists', 'grocery'] });
      Alert.alert(
        'Added to Grocery List',
        `${plural(added, 'ingredient')} added to your grocery list.`,
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
      Alert.alert('Could not add the ingredients', 'Nothing was added to your grocery list. Try again.'),
  });

  const handleAddToGrocery = useCallback(() => {
    if (!data?.aggregated_ingredients.length) return;
    Alert.alert(
      'Add to Grocery List?',
      `Add ${plural(data.aggregated_ingredients.length, 'ingredient')} from these recipes to your grocery list?`,
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
    <View style={styles.container} testID="grocery-prep-screen">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Prep guide</Text>
      </View>

      {/* Week selector: only where the week is real (the server filters by it) */}
      {showWeek ? <View style={styles.weekSelector}>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Previous week"
          style={styles.weekArrow}
          onPress={() => setWeekOffset((o) => o - 1)}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.weekLabel}>
          <Text style={styles.weekLabelText}>{formatWeekLabel(weekStart)}</Text>
          {weekOffset === 0 ? (
            <Text style={styles.weekCurrentBadge}>This week</Text>
          ) : null}
        </View>
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel="Next week"
          style={styles.weekArrow}
          onPress={() => setWeekOffset((o) => o + 1)}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View> : null}

      <ScrollView
        testID="list-scroll"
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            testID="list-refresh"
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading your prep guide…</Text>
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
            title="No recipes yet"
            subtitle="Recipes from a meal plan or available to this account appear here."
          />
        ) : (
          <>
            <Text style={styles.summary}>
              {plural(data.recipes.length, 'recipe')} {fromPlan ? 'from your meal plan.' : 'available to this account.'}
            </Text>
            {fromLibrary ? <Text style={styles.prepDayHint}>None of these come from a meal plan.</Text> : null}
            {/* Prep day suggestions: only for plan recipes */}
            {fromPlan && data.prep_day_suggestions.length > 0 ? (
              <FadeInView>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Suggested prep days</Text>
                  <View style={styles.prepDayRow}>
                    {data.prep_day_suggestions.map((day) => (
                      <View key={day} style={styles.prepDayBadge}>
                        <Ionicons name="calendar-outline" size={14} color={colors.primary} />
                        <Text style={styles.prepDayText}>{day}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.prepDayHint}>
                    Choose the prep days that fit your week.
                  </Text>
                </View>
              </FadeInView>
            ) : null}

            {/* Recipes to prep */}
            <FadeInView delay={60}>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {fromPlan ? 'Recipes to prep' : 'Recipes'} ({data.recipes.length})
                </Text>
                {data.recipes.map((recipe, index) => (
                  <TouchableOpacity
                    key={recipe.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${recipe.title}`}
                    style={styles.recipeRow}
                    onPress={() => navigation.navigate('RecipeDetail', { recipeId: recipe.id })}
                    activeOpacity={0.7}
                  >
                    <View style={styles.recipeIcon}>
                      <Text style={styles.stepNumber}>{index + 1}</Text>
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
                      <Text style={styles.recipeMetaText}>{recipeAllergenSummary(recipe)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </FadeInView>

            {/* Aggregated ingredients */}
            <FadeInView delay={100}>
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    Ingredients ({data.aggregated_ingredients.length})
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button" accessibilityLabel="Add all ingredients"
                    style={[
                      styles.addToGroceryBtn,
                      (addToGroceryMutation.isPending || data.aggregated_ingredients.length === 0) && styles.addToGroceryBtnDisabled,
                    ]}
                    onPress={handleAddToGrocery}
                    activeOpacity={0.8}
                    disabled={addToGroceryMutation.isPending || data.aggregated_ingredients.length === 0}
                  >
                    {addToGroceryMutation.isPending ? (
                      <ActivityIndicator size="small" color={colors.textOnPrimary} />
                    ) : (
                      <>
                        <Ionicons name="cart-outline" size={14} color={colors.textOnPrimary} />
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
const makeStyles = (colors: Pick<ThemeColors, 'background' | 'surface' | 'primary' | 'textPrimary' | 'textMuted' | 'textSecondary' | 'textOnPrimary' | 'border' | 'primaryPale'>) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    marginBottom: 12,
    gap: 12,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { ...typography.h1, color: colors.textPrimary },
  summary: { ...typography.h2, color: colors.textPrimary, fontVariant: ['tabular-nums'] },

  weekSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 2, // radius.md
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  weekArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { alignItems: 'center', gap: 2 },
  weekLabelText: { ...typography.bodyMd, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  weekCurrentBadge: {
    ...typography.eyebrow,
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    backgroundColor: colors.primaryPale,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 0, // radius.sm
  },

  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 60, gap: 14 },

  loadingContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  loadingText: { ...typography.bodySmall, color: colors.textMuted },

  section: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 16,
    gap: 10,
  },
  sectionHeader: {
    gap: 12,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...typography.eyebrow, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  prepDayRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  prepDayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primaryPale,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4, // radius.lg
  },
  prepDayText: { ...typography.eyebrow, color: colors.textMuted },
  prepDayHint: { ...typography.bodySmall, color: colors.textMuted },

  recipeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  stepNumber: { ...typography.h3, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  recipeIcon: {
    width: 38,
    height: 38,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeInfo: { flex: 1 },
  recipeName: { ...typography.bodyMd, color: colors.textPrimary },
  recipeMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 2 },
  recipeMetaText: { ...typography.bodySmall, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  recipeMetaDot: { ...typography.bodySmall, color: colors.textMuted },

  addToGroceryBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  addToGroceryBtnDisabled: { opacity: 0.6 },
  addToGroceryBtnText: { ...typography.bodySmall, color: colors.textOnPrimary },

  ingredientRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  ingredientBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 7,
    flexShrink: 0,
  },
  ingredientText: { ...typography.bodySmall, flex: 1, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  ingredientName: { color: colors.textPrimary, fontWeight: '600' },

  });
