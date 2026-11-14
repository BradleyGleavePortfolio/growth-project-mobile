/**
 * LO-981 B3 (m#983 @ 438e0860): C2 C_day draws the day in clock order (7:40 am breakfast, 12:35 pm lunch, the now
 * line, 5:30 pm pre-workout up next, 7:30 pm dinner). The build keeps main's slot-label order (breakfast, lunch,
 * dinner, snack, preworkout, postworkout), so with the drawn time column the times run backwards, the gold now line
 * lands after the last meal in label order whose time has passed, and "Ate it as planned" goes to the wrong meal.
 * The mocks and fixtures below are Goal927.goal.test.tsx's own (lines 10-131 at this head).
 */
import React from 'react';
import { processColor, StyleSheet, type ViewStyle } from 'react-native';
import { render, screen, waitFor, within } from '@testing-library/react-native';
import { colors, gold, lightTokens } from '../../../theme/tokens';
import { clockOf } from '../../../utils/log/foodTimeline';

jest.mock('../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary,
    primary: sc.accent, surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, props) };
});
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
let mockParams: Record<string, string> | undefined;
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: mockParams }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: () => mockDaily() }));
const mockButtons: Array<{ planSlotId?: string; planned?: boolean }> = [];
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    plannedMealFromSlot: (s: { meal_template: { name: string } }) => ({ name: s.meal_template.name }),
    default: (p: { meal: { name: string }; planSlotId?: string; planned?: boolean }) => {
      mockButtons.push({ planSlotId: p.planSlotId, planned: p.planned });
      return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: `Log this meal: ${p.meal.name}`,
        style: { minHeight: 44 } }, React.createElement(Text, null, p.planned ? 'Ate it as planned' : 'Log this meal'));
    },
  };
});
let mockFlag = true;
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { get foodPlanChecklist() { return mockFlag; } } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { id: 'c1', name: 'Sam Lee' } }) }));
let mockLog: { data?: unknown; isError: boolean; isLoading: boolean } = { data: undefined, isError: false, isLoading: false };
const mockLogDates: string[] = [];
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: (date: string) => { mockLogDates.push(date); return { ...mockLog, refetch: jest.fn(), isRefetching: false }; },
}));
let mockTarget: Record<string, unknown> | null = null;
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: mockTarget, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ reportMacroDisplay: jest.fn(), useMacroDisplayMode: () => 'full' }));
const mockUser = { id: 'u1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  fastingApi: { getHistory: jest.fn(), start: jest.fn(), end: jest.fn(), deleteFast: jest.fn() },
}));
jest.mock('../../../utils/fastingAlert', () => ({ scheduleFastEndAlert: jest.fn(), cancelFastEndAlert: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../../../components/FadeInView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
});

import ClientDailyMealPlanScreen from '../ClientDailyMealPlanScreen';
import ClientMacrosScreen from '../ClientMacrosScreen';
import FastingScreen from '../FastingScreen';
import { fastingApi } from '../../../services/api';

const mockDaily = jest.fn();
const sc = lightTokens;
// Decorative parts (marks, gutter, tiles, the now line, bones, the gold rule) are hidden from readers, as on main.
const HIDDEN = { includeHiddenElements: true } as const;
const paint = (v: unknown) => (v && typeof v === 'object' && 'payload' in (v as object) ? (v as { payload: unknown }).payload : v);
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as Record<string, unknown>;
type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown): Host[] {
  const out: Host[] = [];
  const walk = (n: Host | Host[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root as Host | Host[] | null);
  return out;
}

// ---------- fixtures (fictional: client Alex, coach Sam) ----------
const slot = (id: string, label: string, name: string, kcal: number, time: string | null, description: string | null = null) => ({
  id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0, time_of_day: time,
  meal_template: { id: `m-${id}`, coach_id: 'coach', name, calories_kcal: kcal, protein_g: 30, carbs_g: 40, fats_g: 12,
    fiber_g: null, items: null, description, created_at: '2026-10-01', archived_at: null },
});
const NOTE = 'Protein at every meal. Water before coffee.';
const planOf = (slots: ReturnType<typeof slot>[], notes: string | null = NOTE) => ({
  data: { date: '2026-10-13', assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'u1', assigned_by_coach_id: 'coach',
    starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
    daily_meal_plan: { id: 'dp', coach_id: 'coach', name: 'Training day', notes, created_at: '2026-10-01', archived_at: null, slots } }] },
  isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(),
});
const DAY = [
  slot('a', 'breakfast', 'Greek yoghurt, oats and berries', 420, '07:40'),
  slot('b', 'lunch', 'Chicken, rice and greens', 680, '12:35'),
  slot('c', 'dinner', 'Salmon, potatoes and beans', 640, '18:30', 'Salmon 150 g, new potatoes 200 g, green beans'),
];
const entry = (id: string, slotId: string | null, meal: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, food_item_id: `fi-${id}`, user_id: 'u1', meal_type: meal, quantity_multiplier: 1, logged_at: '2026-10-13T08:00:00.000Z',
  food_item: { id: `fi-${id}`, name, calories: 400, protein_g: 30, carbs_g: 40, fat_g: 10 }, plan_slot_id: slotId, ...extra,
});
const LOG = { entries: [
  entry('e1', 'a', 'breakfast', 'Greek yoghurt, oats and berries'),
  entry('e2', 'b', 'lunch', 'Chicken, rice and greens', { original_quantity: 300, original_unit: 'g' }),
  entry('e3', null, 'snack', 'Flat white'),
], total_calories: 1560, total_protein_g: 97 };
const TARGET = { id: 't1', client_id: 'u1', coach_id: 'c1', calories_kcal: 2200, protein_g: 160, carbs_g: 220, fats_g: 70,
  fiber_g: 30, notes: 'Holding steady this block.', effective_from: '2026-10-01', macro_display_mode: 'full' };


