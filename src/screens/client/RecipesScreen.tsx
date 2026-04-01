import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { Recipe } from '../../types';
import EmptyState from '../../components/EmptyState';
import FadeInView from '../../components/FadeInView';
import { SkeletonCard } from '../../components/SkeletonLoader';
import { getAllRecipes, getRecipesByTag, searchRecipes } from '../../db/recipesDb';
import { getRecipeImageUrl } from '../../utils/foodImages';

type FilterKey = 'all' | 'high-protein' | 'breakfast' | 'quick' | 'low-carb' | 'international' | 'vegetarian' | 'snack';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'high-protein', label: 'High Protein' },
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'quick', label: 'Quick' },
  { key: 'low-carb', label: 'Low Carb' },
  { key: 'international', label: 'International' },
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'snack', label: 'Snacks' },
];

function RecipeImage({ uri, name, style }: { uri: string; name: string; style: any }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <View style={[style, { backgroundColor: '#E8F5E9', justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#2D6A4F' }}>
          {name.charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      onError={() => setErrored(true)}
    />
  );
}

export default function RecipesScreen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [filtered, setFiltered] = useState<Recipe[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRecipes();
  }, []);

  useEffect(() => {
    applyFilter();
  }, [activeFilter, searchQuery, recipes]);

  const loadRecipes = async () => {
    setIsLoading(true);
    const all = await getAllRecipes();
    setRecipes(all);
    setIsLoading(false);
  };

  const applyFilter = async () => {
    let results: Recipe[];
    if (searchQuery.length >= 2) {
      results = await searchRecipes(searchQuery);
    } else if (activeFilter === 'all') {
      results = recipes;
    } else {
      results = await getRecipesByTag(activeFilter);
    }
    setFiltered(results);
  };

  const handleFilterPress = (key: FilterKey) => {
    setActiveFilter(key);
    setSearchQuery('');
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.length >= 2) {
      setActiveFilter('all');
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRecipes();
    setRefreshing(false);
  }, []);

  const openRecipe = (recipe: Recipe) => {
    setSelectedRecipe(recipe);
  };

  if (selectedRecipe) {
    return (
      <RecipeDetailView
        recipe={selectedRecipe}
        onBack={() => setSelectedRecipe(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recipes</Text>
        <Text style={styles.subtitle}>{filtered.length} recipes</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search recipes..."
          placeholderTextColor={Colors.textMuted}
          value={searchQuery}
          onChangeText={handleSearch}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
            onPress={() => handleFilterPress(f.key)}
          >
            <Text
              style={[
                styles.filterChipText,
                activeFilter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading && filtered.length === 0 ? (
        <View style={{ paddingHorizontal: 24, gap: 12, marginTop: 16 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.recipeGrid}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
        >
          {filtered.length === 0 ? (
            <EmptyState
              icon="restaurant-outline"
              title="No recipes found"
              subtitle="Try a different search or filter to discover recipes"
            />
          ) : (
            filtered.map((recipe) => {
              return (
                <FadeInView key={recipe.id}>
                  <TouchableOpacity
                    style={styles.recipeCard}
                    onPress={() => openRecipe(recipe)}
                    activeOpacity={0.7}
                  >
                    <RecipeImage
                      uri={getRecipeImageUrl(recipe.name)}
                      name={recipe.name}
                      style={styles.recipeImage}
                    />
                    <View style={styles.recipeInfo}>
                      <Text style={styles.recipeName} numberOfLines={2}>
                        {recipe.name}
                      </Text>
                      <View style={styles.recipeMeta}>
                        <Text style={styles.recipeCals}>{recipe.calories} kcal</Text>
                        <Text style={styles.recipeProtein}>P: {recipe.protein}g</Text>
                      </View>
                      <View style={styles.recipeTagRow}>
                        {parseTags(recipe.tags)
                          .filter((t) => !t.startsWith('img:'))
                          .slice(0, 2)
                          .map((tag) => (
                            <View key={tag} style={styles.recipeTag}>
                              <Text style={styles.recipeTagText}>{tag}</Text>
                            </View>
                          ))}
                      </View>
                    </View>
                  </TouchableOpacity>
                </FadeInView>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

function parseTags(tagsStr: string): string[] {
  try {
    return JSON.parse(tagsStr);
  } catch {
    return [];
  }
}

function parseIngredients(ingredientsStr: string): string[] {
  try {
    return JSON.parse(ingredientsStr);
  } catch {
    return [];
  }
}

function RecipeDetailView({
  recipe,
  onBack,
}: {
  recipe: Recipe;
  onBack: () => void;
}) {
  const ingredients = parseIngredients(recipe.ingredients);
  const tags = parseTags(recipe.tags).filter((t) => !t.startsWith('img:'));

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <RecipeImage
          uri={getRecipeImageUrl(recipe.name)}
          name={recipe.name}
          style={styles.heroImage}
        />
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={styles.detailContent}>
          <Text style={styles.detailName}>{recipe.name}</Text>
          <Text style={styles.detailServings}>Serves {recipe.servings}</Text>

          <View style={styles.macroBar}>
            <View style={styles.macroBox}>
              <Text style={styles.macroBoxValue}>{recipe.calories}</Text>
              <Text style={styles.macroBoxLabel}>kcal</Text>
            </View>
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxValue, { color: Colors.protein }]}>
                {recipe.protein}g
              </Text>
              <Text style={styles.macroBoxLabel}>Protein</Text>
            </View>
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxValue, { color: Colors.carbs }]}>
                {recipe.carbs}g
              </Text>
              <Text style={styles.macroBoxLabel}>Carbs</Text>
            </View>
            <View style={styles.macroBox}>
              <Text style={[styles.macroBoxValue, { color: Colors.fat }]}>
                {recipe.fat}g
              </Text>
              <Text style={styles.macroBoxLabel}>Fat</Text>
            </View>
          </View>

          {tags.length > 0 && (
            <View style={styles.detailTagRow}>
              {tags.map((tag) => (
                <View key={tag} style={styles.detailTag}>
                  <Text style={styles.detailTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.sectionHeader}>Ingredients</Text>
          {ingredients.map((item, i) => (
            <View key={i} style={styles.ingredientRow}>
              <View style={styles.ingredientDot} />
              <Text style={styles.ingredientText}>{item}</Text>
            </View>
          ))}

          <Text style={styles.sectionHeader}>Instructions</Text>
          <Text style={styles.instructionsText}>{recipe.instructions}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 24,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  filterRow: {
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  recipeGrid: {
    paddingHorizontal: 24,
    paddingBottom: 100,
    gap: 12,
  },
  recipeCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  recipeImage: {
    width: 100,
    height: 100,
    backgroundColor: Colors.surfaceElevated,
  },
  recipeInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  recipeName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  recipeMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  recipeCals: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  recipeProtein: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  recipeTagRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  recipeTag: {
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recipeTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'capitalize',
  },
  // Detail view
  heroImage: {
    width: '100%',
    height: 220,
    backgroundColor: Colors.surfaceElevated,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 100,
  },
  detailName: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  detailServings: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  macroBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  macroBox: {
    alignItems: 'center',
    gap: 4,
  },
  macroBoxValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  macroBoxLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  detailTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  detailTag: {
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
    marginTop: 8,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  ingredientDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  ingredientText: {
    fontSize: 15,
    color: Colors.textPrimary,
    flex: 1,
  },
  instructionsText: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
});
