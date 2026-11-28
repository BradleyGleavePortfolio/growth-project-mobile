/**
 * SWEEP-MEAL-PLANS B2 (MEALPLAN-RESUME-M): a coach's plan change reaches the Food day when she comes back.
 *
 * The coach changes today's dinner. Backend main tells her ("Meal plan updated", MEAL_PLAN_UPDATED) while her phone
 * is in her pocket: the notice goes to the tray and no app code runs (m#978 listed "background receipt, app opened
 * without a tap" as outside its scope); with notifications off no notice comes at all. She opens the app by its icon.
 * The Food tab is still mounted, so its plan read (FoodDayView.tsx:162-167, staleTime 5 minutes) is not read again:
 * refetchOnWindowFocus is off (queryClient.ts) and no return handler read the plan. So she saw the old dinner, with no
 * change note, and "Ate it as planned" logged the old meal.
 *
 * The sweep's spec (btest/SWEEP-MEAL-PLANS-B2 f06fc70b) is case a. It drove installForegroundHandler; the return read
 * lives in the root sync mount (useFoodLogQueueSync, which RootNavigator mounts for a signed-in client), so it drives
 * that, and its Food-day stand-in reads as FoodDayView does (todayForClient(day), then the answer's data).
 *
 * Real pieces: the app's queryClient singleton, useFoodLogQueueSync and the plan reads' keys. Stand-ins: the Food day's
 * plan read (FoodDayView.tsx's key, read, staleTime and its error branch, :244), the HTTP read, the food log queue and
 * react-native's AppState listener (captured, then driven).
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';

const mockToday = jest.fn();
jest.mock('../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
  mealTemplatesApi: { todayForClient: (date?: string) => mockToday(date) },
}));
jest.mock('../foodLogSync', () => ({
  syncFoodLogQueue: jest.fn(async () => 0),
  readPendingFoodLogCount: jest.fn(async () => 0),
  subscribePendingFoodLogs: jest.fn(() => () => undefined),
}));

import { AppState } from 'react-native';
import { queryClient, settleAndClearQueryCache } from '../queryClient';
import { useFoodLogQueueSync } from '../../hooks/useFoodLogQueueSync';
import { addDays, getTodayString } from '../../utils/date';

type Answer = { date: string; assignments: Array<{ daily_meal_plan: { slots: Array<{ meal_template: { name: string } }> } }> };
const answer = (dinner: string, date = getTodayString()): Answer =>
  ({ date, assignments: [{ daily_meal_plan: { slots: [{ meal_template: { name: dinner } }] } }] });
const reply = (a: Answer) => Promise.resolve({ data: a });
function offline(): Error {
  return Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
}

/** A plan read under its key, read as every reader does (FoodDayView.tsx:162-167; the plan page's key is null). */
function PlanRead({ day, enabled = true }: { day: string | null; enabled?: boolean }) {
  const plan = useQuery({
    queryKey: ['meal-plan', 'today', day],
    queryFn: () => mockToday(day ?? undefined).then((r: { data: Answer }) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  // FoodDayView.tsx:244: a plan read in error replaces the plan with the error block.
  if (plan.isError) return <Text>plan-error</Text>;
  return <Text>{plan.data?.assignments[0]?.daily_meal_plan.slots[0]?.meal_template.name ?? 'loading'}</Text>;
}
/** RootNavigator.tsx:679 for a signed-in client (authState 'student'), online. */
function Root({ client = true }: { client?: boolean }) {
  useFoodLogQueueSync(client, true);
  return null;
}
const app = (reads: React.ReactNode, client = true) => (
  <QueryClientProvider client={queryClient}><Root client={client} />{reads}</QueryClientProvider>
);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
let appStateListeners: Array<(s: string) => void> = [];
const drive = async (...states: string[]) => {
  for (const s of states) await act(async () => { appStateListeners.forEach((cb) => cb(s)); });
  await settle();
};
/** She leaves the app (Home, another app) and comes back by its icon or the switcher. */
const comeBack = () => drive('inactive', 'background', 'active');

beforeEach(() => {
  queryClient.clear();
  mockToday.mockReset();
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
    appStateListeners.push(cb);
    return { remove: () => { appStateListeners = appStateListeners.filter((x) => x !== cb); } };
  }) as unknown as typeof AppState.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});

it('a. a return to the front after the coach changed the plan re-reads the Food day’s plan and shows the new dinner', async () => {
  const realNow = Date.now;
  mockToday.mockReturnValueOnce(reply(answer('Chicken rice bowl')));
  await render(app(<PlanRead day={getTodayString()} />));
  expect(await screen.findByText('Chicken rice bowl')).toBeTruthy();
  expect(mockToday).toHaveBeenCalledTimes(1);

  // Hours later (well past the 5 minutes): the coach changed dinner while the app was behind.
  mockToday.mockReturnValue(reply(answer('Salmon and greens')));
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 4 * 60 * 60 * 1000);
  await comeBack();

  expect(mockToday).toHaveBeenCalledTimes(2);
  expect(await screen.findByText('Salmon and greens')).toBeTruthy();
});

