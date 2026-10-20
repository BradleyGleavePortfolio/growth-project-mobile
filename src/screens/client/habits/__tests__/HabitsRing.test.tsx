// HB-B1: Habits as the ring behind habitsRing; every tap on every state lands somewhere real.
// Flag off, the list is main's (HabitsFasting.launch and HabitsCheckInGate keep covering it).
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HabitsScreen from '../../HabitsScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { featureFlags } from '../../../../config/featureFlags';
import { colors, lightTokens } from '../../../../theme/tokens';
import { plusDays } from '../ring/ringModel';

const mockGetAll = jest.fn();
const mockGet = jest.fn();
const mockGetLogs = jest.fn();
let mockToday = '2026-10-14';
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
    getLogs: (date: string) => mockGetLogs(date),
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
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => mockToday }));
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
  // GET /habits/logs?date: that day's ticks among the habits the server holds now.
  mockGetLogs.mockImplementation(async (date: string) => {
    const held = mockGetAll.getMockImplementation();
    const { data } = held ? await held() : { data: [] };
    return { data: (data as { id: string; logs: { date: string }[] }[]).flatMap((h) => h.logs.filter((l) => l.date.startsWith(date)).map((l) => ({ ...l, habit_id: h.id }))) };
  });
  mockLog.mockResolvedValue({ data: {} });
  mockCreate.mockResolvedValue({ data: {} });
  mockToday = TODAY;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(false);
});
afterEach(() => jest.useRealTimers());

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

it('a strip day up to today opens in the ring, dashed gaps and its date, and ticks for that day; today brings it back', async () => {
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-pick-2026-10-13')).toBeTruthy());
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-13'));
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(lastRing('habits-ring')).toMatchObject({ label: 'Tuesday 13, 1 of 4 done', segments: ['missed', 'missed', 'missed', 'done'] }));
  expect(v.getByText('Tuesday')).toBeTruthy();
  expect(v.getByText('Tuesday, October 13')).toBeTruthy();
  expect(v.getByTestId('habits-ring-pick-2026-10-13').props.accessibilityState).toEqual({ selected: true });
  expect(v.getByLabelText('Walk 30 minutes, not done on Tuesday 13, Open · best run 9 days, Sam added')).toBeTruthy();
  expect(v.getByLabelText('Read, done on Tuesday 13, You added')).toBeTruthy();
  // The server's answer: Tuesday is ticked and this week moves.
  mockGetAll.mockResolvedValue({ data: HABITS.map((h) => (h.id === 'h2' ? { ...h, logs: [log('2026-10-13')], week: { planned: 7, done: 3 } } : h)) });
  await fireEvent.press(v.getByTestId('habits-ring-tile-h2'));
  expect(mockLog).toHaveBeenCalledWith('h2', { date: '2026-10-13', completed: true, value: 8 });
  expect(lastRing('habits-ring').label).toBe('Tuesday 13, 2 of 4 done');
  expect(v.getByTestId('habits-ring-pick-2026-10-13').props.accessibilityLabel).toBe('Tuesday 13, 2 of 4 done');
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-14'));
  expect(lastRing('habits-ring').label).toBe('Today, 2 of 3 habits done');
  await waitFor(() => expect(v.getByText('12 of 23 this week')).toBeTruthy());
});

