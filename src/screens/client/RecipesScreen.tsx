import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  FlatList,
  ListRenderItem,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recipesApi, profileApi } from '../../services/api';
import {
  RecipeAllergenFields,
  listWords,
  recipeAllergenSummary,
  refreshRecipeReads,
  useRecipeAllergenGuide,
} from '../../lib/recipeAllergens';

import EmptyState from '../../components/EmptyState';
import AllergySafetyPrompt from '../../components/AllergySafetyPrompt';
import { useTheme } from '../../theme/ThemeProvider';
import { typography, radius, SemanticTokens } from '../../theme/tokens';
import { PrimaryButton, Screen } from '../../ui';
import { StyleCLoadingLines, StyleCMasthead, StyleCNotice, StyleCPaper, StyleCThumb, useStyleCScreen } from '../../ui/layout/StyleCPage';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { patchUserCache } from '../../lib/userCache';
import { track } from '../../lib/analytics';

const ALLERGY_PROMPT_FLAG = 'allergy_prompt_shown';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Recipe extends RecipeAllergenFields {
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
      <View style={styles.cardThumb}><StyleCThumb uri={recipe.image_url || undefined} size={56} /></View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{recipe.title}</Text>
        {recipe.description ? (
          <Text style={styles.cardDesc}>{recipe.description}</Text>
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
        <Text style={styles.cardMetaText}>{recipeAllergenSummary(recipe)}</Text>
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
  const page = useStyleCScreen();
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  // Whether the server hides shared recipes by saved allergens, and which ones.
  const allergenGuide = useRecipeAllergenGuide();
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
        // Read the library again: recipes declaring a newly saved allergen leave it.
        refreshRecipeReads(queryClient);
        // Save the answer in the user cache that useCurrentUser reads, so Edit Profile shows it
        // and its next save keeps it (B-569-SOL-M-131-1).
        try {
          await patchUserCache({ profile: { diet_restrictions: restrictions } });
        } catch {
          // Cache refresh is best-effort.
        }
        track('allergy_prompt_answered');
      } catch {
        // Backend save failed — still mark prompt seen so we don't loop;
        // user can fix from Edit Profile.
      }
      await dismissAllergyPromptForever();
    },
    [dismissAllergyPromptForever, queryClient],
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
    <Screen edges={['top']} scroll={false} {...page}>
      <StyleCMasthead title="Recipes" onBack={() => navigation.goBack()} backLabel="Go back" />
      <StyleCPaper style={styles.bare}>

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
          <Text style={styles.loadingText}>Loading recipes…</Text>
          <StyleCLoadingLines />
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
          ListHeaderComponent={
            allergenGuide.hiddenNames.length > 0 ? (
              <Text style={styles.hiddenNote}>
                {`Recipes that list ${listWords(allergenGuide.hiddenNames, 'or')} are hidden.`}
              </Text>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            isError ? (
              // The warm notice and a Try again button (C_error), not a centred icon: the same words as before.
              <View style={styles.errorBlock}>
                <StyleCNotice title={showingSaved ? "Couldn't load saved recipes" : "Couldn't load recipes"}>
                  Pull down to try again.
                </StyleCNotice>
                <PrimaryButton label="Try again" onPress={() => refetch()} disabled={isRefetching} haptic={false} />
              </View>
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
        visible={allergyPromptVisible && allergenGuide.settled}
        rule={allergenGuide.rule}
        onDismiss={() => setAllergyPromptVisible(false)}
        onSubmit={handleAllergySubmit}
        onLater={handleAllergyLater}
      />
    </StyleCPaper>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  // Screen owns the inset top (forest via useStyleCScreen); the masthead and paper are Style C.
  bare: { paddingTop: 24 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Underlined field (C_grocery "Add an item"), not a box.
    marginHorizontal: 24,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderColor: colors.textPrimary,
    minHeight: 48,
  },
  searchIcon: { marginRight: 10 },
  searchInput: { ...typography.body, fontSize: 17, flex: 1, color: colors.textPrimary, minHeight: 48 },

  tagFilterRow: { maxHeight: 44, marginBottom: 8 },
  tagFilterContent: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
  tagFilter: {
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.chip,
    backgroundColor: colors.bgPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tagFilterActive: {
    borderColor: colors.textPrimary,
  },
  tagFilterText: { ...typography.bodySmall, color: colors.textMuted },
  tagFilterTextActive: { color: colors.textPrimary },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 40 },
  hiddenNote: { ...typography.bodySmall, color: colors.textMuted, paddingVertical: 8 },

  errorBlock: { paddingTop: 24, gap: 16 },
  loadingContainer: { paddingHorizontal: 24, paddingTop: 24, gap: 16 },
  loadingText: { ...typography.bodySmall, color: colors.textMuted },

  // A row with a cream thumb tile at the left (C_kitchen), hairline between rows.
  card: {
    flexDirection: 'row',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  // The picture tile (C_kitchen draws 64 pt; 56 here so a 320 pt screen at 130% keeps room for the name): the photo when there is one, else the warm tile with the line drawing.
  cardThumb: { paddingTop: 20 },
  caloriesBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.chip,
  },
  cardBody: { flex: 1, paddingVertical: 20, gap: 6 },
  cardTitle: { ...typography.h3, fontSize: 21, lineHeight: 27, color: colors.textPrimary },
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
    borderRadius: radius.chip,
  },
  tagsRow: { marginTop: 6 },
  // A hairline pill: the page is bgPrimary now, so a bgPrimary fill would vanish.
  tag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.chip,
    marginRight: 6,
  },
  tagText: { ...typography.bodySmall, color: colors.textMuted },

  });
