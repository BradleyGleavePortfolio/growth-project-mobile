/**
 * ALL-ON-GREEN-M (R1, R3): the switch-on proof of LogScreen.foodJourney.test.tsx. That file pins
 * featureFlags.foodPlanChecklist off and proves the classic Food log's journey; this file pins it on and proves the
 * same saved data from the Style C day (FoodDayView's first day, C_first): the portion typed in the search is the
 * one saved, to the day shown; an edit saves the new portion; delete removes the entry; Repeat from the add sheet
 * saves yesterday's portion; two foods go in without reopening ("Add another food" keeps the sheet, "Log food"
 * closes it, C2-S-33); a food entered by hand is refused with no name, kept after a failed save and then saved
 * once, with its grams, to the day and meal shown; water goes to the day; and the first meal hands off to the
 * first-meal note once. Real
 * screen, store and portion math; only the network is mocked. The failure path is proven on the Style C day by
 * LogScreen.saveFailure.goal930.test.tsx (the card in the sheet, the portion kept, the same key once more).
 */
import React from 'react';
import { Alert, Platform, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import LogScreen from '../LogScreen';
import { foodApi, logApi, waterApi } from '../../../services/api';
import { useClientStore } from '../../../store/clientStore';
import type { MealType } from '../../../types';
import Day1WinScreen from '../Day1WinScreen';
import { firstWinApi } from '../../../services/firstWinApi';
import { addDays, getTodayString } from '../../../utils/date';

// A fixed clock, never the real date (FIX-930R2 LO-930R2 B1 class). Only Date is faked (and keeps ticking).
jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

const mockUser: { id: string; coach_id?: string } = { id: 'client' };
jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/firstWinApi', () => ({
  firstWinApi: { complete: jest.fn() },
}));
jest.mock('../../../lib/packagePromptGate', () => ({ shouldOfferPackagePrompt: async () => false }));
jest.mock('../../../components/PackageSelectionSheet', () => () => null);
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({}), isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../services/foodLogSync', () => ({
  syncFoodLogQueue: jest.fn(), notifyPendingFoodLogs: jest.fn(),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  // The Style C day's own reads: a coached client's plan for the day (none, so the first day shows), the coach's
  // name, and the day's workout from Train (none).
  default: { get: jest.fn(async (url: string) => ({
    data: url.startsWith('/me/meal-plan') ? { assignments: [] } : url === '/v1/clients/me/coach' ? { name: 'Coach' } : { items: [], nextCursor: null },
  })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn() },
  waterApi: { getDaily: jest.fn(), log: jest.fn() },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const mockDate = getTodayString();
const mockYesterday = addDays(mockDate, -1);
const mockFood = {
  id: 'oats', name: 'Rolled oats', calories: 379, protein_g: 13, carbs_g: 68, fat_g: 6.5,
  serving_size_grams: 40, nutrient_basis: 'PER_100G' as const, supports_volume_units: false,
};
const mockBanana = { ...mockFood, id: 'banana', name: 'Banana', calories: 89 };
interface Entry {
  id: string;
  food_item_id: string;
  user_id: string;
  meal_type: MealType;
  quantity_multiplier: number;
  original_quantity?: number;
  original_unit?: string;
  food_item: typeof mockFood;
}
// Yesterday's breakfast, one day only: the add sheet's Repeat card offers it, and no meal is "usual" (two days,
// foodDay.ts:177-178), so today draws the Style C first day.
const mockPastEntry: Entry = {
  id: 'past', food_item_id: 'oats', user_id: 'client', meal_type: 'breakfast',
  quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', food_item: mockFood,
};
let mockEntries: Entry[] = [];
const ok: AxiosResponse = {
  data: {}, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete mockUser.coach_id;
  mockEntries = [];
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(mockDate);
  jest.mocked(waterApi.getDaily).mockResolvedValue({ ...ok, data: { total_ml: 0 } });
  jest.mocked(waterApi.log).mockResolvedValue(ok);
  jest.mocked(foodApi.create).mockResolvedValue({ ...ok, data: { id: 'manual' } });
  jest.mocked(foodApi.search).mockResolvedValue({
    ...ok, data: { results: [mockFood], parsed_quantity: 60, parsed_unit: 'g' },
  });
  jest.mocked(logApi.getDaily).mockImplementation(async (date) => {
    const entries = date === mockDate ? mockEntries : date === mockYesterday ? [mockPastEntry] : [];
    const total = (key: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') =>
      entries.reduce((sum, e) => sum + e.food_item[key] * e.quantity_multiplier, 0);
    return { ...ok, data: {
      entries, total_calories: total('calories'), total_protein_g: total('protein_g'),
      total_carbs_g: total('carbs_g'), total_fat_g: total('fat_g'),
    } };
  });
  jest.mocked(logApi.logFood).mockImplementation(async (data) => {
    mockEntries.push({
      id: 'entry', food_item_id: String(data.food_item_id), user_id: 'client',
      meal_type: data.meal_type as MealType, quantity_multiplier: data.quantity_multiplier ?? 1,
      original_quantity: data.original_quantity, original_unit: data.original_unit,
      food_item: data.food_item_id === 'banana' ? mockBanana : mockFood,
    });
    return ok;
  });
  jest.mocked(logApi.updateEntry).mockImplementation(async (id, data) => {
    mockEntries = mockEntries.map((e) => e.id === id ? { ...e, ...data } : e);
    return ok;
  });
  jest.mocked(logApi.deleteEntry).mockImplementation(async (id) => {
    mockEntries = mockEntries.filter((e) => e.id !== id);
    return ok;
  });
});

afterEach(() => jest.restoreAllMocks());

const withQuery = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
/** A C_first meal row: nothing logged opens the add sheet on that meal; one food opens its edit sheet. */
const mealRow = async (meal: 'breakfast' | 'lunch' | 'dinner') => screen.findByTestId(`food-day-first-${meal}`);

describe.each(['ios', 'android'] as const)('%s client food journey on the Style C day (real screen, store and portion math)', (os) => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', os));

  it.each(['coachless', 'coached'])(
    '%s first meal resumes the same search and success feedback, with no second note', async (client) => {
      if (client === 'coached') mockUser.coach_id = 'coach';
      jest.mocked(foodApi.search).mockResolvedValue({ ...ok, data: { results: [mockFood, mockBanana] } });
      jest.mocked(firstWinApi.complete).mockResolvedValue({
        ...ok, data: { completedAt: '2026-10-14', aiMessage: `Server note for ${client}.` },
      });
      function SavedMeal() {
        const consumed = React.useRef(false);
        const [noteVisible, setNoteVisible] = React.useState(false);
        return <View>
          <View style={{ display: noteVisible ? 'none' : 'flex' }}>
            <LogScreen suspended={noteVisible} onSaved={() => {
              if (consumed.current) return;
              consumed.current = true;
              setNoteVisible(true);
            }} />
          </View>
          {noteVisible ? <Day1WinScreen savedWin="first_meal" onComplete={() => setNoteVisible(false)} /> : null}
        </View>;
      }
      await render(withQuery(<SavedMeal />));
      expect(firstWinApi.complete).not.toHaveBeenCalled();
      await fireEvent.press(await mealRow('dinner'));
      await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'foods');
      await fireEvent.press(await screen.findByText('Banana'));
      // "Add another food" logs and keeps the add sheet (C2-S-33); the first save hands off to the note.
      await fireEvent.press(screen.getByTestId('quantity-add-another'));
      expect(await screen.findByText(`Server note for ${client}.`)).toBeTruthy();
      expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
      expect(firstWinApi.complete).toHaveBeenCalledTimes(1);
      expect(firstWinApi.complete).toHaveBeenCalledWith('first_meal');
      await fireEvent.press(screen.getByTestId('day1win-continue-button'));
      expect(await screen.findByText('Added Banana.')).toBeTruthy();
      expect(screen.getByTestId('food-search-meal')).toHaveTextContent('Dinner');
      expect(screen.getByPlaceholderText('Search foods...').props.value).toBe('foods');
      await fireEvent.press(screen.getByText('Rolled oats'));
      await fireEvent.press(screen.getByTestId('quantity-log-food'));
      await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(2));
      expect(mockEntries.map((e) => e.meal_type)).toEqual(['dinner', 'dinner']);
      expect(firstWinApi.complete).toHaveBeenCalledTimes(1);
      // "Log food" closes the add sheet on the Style C day; the day says where the food went.
      expect(await screen.findByText('Rolled oats added to Dinner.')).toBeTruthy();
      expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    },
  );

  it('searches, picks a portion in one sheet, steps back, adds, edits, deletes and repeats', async () => {
    const onSaved = jest.fn();
    await render(withQuery(<LogScreen onSaved={onSaved} />));
    await fireEvent.press(await mealRow('breakfast'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), '60 g oats');
    await waitFor(() => expect(foodApi.search).toHaveBeenCalledWith('60 g oats', 50));
    await fireEvent.press(await screen.findByText('Rolled oats'));
    expect(screen.getByLabelText('Food quantity').props.value).toBe('60');
    expect(screen.getByLabelText('Portion unit g').props.accessibilityState.selected).toBe(true);
    // A single native sheet replaces search with the portion picker; the sheet's close steps back to the search.
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Search foods...').props.value).toBe('60 g oats');
    expect(screen.queryByLabelText('Food quantity')).toBeNull();
    await fireEvent.press(screen.getByText('Rolled oats'));
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(1));
    expect(logApi.logFood).toHaveBeenCalledWith({
      food_item_id: 'oats', date: mockDate, meal_type: 'breakfast',
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', client_uuid: expect.stringMatching(/^pfl_/),
    });
    expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(227.4);
    expect(await screen.findByText('Rolled oats added to Breakfast.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);

    // The Breakfast row now holds one food: a tap opens its edit sheet.
    await fireEvent.press(await screen.findByLabelText('Breakfast. Rolled oats'));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit unit oz' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit unit g' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Lunch' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Breakfast' }));
    await fireEvent.changeText(screen.getByLabelText('Edit quantity'), '80');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(303.2));
    expect(logApi.updateEntry).toHaveBeenCalledWith('entry', {
      quantity_multiplier: 0.8, original_quantity: 80, original_unit: 'g', meal_type: 'breakfast',
    });
    await fireEvent.press(await screen.findByLabelText('Breakfast. Rolled oats'));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(await screen.findByLabelText('Breakfast. Rolled oats'));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry' }));
    expect(alert).toHaveBeenCalledWith('Delete food', 'Remove Rolled oats?', expect.any(Array));
    expect(logApi.deleteEntry).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2];
    await act(async () => buttons?.find((button) => button.text === 'Delete')?.onPress?.());
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(0));
    expect(logApi.deleteEntry).toHaveBeenCalledWith('entry');
    expect(useClientStore.getState().dailyTotals.calories).toBe(0);
    alert.mockRestore();

    await fireEvent.press(await mealRow('breakfast'));
    await fireEvent.press(await screen.findByRole('button', { name: /Repeat .*breakfast: add all 1 food/ }));
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(1));
    expect(logApi.logFood).toHaveBeenLastCalledWith({
      date: mockDate, meal_type: 'breakfast', food_item_id: 'oats',
      quantity_multiplier: 0.6, original_quantity: 60, original_unit: 'g', client_uuid: expect.stringMatching(/^pfl_/),
    });
    expect(useClientStore.getState().dailyTotals.calories).toBeCloseTo(227.4);
    expect(await screen.findByText('1 food added to Breakfast.')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('adds two foods without reopening, updates totals and closes with Log food', async () => {
    jest.mocked(foodApi.search).mockResolvedValue({ ...ok, data: { results: [mockFood, mockBanana] } });
    await render(withQuery(<LogScreen />));
    await fireEvent.press(await mealRow('breakfast'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'foods');
    await fireEvent.press(await screen.findByText('Banana'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Portion unit g' }));
    await fireEvent.changeText(screen.getByLabelText('Food quantity'), '100');
    await fireEvent.press(screen.getByTestId('quantity-add-another'));
    expect(await screen.findByText('Added Banana.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search foods...').props.value).toBe('foods');
    expect(useClientStore.getState().dailyTotals.calories).toBe(89);
    await fireEvent.press(screen.getByText('Rolled oats'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Portion unit g' }));
    await fireEvent.changeText(screen.getByLabelText('Food quantity'), '100');
    await fireEvent.press(screen.getByTestId('quantity-log-food'));
    await waitFor(() => expect(useClientStore.getState().foodLogs).toHaveLength(2));
    expect(useClientStore.getState().dailyTotals.calories).toBe(468);
    expect(logApi.logFood).toHaveBeenCalledTimes(2);
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
    await fireEvent.press(await mealRow('lunch'));
    expect(screen.queryByText('Added Rolled oats.')).toBeNull();
  });

  it('keeps browse tabs, retry, suggestions, clear, manual entry and close', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onSaved = jest.fn();
    await render(withQuery(<LogScreen onSaved={onSaved} />));
    await fireEvent.press(await mealRow('breakfast'));
    await fireEvent.press(screen.getByText('Frequent'));
    expect(screen.getByRole('tab', { name: 'Frequent' }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByText('Recent'));
    expect(screen.getByRole('tab', { name: 'Recent' }).props.accessibilityState.selected).toBe(true);
    jest.mocked(foodApi.search).mockRejectedValueOnce(new Error('Network Error'));
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'fruit');
    await fireEvent.press(await screen.findByText(/^(Retry Search|Try again)$/));
    await waitFor(() => expect(foodApi.search).toHaveBeenCalledTimes(2));
    await fireEvent.press(screen.getByLabelText('Clear food search'));
    jest.mocked(foodApi.search).mockResolvedValueOnce({ ...ok, data: { results: [], suggestions: [mockBanana] } });
    await fireEvent.changeText(screen.getByPlaceholderText('Search foods...'), 'bananna');
    await fireEvent.press(await screen.findByText('Banana'));
    // The Style C portion sheet has no Cancel (Add another food takes its place, QuantityPickerModal.tsx:213-217):
    // the sheet's close steps back to the search.
    expect(screen.getByLabelText('Food quantity')).toBeTruthy();
    await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    expect(screen.queryByLabelText('Food quantity')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Clear food search'));
    await fireEvent.press(screen.getByText('Quick add'));
    for (const input of screen.getAllByPlaceholderText('0')) await fireEvent.changeText(input, '0');
    await fireEvent.press(screen.getByText('Log food'));
    expect(alert).toHaveBeenCalledWith('Missing info', 'Enter at least a food name and calories.');
    expect(logApi.logFood).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText('Food name'), 'Lunch label');
    await fireEvent.changeText(screen.getByPlaceholderText('1'), '2');
    await fireEvent.changeText(screen.getByPlaceholderText('serving'), 'g');
    jest.mocked(logApi.logFood).mockRejectedValueOnce(new Error('Network Error'));
    await fireEvent.press(screen.getByText('Log food'));
    expect(onSaved).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Log food'));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lunch label', serving_size_grams: 2 }));
    // The food entered by hand goes to the day shown and the meal tapped, at the portion typed.
    expect(logApi.logFood).toHaveBeenLastCalledWith(expect.objectContaining({
      food_item_id: 'manual', date: mockDate, meal_type: 'breakfast', original_quantity: 2, original_unit: 'g',
    }));
    await fireEvent.press(await mealRow('lunch'));
    await fireEvent.press(screen.getByText('Quick add'));
    await fireEvent.press(screen.getByText('Back to search'));
    await fireEvent.press(screen.getByRole('button', { name: 'Close food search' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText('Search foods...')).toBeNull();
  });

  it('keeps day selection, water, refresh and every meal entry point', async () => {
    await render(withQuery(<LogScreen />));
    await mealRow('breakfast');
    await fireEvent.press(screen.getByLabelText('Previous day'));
    expect(useClientStore.getState().selectedDate).toBe(mockYesterday);
    await fireEvent.press(await screen.findByLabelText(/tap to go to today/));
    expect(useClientStore.getState().selectedDate).toBe(mockDate);
    await fireEvent.press(await screen.findByLabelText('Next day'));
    expect(useClientStore.getState().selectedDate).toBe(addDays(mockDate, 1));
    await fireEvent.press(await screen.findByLabelText('Previous day'));
    expect(useClientStore.getState().selectedDate).toBe(mockDate);
    await mealRow('breakfast');
    for (const oz of [8, 12, 16]) await fireEvent.press(screen.getByLabelText(`Add ${oz} ounces of water`));
    expect(waterApi.log).toHaveBeenCalledTimes(3);
    for (const [call] of jest.mocked(waterApi.log).mock.calls) expect(call).toMatchObject({ date: mockDate });
    expect(useClientStore.getState().waterOz).toBe(36);
    const reads = jest.mocked(logApi.getDaily).mock.calls.length;
    let scroll = screen.getByTestId('food-day').parent;
    while (scroll && !scroll.props.refreshControl) scroll = scroll.parent;
    expect(scroll?.props.refreshControl).toBeTruthy();
    await act(async () => scroll?.props.refreshControl.props.onRefresh());
    expect(jest.mocked(logApi.getDaily).mock.calls.length).toBeGreaterThan(reads);
    for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
      await fireEvent.press(await mealRow(meal));
      expect(screen.getByTestId('food-search-meal')).toHaveTextContent(meal[0].toUpperCase() + meal.slice(1));
      await fireEvent(screen.getByTestId('food-search-sheet'), 'requestClose');
    }
    // The now line's Add opens on the next meal with the meal choice, Snacks included (UI-3d).
    await fireEvent.press(screen.getByTestId('food-day-add'));
    expect(within(screen.getByTestId('food-search-meals')).getAllByRole('radio').map((m) => m.props.accessibilityLabel))
      .toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  });
});
