import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recipesApi } from '../../services/api';

import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Recipe {
  id: string;
  title: string;
  description?: string;
  prep_time_min: number;
  cook_time_min: number;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
  image_url?: string;
  isSaved?: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MacroCard({ label, value, unit, color }: {
  label: string; value: number; unit: string; color: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.macroCard, { backgroundColor: color + '15' }]}>
      <Text style={[styles.macroValue, { color }]}>{Math.round(value)}{unit}</Text>
      <Text style={[styles.macroLabel, { color: color + 'BB' }]}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RecipeDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<{ RecipeDetail: { recipeId: string } }, 'RecipeDetail'>>();
  const recipeId = route.params?.recipeId;
  const queryClient = useQueryClient();

  // Cache-first read: if the user navigated from RecipesScreen (the list
  // query), we'll already have the recipe in cache and paint synchronously.
  // Otherwise, we fetch by id and fall back to first paint loading state.
  const initialFromCache = (() => {
    const list = queryClient.getQueryData<Recipe[]>(['recipes']);
    return list?.find((r) => r.id === recipeId);
  })();

  const { data, isLoading, isError } = useQuery<Recipe>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.getById(recipeId).then((r) => r.data as Recipe),
    enabled: !!recipeId,
    initialData: initialFromCache,
    staleTime: 5 * 60 * 1000,
  });

  const recipe = data;

  const [isSaved, setIsSaved] = useState<boolean>(recipe?.isSaved ?? false);
  const [saving, setSaving] = useState(false);

  // Keep local saved-state in sync if the underlying record refreshes.
  useEffect(() => {
    if (recipe?.isSaved !== undefined) setIsSaved(recipe.isSaved);
  }, [recipe?.isSaved]);

  const totalTime = (recipe?.prep_time_min ?? 0) + (recipe?.cook_time_min ?? 0);

  const handleToggleSave = useCallback(async () => {
    if (saving || !recipe) return;
    setSaving(true);
    try {
      if (isSaved) {
        await recipesApi.unsave(recipe.id);
        setIsSaved(false);
      } else {
        await recipesApi.save(recipe.id);
        setIsSaved(true);
      }
    } catch {
      Alert.alert('Error', 'Could not update saved status. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [isSaved, saving, recipe]);

  if (isLoading && !recipe) {
    return <SkeletonScreen count={6} />;
  }

  if (isError || !recipe) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Recipe not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.errorLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero banner — recipe image if the API returned one, otherwise the
          neutral primaryPale placeholder with the restaurant glyph. */}
      <View style={styles.hero}>
        {recipe.image_url ? (
          <Image
            source={{ uri: recipe.image_url }}
            style={styles.heroImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.heroIcon}>
            <Ionicons name="restaurant" size={56} color={colors.primary} />
          </View>
        )}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleToggleSave}
          activeOpacity={0.8}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? 'Remove from saved recipes' : 'Save recipe'}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={isSaved ? colors.primary : colors.textSecondary}
            />
          )}
        </TouchableOpacity>
      </View>

      <FadeInView>
        <View style={styles.section}>
          {/* Title & meta */}
          <Text style={styles.recipeTitle}>{recipe.title}</Text>
          {recipe.description ? (
            <Text style={styles.recipeDesc}>{recipe.description}</Text>
          ) : null}

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <Text style={styles.metaText}>{totalTime} min total</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="restaurant-outline" size={16} color={colors.textMuted} />
              <Text style={styles.metaText}>{recipe.servings} servings</Text>
            </View>
            {recipe.prep_time_min > 0 && (
              <View style={styles.metaItem}>
                <Ionicons name="cut-outline" size={16} color={colors.textMuted} />
                <Text style={styles.metaText}>{recipe.prep_time_min} min prep</Text>
              </View>
            )}
          </View>

          {/* Tags */}
          {recipe.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {recipe.tags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </FadeInView>

      {/* Macro breakdown */}
      <FadeInView delay={60}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nutrition (per serving)</Text>
          <View style={styles.macroGrid}>
            <MacroCard label="Calories" value={recipe.calories} unit="kcal" color={colors.accent} />
            <MacroCard label="Protein" value={recipe.protein} unit="g" color={colors.protein} />
            <MacroCard label="Carbs" value={recipe.carbs} unit="g" color={colors.carbs} />
            <MacroCard label="Fat" value={recipe.fat} unit="g" color={colors.fat} />
          </View>
        </View>
      </FadeInView>

      {/* Ingredients */}
      <FadeInView delay={100}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ingredients</Text>
          {recipe.ingredients.map((ingredient, i) => (
            <View key={i} style={styles.listItem}>
              <View style={styles.bullet} />
              <Text style={styles.listItemText}>{ingredient}</Text>
            </View>
          ))}
        </View>
      </FadeInView>

      {/* Instructions */}
      <FadeInView delay={140}>
        <View style={[styles.section, styles.lastSection]}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          {recipe.instructions.map((step, i) => (
            <View key={i} style={styles.stepItem}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      </FadeInView>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 60 },

  hero: {
    height: 200,
    backgroundColor: colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroIcon: { opacity: 0.8 },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    zIndex: 10,
  },
  saveBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 10,
  },

  section: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    marginHorizontal: 16,
    marginTop: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  lastSection: { marginBottom: 0 },

  recipeTitle: { fontSize: 22, fontWeight: '500', color: colors.textPrimary, lineHeight: 28 },
  recipeDesc: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },

  metaRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: colors.textMuted },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  tagText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },

  sectionTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },

  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  macroCard: {
    flex: 1,
    minWidth: '40%',
    borderRadius: 2, // radius.md
    padding: 14,
    alignItems: 'center',
    gap: 2,
  },
  macroValue: { fontSize: 20, fontWeight: '500' },
  macroLabel: { fontSize: 12, fontWeight: '600' },

  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 7,
    flexShrink: 0,
  },
  listItemText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 22 },

  stepItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: { fontSize: 13, fontWeight: '500', color: colors.textOnPrimary },
  stepText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 22 },

  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 16, color: colors.textSecondary },
  errorLink: { fontSize: 15, color: colors.primary, fontWeight: '600' },

  });
