import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { Colors, Spacing } from '../../theme/index';
import { MealType, FoodLog } from '../../types';
import { foodApi, logApi } from '../../services/api';
import { flush as flushFoodLogQueue } from '../../services/foodLogQueue';
import { useNetworkStatus, isEffectivelyOnline } from '../../hooks/useNetworkStatus';
import DaySelector from '../../components/DaySelector';
import WaterTracker from '../../components/WaterTracker';
import DailySummaryBar from '../../components/log/DailySummaryBar';
import MealSectionCard from '../../components/log/MealSectionCard';
import FoodSearchModal from '../../components/log/FoodSearchModal';
import QuantityPickerModal from '../../components/log/QuantityPickerModal';
import { ManualFields } from '../../components/log/ManualFoodEntryForm';
import { useMacroTargets } from '../../hooks/useMacroTargets';
import { useFoodBrowse } from '../../hooks/useFoodBrowse';
import { SearchResult, MEAL_SECTIONS } from '../../utils/log/types';
import { quantityMultiplier } from '../../utils/log/macros';
import { mapFoodItem } from '../../utils/log/mapFoodItem';
import {
  submitSearchLogOffline,
  submitSearchLogOnline,
  submitManualLogOffline,
  submitManualLogOnline,
} from '../../utils/log/logSubmit';
import { track } from '../../lib/analytics';