it('b. one read per return, and none from a render: two returns read twice, re-renders read nothing', async () => {
  mockToday.mockReturnValue(reply(answer('Chicken rice bowl')));
  const view = await render(app(<PlanRead day={getTodayString()} />));
  await screen.findByText('Chicken rice bowl');
  await settle();
  expect(mockToday).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3; i += 1) await view.rerender(app(<PlanRead day={getTodayString()} />));
  await settle();
  expect(mockToday).toHaveBeenCalledTimes(1);

  await comeBack();
  expect(mockToday).toHaveBeenCalledTimes(2);
  await comeBack();
  expect(mockToday).toHaveBeenCalledTimes(3);
  for (let i = 0; i < 3; i += 1) await view.rerender(app(<PlanRead day={getTodayString()} />));
  await settle();
  expect(mockToday).toHaveBeenCalledTimes(3);
});

it('c. no read while the app stays in front: a glance at Control Centre or the app switcher reads nothing', async () => {
  mockToday.mockReturnValue(reply(answer('Chicken rice bowl')));
  await render(app(<PlanRead day={getTodayString()} />));
  await screen.findByText('Chicken rice bowl');
  await settle();
  await drive('inactive', 'active');
  await drive('inactive', 'active');
  expect(mockToday).toHaveBeenCalledTimes(1);
});

it('d. offline: the return’s read fails, she keeps the plan she had, with no error, and it is not retried', async () => {
  mockToday.mockReturnValueOnce(reply(answer('Chicken rice bowl')));
  await render(app(<PlanRead day={getTodayString()} />));
  await screen.findByText('Chicken rice bowl');
  mockToday.mockImplementation(() => Promise.reject(offline()));
  await comeBack();
  // queryClient.ts would retry a failed query read twice; the return read is one read.
  await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
  expect(mockToday).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Chicken rice bowl')).toBeTruthy();
  expect(screen.queryByText('plan-error')).toBeNull();
  expect(queryClient.getQueryState(['meal-plan', 'today', getTodayString()])?.status).toBe('success');
});

// [R24] class-first: every reader of ['meal-plan', 'today', day] (FoodDayView.tsx:163, useMealTemplates.ts:182 with no
// day, PlanMealScreen.tsx:72, KitchenScreen.tsx:66, FoodWeekScreen.tsx:86) is read again with its own day, or none.
const yesterday = addDays(getTodayString(), -1);
it.each([
  ['the Food day, today (FoodDayView, the Kitchen card, the plan meal page)', getTodayString(), getTodayString()],
  ['the meal plan page with no day (useMealPlanToday)', null, undefined],
  ['another day (the Food day on yesterday, Food this week)', yesterday, yesterday],
])('e. %s is read again with its own day and shows the answer', async (_name, day, asked) => {
  mockToday.mockReturnValueOnce(reply(answer('Chicken rice bowl')));
  await render(app(<PlanRead day={day} />));
  await screen.findByText('Chicken rice bowl');
  mockToday.mockReturnValue(reply(answer('Salmon and greens')));
  await comeBack();
  expect(mockToday).toHaveBeenCalledTimes(2);
  expect(mockToday).toHaveBeenLastCalledWith(asked);
  expect(await screen.findByText('Salmon and greens')).toBeTruthy();
});

it('f. a plan read that is off (a coachless client) and a coach’s app read nothing on a return', async () => {
  mockToday.mockReturnValue(reply(answer('Chicken rice bowl')));
  const view = await render(app(<PlanRead day={getTodayString()} enabled={false} />));
  await comeBack();
  expect(mockToday).not.toHaveBeenCalled();
  view.unmount();
  await render(app(<PlanRead day={getTodayString()} />, false));
  await screen.findByText('Chicken rice bowl');
  await comeBack();
  expect(mockToday).toHaveBeenCalledTimes(1);
});

it('g. an answer that lands after sign-out (the cache cleared) is not written for the next person', async () => {
  mockToday.mockReturnValueOnce(reply(answer('Chicken rice bowl')));
  await render(app(<PlanRead day={getTodayString()} />));
  await screen.findByText('Chicken rice bowl');
  let release: (a: Answer) => void = () => undefined;
  mockToday.mockReturnValueOnce(new Promise((resolve) => { release = (a) => resolve({ data: a }); }));
  await comeBack();
  expect(mockToday).toHaveBeenCalledTimes(2);
  // Sign-out empties the app's cache (authActions.ts signOut: settleAndClearQueryCache, which cancels only query
  // fetches); the read made before it answers afterwards, and the mounted read is given a fresh entry.
  await act(async () => { await settleAndClearQueryCache(); });
  await act(async () => { release(answer('Salmon and greens')); });
  await settle();
  expect(queryClient.getQueryData(['meal-plan', 'today', getTodayString()])).not.toEqual(answer('Salmon and greens'));
});

it('h. a read already under way answers the return: no second read', async () => {
  let release: (a: Answer) => void = () => undefined;
  mockToday.mockReturnValueOnce(new Promise((resolve) => { release = (a) => resolve({ data: a }); }));
  await render(app(<PlanRead day={getTodayString()} />));
  await comeBack();
  expect(mockToday).toHaveBeenCalledTimes(1);
  await act(async () => { release(answer('Salmon and greens')); });
  expect(await screen.findByText('Salmon and greens')).toBeTruthy();
});
