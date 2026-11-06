/**
 * LO-927R2 B1 (m#927 @ bd8b0a8a): the C2 plan screens paint the pull-down above
 * the masthead forest (planStyleC PlanMasthead overscroll, mast.ground #2C4A36),
 * so the iOS pull-to-refresh spinner draws on forest. Its tint must stand out from
 * that forest (non-text 3:1), as the app's other forest pull-downs do
 * (HealthFitnessTab, CalendarWeekScreen: tintColor textOnAccent). At the reviewed
 * head all three screens tint it sc.accent / colors.accent, which is #2C4A36: 1:1.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockRefresh: Record<string, unknown>[] = [];
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: Record<string, unknown>) => {
    mockRefresh.push(props);
    return React.createElement(require('react-native').View, props);
  } };
});
jest.mock('../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...sc, background: sc.bgPrimary,
    primary: sc.accent, surface: sc.bgSurface, textSecondary: sc.textMuted } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => require('react-native').Pressable);
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: undefined }) }));
jest.mock('../../../api/mealTemplatesApi', () => ({
  SLOT_LABELS: ['breakfast', 'lunch', 'dinner', 'snack', 'preworkout', 'postworkout'],
}));
jest.mock('../../../hooks/useMealTemplates', () => ({ useMealPlanToday: () => ({ data: { date: '2026-10-13', assignments: [] },
  isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() }) }));
jest.mock('../../../components/mealplan/LogPlannedMealButton', () => ({
  __esModule: true, plannedMealFromSlot: (s: unknown) => s, default: () => null,
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { id: 'c1', name: 'Sam Lee' } }) }));
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: () => ({ data: { total_calories: 1200 }, isError: false, isLoading: false, refetch: jest.fn() }),
}));
jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForSelf: () => ({ data: { id: 't1', client_id: 'u1', coach_id: 'c1', calories_kcal: 2200, protein_g: 160,
    carbs_g: 220, fats_g: 70, fiber_g: 30, notes: null, effective_from: '2026-10-01', macro_display_mode: 'full' },
  isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('../../../macros/macroDisplayStore', () => ({ reportMacroDisplay: jest.fn(), useMacroDisplayMode: () => 'full' }));
const mockUser = { id: 'u1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  fastingApi: { getHistory: jest.fn(() => Promise.resolve({ data: [] })), start: jest.fn(), end: jest.fn(), deleteFast: jest.fn() },
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
import { mast } from '../mealplan/planStyleC';

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const cases: [string, React.ComponentType][] = [
  ['Meal plan', ClientDailyMealPlanScreen],
  ['Macro targets', ClientMacrosScreen],
  ['Fasting', FastingScreen],
];

it.each(cases)('LO-927R2 B1: %s pull-to-refresh spinner stands out from the forest pull-down (3:1)', async (_name, Screen) => {
  mockRefresh.length = 0;
  render(<Screen />);
  await waitFor(() => expect(mockRefresh.length).toBeGreaterThan(0));
  const tint = String(mockRefresh[mockRefresh.length - 1].tintColor);
  expect(tint).toMatch(/^#[0-9A-Fa-f]{6}$/);
  expect(contrast(tint, mast.ground)).toBeGreaterThanOrEqual(3);
});
