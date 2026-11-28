/**
 * SWEEP-MEAL-PLANS B2 (B-TEST, fails at 50ff9b2e): a coach's plan change reaches the Food day when she comes back.
 *
 * The coach changes today's dinner. Backend main tells her ("Meal plan updated", MEAL_PLAN_UPDATED) while her phone
 * is in her pocket: the notice goes to the tray and no app code runs (BUILD-978 m#978 listed "background receipt,
 * app opened without a tap" as "outside: MEAL-PLAN-RESUME-M", which is not on this tree). She opens the app by its
 * icon. The Food tab is still mounted, so its plan read (FoodDayView.tsx:161-166, staleTime 5 minutes) never
 * re-reads: refetchOnWindowFocus is off (queryClient.ts), the return handler re-reads only the DM reads
 * (pushNotifications.ts:143-145, REFINE-985R3) and LogScreen's return handler only the day's log (LogScreen.tsx:197-201).
 * Her pull to refresh re-reads only the day's log too (LogScreen.tsx:709-716, clientStore refreshShownDay). So she
 * sees the old dinner, with no change note, and "Ate it as planned" logs the old meal.
 *
 * Real pieces: the app's queryClient singleton and installForegroundHandler. The Food day's plan read is a stand-in
 * with FoodDayView.tsx's key, read and staleTime (as mealPlanRefresh.test.tsx does). Stubbed: expo-notifications, the
 * HTTP read, and react-native's AppState listener (captured, then driven to 'active').
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: () => ({ remove: jest.fn() }),
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
jest.mock('../api', () => ({ __esModule: true, default: {}, logApi: {} }));
const mockToday = jest.fn();
jest.mock('../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: (date?: string) => mockToday(date) },
}));

import { AppState } from 'react-native';
import { queryClient } from '../queryClient';
import { installForegroundHandler } from '../pushNotifications';
import { getTodayString } from '../../utils/date';

type Answer = { date: string; assignments: Array<{ daily_meal_plan: { slots: Array<{ meal_template: { name: string } }> } }> };
const answer = (dinner: string): Answer => ({ date: getTodayString(), assignments: [{ daily_meal_plan: { slots: [{ meal_template: { name: dinner } }] } }] });

/** The Food day's plan read (FoodDayView.tsx:161-166): its key, its read and its 5 minutes. */
function FoodDayPlan() {
  const day = getTodayString();
  const plan = useQuery({
    queryKey: ['meal-plan', 'today', day],
    queryFn: () => mockToday(day) as Promise<Answer>,
    staleTime: 5 * 60 * 1000,
  });
  return <Text>{plan.data?.assignments[0]?.daily_meal_plan.slots[0]?.meal_template.name ?? 'loading'}</Text>;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
let appStateListeners: Array<(s: string) => void> = [];
let stop: (() => void) | undefined;

beforeEach(() => {
  jest.useRealTimers();
  queryClient.clear();
  mockToday.mockReset();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateListeners.push(cb);
    return { remove: () => { appStateListeners = appStateListeners.filter((x) => x !== cb); } };
  }) as unknown as typeof AppState.addEventListener);
  stop = installForegroundHandler();
});
afterEach(() => {
  stop?.();
  jest.restoreAllMocks();
  queryClient.clear();
});

it('a return to the front after the coach changed the plan re-reads the Food day’s plan and shows the new dinner', async () => {
  const realNow = Date.now;
  mockToday.mockResolvedValueOnce(answer('Chicken rice bowl'));
  await render(<QueryClientProvider client={queryClient}><FoodDayPlan /></QueryClientProvider>);
  expect(await screen.findByText('Chicken rice bowl')).toBeTruthy();
  expect(mockToday).toHaveBeenCalledTimes(1);

  // Hours later (well past the 5 minutes): the coach changed dinner while the app was behind.
  mockToday.mockResolvedValue(answer('Salmon and greens'));
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 4 * 60 * 60 * 1000);
  await act(async () => { appStateListeners.forEach((cb) => cb('background')); });
  await act(async () => { appStateListeners.forEach((cb) => cb('active')); });
  await settle();

  expect(mockToday).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('Salmon and greens')).toBeTruthy();
});
