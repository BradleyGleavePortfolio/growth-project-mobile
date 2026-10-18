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
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: mockParams }) }));
jest.mock('../../../services/api', () => ({}));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: (date?: string) => mockDaily(date) }));

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import type { DailyMealPlanAssignmentWithPlan } from '../../../api/mealTemplatesApi';
import { useMealPlanToday } from '../../../hooks/useMealTemplates';

let mockParams: { date?: string; assignmentId?: string } | undefined;
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
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = undefined;
  daily.mockReturnValue({ data: { date: '2026-10-07', assignments: [] }, isLoading: false,
    isError: false, isRefetching: false, refetch });
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
