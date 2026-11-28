/**
 * FIX-KWM-2 C1 (LS-KITCHEN-WEEK-M-2 C1, OPERATOR RULING Almalfi 15:0x PST 11-27, two-way, undo "offline week error"):
 * when she comes back to the food week page with no connection, the page keeps the last good week she was shown: its
 * rows, their plan meal dots and counts, the average line and the dashed target line. S8 ("Your week could not load.
 * ...") shows only when the range has no answer yet (weekly.isError && weekly.data === undefined). The same rule holds
 * on This week and on an earlier week, for the return read and for a pull. At aa5bd865 a failed re-read replaced the
 * shown week with S8 (weekly.isSuccess false), dropped every row's dots (each day read's isSuccess false) and, on a
 * pull, dropped the dashed line (target.isError). Same harness as LSKWM2.returnSpinner.btest.test.tsx: the real screen,
 * the api mocked at its edge, fictional fixtures (client Jordan, coach Sam).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary, primary: sc.accent,
    surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('../../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const nav = {
    navigate: jest.fn(), goBack: jest.fn(), listeners: [] as Array<() => void>,
    addListener: jest.fn((event: string, cb: () => void) => { if (event === 'focus') nav.listeners.push(cb); return () => undefined; }),
  };
  return { NavigationContext: React.createContext(nav), useNavigation: () => nav, __nav: nav };
});
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, key: string) => mockFlags[key] ?? false }),
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'jordan', coach_id: 'sam' }) }));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  logApi: { getWeekly: jest.fn(), getDaily: jest.fn() },
}));
jest.mock('../../../../api/mealTemplatesApi', () => ({ mealTemplatesApi: { todayForClient: jest.fn() } }));
jest.mock('../../../../api/macrosApi', () => ({ macrosApi: { currentForSelf: jest.fn() } }));

import { logApi } from '../../../../services/api';
import { mealTemplatesApi } from '../../../../api/mealTemplatesApi';
import { macrosApi } from '../../../../api/macrosApi';
import FoodWeekScreen from '../FoodWeekScreen';

const nav = jest.requireMock('@react-navigation/native').__nav as { listeners: Array<() => void> };
const DAYS = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
const EARLIER = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
const NUMBERS: Array<[number, number]> = [[1820, 146], [1790, 151], [2140, 128], [1960, 139], [1610, 118], [1840, 146], [1210, 87]];
const DONE = [4, 4, 2, 3, 2, 4, 2];
const SLOTS = [['s1', 'breakfast', 'Oats and berries'], ['s2', 'lunch', 'Chicken bowl'], ['s3', 'snack', 'Greek yoghurt'],
  ['s4', 'dinner', 'Salmon and rice']] as const;
const PLAN = {
  id: 'dp', coach_id: 'sam', name: 'Cut, week 3', notes: null, created_at: '2026-09-01', archived_at: null,
  slots: SLOTS.map(([id, label, name]) => ({ id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0,
    time_of_day: null, meal_template: { id: `m-${id}`, coach_id: 'sam', name, calories_kcal: 450, protein_g: 35, carbs_g: 40,
      fats_g: 14, fiber_g: null, items: null, description: null, created_at: '2026-09-01', archived_at: null } })),
};
const planFor = (date: string) => ({ date, assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'jordan',
  assigned_by_coach_id: 'sam', starts_on: '2026-09-01', ends_on: null, created_at: '2026-09-01', daily_meal_plan: PLAN }] });
let n = 0;
const entry = (meal: string, name: string, slotId: string) => ({ id: `e${++n}`, food_item_id: `f${n}`, user_id: 'jordan',
  meal_type: meal, quantity_multiplier: 1, food_item: { id: `f${n}`, name, calories: 450, protein_g: 35, carbs_g: 40, fat_g: 14 },
  plan_slot_id: slotId });
const linked = (done: number) => SLOTS.slice(0, done).map(([id, label, name]) => entry(label, name, id));
const rows = (days: string[]) =>
  days.map((date, i) => ({ date, calories: NUMBERS[i][0], protein_g: NUMBERS[i][1], carbs_g: 0, fat_g: 0 }));

/** Every read answers, as the server does with a connection. */
function online() {
  jest.mocked(logApi.getWeekly).mockImplementation((start: string) =>
    Promise.resolve({ data: rows(start === DAYS[0] ? DAYS : EARLIER) }) as never);
  jest.mocked(logApi.getDaily).mockImplementation((date: string) =>
    Promise.resolve({ data: { entries: linked(DONE[Math.max(DAYS.indexOf(date), EARLIER.indexOf(date))]) } }) as never);
  jest.mocked(mealTemplatesApi.todayForClient).mockImplementation(((date?: string) => Promise.resolve({ data: planFor(date as string) })) as never);
  jest.mocked(macrosApi.currentForSelf).mockImplementation((() => Promise.resolve({ data: { calories_kcal: 1850, protein_g: 140 } })) as never);
}
/** No connection: every read fails as axios does when no answer comes back. */
function offline() {
  const noAnswer = () => Promise.reject(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));
  [logApi.getWeekly, logApi.getDaily, mealTemplatesApi.todayForClient, macrosApi.currentForSelf]
    .forEach((fn) => jest.mocked(fn).mockImplementation(noAnswer as never));
}
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}><FoodWeekScreen /></QueryClientProvider>);
}
const failed = (key: unknown[]) => client.getQueryState(key)?.status === 'error';
const sentences = (days: string[]) => days.map((d) => screen.getByTestId(`food-week-row-${d}`).props.accessibilityLabel as string);
const spinner = () => screen.getByTestId('food-week').props.refreshControl.props.refreshing as boolean;
const OFFLINE_S8 = 'Your week could not load. Check your connection, then try again.';

