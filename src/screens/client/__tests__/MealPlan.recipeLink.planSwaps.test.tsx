// PLAN-SWAPS-M (C2 Style C C_day's "Recipe and grocery list", operator ruling R7; state S17): on the meal plan page a
// meal with a recipe offers the link under its words, its own button, opening the plan meal page for this page's day.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';

let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, props) };
});
let mockParams: Record<string, string> | undefined;
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual('react');
  return {
    useRoute: () => ({ params: mockParams }),
    NavigationContext: R.createContext({ navigate: (...a: unknown[]) => mockNavigate(...a) }),
  };
});
jest.mock('../../../api/mealTemplatesApi', () => ({ SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'] }));
let mockData: unknown;
jest.mock('../../../hooks/useMealTemplates', () => ({
  useMealPlanToday: () => ({ data: mockData, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false, isFetching: false, dataUpdatedAt: Date.now() }),
}));
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => ({
  __esModule: true, plannedMealFromSlot: (s: { meal_template: { name: string } }) => ({ name: s.meal_template.name }), default: () => null,
}));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { foodPlanChecklist: true } }));
jest.mock('../../../hooks/useApi', () => ({ useTodayLog: () => ({ data: { entries: [] }, isError: false, isLoading: false }) }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: null }) }));

// A fixed clock: Tuesday 24 November 2026, 3:10 pm (only Date is faked).
jest.useFakeTimers({ now: new Date('2026-11-24T15:10:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

const tpl = (name: string, kcal: number) => ({ name, description: null, calories_kcal: kcal, protein_g: 40, carbs_g: 50, fats_g: 20, items: null });
const plan = (date: string) => ({
  date,
  assignments: [{ id: 'a1', daily_meal_plan: { id: 'p1', name: 'Training day', notes: null, slots: [
    { id: 's-l', slot_label: 'lunch', order: 0, time_of_day: '12:30', meal_template: tpl('Chicken, rice and greens', 680), recipe_id: null, swaps: [] },
    { id: 's-d', slot_label: 'dinner', order: 0, time_of_day: '19:30', meal_template: tpl('Salmon, potatoes and green beans', 620), recipe_id: 'r1', swaps: [] },
  ] } }],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
});

describe('case 4: S17, the link on the meal plan page', () => {
  it('shows under a meal with a recipe only, and opens PlanMeal with today', async () => {
    mockParams = undefined;
    mockData = plan('2026-11-24');
    await render(<ClientDailyMealPlanScreen />);
    const link = await screen.findByTestId('daily-meal-plan-recipe-s-d');
    expect(within(link).getByText('Recipe and grocery list')).toBeTruthy();
    expect(link.props.accessibilityLabel).toBe('Recipe and grocery list for Salmon, potatoes and green beans');
    expect(screen.queryByTestId('daily-meal-plan-recipe-s-l')).toBeNull();
    await fireEvent.press(link);
    expect(mockNavigate).toHaveBeenCalledWith('PlanMeal', { date: '2026-11-24', slotId: 's-d' });
  });

  it('uses the page\'s own day when it shows another date; 44 pt at 320 x 568 and 130%', async () => {
    mockDims = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    mockParams = { date: '2026-11-26' };
    mockData = plan('2026-11-26');
    await render(<ClientDailyMealPlanScreen />);
    const link = await screen.findByTestId('daily-meal-plan-recipe-s-d');
    expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(link);
    expect(mockNavigate).toHaveBeenCalledWith('PlanMeal', { date: '2026-11-26', slotId: 's-d' });
  });
});