// Tuesday 13 holds an every-day habit (open), a Tuesdays habit (done), a twice-a-week habit met Monday and Wednesday
// (not ticked Tuesday: no part, as HB3's summary) and a Mondays habit (not that day: no tile).
it.each([
  ['every day, open that day', 'd', false, 'Tuesday 13, 2 of 2 done', 0],
  ['chosen days, done that day', 'c', true, 'Tuesday 13, 0 of 2 done', undefined],
  ['times a week, met on other days, open that day', 'f', false, 'Tuesday 13, 2 of 3 done', 2],
] as const)('a past day counts as HB3 does (%s): picking it writes nothing; a tick and an untick move only that day', async (_n, id, was, after, drawIndex) => {
  mockGetAll.mockResolvedValue({ data: [
    habit('d', 'Walk 30 minutes', {}),
    habit('c', 'Lights out by 11', { schedule_kind: 'days', schedule_days: [2], logs: [log('2026-10-13')] }),
    habit('f', 'Read', { schedule_kind: 'times_per_week', times_per_week: 2, logs: [log('2026-10-12'), log(TODAY)] }),
    habit('m', 'Stretch 10 minutes', { schedule_kind: 'days', schedule_days: [1] }),
  ] });
  mockGet.mockResolvedValue({ data: { today: TODAY, days: [{ date: '2026-10-13', planned: 2, done: 1 }] } });
  const v = await mount();
  const tuesday = () => v.getByTestId('habits-ring-pick-2026-10-13').props.accessibilityLabel;
  await waitFor(() => expect(tuesday()).toBe('Tuesday 13, 1 of 2 done'));
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-13'));
  await waitFor(() => expect(lastRing('habits-ring')).toMatchObject({ label: 'Tuesday 13, 1 of 2 done', segments: ['missed', 'done'] }));
  expect(tuesday()).toBe('Tuesday 13, 1 of 2 done');
  expect(v.queryByTestId('habits-ring-tile-m')).toBeNull();
  expect(mockLog).not.toHaveBeenCalled();
  await fireEvent.press(v.getByTestId(`habits-ring-tile-${id}`));
  expect(mockLog).toHaveBeenLastCalledWith(id, { date: '2026-10-13', completed: !was, value: was ? 0 : 1 });
  expect(lastRing('habits-ring')).toMatchObject({ label: after, drawIndex });
  expect(tuesday()).toBe(after);
  await waitFor(() => expect(mockGetAll.mock.calls.length).toBeGreaterThan(1));
  await act(async () => {});
  await fireEvent.press(v.getByTestId(`habits-ring-tile-${id}`));
  expect(mockLog).toHaveBeenLastCalledWith(id, { date: '2026-10-13', completed: was, value: was ? 1 : 0 });
  expect(lastRing('habits-ring').label).toBe('Tuesday 13, 1 of 2 done');
  expect(tuesday()).toBe('Tuesday 13, 1 of 2 done');
});

it.each([false, true])('a future day is never logged: "Cannot log future events", red italic, spoken, gone by itself (Reduce Motion %s)', async (reduce) => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(reduce);
  const v = await mount();
  await waitFor(() => expect(v.getByTestId('habits-ring-pick-2026-10-15')).toBeTruthy());
  jest.useFakeTimers();
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-15'));
  expect(v.getByText('Cannot log future events')).toHaveStyle({ fontStyle: 'italic', color: colors.error });
  expect(v.getByTestId('habits-ring-future')).toHaveStyle({ opacity: reduce ? 1 : 0 });
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Cannot log future events');
  expect(mockLog).not.toHaveBeenCalled();
  expect(HapticService.selection).not.toHaveBeenCalled();
  expect(lastRing('habits-ring').label).toBe('Today, 2 of 3 habits done');
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(v.queryByText('Cannot log future events')).toBeNull();
});