beforeEach(() => {
  jest.clearAllMocks();
  nav.listeners.length = 0;
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  online();
});

describe('FIX-KWM-2 C1: offline, the page keeps the last good week she was shown', () => {
  const KEPT: Array<[string, 'back on the page' | 'a pull', boolean, string, string]> = [
    ['this week', 'back on the page', false, '1,860 kcal and 138 g protein a day, on average.', 'Dashed line: 1,850 kcal target. Gold dot: today so far.'],
    ['an earlier week', 'back on the page', true, '1,767 kcal and 131 g protein a day, on average.', 'Dashed line: 1,850 kcal target.'],
    ['this week', 'a pull', false, '1,860 kcal and 138 g protein a day, on average.', 'Dashed line: 1,850 kcal target. Gold dot: today so far.'],
    ['an earlier week', 'a pull', true, '1,767 kcal and 131 g protein a day, on average.', 'Dashed line: 1,850 kcal target.'],
  ];
  it.each(KEPT)('%s, %s with no connection: the rows, their counts, the average and the target line stay; no S8',
    async (_name, how, earlier, average, legend) => {
      await mount();
      await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
      if (earlier) await fireEvent.press(screen.getByLabelText('Previous week'));
      const days = earlier ? EARLIER : DAYS;
      await waitFor(() => expect(sentences(days)[2]).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein'));
      await waitFor(() => expect(sentences(days).every((s) => / of 4, /.test(s))).toBe(true));
      const shown = sentences(days);
      const weeklyCalls = jest.mocked(logApi.getWeekly).mock.calls.length;
      offline();
      if (how === 'back on the page') await act(async () => { nav.listeners.forEach((cb) => cb()); });
      else await act(async () => { screen.getByTestId('food-week').props.refreshControl.props.onRefresh(); });
      // The re-reads went out and failed (so this is a failed re-read over a cached week, not an untouched cache).
      await waitFor(() => expect(failed(['food', 'week', days[0]])).toBe(true));
      await waitFor(() => expect(days.every((d) => failed(['food', 'log', d]))).toBe(true));
      if (how === 'a pull') {
        await waitFor(() => expect(days.every((d) => failed(['meal-plan', 'today', d]))).toBe(true));
        await waitFor(() => expect(failed(['macros', 'me', 'current'])).toBe(true));
      }
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(jest.mocked(logApi.getWeekly).mock.calls.length).toBe(weeklyCalls + 1);
      expect(screen.queryByTestId('food-week-error')).toBeNull();
      expect(screen.queryByText(OFFLINE_S8)).toBeNull();
      expect(sentences(days)).toEqual(shown);
      expect(screen.getByText(average)).toBeTruthy();
      expect(screen.getByText(legend)).toBeTruthy();
      expect(screen.getByText('Plan meals done')).toBeTruthy();
      expect(spinner()).toBe(false);
    });

  const S8: Array<[string, boolean]> = [['this week', false], ['an earlier week', true]];
  it.each(S8)('%s with no answer yet and no connection: S8 with Try again, no rows, no average', async (_name, earlier) => {
    if (!earlier) offline();
    await mount();
    if (earlier) {
      await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
      offline();
      await fireEvent.press(screen.getByLabelText('Previous week'));
    }
    expect(await screen.findByText(OFFLINE_S8)).toBeTruthy();
    expect(screen.getByRole('header', { name: earlier ? 'Earlier week' : 'This week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryAllByTestId(/^food-week-row-/)).toHaveLength(0);
    expect(screen.queryByText(/on average/)).toBeNull();
  });
});
