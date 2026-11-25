/**
 * LO-927R3 B1: the C2 Style C timeline is one connected gutter (C_day, C_loading:
 * the line runs from stop to stop through every ring). TimelineRow's own comment
 * says "a line on to the next stop". This reads the rendered geometry of each
 * timeline the PR draws (meal list, meal loading, fasting history): for every
 * stop but the last, the gutter line must run on to the next stop's ring: the
 * space it leaves above the next ring may be no larger than the clearance it
 * already leaves below its own ring (3 pt in planStyleC), plus 1 pt. Fasting
 * history (no row padding) is the control row and passes at bd8b0a8a and 150371f5.
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
import FastingScreen from '../FastingScreen';
import { fastingApi } from '../../../services/api';

const mockDaily = jest.fn();
const mockTarget = null;
const slot = (id: string, label: string) => ({
  id, daily_meal_plan_id: 'dp', meal_template_id: `m-${id}`, slot_label: label, order: 0,
  meal_template: { id: `m-${id}`, coach_id: 'coach', name: `Meal ${id}`, calories_kcal: 400, protein_g: 30,
    carbs_g: 40, fats_g: 12, fiber_g: null, items: null, description: 'With a squeeze of lemon',
    created_at: '2026-10-01', archived_at: null },
});

type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
const flat = (n: Host) => (StyleSheet.flatten(n.props.style as ViewStyle) ?? {}) as ViewStyle;
const kids = (n: Host) => (n.children ?? []).filter((c): c is Host => typeof c === 'object');
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
// A timeline stop: a row whose first child is the 24 pt gutter (line + ring, hidden from readers).
function stops(root: unknown) {
  return hosts(root).filter((n) => n.type === 'View' && flat(n).flexDirection === 'row').map((row) => {
    const gutter = kids(row)[0];
    if (!gutter || flat(gutter).width !== 24 || gutter.props.accessibilityElementsHidden !== true) return null;
    const parts = kids(gutter);
    const lineNode = parts.find((p) => flat(p).position === 'absolute');
    const line = lineNode ? flat(lineNode) : null;
    const ring = parts.find((p) => flat(p).position !== 'absolute');
    const ringTop = Number(ring ? flat(ring).marginTop ?? 0 : 0);
    const below = line ? Number(line.top ?? 0) - ringTop - Number(ring ? flat(ring).height ?? 0 : 0) : 0;
    return { pad: Number(flat(row).paddingBottom ?? flat(row).padding ?? 0), line,
      ringTop, below };
  }).filter((s): s is NonNullable<typeof s> => s != null);
}
/** For each stop but the last, how much further short of the next ring its line stops than
 *  the clearance it leaves below its own ring (0 = connected as drawn). */
function gaps(root: unknown) {
  const list = stops(root);
  expect(list.length).toBeGreaterThanOrEqual(2);
  return list.slice(0, -1).map((s, i) => {
    const reach = s.line ? -Number(s.line.bottom ?? 0) : -Infinity;
    return Math.max(0, s.pad + list[i + 1].ringTop - reach - s.below - 1);
  });
}

const plan = {
  data: { date: '2026-10-13', assignments: [{ id: 'a1', daily_meal_plan_id: 'dp', client_id: 'u1',
    assigned_by_coach_id: 'coach', starts_on: '2026-10-01', ends_on: null, created_at: '2026-10-01',
    daily_meal_plan: { id: 'dp', coach_id: 'coach', name: "Sam's plan for today", notes: null,
      created_at: '2026-10-01', archived_at: null,
      slots: [slot('a', 'breakfast'), slot('b', 'lunch'), slot('c', 'dinner')] } }] },
  isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(),
};

it.each([
  ['meal plan day (P1)'],
  ['meal plan loading (P3)'],
])('LO-927R3 B1: the %s timeline line reaches the next stop', async (name) => {
  mockDaily.mockReturnValue(name.startsWith('meal plan day') ? plan
    : { data: undefined, isLoading: true, isError: false, isRefetching: false, refetch: jest.fn() });
  (fastingApi.getHistory as jest.Mock).mockResolvedValue({ data: [
    { id: 'f1', protocol: '16:8', start_time: '2026-10-06T08:00:00.000Z', end_time: '2026-10-07T00:00:00.000Z' },
    { id: 'f2', protocol: '16:8', start_time: '2026-10-04T08:00:00.000Z', end_time: '2026-10-05T00:00:00.000Z' },
    { id: 'f3', protocol: '18:6', start_time: '2026-10-02T08:00:00.000Z', end_time: '2026-10-02T18:00:00.000Z' },
  ] });
  const view = await render(name.startsWith('fasting') ? <FastingScreen /> : <ClientDailyMealPlanScreen />);
  if (name.startsWith('fasting')) await waitFor(() => expect(screen.getByText('Recent fasts')).toBeTruthy());
  const g = gaps(view.toJSON());
  view.unmount();
  expect(g).toEqual(g.map(() => 0));
});
