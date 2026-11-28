/**
 * LS-KITCHEN-WEEK-M-1 B1 (LS seat, m#1008 @ 00d8ef92): back on the food week page after logging a food for one of
 * the shown days on the Food tab, that day's numbers and plan meal dots are read again, on every range (the brief's
 * "Every state: on return to the page ... the weekly read ... fresh again"; the class line "a week row says what the
 * Food day says for that date"). At 00d8ef92 an earlier range reads nothing again (FoodWeekScreen.tsx:101) and this
 * week reads again only today's day reads (:103), so a past day keeps its old dots beside its new numbers.
 * Same harness as FoodWeek.test.tsx: the real screen, the api mocked at its edge, fictional fixtures (Jordan, coach Sam).
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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
const HIDDEN = { includeHiddenElements: true } as const;
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
const rows = (days: string[], numbers: Array<[number, number]>) =>
  days.map((date, i) => ({ date, calories: numbers[i][0], protein_g: numbers[i][1], carbs_g: 0, fat_g: 0 }));

/** The server as it stands; `logged` adds what she logged on the Food tab: a day's new numbers and plan meals done. */
function serve(logged: { day: string; numbers: [number, number]; done: number } | null) {
  const numbersFor = (days: string[]) => days.map((d, i) => (logged && d === logged.day ? logged.numbers : NUMBERS[i]));
  jest.mocked(logApi.getWeekly).mockImplementation((start: string) =>
    Promise.resolve({ data: start === DAYS[0] ? rows(DAYS, numbersFor(DAYS)) : rows(EARLIER, numbersFor(EARLIER)) }) as never);
  jest.mocked(logApi.getDaily).mockImplementation((date: string) => {
    const i = Math.max(DAYS.indexOf(date), EARLIER.indexOf(date));
    return Promise.resolve({ data: { entries: linked(logged && date === logged.day ? logged.done : DONE[i]) } }) as never;
  });
  jest.mocked(mealTemplatesApi.todayForClient).mockImplementation(((date?: string) => Promise.resolve({ data: planFor(date as string) })) as never);
  jest.mocked(macrosApi.currentForSelf).mockImplementation((() => Promise.resolve({ data: { calories_kcal: 1850, protein_g: 140 } })) as never);
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}><FoodWeekScreen /></QueryClientProvider>);
}
const label = (day: string) => screen.getByTestId(`food-week-row-${day}`).props.accessibilityLabel as string;
const comeBack = () => act(async () => { nav.listeners.forEach((cb) => cb()); });

beforeEach(() => {
  jest.clearAllMocks();
  nav.listeners.length = 0;
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  serve(null);
});

describe('LS-KITCHEN-WEEK-M-1 B1: back on the page, every shown day is read again', () => {
  it('an earlier week: a day she filled in on the Food tab shows its new numbers and dots', async () => {
    await mount();
    await screen.findByText('1,860 kcal and 138 g protein a day, on average.');
    await fireEvent.press(screen.getByLabelText('Previous week'));
    await waitFor(() => expect(label(EARLIER[2])).toBe('Friday, 2 of 4, 2,140 kcal, 128 g protein'));
    // On the Food tab she goes back to that Friday and logs the two plan meals she had missed.
    serve({ day: EARLIER[2], numbers: [3040, 198], done: 4 });
    await comeBack();
    await waitFor(() => expect(label(EARLIER[2])).toBe('Friday, 4 of 4, 3,040 kcal, 198 g protein'));
    expect(within(screen.getByTestId(`food-week-row-${EARLIER[2]}`)).getByText('3,040 kcal, 198 g', HIDDEN)).toBeTruthy();
  });

  it('this week: yesterday filled in on the Food tab shows its new dots beside its new numbers', async () => {
    await mount();
    await waitFor(() => expect(label(DAYS[4])).toBe('Sunday, 2 of 4, 1,610 kcal, 118 g protein'));
    // On the Food tab she goes back to Sunday and logs one more plan meal.
    serve({ day: DAYS[4], numbers: [2060, 153], done: 3 });
    await comeBack();
    await waitFor(() => expect(label(DAYS[4])).toBe('Sunday, 3 of 4, 2,060 kcal, 153 g protein'));
  });
});
