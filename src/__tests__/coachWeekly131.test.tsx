import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import api, { coachApi } from '../services/api';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import { WeeklySummaryTab } from '../screens/coach/client-detail/WeeklySummaryTab';
import { WorkoutsTab } from '../screens/coach/client-detail/WorkoutsTab';
import { FoodLogReviewSection } from '../screens/coach/client-detail/FoodLogReviewSection';
import { makeStyles } from '../screens/coach/client-detail/styles';
import type { WeekSummary } from '../screens/coach/client-detail/types';
import { mapCoachWorkoutSessions } from '../utils/workout/workoutLogging';
import { testColors } from '../screens/client/wearables/recoveryTestColors';

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: () => instance } };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('../utils/date', () => ({
  ...jest.requireActual('../utils/date'),
  // The device's day is October 7 during an ordinary Pacific evening.
  getTodayString: () => '2026-10-07',
}));
jest.mock('../components/coach/ai-entry/AdjustForClient', () => ({
  AdjustForClientEntry: () => null,
}));
const mockRefetch = jest.fn();
jest.mock('../hooks/useMacros', () => ({
  useCurrentMacrosForClient: () => ({
    data: null, isLoading: false, isError: false, refetch: mockRefetch,
  }),
}));

const styles = makeStyles(testColors);
const meals = [
  {
    id: 'meal-1', date: '2026-10-07', meal_type: 'lunch', quantity_multiplier: 1.5,
    original_quantity: 1.5, original_unit: 'serving', notes: 'After training',
    food_item: { name: 'Test lunch', calories: 200, protein_g: 20, carbs_g: 25, fat_g: 5 },
  },
  ...['meal-2', 'meal-3'].map((id) => ({
    id, date: '2026-10-06', meal_type: 'snack', quantity_multiplier: 0.333,
    food_item: { name: 'Test snack', calories: 100, protein_g: 10, carbs_g: 10, fat_g: 2 },
  })),
];
const workouts = [{
  id: 'workout-1', workout_name: 'Test strength', created_at: '2026-10-07T18:00:00Z',
  duration_minutes: 30,
  exercises: [{
    id: 'exercise-1', exercise_name: 'Bench press', sets_completed: 3,
    weight_per_set: [135, 135, 135], reps_per_set: [10, 10, 5],
  }],
}];
const timelineData = {
  meals, workouts, weights: [{ id: 'weight-1', date: '2026-10-07', weight_lbs: 180 }],
};
const summaryData = {
  profile: null, client_name: 'Test client',
  today: {
    entries: [meals[0]], total_calories: 300, total_protein_g: 30,
    total_carbs_g: 37.5, total_fat_g: 7.5,
  },
  recent_workouts: workouts, weight_logs: [], consent: { food_macros: true },
};
const week: WeekSummary = {
  weekStart: '2026-10-05', weekEnd: '2026-10-11', weekLabel: 'Oct 5 – Oct 11',
  totalCalories: 366.6, totalProtein: 36.66, totalWeightMoved: 3375,
  latestWeight: 180, workoutCount: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  (api.get as jest.Mock).mockReset().mockImplementation(async (url: string) => ({
    data: url.includes('/timeline') ? timelineData : summaryData,
  }));
});
afterEach(() => jest.restoreAllMocks());

it('weekly food totals apply each recorded portion and retain precision until display', async () => {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  await act(async () => { await result.current.loadWeeklySummaries(7); });
  const actual = result.current.weekSummaries[0];
  expect(actual.weekStart).toBe('2026-10-05');
  expect(actual.totalCalories).toBeCloseTo(366.6);
  expect(actual.totalProtein).toBeCloseTo(36.66);
  expect(api.get).toHaveBeenCalledWith('/coach/clients/client-test/timeline?days=7');
});

it('weekly protein reads the persisted protein_g field for each portion', async () => {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  await act(async () => { await result.current.loadWeeklySummaries(7); });
  expect(result.current.weekSummaries[0].totalProtein).toBeCloseTo(36.66);
});

it('weekly training volume matches the persisted workout shown in Workouts', async () => {
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  await act(async () => { await result.current.loadWeeklySummaries(30); });
  await act(async () => { await result.current.loadData(); });
  expect(result.current.weekSummaries[0].totalWeightMoved).toBe(3375);
  expect(result.current.weekSummaries[0].workoutCount).toBe(1);
  const view = await render(<WorkoutsTab
    workoutSessions={result.current.workoutSessions} colors={testColors} styles={styles}
  />);
  expect(view.getByText('3375')).toBeTruthy();
  expect(view.getByText('3 sets · 135 lb x 10, 135 lb x 10, 135 lb x 5')).toBeTruthy();
});

