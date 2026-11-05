/**
 * STYLE-MEALPLAN-M guard: the C2 Style C look must not hide a number or a
 * control. On the meal plan, macros and fasting screens no text is clipped to
 * a line count, shrunk to fit or kept from growing with the phone's text size
 * (so at 130% a day total or a target wraps instead of being cut), and every
 * action keeps a 44 pt floor.
 */
import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

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
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: () => mockDaily() }));
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    plannedMealFromSlot: (s: { id: string }) => s,
    default: () => React.createElement(Pressable, { accessibilityRole: 'button', style: { minHeight: 44 } },
      React.createElement(Text, null, 'Log this meal')),
  };
});
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { id: 'c1', name: 'Sam Lee' } }) }));
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: () => ({ data: { total_calories: 2450, total_protein_g: 190, total_carbs_g: 200, total_fat_g: 90 },
    isError: false, isLoading: false, refetch: jest.fn() }),
}));
let mockMacrosLoading = false;
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: mockMacrosLoading ? undefined : mockTarget, isLoading: mockMacrosLoading,
    isError: false, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ reportMacroDisplay: jest.fn(), useMacroDisplayMode: () => 'full' }));
const mockUser = { id: 'u1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  fastingApi: { getHistory: jest.fn(), start: jest.fn(), end: jest.fn(), deleteFast: jest.fn() },
}));
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
const LONG = 'Slow-roasted salmon with lemon, dill, new potatoes and a very long green salad';
const slot = (id: string, label: string, kcal: number) => ({
  id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0,
  meal_template: { id: `m-${id}`, coach_id: 'coach', name: id === 'a' ? LONG : 'Greek yoghurt, oats and berries',
    calories_kcal: kcal, protein_g: 42, carbs_g: 55, fats_g: 22, fiber_g: null, items: null,
    description: 'Logged with a change: extra avocado', created_at: '2026-10-01', archived_at: null },
});
const mockTarget = {
  id: 't1', client_id: 'u1', coach_id: 'c1', calories_kcal: 2200, protein_g: 160, carbs_g: 220, fats_g: 70,
  fiber_g: 30, notes: 'Protein at every meal. Water before coffee.', effective_from: '2026-10-01', macro_display_mode: 'full',
};

type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown = screen.toJSON()): Host[] {
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
function textProblems() {
  return hosts().filter((n) => n.type === 'Text' && (n.props.numberOfLines || n.props.adjustsFontSizeToFit
    || n.props.allowFontScaling === false)).map((n) => JSON.stringify(n.children));
}
function smallButtons() {
  const buttons = hosts().filter((n) => n.props.accessibilityRole === 'button');
  expect(buttons.length).toBeGreaterThan(0);
  return buttons.filter((b) => {
    const st = (StyleSheet.flatten(b.props.style as ViewStyle) ?? {}) as ViewStyle;
    return !(typeof st.minHeight === 'number' && st.minHeight >= 44);
  }).map((b) => String(b.props.accessibilityLabel ?? 'button'));
}

beforeEach(() => jest.clearAllMocks());

it('meal plan: the day total, every meal and every Log this meal stay whole', async () => {
  mockDaily.mockReturnValue({ data: { date: '2026-10-13', assignments: [{
    id: 'a1', daily_meal_plan_id: 'dp', client_id: 'u1', assigned_by_coach_id: 'coach', starts_on: '2026-10-01',
    ends_on: null, created_at: '2026-10-01', daily_meal_plan: { id: 'dp', coach_id: 'coach', name: "Sam's plan for today",
      notes: 'Protein at every meal.', created_at: '2026-10-01', archived_at: null,
      slots: [slot('a', 'breakfast', 420), slot('b', 'lunch', 680)] } }] },
    isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() });
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByTestId('daily-meal-plan-total').props.children).toBe('Day total 1100 kcal • P 84g • C 110g • F 44g');
  expect(screen.getByText(LONG)).toBeTruthy();
  expect(screen.getAllByText('Log this meal')).toHaveLength(2);
  expect(textProblems()).toEqual([]);
  expect(smallButtons()).toEqual([]);
});

it('meal plan error: Try again is a full-size forest button', async () => {
  mockDaily.mockReturnValue({ data: undefined, isLoading: false, isError: true, isRefetching: false, refetch: jest.fn() });
  await render(<ClientDailyMealPlanScreen />);
  expect(screen.getByText('Could not load this meal plan. Pull to retry.')).toBeTruthy();
  expect(smallButtons()).toEqual([]);
  expect(textProblems()).toEqual([]);
});

it('macros: the day target, eaten line and every over-target number stay whole', async () => {
  await render(<ClientMacrosScreen />);
  expect(screen.getByText('2200')).toBeTruthy();
  expect(screen.getByText('2450 kcal eaten today')).toBeTruthy();
  expect(screen.getByText('190g eaten / 160g target · 30g over target')).toBeTruthy();
  expect(textProblems()).toEqual([]);
});

