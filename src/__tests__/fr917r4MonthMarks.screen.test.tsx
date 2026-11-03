/**
 * FR-917R4 own tests (B2, C2 edges) on the real Month presenter:
 * - a missed and a scheduled session on one day: camel ring, the label says both;
 *   a missed-only day: grey ring (data.missed) and says Missed, not Session.
 * - 320 and 360 pt at 100% and 130% text: rings fit their column with a gap,
 *   stay round around the date, and every day keeps its whole column to press.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { cleanup, render } from '@testing-library/react-native';
import type { CoachingSession } from '../api/schedulingApi';
import { CalendarWeekPage, type CalendarWeekData } from '../screens/client/calendar/CalendarWeekScreen';
import { colors, lightTokens } from '../theme/tokens';
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
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

const session = (id: string, day: string, status: CoachingSession['status'], hour = 12): CoachingSession => ({
  id, coach_id: 'coach-fixture', client_id: 'member-fixture', session_type_id: null,
  status, start_at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, end_at: `${day}T${String(hour).padStart(2, '0')}:30:00.000Z`,
  title: 'Check-in call', coach_notes_md: null, client_recap_md: null,
  video_provider: 'stub', video_url: null, video_meeting_id: null,
  calendar_provider: 'stub', calendar_event_id: null, approved_at: null,
  ended_at: null, end_reason: null, created_at: `${day}T09:00:00.000Z`,
  updated_at: `${day}T09:00:00.000Z`,
});
const data: CalendarWeekData = {
  coaches: [], workouts: [], checkIns: [], logs: [], loading: false, failed: false,
  refreshing: false, offline: false, hasData: true,
  sessions: [
    session('both-missed', '2026-10-14', 'no_show', 10), session('both-scheduled', '2026-10-14', 'scheduled', 15),
    session('only-missed', '2026-10-15', 'no_show'),
    // Neighbours: a ring on every day of one week row.
    ...['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
      .map((day) => session(`row-${day}`, day, 'scheduled')),
  ],
};
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });
const start = async (width = 390, fontScale = 1) => {
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width, height: 800, scale: 1, fontScale });
  return render(<CalendarWeekPage data={data} initialMonth="2026-10-01"
    onRefresh={jest.fn()} onSession={jest.fn()} onBook={jest.fn()} />);
};
type View = Awaited<ReturnType<typeof start>>;
const ringOf = (view: View, day: string) => {
  let ring: ViewStyle | undefined;
  let number: TextStyle | undefined;
  const walk = (node: ReturnType<View['getByTestId']> | string) => {
    if (typeof node === 'string') return;
    const style = StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>);
    if (style && Number(style.borderWidth) > 0) ring = style;
    if (style && style.fontFamily && typeof node.children[0] === 'string') number = style;
    node.children.forEach(walk);
  };
  walk(view.getByTestId(`month-day-${day}`));
  return { ring: ring!, number: number! };
};

it('a missed and a scheduled session on one day: camel ring, and the day says Session and Missed', async () => {
  const view = await start();
  expect(ringOf(view, '2026-10-14').ring.borderColor).toBe(colors.camel);
  const label = String(view.getByTestId('month-day-2026-10-14').props.accessibilityLabel);
  expect(label).toMatch(/\bSession\b/);
  expect(label).toMatch(/\bMissed\b/);
});

it('a missed-only day: the grey missed ring, and it says Missed, not Session', async () => {
  const view = await start();
  expect(ringOf(view, '2026-10-15').ring.borderColor).toBe(lightTokens.data.missed);
  const label = String(view.getByTestId('month-day-2026-10-15').props.accessibilityLabel);
  expect(label).toMatch(/\bMissed\b/);
  expect(label).not.toMatch(/\bSession\b/);
  // The legend draws the same grey ring beside the word.
  expect(view.getByText('Missed', { includeHiddenElements: true })).toBeTruthy();
});

describe.each([320, 360])('%i pt phone', (width) => {
  it.each([1, 1.3])('at %f text: a week of rings fits, with a gap, round around the date, whole column to press', async (fontScale) => {
    const view = await start(width, fontScale);
    const page = StyleSheet.flatten(view.getByTestId('week-page').props.style as StyleProp<ViewStyle>);
    const column = (width - 2 * Number(page.paddingHorizontal ?? page.padding ?? 0)) / 7;
    for (const day of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']) {
      const { ring, number } = ringOf(view, day);
      const size = Number(ring.minWidth);
      // Neighbouring rings never touch: at least 2 pt between them.
      expect(size).toBeLessThanOrEqual(column - 2);
      // Never smaller than the date it circles: the scaled line plus both borders.
      expect(size).toBeGreaterThanOrEqual(Number(number.lineHeight) * fontScale + 2 * Number(ring.borderWidth));
      expect(Number(ring.minHeight)).toBe(size);
      expect(Number(ring.borderRadius)).toBe(size / 2);
      // The date's own type still scales with the phone's text size (not disabled).
      expect(number.fontSize).toBe(20);
      const cell = StyleSheet.flatten(view.getByTestId(`month-day-${day}`).props.style as StyleProp<ViewStyle>);
      expect(cell.width).toBe(`${100 / 7}%`);
      expect(Number(cell.minHeight)).toBeGreaterThanOrEqual(56);
    }
  });
});
