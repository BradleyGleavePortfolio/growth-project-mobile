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
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { prepGuideApi, listsApi } from '../../services/api';

import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { typography, radius, gold, brand, withAlpha } from '../../theme/tokens';
import { PrimaryButton, Screen } from '../../ui';
import {
  StyleCEmpty, StyleCLoadingLines, StyleCMasthead, StyleCMastText, StyleCNotice, StyleCPaper, StyleCSheet, StyleCThumb, useBottomInset, useStyleCScreen,
} from '../../ui/layout/StyleCPage';
import { getLocalWeekStart } from '../../utils/date';
import { RecipeAllergenFields, recipeAllergenSummary } from '../../lib/recipeAllergens';


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
  const page = useStyleCScreen();
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
  // The confirmation sheet after Add all (ctx#457 prep-added): how many were added, null when closed.
  const [added, setAdded] = useState<number | null>(null);
  // At 130% text the tile is 52 pt and the kcal joins the meta line (ctx#457 android360 130%).
  const big = useWindowDimensions().fontScale > 1.15;
  const bottomInset = useBottomInset();

  const weekStart = getLocalWeekStart(weekOffset);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['prep-guide', weekStart],
    queryFn: () => prepGuideApi.getWeeklyGuide(weekStart).then((r) => r.data as PrepGuideData),
    staleTime: 5 * 60 * 1000,
  });

  const shown = !isLoading && !isError && data && data.recipes.length > 0 ? data : null;
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
      void queryClient.invalidateQueries({ queryKey: ['lists', 'grocery'] });
      setAdded(added);
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
    <Screen edges={['top']} scroll={false} {...page} testID="grocery-prep-screen">
      {/* FIX-929R3: the masthead scrolls with the recipes (as RecipeDetail), so at 320 pt and 130% text the summary,
          week and prep days never fill the screen above the pinned Add all; what main scrolled scrolls again. */}
      <ScrollView
        testID="list-scroll"
        style={styles.content}
        contentContainerStyle={styles.contentFlow}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            testID="list-refresh"
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={sc.textOnAccent}
          />
        }
      >
      <StyleCMasthead title="Prep guide" onBack={() => navigation.goBack()}>
        {shown ? (
          <StyleCMastText>
            {plural(shown.recipes.length, 'recipe')} {fromPlan ? 'from your meal plan.' : 'available to this account.'}
          </StyleCMastText>
        ) : null}
        {shown && fromLibrary ? <StyleCMastText kind="muted">None of these come from a meal plan.</StyleCMastText> : null}
        {/* Week selector: only where the week is real (the server filters by it) */}
        {showWeek ? <View style={styles.weekSelector}>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Previous week"
            style={styles.weekArrow}
            onPress={() => setWeekOffset((o) => o - 1)}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={sc.textOnAccent} />
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
            <Ionicons name="chevron-forward" size={22} color={sc.textOnAccent} />
          </TouchableOpacity>
        </View> : null}
        {/* Prep day suggestions: only for plan recipes */}
        {shown && fromPlan && shown.prep_day_suggestions.length > 0 ? (
          <>
            <StyleCMastText kind="eyebrow">Suggested prep days</StyleCMastText>
            <View style={styles.prepDayRow}>
              {shown.prep_day_suggestions.map((day) => (
                <View key={day} style={[styles.prepDayBadge, { borderColor: sc.surface.forestBandLine }]}>
                  <Ionicons name="calendar-outline" size={16} color={sc.textOnAccent} />
                  <Text style={styles.prepDayText}>{day}</Text>
                </View>
              ))}
            </View>
            <StyleCMastText kind="muted">Choose the prep days that fit your week.</StyleCMastText>
          </>
        ) : null}
      </StyleCMasthead>
      <StyleCPaper scrolls style={styles.contentInner}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading your prep guide…</Text>
            <StyleCLoadingLines lead="tile" />
          </View>
        ) : isError ? (
          // The warm notice and a Try again button (C_error), the same words as before.
          <View style={styles.errorBlock}>
            <StyleCNotice title="Couldn't load prep guide">Pull down to try again.</StyleCNotice>
            <PrimaryButton label="Try again" onPress={() => refetch()} disabled={isRefetching} haptic={false} />
          </View>
        ) : !data || data.recipes.length === 0 ? (
          <StyleCEmpty
            icon="clipboard-outline"
            title="No recipes yet"
            subtitle="Recipes from a meal plan or available to this account appear here."
          />
        ) : (
          <>
            {/* Recipes to prep */}
            <FadeInView delay={60}>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {fromPlan ? 'Recipes to prep' : 'Recipes'} ({data.recipes.length})
                </Text>
                {data.recipes.map((recipe) => (
                  <TouchableOpacity
                    key={recipe.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${recipe.title}`}
                    style={styles.recipeRow}
                    onPress={() => navigation.navigate('RecipeDetail', { recipeId: recipe.id })}
                    activeOpacity={0.7}
                  >
                    <StyleCThumb size={big ? 52 : 64} />
                    <View style={styles.recipeInfo}>
                      <Text style={styles.recipeName}>{recipe.title}</Text>
                      <Text style={styles.recipeMetaText}>
                        {recipe.prep_time_min + recipe.cook_time_min} min · {recipe.servings} servings
                        {big ? ` · ${Math.round(recipe.calories)}\u00a0kcal` : ''}
                      </Text>
                      <Text style={styles.recipeAllergens}>{recipeAllergenSummary(recipe)}</Text>
                    </View>
                    {/* The kcal at the right (ctx#457), in the meta line at 130%. */}
                    {big ? null : (
                      <View style={styles.kcal}>
                        <Text style={styles.kcalNum}>{Math.round(recipe.calories)}</Text>
                        <Text style={styles.kcalUnit}>kcal</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </FadeInView>

            {/* Aggregated ingredients */}
            <FadeInView delay={100}>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Ingredients ({data.aggregated_ingredients.length})
                </Text>
                {data.aggregated_ingredients.map((ingredient, i) => (
                  // Name, a dotted leader, the amount at the right (ctx#457 prep).
                  <View key={i} style={styles.ingredientRow}>
                    <Text style={styles.ingredientName}>{ingredient.name}</Text>
                    <View style={styles.leader} />
                    <Text style={styles.ingredientAmount}>
                      {ingredient.quantity > 0 && ingredient.unit
                        ? `${Math.round(ingredient.quantity * 10) / 10} ${ingredient.unit}`
                        : ingredient.quantity > 1
                        ? `${Math.round(ingredient.quantity * 10) / 10}×`
                        : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </FadeInView>
          </>
        )}
      </StyleCPaper>
      </ScrollView>
      {/* Add all: one full-width button pinned under the list (ctx#457), the same confirm and words as before. */}
      {shown ? (
        <View style={[styles.foot, { backgroundColor: sc.bgPrimary, paddingBottom: bottomInset + 12 }]}>
          <TouchableOpacity
            accessibilityRole="button" accessibilityLabel="Add all ingredients"
            accessibilityState={{ disabled: addToGroceryMutation.isPending || shown.aggregated_ingredients.length === 0, busy: addToGroceryMutation.isPending }}
            style={[styles.addToGroceryBtn, (addToGroceryMutation.isPending || shown.aggregated_ingredients.length === 0) && styles.addToGroceryBtnDisabled]}
            onPress={handleAddToGrocery}
            activeOpacity={0.8}
            disabled={addToGroceryMutation.isPending || shown.aggregated_ingredients.length === 0}
          >
            {addToGroceryMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="cart-outline" size={20} color={colors.textOnPrimary} />
                <Text style={styles.addToGroceryBtnText}>Add all</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    <StyleCSheet
      visible={added != null}
      icon="cart-outline"
      title="Added to Grocery List"
      body={`${plural(added ?? 0, 'ingredient')} added to your grocery list.`}
      action="View List"
      onAction={() => { setAdded(null); navigation.navigate('GroceryList'); }}
      link="OK"
      onClose={() => setAdded(null)}
    />
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: Pick<ThemeColors, 'background' | 'surface' | 'primary' | 'textPrimary' | 'textMuted' | 'textSecondary' | 'textOnPrimary' | 'border' | 'primaryPale'>) =>
  StyleSheet.create({
  // Screen owns the inset top (forest via useStyleCScreen); the masthead and paper scroll together (FIX-929R3).
  // The week selector on the forest masthead (ctx#457 prep-week): light words, the current week in a gold pill.
  weekSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -10, marginTop: 14 },
  weekArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { alignItems: 'center', gap: 4 },
  weekLabelText: { ...typography.bodyMd, color: colors.textOnPrimary, fontVariant: ['tabular-nums'] },
  weekCurrentBadge: {
    ...typography.micro, fontSize: 11, color: brand[800], backgroundColor: gold[300],
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.chip, overflow: 'hidden',
  },

  content: { flex: 1 },
  contentFlow: { flexGrow: 1 },
  // The paper's padding (34 = the 12 + 22 it had over the list before); it grows to the foot when the list is short.
  contentInner: { paddingHorizontal: 24, paddingTop: 34, paddingBottom: 24, gap: 26 },

  errorBlock: { paddingTop: 12, gap: 16 },
  loadingContainer: { paddingTop: 12, gap: 16 },
  loadingText: { ...typography.bodySmall, color: colors.textMuted },

  section: { gap: 0 },
  sectionTitle: { ...typography.eyebrow, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  // Prep day chips on the forest masthead: a light outline (forestBandLine), light words.
  prepDayRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  prepDayBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, paddingHorizontal: 14, minHeight: 36, borderRadius: radius.chip },
  prepDayText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: colors.textOnPrimary },

  // The picture tile at the left of each row (C_kitchen), hairline between rows.
  recipeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingVertical: 14, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  recipeInfo: { flex: 1 },
  recipeName: { ...typography.h3, fontSize: 21, lineHeight: 27, color: colors.textPrimary },
  recipeMetaText: { ...typography.bodySmall, lineHeight: 20, color: colors.textMuted, fontVariant: ['tabular-nums'], marginTop: 3 },
  recipeAllergens: { ...typography.bodySmall, fontSize: 13, lineHeight: 19, color: colors.textMuted },
  kcal: { alignItems: 'flex-end', paddingTop: 4 },
  kcalNum: { ...typography.h4, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  kcalUnit: { ...typography.caption, fontFamily: 'Inter_400Regular', letterSpacing: 0.4, color: colors.textMuted },

  foot: { paddingHorizontal: 24, paddingTop: 12 },
  addToGroceryBtn: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.card,
  },
  addToGroceryBtnDisabled: { opacity: 0.6 },
  addToGroceryBtnText: { ...typography.h4, fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: colors.textOnPrimary },

  ingredientRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 12, minHeight: 44 },
  // A dotted leader (ctx#457): a thin box with every border dotted draws as one dotted line on both platforms.
  leader: { flex: 1, minWidth: 16, height: 1.5, marginBottom: 8, borderWidth: 1, borderStyle: 'dotted', borderColor: withAlpha(colors.textMuted, 0.5) },
  ingredientName: { ...typography.body, flexShrink: 1, color: colors.textPrimary },
  ingredientAmount: { ...typography.body, color: colors.textPrimary, fontVariant: ['tabular-nums'], textAlign: 'right' },

  });
