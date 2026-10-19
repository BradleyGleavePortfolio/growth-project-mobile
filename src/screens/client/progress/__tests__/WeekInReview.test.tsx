import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ReportScreen from '../../ReportScreen';
import WeekInReviewScreen from '../WeekInReviewScreen';
import { loadWeekReview, reviewTrend, reviewWeek, sleepLine, weekDates } from '../weekReview';
import { toUnit, type WeightUnit } from '../progressV2';

const week = { start: '2026-10-05', end: '2026-10-11' };
let mockUser: { id: string; coach_id?: string; profile: { weight_unit?: 'kg' } } | null = { id: 'client-a', profile: {} };
let mockCoachless = false;
const mockGet = jest.fn();
const mockWorkouts = jest.fn();
const mockAssignments = jest.fn();
const mockFood = jest.fn();
const mockWeight = jest.fn();
const mockChecks = jest.fn();
const mockBack = jest.fn();
const mockSleep = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true, default: { get: (...args: unknown[]) => mockGet(...args) },
  workoutApi: { getAll: (...args: unknown[]) => mockWorkouts(...args) },
  logApi: { getWeekly: (...args: unknown[]) => mockFood(...args) },
  weightApi: { getHistory: (...args: unknown[]) => mockWeight(...args) },
  checkInsApi: { list: (...args: unknown[]) => mockChecks(...args) },
}));
jest.mock('../../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: () => mockAssignments() } }));
jest.mock('../../../../api/wearablesSamplesApi', () => ({ wearablesSamplesApi: { getSamples: (...args: unknown[]) => mockSleep(...args) } }));
jest.mock('../../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'c1', name: 'Sam Rivera', timezone: null }] }) }));
jest.mock('../../../../api/macrosApi', () => ({ macrosApi: { currentForSelf: jest.fn() } }));
jest.mock('../../../../hooks/useMacroTargets', () => ({ useMacroTargets: jest.fn() }));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../utils/date', () => ({
  getTodayString: () => '2026-10-14',
  bucketDateLocal: (d: Date) => d.toISOString().slice(0, 10),
}));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientProgressV2: true } }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = require('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens, tokens: t.default }) };
});
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

const navigation = { goBack: mockBack };
const read = () => loadWeekReview('client-a', week);
/** A watch night (SLEEP_DURATION_MIN) that ends on the morning of `day`. */
const night = (day: string, value: number) => ({ start_at: `${day}T00:00:00.000Z`, end_at: `${day}T07:00:00.000Z`, value });
const watch = (...nights: Array<ReturnType<typeof night>>) => ({ series: [{ metric: 'SLEEP_DURATION_MIN', samples: nights }] });
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'client-a', coach_id: 'c1', profile: {} };
  mockCoachless = false;
  mockSleep.mockResolvedValue({ series: [] });
  mockGet.mockResolvedValue({ data: { habits: [{ done: 16, planned: 21 }] } });
  mockWorkouts.mockResolvedValue({ data: [{ date: '2026-10-07' }, { date: '2026-10-13' }] });
  mockAssignments.mockResolvedValue([
    { scheduled_for: '2026-10-06T12:00:00Z', completed_at: '2026-10-06T13:00:00Z' },
    { scheduled_for: '2026-10-10T12:00:00Z', completed_at: null },
    { scheduled_for: '2026-10-14T12:00:00Z', completed_at: null },
  ]);
  mockFood.mockResolvedValue({ data: [{ date: '2026-10-05', protein_g: 120 }, { date: '2026-10-11', protein_g: 144 }] });
  mockWeight.mockResolvedValue({ data: { logs: [
    { id: 'w1', date: '2026-10-04', weight_lbs: 180 },
    { id: 'w2', date: '2026-10-08', weight_lbs: 178 },
    { id: 'w3', date: '2026-10-13', weight_lbs: 160 },
  ] } });
  mockChecks.mockResolvedValue({ data: [
    { date: '2026-10-05', sleep_hours: 7 },
    { date: '2026-10-07', sleep_hours: null },
    { date: '2026-10-11', sleep_hours: 7.5 },
  ] });
});

