import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  AppState,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { MealType, FoodLog } from '../../types';
import { foodApi, logApi } from '../../services/api';
import { notifyPendingFoodLogs, syncFoodLogQueue } from '../../services/foodLogSync';
import { usePendingFoodLogCount } from '../../hooks/useFoodLogQueueSync';
import { useNetworkStatus, isEffectivelyOnline } from '../../hooks/useNetworkStatus';
import DaySelector from '../../components/DaySelector';
import WaterTracker from '../../components/WaterTracker';
import DailySummaryBar from '../../components/log/DailySummaryBar';
import MealSectionCard from '../../components/log/MealSectionCard';
import FoodSearchModal from '../../components/log/FoodSearchModal';
import MealChoiceRow from '../../components/log/MealChoiceRow';
import { FoodDayGate } from '../../components/log/FoodDayView';
import { featureFlags } from '../../config/featureFlags';
import type { DaySlot } from '../../utils/log/foodDay';
import { QuantityPickerContent } from '../../components/log/QuantityPickerModal';
import { ManualFields } from '../../components/log/ManualFoodEntryForm';
import { useMacroTargets } from '../../hooks/useMacroTargets';
import { useMacroDisplayMode } from '../../macros/macroDisplayStore';
import { useFoodBrowse, type PastMeal } from '../../hooks/useFoodBrowse';
import { SearchResult, MEAL_SECTIONS, unitOptionsFor } from '../../utils/log/types';
import { quantityMultiplier, parseQuantityInput } from '../../utils/log/macros';
import { initialEditPortion, editUnitsFor, editPortionMultiplier } from '../../utils/log/editPortion';
import { mapFoodItem, type RawFoodItem } from '../../utils/log/mapFoodItem';
import { matchLoggedFoods, mergeWithLoggedMatches, queuePastMeal, repeatPastMeal } from '../../utils/log/quickLog';
import { dropQueued } from '../../services/foodLogQueue';
import { countsInDay, type ShownWaterEntry } from '../../utils/log/queuedDay';
import type { PlanLink } from '../../utils/log/planLink';
import { addDays, getTodayString } from '../../utils/date';
import { dayForNewLog } from '../../utils/logDay';
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

