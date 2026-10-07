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
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../../../services/api', () => ({ mealPlansApi: { list: jest.fn() } }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: jest.fn() },
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: (date?: string) => mockDaily(date) }));

import PlanScreen from '../PlanScreen';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import { mealPlansApi } from '../../../services/api';
import { mealTemplatesApi } from '../../../api/mealTemplatesApi';
import type { DailyMealPlanAssignmentWithPlan } from '../../../api/mealTemplatesApi';
import { useMealPlanToday } from '../../../hooks/useMealTemplates';

let mockParams: { date?: string; assignmentId?: string } | undefined;
const list = jest.mocked(mealPlansApi.list);
const today = jest.mocked(mealTemplatesApi.todayForClient);
type DailyView = Partial<Pick<ReturnType<typeof useMealPlanToday>,
  'data' | 'isLoading' | 'isError' | 'isRefetching' | 'refetch'>>;
const mockDaily = jest.fn<DailyView, [string | undefined]>();
const daily = mockDaily;
const refetch = jest.fn();
const assignment: DailyMealPlanAssignmentWithPlan = {
  id: 'chosen', daily_meal_plan_id: 'dp', client_id: 'c', assigned_by_coach_id: 'coach',
  starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
  daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Delivered plan', notes: 'Cook ahead',
    created_at: '2026-09-30', archived_at: null, slots: [{ id: 's', daily_meal_plan_id: 'dp',
      meal_template_id: 'm', slot_label: 'dinner', order: 0, meal_template: {
        id: 'm', coach_id: 'coach', name: 'Pasta', calories_kcal: 420, protein_g: 20,
        carbs_g: 60, fats_g: 10, fiber_g: null, items: null, description: 'With greens',
        created_at: '2026-09-30', archived_at: null,
      } }] },
};
const response = <T,>(data: T): AxiosResponse<T> => ({
  data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = undefined;
  list.mockResolvedValue(response([]));
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [] }));
  daily.mockReturnValue({ data: { date: '2026-10-07', assignments: [] }, isLoading: false,
    isError: false, isRefetching: false, refetch });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('shows a recoverable error, not an empty-plan claim, when both sources fail', async () => {
  list.mockRejectedValue(new Error('offline'));
  today.mockRejectedValue(new Error('offline'));
  await render(<PlanScreen />);
  expect(await screen.findByText('Could not load your meal plans. Pull to retry.')).toBeTruthy();
  expect(screen.queryByText('No meal plans to show.')).toBeNull();
  list.mockResolvedValue(response([]));
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [] }));
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(await screen.findByText('No meal plans to show.')).toBeTruthy();
});

it('keeps legacy notes, meals, known macros and pull-to-refresh without claiming partial totals', async () => {
  list.mockResolvedValue(response([{ id: 'p', title: 'Kitchen plan', created_at: '2026-10-01',
    notes: 'Pack lunch', items: [{ name: 'Oats', calories: 310, protein: 15, notes: 'Add milk', time_of_day: 'breakfast' },
      { name: 'Soup', time_of_day: 'lunch' }] }]));
  await render(<PlanScreen />);
  expect(await screen.findByText('Kitchen plan')).toBeTruthy();
  for (const text of ['Pack lunch', 'Oats', 'Soup', 'Add milk', '310 kcal', 'P 15g', 'Created Oct 1']) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  expect(screen.queryByText('Daily total')).toBeNull();
  expect(screen.getByText('Your meal plan')).toHaveStyle({ fontFamily: 'CormorantGaramond_400Regular', fontSize: 32 });
  expect(screen.getByText('Oats')).toHaveStyle({ fontFamily: 'Inter_500Medium' });
  await fireEvent(screen.getByTestId('meal-plan-refresh'), 'refresh');
  expect(list).toHaveBeenCalledTimes(2);
  expect(today).toHaveBeenCalledTimes(2);
  await act(async () => { jest.mocked(useFocusEffect).mock.calls[0][0](); });
  expect(list).toHaveBeenCalledTimes(3);
  expect(today).toHaveBeenCalledTimes(3);
});

it('merges canonical assigned meals alongside legacy plans with real plan creation metadata', async () => {
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [assignment] }));
  list.mockResolvedValue(response([{ id: 'p', title: 'Legacy plan', items: [] }]));
  await render(<PlanScreen />);
  for (const text of ['Today · Delivered plan', 'Legacy plan', 'Cook ahead', 'Pasta', '420 kcal', 'Created Sep 30']) {
    expect(await screen.findByText(text)).toBeTruthy();
  }
  expect(screen.getByText('420 kcal · 20g protein')).toBeTruthy();
});

it('keeps assigned meals when just the legacy source fails', async () => {
  list.mockRejectedValue(new Error('offline'));
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [assignment] }));
  await render(<PlanScreen />);
  expect(await screen.findByText('Pasta')).toBeTruthy();
  expect(screen.queryByLabelText('Try again')).toBeNull();
});