export default function LogScreen() {
  const currentUser = useCurrentUser();
  const network = useNetworkStatus();
  const online = isEffectivelyOnline(network);
  const macroTargets = useMacroTargets();

  const {
    selectedDate,
    foodLogs,
    dailyTotals,
    waterOz,
    setSelectedDate,
    loadDayData,
    logWater,
  } = useClientStore();

  const { recentFoods, frequentFoods, loadRecentFoods, loadFrequentFoods } = useFoodBrowse(
    currentUser?.id,
    selectedDate,
  );

  const [modalVisible, setModalVisible] = useState(false);
  const [activeMealType, setActiveMealType] = useState<MealType>('breakfast');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
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
  const [manualFields, setManualFields] = useState<ManualFields>({
    foodName: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    quantity: '1',
    unit: 'serving',
  });

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

  const resetManualFields = () =>
    setManualFields({
      foodName: '',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
      quantity: '1',
      unit: 'serving',
    });

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

        const mapped = results.map(mapFoodItem);
        setSearchResults(mapped);

        if (mapped.length === 0 && suggestions.length > 0) {
          setDidYouMean(suggestions.map(mapFoodItem));
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

  const handleSelectFood = (food: SearchResult) => {
    setSelectedFood(food);
    setQuantityInput('1');
    setSelectedUnit('serving');
    setQuantityModalVisible(true);
  };

  // Confirm log with quantity.
  // Behavior change (round 2): empty catches used to close the modal whether
  // or not the save succeeded. Now the modal stays open on failure and shows
  // an Alert with the real error message. When the device is offline we queue
  // the log to AsyncStorage and close cleanly with a confirmation.
  const handleConfirmLog = async () => {
    if (!currentUser || !selectedFood) return;
    const qty = parseFloat(quantityInput) || 1;
    const multiplier = quantityMultiplier(qty, selectedUnit);
    const args = { food: selectedFood, date: selectedDate, mealType: activeMealType, multiplier };

    if (!online) {
      try {
        await submitSearchLogOffline(args);
        setQuantityModalVisible(false);
        setSelectedFood(null);
        setModalVisible(false);
        Alert.alert(
          'Saved offline',
          `${selectedFood.name} will sync to your log when you reconnect.`,
        );
      } catch (err: any) {
        console.error('LogScreen: enqueue failed', err);
        Alert.alert("Couldn't save food", err?.message || 'Please try again.');
      }
      return;
    }

    try {
      await submitSearchLogOnline(args);
      await loadDayData(currentUser.id, selectedDate);
      // Psych Report #4: Analytics — meal_logged (search flow)
      track('meal_logged', { meal_type: activeMealType, source: 'search' });
      setQuantityModalVisible(false);
      setSelectedFood(null);
      setModalVisible(false);
    } catch (err: any) {
      console.error('LogScreen: handleConfirmLog failed', err);
      Alert.alert("Couldn't log food", err?.message || 'Please try again.');
    }
  };

  const handleManualLog = async () => {
    if (!currentUser || !manualFields.foodName.trim() || !manualFields.calories) {
      Alert.alert('Missing Info', 'Enter at least a food name and calories.');
      return;
    }
    const args = { ...manualFields, date: selectedDate, mealType: activeMealType };

    if (!online) {
      try {
        const name = await submitManualLogOffline(args);
        setModalVisible(false);
        Alert.alert('Saved offline', `${name} will sync when you reconnect.`);
      } catch (err: any) {
        console.error('LogScreen: manual enqueue failed', err);
        Alert.alert("Couldn't save food", err?.message || 'Please try again.');
      }
      return;
    }

    try {
      await submitManualLogOnline(args);
      await loadDayData(currentUser.id, selectedDate);
      // Psych Report #4: Analytics — meal_logged (manual flow)
      track('meal_logged', { meal_type: activeMealType, source: 'manual' });
      setModalVisible(false);
    } catch (err: any) {
      console.error('LogScreen: handleManualLog failed', err);
      Alert.alert("Couldn't log food", err?.message || 'Please try again.');
    }
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
          } catch (err: any) {
            console.error('LogScreen: handleDeleteFood failed', err);
            Alert.alert("Couldn't remove food", err?.message || 'Please try again.');
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
    // Pull-to-refresh also opportunistically flushes the offline food-log queue.
    // If we're still offline the flush is a cheap no-op; if we just came back
    // online this catches us up before the RootNavigator's network-change
    // effect fires.
    if (online) {
      try {
        await flushFoodLogQueue();
      } catch (err) {
        console.error('LogScreen: flushFoodLogQueue failed', err);
      }
    }
    await loadDayData(currentUser.id, selectedDate);
    setRefreshing(false);
  }, [currentUser?.id, selectedDate, online]);

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setDidYouMean([]);
    setSearchError(null);
  };

  const onManualFieldChange = (field: keyof ManualFields, value: string) =>
    setManualFields((prev) => ({ ...prev, [field]: value }));

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

        <DailySummaryBar dailyTotals={dailyTotals} remaining={remaining} />

        {MEAL_SECTIONS.map((section) => (
          <MealSectionCard
            key={section.type}
            label={section.label}
            icon={section.icon}
            mealType={section.type}
            logs={getMealLogs(section.type)}
            mealCalories={getMealCalories(section.type)}
            onAddPress={openAddFood}
            onDeletePress={handleDeleteFood}
          />
        ))}

        <View style={styles.waterSection}>
          <WaterTracker currentOz={waterOz} onAdd={handleAddWater} />
        </View>
      </ScrollView>

      <FoodSearchModal
        visible={modalVisible}
        activeMealType={activeMealType}
        onClose={() => setModalVisible(false)}
        searchQuery={searchQuery}
        onSearchChange={handleSearch}
        onClearSearch={clearSearch}
        onRetrySearch={() => handleSearch(searchQuery)}
        searching={searching}
        showSlowMessage={showSlowMessage}
        searchError={searchError}
        searchResults={searchResults}
        didYouMean={didYouMean}
        recentTab={recentTab}
        onRecentTabChange={setRecentTab}
        recentFoods={recentFoods}
        frequentFoods={frequentFoods}
        onSelectFood={handleSelectFood}
        manualMode={manualMode}
        onEnterManualMode={() => setManualMode(true)}
        onExitManualMode={() => setManualMode(false)}
        manualFields={manualFields}
        onManualFieldChange={onManualFieldChange}
        onManualLog={handleManualLog}
      />

      <QuantityPickerModal
        visible={quantityModalVisible}
        selectedFood={selectedFood}
        quantityInput={quantityInput}
        selectedUnit={selectedUnit}
        onQuantityChange={setQuantityInput}
        onUnitChange={setSelectedUnit}
        onConfirm={handleConfirmLog}
        onCancel={() => {
          setQuantityModalVisible(false);
          setSelectedFood(null);
        }}
      />
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
  waterSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 20,
  },
});
