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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { MealType, FoodLog } from '../../types';
import { foodApi, logApi, type WaterEntry } from '../../services/api';
import { notifyPendingFoodLogs, syncFoodLogQueue } from '../../services/foodLogSync';
import { usePendingFoodLogCount } from '../../hooks/useFoodLogQueueSync';
import { useNetworkStatus, isEffectivelyOnline } from '../../hooks/useNetworkStatus';
import DaySelector from '../../components/DaySelector';
import WaterTracker from '../../components/WaterTracker';
import DailySummaryBar from '../../components/log/DailySummaryBar';
import MealSectionCard from '../../components/log/MealSectionCard';
import FoodSearchModal from '../../components/log/FoodSearchModal';
import { QuantityPickerContent } from '../../components/log/QuantityPickerModal';
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
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import { Screen, Headline, Overline, PrimaryButton, TextLink, QuietTextButton, useScreenInsets, footerBottomPadding } from '../../ui';
import HapticPressable from '../../components/HapticPressable';
import { errorMessage } from '../../types/common';
import { Skeleton } from '../../ui/skeletons/Skeleton';

export default function LogScreen() {
  const { semanticColors: colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useScreenInsets();
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
    waterEntries,
    hasLoadedDay,
    isLoading,
    loadError,
    setSelectedDate,
    loadDayData,
    logWater,
    removeWaterEntry,
    removeFoodLogLocally,
  } = useClientStore();

  const { recentFoods, frequentFoods, lastMeals, browseUnavailable, loadBrowseFoods } = useFoodBrowse(
    currentUser?.id,
    selectedDate,
  );
  const pendingFoods = usePendingFoodLogCount();

  const [modalVisible, setModalVisible] = useState(false);
  const [activeMealType, setActiveMealType] = useState<MealType>('breakfast');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentTab, setRecentTab] = useState<'recent' | 'frequent'>('recent');
  const [manualMode, setManualMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removingWaterId, setRemovingWaterId] = useState<string | null>(null);
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
  const [addedFoodName, setAddedFoodName] = useState<string | null>(null);

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
    setAddedFoodName(null);
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
    setAddedFoodName(null);
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
        void notifyPendingFoodLogs();
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
      setAddedFoodName(selectedFood.name);
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
      Alert.alert('Missing info', 'Enter at least a food name and calories.');
      return;
    }
    const args = { ...manualFields, date: selectedDate, mealType: activeMealType };
    setFoodSaving(true);

    if (!online) {
      try {
        const name = await submitManualLogOffline(args);
        void notifyPendingFoodLogs();
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
    Alert.alert('Delete food', `Remove ${log.foodName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setEditLog(null);
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

  const handleRemoveWater = (entry: WaterEntry) => {
    if (!currentUser || removingWaterId) return;
    Alert.alert('Remove water entry?', "This entry will be removed from this day's water total.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemovingWaterId(entry.id);
          try {
            await removeWaterEntry(entry.id);
          } catch {
            Alert.alert("Couldn't remove water", 'The water entry could not be removed. Check the connection and try again.');
          } finally {
            setRemovingWaterId(null);
          }
        },
      },
    ]);
  };

  const getMealLogs = (mealType: MealType) =>
    foodLogs.filter((f) => f.mealType === mealType);

  const getMealCalories = (mealType: MealType) =>
    getMealLogs(mealType).reduce((sum, f) => sum + f.calories, 0);

  const remaining = macroTargets ? macroTargets.calories - dailyTotals.calories : null;
  const showDayLoading = !hasLoadedDay && (isLoading || !loadError);

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    // Pull-to-refresh also sends foods saved offline (never rejects).
    if (online) await syncFoodLogQueue();
    await loadDayData(currentUser.id, selectedDate);
    setRefreshing(false);
  }, [currentUser?.id, selectedDate, online]);

  const clearSearch = () => {
    handleSearch('');
  };

  const onManualFieldChange = (field: keyof ManualFields, value: string) =>
    setManualFields((prev) => ({ ...prev, [field]: value }));

  const editUnits = editLog ? editUnitsFor(editLog) : [];

  return (
    <>
      <Screen
        edges={['top']}
        testID="log-screen"
        contentStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <Overline>Food log</Overline>
        <DaySelector selectedDate={selectedDate} onDateChange={handleDateChange} />

        {loadError ? (
          <View style={styles.errorBlock} testID="log-day-data-error" accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{loadError}</Text>
            <QuietTextButton
              label="Try again"
              disabled={isLoading || refreshing}
              onPress={() => void onRefresh()}
              testID="log-day-data-error-retry"
            />
          </View>
        ) : null}

        {hasLoadedDay ? <DailySummaryBar dailyTotals={dailyTotals} remaining={remaining} targets={macroTargets} mode={macroMode} /> : null}
        {pendingFoods > 0 ? (
          <Text style={styles.note} accessibilityLiveRegion="polite" testID="log-offline-pending">
            {pendingFoods === 1
              ? `1 food saved offline is not in this log or its totals yet. ${online ? 'Pull down to sync it now.' : 'It syncs when the connection returns.'}`
              : `${pendingFoods} foods saved offline are not in this log or its totals yet. ${online ? 'Pull down to sync them now.' : 'They sync when the connection returns.'}`}
          </Text>
        ) : null}
        {savedMessage ? (
          <Text style={[styles.note, styles.savedMessage]} accessibilityLiveRegion="polite">{savedMessage}</Text>
        ) : null}

        {showDayLoading ? (
          // Meal-shaped placeholders on the page gutter (no zero totals, no empty-meal claims).
          <View testID="log-day-loading" accessibilityLabel="Loading" accessibilityLiveRegion="polite">
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {MEAL_SECTIONS.map((section) => (
                <View key={section.type} style={styles.skeletonSection}>
                  <Skeleton width="38%" height={22} borderRadius={radius.control} />
                  <Skeleton width="72%" height={14} borderRadius={radius.control} />
                  <Skeleton width="48%" height={14} borderRadius={radius.control} />
                </View>
              ))}
            </View>
          </View>
        ) : (
          <>
            {hasLoadedDay && foodLogs.length === 0 ? (
              <Text style={styles.note}>No foods logged for this day. Add food to a meal below.</Text>
            ) : null}
            {foodLogs.length > 0 ? (
              <Text style={styles.note} testID="log-edit-hint">Tap a food to edit, move or delete it.</Text>
            ) : null}
            {MEAL_SECTIONS.map((section, i) => (
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
                tutorialTarget={i === 0}
              />
            ))}
            {hasLoadedDay ? (
              <WaterTracker
                currentOz={waterOz}
                onAdd={handleAddWater}
                entries={waterEntries}
                onRemove={handleRemoveWater}
                removingId={removingWaterId}
              />
            ) : null}
          </>
        )}
      </Screen>

      <FoodSearchModal
        visible={modalVisible}
        activeMealType={activeMealType}
        addedFoodName={addedFoodName}
        onClose={() => {
          if (!foodSaving) {
            if (quantityModalVisible) {
              setQuantityModalVisible(false);
              setSelectedFood(null);
            } else {
              setModalVisible(false);
            }
          }
        }}
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
        browseUnavailable={browseUnavailable}
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
        portionPicker={quantityModalVisible ? (
          <QuantityPickerContent
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
        ) : undefined}
      />

      {/* F-2: edit-log sheet. Inline so it works on iOS + Android without
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
          testID="log-edit-backdrop"
        >
          <ScrollView
            testID="log-edit-sheet"
            style={styles.editModalCard}
            contentContainerStyle={[styles.editModalContent, { paddingBottom: footerBottomPadding(insets.bottom) }]}
            keyboardShouldPersistTaps="handled"
          >
            <Overline>Edit entry</Overline>
            <Headline level="h2" numberOfLines={2} style={styles.editModalTitle}>
              {editLog?.foodName || 'Edit entry'}
            </Headline>
            <Overline style={styles.fieldLabel}>Quantity</Overline>
            <TextInput
              accessibilityLabel="Edit quantity"
              value={editQty}
              onChangeText={setEditQty}
              keyboardType="decimal-pad"
              style={styles.editModalInput}
            />
            <Overline style={styles.fieldLabel}>Unit</Overline>
            <View style={styles.chipRow}>
              {editUnits.map((unit) => (
                <HapticPressable
                  key={unit}
                  intent="light"
                  disableAnimation
                  accessibilityRole="button"
                  accessibilityLabel={`Edit unit ${unit}`}
                  accessibilityState={{ selected: editUnit === unit }}
                  disabled={editSaving}
                  onPress={() => setEditUnit(unit)}
                  style={[styles.chip, editUnit === unit && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, editUnit === unit && styles.chipTextSelected]}>{unit}</Text>
                </HapticPressable>
              ))}
            </View>
            <Overline style={styles.fieldLabel}>Meal</Overline>
            <View style={styles.chipRow}>
              {MEAL_SECTIONS.map((meal) => (
                <HapticPressable
                  key={meal.type}
                  intent="light"
                  disableAnimation
                  accessibilityRole="button"
                  accessibilityLabel={meal.label}
                  accessibilityState={{ selected: editMealType === meal.type }}
                  disabled={editSaving}
                  onPress={() => setEditMealType(meal.type)}
                  style={[styles.chip, editMealType === meal.type && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, editMealType === meal.type && styles.chipTextSelected]}>{meal.label}</Text>
                </HapticPressable>
              ))}
            </View>
            <PrimaryButton
              label="Save changes"
              loading={editSaving}
              onPress={handleEditSave}
              testID="log-edit-save"
              style={styles.editSave}
            />
            <View style={styles.editSecondary}>
              <TextLink label="Cancel" underline={false} disabled={editSaving} onPress={handleEditCancel} />
              <TextLink
                label="Delete entry"
                underline={false}
                disabled={editSaving}
                onPress={() => {
                  if (editLog) void handleDeleteFood(editLog);
                }}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  content: {
    paddingBottom: layout.sectionGap * 2,
  },
  note: {
    ...typography.bodySmall,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    marginBottom: 12,
  },
  savedMessage: {
    color: colors.accentText,
  },
  skeletonSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: layout.sectionPadY,
    marginBottom: layout.sectionPadY,
    gap: 12,
  },
  errorBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: layout.sectionPadY,
    marginBottom: layout.sectionGap,
  },
  errorText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: layout.touchMin,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipSelected: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  chipText: { ...typography.bodySmall, color: colors.textMuted },
  chipTextSelected: { fontFamily: typography.bodyMd.fontFamily, color: colors.accentText },
  editModalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  editModalCard: {
    width: '100%',
    maxHeight: '90%',
    flexGrow: 0,
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  editModalContent: { paddingHorizontal: layout.gutter, paddingTop: layout.gutter + 4 },
  editModalTitle: { marginTop: 4, marginBottom: 8 },
  fieldLabel: { marginTop: 20, marginBottom: 8 },
  editModalInput: {
    minHeight: layout.buttonHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.input,
    backgroundColor: colors.bgSurface,
    paddingHorizontal: 16,
    color: colors.textPrimary,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  editSave: { marginTop: 32 },
  editSecondary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  });
