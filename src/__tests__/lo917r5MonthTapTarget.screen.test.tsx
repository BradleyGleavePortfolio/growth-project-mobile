/**
 * LO-917R5 outside the fix (C): each Month day is a button one seventh of the page
 * wide; at 320 pt that column is 38.86 pt, under the 44 pt tap target. 360 and
 * 390 pt are controls (44.57 and 48.86 pt).
 */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import type { CoachingSession } from '../api/schedulingApi';
import { CalendarWeekPage, type CalendarWeekData } from '../screens/client/calendar/CalendarWeekScreen';

// Spy on the module object the screen reads, not a namespace-import copy.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native') as typeof import('react-native');

jest.mock('../hooks/useApi', () => ({}));
jest.mock('../hooks/useCalendar', () => ({}));
jest.mock('../hooks/useWorkoutBuilder', () => ({}));
jest.mock('../services/api', () => ({}));
jest.mock('../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (component: unknown) => component }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../hooks/useNetworkStatus', () => ({}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), error: jest.fn(), softImpact: jest.fn() },
}));
jest.mock('../ui/states/QuietStates', () => ({ QuietLoading: () => null }));
jest.mock('../ui', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PrimaryButton: () => null, TextLink: () => null,
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../theme/tokens').lightTokens,
    semanticColors: jest.requireActual('../theme/tokens').lightTokens,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn(),
}));

const session = (day: string): CoachingSession => ({
  id: `session-${day}`, coach_id: 'coach-fixture', client_id: 'member-fixture', session_type_id: null,
  status: 'scheduled', start_at: `${day}T12:00:00.000Z`, end_at: `${day}T12:30:00.000Z`,
  title: 'Check-in call', coach_notes_md: null, client_recap_md: null,
  video_provider: 'stub', video_url: null, video_meeting_id: null,
  calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
  ended_at: null, end_reason: null, created_at: `${day}T09:00:00.000Z`,
  updated_at: `${day}T09:00:00.000Z`,
});
const data: CalendarWeekData = {
  coaches: [], sessions: [session('2026-10-05'), session('2026-10-06')],
  workouts: [], checkIns: [], logs: [], loading: false, failed: false,
  refreshing: false, offline: false, hasData: true,
};
const start = () => render(<CalendarWeekPage data={data} initialMonth="2026-10-01"
  onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

async function dayTargets(width: number) {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({
    width, height: 800, scale: 1, fontScale: 1,
  });
  const view = await start();
  const page = StyleSheet.flatten(view.getByTestId('week-page').props.style as StyleProp<ViewStyle>);
  const padding = Number(page.paddingHorizontal ?? page.padding ?? 0);
  const gridWidth = width - 2 * padding;
  return ['2026-10-05', '2026-10-06'].map((day) => {
    const cell = view.getByTestId(`month-day-${day}`);
    const style = StyleSheet.flatten(cell.props.style as StyleProp<ViewStyle>);
    const tapWidth = gridWidth * parseFloat(String(style.width)) / 100;
    expect(Number.isFinite(tapWidth) && tapWidth > 0).toBe(true);
    return { tapWidth, tapHeight: Number(style.minHeight) };
  });
}

it.each([360, 390])('control: each Month day is at least 44 pt wide and tall on a %i pt phone', async (width) => {
  for (const cell of await dayTargets(width)) {
    expect(cell.tapWidth).toBeGreaterThanOrEqual(44);
    expect(cell.tapHeight).toBeGreaterThanOrEqual(44);
  }
});

it('LO-917R5 outside-fix C: each Month day is at least 44 pt wide on a 320 pt phone', async () => {
  for (const cell of await dayTargets(320)) expect(cell.tapWidth).toBeGreaterThanOrEqual(44);
});
