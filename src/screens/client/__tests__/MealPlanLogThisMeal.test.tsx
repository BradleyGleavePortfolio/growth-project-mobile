/**
 * "Log this meal" on the day plan screen (NUTR-LOGPLAN-128). Every planned
 * meal gets one quiet action that adds it to today's food log through
 * components/mealplan/LogPlannedMealButton; pull to refresh is unchanged.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary,
    primary: sc.accent, surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, props) };
});
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: () => mockDaily() }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));
jest.mock('../../../services/foodLogSync', () => ({ notifyPendingFoodLogs: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../store/clientStore', () => ({
  useClientStore: { getState: () => ({ selectedDate: '2026-10-07', loadDayData: jest.fn() }) },
}));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1' }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/date', () => ({
  ...jest.requireActual('../../../utils/date'), getTodayString: () => '2026-10-07',
}));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { foodApi, logApi } from '../../../services/api';
import type { DailyMealPlanAssignmentWithPlan, MealTemplate } from '../../../api/mealTemplatesApi';
import type { useMealPlanToday } from '../../../hooks/useMealTemplates';

type DailyView = Partial<Pick<ReturnType<typeof useMealPlanToday>,
  'data' | 'isLoading' | 'isError' | 'isRefetching' | 'refetch'>>;
const mockDaily = jest.fn<DailyView, []>();
const refetch = jest.fn();
const template = (id: string, name: string, kcal: number, p: number, c: number, f: number): MealTemplate => ({
  id, coach_id: 'coach', name, description: null, calories_kcal: kcal, protein_g: p, carbs_g: c, fats_g: f,
  fiber_g: null, items: null, created_at: '2026-09-30', archived_at: null,
});
const assignment: DailyMealPlanAssignmentWithPlan = {
  id: 'a1', daily_meal_plan_id: 'dp', client_id: 'c', assigned_by_coach_id: 'coach',
  starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
  daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Coach plan', notes: null, created_at: '2026-09-30',
    archived_at: null, slots: [
      { id: 's1', daily_meal_plan_id: 'dp', meal_template_id: 'm1', slot_label: 'dinner', order: 1,
        meal_template: template('m1', 'Pasta', 420, 20, 60, 10) },
      { id: 's2', daily_meal_plan_id: 'dp', meal_template_id: 'm2', slot_label: 'preworkout', order: 0,
        meal_template: template('m2', 'Banana', 105, 1, 27, 0) },
    ] },
};
const logButtons = () => screen.getAllByRole('button').filter((b) =>
  String(b.props.accessibilityLabel ?? '').startsWith('Log this meal: '));

beforeEach(() => {
  jest.clearAllMocks();
  mockDaily.mockReturnValue({ data: { date: '2026-10-07', assignments: [assignment] }, isLoading: false,
    isError: false, isRefetching: false, refetch });
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
});

it('daily plan: every slot logs its meal template to that meal in one tap', async () => {
  await render(<ClientDailyMealPlanScreen />);
  await fireEvent.press(screen.getByLabelText('Log this meal: Pasta'));
  expect(await screen.findByText("Added to today's dinner.")).toBeTruthy();
  expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Pasta', calories: 420, protein_g: 20, carbs_g: 60, fat_g: 10,
  }));
  expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-07', meal_type: 'dinner' }));

  // A pre-workout slot names no food-log meal: the sheet asks which meal.
  await fireEvent.press(screen.getByLabelText('Log this meal: Banana'));
  expect(screen.getByText('Choose the meal to add it to.')).toBeTruthy();
  expect(foodApi.create).toHaveBeenCalledTimes(1);
});

it('parity, daily plan: one Log this meal per slot is the only new action; pull to refresh unchanged', async () => {
  await render(<ClientDailyMealPlanScreen />);
  expect(logButtons().map((b) => b.props.accessibilityLabel)).toEqual([
    'Log this meal: Pasta', 'Log this meal: Banana',
  ]);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  await fireEvent(screen.getByTestId('daily-meal-plan-refresh'), 'refresh');
  expect(refetch).toHaveBeenCalledTimes(1);
});

// More > Meal plan opens the day plan with no params: every active plan for
// the day is listed, newest first, and each plan's meals can be logged.
it('More entry: two active plans are both listed, newest first, and both log', async () => {
  const soup = { ...assignment.daily_meal_plan.slots[0], id: 's3', daily_meal_plan_id: 'dp2',
    meal_template_id: 'm3', slot_label: 'lunch' as const, order: 0, meal_template: template('m3', 'Soup', 300, 15, 30, 8) };
  const rest = { ...assignment, id: 'a2', daily_meal_plan_id: 'dp2', starts_on: '2026-09-20',
    daily_meal_plan: { ...assignment.daily_meal_plan, id: 'dp2', name: 'Rest day', slots: [soup] } };
  mockDaily.mockReturnValue({ data: { date: '2026-10-07', assignments: [assignment, rest] }, isLoading: false,
    isError: false, isRefetching: false, refetch });
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getAllByText(/^(Coach plan|Rest day)$/).map((t) => t.props.children)).toEqual(['Coach plan', 'Rest day']);
  expect(logButtons().map((b) => b.props.accessibilityLabel)).toEqual([
    'Log this meal: Pasta', 'Log this meal: Banana', 'Log this meal: Soup',
  ]);
  await fireEvent.press(screen.getByLabelText('Log this meal: Soup'));
  expect(await screen.findByText("Added to today's lunch.")).toBeTruthy();
  expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Soup', calories: 300 }));
  expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'lunch' }));
});
