// HB-B1: Habits as the ring behind habitsRing; every tap on every state lands somewhere real.
// Flag off, the list is main's (HabitsFasting.launch and HabitsCheckInGate keep covering it).
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HabitsScreen from '../../HabitsScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { featureFlags } from '../../../../config/featureFlags';
import { colors, lightTokens } from '../../../../theme/tokens';

const mockGetAll = jest.fn();
const mockGet = jest.fn();
const mockLog = jest.fn();
const mockCreate = jest.fn();
const mockNavigate = jest.fn();
const mockSetOptions = jest.fn();
// One navigation object, as React Navigation gives; setOptions also feeds the Host's header slot below.
let mockHeader: ((o: { headerRight?: () => React.ReactNode }) => void) | undefined;
const mockNav = { navigate: (...a: unknown[]) => mockNavigate(...a), setOptions: (o: object) => { mockSetOptions(o); mockHeader?.(o); } };
const mockRing = jest.fn();
let mockCoachless = false;
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  habitsApi: {
    getAll: () => mockGetAll(),
    getLogs: jest.fn(async () => ({ data: [] })),
    create: (body: unknown) => mockCreate(body),
    logHabit: (id: string, body: unknown) => mockLog(id, body),
    delete: jest.fn(),
  },
  checkInsApi: { list: jest.fn(async () => ({ data: [] })), save: jest.fn() },
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', coach_id: 'c1' }) }));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] }) }));
jest.mock('../../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, status: 'active', confirmedActive: true, refreshEntitlement: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { habitsRing: true, romanCompetencePill: false } }));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-14' }));
jest.mock('../../../../components/roman/CompetencePill', () => () => null);
jest.mock('../../../../ui/haptics/haptics.service', () => {
  const fns: Record<string | symbol, jest.Mock> = {};
  return { HapticService: new Proxy(fns, { get: (t, k) => (t[k] ??= jest.fn()) }), setHapticsEnabled: jest.fn() };
});
jest.mock('../../../../theme/ThemeProvider', () => {
  const tokens = require('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', colors: tokens.colors, semanticColors: tokens.lightTokens }) };
});
jest.mock('../../../../ui/charts/StyleCMarks', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    SegmentedRing: (p: { label: string; testID?: string; children?: unknown }) => {
      mockRing(p);
      return createElement(View, { testID: p.testID, accessible: true, accessibilityLabel: p.label }, p.children);
    },
  };
});

const TODAY = '2026-10-14'; // a Wednesday
const log = (date: string) => ({ id: `l-${date}`, habit_id: 'x', user_id: 'u1', date: `${date}T00:00:00.000Z`, completed: true });
const habit = (id: string, name: string, extra: Record<string, unknown>) => ({
  id, user_id: 'u1', name, created_at: '', logs: [], schedule_kind: 'daily', schedule_days: [], run_days: null, best_run_days: null, ...extra,
});
const HABITS = [
  habit('h1', 'Drink 8 glasses of water', { logs: [log(TODAY)], run_days: 12, assigned_by_coach_id: 'c1', week: { planned: 7, done: 3 } }),
  habit('h2', 'Walk 30 minutes', { target_value: 8, best_run_days: 9, assigned_by_coach_id: 'c1', week: { planned: 7, done: 2 } }),
  habit('h3', 'Stretch 10 minutes', { schedule_kind: 'days', schedule_days: [1, 3, 5], logs: [log(TODAY)], run_days: 6, week: { planned: 3, done: 2 } }),
  habit('h4', 'Lights out by 11', { schedule_kind: 'days', schedule_days: [0, 1, 2, 4], week: { planned: 4, done: 2 } }),
  habit('h5', 'Read', { schedule_kind: 'times_per_week', times_per_week: 2, logs: [log('2026-10-12'), log('2026-10-13')], week: { planned: 2, done: 2 } }),
];
const SUMMARY = {
  today: TODAY,
  days: [[4, 4], [4, 3], [3, 2], [3, 0], [3, 0], [2, 0], [0, 0]].map(([planned, done], i) => ({ date: `2026-10-${12 + i}`, planned, done })),
};

function Host() {
  const [right, setRight] = React.useState<(() => React.ReactNode) | undefined>(undefined);
  mockHeader = (o) => { if ('headerRight' in o) setRight(() => o.headerRight); };
  return <>{right?.()}<HabitsScreen /></>;
}
const mount = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const v = await render(<QueryClientProvider client={qc}><Host /></QueryClientProvider>);
  await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
  return v;
};
const flags = featureFlags as { habitsRing: boolean };
const lastRing = (id: string) => [...mockRing.mock.calls].reverse().find(([p]) => p.testID === id)?.[0];

