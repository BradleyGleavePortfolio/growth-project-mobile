// OFF-PHOTO-M: the real Log screen with an Open Food Facts product picked from search or did-you-mean. The phone
// sends its off_ id; the server's answers are built from backend e24409bc: refused or missing answers 404
// "Food not found" (log.service.ts:264-271), an Open Food Facts outage is a 500 (food.service.ts:1146, :1153).
// The harness is LogScreen.ls-food-online-retry.test.tsx's. Codes and names are made up.
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { foodApi, logApi } from '../../../services/api';
import { forgetSaveKeys } from '../../../utils/log/saveKey';
import { getTodayString } from '../../../utils/date';

const mockDay = getTodayString();
const mockStore = {
  selectedDate: mockDay, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
const mockPlan = { date: mockDay, assignments: [{ daily_meal_plan: {
  name: 'Daily plan', slots: [{ id: 'slot', slot_label: 'breakfast', order: 0,
    meal_template: { name: 'Breakfast bowl', calories_kcal: 400, protein_g: 25, carbs_g: 45, fats_g: 13, items: [] } }],
} }] };
const mockOffRow = {
  id: 'off_0000000012345', name: 'Oat crunch bar', brand_or_restaurant: 'Madeup Mills',
  calories: 410, protein_g: 9, carbs_g: 62, fat_g: 14, serving_description: '100g', serving_size_grams: 100,
  nutrient_basis: 'PER_100G', image_url: 'https://images.example.test/oat-crunch.jpg',
};
const mockSearch = { results: [mockOffRow] as unknown[], suggestions: [] as unknown[] };
const mockAnswers: Array<unknown> = [];

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'viewer', coach_id: 'coach' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodLogQueueSync', () => ({ usePendingFoodLogCount: () => 0 }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => ({ data: url.startsWith('/me/meal-plan') ? mockPlan : { name: 'Coach' } })) },
  foodApi: {
    search: jest.fn(async () => ({ data: mockSearch })),
    create: jest.fn(async () => ({ data: { id: 'private-copy' } })),
  },
  logApi: {
    logFood: jest.fn(async () => {
      const next = mockAnswers.shift();
      if (next instanceof Error) throw next;
      return { data: { id: 'entry-1' } };
    }),
    updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn(),
  },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

const answer = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { statusCode: status, message } } });

beforeEach(() => {
  jest.clearAllMocks();
  forgetSaveKeys();
  mockAnswers.length = 0;
  mockSearch.results = [mockOffRow];
  mockSearch.suggestions = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function pickFromSearch() {
  await render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LogScreen />
  </QueryClientProvider>);
  await fireEvent.press(await screen.findByText('Something else'));
  await fireEvent.changeText(await screen.findByPlaceholderText('Search foods...'), 'oat crunch');
  await fireEvent.press(await screen.findByText('Oat crunch bar', {}, { timeout: 4000 }));
}
const pressLog = async () => { await fireEvent.press(screen.getByRole('button', { name: 'Log food' })); };
const sent = () => jest.mocked(logApi.logFood).mock.calls.map(([b]) => b as Record<string, unknown>);

describe('OFF-PHOTO-M: an Open Food Facts pick on the real Log screen', () => {
  it('case 1 and 8: a search row logs by its off_ id and makes no food', async () => {
    await pickFromSearch();
    await pressLog();
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(sent()[0]).toEqual(expect.objectContaining({ food_item_id: 'off_0000000012345' }));
  });

  it('case 8: a did-you-mean row with an off_ id logs by that id and makes no food', async () => {
    mockSearch.results = [];
    mockSearch.suggestions = [{ ...mockOffRow, id: 'off_0000000067890' }];
    await pickFromSearch();
    await pressLog();
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(1));
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(sent()[0]).toEqual(expect.objectContaining({ food_item_id: 'off_0000000067890' }));
  });

  it('case 6: a 404 "Food not found" keeps the sheet open, shows the server words, makes no food and lets the key go', async () => {
    mockAnswers.push(answer(404, 'Food not found'), answer(404, 'Food not found'));
    await pickFromSearch();
    await pressLog();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Couldn't log food", 'Food not found'));
    expect(screen.getByRole('button', { name: 'Log food' })).toBeTruthy();
    expect(foodApi.create).not.toHaveBeenCalled();
    await pressLog();
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(2));
    expect(foodApi.create).not.toHaveBeenCalled();
    expect(sent().map((b) => b.food_item_id)).toEqual(['off_0000000012345', 'off_0000000012345']);
    // A refused save lets its key go (saveKey.ts:52-53): the tap again is a new save.
    expect(sent()[1].client_uuid).not.toBe(sent()[0].client_uuid);
  });

  it('case 6: a 500 shows the service line, keeps the sheet open and keeps the key for a tap again', async () => {
    mockAnswers.push(answer(500, 'Internal server error'));
    await pickFromSearch();
    await pressLog();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
      "Couldn't log food", 'The service is temporarily unavailable. Try again in a moment.',
    ));
    expect(screen.getByRole('button', { name: 'Log food' })).toBeTruthy();
    await pressLog();
    await waitFor(() => expect(logApi.logFood).toHaveBeenCalledTimes(2));
    expect(sent()[1].client_uuid).toBe(sent()[0].client_uuid);
    expect(sent()[1].food_item_id).toBe('off_0000000012345');
    expect(foodApi.create).not.toHaveBeenCalled();
  });
});