it('a day with nothing planned: "Nothing planned today" (a past day: "Nothing planned on Tuesday") over the client\'s habits, no 0 of 0 and no tiles', async () => {
  // Wednesday: Stretch is Monday and Friday, Lights out is Sunday and Monday, both from October 1.
  mockGetAll.mockResolvedValue({ data: [{ ...HABITS[2], schedule_days: [1, 5], logs: [], starts_on: '2026-10-01' }, { ...HABITS[3], schedule_days: [0, 1], starts_on: '2026-10-01' }] });
  const v = await mount();
  await waitFor(() => expect(v.getByText('Nothing planned today')).toBeTruthy());
  expect(v.getByText('Stretch 10 minutes')).toBeTruthy();
  expect(v.getByText('Lights out by 11')).toBeTruthy();
  expect(v.queryByText('0 of 0')).toBeNull();
  expect(v.queryByTestId('habits-ring-tile-h3')).toBeNull();
  expect(v.queryByText('Tap a habit when it is done.')).toBeNull();
  expect(v.getByTestId('habits-ring-add')).toBeTruthy();
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-12'));
  await waitFor(() => expect(lastRing('habits-ring').label).toBe('Monday 12, 0 of 2 done'));
  expect(v.getByTestId('habits-ring-tile-h3')).toBeTruthy();
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-13'));
  await waitFor(() => expect(v.getByTestId('habits-ring-unplanned')).toHaveTextContent('Nothing planned on Tuesday'));
  expect(v.getByText('Tuesday, October 13')).toBeTruthy();
  expect(v.getByText('Stretch 10 minutes')).toBeTruthy();
  expect(v.getByText('Lights out by 11')).toBeTruthy();
  expect(v.queryByText('0 of 0')).toBeNull();
  expect(v.queryByTestId('habits-ring-tile-h3')).toBeNull();
});

// HB-B1c, Monday 19: Walk every day from Wednesday 7, done Monday 12 to Saturday 17; Sunday 18 missed, so the run
// shows ended (#HB3-OPEN-YESTERDAY) until Sunday is ticked. The server's answers follow the tick it holds.
const MONDAY = '2026-10-19';
const START = '2026-10-07';
let mockSunday = false;
const walked = () => [...['12', '13', '14', '15', '16', '17'], ...(mockSunday ? ['18'] : [])].map((d) => `2026-10-${d}`);
const walk = () => habit('w', 'Walk 30 minutes', {
  starts_on: START, logs: walked().map(log), run_days: mockSunday ? 7 : null, best_run_days: mockSunday ? 7 : 6, week: { planned: 7, done: 0 },
});
const weekOf = (from: string) => {
  const days = Array.from({ length: 7 }, (_, i) => plusDays(from, i)).map((date) => ({ date, planned: Number(date >= START), done: Number(walked().includes(date)) }));
  const sum = (k: 'planned' | 'done') => days.reduce((n, d) => n + d[k], 0);
  return { today: MONDAY, days, habits: [{ id: 'w', planned: sum('planned'), done: sum('done') }] };
};
const mountMonday = () => {
  mockToday = MONDAY;
  mockSunday = false;
  mockGetAll.mockImplementation(async () => ({ data: [walk()] }));
  mockGet.mockImplementation(async (_url: string, o: { params: { from: string } }) => ({ data: weekOf(o.params.from) }));
  mockLog.mockImplementation(async () => { mockSunday = true; return { data: {} }; });
  return mount();
};
const asked = (from: string) => mockGet.mock.calls.filter(([, o]) => o?.params?.from === from).length;

