import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
// All colors from central theme — never hardcode hex values here
import { Colors, Spacing, Radius } from '../../theme/index';
import { MealType, FoodLog } from '../../types';
import { foodApi, logApi } from '../../services/api';
import DaySelector from '../../components/DaySelector';
import WaterTracker from '../../components/WaterTracker';

const MEAL_SECTIONS: { type: MealType; label: string; icon: string }[] = [
  { type: 'breakfast', label: 'Breakfast', icon: 'sunny-outline' },
  { type: 'lunch', label: 'Lunch', icon: 'restaurant-outline' },
  { type: 'dinner', label: 'Dinner', icon: 'moon-outline' },
  { type: 'snack', label: 'Snacks', icon: 'cafe-outline' },
];

const UNIT_OPTIONS = ['serving', 'g', 'oz', 'cup', 'tbsp', 'tsp'];

interface SearchResult {
  id?: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size?: string;
  brand?: string | null;
  image_url?: string | null;
}

// Calculate macros based on quantity and unit
const calcMacros = (food: SearchResult, qty: number, unit: string) => {
  let multiplier = qty;
  if (unit === 'g') {
    multiplier = qty / 100;
  } else if (unit === 'oz') {
    multiplier = (qty * 28.35) / 100;
  }
  // serving, cup, tbsp, tsp all use qty as a direct multiplier
  return {
    calories: Math.round(food.calories * multiplier),
    protein: Math.round(food.protein * multiplier * 10) / 10,
    carbs: Math.round(food.carbs * multiplier * 10) / 10,
    fat: Math.round(food.fat * multiplier * 10) / 10,
  };
};

