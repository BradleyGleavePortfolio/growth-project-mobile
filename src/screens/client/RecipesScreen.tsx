import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Image,
  FlatList,
  ListRenderItem,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { recipesApi, profileApi } from '../../services/api';

import EmptyState from '../../components/EmptyState';
import AllergySafetyPrompt from '../../components/AllergySafetyPrompt';
import { useTheme } from '../../theme/ThemeProvider';
import { typography, SemanticTokens } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';

const ALLERGY_PROMPT_FLAG = 'allergy_prompt_shown';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Recipe {
  id: string;
  title: string;
  description?: string;
  image_url?: string;
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
  is_public: boolean;
  created_by_id: string;
  _count: { saved_by: number };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function RecipeCard({ recipe, onPress }: { recipe: Recipe; onPress: () => void }) {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const totalTime = Number.isFinite(recipe.prep_time_min) && Number.isFinite(recipe.cook_time_min)
    ? recipe.prep_time_min + recipe.cook_time_min : null;
  const nutrition = [
    Number.isFinite(recipe.calories) ? `${Math.round(recipe.calories)} kcal` : '',
    Number.isFinite(recipe.protein) ? `${Math.round(recipe.protein)} g protein` : '',
  ].filter(Boolean).join(' · ');
  const otherMacros = [
    Number.isFinite(recipe.carbs) ? `${Math.round(recipe.carbs)} g carbs` : '',
    Number.isFinite(recipe.fat) ? `${Math.round(recipe.fat)} g fat` : '',
  ].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={`Open ${recipe.title}`}>
      {recipe.image_url ? (
        <View style={styles.cardImageWrap}>
          <Image
            source={{ uri: recipe.image_url }}
            style={styles.cardImage}
            resizeMode="cover"
          />
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{recipe.title}</Text>
        {recipe.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>{recipe.description}</Text>
        ) : null}
        <View style={styles.cardMeta}>
          {totalTime !== null && <View style={styles.cardMetaItem}>
            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
            <Text style={styles.cardMetaText}>{totalTime} min</Text>
          </View>}
          {Number.isFinite(recipe.servings) && <View style={styles.cardMetaItem}>
            <Ionicons name="people-outline" size={13} color={colors.textMuted} />
            <Text style={styles.cardMetaText}>{recipe.servings} servings</Text>
          </View>}
        </View>
        {nutrition ? <Text style={styles.cardMetaText}>{nutrition} per serving</Text> : null}
        {otherMacros ? <Text style={styles.cardMetaText}>{otherMacros} per serving</Text> : null}
        {recipe.tags.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagsRow}>
            {recipe.tags.slice(0, 4).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────
// 'Saved' is not a tag: it shows the account's saved recipes (GET /recipes/saved).
const SAVED_FILTER = 'Saved';
const ALL_TAGS = [
  'All', SAVED_FILTER, 'breakfast', 'lunch', 'dinner', 'high-protein', 'low-carb',
  'meal-prep', 'quick', 'vegan', 'gluten-free',
];

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RecipesScreen() {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('All');
  // Safety prompt: shown once when a lean-onboarded user opens Recipes
  // without a `diet_restrictions` answer on their profile. We never re-prompt
  // — they can revise from Edit Profile.
  const [allergyPromptVisible, setAllergyPromptVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shown = await AsyncStorage.getItem(ALLERGY_PROMPT_FLAG);
        if (shown === 'true') return;
        const leanDone = await AsyncStorage.getItem('lean_onboarding_done');
        if (leanDone !== 'true') return;
        const restrictions = currentUser?.profile?.diet_restrictions;
        // Only prompt if the field is unanswered (not an array). Empty
        // array means the user already answered "none" elsewhere.
        if (Array.isArray(restrictions)) return;
        if (cancelled) return;
        setAllergyPromptVisible(true);
        track('allergy_prompt_shown', { surface: 'recipes_first_open' });
      } catch {
        // Best-effort; never block the screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const dismissAllergyPromptForever = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ALLERGY_PROMPT_FLAG, 'true');
    } catch {
      // Best-effort.
    }
  }, []);

  const handleAllergySubmit = useCallback(
    async (restrictions: string[]) => {
      try {
        await profileApi.update({ diet_restrictions: restrictions });
        // Refresh local user_data so Home + Recipes filters see the new value.
        try {
          const raw = await AsyncStorage.getItem('user_data');
          if (raw) {
            const parsed = JSON.parse(raw);
            const nextProfile = {
              ...(parsed.profile ?? {}),
              diet_restrictions: restrictions,
            };
            await AsyncStorage.setItem(
              'user_data',
              JSON.stringify({ ...parsed, profile: nextProfile }),
            );
          }
        } catch {
          // Cache refresh is best-effort.
        }
        track('allergy_prompt_answered', { count: restrictions.length });
      } catch {
        // Backend save failed — still mark prompt seen so we don't loop;
        // user can fix from Edit Profile.
      }
      await dismissAllergyPromptForever();
    },
    [dismissAllergyPromptForever],
  );

  const handleAllergyLater = useCallback(async () => {
    track('allergy_prompt_deferred');
    await dismissAllergyPromptForever();
  }, [dismissAllergyPromptForever]);

  const showingSaved = activeTag === SAVED_FILTER;
  const listQuery = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list().then((r) => r.data as Recipe[]),
    staleTime: 5 * 60 * 1000,
  });
  const savedQuery = useQuery({
    queryKey: ['recipes', 'saved'],
    queryFn: () => recipesApi.listSaved().then((r) => r.data as Recipe[]),
    enabled: showingSaved,
    staleTime: 5 * 60 * 1000,
  });
  const { data, isLoading, isError, refetch, isRefetching } = showingSaved ? savedQuery : listQuery;

  const recipes = data ?? [];

  const filtered = recipes.filter((r) => {
    const matchesSearch =
      !search ||
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesTag = activeTag === 'All' || showingSaved || r.tags.includes(activeTag);
    return matchesSearch && matchesTag;
  });

  const handleRecipePress = useCallback(
    (recipe: Recipe) => {
      // Pass only the serializable id — the detail screen fetches the full
      // record via React Query (cache hit on the list query is reused).
      navigation.navigate('RecipeDetail', { recipeId: recipe.id });
    },
    [navigation],
  );

  const keyExtractor = useCallback((item: Recipe) => item.id, []);
  const renderItem = useCallback<ListRenderItem<Recipe>>(
    ({ item }) => (
      <RecipeCard recipe={item} onPress={() => handleRecipePress(item)} />
    ),
    [handleRecipePress],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}
          accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Recipes</Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search recipes…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Tag filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tagFilterRow}
        contentContainerStyle={styles.tagFilterContent}
      >
        {ALL_TAGS.map((tag) => (
          <TouchableOpacity
            key={tag}
            style={[styles.tagFilter, activeTag === tag && styles.tagFilterActive]}
            onPress={() => setActiveTag(tag)}
            activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel={tag}
            accessibilityState={{ selected: activeTag === tag }}
          >
            <Text style={[styles.tagFilterText, activeTag === tag && styles.tagFilterTextActive]}>
              {tag}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content — FlatList instead of ScrollView so 75+ recipe rows
          virtualize. FadeInView is dropped for off-screen rows because
          FlatList recycles cells and a per-row animation on a recycled cell
          flickers; the perceived win from virtualization is bigger than the
          mount-in animation. */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading recipes…</Text>
        </View>
      ) : (
        <FlatList<Recipe>
          testID="recipes-list"
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            isError ? (
              <EmptyState
                icon="alert-circle-outline"
                title={showingSaved ? "Couldn't load saved recipes" : "Couldn't load recipes"}
                subtitle="Pull down to try again."
              />
            ) : showingSaved && !search ? (
              <EmptyState
                icon="bookmark-outline"
                title="No saved recipes"
                subtitle="Recipes you save from a recipe page appear here."
              />
            ) : (
              <EmptyState
                icon="restaurant-outline"
                title={search || activeTag !== 'All' ? 'No matches' : 'No recipes yet'}
                subtitle={
                  search || activeTag !== 'All'
                    ? 'Try a different search or filter.'
                    : 'Recipes available to this account appear here.'
                }
              />
            )
          }
        />
      )}

      {/* One-time safety prompt for lean-onboarded users without restrictions. */}
      <AllergySafetyPrompt
        visible={allergyPromptVisible}
        onDismiss={() => setAllergyPromptVisible(false)}
        onSubmit={handleAllergySubmit}
        onLater={handleAllergyLater}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 16,
    gap: 12,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { ...typography.h1, color: colors.textPrimary },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
    borderRadius: 2, // radius.md
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { ...typography.body, flex: 1, color: colors.textPrimary, height: 44 },

  tagFilterRow: { maxHeight: 44, marginBottom: 8 },
  tagFilterContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  tagFilter: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 4, // radius.lg
    backgroundColor: colors.bgPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tagFilterActive: {
    borderColor: colors.textPrimary,
  },
  tagFilterText: { ...typography.bodySmall, color: colors.textMuted },
  tagFilterTextActive: { color: colors.textPrimary },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 40 },

  loadingContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  loadingText: { ...typography.bodySmall, color: colors.textMuted },

  card: {
    backgroundColor: colors.bgPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardImagePlaceholder: {
    height: 120,
    backgroundColor: colors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImageWrap: {
    height: 160,
    backgroundColor: colors.bgPrimary,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  caloriesBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  cardBody: { paddingVertical: 20, gap: 6 },
  cardTitle: { ...typography.bodyMd, color: colors.textPrimary },
  cardDesc: { ...typography.bodySmall, color: colors.textMuted },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 2 },
  cardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMetaText: { ...typography.bodySmall, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  macroRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  macroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  tagsRow: { marginTop: 6 },
  tag: {
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4, // radius.lg
    marginRight: 6,
  },
  tagText: { ...typography.bodySmall, color: colors.textMuted },

  });