it('Monday: Previous week opens the missed Sunday; its tick moves 6 of 7 last week to 7 of 7 and heals the run, from the server', async () => {
  const v = await mountMonday();
  await waitFor(() => expect(v.getByText('0 of 7 this week')).toBeTruthy());
  expect(v.getByLabelText('Walk 30 minutes, not done yet, Open · best run 6 days, You added')).toBeTruthy();
  expect(v.queryByLabelText('Next week')).toBeNull();
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-20'));
  expect(v.getByText('Cannot log future events')).toBeTruthy();
  await fireEvent.press(v.getByLabelText('Previous week'));
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(v.getByText('6 of 7 last week')).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith('/habits/summary', { params: { from: '2026-10-12', to: '2026-10-18' } });
  await waitFor(() => expect(lastRing('habits-ring')).toMatchObject({ label: 'Sunday 18, 0 of 1 done', segments: ['missed'] }));
  expect(v.getByText('Monday')).toBeTruthy();
  expect(v.getByTestId('habits-ring-pick-2026-10-18').props.accessibilityState).toEqual({ selected: true });
  expect(v.getByLabelText('Saturday 17, 1 of 1 done')).toBeTruthy();
  expect(v.getByLabelText('Walk 30 minutes, not done on Sunday 18, Open · best run 6 days, You added')).toBeTruthy();
  const before = asked('2026-10-12');
  await fireEvent.press(v.getByTestId('habits-ring-tile-w'));
  expect(mockLog).toHaveBeenCalledWith('w', { date: '2026-10-18', completed: true, value: 1 });
  expect(HapticService.success).toHaveBeenCalledTimes(1);
  expect(lastRing('habits-ring')).toMatchObject({ label: 'Sunday 18, 1 of 1 done', drawIndex: 0 });
  await waitFor(() => expect(v.getByText('7 of 7 last week')).toBeTruthy());
  expect(asked('2026-10-12')).toBeGreaterThan(before);
  expect(v.getByLabelText('Walk 30 minutes, done on Sunday 18, 7 days in a row, You added')).toBeTruthy();
  // The strip picks any day of last week; Next week comes back to today.
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-12'));
  await waitFor(() => expect(lastRing('habits-ring').label).toBe('Monday 12, 1 of 1 done'));
  expect(v.getByText('7 of 7 last week')).toBeTruthy();
  await fireEvent.press(v.getByLabelText('Next week'));
  expect(lastRing('habits-ring').label).toBe('Today, 0 of 1 habits done');
  expect(v.getByText('0 of 7 this week')).toBeTruthy();
  expect(v.getByText('7 days in a row')).toBeTruthy();
  expect(v.queryByLabelText('Next week')).toBeNull();
});

