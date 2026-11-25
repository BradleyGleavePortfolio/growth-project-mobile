/**
 * LO-981 B2 (m#981 @ 26c847b9): GOAL-927-M PLAN row "Start/End fast filled forest; C8 outlined, forest words"
 * (RULING 12) is CLOSE in the PLAN but the build keeps main's filled forest buttons. The mocks below are
 * Goal927.goal.test.tsx's own (lines 10-100 at this head).
 */
import React from 'react';
import { processColor, StyleSheet, type ViewStyle } from 'react-native';
import { render, screen, waitFor, within } from '@testing-library/react-native';
import { lightTokens } from '../../../theme/tokens';
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

const H = 3600000;
const outlined = (label: string) => {
  const btn = flat(screen.getByLabelText(label));
  const words = hosts(screen.getByLabelText(label)).filter((n) => n.type === 'Text').map(flat);
  return { bg: btn.backgroundColor, borderWidth: btn.borderWidth, borderColor: btn.borderColor, ink: words[0]?.color };
};

it('LO-981 B2: Start fast and End fast are C8\'s outlined buttons (paper ground, forest outline, forest words)', async () => {
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  const start = new Date(Date.now() - 5 * H);
  (fastingApi.getHistory as jest.Mock).mockResolvedValue({ data: [
    { id: 'run', protocol: '16:8', start_time: start.toISOString(), end_time: null },
  ] });
  const running = await render(<FastingScreen />);
  await waitFor(() => expect(screen.getByLabelText('End fast')).toBeTruthy());
  const end = outlined('End fast');
  running.unmount();

  (fastingApi.getHistory as jest.Mock).mockResolvedValue({ data: [] });
  await render(<FastingScreen />);
  await waitFor(() => expect(screen.getByLabelText('Start fast')).toBeTruthy());
  const startBtn = outlined('Start fast');

  for (const b of [end, startBtn]) {
    expect(b.bg).not.toBe(sc.accent);
    expect(Number(b.borderWidth)).toBeGreaterThanOrEqual(1);
    expect(b.borderColor).toBe(sc.accent);
    expect([sc.accent, sc.accentText]).toContain(b.ink);
  }
});
