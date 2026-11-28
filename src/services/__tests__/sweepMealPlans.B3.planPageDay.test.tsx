/**
 * SWEEP-MEAL-PLANS B3 (B-TEST, fails at 50ff9b2e): More > Meal plan shows the plan of the phone's today.
 *
 * The page opened with no date (MoreScreen.tsx:58, KitchenScreen.tsx:178, a notice's assignment link) reads
 * GET /me/meal-plan/today with no ?date (ClientDailyMealPlanScreen.tsx:116-117, useMealPlanToday(undefined)). Backend
 * main answers that read for the server's own day: planDay() is `new Date()` set to midnight (meal-plan-notice.ts:53-57)
 * on a server that runs with TZ=UTC, and echoes that day as `date`. The page draws it under "Today, {phone's day}"
 * (:207-208), ticks it from the phone's day log (:153, useTodayLog(shownDay)) and offers "Ate it as planned", which
 * logs to the phone's day (LogPlannedMealButton.tsx:120). From 4 pm in California (midnight UTC) until midnight, the
 * no-date read is tomorrow's: on the evening before a new plan starts she sees and logs tomorrow's meals as today's,
 * and on a plan's last evening the page says she has no plan while the Food tab (which sends ?date) still shows it.
 *
 * The fake server below answers as backend main does: with ?date, that day's plan; with no ?date, the server's
 * UTC day, which this case sets to the day after the phone's today (a California evening).
 * Real pieces: ClientDailyMealPlanScreen, useMealPlanToday and the app's queryClient. Stubbed as mealPlanRefresh.test.tsx
 * stubs them: the HTTP read, the route params, icons, the theme and the RefreshControl.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api', () => ({ __esModule: true, default: {}, logApi: {} }));
const mockToday = jest.fn();
jest.mock('../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: (date?: string) => mockToday(date) },
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: undefined }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock('../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary,
    primary: sc.accent, surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const R = require('react');
  return { __esModule: true, default: (props: object) => R.createElement(require('react-native').View, props) };
});
jest.mock('../../components/HapticPressable', () => require('react-native').Pressable);

import ClientDailyMealPlanScreen from '../../screens/client/ClientDailyMealPlanScreen';
import type { ClientTodayResponse, DailyMealPlanAssignmentWithPlan } from '../../api/mealTemplatesApi';
import { queryClient } from '../queryClient';
import { getTodayString } from '../../utils/date';

jest.setTimeout(30_000);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function assignment(id: string, name: string, meal: string, starts: string, ends: string | null): DailyMealPlanAssignmentWithPlan {
  return {
    id, daily_meal_plan_id: `plan-${id}`, client_id: 'client-1', assigned_by_coach_id: 'coach-1',
    starts_on: starts, ends_on: ends, created_at: '2026-11-01',
    daily_meal_plan: { id: `plan-${id}`, coach_id: 'coach-1', name, notes: null, created_at: '2026-11-01',
      archived_at: null, slots: [{ id: `slot-${id}`, daily_meal_plan_id: `plan-${id}`, meal_template_id: `m-${id}`,
        slot_label: 'dinner', order: 0, meal_template: { id: `m-${id}`, coach_id: 'coach-1', name: meal,
          calories_kcal: 600, protein_g: 40, carbs_g: 60, fats_g: 20, fiber_g: null, items: null,
          description: null, created_at: '2026-11-01', archived_at: null } }] },
  };
}

const today = getTodayString();
const tomorrow = addDays(today, 1);
// The coach's two runs: this week's plan ends today, next week's starts tomorrow (MealPlanAssignScreen's Starts and Ends).
const THIS_WEEK = assignment('a-this', 'Cut, week 1', 'Chicken rice bowl', addDays(today, -6), today);
const NEXT_WEEK = assignment('a-next', 'Cut, week 2', 'Salmon and greens', tomorrow, null);
/** Backend main's GET /me/meal-plan/today: ?date's day, or with no ?date the server's UTC day (here, the phone's tomorrow). */
function server(date?: string): ClientTodayResponse {
  const day = date ?? tomorrow;
  const runs = [THIS_WEEK, NEXT_WEEK].filter((a) => a.starts_on <= day && (!a.ends_on || a.ends_on >= day));
  return { date: day, assignments: runs, changes_today: [] };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  queryClient.clear();
  mockToday.mockReset();
  mockToday.mockImplementation((date?: string) => Promise.resolve({ data: server(date) }));
});
afterEach(() => queryClient.clear());

it('in the evening before a new plan starts, "Today’s meals" shows today’s plan, not tomorrow’s', async () => {
  await render(<QueryClientProvider client={queryClient}><ClientDailyMealPlanScreen /></QueryClientProvider>);
  await settle();
  // The masthead names the phone's today, and its log and "Ate it as planned" are the phone's today.
  expect(screen.getByText("Today's meals")).toBeTruthy();
  expect(await screen.findByText('Chicken rice bowl')).toBeTruthy();
  expect(screen.queryByText('Salmon and greens')).toBeNull();
});
