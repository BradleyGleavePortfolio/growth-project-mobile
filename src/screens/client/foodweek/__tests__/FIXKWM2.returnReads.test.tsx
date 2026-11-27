/**
 * FIX-KWM-2 N1 (LS-KITCHEN-WEEK-M-2 N1, operator call: "on return, refetch only the day reads and the week read, and
 * skip the 7 plan reads, if the plan reads cannot change from the Food tab"). The Food tab never writes a plan: the
 * Food day only reads ['meal-plan','today',day] (FoodDayView.tsx), the page's own plan key, and no Food tab file calls a
 * plan write. So back on the page the weekly read and the seven day reads go out again, and a plan read goes out again
 * only when it has no answer (a failed first read), so a day without dots still gets them back. At 6f035165 a return
 * read all seven plans again. Same harness as FIXKWM2.offlineKeepsWeek.test.tsx.
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
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}><FoodWeekScreen /></QueryClientProvider>);
}
const sentences = (days: string[]) => days.map((d) => screen.getByTestId(`food-week-row-${d}`).props.accessibilityLabel as string);

beforeEach(() => {
  jest.clearAllMocks();
  nav.listeners.length = 0;
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  online();
});

describe('FIX-KWM-2 N1: back on the page, the plan reads that answered are not read again', () => {
  const RANGES: Array<[string, boolean]> = [['this week', false], ['an earlier week', true]];
  it.each(RANGES)('%s: the weekly read and the seven day reads go out again, no plan read', async (_name, earlier) => {
    await mount();
    await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
    if (earlier) await fireEvent.press(screen.getByLabelText('Previous week'));
    const days = earlier ? EARLIER : DAYS;
    await waitFor(() => expect(sentences(days).every((s) => / of 4, /.test(s))).toBe(true));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const calls = () => [logApi.getWeekly, logApi.getDaily, mealTemplatesApi.todayForClient].map((fn) => jest.mocked(fn).mock.calls.length);
    const [weekly, daily, plan] = calls();
    await act(async () => { nav.listeners.forEach((cb) => cb()); });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(calls()).toEqual([weekly + 1, daily + 7, plan]);
    expect(sentences(days)[2]).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein');
  });

  it('a day whose plan read failed: back on the page reads that one plan again, and its dots and count come back', async () => {
    jest.mocked(mealTemplatesApi.todayForClient).mockImplementation(((date?: string) => (date === DAYS[2]
      ? Promise.reject(new Error('boom')) : Promise.resolve({ data: planFor(date as string) }))) as never);
    await mount();
    await waitFor(() => expect(sentences(DAYS)[0]).toBe('Wednesday, 4 of 4, 1,820 kcal, 146 g protein'));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(sentences(DAYS)[2]).toBe('Friday, 2,140 kcal, 128 g protein');
    online();
    const plan = jest.mocked(mealTemplatesApi.todayForClient).mock.calls.length;
    await act(async () => { nav.listeners.forEach((cb) => cb()); });
    await waitFor(() => expect(sentences(DAYS)[2]).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein'));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(jest.mocked(mealTemplatesApi.todayForClient).mock.calls.slice(plan)).toEqual([[DAYS[2]]]);
  });
});