it('an earlier week keeps the date line; the strip stops at the first habit\'s start and a day before it cannot be picked', async () => {
  const v = await mountMonday();
  await waitFor(() => expect(v.getByLabelText('Previous week')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Previous week'));
  await waitFor(() => expect(v.getByText('6 of 7 last week')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Previous week'));
  await waitFor(() => expect(v.getByText('Sunday, October 11')).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith('/habits/summary', { params: { from: '2026-10-05', to: '2026-10-11' } });
  expect(v.queryByText(/last week/)).toBeNull();
  await waitFor(() => expect(lastRing('habits-ring')).toMatchObject({ label: 'Sunday 11, 0 of 1 done', segments: ['missed'] }));
  expect(mockGetLogs).toHaveBeenCalledWith('2026-10-11');
  expect(v.queryByLabelText('Previous week')).toBeNull();
  await waitFor(() => expect(v.getByTestId('habits-ring-pick-2026-10-06')).toBeTruthy());
  const tuesday = v.getByTestId('habits-ring-pick-2026-10-06');
  expect(tuesday.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(tuesday);
  expect(lastRing('habits-ring').label).toBe('Sunday 11, 0 of 1 done');
  await fireEvent.press(v.getByTestId('habits-ring-pick-2026-10-07'));
  await waitFor(() => expect(lastRing('habits-ring').label).toBe('Wednesday 7, 0 of 1 done'));
  expect(v.getByText('Wednesday, October 7')).toBeTruthy();
  await fireEvent.press(v.getByLabelText('Next week'));
  await waitFor(() => expect(lastRing('habits-ring').label).toBe('Sunday 18, 0 of 1 done'));
});

// A past day and its week show only what the server holds for them (GET /habits keeps each habit's latest 30 ticks).
const pastRing = (day: string) => mockRing.mock.calls.some(([p]) => p.testID === 'habits-ring' && p.label.startsWith(day));
const FAILED = 'Habits did not load. Check your connection, then try again.';

it('a ticked day older than the 30-tick list waits for its own read, then shows done and unticks', async () => {
  let answer: (v: unknown) => void = () => undefined;
  mockGetLogs.mockImplementation((date: string) => (date === '2026-10-11' ? new Promise((r) => { answer = r; }) : Promise.resolve({ data: [] })));
  const v = await mountMonday();
  await waitFor(() => expect(v.getByLabelText('Previous week')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Previous week'));
  await waitFor(() => expect(v.getByText('6 of 7 last week')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Previous week'));
  await waitFor(() => expect(v.getByText('Sunday, October 11')).toBeTruthy());
  expect(v.getByLabelText('Loading habits')).toBeTruthy();
  expect(v.queryByTestId('habits-ring-tile-w')).toBeNull();
  expect(pastRing('Sunday 11')).toBe(false);
  await act(async () => { answer({ data: [{ ...log('2026-10-11'), habit_id: 'w' }] }); });
  await waitFor(() => expect(lastRing('habits-ring')).toMatchObject({ label: 'Sunday 11, 1 of 1 done', segments: ['done'] }));
  expect(v.getByTestId('habits-ring-tile-w').props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(v.getByTestId('habits-ring-tile-w'));
  expect(mockLog).toHaveBeenCalledWith('w', { date: '2026-10-11', completed: false, value: 0 });
});

it('a past day whose read fails says so with Try again and takes no tick; Try again brings its tick back', async () => {
  // Sunday 18 is ticked on the server but not in the list this screen holds.
  let down = true;
  mockGetLogs.mockImplementation(async (date: string) => {
    if (date !== '2026-10-18') return { data: [] };
    if (down) throw new Error('offline');
    return { data: [{ ...log(date), habit_id: 'w' }] };
  });
  const v = await mountMonday();
  await waitFor(() => expect(v.getByLabelText('Previous week')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Previous week'));
  await waitFor(() => expect(v.getByTestId('habits-ring-past-error')).toHaveTextContent(FAILED));
  expect(v.getByText('Sunday')).toBeTruthy();
  expect(v.queryByTestId('habits-ring-tile-w')).toBeNull();
  expect(pastRing('Sunday 18')).toBe(false);
  expect(mockLog).not.toHaveBeenCalled();
  down = false;
  await fireEvent.press(v.getByTestId('habits-ring-retry'));
  await waitFor(() => expect(lastRing('habits-ring')).toMatchObject({ label: 'Sunday 18, 1 of 1 done', segments: ['done'] }));
  expect(v.queryByTestId('habits-ring-past-error')).toBeNull();
  expect(v.queryByTestId('habits-ring-retry')).toBeNull();
  expect(v.getByTestId('habits-ring-tile-w').props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(v.getByTestId('habits-ring-tile-w'));
  expect(mockLog).toHaveBeenCalledWith('w', { date: '2026-10-18', completed: false, value: 0 });
});

it('a past week whose summary fails draws no strip and no count, says so, and Try again draws it', async () => {
  const v = await mountMonday();
  const served = mockGet.getMockImplementation() as (...a: unknown[]) => Promise<unknown>;
  let down = true;
  mockGet.mockImplementation(async (url: string, o: { params: { from: string } }) => {
    if (down && o.params.from === '2026-10-12') throw new Error('offline');
    return served(url, o);
  });
  await waitFor(() => expect(v.getByLabelText('Previous week')).toBeTruthy());
  await fireEvent.press(v.getByLabelText('Previous week'));
  await waitFor(() => expect(v.getByTestId('habits-ring-past-error')).toHaveTextContent(FAILED));
  expect(v.queryByTestId('habits-ring-pick-2026-10-17')).toBeNull();
  expect(v.queryByText(/last week/)).toBeNull();
  expect(v.getByText('Sunday, October 18')).toBeTruthy();
  down = false;
  await fireEvent.press(v.getByTestId('habits-ring-retry'));
  await waitFor(() => expect(v.getByText('6 of 7 last week')).toBeTruthy());
  expect(v.getByTestId('habits-ring-pick-2026-10-17').props.accessibilityLabel).toBe('Saturday 17, 1 of 1 done');
  expect(v.queryByTestId('habits-ring-past-error')).toBeNull();
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