beforeEach(() => {
  jest.clearAllMocks();
  flags.habitsRing = true;
  mockCoachless = false;
  mockGetAll.mockResolvedValue({ data: HABITS });
  mockGet.mockResolvedValue({ data: SUMMARY });
  mockLog.mockResolvedValue({ data: {} });
  mockCreate.mockResolvedValue({ data: {} });
});

it('today: the ring has a part per habit planned today, the week line, the strip and the tiles', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByLabelText('Today, 2 of 3 habits done')).toBeTruthy());
  expect(v.getByText('2 of 3')).toBeTruthy();
  expect(lastRing('habits-ring').segments).toEqual(['done', 'planned', 'done']);
  expect(v.getByText('Wednesday')).toBeTruthy();
  expect(v.getByText('11 of 23 this week')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith('/habits/summary', { params: { from: '2026-10-12', to: '2026-10-18' } });
  await waitFor(() => expect(v.getByLabelText('Tuesday 13, 3 of 4 done')).toBeTruthy());
  expect(lastRing('habits-ring-day-2026-10-13').segments).toEqual(['done', 'done', 'done', 'missed']);
  expect(lastRing('habits-ring-day-2026-10-15').segments).toEqual(['planned', 'planned', 'planned']);
  expect(v.getByLabelText('Wednesday 14, 2 of 3 done')).toBeTruthy();
  expect(v.getByLabelText('Sunday 18')).toBeTruthy();
  expect(v.getByText('Tap a habit when it is done.')).toBeTruthy();
  expect(v.getByLabelText('Drink 8 glasses of water, done today, 12 days in a row, Sam added')).toBeTruthy();
  expect(v.getByLabelText('Walk 30 minutes, not done yet, Open · best run 9 days, Sam added')).toBeTruthy();
  expect(v.getByLabelText('Stretch 10 minutes, done today, 6 in a row on its days, You added')).toBeTruthy();
  expect(v.queryByText('Lights out by 11')).toBeNull();
  expect(v.queryByText('Read')).toBeNull();
});

it('the last tick closes the ring: the part draws, success haptic, logged for the client\'s today', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-tile-h2')).toBeTruthy());
  await fireEvent.press(v.getByTestId('habits-ring-tile-h2'));
  expect(mockLog).toHaveBeenCalledWith('h2', { date: TODAY, completed: true, value: 8 });
  expect(HapticService.success).toHaveBeenCalledTimes(1);
  expect(v.getByLabelText('Today, 3 of 3 habits done')).toBeTruthy();
  expect(lastRing('habits-ring')).toMatchObject({ drawIndex: 1, event: `h2:${TODAY}:1` });
  expect(v.getByText('Done · best run 9 days')).toBeTruthy();
  expect(v.getByTestId('habits-ring-tile-h2').props.accessibilityState).toMatchObject({ checked: true });
  expect(v.getByText('12 of 23 this week')).toBeTruthy();
});

it('a tick that does not close the day is a soft tap; an untick is a selection and logs false', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-tile-h1')).toBeTruthy());
  await fireEvent.press(v.getByTestId('habits-ring-tile-h1'));
  expect(mockLog).toHaveBeenCalledWith('h1', { date: TODAY, completed: false, value: 0 });
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  expect(v.getByLabelText('Today, 1 of 3 habits done')).toBeTruthy();
  await waitFor(() => expect(mockLog).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockGetAll).toHaveBeenCalledTimes(2));
  await fireEvent.press(v.getByTestId('habits-ring-tile-h1'));
  expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
});

it('a tick the server refuses goes back, with a calm line and the error haptic', async () => {
  mockLog.mockRejectedValueOnce(new Error('offline'));
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-tile-h2')).toBeTruthy());
  await fireEvent.press(v.getByTestId('habits-ring-tile-h2'));
  await waitFor(() => expect(v.getByTestId('habits-ring-unsaved')).toBeTruthy());
  expect(v.getByText('The habit was not updated. Try again.')).toBeTruthy();
  expect(v.getByLabelText('Today, 2 of 3 habits done')).toBeTruthy();
  expect(HapticService.error).toHaveBeenCalledTimes(1);
});