it('LO-981 B3: C_day\'s own day in clock order: times run forward, the now line sits before pre-workout, which is up next', async () => {
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  mockParams = undefined; mockFlag = true; mockButtons.length = 0;
  mockTarget = TARGET;
  // C_day: breakfast and lunch eaten, 3:10 pm: the now line, then pre-workout (5:30 pm) up next, then dinner (7:30 pm).
  mockLog = { data: { entries: [
    entry('e1', 'a', 'breakfast', 'Greek yoghurt, oats and berries'),
    entry('e2', 'b', 'lunch', 'Chicken, rice and greens'),
  ], total_calories: 1100, total_protein_g: 60 }, isError: false, isLoading: false };
  mockDaily.mockReturnValue(planOf([
    slot('a', 'breakfast', 'Greek yoghurt, oats and berries', 420, '07:40'),
    slot('b', 'lunch', 'Chicken, rice and greens', 680, '12:35'),
    slot('c', 'dinner', 'Salmon, potatoes and green beans', 620, '19:30'),
    slot('p', 'preworkout', 'Banana and whey shake', 250, '17:30'),
  ]));
  jest.useFakeTimers({ now: new Date(2026, 9, 13, 15, 10) });
  try {
    await render(<ClientDailyMealPlanScreen />);
    const order = hosts(screen.toJSON()).map((n) => n.props.testID).filter((id) => typeof id === 'string'
      && /^daily-meal-plan-(now|mark-)/.test(id as string));
    expect(order).toEqual(['daily-meal-plan-mark-a', 'daily-meal-plan-mark-b', 'daily-meal-plan-now',
      'daily-meal-plan-mark-p', 'daily-meal-plan-mark-c']);
    const times = screen.getAllByText(/^\d{1,2}:\d{2} [ap]m$/).map((t) => t.props.children as string);
    expect(times).toEqual(['7:40 am', '12:35 pm', '5:30 pm', '7:30 pm']);
    const next = screen.getByTestId('daily-meal-plan-next-card');
    expect(within(next).getByText('Ate it as planned')).toBeTruthy();
    expect(mockButtons.filter((b) => b.planned).map((b) => b.planSlotId).pop()).toBe('p');
  } finally {
    jest.useRealTimers();
  }
});

