import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ReportScreen from '../../ReportScreen';
import WeekInReviewScreen from '../WeekInReviewScreen';
import { loadWeekReview, reviewTrend, reviewWeek, sleepLine } from '../weekReview';
import { toUnit, type WeightUnit } from '../progressV2';

const week = { start: '2026-10-05', end: '2026-10-11' };
let mockUser: { id: string; profile: { weight_unit?: 'kg' } } | null = { id: 'client-a', profile: {} };
const mockGet = jest.fn();
const mockWorkouts = jest.fn();
const mockAssignments = jest.fn();
const mockFood = jest.fn();
const mockWeight = jest.fn();
const mockChecks = jest.fn();
const mockBack = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true, default: { get: (...args: unknown[]) => mockGet(...args) },
  workoutApi: { getAll: (...args: unknown[]) => mockWorkouts(...args) },
  logApi: { getWeekly: (...args: unknown[]) => mockFood(...args) },
  weightApi: { getHistory: (...args: unknown[]) => mockWeight(...args) },
  checkInsApi: { list: (...args: unknown[]) => mockChecks(...args) },
}));
jest.mock('../../../../api/workoutBuilderApi', () => ({ workoutBuilderApi: { listMyAssignments: () => mockAssignments() } }));
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
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'client-a', profile: {} };
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
  expect(reviewTrend(d.weights, week, 'lb')).toBe('Down 0.2 lb this week.');
  expect(sleepLine(d.sleepMinutes)).toBe('7 h 15 m');
  expect(sleepLine(null)).toBe('No sleep logged');
});

it.each<WeightUnit>(['lb', 'kg'])('reuses the full-history smoothed trend in %s, equally for a gain and a loss', async (unit) => {
  const d = await read();
  const up = d.weights.map((w) => ({ ...w, weight: 360 - w.weight }));
  const n = toUnit(0.2, unit).toFixed(1);
  expect(reviewTrend(d.weights, week, unit)).toBe(`Down ${n} ${unit} this week.`);
  expect(reviewTrend(up, week, unit)).toBe(`Up ${n} ${unit} this week.`);
  expect(reviewTrend([], week, unit)).toBe('No weigh-ins this week.');
  expect(reviewTrend(d.weights.slice(0, 1), week, unit)).toBe('No weigh-ins this week.');
});

it('the Report door mounts the real week with no weekly form, historical target or invented coach reply', async () => {
  const v = await render(<ReportScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Protein, average: 132 g')).toBeTruthy());
  expect(v.getByRole('header', { name: 'Week in review' })).toBeTruthy();
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
  const v = await render(<WeekInReviewScreen navigation={navigation} />);
  await waitFor(() => expect(v.getByLabelText('Workouts: 1 logged')).toBeTruthy());
  expect(v.queryByText(/coach|Sam/)).toBeNull();
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
