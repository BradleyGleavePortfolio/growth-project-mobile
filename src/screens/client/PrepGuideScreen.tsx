import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import { Shadow, Radius } from '../../constants/theme';
import { getMealPlan, parsePlanData, PlanDay } from '../../db/mealPlanDb';
import { searchRecipes } from '../../db/recipesDb';
import { addDays, getTodayString } from '../../utils/date';
import FadeInView from '../../components/FadeInView';

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

interface PrepRecipe {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  imageUrl?: string;
  tags: string[];
  dayUsed: string;
  slot: string;
}

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snack',
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface PrepGuideScreenProps {
  onBack?: () => void;
  embedded?: boolean;
  onDone?: () => void;
}

export default function PrepGuideScreen({ onBack, embedded, onDone }: PrepGuideScreenProps) {
  const currentUser = useCurrentUser();
  const [weekStart] = useState(() => getWeekStart(getTodayString()));
  const [recipes, setRecipes] = useState<PrepRecipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);

  useEffect(() => {
    loadPrepGuide();
  }, [currentUser?.id]);

  const loadPrepGuide = async () => {
    if (!currentUser) return;
    setIsLoading(true);

    const plan = await getMealPlan(currentUser.id, weekStart);
    if (!plan) {
      setRecipes([]);
      setIsLoading(false);
      return;
    }

    const planData = parsePlanData(plan.planData);
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const prepRecipes: PrepRecipe[] = [];
    const seen = new Set<string>();

    for (const date of weekDates) {
      const day = planData[date];
      if (!day) continue;

      const slots: (keyof PlanDay)[] = ['breakfast', 'lunch', 'dinner', 'snacks'];
      for (const slot of slots) {
        const meal = day[slot];
        if (!meal) continue;

        if (seen.has(meal.name)) continue;
        seen.add(meal.name);

        const results = await searchRecipes(meal.name);
        const match = results.find(
          (r) => r.name.toLowerCase() === meal.name.toLowerCase()
        );

        if (match) {
          let ingredients: string[] = [];
          let instructions: string[] = [];
          let tags: string[] = [];

          try {
            ingredients = JSON.parse(match.ingredients);
          } catch {
            ingredients = match.ingredients
              ? match.ingredients.split('|').map((s) => s.trim())
              : [];
          }

          try {
            instructions = JSON.parse(match.instructions);
          } catch {
            instructions = match.instructions
              ? match.instructions.split('|').map((s) => s.trim())
              : [];
          }

          try {
            tags = JSON.parse(match.tags);
          } catch {
            tags = match.tags
              ? match.tags.split(',').map((s) => s.trim())
              : [];
          }

          const imgTag = tags.find((t) => t.startsWith('img:'));
          const imageUrl = imgTag ? imgTag.replace('img:', '') : undefined;

          const dayIndex = weekDates.indexOf(date);
          prepRecipes.push({
            name: match.name,
            calories: match.calories,
            protein: match.protein,
            carbs: match.carbs,
            fat: match.fat,
            servings: match.servings,
            ingredients,
            instructions: instructions.filter((i) => i.length > 0),
            imageUrl,
            tags: tags.filter((t) => !t.startsWith('img:')),
            dayUsed: DAY_NAMES[dayIndex] || date,
            slot: SLOT_LABELS[slot] || slot,
          });
        }
      }
    }

    setRecipes(prepRecipes);
    setIsLoading(false);
  };

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const r of recipes) {
      for (const t of r.tags) {
        if (t && !t.startsWith('img:')) tagSet.add(t);
      }
    }
    return Array.from(tagSet).sort();
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    if (!filterTag) return recipes;
    return recipes.filter((r) => r.tags.includes(filterTag));
  }, [recipes, filterTag]);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {!embedded && (
            <TouchableOpacity onPress={onBack} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.title}>Prep Guide</Text>
            <Text style={styles.subtitle}>
              {recipes.length} recipe{recipes.length !== 1 ? 's' : ''} this week
            </Text>
          </View>
        </View>
      </View>

      {/* Filter Tags */}
      {allTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <TouchableOpacity
            style={[styles.filterChip, !filterTag && styles.filterChipActive]}
            onPress={() => setFilterTag(null)}
          >
            <Text style={[styles.filterText, !filterTag && styles.filterTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {allTags.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={[styles.filterChip, filterTag === tag && styles.filterChipActive]}
              onPress={() => setFilterTag(filterTag === tag ? null : tag)}
            >
              <Text
                style={[styles.filterText, filterTag === tag && styles.filterTextActive]}
              >
                {tag}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Recipe List */}
      {filteredRecipes.length === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <Ionicons name="book-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No recipes found</Text>
          <Text style={styles.emptyText}>
            Generate a meal plan first to see prep instructions for your meals.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {filteredRecipes.map((recipe, index) => {
            const isExpanded = expandedIndex === index;
            return (
              <FadeInView key={`${recipe.name}-${index}`} delay={index * 50}>
                <TouchableOpacity
                  style={styles.recipeCard}
                  onPress={() => toggleExpand(index)}
                  activeOpacity={0.8}
                >
                  {/* Card Header */}
                  {recipe.imageUrl && (
                    <Image
                      source={{ uri: recipe.imageUrl }}
                      style={styles.recipeImage}
                      resizeMode="cover"
                    />
                  )}
                  <View style={styles.recipeHeader}>
                    <View style={styles.recipeHeaderLeft}>
                      <Text style={styles.recipeName} numberOfLines={2}>
                        {recipe.name}
                      </Text>
                      <View style={styles.recipeMeta}>
                        <View style={styles.metaBadge}>
                          <Ionicons
                            name="calendar-outline"
                            size={12}
                            color={Colors.primary}
                          />
                          <Text style={styles.metaText}>
                            {recipe.dayUsed} · {recipe.slot}
                          </Text>
                        </View>
                        <View style={styles.metaBadge}>
                          <Ionicons
                            name="flame-outline"
                            size={12}
                            color={Colors.warning}
                          />
                          <Text style={styles.metaText}>{recipe.calories} kcal</Text>
                        </View>
                      </View>
                    </View>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={Colors.textMuted}
                    />
                  </View>

                  {/* Macro Row */}
                  <View style={styles.macroRow}>
                    <View style={styles.macroItem}>
                      <View style={[styles.macroDot, { backgroundColor: Colors.protein }]} />
                      <Text style={styles.macroValue}>{recipe.protein}g</Text>
                      <Text style={styles.macroLabel}>Protein</Text>
                    </View>
                    <View style={styles.macroItem}>
                      <View style={[styles.macroDot, { backgroundColor: Colors.carbs }]} />
                      <Text style={styles.macroValue}>{recipe.carbs}g</Text>
                      <Text style={styles.macroLabel}>Carbs</Text>
                    </View>
                    <View style={styles.macroItem}>
                      <View style={[styles.macroDot, { backgroundColor: Colors.fat }]} />
                      <Text style={styles.macroValue}>{recipe.fat}g</Text>
                      <Text style={styles.macroLabel}>Fat</Text>
                    </View>
                    {recipe.servings > 1 && (
                      <View style={styles.macroItem}>
                        <View style={[styles.macroDot, { backgroundColor: Colors.info }]} />
                        <Text style={styles.macroValue}>{recipe.servings}</Text>
                        <Text style={styles.macroLabel}>Servings</Text>
                      </View>
                    )}
                  </View>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <View style={styles.expandedContent}>
                      {/* Ingredients */}
                      {recipe.ingredients.length > 0 && (
                        <View style={styles.section}>
                          <View style={styles.sectionHeader}>
                            <Ionicons
                              name="list-outline"
                              size={16}
                              color={Colors.primary}
                            />
                            <Text style={styles.sectionTitle}>Ingredients</Text>
                          </View>
                          {recipe.ingredients.map((ing, i) => (
                            <View key={i} style={styles.ingredientRow}>
                              <View style={styles.bulletDot} />
                              <Text style={styles.ingredientText}>{ing}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Instructions */}
                      {recipe.instructions.length > 0 && (
                        <View style={styles.section}>
                          <View style={styles.sectionHeader}>
                            <Ionicons
                              name="reader-outline"
                              size={16}
                              color={Colors.primary}
                            />
                            <Text style={styles.sectionTitle}>Instructions</Text>
                          </View>
                          {recipe.instructions.map((step, i) => (
                            <View key={i} style={styles.stepRow}>
                              <View style={styles.stepNumber}>
                                <Text style={styles.stepNumberText}>{i + 1}</Text>
                              </View>
                              <Text style={styles.stepText}>{step}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Tags */}
                      {recipe.tags.length > 0 && (
                        <View style={styles.tagsRow}>
                          {recipe.tags.map((tag, i) => (
                            <View key={i} style={styles.tagChip}>
                              <Text style={styles.tagText}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              </FadeInView>
            );
          })}
        </ScrollView>
      )}
      {embedded && onDone && (
        <View style={styles.doneContainer}>
          <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
            <Text style={styles.doneBtnText}>✓ All Done! Close Planner</Text>
          </TouchableOpacity>
        </View>
      )}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  filterRow: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  filterTextActive: {
    color: Colors.textOnPrimary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  recipeCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    marginBottom: 12,
    overflow: 'hidden',
    ...Shadow.small,
  },
  recipeImage: {
    width: '100%',
    height: 140,
  },
  recipeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 14,
    paddingBottom: 8,
  },
  recipeHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  recipeName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  recipeMeta: {
    flexDirection: 'row',
    gap: 10,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  macroRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 16,
  },
  macroItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  macroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  macroValue: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  macroLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  expandedContent: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 3,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.primaryLight,
    marginTop: 7,
  },
  ingredientText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primaryPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Colors.primaryPale,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
    textTransform: 'capitalize',
  },
  doneContainer: {
    padding: 20,
    paddingBottom: 32,
  },
  doneBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneBtnText: {
    color: Colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