it('the summary wrapper requests the device calendar day by default', async () => {
  await coachApi.getClientSummary('client-test');
  expect(api.get).toHaveBeenCalledWith('/coach/clients/client-test/summary?date=2026-10-07');
});

it('the summary loader passes the same day used to label its food entries', async () => {
  const read = jest.spyOn(coachApi, 'getClientSummary');
  const { result } = await renderHook(() => useClientDetailData('client-test', testColors));
  await act(async () => { await result.current.loadData(); });
  expect(read).toHaveBeenCalledWith('client-test', '2026-10-07');
  expect(result.current.foodLogs[0]).toMatchObject({ date: '2026-10-07', calories: 300, protein: 30 });
  expect(result.current.totals.calories).toBe(300);
});

it('weekly collapsed and expanded details use lb and preserve the disclosure action', async () => {
  const toggle = jest.fn();
  const props = { summaries: [week], days: 7, onToggleWeek: toggle };
  const view = await render(<WeeklySummaryTab {...props} expandedWeeks={new Set()} />);
  expect(view.getByText('180 lb')).toBeTruthy();
  expect(view.getByText('Volume (lb)')).toBeTruthy();
  expect(view.getByText('367')).toBeTruthy();
  expect(view.getByText('37g')).toBeTruthy();
  await fireEvent.press(view.getByText(week.weekLabel));
  expect(toggle).toHaveBeenCalledWith(week.weekStart);
  await view.rerender(<WeeklySummaryTab {...props} expandedWeeks={new Set([week.weekStart])} />);
  expect(view.getByText('3,375 lb')).toBeTruthy();
  expect(view.getByText('367 kcal')).toBeTruthy();
  expect(view.getByText('1 workout')).toBeTruthy();
  expect(view.queryByText(/lbs/)).toBeNull();
});

it('Workouts uses lb while keeping the existing build action and set details', async () => {
  const build = jest.fn();
  const view = await render(<WorkoutsTab
    workoutSessions={mapCoachWorkoutSessions(workouts)} colors={testColors} styles={styles}
    onBuildWithAi={build} clientName="Test client"
  />);
  expect(view.getByText('Volume (lb)')).toBeTruthy();
  expect(view.getByText('3375')).toBeTruthy();
  await fireEvent.press(view.getByTestId('workouts-build-with-ai'));
  expect(build).toHaveBeenCalledTimes(1);
  expect(view.queryByText(/lbs/)).toBeNull();
});

it('food review shows readable eat dates and meal labels without changing recorded details', async () => {
  const view = await render(<FoodLogReviewSection clientId="client-test" colors={testColors} styles={styles} />);
  await view.findByText('Test lunch');
  expect(view.getByText('Wednesday, October 7')).toBeTruthy();
  expect(view.getByText('Lunch')).toBeTruthy();
  expect(view.getAllByText('Snack')).toHaveLength(2);
  expect(view.getByText('Test lunch')).toBeTruthy();
  expect(view.getByText(/1.5 serving/)).toBeTruthy();
  expect(view.getByText('Client note: After training')).toBeTruthy();
  expect(view.queryByText('2026-10-07')).toBeNull();
  expect(view.queryByText('lunch')).toBeNull();
});

it('food review retains feedback, meal plans, refresh and all three period filters', async () => {
  const messages = jest.fn();
  const plans = jest.fn();
  const view = await render(<FoodLogReviewSection
    clientId="client-test" colors={testColors} styles={styles}
    onOpenMessages={messages} onOpenMealPlans={plans}
  />);
  await view.findByText('Test lunch');
  await fireEvent.press(view.getByText('Send feedback'));
  await fireEvent.press(view.getByText('Meal plans'));
  await fireEvent.press(view.getByText('Refresh'));
  expect(messages).toHaveBeenCalledTimes(1);
  expect(plans).toHaveBeenCalledTimes(1);
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  for (const days of [14, 30, 7]) {
    await fireEvent.press(view.getByText(`${days}d`));
    expect(api.get).toHaveBeenLastCalledWith(`/coach/clients/client-test/timeline?days=${days}`);
  }
});
