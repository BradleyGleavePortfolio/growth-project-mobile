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
import { errorStatus } from '../../types/common';
import { RecipeAllergenFields, isHiddenForAllergens, recipeAllergenDetail } from '../../lib/recipeAllergens';

import FadeInView from '../../components/FadeInView';
import { useTheme } from '../../theme/ThemeProvider';
import { typography, SemanticTokens } from '../../theme/tokens';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Recipe extends RecipeAllergenFields {
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
function MacroCard({ label, value, unit }: {
  label: string; value: number; unit: string;
}) {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!Number.isFinite(value)) return null;
  return (
    <View style={styles.macroCard}>
      <Text style={styles.macroValue}>{Math.round(value)} {unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RecipeDetailScreen() {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<{ RecipeDetail: { recipeId: string } }, 'RecipeDetail'>>();
  const recipeId = route.params?.recipeId;
  const queryClient = useQueryClient();

  // Cache-first paint: a recipe opened from the list paints from the list
  // cache, but that cache has no `isSaved`, so it counts as already stale and
  // GET /recipes/:id always runs once to supply the saved state.
  const initialFromCache = (() => {
    const list = queryClient.getQueryData<Recipe[]>(['recipes']);
    return list?.find((r) => r.id === recipeId);
  })();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Recipe>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipesApi.getById(recipeId).then((r) => r.data as Recipe),
    enabled: !!recipeId,
    initialData: initialFromCache,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60 * 1000,
  });

  const recipe = data;

  // undefined = the server has not said yet; the bookmark waits for it.
  const [isSaved, setIsSaved] = useState<boolean | undefined>(recipe?.isSaved);
  const savedPending = isSaved === undefined && isFetching;
  const [saving, setSaving] = useState(false);

  // Keep local saved-state in sync if the underlying record refreshes.
  useEffect(() => {
    if (recipe?.isSaved !== undefined) setIsSaved(recipe.isSaved);
  }, [recipe?.isSaved]);

  const totalTime = Number.isFinite(recipe?.prep_time_min) && Number.isFinite(recipe?.cook_time_min)
    ? (recipe?.prep_time_min ?? 0) + (recipe?.cook_time_min ?? 0) : null;

  const handleToggleSave = useCallback(async () => {
    if (saving || !recipe) return;
    setSaving(true);
    try {
      const next = !isSaved;
      await (next ? recipesApi.save(recipe.id) : recipesApi.unsave(recipe.id));
      setIsSaved(next);
      // Reopening this recipe and the Saved filter both show the new state.
      queryClient.setQueryData<Recipe>(['recipe', recipe.id], (old) => (old ? { ...old, isSaved: next } : old));
      void queryClient.invalidateQueries({ queryKey: ['recipes', 'saved'] });
    } catch {
      Alert.alert('Could not update saved recipe', 'The saved-recipe change could not be confirmed. Check your connection and tap the bookmark again.');
    } finally {
      setSaving(false);
    }
  }, [isSaved, saving, recipe, queryClient]);

  if (isLoading && !recipe) {
    return <SkeletonScreen count={6} />;
  }

  // A 404 wins over a cached copy (list cache or an earlier open): the recipe is
  // gone, or now declares an allergen saved on the profile. Other failures keep
  // the cached copy on screen.
  const gone = isError && errorStatus(error) === 404;
  if (!recipe || gone) {
    const unavailable = !recipeId || gone || !isError;
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>
          {isHiddenForAllergens(error)
            ? 'This recipe is hidden because it lists an allergen saved on your profile.'
            : unavailable
            ? 'This recipe is no longer available.'
            : 'Could not load this recipe. Check your connection and try again.'}
        </Text>
        {!unavailable && (
          <TouchableOpacity onPress={() => void refetch()} accessibilityRole="button" accessibilityLabel="Retry recipe">
            <Text style={styles.errorLink}>Try again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button">
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
      {/* Keep a stored image; without one, the title carries the screen. */}
      <View style={styles.hero}>
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
          disabled={saving || savedPending}
          accessibilityRole="button"
          accessibilityLabel={savedPending ? 'Checking saved recipes' : isSaved ? 'Remove from saved recipes' : 'Save recipe'}
          accessibilityState={{ selected: isSaved === true, busy: saving || savedPending, disabled: saving || savedPending }}
        >
          {saving || savedPending ? (
            <ActivityIndicator size="small" color={colors.textOnAccent} />
          ) : (
            <Ionicons
              name={isSaved ? 'checkmark-outline' : 'bookmark-outline'}
              size={24}
              color={colors.textOnAccent}
            />
          )}
        </TouchableOpacity>
      </View>

      <FadeInView duration={250}>
        <View style={styles.section}>
          {/* Title & meta */}
          <Text style={styles.recipeTitle}>{recipe.title}</Text>
          {recipe.image_url ? <Image source={{ uri: recipe.image_url }} style={styles.heroImage} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          {recipe.description ? (
            <Text style={styles.recipeDesc}>{recipe.description}</Text>
          ) : null}

          <View style={styles.metaRow}>
            {totalTime !== null && <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={16} color={colors.textMuted} />
              <Text style={styles.metaText}>{totalTime} min total</Text>
            </View>}
            {Number.isFinite(recipe.servings) && <View style={styles.metaItem}>
              <Ionicons name="restaurant-outline" size={16} color={colors.textMuted} />
              <Text style={styles.metaText}>{recipe.servings} servings</Text>
            </View>}
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
      <FadeInView duration={250}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PER SERVING</Text>
          <View style={styles.macroGrid}>
            <MacroCard label="Calories" value={recipe.calories} unit="kcal" />
            <MacroCard label="Protein" value={recipe.protein} unit="g" />
            <MacroCard label="Carbs" value={recipe.carbs} unit="g" />
            <MacroCard label="Fat" value={recipe.fat} unit="g" />
          </View>
        </View>
      </FadeInView>

      {/* Allergens: only what the recipe's author declared, never guessed from the text */}
      <FadeInView duration={250}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ALLERGENS</Text>
          <Text style={styles.listItemText}>{recipeAllergenDetail(recipe)}</Text>
          <Text style={styles.recipeDesc}>Check the ingredients below before you cook.</Text>
        </View>
      </FadeInView>

      {/* Ingredients */}
      <FadeInView duration={250}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INGREDIENTS</Text>
          {recipe.ingredients.map((ingredient, i) => (
            <View key={i} style={styles.listItem}>
              <View style={styles.bullet} />
              <Text style={styles.listItemText}>{ingredient}</Text>
            </View>
          ))}
        </View>
      </FadeInView>

      {/* Instructions */}
      <FadeInView duration={250}>
        <View style={[styles.section, styles.lastSection]}>
          <Text style={styles.sectionTitle}>METHOD</Text>
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
const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { paddingBottom: 60 },

  hero: {
    height: 104,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: 200,
    borderRadius: 4,
  },
  heroIcon: { opacity: 0.8 },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: 20,
    width: 44,
    height: 44,
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
    backgroundColor: colors.accent,
    borderRadius: 4,
    borderColor: colors.border,
    zIndex: 10,
  },

  section: {
    backgroundColor: colors.bgPrimary,
    marginHorizontal: 24,
    paddingVertical: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 10,
  },
  lastSection: { marginBottom: 0 },

  recipeTitle: { ...typography.h1, color: colors.textPrimary },
  recipeDesc: { ...typography.bodySmall, color: colors.textMuted },

  metaRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...typography.bodySmall, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  tagText: { ...typography.bodySmall, color: colors.textMuted },

  sectionTitle: { ...typography.eyebrow, color: colors.textMuted },

  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  macroCard: {
    flex: 1,
    minWidth: '40%',
    paddingVertical: 12,
    gap: 2,
  },
  macroValue: { ...typography.h2, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  macroLabel: { ...typography.bodySmall, color: colors.textMuted },

  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 7,
    flexShrink: 0,
  },
  listItemText: { ...typography.body, flex: 1, color: colors.textPrimary },

  stepItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 4, // radius.lg
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: { ...typography.body, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  stepText: { ...typography.body, flex: 1, color: colors.textPrimary },

  errorContainer: { flex: 1, backgroundColor: colors.bgPrimary, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { ...typography.body, color: colors.textMuted },
  errorLink: { ...typography.bodyMd, minHeight: 44, paddingVertical: 10, color: colors.accent },

  });
