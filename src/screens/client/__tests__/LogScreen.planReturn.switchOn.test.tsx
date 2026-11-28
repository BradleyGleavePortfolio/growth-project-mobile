/**
 * MEALPLAN-RESUME-M (SWEEP-MEAL-PLANS B2), on the real Food day with the switch on (featureFlags.foodPlanChecklist):
 * the coach changes tonight's dinner while the app is behind, and she comes back by the app's icon. The Food tab is
 * still mounted; the return re-reads its plan once, so the new dinner and the coach's change note show. Offline, the
 * return's read fails and the Food day keeps the dinner she had, with no "could not load" block in its place.
 *
 * Real pieces: LogScreen and FoodDayView (the plan read, its change note, its error branch FoodDayView.tsx:244),
 * the app's queryClient singleton (as App.tsx provides it) and useFoodLogQueueSync mounted as RootNavigator.tsx:679
 * mounts it for a signed-in client. Stand-ins: the network (services/api), the day store, the food log queue, and
 * react-native's AppState listener (captured, then driven). Names are fictional.
 */
import React from 'react';
import { AppState } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import LogScreen from '../LogScreen';
import { queryClient } from '../../../services/queryClient';
import { useFoodLogQueueSync } from '../../../hooks/useFoodLogQueueSync';
import { getTodayString } from '../../../utils/date';

const mockDay = getTodayString();
const mockStore = {
  selectedDate: mockDay, foodLogs: [], hasLoadedDay: true,
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0, isLoading: false, loadError: null,
  setSelectedDate: jest.fn(), loadDayData: jest.fn().mockResolvedValue(undefined),
  refreshShownDay: jest.fn().mockResolvedValue(undefined),
  logWater: jest.fn(), removeFoodLogLocally: jest.fn(),
};
const mockPlan = (dinner: string, changed: boolean) => ({
  date: mockDay,
  assignments: [{ daily_meal_plan: {
    id: 'plan', name: 'Daily plan', slots: [{ id: 'slot-dinner', slot_label: 'dinner', order: 0,
      meal_template: { id: dinner, name: dinner, calories_kcal: 600, protein_g: 40, carbs_g: 50, fats_g: 20, items: [] } }],
  } }],
  changes_today: changed ? [{ plan_id: 'plan', slot_id: 'slot-dinner', slot_label: 'dinner',
    from_template_id: 'Chicken rice bowl', from_name: 'Chicken rice bowl', to_template_id: dinner, to_name: dinner,
    changed_at: new Date(`${mockDay}T14:00:00`).toISOString() }] : [],
});
const mockPlanRead = jest.fn();

jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: { ...real.featureFlags, foodPlanChecklist: true } };
});
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: () => mockStore }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', coach_id: 'coach' }) }));
jest.mock('../../../hooks/useMacroTargets', () => ({ useMacroTargets: () => null }));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({}), isEffectivelyOnline: () => true }));
jest.mock('../../../hooks/useFoodBrowse', () => ({ useFoodBrowse: () => ({
  recentFoods: [], frequentFoods: [], lastMeals: {}, loadBrowseFoods: jest.fn(),
}) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full' }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async (url: string) => (url.startsWith('/me/meal-plan/today')
    ? mockPlanRead(url)
    : { data: url === '/v1/clients/me/coach' ? { name: 'Maya Brooks' } : { items: [], nextCursor: null } })) },
  foodApi: { search: jest.fn(), create: jest.fn() },
  logApi: { logFood: jest.fn(), updateEntry: jest.fn(), deleteEntry: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({
  syncFoodLogQueue: jest.fn(async () => 0), notifyPendingFoodLogs: jest.fn(),
  readPendingFoodLogCount: jest.fn(async () => 0), subscribePendingFoodLogs: jest.fn(() => () => undefined),
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/FoodImage', () => ({ __esModule: true, default: () => null }));

/** RootNavigator.tsx:679 for a signed-in client, online. */
function Root() {
  useFoodLogQueueSync(true, true);
  return null;
}
const app = () => (
  <QueryClientProvider client={queryClient}><Root /><LogScreen /></QueryClientProvider>
);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
let appStateListeners: Array<(s: string) => void> = [];
const comeBack = async () => {
  for (const s of ['inactive', 'background', 'active']) await act(async () => { appStateListeners.forEach((cb) => cb(s)); });
  await settle();
};

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateListeners.push(cb);
    return { remove: () => { appStateListeners = appStateListeners.filter((x) => x !== cb); } };
  }) as unknown as typeof AppState.addEventListener);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

it('R1. she comes back by the icon after the coach changed dinner: the open Food day shows the new dinner and the note', async () => {
  mockPlanRead.mockResolvedValueOnce({ data: mockPlan('Chicken rice bowl', false) });
  await render(app());
  expect(await screen.findByText('Chicken rice bowl')).toBeTruthy();
  expect(mockPlanRead).toHaveBeenCalledTimes(1);

  // The coach swaps dinner while the phone is in her pocket; the notice went to the tray (or notifications are off).
  mockPlanRead.mockResolvedValue({ data: mockPlan('Salmon and greens', true) });
  await comeBack();

  expect(mockPlanRead).toHaveBeenCalledTimes(2);
  expect(mockPlanRead).toHaveBeenLastCalledWith(`/me/meal-plan/today?date=${mockDay}`);
  expect(await screen.findByText('Salmon and greens')).toBeTruthy();
  expect(screen.queryByText('Chicken rice bowl')).toBeNull();
  expect(screen.getByText(/^Maya updated today's plan at .*Dinner is now Salmon and greens\./)).toBeTruthy();
});

it('R2. offline: the return’s read fails, and the Food day keeps the dinner she had, with no error block', async () => {
  mockPlanRead.mockResolvedValueOnce({ data: mockPlan('Chicken rice bowl', false) });
  await render(app());
  expect(await screen.findByText('Chicken rice bowl')).toBeTruthy();

  mockPlanRead.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));
  await comeBack();
  await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });

  expect(mockPlanRead).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Chicken rice bowl')).toBeTruthy();
  expect(screen.queryByTestId('food-day-plan-error')).toBeNull();
});

it('R3. no read while she stays in the app: a glance at Control Centre reads nothing', async () => {
  mockPlanRead.mockResolvedValue({ data: mockPlan('Chicken rice bowl', false) });
  await render(app());
  expect(await screen.findByText('Chicken rice bowl')).toBeTruthy();
  for (const s of ['inactive', 'active']) await act(async () => { appStateListeners.forEach((cb) => cb(s)); });
  await settle();
  expect(mockPlanRead).toHaveBeenCalledTimes(1);
});