export default function LogScreen({ onSaved, suspended = false }: { onSaved?: () => void; suspended?: boolean }) {
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
    selectedOn,
    foodLogs,
    dailyTotals,
    waterOz,
    waterEntries,
    hasLoadedDay,
    isLoading,
    loadError,
    setSelectedDate,
    loadDayData,
    refreshShownDay,
    logWater,
    removeWaterEntry,
    removeFoodLogLocally,
    queuedFoods,
    queuedWaterWeight,
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
  // FOOD-DAY-STYLEC-M (C_portion, C2-S-33): "Log food" closes the add sheet; "Add another food" keeps it open.
  // 'classic' (switch off) is main's: open after an online save, closed after an offline one. FIX-930R1
  // (LS-930 B3): the online and offline saves both read this one choice, so Add another stays open offline too.
  const addSheetAfterLog = useRef<'close' | 'keep' | 'classic'>('classic');

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

  // FOOD-1-M R2: the day a new log goes to (utils/logDay). A Food tab left on today past midnight
  // moves to the new today, when the app comes back and again at the tap, before it takes the log.
  const takeLogDay = () => {
    const day = dayForNewLog({ selectedDate, selectedOn });
    if (day !== selectedDate && currentUser) {
      setSavedMessage(null);
      void loadDayData(currentUser.id, day);
    }
    return day;
  };
  const takeLogDayRef = useRef(takeLogDay);
  takeLogDayRef.current = takeLogDay;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') takeLogDayRef.current();
    });
    return () => sub.remove();
  }, []);

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

  // FOODLINK: what this sheet's foods are logged for (the Food tab's "Something else"); every open resets it.
  const [sheetLink, setSheetLink] = useState<PlanLink | undefined>(undefined);
  // UI-3d: only the Food tab's Extras "Add" (no link) lets the client switch the meal in the sheet.
  const [mealChoice, setMealChoice] = useState(false);
  // FIX-930R2 (LS-930R2 B2): `manual` opens the same sheet on its manual entry form (the first day's Enter manually);
  // its Back still returns to search, and every other open starts on search.
  const openAddFood = useCallback(async (mealType: MealType, link?: PlanLink, choose = false, manual = false) => {
    setSheetLink(link);
    setMealChoice(choose);
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
    setManualMode(manual);
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
    // OFFLINE-FOOD-M: no signal, no search: say so at once (the same words as a failed search) and
    // keep the matches from the foods kept on this phone.
    if (!online) {
      setSearching(false);
      setSearchError('Search unavailable. Check your connection.');
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
    const day = takeLogDay();
    const args = {
      food: selectedFood,
      date: day,
      mealType: activeMealType,
      multiplier,
      originalQuantity: qty,
      originalUnit: selectedUnit,
      link: sheetLink,
    };
    setFoodSaving(true);

    if (!online) {
      try {
        await submitSearchLogOffline(args);
        void notifyPendingFoodLogs();
        setQuantityModalVisible(false);
        setSelectedFood(null);
        if (addSheetAfterLog.current !== 'keep') setModalVisible(false);
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
      await refreshShownDay(currentUser.id, day);
      // Phase 11 / Track 3: success haptic on food logged
      HapticService.success();
      // Psych Report #4: Analytics — meal_logged (search flow)
      track(AnalyticsEvents.MEAL_LOGGED, { meal_type: activeMealType, source: 'search' });
      setQuantityModalVisible(false);
      setSelectedFood(null);
      setAddedFoodName(selectedFood.name);
      setSavedMessage(`${selectedFood.name} added to ${MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}.`);
      onSaved?.();
      if (addSheetAfterLog.current === 'close') setModalVisible(false);
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
    const day = takeLogDay();
    const args = { ...manualFields, date: day, mealType: activeMealType, link: sheetLink };
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
      await refreshShownDay(currentUser.id, day);
      // Phase 11 / Track 3: success haptic on manual food logged
      HapticService.success();
      // Psych Report #4: Analytics — meal_logged (manual flow)
      track(AnalyticsEvents.MEAL_LOGGED, { meal_type: activeMealType, source: 'manual' });
      setModalVisible(false);
      setSavedMessage(`${manualFields.foodName.trim()} added to ${MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}.`);
      onSaved?.();
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
  // FIX-931R2 (LS-931R2B B3): a refused food (shown, in no total) leaves the meal empty for Repeat.
  const repeatMeal = foodLogs.some((f) => f.mealType === activeMealType && countsInDay(f))
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
  // same saved portions, so a repeated breakfast is two taps. The usual day
  // (UI-3) repeats its usual meal through the same path.
  const repeatMealTo = async (meal: PastMeal | null, mealType: MealType, link?: PlanLink) => {
    if (!currentUser || !meal || foodSaving) return;
    const target = mealLabel(mealType);
    const day = takeLogDay();
    // OFFLINE-FOOD-M: no signal: each food goes to the offline queue with its own key.
    if (!online) {
      setFoodSaving(true);
      let queued = 0;
      try {
        queued = await queuePastMeal(meal, day, mealType, link);
        HapticService.success();
        setModalVisible(false);
        Alert.alert(
          'Saved offline',
          `${queued === 1 ? meal.entries[0].name : `${queued} foods`} will sync when you reconnect.`,
        );
        onSaved?.();
      } catch (err) {
        console.error('LogScreen: repeat enqueue failed', err);
        HapticService.error();
        Alert.alert(
          queued > 0 ? 'Some foods were not added' : "Couldn't repeat this meal",
          `${queued} of ${meal.entries.length} foods added to ${target}. Not added: ${meal.entries.slice(queued).map((e) => e.name).join(', ')}. Check the connection, then add ${meal.entries.length - queued === 1 ? 'it' : 'them'} from Recent.`,
        );
      } finally {
        void notifyPendingFoodLogs();
        setFoodSaving(false);
      }
      return;
    }
    setFoodSaving(true);
    try {
      const { added, failedNames } = await repeatPastMeal(meal, day, mealType, link);
      await refreshShownDay(currentUser.id, day);
      if (failedNames.length === 0) {
        HapticService.success();
        track(AnalyticsEvents.MEAL_LOGGED, { meal_type: mealType, source: 'repeat_meal' });
        setModalVisible(false);
        setSavedMessage(`${added} ${added === 1 ? 'food' : 'foods'} added to ${target}.`);
        onSaved?.();
      } else {
        HapticService.error();
        Alert.alert(
          added > 0 ? 'Some foods were not added' : "Couldn't repeat this meal",
          `${added} of ${meal.entries.length} foods added to ${target}. Not added: ${failedNames.join(', ')}. Check the connection, then add ${failedNames.length === 1 ? 'it' : 'them'} from Recent.`,
        );
      }
    } finally {
      setFoodSaving(false);
    }
  };
  const handleRepeatMeal = () => repeatMealTo(repeatMeal, activeMealType, sheetLink);

  // UI-3 "Ate it as planned": one tap logs the plan meal with LogPlannedMealButton's write (offline queue included).
  const logPlanned = async (slot: DaySlot) => {
    if (!currentUser || foodSaving) return;
    const v = (x: number) => String(Math.round(x * 10) / 10);
    const day = takeLogDay();
    const args = {
      foodName: slot.name, calories: v(slot.kcal), protein: v(slot.protein), carbs: v(slot.carbs), fat: v(slot.fat),
      quantity: '1', unit: 'serving', date: day, mealType: slot.mealType, link: { planSlotId: slot.key },
    };
    setFoodSaving(true);
    try {
      if (!online) {
        const name = await submitManualLogOffline(args);
        void notifyPendingFoodLogs();
        HapticService.success();
        Alert.alert('Saved offline', `${name} will sync when you reconnect.`);
        return;
      }
      await submitManualLogOnline(args);
      await refreshShownDay(currentUser.id, day);
      HapticService.success();
      track(AnalyticsEvents.MEAL_LOGGED, { meal_type: slot.mealType, source: 'meal_plan' });
      setSavedMessage(`${slot.name} added to ${mealLabel(slot.mealType)}.`);
      onSaved?.();
    } catch (err) {
      console.error('LogScreen: plan meal log failed', err);
      HapticService.error();
      Alert.alert("Couldn't log food", errorMessage(err, 'This food was not added. Check the connection and try again.'));
    } finally {
      setFoodSaving(false);
    }
  };

  // F-2: open the inline edit modal for a logged entry, pre-filled with
  // whichever (originalQuantity, originalUnit) pair the backend sent back,
  // falling back to the multiplier when the row is a legacy one without
  // the original_* columns persisted.
  const handleEditFood = (log: FoodLog) => {
    // OFFLINE-FOOD-M: a food saved offline is not on the server yet; its one action is Remove.
    if (log.offline) {
      handleDeleteFood(log);
      return;
    }
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
      await refreshShownDay(currentUser.id, selectedDate);
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
          // OFFLINE-FOOD-M: a food saved offline (waiting or refused) leaves this phone's queue.
          if (log.offline) {
            removeFoodLogLocally(log.id);
            await dropQueued(log.id).catch((err) => console.error('LogScreen: drop queued food failed', err));
            void notifyPendingFoodLogs();
            return;
          }
          // The row and the day's totals update at once; the reload below
          // brings the entry back if the server did not delete it.
          removeFoodLogLocally(log.id);
          try {
            await logApi.deleteEntry(log.id);
          } catch (err) {
            console.error('LogScreen: handleDeleteFood failed', err);
            Alert.alert("Couldn't remove food", errorMessage(err, `${log.foodName} is still in the log. Check the connection and try again.`));
          }
          refreshShownDay(currentUser.id, selectedDate);
        },
      },
    ]);
  };

  const handleAddWater = (oz: number) => {
    if (currentUser) {
      // OFFLINE-WATER-WEIGHT-M: with no signal the glass waits in the phone's queue (the send decision food uses).
      if (online) logWater(currentUser.id, '', oz);
      else logWater(currentUser.id, '', oz, false);
    }
  };

  const handleRemoveWater = (entry: ShownWaterEntry) => {
    if (!currentUser || removingWaterId) return;
    // OFFLINE-WATER-WEIGHT-M: a glass saved offline is only on this phone; Remove takes it off with no server call.
    Alert.alert('Remove water entry?', entry.offline ? 'This entry will be removed from this phone.' : "This entry will be removed from this day's water total.", [
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

  // OFFLINE-FOOD-M: a food the server refused shows, marked, and is in no total.
  const getMealCalories = (mealType: MealType) =>
    getMealLogs(mealType).filter(countsInDay).reduce((sum, f) => sum + f.calories, 0);
  // OFFLINE-FOOD-M: waiting foods already in this day's list and totals, and the rest (another day,
  // a day not read yet, or a food queued by an older build with no name kept).
  const queuedIds = new Set((queuedFoods ?? []).filter((q) => !q.parkedAt).map((q) => q.id));
  const pendingInDay = featureFlags.offlineFoodInDay
    ? foodLogs.filter((f) => f.offline === 'waiting' && queuedIds.has(f.id)).length
    : 0;
  const pendingElsewhere = Math.max(0, pendingFoods - pendingInDay);
  // OFFLINE-WATER-WEIGHT-M (M6): glasses saved offline that this day's water total does not count (the switch off, or
  // another day, or a day not read yet) get the same note as foods (C2-S-17).
  const waterShownIds = new Set((waterEntries ?? []).map((e) => e.id));
  const waterElsewhere = (queuedWaterWeight ?? []).filter((q) => q.kind === 'water' && !q.parkedAt && !waterShownIds.has(q.id)).length;

  const remaining = macroTargets ? macroTargets.calories - dailyTotals.calories : null;
  const showDayLoading = !hasLoadedDay && (isLoading || !loadError);
  // UI-3 / FOOD-DAY-STYLEC-M: behind featureFlags.foodPlanChecklist the day shows as the C2 Style C coach's page.
  const styleCDay = featureFlags.foodPlanChecklist && !!currentUser;

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    // Pull-to-refresh also sends foods saved offline (never rejects).
    if (online) await syncFoodLogQueue();
    await refreshShownDay(currentUser.id, selectedDate);
    setRefreshing(false);
  }, [currentUser?.id, selectedDate, online]);

  const clearSearch = () => {
    handleSearch('');
  };

  const onManualFieldChange = (field: keyof ManualFields, value: string) =>
    setManualFields((prev) => ({ ...prev, [field]: value }));

  const editUnits = editLog ? editUnitsFor(editLog) : [];

  const notesNode = (
    <>
      {pendingElsewhere > 0 ? (
        <Text style={styles.note} accessibilityLiveRegion="polite" testID="log-offline-pending">
          {pendingElsewhere === 1
            ? `1 food saved offline is not in this log or its totals yet. ${online ? 'Pull down to sync it now.' : 'It syncs when the connection returns.'}`
            : `${pendingElsewhere} foods saved offline are not in this log or its totals yet. ${online ? 'Pull down to sync them now.' : 'They sync when the connection returns.'}`}
        </Text>
      ) : pendingInDay > 0 ? (
        // OFFLINE-FOOD-M W1 (proposed words, behind featureFlags.offlineFoodInDay; waits on the owner).
        <Text style={styles.note} accessibilityLiveRegion="polite" testID="log-offline-pending-in-day">
          {pendingInDay === 1
            ? `1 food saved offline is in this log and its totals. ${online ? 'Pull down to sync it now.' : 'It syncs when the connection returns.'}`
            : `${pendingInDay} foods saved offline are in this log and its totals. ${online ? 'Pull down to sync them now.' : 'They sync when the connection returns.'}`}
        </Text>
      ) : null}
      {waterElsewhere > 0 ? (
        <Text style={styles.note} accessibilityLiveRegion="polite" testID="log-offline-pending-water">
          {waterElsewhere === 1
            ? `1 water entry saved offline is not in this log or its totals yet. ${online ? 'Pull down to sync it now.' : 'It syncs when the connection returns.'}`
            : `${waterElsewhere} water entries saved offline are not in this log or its totals yet. ${online ? 'Pull down to sync them now.' : 'They sync when the connection returns.'}`}
        </Text>
      ) : null}
      {savedMessage ? (
        <Text style={[styles.note, styles.savedMessage]} accessibilityLiveRegion="polite">{savedMessage}</Text>
      ) : null}
    </>
  );
  const waterNode = (
    <WaterTracker
      currentOz={waterOz}
      onAdd={handleAddWater}
      entries={waterEntries}
      onRemove={handleRemoveWater}
      removingId={removingWaterId}
    />
  );

  return (
    <>
      <Screen
        // FOOD-DAY-STYLEC-M: the Style C day's forest masthead runs to the top edge and owns the top inset.
        edges={styleCDay ? [] : ['top']}
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
        {/* UI-3: behind featureFlags.foodPlanChecklist the day's plan checklist shows first; with no plan, this Food log. */}
        <FoodDayGate
          on={styleCDay}
          coached={!!currentUser?.coach_id}
          selectedDate={selectedDate}
          foodLogs={foodLogs}
          eaten={{ calories: dailyTotals.calories, protein: dailyTotals.protein }}
          targets={macroTargets ? { calories: macroTargets.calories, protein: macroTargets.protein } : null}
          ready={hasLoadedDay && !loadError}
          dayLoading={showDayLoading}
          saving={foodSaving}
          notes={notesNode}
          water={waterNode}
          onDateChange={handleDateChange}
          onLogPlanned={(slot) => void logPlanned(slot)}
          onRepeat={(slot) => void repeatMealTo(slot.usual?.meal ?? null, slot.mealType, { fillsUsualMeal: true })}
          onSomethingElse={(meal, link, manual) => void openAddFood(meal, link, !link, manual)}
          onEditFood={handleEditFood}
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
        {notesNode}

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
            {hasLoadedDay ? waterNode : null}
          </>
        )}
        </FoodDayGate>
      </Screen>

      <FoodSearchModal
        visible={modalVisible && !suspended}
        activeMealType={activeMealType}
        onMealChange={mealChoice ? setActiveMealType : undefined}
        // REFINE-968 (ruling 3): "Add at {time}" only when a save now files under today, by the save's own day rule.
        savesToday={() => dayForNewLog({ selectedDate, selectedOn }) === getTodayString()}
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
            mealLabel={MEAL_SECTIONS.find((s) => s.type === activeMealType)?.label}
            selectedFood={selectedFood}
            quantityInput={quantityInput}
            selectedUnit={selectedUnit}
            onQuantityChange={setQuantityInput}
            onUnitChange={setSelectedUnit}
            onConfirm={() => { addSheetAfterLog.current = styleCDay ? 'close' : 'classic'; void handleConfirmLog(); }}
            saving={foodSaving}
            dayLeft={styleCDay && macroTargets && macroTargets.calories > 0
              ? { kcal: macroTargets.calories - dailyTotals.calories, protein: macroTargets.protein - dailyTotals.protein } : undefined}
            onAddAnother={styleCDay ? () => { addSheetAfterLog.current = 'keep'; void handleConfirmLog(); } : undefined}
            onCancel={() => {
              setQuantityModalVisible(false);
              setSelectedFood(null);
            }}
          />
        ) : undefined}
      />

      {/* F-2: edit-log sheet. Inline so it works on iOS + Android without
          relying on Alert.prompt (iOS-only). Saves through the existing
          logApi.updateEntry endpoint and triggers refreshShownDay on success. */}
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
            <MealChoiceRow testID="log-edit-meals" value={editMealType} onChange={setEditMealType} disabled={editSaving} />
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
