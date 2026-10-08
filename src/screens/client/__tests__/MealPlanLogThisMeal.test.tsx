/**
 * "Log this meal" on the meal plan screens (NUTR-LOGPLAN-128). Every planned
 * meal gets one quiet action that adds it to today's food log through
 * components/mealplan/LogPlannedMealButton; the screens' existing actions
 * (pull to refresh, focus refresh, Try again) are unchanged.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { useFocusEffect } from '@react-navigation/native';

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
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn(), useRoute: () => ({ params: undefined }) }));
jest.mock('../../../services/api', () => ({
  mealPlansApi: { list: jest.fn() }, foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn(), deleteEntry: jest.fn() },
}));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: jest.fn() },
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

import PlanScreen from '../PlanScreen';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { foodApi, logApi, mealPlansApi } from '../../../services/api';
import { mealTemplatesApi } from '../../../api/mealTemplatesApi';
import type { DailyMealPlanAssignmentWithPlan, MealTemplate } from '../../../api/mealTemplatesApi';
import type { useMealPlanToday } from '../../../hooks/useMealTemplates';

type DailyView = Partial<Pick<ReturnType<typeof useMealPlanToday>,
  'data' | 'isLoading' | 'isError' | 'isRefetching' | 'refetch'>>;
const mockDaily = jest.fn<DailyView, []>();
const list = jest.mocked(mealPlansApi.list);
const today = jest.mocked(mealTemplatesApi.todayForClient);
const refetch = jest.fn();
const response = <T,>(data: T): AxiosResponse<T> => ({
  data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
});
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
const legacyPlan = { id: 'p', title: 'Kitchen plan', items: [
  { name: 'Oats', calories: 310, protein: 15, time_of_day: 'breakfast' },
  { name: 'Soup', time_of_day: 'lunch' },
] };
const aiPlan = { id: 'ai', title: 'Training meals', days: [{ day: 1, meals: [
  { slot: 'lunch', items: [
    { name: 'Rice', serving: '150 g', calories: 200, protein_g: 4, carbs_g: 44, fat_g: 1 },
    { name: 'Chicken', calories: 250, protein_g: 40, carbs_g: 0, fat_g: 9 },
  ] },
  { slot: 'dinner', items: [{ name: 'Salad' }] },
] }] };
const logButtons = () => screen.getAllByRole('button').filter((b) =>
  String(b.props.accessibilityLabel ?? '').startsWith('Log this meal: '));

beforeEach(() => {
  jest.clearAllMocks();
  list.mockResolvedValue(response([]));
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [] }));
  mockDaily.mockReturnValue({ data: { date: '2026-10-07', assignments: [assignment] }, isLoading: false,
    isError: false, isRefetching: false, refetch });
  jest.mocked(foodApi.create).mockResolvedValue({ data: { id: 'food-1' } } as Awaited<ReturnType<typeof foodApi.create>>);
  jest.mocked(logApi.logFood).mockResolvedValue({ data: { id: 'entry-1' } } as Awaited<ReturnType<typeof logApi.logFood>>);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('meal plan: one tap logs an assigned meal with all four template values to its meal', async () => {
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [assignment] }));
  await render(<PlanScreen />);
  await fireEvent.press(await screen.findByLabelText('Log this meal: Pasta'));
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

it('meal plan: a coach meal with only calories and protein asks for carbs and fat instead of logging zero', async () => {
  list.mockResolvedValue(response([legacyPlan]));
  await render(<PlanScreen />);
  await fireEvent.press(await screen.findByLabelText('Log this meal: Oats'));
  expect(screen.getByLabelText('Calories').props.value).toBe('310');
  expect(screen.getByLabelText('Protein (g)').props.value).toBe('15');
  expect(screen.getByLabelText('Carbs (g)').props.value).toBe('');
  expect(screen.getByText('Enter protein, carbs and fat. Use 0 if there is none.')).toBeTruthy();
  expect(screen.getByText('Log to breakfast')).toBeDisabled();
  expect(foodApi.create).not.toHaveBeenCalled();
});

it('meal plan: an AI plan meal is one entry with its foods summed, logged to its slot', async () => {
  list.mockResolvedValue(response([aiPlan]));
  await render(<PlanScreen />);
  await fireEvent.press(await screen.findByLabelText('Log this meal: Rice (150 g), Chicken'));
  expect(await screen.findByText("Added to today's lunch.")).toBeTruthy();
  expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Rice (150 g), Chicken', calories: 450, protein_g: 44, carbs_g: 44, fat_g: 10,
  }));
  expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'lunch' }));
});

it('daily plan: every slot logs its meal template to that meal in one tap', async () => {
  await render(<ClientDailyMealPlanScreen />);
  await fireEvent.press(screen.getByLabelText('Log this meal: Pasta'));
  expect(await screen.findByText("Added to today's dinner.")).toBeTruthy();
  expect(foodApi.create).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Pasta', calories: 420, protein_g: 20, carbs_g: 60, fat_g: 10,
  }));
  expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ meal_type: 'dinner' }));
});

it('parity, meal plan: one Log this meal per planned meal is the only new action; refresh paths unchanged', async () => {
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [assignment] }));
  list.mockResolvedValue(response([legacyPlan, aiPlan]));
  await render(<PlanScreen />);
  await screen.findByText('Training meals');
  // 2 assigned slots + 2 coach meals + 2 AI meals (one per meal, not per food).
  expect(logButtons().map((b) => b.props.accessibilityLabel)).toEqual([
    'Log this meal: Pasta', 'Log this meal: Banana', 'Log this meal: Oats', 'Log this meal: Soup',
    'Log this meal: Rice (150 g), Chicken', 'Log this meal: Salad',
  ]);
  expect(screen.getAllByRole('button')).toHaveLength(6);
  await fireEvent(screen.getByTestId('meal-plan-refresh'), 'refresh');
  expect(list).toHaveBeenCalledTimes(2);
  expect(today).toHaveBeenCalledTimes(2);
  await act(async () => { jest.mocked(useFocusEffect).mock.calls[0][0](); });
  expect(list).toHaveBeenCalledTimes(3);
  expect(today).toHaveBeenCalledTimes(3);
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