it('header: forest with Habits selected; Check-in opens today\'s check-in tab and the header goes back to bone', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-tab-habits')).toBeTruthy());
  expect(mockSetOptions).toHaveBeenCalledWith(expect.objectContaining({ headerStyle: { backgroundColor: lightTokens.surface.masthead }, headerTintColor: lightTokens.textOnAccent }));
  expect(v.getByTestId('habits-ring-tab-habits').props.accessibilityState).toEqual({ selected: true });
  await fireEvent.press(v.getByTestId('habits-ring-tab-checkin'));
  expect(HapticService.selection).toHaveBeenCalled();
  await waitFor(() => expect(v.getByTestId('checkin-save')).toBeTruthy());
  expect(mockSetOptions).toHaveBeenLastCalledWith({ headerStyle: { backgroundColor: colors.bone }, headerTintColor: colors.ink, headerRight: undefined });
  expect(v.queryByTestId('habits-ring-tab-habits')).toBeNull();
  await fireEvent.press(v.getByTestId('habits-tab-habits'));
  await waitFor(() => expect(v.getByTestId('habits-ring-screen')).toBeTruthy());
  expect(v.getByTestId('habits-ring-tab-habits')).toBeTruthy();
});

it('Add habit under the tiles opens today\'s Add habit sheet', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-add')).toBeTruthy());
  await fireEvent.press(v.getByTestId('habits-ring-add'));
  expect(v.getByTestId('add-habit-sheet')).toBeTruthy();
});

it('error: the sentence in the masthead and Try again reads the habits again', async () => {
  mockGetAll.mockRejectedValueOnce(new Error('offline'));
  const v = await mount();
  await waitFor(() => expect(v.getByText('Habits did not load. Check your connection, then try again.')).toBeTruthy());
  expect(v.getByText('Today')).toBeTruthy();
  await fireEvent.press(v.getByTestId('habits-ring-retry'));
  await waitFor(() => expect(v.getByLabelText('Today, 2 of 3 habits done')).toBeTruthy());
  expect(mockGetAll).toHaveBeenCalledTimes(2);
});

it('loading: the masthead and the rows wait with one spoken label', async () => {
  mockGetAll.mockReturnValue(new Promise(() => undefined));
  const v = await mount();
  expect(v.getByTestId('habits-ring-loading').props.accessibilityLabel).toBe('Loading habits');
});

it('empty, coached: Sam\'s words, Add habit opens the sheet, Ask Sam opens the coach thread', async () => {
  mockGetAll.mockResolvedValue({ data: [] });
  const v = await mount();
  await waitFor(() => expect(v.getByText('No habits yet')).toBeTruthy());
  expect(v.getByText('Habits from Sam')).toBeTruthy();
  expect(v.getByText('Sam can add habits for you, and you can add your own.')).toBeTruthy();
  await fireEvent.press(v.getByText('Ask Sam for habits'));
  expect(mockNavigate).toHaveBeenCalledWith('Messages');
  await fireEvent.press(v.getByTestId('habits-ring-add'));
  expect(v.getByTestId('add-habit-sheet')).toBeTruthy();
});

it('first, coachless: no Sam; an idea becomes a habit in one tap; Write your own opens the sheet', async () => {
  mockCoachless = true;
  mockGetAll.mockResolvedValue({ data: [] });
  const v = await mount();
  await waitFor(() => expect(v.getByText('Your ring')).toBeTruthy());
  expect(v.getByText('Start here')).toBeTruthy();
  expect(v.getByText('Each habit is one part of the ring. Start with one.')).toBeTruthy();
  expect(v.getByText('Ideas to start with')).toBeTruthy();
  expect(v.queryByText(/Sam/)).toBeNull();
  await fireEvent.press(v.getByLabelText('Lights out by 11, Sunday to Thursday'));
  expect(HapticService.mediumImpact).toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledWith({ name: 'Lights out by 11', category: 'custom', schedule_kind: 'days', schedule_days: [0, 1, 2, 3, 4] });
  await waitFor(() => expect(HapticService.success).toHaveBeenCalled());
  await fireEvent.press(v.getByTestId('habits-ring-write'));
  expect(v.getByTestId('add-habit-sheet')).toBeTruthy();
});

it('flag off: Habits is main\'s list, with no ring and no header change', async () => {
  flags.habitsRing = false;
  const v = await mount();
  await waitFor(() => expect(v.getByText('Habits & check-in')).toBeTruthy());
  expect(v.queryByTestId('habits-ring-screen')).toBeNull();
  expect(mockSetOptions).not.toHaveBeenCalled();
});