describe.each([
  ['390/100', { width: 390, height: 844, scale: 2, fontScale: 1 }],
  ['320/130', { width: 320, height: 568, scale: 2, fontScale: 1.3 }],
] as const)('FIX-981 ordering class %s', (_profile, dims) => {
  type Meal = [id: string, label: string, time: string | null, order?: number];
  const cases: Array<[string, Meal[], string[], string[]]> = [
    ['all labels follow the clock', [
      ['d', 'dinner', '19:30'], ['p', 'preworkout', '17:30'], ['s', 'snack', '10:00'],
      ['l', 'lunch', '12:35'], ['b', 'breakfast', '07:40'], ['q', 'postworkout', '18:30'],
    ], ['b', 's', 'l', 'p', 'q', 'd'], ['Breakfast', 'Snack', 'Lunch', 'Pre-workout', 'Post-workout', 'Dinner']],
    ['ties preserve main label and slot order', [
      ['s', 'snack', '10:00'], ['b2', 'breakfast', '10:00', 2], ['b1', 'breakfast', '10:00', 1],
    ], ['b1', 'b2', 's'], ['Breakfast', 'Snack']],
    ['repeated labels regain an eyebrow after another label', [
      ['s2', 'snack', '15:00'], ['s1', 'snack', '10:00'], ['l', 'lunch', '12:00'],
    ], ['s1', 'l', 's2'], ['Snack', 'Lunch', 'Snack']],
    ['missing time retains the entire main order', [
      ['p', 'preworkout', '08:00'], ['d', 'dinner', '19:00'], ['b', 'breakfast', null],
    ], ['b', 'd', 'p'], ['Breakfast', 'Dinner', 'Pre-workout']],
    ['invalid time retains the entire main order', [
      ['p', 'preworkout', '08:00'], ['d', 'dinner', '19:00'], ['b', 'breakfast', 'not-a-time'],
    ], ['b', 'd', 'p'], ['Breakfast', 'Dinner', 'Pre-workout']],
  ];

  it.each(cases)('%s', async (_name, meals, expected, labels) => {
    mockDims = { ...dims }; mockParams = { date: '2026-10-12' }; mockFlag = true; mockButtons.length = 0;
    mockTarget = TARGET;
    mockLog = { data: { entries: [], total_calories: 0, total_protein_g: 0 }, isError: false, isLoading: false };
    const slots = meals.map(([id, label, time, order = 0]) => ({ ...slot(id, label, `Meal ${id}`, 400, time), order }));
    mockDaily.mockReturnValue(planOf(slots));
    const before = JSON.stringify(slots);
    await render(<ClientDailyMealPlanScreen />);
    const marks = hosts(screen.toJSON()).map((h) => h.props.testID)
      .filter((id) => typeof id === 'string' && id.startsWith('daily-meal-plan-mark-'));
    expect(marks).toEqual(expected.map((id) => `daily-meal-plan-mark-${id}`));
    expect(screen.getAllByRole('header').map((h) => h.props.children).filter((text) => labels.includes(text))).toEqual(labels);
    expect(JSON.stringify(slots)).toBe(before);
    expect(screen.queryByTestId('daily-meal-plan-now', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('daily-meal-plan-next-card')).toBeNull();
  });

  it('sorts two plans independently without merging their meals', async () => {
    mockDims = { ...dims }; mockParams = { date: '2026-10-12' }; mockFlag = true;
    mockTarget = TARGET; mockLog = { data: { entries: [] }, isError: false, isLoading: false };
    const first = planOf([slot('d1', 'dinner', 'Dinner one', 600, '19:00'), slot('p1', 'preworkout', 'Pre one', 300, '17:00')]);
    const second = planOf([slot('d2', 'dinner', 'Dinner two', 600, '18:00'), slot('p2', 'preworkout', 'Pre two', 300, '09:00')]);
    mockDaily.mockReturnValue({ ...first, data: { ...first.data, assignments: [
      first.data.assignments[0], { ...second.data.assignments[0], id: 'a2' },
    ] } });
    await render(<ClientDailyMealPlanScreen />);
    const marks = hosts(screen.toJSON()).map((h) => h.props.testID)
      .filter((id) => typeof id === 'string' && id.startsWith('daily-meal-plan-mark-'));
    expect(marks).toEqual(['p1', 'd1', 'p2', 'd2'].map((id) => `daily-meal-plan-mark-${id}`));
  });
});

it.each([999, 1000, 1990, 2380])('groups meal and total kcal consistently for %s without changing gram units', async (kcal) => {
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  mockParams = { date: '2026-10-12' }; mockTarget = null; mockFlag = true;
  mockLog = { data: { entries: [] }, isError: false, isLoading: false };
  mockDaily.mockReturnValue(planOf([slot('a', 'breakfast', 'Meal a', kcal, '07:40')]));
  await render(<ClientDailyMealPlanScreen />);
  const shown = kcal.toLocaleString('en-US');
  expect(screen.getByTestId('daily-meal-plan-total').props.children).toBe(`Day total ${shown} kcal • P 30g • C 40g • F 12g`);
  expect(screen.getByText(`${shown} kcal • P 30g • C 40g • F 12g`)).toBeTruthy();
});
