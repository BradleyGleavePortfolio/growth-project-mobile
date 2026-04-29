import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { recipesApi } from '../../services/api';

import FadeInView from '../../components/FadeInView';
import EmptyState from '../../components/EmptyState';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

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
function MacroBadge({ label, value, color }: { label: string; value: number; color: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.macroBadge, { backgroundColor: color + '20' }]}>
      <Text style={[styles.macroBadgeValue, { color }]}>{Math.round(value)}g</Text>
      <Text style={[styles.macroBadgeLabel, { color: color + 'AA' }]}>{label}</Text>
    </View>
  );
}

function RecipeCard({ recipe, onPress }: { recipe: Recipe; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const totalTime = recipe.prep_time_min + recipe.cook_time_min;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {/* Placeholder for image — uses colored header */}
      <View style={styles.cardImagePlaceholder}>
        <Ionicons name="restaurant-outline" size={32} color={colors.primary + '80'} />
        <View style={styles.caloriesBadge}>
          <Text style={styles.caloriesBadgeText}>{Math.round(recipe.calories)} kcal</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{recipe.title}</Text>
        {recipe.description ? (
          <Text style={styles.cardDesc} numberOfLines={2}>{recipe.description}</Text>
        ) : null}
        <View style={styles.cardMeta}>
          <View style={styles.cardMetaItem}>
            <Ionicons name="time-outline" size={13} color={colors.textMuted} />
            <Text style={styles.cardMetaText}>{totalTime} min</Text>
          </View>
          <View style={styles.cardMetaItem}>
            <Ionicons name="people-outline" size={13} color={colors.textMuted} />
            <Text style={styles.cardMetaText}>{recipe.servings} servings</Text>
          </View>
        </View>
        <View style={styles.macroRow}>
          <MacroBadge label="P" value={recipe.protein} color={colors.protein} />
          <MacroBadge label="C" value={recipe.carbs} color={colors.carbs} />
          <MacroBadge label="F" value={recipe.fat} color={colors.fat} />
        </View>
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
const ALL_TAGS = [
  'All', 'breakfast', 'lunch', 'dinner', 'high-protein', 'low-carb',
  'meal-prep', 'quick', 'vegan', 'gluten-free',
];

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RecipesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('All');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list().then((r) => r.data as Recipe[]),
    staleTime: 5 * 60 * 1000,
  });

  const recipes = data ?? [];

  const filtered = recipes.filter((r) => {
    const matchesSearch =
      !search ||
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesTag = activeTag === 'All' || r.tags.includes(activeTag);
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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
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
          >
            <Text style={[styles.tagFilterText, activeTag === tag && styles.tagFilterTextActive]}>
              {tag}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading recipes…</Text>
          </View>
        ) : isError ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Couldn't load recipes"
            subtitle="Pull down to try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="restaurant-outline"
            title={search || activeTag !== 'All' ? 'No matches' : 'No recipes yet'}
            subtitle={
              search || activeTag !== 'All'
                ? 'Try a different search or filter.'
                : 'Recipes added by your coach will appear here.'
            }
          />
        ) : (
          filtered.map((recipe, i) => (
            <FadeInView key={recipe.id} delay={i * 40}>
              <RecipeCard recipe={recipe} onPress={() => handleRecipePress(recipe)} />
            </FadeInView>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 16,
    gap: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '500', color: colors.textPrimary },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, height: 44 },

  tagFilterRow: { maxHeight: 44, marginBottom: 8 },
  tagFilterContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  tagFilter: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagFilterActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tagFilterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tagFilterTextActive: { color: colors.textOnPrimary },

  list: { flex: 1 },
  listContent: { padding: 16, gap: 14, paddingBottom: 40 },

  loadingContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 15, color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardImagePlaceholder: {
    height: 120,
    backgroundColor: colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caloriesBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  caloriesBadgeText: { fontSize: 12, fontWeight: '500', color: colors.textOnPrimary },
  cardBody: { padding: 14, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  cardDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  cardMeta: { flexDirection: 'row', gap: 14, marginTop: 2 },
  cardMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMetaText: { fontSize: 12, color: colors.textMuted },
  macroRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  macroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  macroBadgeValue: { fontSize: 12, fontWeight: '500' },
  macroBadgeLabel: { fontSize: 11, fontWeight: '600' },
  tagsRow: { marginTop: 6 },
  tag: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4, // radius.lg
    marginRight: 6,
  },
  tagText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },

  });