it('reviews the last complete Monday–Sunday, including when opened on Monday or Sunday', () => {
  expect(reviewWeek('2026-10-14')).toEqual(week);
  expect(reviewWeek('2026-10-12')).toEqual(week);
  expect(reviewWeek('2026-10-18')).toEqual(week);
  expect(weekDates(week)).toBe('October 5 to 11');
  expect(weekDates(reviewWeek('2026-10-07'))).toBe('September 28 to October 4');
  expect(weekDates(reviewWeek('2027-01-06'))).toBe('December 28 to January 3');
});

it('uses self-only reads, exact week bounds, logged days for protein and only recorded sleep', async () => {
  const d = await read();
  expect(mockGet).toHaveBeenCalledWith('/habits/summary', { params: { from: week.start, to: week.end } });
  expect(mockChecks).toHaveBeenCalledWith({ from: week.start, to: week.end, limit: 7 });
  expect(mockFood).toHaveBeenCalledWith(week.start);
  expect(mockWorkouts).toHaveBeenCalledWith(50);
  expect(d).toMatchObject({ workouts: 1, food: 2, protein: 132, habits: { done: 16, planned: 21 }, checkIns: 3, sleepMinutes: 435, empty: false });
  expect(d.training).toMatchObject({ done: 1, total: 2 });
  expect(d.weights.map((w) => w.id)).toEqual(['w1', 'w2']);
  expect(reviewTrend(d.weights, week, 'lb')).toBe('Down 0.2 lb');
  expect(sleepLine(d.sleepMinutes ?? null)).toBe('7 h 15 m');
  expect(sleepLine(null)).toBe('No sleep logged');
});

it.each<WeightUnit>(['lb', 'kg'])('reuses the full-history smoothed trend in %s, equally for a gain and a loss', async (unit) => {
  const d = await read();
  const up = d.weights.map((w) => ({ ...w, weight: 360 - w.weight }));
  const n = toUnit(0.2, unit).toFixed(1);
  expect(reviewTrend(d.weights, week, unit)).toBe(`Down ${n} ${unit}`);
  expect(reviewTrend(up, week, unit)).toBe(`Up ${n} ${unit}`);
  expect(reviewTrend([], week, unit)).toBe('No weigh-ins this week.');
  expect(reviewTrend(d.weights.slice(0, 1), week, unit)).toBe('No weigh-ins this week.');
});

it('Monday counts: Monday-only weigh-ins measure from the trend before the week, not after Monday', async () => {
  mockWeight.mockResolvedValue({ data: { logs: [['2026-09-21', 182], ['2026-09-28', 180], ['2026-10-05', 177]]
    .map(([date, weight_lbs], i) => ({ id: `m${i}`, date, weight_lbs })) } });
  const d = await read();
  expect(reviewTrend(d.weights, week, 'lb')).toBe('Down 0.5 lb');
  expect(reviewTrend(d.weights, week, 'kg')).toBe('Down 0.2 kg');
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Weight trend: Down 0.5 lb')).toBeTruthy());
  expect(v.queryByText(/Steady/)).toBeNull();
});

it.each([
  ['the watch only', watch(night('2026-10-05', 420), night('2026-10-11', 460)), [], '7 h 20 m'],
  ['the daily check-in only', { series: [] }, [{ date: '2026-10-06', sleep_hours: 6.5 }], '6 h 30 m'],
  ['the watch first, the check-in for nights it missed', watch(night('2026-10-05', 480), night('2026-10-06', 420)),
    [{ date: '2026-10-05', sleep_hours: 5 }, { date: '2026-10-11', sleep_hours: '7.5' }], '7 h 30 m'],
  ['neither', { series: [] }, [{ date: '2026-10-07', sleep_hours: null }], 'No sleep logged'],
])('sleep reads like Home: %s', async (_, health, checks, line) => {
  mockSleep.mockResolvedValue(health);
  mockChecks.mockResolvedValue({ data: checks });
  const d = await read();
  expect(mockSleep).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'SLEEP_RECOVERY', granularity: 'day', preferredOnly: true }));
  expect(sleepLine(d.sleepMinutes ?? null)).toBe(line);
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText(`Sleep, average: ${line}`)).toBeTruthy());
});

it('a week with only watch sleep is not called empty', async () => {
  mockGet.mockResolvedValue({ data: { habits: [] } });
  mockWorkouts.mockResolvedValue({ data: [] });
  mockAssignments.mockResolvedValue([]);
  mockFood.mockResolvedValue({ data: [] });
  mockWeight.mockResolvedValue({ data: { logs: [] } });
  mockChecks.mockResolvedValue({ data: [] });
  mockSleep.mockResolvedValue(watch(night('2026-10-08', 450)));
  expect((await read()).empty).toBe(false);
});

