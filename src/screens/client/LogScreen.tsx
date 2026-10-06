import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { Spacing } from '../../theme/index';
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
import { useMacroDisplayMode } from '../../macros/macroDisplayStore';
import { useFoodBrowse } from '../../hooks/useFoodBrowse';
import { SearchResult, MEAL_SECTIONS, unitOptionsFor } from '../../utils/log/types';
import { quantityMultiplier, parseQuantityInput } from '../../utils/log/macros';
import { initialEditPortion, editUnitsFor, editPortionMultiplier } from '../../utils/log/editPortion';
import { mapFoodItem, type RawFoodItem } from '../../utils/log/mapFoodItem';
import { matchLoggedFoods, mergeWithLoggedMatches, repeatPastMeal } from '../../utils/log/quickLog';
import { addDays, getTodayString } from '../../utils/date';
import {
  submitSearchLogOffline,
  submitSearchLogOnline,
  submitManualLogOffline,
  submitManualLogOnline,
} from '../../utils/log/logSubmit';
import { track } from '../../lib/analytics';
import { HapticService } from '../../ui/haptics/haptics.service';
import { AnalyticsEvents } from '../../analytics/events';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import CoachErrorState from '../../components/community/coach/CoachErrorState';

export default function LogScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const network = useNetworkStatus();
  const online = isEffectivelyOnline(network);
  const macroTargets = useMacroTargets();
  // Lighter start for never-trackers: calories and protein only until the
  // server's simple_until passes. 'full' when the backend sends nothing.
  const macroMode = useMacroDisplayMode(currentUser?.id ?? null);

  const {
    selectedDate,
    foodLogs,
    dailyTotals,
    waterOz,
    isLoading,
    loadError,
    setSelectedDate,
    loadDayData,
    logWater,
    removeFoodLogLocally,
  } = useClientStore();

  const { recentFoods, frequentFoods, lastMeals, loadBrowseFoods } = useFoodBrowse(
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

  // F-2: inline edit-log modal state. Keeps the edit UX a single tap
  // away from the entry row without dragging in another component, and
  // works on iOS + Android (Alert.prompt is iOS-only).
  const [editLog, setEditLog] = useState<FoodLog | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [editUnit, setEditUnit] = useState<string>('');
  const [editSaving, setEditSaving] = useState(false);
  const [editMealType, setEditMealType] = useState<MealType>('breakfast');
  const [foodSaving, setFoodSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Quantity modal state
  const [selectedFood, setSelectedFood] = useState<SearchResult | null>(null);
  const [quantityModalVisible, setQuantityModalVisible] = useState(false);
  const [quantityInput, setQuantityInput] = useState('1');
  const [selectedUnit, setSelectedUnit] = useState('serving');

  // NL parse hints from the most recent /foods/search response. When the
  // backend parses "6oz chicken breast" it returns parsed_quantity=6 and
  // parsed_unit='oz' at the top level; we pre-fill the picker so the user
  // doesn't have to re-enter what they already typed.
  const [parsedQuantity, setParsedQuantity] = useState<number | null>(null);
  const [parsedUnit, setParsedUnit] = useState<string | null>(null);

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
  const searchRequest = useRef(0);

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
    setSavedMessage(null);
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
    searchRequest.current += 1;
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    setSearching(false);
    setParsedQuantity(null);
    setParsedUnit(null);
    setActiveMealType(mealType);
    setSearchQuery('');
    setSearchResults([]);
    setDidYouMean([]);
    setSearchError(null);
    setManualMode(false);
    setRecentTab('recent');
    resetManualFields();
    setModalVisible(true);
    // One parallel fetch fills Recent, Frequent and the repeat-meal card.
    await loadBrowseFoods();
  }, [loadBrowseFoods]);

  // Debounced food search via REST API
  const handleSearch = (query: string) => {
    const request = ++searchRequest.current;
    setSearchQuery(query);
    // Foods already in the client's log show the moment they type; catalog
    // results are appended when the search returns.
    const logged = query.length >= 2 ? matchLoggedFoods(query, recentFoods, frequentFoods) : [];
    setSearchResults(logged);
    setParsedQuantity(null);
    setParsedUnit(null);
    setDidYouMean([]);
    setSearchError(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (query.length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await foodApi.search(query, 50);
        if (request !== searchRequest.current) return;
        const data = res.data;
        // Backend always returns { results, suggestions, did_you_mean }
        // Guard against legacy plain-array responses
        const results: RawFoodItem[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.results)
          ? data.results
          : [];
        const suggestions: RawFoodItem[] = Array.isArray(data?.suggestions)
          ? data.suggestions
          : [];
        // NL parse hints from the quality-floor backend. Optional — old
        // backends just won't include them.
        const pq = typeof data?.parsed_quantity === 'number' ? data.parsed_quantity : null;
        const pu = typeof data?.parsed_unit === 'string' ? data.parsed_unit.toLowerCase() : null;
        setParsedQuantity(pq);
        setParsedUnit(pu);

        const mapped = results.map(mapFoodItem);
        setSearchResults(mergeWithLoggedMatches(logged, mapped));

        if (mapped.length === 0 && logged.length === 0 && suggestions.length > 0) {
          setDidYouMean(suggestions.map(mapFoodItem));
        } else {
          setDidYouMean([]);
        }
      } catch (err) {
        if (request !== searchRequest.current) return;
        setSearchResults(logged);
        setDidYouMean([]);
        setSearchError('Search unavailable. Check your connection.');
      } finally {
        if (request === searchRequest.current) setSearching(false);
      }
    }, 600);
  };

  const handleSelectFood = (food: SearchResult) => {
    setSelectedFood(food);
    // Pre-fill from NL parse when present, falling back to sensible defaults.
    // If the parsed unit is one the picker no longer offers for this food
    // (e.g. parsed 'cup' but the food has no density), fall through to
    // 'serving' so the picker stays in a valid state.
    const allowedUnits = unitOptionsFor(food);
    // A portion typed into the search wins; otherwise a food from the
    // client's log starts at the portion logged last time.
    const typedQty = parsedQuantity && parsedQuantity > 0 ? parsedQuantity : null;
    const typedUnit = parsedUnit && allowedUnits.includes(parsedUnit) ? parsedUnit : null;
    const useLast = typedQty == null && typedUnit == null && !!food.last_quantity && !!food.last_unit
      && allowedUnits.includes(food.last_unit);
    const unit = useLast ? (food.last_unit as string) : typedUnit ?? 'serving';
    const qty = useLast ? String(food.last_quantity) : typedQty != null ? String(typedQty) : '1';
    setQuantityInput(qty);
    setSelectedUnit(unit);
    setQuantityModalVisible(true);
  };

  // Confirm log with quantity.
  // Behavior change (round 2): empty catches used to close the modal whether
  // or not the save succeeded. Now the modal stays open on failure and shows
  // an Alert with the real error message. When the device is offline we queue
  // the log to AsyncStorage and close cleanly with a confirmation.
  const handleConfirmLog = async () => {
    if (!currentUser || !selectedFood || foodSaving) return;
    const qty = parseQuantityInput(quantityInput);
    if (qty == null) {
      Alert.alert('Quantity required', 'Enter a number greater than zero before logging this food.');
      return;
    }
    const multiplier = quantityMultiplier(selectedFood, qty, selectedUnit);
    const args = {
      food: selectedFood,
      date: selectedDate,
      mealType: activeMealType,
      multiplier,
      originalQuantity: qty,
      originalUnit: selectedUnit,
    };
    setFoodSaving(true);

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
      } catch (err) {
        console.error('LogScreen: enqueue failed', err);
        Alert.alert("Couldn't save food", errorMessage(err, 'Keep this portion open and try saving again.'));
      } finally {
        setFoodSaving(false);
      }
      return;
    }

    try {
      await submitSearchLogOnline(args);
      await loadDayData(currentUser.id, selectedDate);
      // Phase 11 / Track 3: success haptic on food logged
      HapticService.success();
      // Psych Report #4: Analytics — meal_logged (search flow)
      track(AnalyticsEvents.MEAL_LOGGED, { meal_type: activeMealType, source: 'search' });
      setQuantityModalVisible(false);
      setSelectedFood(null);
      setModalVisible(false);
      setSavedMessage(`${selectedFood.name} added to ${MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}.`);
    } catch (err) {
      console.error('LogScreen: handleConfirmLog failed', err);
      // Phase 11 / Track 3: error haptic on failed API action
      HapticService.error();
      Alert.alert("Couldn't log food", errorMessage(err, 'This food was not added. Check the connection and try again.'));
    } finally {
      setFoodSaving(false);
    }
  };

  const handleManualLog = async () => {
    if (foodSaving) return;
    if (!currentUser || !manualFields.foodName.trim() || !manualFields.calories) {
      Alert.alert('Missing Info', 'Enter at least a food name and calories.');
      return;
    }
    const args = { ...manualFields, date: selectedDate, mealType: activeMealType };
    setFoodSaving(true);

    if (!online) {
      try {
        const name = await submitManualLogOffline(args);
        setModalVisible(false);
        Alert.alert('Saved offline', `${name} will sync when you reconnect.`);
      } catch (err) {
        console.error('LogScreen: manual enqueue failed', err);
        Alert.alert("Couldn't save food", errorMessage(err, 'Keep these food details open and try saving again.'));
      } finally {
        setFoodSaving(false);
      }
      return;
    }

    try {
      await submitManualLogOnline(args);
      await loadDayData(currentUser.id, selectedDate);
      // Phase 11 / Track 3: success haptic on manual food logged
      HapticService.success();
      // Psych Report #4: Analytics — meal_logged (manual flow)
      track(AnalyticsEvents.MEAL_LOGGED, { meal_type: activeMealType, source: 'manual' });
      setModalVisible(false);
      setSavedMessage(`${manualFields.foodName.trim()} added to ${MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}.`);
    } catch (err) {
      console.error('LogScreen: handleManualLog failed', err);
      // Phase 11 / Track 3: error haptic on failed API action
      HapticService.error();
      Alert.alert("Couldn't log food", errorMessage(err, 'These food details were not added. Check the connection and try again.'));
    } finally {
      setFoodSaving(false);
    }
  };

  const mealLabel = (type: MealType) => MEAL_SECTIONS.find((s) => s.type === type)?.label ?? 'Meal';
  // Offered only while this meal is still empty on the selected day, so a
  // second open of Add Food cannot add the same meal twice by accident.
  const repeatMeal = foodLogs.some((f) => f.mealType === activeMealType)
    ? null
    : lastMeals[activeMealType] ?? null;
  const repeatMealDay = repeatMeal
    ? selectedDate === getTodayString() && repeatMeal.date === addDays(selectedDate, -1)
      ? 'yesterday'
      : new Date(`${repeatMeal.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
    : '';
  const repeatMealTitle = repeatMeal
    ? `Repeat ${repeatMealDay}'s ${mealLabel(activeMealType).toLowerCase()}`
    : '';

  // Logs every food of the most recent earlier meal in this slot with the
  // same saved portions, so a repeated breakfast is two taps.
  const handleRepeatMeal = async () => {
    if (!currentUser || !repeatMeal || foodSaving) return;
    if (!online) {
      Alert.alert(
        'Connection needed',
        'Repeating a past meal needs a connection. Search for a food or enter it manually to save it offline.',
      );
      return;
    }
    const target = mealLabel(activeMealType);
    setFoodSaving(true);
    try {
      const { added, failedNames } = await repeatPastMeal(repeatMeal, selectedDate, activeMealType);
      await loadDayData(currentUser.id, selectedDate);
      if (failedNames.length === 0) {
        HapticService.success();
        track(AnalyticsEvents.MEAL_LOGGED, { meal_type: activeMealType, source: 'repeat_meal' });
        setModalVisible(false);
        setSavedMessage(`${added} ${added === 1 ? 'food' : 'foods'} added to ${target}.`);
      } else {
        HapticService.error();
        Alert.alert(
          added > 0 ? 'Some foods were not added' : "Couldn't repeat this meal",
          `${added} of ${repeatMeal.entries.length} foods added to ${target}. Not added: ${failedNames.join(', ')}. Check the connection, then add ${failedNames.length === 1 ? 'it' : 'them'} from Recent.`,
        );
      }
    } finally {
      setFoodSaving(false);
    }
  };

  // F-2: open the inline edit modal for a logged entry, pre-filled with
  // whichever (originalQuantity, originalUnit) pair the backend sent back,
  // falling back to the multiplier when the row is a legacy one without
  // the original_* columns persisted.
  const handleEditFood = (log: FoodLog) => {
    setEditLog(log);
    const portion = initialEditPortion(log);
    setEditQty(String(portion.quantity));
    setEditUnit(portion.unit);
    setEditMealType(log.mealType);
  };

  const handleEditCancel = () => {
    if (editSaving) return;
    setEditLog(null);
    setEditQty('');
    setEditUnit('');
  };

  const handleEditSave = async () => {
    if (!editLog || !currentUser || editSaving) return;
    const parsed = parseQuantityInput(editQty);
    if (!parsed || parsed <= 0) {
      Alert.alert('Invalid quantity', 'Enter a number greater than zero.');
      return;
    }
    setEditSaving(true);
    try {
      const multiplier = editPortionMultiplier(editLog, parsed, editUnit);
      await logApi.updateEntry(editLog.id, {
        quantity_multiplier: multiplier,
        original_quantity: parsed,
        original_unit: editUnit,
        meal_type: editMealType,
      });
      setEditLog(null);
      setEditQty('');
      setEditUnit('');
      await loadDayData(currentUser.id, selectedDate);
    } catch (err) {
      console.error('LogScreen: handleEditSave failed', err);
      Alert.alert(
        "Couldn't update food",
        errorMessage(err, 'The entry was not changed. Keep this edit open and try again.'),
      );
    } finally {
      setEditSaving(false);
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
          // The row and the day's totals update at once; the reload below
          // brings the entry back if the server did not delete it.
          removeFoodLogLocally(log.id);
          try {
            await logApi.deleteEntry(log.id);
          } catch (err) {
            console.error('LogScreen: handleDeleteFood failed', err);
            Alert.alert("Couldn't remove food", errorMessage(err, `${log.foodName} is still in the log. Check the connection and try again.`));
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

  const remaining = macroTargets ? macroTargets.calories - dailyTotals.calories : null;

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
    handleSearch('');
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
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Food Log</Text>
        </View>

        <DaySelector selectedDate={selectedDate} onDateChange={handleDateChange} />

        {loadError ? (
          <CoachErrorState
            message={loadError}
            onRetry={() => void onRefresh()}
            retrying={isLoading || refreshing}
            testID="log-day-data-error"
          />
        ) : null}

        <DailySummaryBar dailyTotals={dailyTotals} remaining={remaining} targets={macroTargets} mode={macroMode} />
        {savedMessage ? (
          <Text style={styles.savedMessage} accessibilityLiveRegion="polite">{savedMessage}</Text>
        ) : null}

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
            onEditPress={handleEditFood}
            macroMode={macroMode}
          />
        ))}

        <View style={styles.waterSection}>
          <WaterTracker currentOz={waterOz} onAdd={handleAddWater} />
        </View>
      </ScrollView>

      <FoodSearchModal
        visible={modalVisible}
        activeMealType={activeMealType}
        onClose={() => { if (!foodSaving) setModalVisible(false); }}
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
        repeatMeal={repeatMeal}
        repeatMealTitle={repeatMealTitle}
        onRepeatMeal={handleRepeatMeal}
        manualMode={manualMode}
        onEnterManualMode={() => setManualMode(true)}
        onExitManualMode={() => setManualMode(false)}
        manualFields={manualFields}
        onManualFieldChange={onManualFieldChange}
        onManualLog={handleManualLog}
        saving={foodSaving}
      />

      <QuantityPickerModal
        visible={quantityModalVisible}
        selectedFood={selectedFood}
        quantityInput={quantityInput}
        selectedUnit={selectedUnit}
        onQuantityChange={setQuantityInput}
        onUnitChange={setSelectedUnit}
        onConfirm={handleConfirmLog}
        saving={foodSaving}
        onCancel={() => {
          setQuantityModalVisible(false);
          setSelectedFood(null);
        }}
      />

      {/* F-2: edit-log modal. Inline so it works on iOS + Android without
          relying on Alert.prompt (iOS-only). Saves through the existing
          logApi.updateEntry endpoint and triggers loadDayData on success. */}
      <Modal
        visible={!!editLog}
        animationType="fade"
        transparent
        onRequestClose={handleEditCancel}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.editModalBackdrop}
        >
          <ScrollView style={styles.editModalCard} contentContainerStyle={styles.editModalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.editModalTitle} numberOfLines={1}>
              {editLog?.foodName || 'Edit entry'}
            </Text>
            <Text style={styles.editModalSubtitle}>Quantity</Text>
            <TextInput
              accessibilityLabel="Edit quantity"
              value={editQty}
              onChangeText={setEditQty}
              keyboardType="decimal-pad"
              style={styles.editModalInput}
            />
            <Text style={styles.editModalSubtitle}>Unit</Text>
            <View style={styles.editUnitRow}>
              {(editLog ? editUnitsFor(editLog) : []).map((unit) => (
                <TouchableOpacity
                  key={unit}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit unit ${unit}`}
                  accessibilityState={{ selected: editUnit === unit }}
                  disabled={editSaving}
                  onPress={() => setEditUnit(unit)}
                  style={[styles.editModalBtn, editUnit === unit && { borderColor: colors.primary }]}
                >
                  <Text style={{ color: colors.textPrimary }}>{unit}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.editModalSubtitle}>Meal</Text>
            <View style={styles.editUnitRow}>
              {MEAL_SECTIONS.map((meal) => (
                <TouchableOpacity
                  key={meal.type}
                  accessibilityRole="button"
                  accessibilityState={{ selected: editMealType === meal.type }}
                  disabled={editSaving}
                  onPress={() => setEditMealType(meal.type)}
                  style={[styles.editModalBtn, editMealType === meal.type && { borderColor: colors.primary }]}
                >
                  <Text style={{ color: colors.textPrimary }}>{meal.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={editSaving}
              style={styles.deleteEntryButton}
              onPress={() => {
                if (editLog) { setEditLog(null); void handleDeleteFood(editLog); }
              }}
            >
              <Text style={{ color: colors.error }}>Delete entry</Text>
            </TouchableOpacity>
            <View style={styles.editModalActions}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel edit"
                disabled={editSaving}
                onPress={handleEditCancel}
                style={[
                  styles.editModalBtn,
                  { borderColor: colors.border, opacity: editSaving ? 0.5 : 1 },
                ]}
              >
                <Text style={{ color: colors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save edit"
                disabled={editSaving}
                onPress={handleEditSave}
                style={[
                  styles.editModalBtn,
                  styles.editModalBtnPrimary,
                  {
                    backgroundColor: colors.primary,
                    opacity: editSaving ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={{ color: colors.textOnPrimary }}>
                  {editSaving ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.dark,
  },
  waterSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: 20,
  },
  savedMessage: {
    marginHorizontal: Spacing.lg,
    marginBottom: 12,
    color: colors.primary,
    fontSize: 14,
  },
  editUnitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  deleteEntryButton: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
  editModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  editModalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  editModalContent: { padding: Spacing.lg },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  editModalSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
  },
  editModalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 16,
  },
  editModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  editModalBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editModalBtnPrimary: {
    borderColor: 'transparent',
  },

  });
