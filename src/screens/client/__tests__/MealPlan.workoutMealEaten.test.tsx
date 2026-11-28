/**
 * PREWORKOUT-EATEN-M (SWEEP-FOOD-LOG B1), the meal plan page (ClientDailyMealPlanScreen.tsx:382): a post-workout meal
 * up next is logged by one tap on "Ate it as planned", with no meal chooser. When the page is opened again with the
 * day's log as the server stores that write (meal_type as sent, the plan meal's id), the meal is eaten ("Logged as
 * planned") and "Ate it as planned" moves to the next meal: it is not offered for this meal again. Harness from
 * Goal927.plannedState.test.tsx; every switch on ([R27]).
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { foodApi, logApi } from '../../../services/api';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, props) };
});
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({
  useMealPlanToday: () => ({ data: { assignments: [mockAssignment] }, refetch: jest.fn(), isLoading: false, isError: false }),
}));
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: null }),
}));
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: () => ({ data: { entries: mockEntries }, isLoading: false, isError: false }),
}));
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { foodPlanChecklist: true, offlineFoodInDay: true },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
// FIX-MPF-1: the page reads the phone's foods from the store (C1's join); none wait on this phone here.
jest.mock('../../../store/clientStore', () => {
  const state = { selectedDate: '2026-10-07', refreshShownDay: jest.fn(), queuedFoods: [], sentFoods: [] };
  return { useClientStore: Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state }) };
});
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07',
}));

const template = (id: string, name: string, kcal: number, p: number, c: number, f: number) => ({
  id, coach_id: 'coach', name, description: null, calories_kcal: kcal, protein_g: p, carbs_g: c, fats_g: f,
  fiber_g: null, items: null, created_at: '2026-10-01', archived_at: null,
});
const mockAssignment = {
  id: 'a1', daily_meal_plan_id: 'dp', client_id: 'client-1', assigned_by_coach_id: 'coach',
  starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
  daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Training day', notes: null, created_at: '2026-10-01', archived_at: null,
    slots: [
      { id: 's-post', daily_meal_plan_id: 'dp', meal_template_id: 'm-post', slot_label: 'postworkout', order: 0, time_of_day: '18:30',
        meal_template: template('m-post', 'Chocolate milk and a banana', 310, 16, 52, 5) },
      { id: 's-din', daily_meal_plan_id: 'dp', meal_template_id: 'm-din', slot_label: 'dinner', order: 0, time_of_day: '19:30',
        meal_template: template('m-din', 'Pasta', 420, 20, 60, 10) },
    ] },
};
type Entry = { id: string; food_item_id: string; user_id: string; meal_type: string; quantity_multiplier: number;
  original_quantity: number; original_unit: string; plan_slot_id: string | null;
  food_item: { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number } };
let mockEntries: Entry[] = [];
const netinfo = jest.requireMock('@react-native-community/netinfo');
const POST = 'Log this meal: Chocolate milk and a banana';

beforeEach(() => {
  jest.clearAllMocks();
  netinfo.__reset();
  mockEntries = [];
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
});

it('a post-workout meal up next: one tap, no chooser; opened again it is eaten and not offered again', async () => {
  const first = await render(<ClientDailyMealPlanScreen />);
  const card = screen.getByTestId('daily-meal-plan-next-card');
  expect(within(card).getByLabelText(POST)).toBeTruthy();
  expect(within(card).getByText('Ate it as planned')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText(POST));
  // Her path where the app asks which meal: a 6:30 pm post-workout meal is dinner to her.
  const asked = screen.queryByText('Choose the meal to add it to.') != null;
  if (asked) {
    const dinner = screen.getAllByRole('radio').find((r) => within(r).queryByText('Dinner'));
    if (dinner) await fireEvent.press(dinner);
    await fireEvent.press(screen.getByText(/^Log to /));
  }
  await screen.findByText(/^Added to today's /);
  expect(logApi.logFood).toHaveBeenCalledTimes(1);
  const sent = jest.mocked(logApi.logFood).mock.calls[0][0] as { meal_type: string; plan_slot_id?: string; quantity_multiplier: number };
  expect(sent.plan_slot_id).toBe('s-post');

  // The page opened again: the day's log holds the entry as the server stored it.
  first.unmount();
  mockEntries = [{
    id: 'entry-1', food_item_id: 'food-1', user_id: 'client-1', meal_type: sent.meal_type,
    quantity_multiplier: sent.quantity_multiplier, original_quantity: 1, original_unit: 'serving', plan_slot_id: sent.plan_slot_id ?? null,
    food_item: { id: 'food-1', name: 'Chocolate milk and a banana', calories: 310, protein_g: 16, carbs_g: 52, fat_g: 5 },
  }];
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText('Logged as planned')).toBeTruthy();
  const next = screen.getByTestId('daily-meal-plan-next-card');
  expect(within(next).getByLabelText('Log this meal: Pasta')).toBeTruthy();
  expect(within(next).queryByLabelText(POST)).toBeNull();
  expect(screen.getAllByText('Ate it as planned')).toHaveLength(1);

  // One tap, no chooser: the meal went to Snacks, the meal the Food day counts it under.
  expect(asked).toBe(false);
  expect(sent.meal_type).toBe('snack');
});