// #WEEK-SLEEP-FAIL op 2: only the watch read may fail and still show the week.
it.each([['a server error', { response: { status: 503 } }], ['no connection', { isAxiosError: true }]])(
  'a failed watch read (%s) shows the rest of the week, no sleep row and no error', async (_, error) => {
    mockSleep.mockRejectedValue(error);
    mockChecks.mockResolvedValue({ data: [{ date: '2026-10-07', sleep_hours: null }] });
    expect((await read()).sleepMinutes).toBeUndefined();
    const v = await render(<WeekInReviewScreen navigation={navigation} />);
    await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
    ['Workouts: 1 of 2', 'Food logged: 2 of 7 days', 'Weight trend: Down 0.2 lb', 'Habits: 16 of 21']
      .forEach((row) => expect(v.getByLabelText(row)).toBeTruthy());
    expect(v.queryByText(/Sleep, average|No sleep logged|could not load|No logs for this week/)).toBeNull();
  });

it('a failed watch read counts check-in hours alone, as the Home Sleep dial does', async () => {
  mockSleep.mockRejectedValue({ response: { status: 503 } });
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Sleep, average: 7 h 15 m')).toBeTruthy());
  expect(v.queryByTestId('week-error')).toBeNull();
});

it('with a failed watch read, "No logs for this week." shows only when every read that answered is empty', async () => {
  mockSleep.mockRejectedValue({ response: { status: 503 } });
  mockGet.mockResolvedValue({ data: { habits: [] } });
  [mockWorkouts, mockFood, mockChecks].forEach((m) => m.mockResolvedValue({ data: [] }));
  mockAssignments.mockResolvedValue([]);
  mockWeight.mockResolvedValue({ data: { logs: [] } });
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByText('No logs for this week.')).toBeTruthy());
  expect(v.queryByText(/Sleep, average|No sleep logged/)).toBeNull();
  mockChecks.mockResolvedValue({ data: [{ date: '2026-10-08', sleep_hours: 6 }] });
  expect(await read()).toMatchObject({ empty: false, sleepMinutes: 360 });
});

it.each([['workouts', mockWorkouts], ['assignments', mockAssignments], ['food', mockFood], ['weight', mockWeight],
  ['habits', mockGet], ['check-ins', mockChecks]])('any other failed read (%s) keeps "Your week could not load"', async (_, mock) => {
  mock.mockRejectedValueOnce({ response: { status: 403 } });
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByText('Your week could not load. Try again in a moment.')).toBeTruthy());
  expect(v.queryByLabelText(/Workouts:|Sleep, average:/)).toBeNull();
});

