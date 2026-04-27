import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { recipesApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import FadeInView from '../../components/FadeInView';

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
  isSaved?: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MacroCard({ label, value, unit, color }: {
  label: string; value: number; unit: string; color: string;
}) {
  return (
    <View style={[styles.macroCard, { backgroundColor: color + '15' }]}>
      <Text style={[styles.macroValue, { color }]}>{Math.round(value)}{unit}</Text>
      <Text style={[styles.macroLabel, { color: color + 'BB' }]}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RecipeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ RecipeDetail: { recipe: Recipe } }, 'RecipeDetail'>>();
  const recipe = route.params?.recipe;

  const [isSaved, setIsSaved] = useState(recipe?.isSaved ?? false);
  const [saving, setSaving] = useState(false);

  const totalTime = (recipe?.prep_time_min ?? 0) + (recipe?.cook_time_min ?? 0);

  const handleToggleSave = useCallback(async () => {
    if (saving) return;
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
  }, [isSaved, saving, recipe?.id]);

  if (!recipe) {
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
      {/* Hero banner */}
      <View style={styles.hero}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.heroIcon}>
          <Ionicons name="restaurant" size={56} color={Colors.primary} />
        </View>
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleToggleSave}
          activeOpacity={0.8}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Ionicons
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={24}
              color={isSaved ? Colors.primary : Colors.textSecondary}
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
              <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
              <Text style={styles.metaText}>{totalTime} min total</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="restaurant-outline" size={16} color={Colors.textMuted} />
              <Text style={styles.metaText}>{recipe.servings} servings</Text>
            </View>
            {recipe.prep_time_min > 0 && (
              <View style={styles.metaItem}>
                <Ionicons name="cut-outline" size={16} color={Colors.textMuted} />
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
            <MacroCard label="Calories" value={recipe.calories} unit="kcal" color={Colors.accent} />
            <MacroCard label="Protein" value={recipe.protein} unit="g" color={Colors.protein} />
            <MacroCard label="Carbs" value={recipe.carbs} unit="g" color={Colors.carbs} />
            <MacroCard label="Fat" value={recipe.fat} unit="g" color={Colors.fat} />
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
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 60 },

  hero: {
    height: 200,
    backgroundColor: Colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
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
    backgroundColor: Colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    zIndex: 10,
  },

  section: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    marginHorizontal: 16,
    marginTop: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  lastSection: { marginBottom: 0 },

  recipeTitle: { fontSize: 22, fontWeight: '500', color: Colors.textPrimary, lineHeight: 28 },
  recipeDesc: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },

  metaRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textMuted },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 0, // radius.sm
  },
  tagText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },

  sectionTitle: { fontSize: 16, fontWeight: '500', color: Colors.textPrimary },

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
    backgroundColor: Colors.primary,
    marginTop: 7,
    flexShrink: 0,
  },
  listItemText: { flex: 1, fontSize: 14, color: Colors.textPrimary, lineHeight: 22 },

  stepItem: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: { fontSize: 13, fontWeight: '500', color: Colors.textOnPrimary },
  stepText: { flex: 1, fontSize: 14, color: Colors.textPrimary, lineHeight: 22 },

  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  errorLink: { fontSize: 15, color: Colors.primary, fontWeight: '600' },
});