it('fasting: Start fast, the protocols and the history keep a 44 pt floor and are never cut', async () => {
  (fastingApi.getHistory as jest.Mock).mockResolvedValue({ data: [
    { id: 'f1', protocol: '16:8', start_time: '2026-10-06T08:00:00.000Z', end_time: '2026-10-07T00:00:00.000Z' },
  ] });
  await render(<FastingScreen />);
  await waitFor(() => expect(screen.getByText('Start fast')).toBeTruthy());
  expect(screen.getByText('Recent fasts')).toBeTruthy();
  const start = hosts().find((n) => n.props.accessibilityLabel === 'Start fast');
  expect((StyleSheet.flatten(start?.props.style as ViewStyle) as ViewStyle).minHeight).toBeGreaterThanOrEqual(44);
  expect(smallButtons()).toEqual([]);
  expect(textProblems()).toEqual([]);
});

// FIX-927 (fix round 1) rows: the K5 target tiles, the meal tiles and the loading bones.
it('macros: the masthead tiles show each target the card below measures against', async () => {
  await render(<ClientMacrosScreen />);
  for (const [k, v, label] of [['protein', '160g', 'Protein'], ['carbs', '220g', 'Carbs'], ['fat', '70g', 'Fats']]) {
    const tile = screen.getByTestId(`macros-tile-${k}`);
    expect(tile.props.accessible).toBe(true);
    expect(screen.getAllByText(v).length).toBeGreaterThan(0);
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
  expect(screen.queryByTestId('macros-tile-fiber')).toBeNull();
  expect(screen.getByTestId('macros-note')).toBeTruthy();
  expect(textProblems()).toEqual([]);
});

it('meal plan: each meal gets one cream tile, hidden from readers, and the note shows once', async () => {
  mockDaily.mockReturnValue({ data: { date: '2026-10-13', assignments: [{
    id: 'a1', daily_meal_plan_id: 'dp', client_id: 'u1', assigned_by_coach_id: 'coach', starts_on: '2026-10-01',
    ends_on: null, created_at: '2026-10-01', daily_meal_plan: { id: 'dp', coach_id: 'coach', name: "Sam's plan for today",
      notes: 'Protein at every meal.', created_at: '2026-10-01', archived_at: null,
      slots: [slot('a', 'breakfast', 420), slot('b', 'lunch', 680)] } }] },
    isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() });
  await render(<ClientDailyMealPlanScreen />);
  for (const id of ['a', 'b']) {
    const art = screen.getByTestId(`daily-meal-plan-art-${id}`, { includeHiddenElements: true });
    expect(art.props.accessibilityElementsHidden).toBe(true);
    expect(art.props.importantForAccessibility).toBe('no-hide-descendants');
  }
  expect(screen.getAllByText('Protein at every meal.')).toHaveLength(1);
  expect(screen.getByTestId('daily-meal-plan-note')).toBeTruthy();
});

// LO-927R2 C3, class over the three screens (kept above the C1 test, whose mid-test
// unmount leaves later renders in this file empty): while loading, a reader hears that
// the screen is loading, in main's words ("Loading", or macros' own sentence).
it.each([
  ['meal plan', 'Loading'],
  ['macros', 'Loading daily targets...'],
  ['fasting', 'Loading'],
])('loading: the %s screen tells a reader it is loading (LO-927R2 C3)', async (name, words) => {
  mockMacrosLoading = name === 'macros';
  mockDaily.mockReturnValue({ data: undefined, isLoading: true, isError: false, isRefetching: false, refetch: jest.fn() });
  (fastingApi.getHistory as jest.Mock).mockReturnValue(new Promise(() => undefined));
  const Screen = name === 'meal plan' ? ClientDailyMealPlanScreen : name === 'macros' ? ClientMacrosScreen : FastingScreen;
  const view = await render(<Screen />);
  const spoken = hosts(view.toJSON()).filter((n) => n.props.accessibilityElementsHidden !== true).some((n) =>
    n.props.accessibilityLabel === words || (n.type === 'Text' && (n.children ?? []).join('') === words));
  view.unmount();
  mockMacrosLoading = false;
  expect(spoken).toBe(true);
});

it('loading: the plan and fasting bones are shapes only, never an unnamed progress bar (LO-927 C1)', async () => {
  const unnamed = () => hosts().filter((n) => (n.props.accessible === true || n.props.accessibilityRole === 'progressbar')
    && !n.props.accessibilityLabel && !(n.children ?? []).some((c) => typeof c === 'string'
      || (typeof c === 'object' && c.type === 'Text'))).map((n) => String(n.props.testID ?? n.type));
  mockDaily.mockReturnValue({ data: undefined, isLoading: true, isError: false, isRefetching: false, refetch: jest.fn() });
  await render(<ClientDailyMealPlanScreen />);
  expect(unnamed()).toEqual([]);
  screen.unmount();
  (fastingApi.getHistory as jest.Mock).mockReturnValue(new Promise(() => undefined));
  await render(<FastingScreen />);
  const bones = screen.getByTestId('fasting-loading', { includeHiddenElements: true });
  expect(bones.props.accessibilityElementsHidden).toBe(true);
  expect(bones.props.accessible).toBeUndefined();
  expect(bones.props.accessibilityRole).toBeUndefined();
  expect(unnamed()).toEqual([]);
});