export default function LogScreen() {
  const currentUser = useCurrentUser();
  const [macroTargets, setMacroTargets] = useState<{ calories: number; protein: number; carbs: number; fat: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('macro_targets').then((raw) => {
      if (raw) setMacroTargets(JSON.parse(raw));
    }).catch(() => {});
  }, []);
  const {
    selectedDate,
    foodLogs,
    dailyTotals,
    waterOz,
    setSelectedDate,
    loadDayData,
    logWater,
  } = useClientStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [activeMealType, setActiveMealType] = useState<MealType>('breakfast');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentFoods, setRecentFoods] = useState<SearchResult[]>([]);
  const [frequentFoods, setFrequentFoods] = useState<SearchResult[]>([]);
  const [recentTab, setRecentTab] = useState<'recent' | 'frequent'>('recent');
  const [manualMode, setManualMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [didYouMean, setDidYouMean] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSlowMessage, setShowSlowMessage] = useState(false);

  // Quantity modal state
  const [selectedFood, setSelectedFood] = useState<SearchResult | null>(null);
  const [quantityModalVisible, setQuantityModalVisible] = useState(false);
  const [quantityInput, setQuantityInput] = useState('1');
  const [selectedUnit, setSelectedUnit] = useState('serving');

  // Manual entry fields
  const [foodName, setFoodName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('serving');

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show "Searching 1M+ foods..." after 3 seconds of searching
  useEffect(() => {
    if (searching) {
      const timer = setTimeout(() => setShowSlowMessage(true), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowSlowMessage(false);
    }
  }, [searching]);

  useEffect(() => {
    if (currentUser) {
      loadDayData(currentUser.id);
    }
  }, [currentUser?.id]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    if (currentUser) {
      loadDayData(currentUser.id, date);
    }
  };

  // Load recent foods from backend daily log
  const loadRecentFoods = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await logApi.getDaily(selectedDate);
      const entries: any[] = res.data?.entries || [];
      // Deduplicate by food name for "recent" display
      const seen = new Set<string>();
      const recent: SearchResult[] = [];
      for (const e of entries) {
        const fi = e.food_item || e.foodItem;
        const key = fi?.name || e.food_name;
        if (key && !seen.has(key)) {
          seen.add(key);
          recent.push({
            id: fi?.id,
            name: fi?.name || e.food_name || '',
            calories: fi?.calories ?? fi?.calories_per_serving ?? e.calories ?? 0,
            protein: fi?.protein_g ?? e.protein ?? 0,
            carbs: fi?.carbs_g ?? e.carbs ?? 0,
            fat: fi?.fat_g ?? e.fat ?? 0,
            serving_size: fi?.serving_description ?? fi?.serving_size,
            brand: fi?.brand_or_restaurant ?? fi?.brand ?? null,
            image_url: fi?.image_url ?? fi?.image_front_thumb_url ?? fi?.image_front_small_url ?? null,
          });
        }
      }
      setRecentFoods(recent.slice(0, 8));
    } catch {
      setRecentFoods([]);
    }
  }, [currentUser, selectedDate]);

  // Load frequent foods from last 7 days
  const loadFrequentFoods = useCallback(async () => {
    if (!currentUser) return;
    try {
      const foodCount: Record<string, { count: number; food: SearchResult }> = {};
      const today = new Date(selectedDate);
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        try {
          const res = await logApi.getDaily(dateStr);
          const entries: any[] = res.data?.entries || [];
          for (const e of entries) {
            const fi = e.food_item || e.foodItem;
            const name = fi?.name || e.food_name || '';
            if (!name) continue;
            if (!foodCount[name]) {
              foodCount[name] = {
                count: 0,
                food: {
                  id: fi?.id,
                  name,
                  calories: fi?.calories ?? fi?.calories_per_serving ?? e.calories ?? 0,
                  protein: fi?.protein_g ?? e.protein ?? 0,
                  carbs: fi?.carbs_g ?? e.carbs ?? 0,
                  fat: fi?.fat_g ?? e.fat ?? 0,
                  serving_size: fi?.serving_description ?? fi?.serving_size,
                  brand: fi?.brand_or_restaurant ?? fi?.brand ?? null,
                  image_url: fi?.image_url ?? fi?.image_front_thumb_url ?? fi?.image_front_small_url ?? null,
                },
              };
            }
            foodCount[name].count++;
          }
        } catch {
          // Skip failed day loads
        }
      }
      const sorted = Object.values(foodCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((item) => item.food);
      setFrequentFoods(sorted);
    } catch {
      setFrequentFoods([]);
    }
  }, [currentUser, selectedDate]);

  const openAddFood = useCallback(async (mealType: MealType) => {
    setActiveMealType(mealType);
    setSearchQuery('');
    setSearchResults([]);
    setDidYouMean([]);
    setSearchError(null);
    setManualMode(false);
    setRecentTab('recent');
    resetManualFields();
    setModalVisible(true);
    await loadRecentFoods();
    loadFrequentFoods();
  }, [loadRecentFoods, loadFrequentFoods]);

  const resetManualFields = () => {
    setFoodName('');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setQuantity('1');
    setUnit('serving');
  };

  // Normalize a raw API food item to SearchResult shape
  const mapItem = (item: any): SearchResult => ({
    id: item.id,
    name: item.name,
    calories: item.calories ?? item.calories_per_serving ?? 0,
    protein: item.protein_g ?? item.protein ?? 0,
    carbs: item.carbs_g ?? item.carbs ?? 0,
    fat: item.fat_g ?? item.fat ?? 0,
    serving_size: item.serving_description ?? item.serving_size ?? undefined,
    brand: item.brand_or_restaurant ?? item.brand ?? null,
    image_url: item.image_url ?? item.image_front_thumb_url ?? item.image_front_small_url ?? null,
  });

  // Debounced food search via REST API
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setDidYouMean([]);
    setSearchError(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await foodApi.search(query, 50);
        const data = res.data;
        // Backend always returns { results, suggestions, did_you_mean }
        // Guard against legacy plain-array responses
        const results: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.results)
          ? data.results
          : [];
        const suggestions: any[] = Array.isArray(data?.suggestions)
          ? data.suggestions
          : [];

        const mapped = results.map(mapItem);
        setSearchResults(mapped);

        if (mapped.length === 0 && suggestions.length > 0) {
          setDidYouMean(suggestions.map(mapItem));
        } else {
          setDidYouMean([]);
        }
      } catch (err) {
        setSearchResults([]);
        setDidYouMean([]);
        setSearchError('Search unavailable. Check your connection.');
      } finally {
        setSearching(false);
      }
    }, 600);
  };

  // Open quantity modal instead of logging immediately
  const handleSelectFood = (food: SearchResult) => {
    setSelectedFood(food);
    setQuantityInput('1');
    setSelectedUnit('serving');
    setQuantityModalVisible(true);
  };

  // Confirm log with quantity
  const handleConfirmLog = async () => {
    if (!currentUser || !selectedFood) return;
    const qty = parseFloat(quantityInput) || 1;
    try {
      let foodItemId = selectedFood.id || '';

      // If this is an OpenFoodFacts item (no DB id or prefixed with off_), create it first
      if (!foodItemId || foodItemId.startsWith('off_')) {
        const createRes = await foodApi.create({
          name: selectedFood.name,
          brand_or_restaurant: selectedFood.brand || null,
          category: 'generic',
          serving_description: selectedFood.serving_size || '100g',
          serving_size_grams: 100,
          calories: selectedFood.calories,
          protein_g: selectedFood.protein,
          carbs_g: selectedFood.carbs,
          fat_g: selectedFood.fat,
          tags: [],
          search_aliases: [],
        });
        foodItemId = createRes.data.id;
      }

      // Calculate the quantity multiplier based on unit
      let multiplier = qty;
      if (selectedUnit === 'g') {
        multiplier = qty / 100;
      } else if (selectedUnit === 'oz') {
        multiplier = (qty * 28.35) / 100;
      }

      await logApi.logFood({
        date: selectedDate,
        meal_type: activeMealType,
        food_item_id: foodItemId,
        quantity_multiplier: multiplier,
      });
      await loadDayData(currentUser.id, selectedDate);
    } catch (err) {
    }
    setQuantityModalVisible(false);
    setSelectedFood(null);
    setModalVisible(false);
  };

  const handleManualLog = async () => {
    if (!currentUser || !foodName.trim() || !calories) {
      Alert.alert('Missing Info', 'Enter at least a food name and calories.');
      return;
    }
    try {
      // Create the food item in backend first
      const createRes = await foodApi.create({
        name: foodName.trim(),
        brand_or_restaurant: null,
        category: 'generic',
        serving_description: `${quantity} ${unit || 'serving'}`,
        serving_size_grams: 100,
        calories: parseInt(calories) || 0,
        protein_g: parseInt(protein) || 0,
        carbs_g: parseInt(carbs) || 0,
        fat_g: parseInt(fat) || 0,
        tags: [],
        search_aliases: [],
      });
      const foodItemId = createRes.data.id;

      await logApi.logFood({
        date: selectedDate,
        meal_type: activeMealType,
        food_item_id: foodItemId,
        quantity_multiplier: parseFloat(quantity) || 1,
      });
      await loadDayData(currentUser.id, selectedDate);
    } catch (err) {
    }
    setModalVisible(false);
  };

  const handleDeleteFood = async (log: FoodLog) => {
    if (!currentUser) return;
    Alert.alert('Delete Food', `Remove ${log.foodName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await logApi.deleteEntry(log.id);
          } catch {
            // Gracefully handle — local state will refresh
          }
          loadDayData(currentUser.id, selectedDate);
        },
      },
    ]);
  };

  const handleAddWater = (oz: number) => {
    if (currentUser) {
      logWater(currentUser.id, '', oz);
    }
  };

  const getMealLogs = (mealType: MealType) =>
    foodLogs.filter((f) => f.mealType === mealType);

  const getMealCalories = (mealType: MealType) =>
    getMealLogs(mealType).reduce((sum, f) => sum + f.calories, 0);

  const calorieTarget = macroTargets?.calories || 2000;
  const remaining = Math.max(0, calorieTarget - dailyTotals.calories);

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await loadDayData(currentUser.id, selectedDate);
    setRefreshing(false);
  }, [currentUser?.id, selectedDate]);

  const browseList = recentTab === 'recent' ? recentFoods : frequentFoods;
  const showList = searchQuery.length >= 2 ? searchResults : browseList;
  const showEmpty =
    searchQuery.length >= 2 && !searching && searchResults.length === 0 && didYouMean.length === 0;

  // Live macro preview for quantity modal
  const previewMacros = selectedFood
    ? calcMacros(selectedFood, parseFloat(quantityInput) || 0, selectedUnit)
    : { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const renderFoodThumb = (item: SearchResult) => {
    if (item.image_url) {
      return (
        <Image
          source={{ uri: item.image_url }}
          style={styles.foodThumb}
          resizeMode="cover"
        />
      );
    }
    return (
      <View style={[styles.foodThumb, styles.foodThumbPlaceholder]}>
        <Text style={styles.foodThumbLetter}>
          {(item.name || '?')[0].toUpperCase()}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
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
        <View style={styles.header}>
          <Text style={styles.title}>Food Log</Text>
        </View>

        <DaySelector selectedDate={selectedDate} onDateChange={handleDateChange} />

        {/* Daily Summary Bar */}
        <View style={styles.summaryBar}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{Math.round(dailyTotals.calories)}</Text>
            <Text style={styles.summaryLabel}>Eaten</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: Colors.primary }]}>
              {Math.round(remaining)}
            </Text>
            <Text style={styles.summaryLabel}>Remaining</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: Colors.orange }]}>
              {Math.round(dailyTotals.protein)}g
            </Text>
            <Text style={styles.summaryLabel}>Protein</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: Colors.gold }]}>
              {Math.round(dailyTotals.carbs)}g
            </Text>
            <Text style={styles.summaryLabel}>Carbs</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: '#A78BFA' }]}>
              {Math.round(dailyTotals.fat)}g
            </Text>
            <Text style={styles.summaryLabel}>Fat</Text>
          </View>
        </View>

        {/* Meal Sections */}
        {MEAL_SECTIONS.map((section) => {
          const logs = getMealLogs(section.type);
          const mealCals = getMealCalories(section.type);
          return (
            <View key={section.type} style={styles.mealSection}>
              <View style={styles.mealHeader}>
                <View style={styles.mealHeaderLeft}>
                  <Ionicons name={section.icon as any} size={18} color={Colors.primary} />
                  <Text style={styles.mealTitle}>{section.label}</Text>
                </View>
                <Text style={styles.mealCals}>
                  {mealCals > 0 ? `${Math.round(mealCals)} kcal` : ''}
                </Text>
              </View>

              {logs.length === 0 && (
                <Text style={styles.emptyMealText}>No foods logged yet</Text>
              )}

              {logs.map((log) => (
                <TouchableOpacity
                  key={log.id}
                  style={styles.foodItem}
                  onLongPress={() => handleDeleteFood(log)}
                  activeOpacity={0.7}
                >
                  <View style={styles.foodItemLeft}>
                    <Text style={styles.foodName}>
                      {log.foodName}
                      {(log as any).quantity_multiplier > 1 && (
                        <Text style={styles.foodQuantityMuted}>
                          {' '}· ×{(log as any).quantity_multiplier}
                        </Text>
                      )}
                    </Text>
                    <Text style={styles.foodMacros}>
                      P: {Math.round(log.protein)}g · C: {Math.round(log.carbs)}g · F: {Math.round(log.fat)}g
                    </Text>
                  </View>
                  <Text style={styles.foodCals}>{Math.round(log.calories)}</Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.addFoodButton}
                onPress={() => openAddFood(section.type)}
                activeOpacity={0.7}
              >
                <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.addFoodText}>Add Food</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Water Tracker */}
        <View style={styles.waterSection}>
          <WaterTracker currentOz={waterOz} onAdd={handleAddWater} />
        </View>
      </ScrollView>

      {/* Add Food Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.dark} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              Add to {MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {!manualMode ? (
            <View style={styles.modalBody}>
              {/* Search Bar */}
              <View style={styles.searchBar}>
                <Ionicons name="search" size={18} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search foods..."
                  placeholderTextColor={Colors.textMuted}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  autoFocus
                />
                {searching && (
                  <ActivityIndicator size="small" color={Colors.primary} />
                )}
                {!searching && searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery('');
                      setSearchResults([]);
                      setDidYouMean([]);
                      setSearchError(null);
                    }}
                  >
                    <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Search error banner */}
              {searchError && (
                <View style={styles.searchErrorBanner}>
                  <Ionicons name="warning-outline" size={16} color={Colors.error || '#EF4444'} />
                  <Text style={styles.searchErrorText}>{searchError}</Text>
                </View>
              )}

              {/* Slow search message */}
              {searching && showSlowMessage && (
                <View style={styles.slowSearchBanner}>
                  <Text style={styles.slowSearchText}>Searching 1M+ foods...</Text>
                </View>
              )}

              {/* Recent / Frequent tabs — only show when not actively searching */}
              {searchQuery.length < 2 && (
                <View style={styles.tabRow}>
                  <TouchableOpacity
                    style={[styles.tabChip, recentTab === 'recent' && styles.tabChipActive]}
                    onPress={() => setRecentTab('recent')}
                  >
                    <Text style={[styles.tabChipText, recentTab === 'recent' && styles.tabChipTextActive]}>Recent</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.tabChip, recentTab === 'frequent' && styles.tabChipActive]}
                    onPress={() => setRecentTab('frequent')}
                  >
                    <Text style={[styles.tabChipText, recentTab === 'frequent' && styles.tabChipTextActive]}>Frequent</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* "Did you mean?" fallback suggestions */}
              {didYouMean.length > 0 && (
                <View style={styles.didYouMeanContainer}>
                  <View style={styles.didYouMeanHeaderRow}>
                    <Ionicons name="bulb-outline" size={16} color={Colors.gold} />
                    <Text style={styles.didYouMeanHeaderText}>Did you mean…?</Text>
                  </View>
                  {didYouMean.map((item, idx) => (
                    <TouchableOpacity
                      key={`dym-${idx}`}
                      style={styles.didYouMeanItem}
                      onPress={() => handleSelectFood(item)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.searchResultLeft}>
                        <Text style={styles.searchResultName}>{item.name}</Text>
                        {item.brand ? (
                          <Text style={styles.searchResultBrand}>{item.brand}</Text>
                        ) : null}
                        <Text style={styles.searchResultMacros}>
                          P: {Math.round(item.protein)}g · C: {Math.round(item.carbs)}g · F: {Math.round(item.fat)}g
                        </Text>
                      </View>
                      <Text style={styles.searchResultCals}>{Math.round(item.calories)} kcal</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <FlatList
                data={showList}
                keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
                ListHeaderComponent={
                  searchQuery.length < 2 && browseList.length > 0 ? (
                    <Text style={styles.listHeader}>
                      {recentTab === 'recent' ? 'Recent Foods' : 'Frequent Foods'}
                    </Text>
                  ) : showEmpty ? (
                    <View style={styles.emptyStateContainer}>
                      <Ionicons name="search-outline" size={36} color={Colors.textMuted} />
                      <Text style={styles.emptyStateTitle}>No results found</Text>
                      <Text style={styles.emptyStateSubtitle}>
                        Try a simpler name, check spelling, or log it manually below.
                      </Text>
                      <TouchableOpacity
                        style={{ backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 10, marginTop: 12 }}
                        onPress={() => handleSearch(searchQuery)}
                      >
                        <Text style={{ color: Colors.white, fontWeight: '600', fontSize: 14 }}>Retry Search</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={() => handleSelectFood(item)}
                    activeOpacity={0.7}
                  >
                    {renderFoodThumb(item)}
                    <View style={styles.searchResultLeft}>
                      <Text style={styles.searchResultName}>{item.name}</Text>
                      {item.brand ? (
                        <Text style={styles.searchResultBrand}>{item.brand}</Text>
                      ) : null}
                      <Text style={styles.searchResultMacros}>
                        P: {Math.round(item.protein)}g · C: {Math.round(item.carbs)}g · F: {Math.round(item.fat)}g
                        {item.serving_size ? ` · ${item.serving_size}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.searchResultCals}>{Math.round(item.calories)} kcal</Text>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.searchList}
                keyboardShouldPersistTaps="handled"
              />

              <TouchableOpacity
                style={styles.manualButton}
                onPress={() => setManualMode(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="create-outline" size={18} color={Colors.primary} />
                <Text style={styles.manualButtonText}>Enter Manually</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.manualForm}
              keyboardShouldPersistTaps="handled"
            >
              <TouchableOpacity
                style={styles.backToSearch}
                onPress={() => setManualMode(false)}
              >
                <Ionicons name="arrow-back" size={18} color={Colors.primary} />
                <Text style={styles.backToSearchText}>Back to Search</Text>
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                placeholder="Food name"
                placeholderTextColor={Colors.textMuted}
                value={foodName}
                onChangeText={setFoodName}
              />

              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Calories</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={calories}
                    onChangeText={setCalories}
                  />
                </View>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Protein (g)</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={protein}
                    onChangeText={setProtein}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Carbs (g)</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={carbs}
                    onChangeText={setCarbs}
                  />
                </View>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Fat (g)</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={fat}
                    onChangeText={setFat}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Quantity</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    value={quantity}
                    onChangeText={setQuantity}
                  />
                </View>
                <View style={styles.halfInput}>
                  <Text style={styles.inputLabel}>Unit</Text>
                  <TextInput
                    style={styles.inputSmall}
                    placeholder="serving"
                    placeholderTextColor={Colors.textMuted}
                    value={unit}
                    onChangeText={setUnit}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={styles.logButton}
                onPress={handleManualLog}
                activeOpacity={0.8}
              >
                <Ionicons name="add-circle" size={22} color={Colors.white} />
                <Text style={styles.logButtonText}>Log Food</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Quantity Selection Modal */}
      <Modal
        visible={quantityModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setQuantityModalVisible(false);
          setSelectedFood(null);
        }}
      >
        <KeyboardAvoidingView
          style={styles.quantityModalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.quantityModalContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Food image */}
            {selectedFood?.image_url ? (
              <Image
                source={{ uri: selectedFood.image_url }}
                style={styles.quantityFoodImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.quantityFoodImage, styles.quantityFoodImagePlaceholder]}>
                <Text style={styles.quantityFoodImageLetter}>
                  {(selectedFood?.name || '?')[0].toUpperCase()}
                </Text>
              </View>
            )}

            {/* Food name */}
            <Text style={styles.quantityFoodName}>{selectedFood?.name}</Text>
            {selectedFood?.brand ? (
              <Text style={styles.quantityFoodBrand}>{selectedFood.brand}</Text>
            ) : null}

            {/* Macro preview card */}
            <View style={styles.macroPreviewCard}>
              <View style={styles.macroPreviewItem}>
                <Text style={styles.macroPreviewValue}>{previewMacros.calories}</Text>
                <Text style={styles.macroPreviewLabel}>Cal</Text>
              </View>
              <View style={styles.macroPreviewDivider} />
              <View style={styles.macroPreviewItem}>
                <Text style={[styles.macroPreviewValue, { color: Colors.orange }]}>{previewMacros.protein}g</Text>
                <Text style={styles.macroPreviewLabel}>Protein</Text>
              </View>
              <View style={styles.macroPreviewDivider} />
              <View style={styles.macroPreviewItem}>
                <Text style={[styles.macroPreviewValue, { color: Colors.gold }]}>{previewMacros.carbs}g</Text>
                <Text style={styles.macroPreviewLabel}>Carbs</Text>
              </View>
              <View style={styles.macroPreviewDivider} />
              <View style={styles.macroPreviewItem}>
                <Text style={[styles.macroPreviewValue, { color: '#A78BFA' }]}>{previewMacros.fat}g</Text>
                <Text style={styles.macroPreviewLabel}>Fat</Text>
              </View>
            </View>

            {/* Quantity input */}
            <Text style={styles.quantitySectionLabel}>Quantity</Text>
            <TextInput
              style={styles.quantityInput}
              value={quantityInput}
              onChangeText={setQuantityInput}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={Colors.textMuted}
            />

            {/* Unit selector chips */}
            <Text style={styles.quantitySectionLabel}>Unit</Text>
            <View style={styles.unitChipRow}>
              {UNIT_OPTIONS.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.unitChip, selectedUnit === u && styles.unitChipActive]}
                  onPress={() => setSelectedUnit(u)}
                >
                  <Text style={[styles.unitChipText, selectedUnit === u && styles.unitChipTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Serving size info */}
            {selectedFood?.serving_size ? (
              <Text style={styles.servingSizeInfo}>1 serving = {selectedFood.serving_size}</Text>
            ) : null}

            {/* Log button */}
            <TouchableOpacity
              style={styles.quantityLogButton}
              onPress={handleConfirmLog}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle" size={22} color={Colors.white} />
              <Text style={styles.quantityLogButtonText}>Log Food</Text>
            </TouchableOpacity>

            {/* Cancel link */}
            <TouchableOpacity
              style={styles.quantityCancelLink}
              onPress={() => {
                setQuantityModalVisible(false);
                setSelectedFood(null);
              }}
            >
              <Text style={styles.quantityCancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 60,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.dark,
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 20,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.dark,
  },
  summaryLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  mealSection: {
    marginHorizontal: Spacing.lg,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  mealHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark,
  },
  mealCals: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  foodItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  foodItemLeft: {
    flex: 1,
    marginRight: 12,
  },
  foodName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark,
  },
  foodQuantityMuted: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.textMuted,
  },
  foodMacros: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  foodCals: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark,
  },
  addFoodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 4,
  },
  addFoodText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  emptyMealText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  waterSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 20,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark,
  },
  modalBody: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.dark,
  },
  searchErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 10,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  searchErrorText: {
    fontSize: 13,
    color: '#EF4444',
    flex: 1,
  },
  slowSearchBanner: {
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
  },
  slowSearchText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 8,
  },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  tabChipTextActive: {
    color: Colors.white,
  },
  didYouMeanContainer: {
    marginHorizontal: 20,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  didYouMeanHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  didYouMeanHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.gold,
  },
  didYouMeanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  didYouMeanText: {
    fontSize: 14,
    color: Colors.dark,
    flex: 1,
  },
  didYouMeanSuggestion: {
    fontWeight: '700',
    color: Colors.gold,
  },
  emptyStateContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark,
    marginTop: 8,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  searchList: {
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  listHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: 8,
    marginTop: 4,
  },
  noResults: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  foodThumb: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    marginRight: 12,
  },
  foodThumbPlaceholder: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodThumbLetter: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchResultLeft: {
    flex: 1,
    marginRight: 12,
  },
  searchResultName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark,
  },
  searchResultBrand: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  searchResultMacros: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  searchResultCals: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  manualButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manualButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  manualForm: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  backToSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  backToSearchText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.dark,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  inputSmall: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.dark,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  halfInput: {
    flex: 1,
  },
  logButton: {
    backgroundColor: Colors.primary,
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logButtonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },

  // Quantity Selection Modal
  quantityModalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  quantityModalContent: {
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  quantityFoodImage: {
    width: 120,
    height: 120,
    borderRadius: Radius.lg,
    marginBottom: 16,
  },
  quantityFoodImagePlaceholder: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityFoodImageLetter: {
    fontSize: 48,
    fontWeight: '800',
    color: Colors.primary,
  },
  quantityFoodName: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark,
    textAlign: 'center',
    marginBottom: 4,
  },
  quantityFoodBrand: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  macroPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  macroPreviewItem: {
    flex: 1,
    alignItems: 'center',
  },
  macroPreviewValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.dark,
  },
  macroPreviewLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  macroPreviewDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  quantitySectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  quantityInput: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.dark,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
    width: '100%',
    textAlign: 'center',
  },
  unitChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    width: '100%',
  },
  unitChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  unitChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  unitChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  unitChipTextActive: {
    color: Colors.white,
  },
  servingSizeInfo: {
    fontSize: 13,
    color: Colors.textMuted,
    alignSelf: 'flex-start',
    marginBottom: 20,
    marginTop: 4,
  },
  quantityLogButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    marginTop: 8,
  },
  quantityLogButtonText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  quantityCancelLink: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  quantityCancelText: {
    fontSize: 15,
    color: Colors.textMuted,
    fontWeight: '600',
  },
});