it('keeps all structured days, servings and supplied daily totals', async () => {
  list.mockResolvedValue(response([{ id: 'week', title: 'Training meals', days: [{ day: 1,
    daily_totals: { calories: 1800, protein_g: 120 }, meals: [{ slot: 'dinner',
      items: [{ name: 'Rice bowl', serving: 'One bowl', calories: 500, protein_g: 35 }] }] },
    { day: 2, meals: [{ slot: 'lunch', items: [{ name: 'Salad' }] }] }] }]));
  await render(<PlanScreen />);
  for (const text of ['Day 1', 'Day 2', 'Rice bowl', 'Salad', 'One bowl', '1800 kcal · P 120g']) {
    expect(await screen.findByText(text)).toBeTruthy();
  }
  expect(screen.queryByText('THIS WEEK')).toBeNull();
});

it('preserves date and delivered assignment selection plus daily pull-to-refresh', async () => {
  mockParams = { date: '2026-10-07', assignmentId: 'chosen' };
  daily.mockReturnValue({ data: { date: '2026-10-07', assignments: [
    { ...assignment, id: 'newer', daily_meal_plan: { ...assignment.daily_meal_plan, name: 'Different plan' } },
    assignment,
  ] }, isLoading: false, isError: false, isRefetching: false, refetch });
  await render(<ClientDailyMealPlanScreen />);
  expect(daily).toHaveBeenCalledWith('2026-10-07');
  for (const text of ['Delivered plan', 'Cook ahead', 'Dinner', 'Pasta', 'With greens']) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  expect(screen.queryByText('Different plan')).toBeNull();
  expect(screen.getByText('420 kcal • P 20g • C 60g • F 10g')).toBeTruthy();
  await fireEvent(screen.getByTestId('daily-meal-plan-refresh'), 'refresh');
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('daily loading, empty and error states stay distinct and the retry refetches', async () => {
  const empty = await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText('No meal plan is assigned for today.')).toBeTruthy();
  daily.mockReturnValue({ isLoading: true });
  await empty.rerender(<ClientDailyMealPlanScreen />);
  expect(screen.queryByText('No plan for today')).toBeNull();
  daily.mockReturnValue({ isError: true, refetch });
  await empty.rerender(<ClientDailyMealPlanScreen />);
  expect(screen.getByText('Could not load this meal plan. Pull to retry.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Try again'));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('does not invent an end date or coach relationship when the selected plan is unavailable', async () => {
  mockParams = { assignmentId: 'missing' };
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText('This plan is not available for this day')).toBeTruthy();
  expect(screen.queryByText('This plan has ended')).toBeNull();
});

// Production `/meal-plans` canonical fallback row (backend meal-plans.service.ts):
// created_at = assignment starts_on, updated_at = the plan's real creation time.
const fallbackRow = (planId: string, title: string) => ({ id: `canonical:${planId}`, title,
  notes: null, days: null, created_at: '2026-10-05', updated_at: '2026-09-30', source: 'real-meal-plans',
  items: [{ name: 'Pasta', calories: 420, protein: 20, time_of_day: 'dinner' }] });

it('labels a canonical fallback row Created with the plan creation date, not its start date', async () => {
  list.mockResolvedValue(response([fallbackRow('dp', 'Delivered plan')]));
  await render(<PlanScreen />);
  expect(await screen.findByText('Delivered plan')).toBeTruthy();
  expect(screen.getByText('Created Sep 30')).toBeTruthy();
  expect(screen.queryByText('Created Oct 5')).toBeNull();
});

it('shows a canonical plan once when both sources return it, keeping other plans', async () => {
  today.mockResolvedValue(response({ date: '2026-10-07', assignments: [assignment] }));
  list.mockResolvedValue(response([fallbackRow('dp', 'Delivered plan'), fallbackRow('other', 'Next plan'),
    { id: 'p', title: 'Legacy plan', items: [] }]));
  await render(<PlanScreen />);
  expect(await screen.findByText('Today · Delivered plan')).toBeTruthy();
  expect(screen.queryByText('Delivered plan')).toBeNull();
  for (const text of ['Next plan', 'Legacy plan']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getAllByText('Pasta')).toHaveLength(2);
});

it('daily plan shows one tabular day-total line from every slot', async () => {
  const plan = assignment.daily_meal_plan;
  const lunch = { ...plan.slots[0], id: 's2', slot_label: 'lunch' as const,
    meal_template: { ...plan.slots[0].meal_template, id: 'm2', name: 'Soup', calories_kcal: 300.4,
      protein_g: 15, carbs_g: 30, fats_g: 8 } };
  daily.mockReturnValue({ data: { date: '2026-10-07', assignments: [{ ...assignment,
    daily_meal_plan: { ...plan, slots: [...plan.slots, lunch] } }] }, isLoading: false,
  isError: false, isRefetching: false, refetch });
  await render(<ClientDailyMealPlanScreen />);
  const total = screen.getByTestId('daily-meal-plan-total');
  expect(total).toHaveTextContent('Day total 720 kcal • P 35g • C 90g • F 18g');
  expect(total).toHaveStyle({ fontVariant: ['tabular-nums'] });
});