it('the Report door mounts the real week with no weekly form, historical target or invented coach reply', async () => {
  const v = await render(<ReportScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
  expect(v.getByRole('header', { name: 'Week in review' })).toBeTruthy();
  expect(v.getByText('October 5 to 11')).toBeTruthy();
  expect(v.getByRole('header', { name: 'Habits this week' })).toBeTruthy();
  expect(v.getByLabelText('Workouts: 1 of 2')).toBeTruthy();
  expect(v.getByLabelText('Habits this week, 16 of 21 done')).toBeTruthy();
  expect(v.getByText('Daily check-ins: 3 of 7')).toBeTruthy();
  expect(v.getByLabelText('Sleep, average: 7 h 15 m')).toBeTruthy();
  expect(v.queryByText(/Send to|Seen by|Save check-in|150 g/)).toBeNull();
  await fireEvent.press(v.getByRole('button', { name: 'Back' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('a coachless client with no plan sees their logged workouts, not a fake denominator', async () => {
  mockAssignments.mockResolvedValue([]);
  mockCoachless = true;
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Workouts: 1 logged')).toBeTruthy());
  expect(v.queryByText(/coach|Sam/)).toBeNull();
  expect(v.queryByText('S', { includeHiddenElements: true })).toBeNull();
});

it('the masthead shows the coach initial the Progress masthead shows, hidden from the screen reader', async () => {
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
  expect(v.getByText('S', { includeHiddenElements: true })).toBeTruthy();
  expect(v.queryByText('S')).toBeNull();
});

it('Back names Progress only when Progress is the page it returns to', async () => {
  const from = (name: string) => ({ goBack: mockBack, getState: () => ({ index: 1, routes: [{ name }, { name: 'Report' }] }) });
  const v = await render(<WeekInReviewScreen navigation={from('Progress')} />);
  await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
  await fireEvent.press(v.getByRole('button', { name: 'Back to Progress' }));
  expect(v.getByText('Progress')).toBeTruthy();
  expect(mockBack).toHaveBeenCalledTimes(1);
  await v.rerender(<WeekInReviewScreen navigation={from('MoreIndex')} />);
  expect(v.getByRole('button', { name: 'Back' })).toBeTruthy();
  expect(v.queryByText('Progress')).toBeNull();
});

it('the continuous habit ring keeps its actual fraction with six daily habits', async () => {
  mockGet.mockResolvedValue({ data: { habits: [{ done: 35, planned: 42 }] } });
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Habits this week, 35 of 42 done')).toBeTruthy());
  const circumference = 2 * Math.PI * 38;
  const [filled, total] = v.getByTestId('week-habits-fill').props.strokeDasharray.map(Number);
  expect(filled).toBeCloseTo(35 / 42 * circumference);
  expect(total).toBeCloseTo(circumference);
});

it('pending reads never claim empty; an empty week uses unknowns, not fake averages', async () => {
  let finish: (value: unknown) => void = () => undefined;
  mockFood.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mockGet.mockResolvedValue({ data: { habits: [] } });
  mockWorkouts.mockResolvedValue({ data: [] });
  mockAssignments.mockResolvedValue([]);
  mockWeight.mockResolvedValue({ data: { logs: [] } });
  mockChecks.mockResolvedValue({ data: [] });
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  expect(v.getByLabelText('Loading your week')).toBeTruthy();
  expect(v.queryByTestId('week-empty')).toBeNull();
  finish({ data: [] });
  await waitFor(() => expect(v.getByText('No logs for this week.')).toBeTruthy());
  expect(v.getByLabelText('Protein, average: No food logged')).toBeTruthy();
  expect(v.getByLabelText('Habits: Nothing planned')).toBeTruthy();
  expect(v.queryByLabelText(/Habits this week, 0 of 0/)).toBeNull();
  expect(v.queryByText('Habits this week')).toBeNull();
});

it.each([
  [{ response: { status: 403 } }, 'Your week could not load. Try again in a moment.'],
  [{ isAxiosError: true }, 'Your week could not load. Check your connection, then try again.'],
])('denied or offline reads expose no numbers; retry reaches the real load', async (error, message) => {
  mockGet.mockRejectedValueOnce(error);
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByText(message)).toBeTruthy());
  expect(v.queryByTestId('week-empty')).toBeNull();
  expect(v.queryByLabelText(/Protein, average:/)).toBeNull();
  await fireEvent.press(v.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
  expect(mockGet).toHaveBeenCalledTimes(2);
});

it('another client never sees the previous client summary', async () => {
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
  mockUser = { id: 'client-b', profile: { weight_unit: 'kg' } };
  mockGet.mockRejectedValue({ response: { status: 403 } });
  await v.rerender(<WeekInReviewScreen navigation={navigation} />);
  expect(v.queryByLabelText(/Protein, average:/)).toBeNull();
  await waitFor(() => expect(v.getByTestId('week-error')).toBeTruthy());
  mockUser = null;
  await v.rerender(<WeekInReviewScreen navigation={navigation} />);
  expect(v.queryByTestId('week-error')).toBeNull();
  expect(v.queryByLabelText(/132 g/)).toBeNull();
});

it('a late result for the previous account cannot replace the current account', async () => {
  let finish: (value: unknown) => void = () => undefined;
  mockFood.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  expect(v.getByLabelText('Loading your week')).toBeTruthy();
  mockUser = { id: 'client-b', profile: {} };
  mockGet.mockRejectedValueOnce({ response: { status: 403 } });
  await v.rerender(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByTestId('week-error')).toBeTruthy());
  await act(async () => { finish({ data: [{ date: week.start, protein_g: 132 }] }); });
  expect(v.getByTestId('week-error')).toBeTruthy();
  expect(v.queryByLabelText(/Protein, average:/)).toBeNull();
});
